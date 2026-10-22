// Second safety layer: the extension already skips passwords and key-like text,
// but we never trust the client, so we clean again before anything reaches the AI.

export type PageElement = {
  id: number;
  tag: string;
  text: string;
  label: string;
  placeholder: string;
  type: string;
  where: string;
};

const KEY_PATTERNS = [
  /sk-[A-Za-z0-9_-]{10,}/,
  /gh[pousr]_[A-Za-z0-9]{20,}/,
  /AKIA[0-9A-Z]{12,}/,
  /eyJ[A-Za-z0-9_-]{20,}/, // JWTs
  /[A-Za-z0-9+/_-]{32,}/, // long random-looking strings
];

export function looksLikeSecret(value: string): boolean {
  return KEY_PATTERNS.some((p) => p.test(value));
}

function clean(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const v = value.replace(/\s+/g, " ").trim().slice(0, max);
  return looksLikeSecret(v) ? "" : v;
}

export function sanitizeElements(input: unknown): PageElement[] {
  if (!Array.isArray(input)) return [];
  const out: PageElement[] = [];
  for (const raw of input.slice(0, 150)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const type = clean(r.type, 20).toLowerCase();
    if (type === "password") continue;
    const id = Number(r.id);
    if (!Number.isInteger(id)) continue;
    out.push({
      id,
      tag: clean(r.tag, 20),
      text: clean(r.text, 80),
      label: clean(r.label, 80),
      placeholder: clean(r.placeholder, 80),
      type,
      where: clean(r.where, 40),
    });
  }
  return out;
}

export function sanitizeText(value: unknown, max: number): string {
  return clean(value, max);
}
