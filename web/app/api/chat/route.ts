import { sanitizeElements, sanitizeText } from "@/lib/sanitize";
import { extractJson, fail, json, preflight, rateLimited } from "@/lib/http";
import { AiError, askModel, pickProvider } from "@/lib/ai";
import { loadGuides } from "@/lib/guides";
import { describeElements, siteOf } from "@/lib/elements";
import { SITE_KEYS } from "@/lib/sites";

export const runtime = "nodejs";

type PlanStep = { title: string; detail: string };
type Plan = { title: string; steps: PlanStep[] };
type Reply = { reply: string; plan: Plan | null; prompt: string | null };

export function OPTIONS() {
  return preflight();
}

const RULES = `You are the friendly helper inside a browser side panel called Next Click. The user knows nothing about computers or technology. They can type anything to you. Always answer in the shortest, simplest words, like you are explaining to a 10-year-old. Be warm and calm.

You do two jobs.

1) ANSWER. If they ask a question ("what is GitHub?", "what does this button do?", "why do I need this?"), or want advice, answer it directly. Keep it to about 60 words unless they ask for detail. Use short numbered lines when you give steps. You may be given the page they are looking at (site, title, a list of elements one per line like: #12 button "Sign up" top right). Use it when the question is about the screen. If you do not know something for sure, say so plainly.

2) ROADMAP. When the user tells you a goal ("I want to build a website") or when their message changes the path ("use Claude instead", "skip GitHub", "also add my own domain"), give a ROADMAP: the whole path from ZERO to ONE, every stage needed, in order, with no gaps. Think about everything a complete beginner needs: the accounts to make, the tools to open, what to connect to what (for example GitHub), what to put online, how to check it works, and optional extras. Mark extras with "(optional)" at the end of the stage title. Use 4 to 9 stages. Each stage has a "title" (at most 6 words, starts with a verb) and a "detail" (at most 20 words, simple). The sites you can open for the user are: ${SITE_KEYS.join(", ")}. Use the guides below as the base for the stages. If no guide covers the goal, build the roadmap from what you know, and say in the reply that you are not 100% sure about the exact buttons.

Example, for "build a website": 1. Write down your idea. 2. Make an account on an app builder (Lovable). 3. Paste your message and get a first version. 4. Improve it by chatting. 5. Save it on GitHub. 6. Put it on the internet with Vercel. 7. Get your own web address (optional).

3) MESSAGE FOR THE ROBOT. The user can keep chatting back and forth and add details about what they want ("it is a sneaker brand", "make it dark", "add a shop page"). Whenever their message adds or changes what they want to make, also write "prompt": ONE complete, ready-to-paste message for an AI app builder (like Lovable) or chat AI (like Claude), built from the whole conversation, so they get the best result. Write it in first person ("Build me a website for..."), 60 to 180 words, with the idea, who it is for, the pages or parts, the look and feel, and what to do first. Do not invent facts they did not say; where something is missing, choose a sensible simple default. No passwords or keys. In "reply", explain in two or three simple sentences what this message is and where to paste it (for example: "I turned your idea into one message for the robot builder. Press Copy and paste it into the big box on Lovable. It will build your sneaker website."). If the message adds nothing about what they want to make (a plain question), use "prompt": null.

Answer with ONE JSON object and nothing else:
{"reply":"<your answer, or one or two warm sentences introducing the roadmap>","plan":null OR {"title":"<max 6 words>","steps":[{"title":"<max 6 words>","detail":"<max 20 words>"}]},"prompt":null OR "<the ready-to-paste message>"}

Rules:
- If "start" is true you MUST return a roadmap for the goal. Otherwise return "plan": null unless the message really changes the path or asks for the roadmap again.
- When you return a roadmap, the reply is one or two warm sentences, for example "Here is your path from zero to a live website. I will walk you through each step, one at a time."
- Never use these words: repository, repo, deploy, prompt, API, environment, framework, commit, authenticate, OAuth, terminal. Use simple words ("saving place", "put it on the internet", "message for the robot"). If a hard word is unavoidable, explain it in a few words in brackets.
- NEVER ask for a password, API key or token. Never repeat any secret you see. Do not write web addresses.
- You can only see websites in Chrome. If they ask about a desktop app, say so plainly and suggest the website version.`;

// Keeps line breaks (numbered lists) but removes anything odd, and limits the length.
function cleanMultiline(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
}

function parsePlan(raw: unknown): Plan | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  if (!Array.isArray(p.steps)) return null;
  const steps: PlanStep[] = [];
  for (const s of p.steps.slice(0, 10)) {
    if (!s || typeof s !== "object") continue;
    const t = sanitizeText((s as Record<string, unknown>).title, 70);
    if (!t) continue;
    steps.push({ title: t, detail: sanitizeText((s as Record<string, unknown>).detail, 160) });
  }
  if (steps.length < 3) return null;
  return { title: sanitizeText(p.title, 60) || "Your path", steps };
}

function parseReply(text: string): Reply | null {
  const raw = extractJson(text);
  if (!raw) return null;
  const reply = cleanMultiline(raw.reply, 900);
  const plan = parsePlan(raw.plan);
  const prompt = cleanMultiline(raw.prompt, 1600);
  if (!reply && !plan && !prompt) return null;
  return { reply: reply || "Here is your path.", plan, prompt: prompt.length >= 30 ? prompt : null };
}

// Test mode (MOCK_AI=1): fixed answers so the panel can be tried without an AI key.
function mockReply(message: string, start: boolean): Reply {
  if (start) {
    return {
      reply: "(test mode) Here is a sample path from zero to done. I will walk you through each step.",
      prompt: null,
      plan: {
        title: "Your path",
        steps: [
          { title: "Write down your idea", detail: "Say in a few words what you want to make." },
          { title: "Make an account", detail: "Sign up on the website we will use." },
          { title: "Make the first version", detail: "Paste your message and wait for the first picture." },
          { title: "Save it on GitHub", detail: "Connect it so your work is safe." },
          { title: "Put it on the internet", detail: "Use Vercel to get a web address." },
        ],
      },
    };
  }
  return { reply: `(test mode) You asked: "${message.slice(0, 120)}". The real AI will answer this in simple words.`, plan: null, prompt: /sneaker|shop|brand|website/i.test(message) ? "Build me a simple website for my idea. (test mode sample message)" : null };
}

// Remember roadmaps for the same goal for a while, so a repeat is instant and uses no quota.
const PLAN_CACHE_MS = 10 * 60 * 1000;
const plans = new Map<string, { at: number; reply: Reply }>();

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

  // Plain-code check first: an empty message never reaches the AI.
  const message = sanitizeText(body.message, 500);
  if (!message) {
    return fail("empty_message", "Type a message first, then press send.", 400);
  }

  const start = body.start === true;
  const goal = sanitizeText(body.goal, 300) || (start ? message : "");
  const site = siteOf(body.site);
  const title = sanitizeText(body.title, 150);
  const currentStep = sanitizeText(body.currentStep, 300); // the instruction on the user's screen right now
  const elements = sanitizeElements(body.elements).slice(0, 60);
  const currentPlan = Array.isArray(body.plan) ? body.plan.slice(0, 10).map((t) => sanitizeText(t, 80)).filter(Boolean) : [];
  const thread = Array.isArray(body.thread)
    ? body.thread
        .slice(-10)
        .map((m) => {
          const r = m && typeof m === "object" ? (m as Record<string, unknown>) : {};
          return { who: r.role === "user" ? "user" : "helper", text: sanitizeText(r.text, 400) };
        })
        .filter((m) => m.text)
    : [];

  if (process.env.MOCK_AI === "1") {
    return json(mockReply(message, start));
  }

  const provider = pickProvider();
  if (!provider) {
    return fail("no_key", "The server isn't set up with an AI key yet. Ask the app owner to add it.", 500);
  }

  const planKey = start ? `${goal.toLowerCase()}|${site}` : "";
  const hit = start ? plans.get(planKey) : undefined;
  if (hit && Date.now() - hit.at < PLAN_CACHE_MS) {
    console.log(`[chat] remembered roadmap for "${goal.slice(0, 60)}"`);
    return json(hit.reply);
  }

  const started = Date.now();
  try {
    const guides = loadGuides(goal || message, site);
    const text = await askModel(provider, {
      system: `${RULES}\n\n--- GUIDES ---\n${guides.text}`,
      user: JSON.stringify({
        message,
        start,
        goal: goal || undefined,
        currentRoadmap: currentPlan.length ? currentPlan.map((t, i) => `${i + 1}. ${t}`) : undefined,
        stepOnScreenNow: currentStep || undefined,
        conversation: thread.length ? thread : undefined,
        page: site ? { site, title, elements: describeElements(elements) } : undefined,
      }),
      maxTokens: 1400,
      strong: start, // the roadmap is the most important answer, so the stronger model goes first
    });
    const parsed = parseReply(text);
    console.log(`[chat] ${provider} ${Date.now() - started}ms start=${start} ok=${!!parsed} plan=${parsed?.plan ? parsed.plan.steps.length + " steps" : "no"}`);
    if (!parsed || (start && !parsed.plan)) {
      return fail("bad_ai_reply", "I got confused. Please send that again.", 502);
    }
    if (start && parsed.plan) plans.set(planKey, { at: Date.now(), reply: parsed });
    return json(parsed);
  } catch (err) {
    const kind = err instanceof AiError ? err.kind : "other";
    console.error(`[chat] ${provider} call failed (${kind})`, err instanceof Error ? err.message : err);
    if (kind === "key") return fail("bad_key", "The AI key isn't working. Ask the app owner to check it.", 500);
    if (kind === "busy") return fail("busy", "I'm a little busy right now. Please wait a minute and send that again.", 429);
    return fail("ai_failed", "I couldn't reach the AI just now. Wait a few seconds and try again.", 502);
  }
}
