// The side panel: one box, one button, one card.
//   You type what you want. The panel looks at your page, asks the helper server what to do
//   next, shows ONE instruction in very simple words, and points at the right thing.
//   When the page changes it looks again by itself. It never clicks or types for you.

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
};

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

function showNow({ text, note, primary, copyText, problem, label, loading }) {
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
    ui.copyText.textContent = copyText;
    ui.copyBtn.textContent = "Copy";
    ui.copyBox.hidden = false;
  } else {
    ui.copyBox.hidden = true;
  }
  ui.hear.hidden = !canSpeak || !text;
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
  ui.doneList.hidden = before.length === 0;
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

async function ask(payload) {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(API_BASE + "/api/next-step", {
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
    setStatus("Thinking…");
    const reply = await ask({
      goal: state.goal,
      lost,
      afterClick,
      site: page.site,
      title: page.title,
      elements: page.elements,
      history: state.history.slice(-3),
    });
    if (runId !== state.runId || !state.running) return; // you moved on meanwhile
    if (!validReply(reply)) throw new Error("I got mixed up. Please press \"Try again\".");

    const key = reply.instruction + "|" + reply.elementId;
    const same = key === state.lastKey;

    // We looked again by ourselves (not after your click) and nothing new came back:
    // leave the card and the arrow exactly as they are. Do not count it, do not flicker.
    if (same && !afterClick && !lost && reply.status === "continue") {
      setStatus(state.lastStatus || "");
      return;
    }

    // Only a repeat right AFTER your click means "the page didn't change".
    state.repeats = same && afterClick ? state.repeats + 1 : 0;
    state.lastKey = key;
    state.steps += 1;
    state.history.push(reply.instruction);
    renderDone();

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
    showNow({
      label: `Step ${state.steps}`,
      text: reply.instruction,
      note,
      copyText: reply.copyText,
      primary: reply.open ? { label: `Open ${reply.open.label}`, onClick: () => openSite(reply.open) } : null,
    });

    if (reply.status === "stuck") {
      state.running = false;
      setStatus("");
    } else if (state.steps >= MAX_STEPS) {
      state.running = false;
      setStatus("We have done a lot of steps. I will wait here. Press \"I'm lost\" when you want me again.");
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

function go() {
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
  setStatus("");
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
