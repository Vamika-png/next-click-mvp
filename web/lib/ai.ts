// The only file that talks to an AI service. Two choices, picked in web/.env.local:
//   Gemini (Google): GEMINI_API_KEY
//   Claude (Anthropic): ANTHROPIC_API_KEY
// AI_PROVIDER=gemini or AI_PROVIDER=claude forces one. If it is not set, Gemini is used when a
// Gemini key exists, otherwise Claude. Keys are read only here, on the server.

import Anthropic from "@anthropic-ai/sdk";

export type Provider = "gemini" | "claude";

// Model names come from Google's and Anthropic's docs. Change GEMINI_MODEL in .env.local if
// Google renames one or if you hit the free limits (a "flash-lite" model is cheaper and faster).
const DEFAULT_GEMINI_MODEL = "gemini-3.6-flash";
const CLAUDE_MODEL = "claude-haiku-5-5";
const FALLBACK_GEMINI_MODEL = "gemini-3.5-flash-lite";
const GEMINI_TIMEOUT_MS = 10_000;

export type AiFailure = "key" | "busy" | "other";

export class AiError extends Error {
  constructor(public kind: AiFailure, message: string, public retryable = false) {
    super(message);
  }
}

export function pickProvider(): Provider | null {
  const want = (process.env.AI_PROVIDER || "").toLowerCase();
  const gemini = !!process.env.GEMINI_API_KEY;
  const claude = !!process.env.ANTHROPIC_API_KEY;
  if (want === "gemini") return gemini ? "gemini" : null;
  if (want === "claude") return claude ? "claude" : null;
  if (gemini) return "gemini";
  if (claude) return "claude";
  return null;
}

type Ask = { system: string; user: string; maxTokens: number };

// Google sometimes answers "high demand" (503) for a few seconds. When that happens we try again,
// switching to the lighter model on the second try, before giving up with a friendly message.
async function askGemini(ask: Ask): Promise<string> {
  const primary = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const tries = [primary, FALLBACK_GEMINI_MODEL]; // at most about 21 seconds in the worst case
  let lastError: AiError | null = null;
  for (let i = 0; i < tries.length; i++) {
    try {
      try {
        return await callGemini(tries[i], ask);
      } catch (err) {
        // If a model does not accept the thinking setting, ask it once more without it.
        if (err instanceof AiError && err.kind === "other" && /think/i.test(err.message)) {
          return await callGemini(tries[i], ask, false);
        }
        throw err;
      }
    } catch (err) {
      if (!(err instanceof AiError) || err.kind === "key") throw err;
      lastError = err;
      if (!err.retryable) throw err;
      if (i < tries.length - 1) await new Promise((r) => setTimeout(r, 700 * (i + 1)));
    }
  }
  throw lastError ?? new AiError("other", "Gemini failed.");
}

// "minimal" thinking answers in about 1.5 seconds instead of about 10, and our task (pick one
// button, write a short sentence) does not need long thinking. Set GEMINI_THINKING=default to
// turn this off, or low / medium / high to think more.
function thinkingConfig(): { thinkingLevel: string } | undefined {
  const level = (process.env.GEMINI_THINKING || "minimal").toLowerCase();
  return level === "default" ? undefined : { thinkingLevel: level };
}

async function callGemini(model: string, { system, user, maxTokens }: Ask, withThinking = true): Promise<string> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": process.env.GEMINI_API_KEY as string, // header, so the key never ends up in a web address or a log
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      // Room for the model's own thinking plus our JSON answer, so the answer is not cut off.
      generationConfig: {
        responseMimeType: "application/json",
        maxOutputTokens: Math.max(maxTokens, 2048),
        ...(withThinking && thinkingConfig() ? { thinkingConfig: thinkingConfig() } : {}),
      },
    }),
    signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
  }).catch((err) => {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new AiError("other", timedOut ? "Gemini took too long." : "Could not reach Gemini.", true);
  });

  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = String(body?.error?.message ?? "").slice(0, 200);
    } catch {
      /* no body */
    }
    if (res.status === 429) throw new AiError("busy", `Gemini is busy (429). ${detail}`, true);
    if (res.status === 503 || res.status === 500 || res.status === 502 || res.status === 504) {
      throw new AiError("busy", `Gemini is overloaded (${res.status}). ${detail}`, true);
    }
    if (res.status === 400 && /api key/i.test(detail)) throw new AiError("key", `Gemini key problem: ${detail}`);
    if (res.status === 401 || res.status === 403) throw new AiError("key", `Gemini key problem (${res.status}): ${detail}`);
    // 404 usually means the model name is wrong; the next try uses the other model.
    throw new AiError("other", `Gemini error ${res.status}: ${detail}`, res.status === 404);
  }

  const data = await res.json();
  const parts: unknown[] = data?.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((p) => (p && typeof (p as { text?: unknown }).text === "string" ? (p as { text: string }).text : "")).join("");
  if (!text) {
    const why = data?.promptFeedback?.blockReason || data?.candidates?.[0]?.finishReason || "empty";
    throw new AiError("other", `Gemini gave no text (${why}).`);
  }
  return text;
}

async function askClaude({ system, user, maxTokens }: Ask): Promise<string> {
  try {
    const client = new Anthropic();
    const msg = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    });
    return msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 429) throw new AiError("busy", "Claude is busy (429).");
    if (status === 401 || status === 403) throw new AiError("key", `Claude key problem (${status}).`);
    throw new AiError("other", err instanceof Error ? err.message : "Claude call failed.");
  }
}

export async function askModel(provider: Provider, ask: Ask): Promise<string> {
  try {
    return provider === "gemini" ? await askGemini(ask) : await askClaude(ask);
  } catch (err) {
    if (err instanceof AiError) throw err;
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new AiError("other", timedOut ? "The AI took too long." : err instanceof Error ? err.message : "AI call failed.");
  }
}
