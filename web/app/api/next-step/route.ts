import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sanitizeElements, sanitizeText, type PageElement } from "@/lib/sanitize";
import { extractJson, fail, json, preflight, rateLimited } from "@/lib/http";
import { isSiteKey, SITE_KEYS, SITES, type SiteKey } from "@/lib/sites";
import { AiError, askModel, pickProvider } from "@/lib/ai";

export const runtime = "nodejs";

type Reply = {
  status: "continue" | "done" | "stuck";
  instruction: string;
  note: string | null;
  elementId: number | null;
  copyText: string | null;
  open: { label: string; url: string } | null;
  verified: boolean;
};

export function OPTIONS() {
  return preflight();
}

// Every file in lib/guides/ is one tool's guide. Add a file there to teach the AI a new tool.
// To keep the AI fast we only give it the guide(s) that fit the goal or the website. A guide with no
// entry below is always included. If nothing fits, the AI gets all of them and decides itself.
const GUIDE_MATCH: Record<string, { goal: RegExp; site: RegExp }> = {
  "app-launch.md": {
    goal: /\bapps?\b|website|web ?site|web ?page|landing page|deploy|launch|host|online|internet|vercel|github|lovable|\bv0\b|bolt/i,
    site: /lovable|v0\.|bolt\.new|github|vercel/i,
  },
  "canva.md": { goal: /canva|poster|flyer|logo|instagram (post|story|poster|reel)|social media post|slides?|presentation|greeting card|invitation/i, site: /canva/i },
  "sheets.md": { goal: /sheets?|spreadsheet|budget|excel|tracker|formula|table/i, site: /docs\.google\.com\/spreadsheets|sheets/i },
  "automation.md": {
    goal: /automat|\bzap(s|ier)?\b|workflow|integrat|trigger|n8n|make\.com|when .+ then|every time|save .+ (to|in) /i,
    site: /zapier|make\.com|n8n/i,
  },
};

// Returns the guide text, and whether any guide really fit. When none fits we still help, but the
// answer is labelled "I'm not 100% sure".
function loadGuides(goal: string, site: string): { text: string; fit: boolean } {
  const dir = join(process.cwd(), "lib", "guides");
  const files = readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
  const fits = files.filter((f) => {
    const m = GUIDE_MATCH[f];
    return !m || m.goal.test(goal) || m.site.test(site);
  });
  const chosen = fits.length > 0 ? fits : files;
  return { text: chosen.map((f) => readFileSync(join(dir, f), "utf8").trim()).join("\n\n=====\n\n"), fit: fits.length > 0 };
}

const RULES = `You are a calm guide inside a browser side panel. The user knows nothing about computers. They type what they want to do ("goal"): for example make a website, make a poster in Canva, or make a budget in Google Sheets. You can see a list of elements on the page they are looking at, one per line, like: #26 button "Fork 0" top right. The number after # is the elementId; then the kind, the words written on it, and where it is on screen. "(no words on it)" means an icon-only button. You can only POINT at one element; you never click or type for them.

Help with ANY goal. Below you are given short written guides for some tools. If one fits the goal, follow it. If none fits, still help using what you can see on the page and what you know about how websites work, and set verified to false. Do not refuse a goal just because there is no guide for it. Only if the goal is truly unclear, set status "stuck" and ask in one simple sentence that they press "Change" and say it again with more details.

Work out where they are from the page (site, title, elements) and your previous instructions. If the goal is only part of a longer job, do only that part.

You keep guiding them step after step until the goal is done. When "afterClick" is true, the user has just pressed the thing you pointed at, so your previous instruction is DONE: give the NEXT step. Never repeat your previous instruction word for word, and never tell them to press something that is no longer on the page. Read the page title and the elements: if the page already shows the result of your last step (for example a "New Project" page after you said to press "Project"), move on to what comes next. If the page looks exactly the same as before, say in the note that nothing seems to have changed, and point at the same thing again. When "afterClick" is false you are looking at the page for the first time or it changed on its own: give the step that fits what you see now.

Answer with ONE JSON object and nothing else:
{"status":"continue"|"done"|"stuck","instruction":"<MAX 15 words: the action and where it is>","note":"<MAX 20 words: why, or what will happen next, or null>","elementId":<number from the list or null>,"copyText":"<text to paste or null>","open":${SITE_KEYS.map((k) => `"${k}"`).join("|")}|null,"verified":true|false}

How to talk (most important):
- Imagine the user is a 3-year-old who knows nothing about computers. Use the shortest, simplest words. Be warm and calm.
- ONE tiny action per message, written as a short command with where it is, at most 15 words. Good: "Press 'Add New', at the top in the middle." Bad (too long): "Press the button that says 'Add New' near the top in the middle of the screen to start putting your project on the internet." The reason or what happens next goes in "note", never in "instruction".
- Say exactly what to look for: quote the words written on it, and say where it is using the element's "where" (for example "at the top right" or "in the middle at the bottom"). Prefer elements that are on screen.
- If lost is true, say in one simple sentence what is on the screen, tell them it is okay, then give one tiny next action.
- Never use these words: repository, repo, deploy, prompt, API, environment, framework, commit, authenticate, OAuth, build log, terminal. Use simple words instead ("saving place", "put it on the internet", "message for the robot"). If a hard word is unavoidable, explain it in a few words in brackets.
- "note" is optional and short, for example "This starts your project. A new page may open, and that is normal."
- When the user meets a new part of an app for the first time (a menu, a tab, a setting), say in the note, in a few words, what it is for. This is how they learn to use the app.

Opening websites:
- If the user is not on the right website for the next step (or the page list is empty because it can't be read), and the right website is one of these names: ${SITE_KEYS.join(", ")}, set "open" to that name and elementId to null, and say in the instruction which site you are opening and why, in one simple sentence. The panel shows an Open button; never write web addresses yourself.
- If the right website is not in that list, set "open" to null and say its name in the instruction so they can open it themselves.
- Pick the app builder like this: "lovable" for apps with sign-in, saved data, bookings, orders or several pages (the default); "v0" for a simple one-page site; "bolt" only if the others clearly don't fit. Keep the same builder for the whole job.

Text the user must paste:
- Set copyText only when the user must paste something specific (a message for an app builder, a spreadsheet formula, a setting). Always tell them the order in one short sentence: first press Copy (in the panel), then click the place, then paste.
- When the goal is making a website or app and the user is at the builder's big message box without having sent a message yet, copyText is a ready-made message for the builder: plain English, under 1500 characters, detailed enough that the first version looks complete. Include what the app is for and who uses it; each page by name with its sections and short example text; 3 to 6 key features; a colour mood and a clean, simple, mobile-first design; a working first version built as a web app that can be deployed to Vercel. If the goal suggests India (rupee prices, WhatsApp contact, UPI, Hindi and English) include that; otherwise don't assume it. Never include keys, passwords or secrets. Use placeholders like [your phone number] for facts you do not know.
- Otherwise copyText is null.

Beginners and desktop apps:
- The user is new to everything. If they have no account on a website yet, prefer "Sign up", "Get started" or "Continue with Google" over "Log in". Only say "Log in" if they told you they already have an account.
- You can only see websites in Chrome. If the goal needs an app installed on the computer (for example Claude Desktop, Excel, Word, VS Code), say that plainly in one simple sentence, say you cannot see inside it, and suggest the website version (for example Claude on claude.ai, Excel or Word on the web, Google Docs) and open it if it is in the list. Set verified to false.
- If the right website is not in the list of sites you can open, put its name in the instruction so they can open it themselves.

Rules:
- Give exactly one next action.
- elementId MUST be a number that appears in the list. If nothing fits, use null and say in the instruction what to look for on the page. Things drawn inside a page's own canvas (a spreadsheet cell, text inside a design) are not in the list: describe where they are in simple words and use null.
- If a guide covers the step, follow it. If not, set verified to false.
- status "done" only when the whole goal is finished on screen. status "stuck" if you cannot tell what to do; explain what you see and what to try.
- NEVER ask the user for a password, API key, or token. If a step needs one, tell them to type it themselves. Never repeat any secret you see.
- Trust the page over the guides if they disagree.`;

function parseReply(text: string, elements: PageElement[]): Reply | null {
  const raw = extractJson(text);
  if (!raw) return null;
  const status = raw.status === "done" || raw.status === "stuck" ? raw.status : "continue";
  const instruction = sanitizeText(raw.instruction, 300);
  if (!instruction) return null;
  const id = typeof raw.elementId === "number" ? raw.elementId : null;
  const elementId = id !== null && elements.some((e) => e.id === id) ? id : null;
  const copyText =
    typeof raw.copyText === "string" && raw.copyText.trim() ? raw.copyText.trim().slice(0, 1500) : null;
  const note = sanitizeText(raw.note, 160) || null;
  const open = isSiteKey(raw.open) ? SITES[raw.open as SiteKey] : null;
  return { status, instruction, note, elementId, copyText, open, verified: raw.verified !== false };
}

// Test mode (MOCK_AI=1): fixed answers so the panel can be tried without an AI key.
function mockReply(goal: string, elements: PageElement[], site: string): Reply {
  const want: SiteKey = /canva|poster|flyer|logo/i.test(goal) ? "canva" : /sheet|budget|spreadsheet/i.test(goal) ? "sheets" : "lovable";
  const onRightSite = (s: string) => s.includes(want === "sheets" ? "docs.google" : want === "lovable" ? "lovable" : want);
  if (!site || !onRightSite(site)) {
    return {
      status: "continue",
      instruction: `(test mode) First, let's open ${SITES[want].label}.`,
      note: null,
      elementId: null,
      copyText: null,
      open: SITES[want],
      verified: false,
    };
  }
  const first = elements.find((e) => e.text || e.label || e.placeholder);
  const kind = first && ["input", "textarea", "select"].includes(first.tag) ? "box" : "button";
  return {
    status: "continue",
    instruction: first
      ? `(test mode) Look at the "${first.text || first.label || first.placeholder}" ${kind}.`
      : "(test mode) I can't see a button on this page.",
    note: "(test mode) The real AI will choose the right thing. This only shows how it looks.",
    elementId: first ? first.id : null,
    copyText: `(test mode sample) Something the real AI would write for you to paste: ${goal}`,
    open: null,
    verified: false,
  };
}

// Remember recent answers. The same goal on the same page with the same buttons gets the same
// answer, so repeats (a retry, a second demo run) come back instantly and use no AI quota.
// Kept only in the server's memory for 10 minutes; "I'm lost" always asks again.
const CACHE_MS = 10 * 60 * 1000;
const CACHE_MAX = 200;
const answers = new Map<string, { at: number; reply: Reply }>();

function cacheKey(parts: string[]): string {
  return createHash("sha1").update(parts.join("\u0001")).digest("hex");
}

function remember(key: string, reply: Reply) {
  if (answers.size >= CACHE_MAX) answers.delete(answers.keys().next().value as string);
  answers.set(key, { at: Date.now(), reply });
}

// One short line per element is much smaller than JSON, so the AI answers faster.
// Example: #26 button "Fork 0" top right
function describeElements(elements: PageElement[]): string[] {
  return elements.map((e) => {
    const words = [...new Set([e.text, e.label, e.placeholder].filter(Boolean))].join(" / ");
    const kind = e.tag + (e.type && e.type !== e.tag ? `(${e.type})` : "");
    return `#${e.id} ${kind} ${words ? `"${words}"` : "(no words on it)"}${e.where ? ` ${e.where}` : ""}`;
  });
}

// Only the website name is used, never the full address, because addresses can hold private tokens.
function siteOf(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  try {
    return new URL(value).hostname.toLowerCase().slice(0, 100);
  } catch {
    return /^[a-z0-9.-]{1,100}$/i.test(value) ? value.toLowerCase() : "";
  }
}

export async function POST(req: Request) {
  if (rateLimited(req)) {
    return fail("rate_limited", "Too many requests. Wait a minute and try again.", 429);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail("bad_request", "I couldn't read that request. Please try again.", 400);
  }

  // Plain-code check first: an empty goal never reaches the AI.
  const goal = sanitizeText(body.goal, 300);
  if (!goal) {
    return fail("empty_goal", "Tell me what you want to do first, then press the button.", 400);
  }

  const elements = sanitizeElements(body.elements);
  const site = siteOf(body.site);
  const title = sanitizeText(body.title, 150);
  const lost = body.lost === true;
  const afterClick = body.afterClick === true; // the user just pressed what we pointed at
  const history = Array.isArray(body.history)
    ? body.history.slice(-3).map((h) => sanitizeText(h, 200)).filter(Boolean)
    : [];

  // A page that loaded but shows nothing to press yet: ask the user to wait.
  // (When the panel could not read the page at all, site is empty and the guide opens a website instead.)
  if (elements.length === 0 && site) {
    return json({
      status: "stuck",
      instruction: "I can't see anything to press on this page yet. Please wait a few seconds for the page to finish opening, then press \"I'm lost\".",
      note: null,
      elementId: null,
      copyText: null,
      open: null,
      verified: true,
    } satisfies Reply);
  }

  if (process.env.MOCK_AI === "1") {
    return json(mockReply(goal, elements, site));
  }

  const provider = pickProvider();
  if (!provider) {
    return fail("no_key", "The server isn't set up with an AI key yet. Ask the app owner to add it.", 500);
  }

  const lines = describeElements(elements);
  const key = cacheKey([goal, site, title, afterClick ? "after-click" : "first-look", history.join("|"), ...lines]);
  const hit = lost ? undefined : answers.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) {
    console.log(`[next-step] remembered answer site=${site || "(unreadable)"} -> "${hit.reply.instruction.slice(0, 100)}"`);
    return json(hit.reply);
  }

  const started = Date.now();
  try {
    const guides = loadGuides(goal, site);
    const text = await askModel(provider, {
      system: `${RULES}\n\n--- GUIDES ---\n${guides.text}`,
      user: JSON.stringify({
        goal,
        lost,
        afterClick,
        page: site ? { site, title } : { site: "(the page could not be read, or it is a blank tab)", title: "" },
        previousInstructions: history,
        elements: lines,
      }),
      maxTokens: 1000,
    });
    const reply = parseReply(text, elements);
    // No guide covers this goal: the AI is going from general knowledge, so say so, whatever it claimed.
    if (reply && !guides.fit) reply.verified = false;
    if (reply && !lost && reply.status !== "stuck") remember(key, reply);
    console.log(
      `[next-step] ${provider} ${Date.now() - started}ms site=${site || "(unreadable)"} elements=${elements.length} ok=${!!reply}` +
        (reply
          ? ` afterClick=${afterClick} -> element=${reply.elementId}${(() => {
              const e = elements.find((x) => x.id === reply.elementId);
              return e ? ` ("${(e.text || e.label || e.placeholder || "no words").slice(0, 40)}", ${e.where})` : "";
            })()} open=${reply.open ? reply.open.label : "-"} "${reply.instruction.slice(0, 140)}"`
          : "")
    );
    if (!reply) {
      return fail("bad_ai_reply", "I got confused reading this page. Please press the button again.", 502);
    }
    return json(reply);
  } catch (err) {
    const kind = err instanceof AiError ? err.kind : "other";
    console.error(`[next-step] ${provider} call failed (${kind})`, err instanceof Error ? err.message : err);
    if (kind === "key") {
      return fail("bad_key", "The AI key isn't working. Ask the app owner to check it.", 500);
    }
    if (kind === "busy") {
      return fail("busy", "I'm a little busy right now. Please wait a minute and press \"Try again\".", 429);
    }
    return fail("ai_failed", "I couldn't reach the AI just now. Wait a few seconds and try again.", 502);
  }
}
