import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

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
export function loadGuides(goal: string, site: string): { text: string; fit: boolean } {
  const dir = join(process.cwd(), "lib", "guides");
  const files = readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
  const fits = files.filter((f) => {
    const m = GUIDE_MATCH[f];
    return !m || m.goal.test(goal) || m.site.test(site);
  });
  const chosen = fits.length > 0 ? fits : files;
  return { text: chosen.map((f) => readFileSync(join(dir, f), "utf8").trim()).join("\n\n=====\n\n"), fit: fits.length > 0 };
}
