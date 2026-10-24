// Runs inside the web page you are looking at. Two jobs:
//   1. "scan": list the buttons/links/fields on the page (text only, never passwords or keys)
//   2. "point": draw a highlight and a pointer on one of those elements
// It never clicks or types anything.
(() => {
  if (window.__nextClick) return; // already loaded on this page
  window.__nextClick = true;

  const registry = new Map(); // id -> real element on the page
  let overlay = null; // { host, box, pointer }
  let target = null;
  let raf = 0;
  let observer = null;
  let watchTimer = 0;
  let typingTimer = 0;
  let goneNotified = false; // we already told the panel that the thing we pointed at is gone
  let changeCount = 0; // how many parts of the page were added or removed in the latest burst
  let contentNotified = false; // we already told the panel about a big change for this arrow

  const SELECTOR = [
    "a[href]",
    "button",
    "input",
    "select",
    "textarea",
    "summary",
    "[role=button]",
    "[role=link]",
    "[role=menuitem]",
    "[role=tab]",
    "[role=checkbox]",
    "[role=option]",
    "[role=radio]",
    "[role=switch]",
    "[role=menuitemcheckbox]",
    "[role=menuitemradio]",
    // Modern sites (Lovable, Claude, ChatGPT, Notion...) build their message box as an editable area,
    // not as a plain text box. Without these, the main box on the page would be invisible to us.
    "[contenteditable]:not([contenteditable=false])",
    "[role=textbox]",
    "[role=searchbox]",
    "[role=combobox]",
  ].join(",");

  // True for any place you can type: a plain box, an editable area, or a custom text box.
  function isEditable(el) {
    const tag = el.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    const ce = el.getAttribute("contenteditable");
    if (ce !== null && ce !== "false") return true;
    return /^(textbox|searchbox|combobox)$/i.test(el.getAttribute("role") || "");
  }

  // Grey hint text inside editable areas (editors keep it in a data attribute, not in "placeholder").
  function editablePlaceholder(el) {
    const own = el.getAttribute("placeholder") || el.getAttribute("aria-placeholder") || el.getAttribute("data-placeholder");
    if (own) return own;
    const inner = el.querySelector ? el.querySelector("[data-placeholder],[aria-placeholder]") : null;
    return inner ? inner.getAttribute("data-placeholder") || inner.getAttribute("aria-placeholder") || "" : "";
  }

  const KEY_PATTERNS = [
    /sk-[A-Za-z0-9_-]{10,}/,
    /gh[pousr]_[A-Za-z0-9]{20,}/,
    /AKIA[0-9A-Z]{12,}/,
    /eyJ[A-Za-z0-9_-]{20,}/,
    /[A-Za-z0-9+/_-]{32,}/,
  ];
  const SECRET_FIELD_NAME = /pass(word|wd)?|secret|token|api[-_ ]?key|otp|one.?time/i;

  function looksSecret(s) {
    return KEY_PATTERNS.some((p) => p.test(s));
  }

  function clean(s, max) {
    const v = (s || "").replace(/\s+/g, " ").trim().slice(0, max);
    return looksSecret(v) ? "" : v;
  }

  function isSecretField(el) {
    if (el.tagName !== "INPUT" && el.tagName !== "TEXTAREA") {
      // An editable area or custom text box: skip it if it looks meant for a password, key or code.
      if (!isEditable(el)) return false;
      return SECRET_FIELD_NAME.test([el.id, el.getAttribute("aria-label"), el.getAttribute("name"), editablePlaceholder(el)].join(" "));
    }
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (type === "password" || type === "hidden") return true;
    const ac = (el.getAttribute("autocomplete") || "").toLowerCase();
    if (/password|one-time-code/.test(ac)) return true;
    const hint = [el.name, el.id, el.getAttribute("aria-label"), el.placeholder].join(" ");
    return SECRET_FIELD_NAME.test(hint);
  }

  function isVisible(el, rect) {
    if (rect.width < 4 || rect.height < 4) return false;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return false;
    if (el.disabled || el.getAttribute("aria-hidden") === "true") return false;
    return true;
  }

  function labelFor(el) {
    const aria = el.getAttribute("aria-label");
    if (aria) return aria;
    if (el.labels && el.labels[0]) return el.labels[0].innerText;
    const by = el.getAttribute("aria-labelledby");
    if (by) {
      const ref = document.getElementById(by.split(" ")[0]);
      if (ref) return ref.innerText;
    }
    return el.getAttribute("title") || el.getAttribute("alt") || "";
  }

  // Plain words for where something is, so the instruction can say "at the top right".
  function whereOnScreen(rect) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (rect.bottom < 0 || rect.top > vh) return "not on screen, scroll to find it";
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const col = cx < vw / 3 ? "left" : cx > (vw * 2) / 3 ? "right" : "center";
    const row = cy < vh / 3 ? "top" : cy > (vh * 2) / 3 ? "bottom" : "middle";
    return row === "middle" && col === "center" ? "middle of the screen" : `${row} ${col}`;
  }

  function scan() {
    registry.clear();
    const found = [];
    const vh = window.innerHeight;
    for (const el of document.querySelectorAll(SELECTOR)) {
      if (isSecretField(el)) continue;
      const rect = el.getBoundingClientRect();
      if (!isVisible(el, rect)) continue;
      // An editable area inside another editable thing is the same box: list it once.
      if (isEditable(el) && el.parentElement && el.parentElement.closest("[contenteditable]:not([contenteditable=false]),[role=textbox],[role=searchbox],[role=combobox]")) continue;
      const type = (el.getAttribute("type") || "").toLowerCase();
      // Anything you can type in is a "field": we never read what is typed in it (that is private).
      const isField = isEditable(el);
      let text = "";
      if (!isField) text = el.innerText;
      else if (type === "submit" || type === "button") text = el.value; // button label, not typed text
      found.push({
        el,
        inView: rect.bottom > 0 && rect.top < vh,
        info: {
          tag: el.tagName.toLowerCase(),
          text: clean(text, 80),
          label: clean(labelFor(el), 80),
          placeholder: clean(isField ? editablePlaceholder(el) : el.getAttribute("placeholder"), 80),
          type,
          where: whereOnScreen(rect),
        },
      });
    }
    // Things you can see right now come first, then the rest, capped so the request stays small.
    found.sort((a, b) => Number(b.inView) - Number(a.inView));
    const elements = [];
    found.slice(0, 150).forEach((f, i) => {
      const id = i + 1;
      registry.set(id, f.el);
      elements.push({ id, ...f.info });
    });
    return {
      url: location.href,
      title: clean(document.title, 150),
      elements,
    };
  }

  // ---------- pointer overlay ----------

  function ensureOverlay() {
    if (overlay) return overlay;
    const host = document.createElement("div");
    host.style.cssText =
      "position:fixed;inset:0;z-index:2147483647;pointer-events:none;margin:0;padding:0;border:0;";
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `
      <style>
        .box{position:fixed;border:3px solid #ff5c39;border-radius:12px;pointer-events:none;
             background:rgba(255,92,57,.08);animation:pulse 1.4s ease-in-out infinite}
        .ptr{position:fixed;left:0;top:0;pointer-events:none;transition:transform .5s cubic-bezier(.2,.8,.2,1)}
        .ptr svg{display:block;width:40px;height:40px;filter:drop-shadow(0 4px 6px rgba(0,0,0,.35));
                 animation:nudge 1s ease-in-out infinite}
        .tag{position:absolute;left:30px;top:30px;white-space:nowrap;padding:5px 12px;border-radius:999px;
             background:linear-gradient(135deg,#ff8a5b,#ff5c39);color:#fff;font:700 13px/1.2 system-ui,sans-serif;
             box-shadow:0 4px 12px rgba(255,92,57,.45)}
        @keyframes pulse{0%,100%{box-shadow:0 0 0 3px rgba(255,92,57,.35),0 0 18px rgba(255,92,57,.25)}
                         50%{box-shadow:0 0 0 9px rgba(255,92,57,.12),0 0 28px rgba(255,92,57,.35)}}
        @keyframes nudge{0%,100%{transform:translate(0,0)}50%{transform:translate(-5px,-5px)}}
        @media (prefers-reduced-motion:reduce){.box,.ptr svg{animation:none}}
      </style>
      <div class="box"></div>
      <div class="ptr">
        <svg viewBox="0 0 24 24"><path d="M3 2l7.5 19.5 3.2-8.3L22 10z" fill="#ff5c39" stroke="#fff" stroke-width="1.7" stroke-linejoin="round"/></svg>
        <span class="tag">Press here</span>
      </div>`;
    document.documentElement.appendChild(host);
    overlay = {
      host,
      box: root.querySelector(".box"),
      pointer: root.querySelector(".ptr"),
      placed: false,
    };
    return overlay;
  }

  function place() {
    if (!overlay || !target) return;
    if (!target.isConnected) {
      // The thing we pointed at is gone (a menu closed, the page changed). Hide the arrow at once
      // instead of leaving it stuck where the thing used to be, and tell the panel.
      overlay.host.style.display = "none";
      if (!goneNotified) {
        goneNotified = true;
        notify("page-changed");
      }
      return; // stop following; the panel will point again after it looks
    }
    const r = target.getBoundingClientRect();
    const pad = 5;
    const b = overlay.box.style;
    b.left = r.left - pad + "px";
    b.top = r.top - pad + "px";
    b.width = r.width + pad * 2 - 6 + "px"; // minus the 3px border on each side
    b.height = r.height + pad * 2 - 6 + "px";
    const px = r.left + Math.min(r.width * 0.6, r.width - 4);
    const py = r.top + Math.min(r.height * 0.6, r.height - 4);
    if (!overlay.placed) {
      // start from the middle of the screen so you can see the pointer travel
      overlay.pointer.style.transition = "none";
      overlay.pointer.style.transform = `translate(${innerWidth / 2}px, ${innerHeight / 2}px)`;
      void overlay.pointer.getBoundingClientRect();
      overlay.pointer.style.transition = "";
      overlay.placed = true;
    }
    overlay.pointer.style.transform = `translate(${px}px, ${py}px)`;
    raf = requestAnimationFrame(place);
  }

  function notify(kind) {
    try {
      chrome.runtime.sendMessage({ type: "nc-event", kind }).catch(() => {});
    } catch (e) {
      /* extension was reloaded; nothing to tell */
    }
  }

  // Only a press on the thing we pointed at counts as "you did it". A click anywhere else
  // (scrolling around, reading) does not move the guide forward.
  // We listen for the moment the mouse goes DOWN, not only for the finished click, because menus
  // often close the instant you press, so a "click" never arrives. The Enter and Space keys count too.
  const INTERACTIVE = "a,button,summary,label,input,textarea,select,[role=button],[role=link],[role=menuitem],[role=tab],[role=option],[contenteditable]";

  // "target": you pressed the thing we pointed at. "other": you pressed some other button or link
  // (you took your own path), so the page will change anyway and we should look again too.
  function pressKind(event) {
    if (!target || !event) return "";
    const hit = event.target;
    if (event.type === "keydown") {
      if (event.key !== "Enter" && event.key !== " ") return "";
      const active = document.activeElement;
      if (!active) return "";
      if (active === target || target.contains(active)) return "target";
      return event.key === "Enter" && !event.shiftKey && active.matches && active.matches(INTERACTIVE) ? "other" : "";
    }
    if (event.type === "submit") return hit && hit.contains && hit.contains(target) ? "target" : "other";
    if (!hit || hit.nodeType !== 1) return "";
    const clickable = hit.closest ? hit.closest("a,button,summary,label,[role=button],[role=link],[role=menuitem],[role=tab]") : null;
    if (target === hit || target.contains(hit) || (!!clickable && (clickable === target || clickable.contains(target)))) return "target";
    return hit.closest && hit.closest(INTERACTIVE) ? "other" : "";
  }

  function onUserAction(event) {
    const kind = pressKind(event);
    if (!kind) return;
    clear(); // take the old arrow away at once, so it never points at something that is gone
    // A very short pause lets the page start reacting before the panel looks again.
    setTimeout(() => notify(kind === "target" ? "user-acted" : "user-acted-other"), event.type === "pointerdown" ? 80 : 0);
  }

  // Typing or pasting into the box we pointed at counts as doing the step: the next one is "send it".
  // We only notice THAT something was typed, never what it says.
  function onTyping(event) {
    if (!target || !event.target || !(event.target === target || target.contains(event.target) || (event.target.contains && event.target.contains(target)))) return;
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
      if (!target) return;
      clear();
      notify("user-acted");
    }, 900);
  }

  const PRESS_EVENTS = ["pointerdown", "click", "submit", "keydown"];

  function watchTarget() {
    if (observer) observer.disconnect();
    changeCount = 0;
    contentNotified = false;
    observer = new MutationObserver((records) => {
      for (const r of records) changeCount += r.addedNodes.length + r.removedNodes.length;
      clearTimeout(watchTimer);
      watchTimer = setTimeout(() => {
        if (target && !target.isConnected && !goneNotified) {
          goneNotified = true;
          notify("page-changed");
        } else if (target && changeCount >= 40 && !contentNotified) {
          // A big change settled and our target is still here: tell the panel once, so a step that
          // changed the page without us seeing the press (inside a frame, say) is not left stale.
          contentNotified = true;
          notify("content-changed");
        }
        changeCount = 0;
      }, 250);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function clear() {
    cancelAnimationFrame(raf);
    if (observer) observer.disconnect();
    observer = null;
    clearTimeout(watchTimer);
    if (overlay) overlay.host.remove();
    overlay = null;
    target = null;
    clearTimeout(typingTimer);
    PRESS_EVENTS.forEach((name) => document.removeEventListener(name, onUserAction, true));
    document.removeEventListener("input", onTyping, true);
  }

  function point(id) {
    clear();
    const el = registry.get(id);
    if (!el || !el.isConnected) return { ok: false };
    target = el;
    goneNotified = false;
    el.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    ensureOverlay();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(place);
    PRESS_EVENTS.forEach((name) => document.addEventListener(name, onUserAction, true));
    document.addEventListener("input", onTyping, true);
    watchTarget();
    return { ok: true };
  }

  // Pages often keep drawing for a moment after they "finish" loading. Instead of waiting a fixed
  // time, wait until the page has been still for a short while (never longer than maxMs).
  function waitForQuiet(quietMs = 140, maxMs = 900) {
    return new Promise((resolve) => {
      let finished = false;
      let quietTimer = 0;
      const observer = new MutationObserver(() => {
        clearTimeout(quietTimer);
        quietTimer = setTimeout(done, quietMs);
      });
      const hardStop = setTimeout(done, maxMs);
      function done() {
        if (finished) return;
        finished = true;
        clearTimeout(quietTimer);
        clearTimeout(hardStop);
        observer.disconnect();
        resolve();
      }
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
      quietTimer = setTimeout(done, quietMs);
    });
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg.type !== "string") return;
    if (msg.type === "nc-scan") {
      waitForQuiet().then(() => sendResponse(scan()));
      return true; // tells Chrome the answer will come a moment later
    } else if (msg.type === "nc-point") sendResponse(point(msg.id));
    else if (msg.type === "nc-clear") {
      clear();
      sendResponse({ ok: true });
    }
  });
})();
