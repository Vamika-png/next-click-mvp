// The only websites the guide can send you to. The AI picks a name from this list;
// the web address always comes from here, never from the AI.
// To let it open a new tool: add one line here (the "open" list in the AI's rules is built from
// this file automatically), and optionally write a short guide in lib/guides/.

export const SITES = {
  lovable: { label: "Lovable", url: "https://lovable.dev" },
  v0: { label: "v0", url: "https://v0.app" },
  bolt: { label: "Bolt", url: "https://bolt.new" },
  github: { label: "GitHub", url: "https://github.com" },
  vercel: { label: "Vercel", url: "https://vercel.com" },
  canva: { label: "Canva", url: "https://www.canva.com" },
  sheets: { label: "Google Sheets", url: "https://docs.google.com/spreadsheets/" },
  docs: { label: "Google Docs", url: "https://docs.google.com/document/" },
  gmail: { label: "Gmail", url: "https://mail.google.com" },
  drive: { label: "Google Drive", url: "https://drive.google.com" },
  zapier: { label: "Zapier", url: "https://zapier.com" },
  make: { label: "Make", url: "https://www.make.com" },
  claude: { label: "Claude", url: "https://claude.ai" },
  chatgpt: { label: "ChatGPT", url: "https://chatgpt.com" },
  gemini: { label: "Gemini", url: "https://gemini.google.com" },
  notion: { label: "Notion", url: "https://www.notion.so" },
  figma: { label: "Figma", url: "https://www.figma.com" },
  shopify: { label: "Shopify", url: "https://www.shopify.com" },
  wix: { label: "Wix", url: "https://www.wix.com" },
  framer: { label: "Framer", url: "https://www.framer.com" },
  replit: { label: "Replit", url: "https://replit.com" },
} as const;

export type SiteKey = keyof typeof SITES;

export function isSiteKey(value: unknown): value is SiteKey {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(SITES, value);
}

export const SITE_KEYS = Object.keys(SITES) as SiteKey[];
