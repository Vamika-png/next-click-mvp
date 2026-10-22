// Small helpers shared by the API routes.

// The extension runs on another origin, so the browser needs these headers to allow the call.
export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: CORS });
}

export function fail(code: string, message: string, status: number) {
  return json({ error: code, message }, status);
}

export function preflight() {
  return new Response(null, { status: 204, headers: CORS });
}

// Very small per-IP limit so a leaked URL can't run up the bill. Resets when the server restarts.
const hits = new Map<string, number[]>();
export function rateLimited(req: Request): boolean {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 30;
}

// Pulls the first {...} block out of the model's text and parses it.
export function extractJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}
