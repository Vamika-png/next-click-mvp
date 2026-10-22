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
  change: $("change"),
  now: $("now"),
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

function rememberGoal(goal) {
  try {
    localStorage.setItem(GOAL_KEY, goal);
  } catch (e) {
    /* fine without storage */
  }
}

function recallGoal() {
  try {
    return localStorage.getItem(GOAL_KEY) || "";
  } catch (e) {
    return "";
  }
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

function showNow({ text, note, primary, copyText, problem }) {
  ui.now.hidden = false;
  ui.now.classList.toggle("problem", !!problem);
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
  schedule(2500);
}

// Reads the current tab. A blank tab or a page we may not read is not an error:
// the server just hears "nothing to see" and tells us which website to open.
async function readPage(tab) {
  const nothing = { site: "", title: "", elements: [] };
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
    return { site, title: scan.title, elements: scan.elements };
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
  state.lostNext = false;
  state.busy = true;
  state.pending = false;
  try {
    setStatus("Looking at your page…");
    const tab = await activeTab();
    if (tab && tab.status === "loading" && state.loadWaits < MAX_LOAD_WAITS) {
      state.loadWaits += 1;
      setStatus("Waiting for the page to open…");
      schedule(1000);
      return;
    }

    const page = await readPage(tab);
    setStatus("Thinking…");
    const reply = await ask({
      goal: state.goal,
      lost,
      site: page.site,
      title: page.title,
      elements: page.elements,
      history: state.history.slice(-3),
    });
    if (runId !== state.runId || !state.running) return; // you moved on meanwhile
    if (!validReply(reply)) throw new Error("I got mixed up. Please press \"Try again\".");

    // Same instruction again and again means the page didn't change after your click.
    const key = reply.instruction + "|" + reply.elementId;
    state.repeats = key === state.lastKey ? state.repeats + 1 : 0;
    state.lastKey = key;
    state.steps += 1;
    state.history.push(reply.instruction);

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
      setStatus("Nothing changed on the page. Try what I said, then press \"I'm lost\" if you need me.");
    } else if (reply.open) {
      setStatus("");
    } else {
      setStatus(pointed ? "Press where the orange arrow points. I will look again by myself." : "I will look again by myself when the page changes.");
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
  rememberGoal(goal);
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

// The page tells us when you pressed something or when the thing we pointed at disappeared.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "nc-event") schedule(msg.kind === "user-acted" ? 1500 : 600);
});
chrome.tabs.onUpdated.addListener((_tabId, info, tab) => {
  if (info.status === "complete" && tab.active) schedule(1500);
});
chrome.tabs.onActivated.addListener(() => schedule(800));

ui.goal.value = recallGoal();
