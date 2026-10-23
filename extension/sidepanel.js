// The side panel: one box, one roadmap, one card, one message box.
//   You type what you want. The panel first shows the whole path from zero to done (the roadmap),
//   then looks at your page, asks the helper server what to do next, shows ONE instruction in very
//   simple words, and points at the right thing. The AI says which roadmap stage you are on, so the
//   list ticks itself off. When the page changes it looks again by itself.
//   The message box at the bottom lets you ask anything; a message can also change the roadmap.
//   It never clicks or types for you.

const MAX_STEPS = 25;
const MAX_LOAD_WAITS = 20;
const REQUEST_TIMEOUT_MS = 30000;
const GOAL_KEY = "nextClickGoal";

const $ = (id) => document.getElementById(id);
const ui = {
  ask: $("ask"),
  goal: $("goal"),
  go: $("go"),
  goalLine: $("goalLine"),
  goalText: $("goalText"),
  doneList: $("doneList"),
  change: $("change"),
  now: $("now"),
  nowLabel: $("nowLabel"),
  nowText: $("nowText"),
  nowNote: $("nowNote"),
  nowPrimary: $("nowPrimary"),
  copyBox: $("copyBox"),
  copyText: $("copyText"),
  copyBtn: $("copyBtn"),
  hear: $("hear"),
  lost: $("lost"),
  status: $("status"),
  roadmap: $("roadmap"),
  roadHead: $("roadHead"),
  roadTitle: $("roadTitle"),
  roadProgress: $("roadProgress"),
  roadList: $("roadList"),
  thread: $("thread"),
  dock: $("dock"),
  chatInput: $("chatInput"),
  chatSend: $("chatSend"),
};

const state = {
  running: false,
  busy: false,
  pending: false,
  lostNext: false,
  goal: "",
  steps: 0,
  history: [],
  lastKey: "",
  repeats: 0,
  loadWaits: 0,
  timer: 0,
  runId: 0,
  lastStatus: "",
  afterClick: false, // true when the next look follows a real click by you
  lastUrl: "", // kept only in this panel, never sent anywhere
  lastTabId: null,
  msgText: "", // the long message for an app builder, written in the background while you sign up
  msgPromise: null,
  failed: [], // instructions you followed that changed nothing on the page
  failedUrl: "",
  autoRetried: false, // we already tried "another way" once for the current stuck spot
  lastSite: "", // what the latest look saw, so a question can be answered about the same screen
  lastTitle: "",
  lastElements: [],
  plan: null, // the roadmap: { title, steps: [{ title, detail }] }
  stage: 0, // which roadmap stage you are on (1 = first). The AI tells us.
  roadOpen: true,
  roadTouched: false, // you opened or folded it yourself, so we stop doing it for you
  thread: [], // your messages and the answers, used as context for the next question
  chatBusy: false,
};

const MAX_THREAD_BUBBLES = 14;

// ---------- small helpers ----------

function setStatus(text, problem = false) {
  ui.status.textContent = text;
  ui.status.classList.toggle("problem", problem);
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

function isReadableUrl(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url) && !/^https:\/\/chromewebstore\.google\.com/i.test(url);
}

function clearPointer() {
  activeTab()
    .then((tab) => tab && tab.id !== undefined && chrome.tabs.sendMessage(tab.id, { type: "nc-clear" }))
    .catch(() => {});
}

// ---------- the one card ----------

const canSpeak = typeof speechSynthesis !== "undefined" && typeof SpeechSynthesisUtterance !== "undefined";

// Reads ONLY the next step out loud (not the grey note or the Copy text), with the
// browser's own voice. It needs no microphone or permission.
function speak() {
  if (!canSpeak) return;
  // Emoji and tick marks would be read out as words, so remove them.
  const text = ui.nowText.textContent.replace(/[\u{1F300}-\u{1FAFF}☀-➿✓]/gu, "").replace(/\s+/g, " ").trim();
  if (!text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-IN";
  u.rate = 0.92;
  speechSynthesis.speak(u);
}

function showNow({ text, note, primary, copyText, copyPending, problem, label, loading }) {
  ui.now.hidden = false;
  ui.now.classList.toggle("problem", !!problem);
  ui.nowLabel.textContent = label || "";
  ui.nowLabel.hidden = !label;
  ui.nowText.classList.toggle("loading", !!loading);
  ui.nowText.textContent = text || "";
  ui.nowNote.textContent = note || "";
  ui.nowNote.hidden = !note;

  ui.nowPrimary.hidden = !primary;
  ui.nowPrimary.onclick = primary ? primary.onClick : null;
  if (primary) ui.nowPrimary.textContent = primary.label;

  if (copyText) {
    ui.copyText.classList.remove("loading");
    ui.copyText.textContent = copyText;
    ui.copyBtn.textContent = "Copy";
    ui.copyBtn.hidden = false;
    ui.copyBox.hidden = false;
  } else if (copyPending) {
    // The message is still being written. Show that, and fill it in the moment it is ready.
    ui.copyText.classList.add("loading");
    ui.copyText.textContent = "Writing your message for the robot";
    ui.copyBtn.hidden = true;
    ui.copyBox.hidden = false;
  } else {
    ui.copyText.classList.remove("loading");
    ui.copyBox.hidden = true;
  }
  ui.hear.hidden = !canSpeak || !text;
}

// ---------- the message for an app builder, written in the background ----------
// Writing it is the slowest thing the AI does (several seconds). It only depends on your goal, so we
// start it the moment you press Go. You spend minutes signing up first, so it is ready when you arrive.

const APP_GOAL = /\bapps?\b|web ?site|web ?page|landing page|online (shop|store)|portfolio|booking|e-?commerce|\bstore\b|\bshop\b|\bblog\b|dashboard/i;

function startMessage() {
  if (state.msgPromise) return state.msgPromise;
  const goal = state.goal;
  state.msgPromise = ask({ goal }, "/api/message", 50000) // a long message can take a while; it runs in the background
    .then((r) => {
      const text = r && typeof r.text === "string" ? r.text : "";
      if (goal === state.goal && text) state.msgText = text;
      return text;
    })
    .catch(() => {
      if (goal === state.goal) state.msgPromise = null; // allow another try later
      return "";
    });
  return state.msgPromise;
}

function fillMessage(text) {
  ui.copyText.classList.remove("loading");
  if (text) {
    ui.copyText.textContent = text;
    ui.copyBtn.textContent = "Copy";
    ui.copyBtn.hidden = false;
  } else {
    ui.copyText.textContent = "I couldn't write your message just now. Ask me in the box below and I'll write it for you.";
    ui.copyBtn.hidden = true;
  }
}

// A faded list of the last steps you already did, so you can see you are moving forward.
function renderDone() {
  const before = state.history.slice(0, -1).slice(-2);
  ui.doneList.textContent = "";
  before.forEach((text) => {
    const li = document.createElement("li");
    li.textContent = text;
    ui.doneList.appendChild(li);
  });
  // With a roadmap on screen, the roadmap already shows your progress.
  ui.doneList.hidden = before.length === 0 || !!state.plan;
}

// ---------- the roadmap: the whole path from zero to done ----------

function validRoadmap(p) {
  return (
    !!p &&
    Array.isArray(p.steps) &&
    p.steps.length >= 3 &&
    p.steps.every((s) => s && typeof s.title === "string" && s.title.length > 0)
  );
}

function planTitles() {
  return state.plan ? state.plan.steps.map((s) => s.title) : undefined;
}

function setPlan(plan, stage = 1) {
  state.plan = plan;
  state.stage = plan ? stage : 0;
  state.roadTouched = false; // a fresh roadmap starts open, and folds itself after your first step
  setRoadOpen(true);
  renderDone();
}

function setRoadOpen(open) {
  state.roadOpen = open;
  ui.roadHead.setAttribute("aria-expanded", String(open));
  renderRoad();
}

function renderRoad() {
  const plan = state.plan;
  ui.roadmap.hidden = !plan;
  if (!plan) return;
  const total = plan.steps.length;
  const current = Math.min(Math.max(state.stage, 1), total + 1); // total + 1 means everything is done
  // Open: the name of the path. Folded: the stage you are on, so you never lose your place.
  ui.roadTitle.textContent = state.roadOpen || current > total ? plan.title : plan.steps[current - 1].title;
  ui.roadProgress.textContent = current > total ? "All done" : `Step ${current} of ${total}`;
  ui.roadList.textContent = "";
  plan.steps.forEach((step, i) => {
    const n = i + 1;
    const li = document.createElement("li");
    li.className = n < current ? "done" : n === current ? "current" : "";
    const box = document.createElement("div");
    const title = document.createElement("div");
    title.className = "r-title";
    title.textContent = step.title;
    box.appendChild(title);
    if (step.detail) {
      const detail = document.createElement("div");
      detail.className = "r-detail";
      detail.textContent = step.detail;
      box.appendChild(detail);
    }
    li.appendChild(box);
    ui.roadList.appendChild(li);
  });
}

// ---------- the chat: ask me anything ----------

function bubble(role, text, extra = "") {
  const b = document.createElement("div");
  b.className = `bubble ${role} ${extra}`.trim();
  b.textContent = text;
  ui.thread.appendChild(b);
  while (ui.thread.children.length > MAX_THREAD_BUBBLES) ui.thread.removeChild(ui.thread.firstChild);
  ui.thread.hidden = false;
  if (b.scrollIntoView) b.scrollIntoView({ block: "end", behavior: "smooth" });
  return b;
}

// A ready-to-paste message for the robot builder, with its own Copy button.
function promptBubble(text) {
  const b = document.createElement("div");
  b.className = "bubble ai promptbox";
  const label = document.createElement("div");
  label.className = "promptlabel";
  label.textContent = "Your message for the robot";
  const body = document.createElement("div");
  body.className = "prompttext";
  body.textContent = text;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "promptcopy";
  btn.textContent = "Copy";
  btn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      const range = document.createRange();
      range.selectNodeContents(body);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand("copy");
    }
    btn.textContent = "Copied ✓";
  });
  b.append(label, body, btn);
  ui.thread.appendChild(b);
  ui.thread.hidden = false;
  if (b.scrollIntoView) b.scrollIntoView({ block: "end", behavior: "smooth" });
}

function remember(role, text) {
  state.thread.push({ role, text });
  if (state.thread.length > 12) state.thread.shift();
}

function autosizeChat() {
  ui.chatInput.style.height = "auto";
  ui.chatInput.style.height = Math.min(ui.chatInput.scrollHeight, 120) + "px";
  // Only show a scrollbar when the text is really longer than the box can grow.
  ui.chatInput.style.overflowY = ui.chatInput.scrollHeight > 120 ? "auto" : "hidden";
}

async function sendChat() {
  const text = ui.chatInput.value.trim();
  if (!text) {
    ui.chatInput.focus(); // plain-code check: an empty message never goes to the server or the AI
    return;
  }
  if (state.chatBusy) return;
  state.chatBusy = true;
  const earlier = state.thread.slice(-10);
  ui.chatInput.value = "";
  autosizeChat();
  bubble("user", text);
  remember("user", text);
  const typing = bubble("ai", "Thinking", "typing");
  try {
    const res = await ask(
      {
        message: text,
        goal: state.goal,
        plan: planTitles(),
        thread: earlier,
        site: state.lastSite,
        title: state.lastTitle,
        elements: state.lastElements.slice(0, 60),
        currentStep: ui.now.hidden || ui.nowText.classList.contains("loading") ? "" : ui.nowText.textContent,
      },
      "/api/chat"
    );
    typing.remove();
    if (!res || typeof res.reply !== "string") throw new Error("I got mixed up. Please send that again.");
    bubble("ai", res.reply);
    remember("ai", res.reply);
    if (typeof res.prompt === "string" && res.prompt.trim().length >= 30) promptBubble(res.prompt.trim());
    if (validRoadmap(res.plan)) {
      // Your message changed the path: show the new roadmap and carry on from its first stage.
      setPlan(res.plan, 1);
      if (state.goal) beginRun(0);
    }
  } catch (err) {
    typing.remove();
    bubble("ai", err.message || "Something went wrong. Please send that again.", "problem");
  } finally {
    state.chatBusy = false;
  }
}

function resetChat() {
  state.msgText = "";
  state.msgPromise = null;
  state.thread = [];
  ui.thread.textContent = "";
  ui.thread.hidden = true;
  ui.chatInput.value = "";
  autosizeChat();
  setPlan(null);
}

function showProblem(text) {
  state.running = false;
  showNow({ text, problem: true, primary: { label: "Try again", onClick: tryAgain } });
  setStatus("");
}

async function copyText() {
  const text = ui.copyText.textContent;
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    const range = document.createRange();
    range.selectNodeContents(ui.copyText);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand("copy");
  }
  ui.copyBtn.textContent = "Copied ✓";
}

// ---------- talking to the helper server ----------

async function ask(payload, path = "/api/next-step", timeoutMs = REQUEST_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(API_BASE + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(data && data.message ? data.message : "My helper is having a little rest. Please wait a bit and try again.");
    }
    return data;
  } catch (err) {
    if (err.name === "AbortError") throw new Error("That took too long. Please press \"Try again\".");
    if (err && err.name === "TypeError") throw new Error("I can't think right now. Please check your internet, wait a bit, and press \"Try again\".");
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function validReply(r) {
  return (
    r &&
    typeof r.instruction === "string" &&
    r.instruction.length > 0 &&
    ["continue", "done", "stuck"].includes(r.status) &&
    (r.elementId === null || typeof r.elementId === "number")
  );
}

// ---------- the look-and-point loop ----------

function schedule(delayMs) {
  clearTimeout(state.timer);
  if (!state.running) return;
  state.timer = setTimeout(() => look(), delayMs);
}

function beginRun(delayMs) {
  state.steps = 0;
  state.history = [];
  state.lastKey = "";
  state.repeats = 0;
  state.loadWaits = 0;
  state.afterClick = false;
  state.lastUrl = "";
  state.lastTabId = null;
  state.failed = [];
  state.failedUrl = "";
  state.autoRetried = false;
  renderDone();
  state.runId += 1;
  state.running = true;
  if (delayMs > 0) schedule(delayMs);
  else look();
}

function tryAgain() {
  state.lostNext = false;
  if (state.goal) beginRun(0);
}

function imLost() {
  if (!state.goal) return;
  state.lostNext = true;
  state.runId += 1;
  state.running = true;
  state.repeats = 0;
  state.lastKey = "";
  look();
}

function openSite(site) {
  chrome.tabs.create({ url: site.url });
  showNow({ text: `Opening ${site.label}… one moment.` });
  setStatus("");
  state.running = true;
  state.loadWaits = 0;
  state.repeats = 0;
  state.lastKey = "";
  schedule(1200);
}

// Reads the current tab. A blank tab or a page we may not read is not an error:
// the server just hears "nothing to see" and tells us which website to open.
async function readPage(tab) {
  const nothing = { site: "", title: "", elements: [], url: "" };
  if (!tab || tab.id === undefined) return nothing;
  if (tab.url !== undefined && !isReadableUrl(tab.url)) return nothing;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    const scan = await chrome.tabs.sendMessage(tab.id, { type: "nc-scan" });
    if (!scan || !Array.isArray(scan.elements)) return nothing;
    let site = "";
    try {
      site = new URL(scan.url).hostname; // only the website name is sent, never the full address
    } catch (e) {
      site = "";
    }
    return { site, title: scan.title, elements: scan.elements, url: scan.url || "" };
  } catch (e) {
    return nothing;
  }
}

async function look() {
  if (!state.running) return;
  if (state.busy) {
    state.pending = true;
    return;
  }
  const runId = state.runId;
  const lost = state.lostNext;
  const afterClick = state.afterClick; // you just pressed something: the AI must give the NEXT step
  state.lostNext = false;
  state.afterClick = false;
  state.busy = true;
  state.pending = false;
  try {
    setStatus("Looking at your page…");
    // Show something at once, so the panel never looks frozen on the first look.
    if (ui.now.hidden) showNow({ text: "Looking at your page", loading: true });
    const tab = await activeTab();
    if (tab && tab.status === "loading" && state.loadWaits < MAX_LOAD_WAITS) {
      state.loadWaits += 1;
      setStatus("Waiting for the page to open…");
      schedule(1000);
      return;
    }

    const page = await readPage(tab);
    state.lastUrl = page.url;
    state.lastTabId = tab ? tab.id : null;
    state.lastSite = page.site;
    state.lastTitle = page.title;
    state.lastElements = page.elements;
    // A step that failed on one page may be right on another, so forget failures when the page changes.
    if (state.failed.length && page.url && state.failedUrl && page.url !== state.failedUrl) state.failed = [];
    setStatus("Thinking…");
    const reply = await ask({
      goal: state.goal,
      plan: planTitles(),
      didNotWork: state.failed.length ? state.failed.slice(-3) : undefined,
      lost,
      afterClick,
      site: page.site,
      title: page.title,
      elements: page.elements,
      history: state.history.slice(-3),
    });
    if (runId !== state.runId || !state.running) return; // you moved on meanwhile
    if (!validReply(reply)) throw new Error("I got mixed up. Please press \"Try again\".");

    // The AI tells us which stage of the roadmap you are on, so the list ticks itself off.
    if (state.plan) {
      if (reply.status === "done") state.stage = state.plan.steps.length + 1;
      else if (Number.isInteger(reply.stage) && reply.stage >= 1) state.stage = Math.min(reply.stage, state.plan.steps.length);
      renderRoad();
    }

    const key = reply.instruction + "|" + reply.elementId;
    const same = key === state.lastKey;

    // We looked again by ourselves (not after your click) and nothing new came back:
    // leave the card and the arrow exactly as they are. Do not count it, do not flicker.
    if (same && !afterClick && !lost && reply.status === "continue") {
      setStatus(state.lastStatus || "");
      return;
    }

    // A repeat right AFTER your click means the page didn't change, so that step led nowhere
    // (for example a "New" button on the page you are already on).
    if (same && afterClick) {
      state.repeats += 1;
      if (!state.failed.includes(reply.instruction)) state.failed.push(reply.instruction);
      state.failedUrl = state.lastUrl;
      if (!state.autoRetried) {
        // First time: do not show the same thing again. Ask once more and tell the AI it did not
        // work, so it tries another way (often the main message box on the page).
        state.autoRetried = true;
        state.lostNext = true;
        setStatus("That didn't seem to change anything. Let me try another way…");
        schedule(0);
        return;
      }
    } else if (!same) {
      state.repeats = 0;
      state.autoRetried = false;
    }
    // The other way gave the very same answer again: I'm out of ideas for this screen.
    const stubborn = same && lost && state.autoRetried;
    state.lastKey = key;
    state.steps += 1;
    state.history.push(reply.instruction);
    renderDone();
    // After your first step, fold the roadmap so the card with the next thing to press stays in view.
    if (state.plan && state.steps >= 2 && state.roadOpen && !state.roadTouched) setRoadOpen(false);

    let pointed = false;
    if (reply.elementId !== null && tab && tab.id !== undefined) {
      try {
        const res = await chrome.tabs.sendMessage(tab.id, { type: "nc-point", id: reply.elementId });
        pointed = !!(res && res.ok);
      } catch (e) {
        pointed = false;
      }
    } else {
      clearPointer();
    }

    if (reply.status === "done") {
      state.running = false;
      showNow({ text: reply.instruction, note: reply.note });
      setStatus("You did it! 🎉");
      return;
    }

    const unsure = reply.verified ? "" : "I'm not 100% sure about this one.";
    const missed = reply.elementId !== null && !pointed ? "I can't show you with the orange arrow this time, so look for it using my words." : "";
    const note = [reply.note, unsure, missed].filter(Boolean).join(" ");
    // At an app builder's message box the long message comes from the background writer, not the step finder.
    const wantsMessage = reply.needsMessage === true && !reply.copyText;
    const messageReady = wantsMessage && !!state.msgText;
    showNow({
      label: `Step ${state.steps}`,
      text: reply.instruction,
      note,
      copyText: messageReady ? state.msgText : reply.copyText,
      copyPending: wantsMessage && !messageReady,
      primary: reply.open ? { label: `Open ${reply.open.label}`, onClick: () => openSite(reply.open) } : null,
    });
    if (wantsMessage && !messageReady) {
      // Not ready yet: wait for it (or start it now) and fill it in, as long as this card is still showing.
      startMessage().then((text) => {
        if (ui.copyText.classList.contains("loading")) fillMessage(text);
      });
    }

    if (reply.status === "stuck") {
      state.running = false;
      setStatus("");
    } else if (state.steps >= MAX_STEPS) {
      state.running = false;
      setStatus("We have done a lot of steps. I will wait here. Press \"I'm lost\" when you want me again.");
    } else if (stubborn) {
      state.running = false;
      setStatus("I'm stuck on this screen. Tell me what you see in the box below and I'll help.");
    } else if (state.repeats >= 2) {
      state.running = false;
      setStatus("It looks like nothing changed after you pressed it. Press \"I'm lost\" and I'll look again.");
    } else if (reply.open) {
      setStatus("");
    } else {
      state.lastStatus = pointed ? "Press where the arrow points. I'll see when you do." : "I'll see when you do it.";
      setStatus(state.lastStatus);
    }
  } catch (err) {
    showProblem(err.message || "Something went wrong. Please press \"Try again\".");
  } finally {
    state.busy = false;
    if (state.pending && state.running) schedule(800);
  }
}

// ---------- the one box ----------

async function go() {
  // Plain-code check: an empty goal never goes to the server or the AI.
  const goal = ui.goal.value.trim();
  if (!goal) {
    setStatus("First tell me what you want to do. Type it in the box above.", true);
    ui.goal.focus();
    return;
  }
  state.goal = goal;
  ui.goalText.textContent = goal;
  ui.ask.hidden = true;
  ui.goalLine.hidden = false;
  ui.dock.hidden = false; // from now on you can ask me anything
  resetChat();
  setStatus("");
  showNow({ text: "Planning your path", loading: true });
  // For a website or app, start writing the message for the app builder right away, in the background.
  if (APP_GOAL.test(goal)) startMessage();

  // First the whole path from zero to done. If that fails, we still guide you step by step.
  const runId = ++state.runId;
  try {
    const res = await ask({ message: goal, start: true, goal }, "/api/chat");
    if (runId !== state.runId) return; // you pressed Change meanwhile
    if (res && validRoadmap(res.plan)) setPlan(res.plan, 1);
    if (res && typeof res.reply === "string" && res.reply) {
      bubble("ai", res.reply);
      remember("ai", res.reply);
    }
  } catch (err) {
    if (runId !== state.runId) return;
  }
  beginRun(0);
}

function change() {
  state.runId += 1;
  state.running = false;
  clearTimeout(state.timer);
  clearPointer();
  if (canSpeak) speechSynthesis.cancel();
  ui.now.hidden = true;
  ui.goalLine.hidden = true;
  ui.dock.hidden = true;
  resetChat();
  ui.ask.hidden = false;
  ui.goal.value = state.goal;
  setStatus("");
  ui.goal.focus();
}

// ---------- wiring ----------

ui.go.addEventListener("click", go);
ui.change.addEventListener("click", change);
ui.goal.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    go();
  }
});
ui.copyBtn.addEventListener("click", copyText);
ui.hear.addEventListener("click", speak);
ui.lost.addEventListener("click", imLost);
ui.roadHead.addEventListener("click", () => {
  state.roadTouched = true;
  setRoadOpen(!state.roadOpen);
});
ui.dock.addEventListener("submit", (e) => {
  e.preventDefault();
  sendChat();
});
ui.chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendChat();
  }
});
ui.chatInput.addEventListener("input", autosizeChat);

// We only look again for a real reason: you pressed the thing we pointed at, that thing disappeared,
// or you landed on a different page. Small background updates are ignored on purpose.
// (The page itself waits until it stops changing before it is read, so these delays can be short.)
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== "nc-event") return;
  if (msg.kind === "user-acted") {
    if (!state.running) return;
    state.afterClick = true; // tells the AI: they did the last step, give the NEXT one
    // Answer the click at once: the old step is finished, the next one is on its way.
    showNow({ label: `Step ${state.steps}`, text: "Nice! Finding your next step", loading: true });
    setStatus("");
    schedule(0); // no waiting: the page itself waits until it has settled before it is read
  } else if (msg.kind === "page-changed") {
    // The thing we pointed at disappeared. Most likely you used it (a menu closed, a new page opened).
    if (state.running && state.steps > 0) state.afterClick = true;
    schedule(0);
  } else if (msg.kind === "content-changed") {
    // The page changed a lot while the thing we pointed at is still there (e.g. a new section opened).
    // We don't know you pressed anything, so just look again and let the AI judge.
    schedule(100);
  }
});
chrome.tabs.onUpdated.addListener((_tabId, info, tab) => {
  if (!tab || !tab.active) return;
  const newPage = info.url && info.url !== state.lastUrl; // address changed (also for in-page navigation)
  const loaded = info.status === "complete" && tab.url && tab.url !== state.lastUrl;
  if (newPage || loaded) {
    // You landed on a different page after our last instruction: treat the step as done.
    if (state.running && state.steps > 0) state.afterClick = true;
    schedule(newPage && !loaded ? 300 : 100);
  }
});
chrome.tabs.onActivated.addListener((info) => {
  if (info && info.tabId === state.lastTabId) return; // same tab as before: nothing to do
  schedule(100);
});

// The box always starts empty. (Older versions saved your last goal; clear that old copy.)
try {
  localStorage.removeItem(GOAL_KEY);
} catch (e) {
  /* fine without storage */
}
ui.goal.value = "";
