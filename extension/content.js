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
  ].join(",");

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
    if (el.tagName !== "INPUT" && el.tagName !== "TEXTAREA") return false;
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
      const type = (el.getAttribute("type") || "").toLowerCase();
      const isField = el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
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
          placeholder: clean(el.getAttribute("placeholder"), 80),
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
        .box{position:fixed;border:3px solid #ff5a1f;border-radius:8px;box-shadow:0 0 0 4px rgba(255,90,31,.25);
             animation:pulse 1.2s ease-in-out infinite;pointer-events:none}
        .ptr{position:fixed;left:0;top:0;width:34px;height:34px;pointer-events:none;
             transition:transform .45s cubic-bezier(.2,.8,.2,1);filter:drop-shadow(0 2px 3px rgba(0,0,0,.4))}
        @keyframes pulse{0%,100%{box-shadow:0 0 0 3px rgba(255,90,31,.35)}50%{box-shadow:0 0 0 9px rgba(255,90,31,.1)}}
      </style>
      <div class="box"></div>
      <svg class="ptr" viewBox="0 0 24 24"><path d="M3 2l7 19 3-8 8-3z" fill="#ff5a1f" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
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
      raf = requestAnimationFrame(place);
      return;
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

  function onUserAction() {
    clear(); // take the old arrow away at once, so it never points at something that is gone
    notify("user-acted");
  }

  function watchTarget() {
    if (observer) observer.disconnect();
    observer = new MutationObserver(() => {
      clearTimeout(watchTimer);
      watchTimer = setTimeout(() => {
        if (target && !target.isConnected) notify("page-changed");
      }, 1200);
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
    document.removeEventListener("click", onUserAction, true);
    document.removeEventListener("submit", onUserAction, true);
  }

  function point(id) {
    clear();
    const el = registry.get(id);
    if (!el || !el.isConnected) return { ok: false };
    target = el;
    el.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    ensureOverlay();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(place);
    document.addEventListener("click", onUserAction, true);
    document.addEventListener("submit", onUserAction, true);
    watchTarget();
    return { ok: true };
  }

  // Pages often keep drawing for a moment after they "finish" loading. Instead of waiting a fixed
  // time, wait until the page has been still for a short while (never longer than maxMs).
  function waitForQuiet(quietMs = 350, maxMs = 2500) {
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
