import type { PageElement } from "@/lib/sanitize";

// One short line per element is much smaller than JSON, so the AI answers faster.
// Example: #26 button "Fork 0" top right
export function describeElements(elements: PageElement[]): string[] {
  return elements.map((e) => {
    const words = [...new Set([e.text, e.label, e.placeholder].filter(Boolean))].join(" / ");
    const kind = e.tag + (e.type && e.type !== e.tag ? `(${e.type})` : "");
    return `#${e.id} ${kind} ${words ? `"${words}"` : "(no words on it)"}${e.where ? ` ${e.where}` : ""}`;
  });
}

// Only the website name is used, never the full address, because addresses can hold private tokens.
export function siteOf(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  try {
    return new URL(value).hostname.toLowerCase().slice(0, 100);
  } catch {
    return /^[a-z0-9.-]{1,100}$/i.test(value) ? value.toLowerCase() : "";
  }
}
