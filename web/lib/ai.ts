// The only file that talks to an AI service. Two choices, picked in web/.env.local:
//   Gemini (Google): GEMINI_API_KEY
//   Claude (Anthropic): ANTHROPIC_API_KEY
// AI_PROVIDER=gemini or AI_PROVIDER=claude forces one. If it is not set, Gemini is used when a
// Gemini key exists, otherwise Claude. Keys are read only here, on the server.
//
// Speed: Gemini's light model answers in about 1.5 seconds, so it goes first. If it has not answered
// after HEDGE_MS, the stronger model is started at the same time and whichever answers first wins.
// If one fails, the other is used at once. Each model also has its own free allowance.

import Anthropic from "@anthropic-ai/sdk";

export type Provider = "gemini" | "claude";

// Model names come from Google's and Anthropic's docs. Change GEMINI_MODEL (the fast one) or
// GEMINI_STRONG_MODEL (the stronger one) in .env.local if Google renames one.
const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite"; // fast: used for almost every step
const DEFAULT_GEMINI_STRONG = "gemini-3.6-flash"; // stronger: first choice when ask.strong is true (long messages)
const STRONG_HEDGE_MS = 4_000;
const CLAUDE_MODEL = "claude-haiku-5-5";
const GEMINI_TIMEOUT_MS = 10_000;
const HEDGE_MS = 2_500;

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

// strong: true asks for the stronger model first (used where the AI writes a long message).
type Ask = { system: string; user: string; maxTokens: number; strong?: boolean };

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
    throw new AiError("other", timedOut ? `${model} took too long.` : `Could not reach ${model}.`, true);
  });

  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = String(body?.error?.message ?? "").slice(0, 200);
    } catch {
      /* no body */
    }
    if (res.status === 429) throw new AiError("busy", `${model} is out of free requests for now (429). ${detail}`, true);
    if (res.status === 503 || res.status === 500 || res.status === 502 || res.status === 504) {
      throw new AiError("busy", `${model} is overloaded (${res.status}). ${detail}`, true);
    }
    if (res.status === 400 && /api key/i.test(detail)) throw new AiError("key", `Gemini key problem: ${detail}`);
    if (res.status === 401 || res.status === 403) throw new AiError("key", `Gemini key problem (${res.status}): ${detail}`);
    // 404 usually means the model name is wrong; the other model is tried.
    throw new AiError("other", `${model} error ${res.status}: ${detail}`, true);
  }

  const data = await res.json();
  const parts: unknown[] = data?.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((p) => (p && typeof (p as { text?: unknown }).text === "string" ? (p as { text: string }).text : "")).join("");
  if (!text) {
    const why = data?.promptFeedback?.blockReason || data?.candidates?.[0]?.finishReason || "empty";
    throw new AiError("other", `${model} gave no text (${why}).`, true);
  }
  return text;
}

// If a model does not accept the thinking setting, ask it once more without it.
async function callGeminiSafely(model: string, ask: Ask): Promise<string> {
  try {
    return await callGemini(model, ask);
  } catch (err) {
    if (err instanceof AiError && err.kind === "other" && /think/i.test(err.message)) {
      return callGemini(model, ask, false);
    }
    throw err;
  }
}

// First choice goes first; the backup joins in if the first is slow or fails. First good answer wins.
function askGemini(ask: Ask): Promise<string> {
  const fast = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const strong = process.env.GEMINI_STRONG_MODEL || DEFAULT_GEMINI_STRONG;
  const first = ask.strong ? strong : fast;
  const backup = ask.strong ? fast : strong;
  const hedgeMs = ask.strong ? STRONG_HEDGE_MS : HEDGE_MS;

  return new Promise<string>((resolve, reject) => {
    const errors: AiError[] = [];
    let started = 0;
    let backupStarted = false;
    let finished = false;
    let hedgeTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = (fn: () => void) => {
      if (finished) return;
      finished = true;
      if (hedgeTimer) clearTimeout(hedgeTimer);
      fn();
    };

    const launch = (model: string) => {
      started++;
      callGeminiSafely(model, ask).then(
        (text) => finish(() => resolve(text)),
        (err) => {
          if (finished) return;
          const e = err instanceof AiError ? err : new AiError("other", String(err?.message ?? err), true);
          if (e.kind === "key") return finish(() => reject(e)); // a bad key will not get better with another model
          errors.push(e);
          if (!backupStarted) return startBackup();
          if (errors.length >= started) finish(() => reject(errors.find((x) => x.kind === "busy") ?? errors[errors.length - 1]));
        }
      );
    };

    const startBackup = () => {
      if (backupStarted || finished) return;
      backupStarted = true;
      if (hedgeTimer) clearTimeout(hedgeTimer);
      launch(backup);
    };

    launch(first);
    hedgeTimer = setTimeout(startBackup, hedgeMs);
  });
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
