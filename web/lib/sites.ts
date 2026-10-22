// The only websites the guide can send you to. The AI picks a name from this list;
// the web address always comes from here, never from the AI.
// To let it open a new tool: add one line here, add its name to the "open" list in
// app/api/next-step/route.ts, and write a short guide in lib/guides/.

export const SITES = {
  lovable: { label: "Lovable", url: "https://lovable.dev" },
  v0: { label: "v0", url: "https://v0.app" },
  bolt: { label: "Bolt", url: "https://bolt.new" },
  github: { label: "GitHub", url: "https://github.com" },
  vercel: { label: "Vercel", url: "https://vercel.com" },
  canva: { label: "Canva", url: "https://www.canva.com" },
  sheets: { label: "Google Sheets", url: "https://docs.google.com/spreadsheets/" },
} as const;

export type SiteKey = keyof typeof SITES;

export function isSiteKey(value: unknown): value is SiteKey {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(SITES, value);
}

export const SITE_KEYS = Object.keys(SITES) as SiteKey[];
