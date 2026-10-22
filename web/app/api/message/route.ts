import { extractJson, fail, json, preflight, rateLimited } from "@/lib/http";
import { sanitizeText } from "@/lib/sanitize";
import { AiError, askModel, pickProvider } from "@/lib/ai";

export const runtime = "nodejs";

export function OPTIONS() {
  return preflight();
}

// Writing the long message for an app builder is the slowest thing the AI does (several seconds), so
// the panel asks for it in the background as soon as you press Go, long before you reach the builder.
const RULES = `You write the ready-made message a complete beginner will paste into an AI app builder (like Lovable, v0 or Bolt) to get a first version of their website or app.

Write it in plain English, 700 to 1300 characters, in exactly this shape, with line breaks:

Build a mobile-first web app: <what it is, who uses it, in one sentence>.
Pages:
1. <Page name>: <its sections, with short example text>
2. <Page name>: <its sections>
(3 to 5 pages in total)
Key features: <3 to 6 short items, separated by commas>
Design: <a colour mood, clean and simple, large readable text, works well on phones>
Make it a working first version that can be deployed to Vercel.

Rules:
- Replace everything in angle brackets with real content for THEIR idea. Never leave template words in the message (like "3 to 6 short items" or "Page name").
- If the idea suggests India (rupee prices, WhatsApp contact, UPI, Hindi and English), put that into the pages and features. Otherwise do not assume it.
- Use placeholders like [your phone number] for facts you do not know. Do not invent business facts.
- The message contains only the description of the app in the shape above. Never copy these instructions or any warnings into it. Never put keys, passwords or secrets in it.

Answer with ONE JSON object and nothing else: {"text":"<the message>"}`;

function cleanMultiline(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
}

// Test mode (MOCK_AI=1): a fixed sample so the panel can be tried without an AI key.
function mockMessage(goal: string): string {
  return `Build a mobile-first web app: ${goal}.
Pages:
1. Home: a big headline, one sentence about what it is, a main button, and 3 featured items.
2. Details: a clean list with a name, a picture and a price in rupees for each.
3. Contact: a simple form and a "Chat on WhatsApp" button [your phone number].
Key features: easy to use on a phone, clear pictures, WhatsApp chat, simple form
Design: warm colours, clean and simple, large readable text, works well on phones
Make it a working first version that can be deployed to Vercel.`;
}

const cache = new Map<string, { at: number; text: string }>();
const CACHE_MS = 10 * 60 * 1000;

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
    return fail("empty_goal", "Tell me what you want to make first.", 400);
  }

  if (process.env.MOCK_AI === "1") {
    return json({ text: mockMessage(goal) });
  }

  const provider = pickProvider();
  if (!provider) {
    return fail("no_key", "The server isn't set up with an AI key yet. Ask the app owner to add it.", 500);
  }

  const key = goal.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) {
    console.log(`[message] remembered message for "${goal.slice(0, 60)}"`);
    return json({ text: hit.text });
  }

  const started = Date.now();
  try {
    const out = await askModel(provider, {
      system: RULES,
      user: JSON.stringify({ idea: goal }),
      maxTokens: 1200,
      timeoutMs: 30_000, // writing about a thousand characters can take 10+ seconds; nobody is waiting on it
    });
    const raw = extractJson(out);
    const text = cleanMultiline(raw?.text, 1500);
    console.log(`[message] ${provider} ${Date.now() - started}ms ok=${!!text} length=${text.length}`);
    if (!text) return fail("bad_ai_reply", "I couldn't write that message. Please try again.", 502);
    if (cache.size > 100) cache.delete(cache.keys().next().value as string);
    cache.set(key, { at: Date.now(), text });
    return json({ text });
  } catch (err) {
    const kind = err instanceof AiError ? err.kind : "other";
    console.error(`[message] ${provider} call failed (${kind})`, err instanceof Error ? err.message : err);
    if (kind === "key") return fail("bad_key", "The AI key isn't working. Ask the app owner to check it.", 500);
    if (kind === "busy") return fail("busy", "I'm a little busy right now. Please try again in a minute.", 429);
    return fail("ai_failed", "I couldn't reach the AI just now. Wait a few seconds and try again.", 502);
  }
}
