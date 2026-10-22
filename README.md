# Next Click

A Chrome side panel that shows a beginner what to click next, one tiny step at a time, in very simple words. You type what you want to do ("a website for my shop", "a poster in Canva", "a budget in Google Sheets"), press **Go**, and an orange arrow points at the button to press. **It only points. It never clicks or types for you.**

It works on any normal website. It has written guides for four jobs so far: making an app and putting it online (Lovable, GitHub, Vercel), making a design in Canva, using Google Sheets, and building an automation (Zapier or Make). For anything else it still helps from what it sees, and says "I'm not 100% sure". It can't see desktop apps; for those it points you to the website version.

Two parts:
- `extension/` the Chrome extension (side panel + arrow)
- `web/` a small Next.js server with three routes, the only places the AI is called: `/api/chat` (the roadmap and your questions), `/api/next-step` (the next button to press) and `/api/message` (the long message for an app builder, written in the background while you sign up, because it is the slowest thing the AI does)

Gemini's free tier has daily and per-minute limits for each model, and it can be slow at busy times. The server skips a model that says it is used up for the day, asks again if one is slow, and shows a friendly "I'm a little busy" message if everything is full. For many users, switch the key to a paid plan.

## What you see

1. Type a goal ("I want to build a website") and press **Go**.
2. You first get a **roadmap**: every stage from zero to done (for a website: write your idea, make an account on a builder, build it, improve it, save it on GitHub, put it online, optionally get your own web address). It folds away if you tap its header.
3. Then the panel walks you through the stages one tiny step at a time. A big card shows ONE thing to press and an arrow points at it. The AI says which stage you are on, so the roadmap ticks itself off.
4. The **message box at the bottom** lets you ask anything ("what is GitHub?", "what does this button do?"). Answers appear as chat bubbles. If your message changes the path ("use Claude instead", "skip the domain"), the roadmap is rebuilt and guiding carries on.

## Run it on your computer

1. **Server.** In a terminal:
   ```bash
   cd web
   npm install
   npm run dev
   ```
   It starts on http://localhost:3000. `web/.env.local` has `MOCK_AI=1` by default, which gives fake answers so you can test the panel without an AI key.
2. **Extension.** In Chrome open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and choose the **`extension`** folder (the one with `manifest.json` inside).
3. Click the Next Click icon (puzzle-piece menu, then pin it), type what you want to make, press **Go**.

## Turn on the real AI

Gemini (Google) is the default; Claude (Anthropic) also works.

1. Create a key at **aistudio.google.com** (Get API key). Check its free limits there.
2. In `web/.env.local` paste the key after `GEMINI_API_KEY=` and change `MOCK_AI=1` to `MOCK_AI=0`. Save, then restart `npm run dev`.
3. To use Claude instead: paste a key after `ANTHROPIC_API_KEY=` and set `AI_PROVIDER=claude`.
4. Two Gemini models are used. A fast light one (`GEMINI_MODEL`, default `gemini-3.5-flash-lite`) answers almost every step in about a second and a half. A stronger one (`GEMINI_STRONG_MODEL`, default `gemini-3.6-flash`) goes first when the roadmap is built, and steps in whenever the fast one is slow, busy or out of free requests. If Google renames a model, set the name in the same file. Each model has its own free allowance.
5. The key stays on the server. It is never in the extension, and `.env*` files are git-ignored.

## Deploy the server to Vercel

1. Put this folder on GitHub, then in Vercel choose **Add New, Project**, import it, and set **Root Directory** to `web`.
2. Add the environment variables `GEMINI_API_KEY` (type the value yourself), `AI_PROVIDER` = `gemini` and `MOCK_AI` = `0`.
3. Deploy. Then set `API_BASE` in `extension/config.js` to `https://YOUR-APP.vercel.app` (no slash at the end), and reload the extension in `chrome://extensions`.

## How it works

- The panel reads the page you are on (buttons, links and fields as plain text) and sends the AI only the **website name**, the page title, that list, your goal and your last three instructions.
- The AI picks one element by number. Our own code draws the arrow on it. The AI cannot send you to a random website: it can only pick from the fixed list in `web/lib/sites.ts` (Lovable, v0, Bolt, GitHub, Vercel, Canva, Google Sheets, Docs, Gmail, Drive, Zapier, Make, Claude, ChatGPT, Gemini, Notion, Figma).
- When the page changes, the panel looks again by itself. **I'm lost** asks again with a gentler explanation. **🔊 Read it to me** speaks the next step with Chrome's own voice.
- What the AI knows about each tool lives in short files in `web/lib/guides/`.

## Teach it a new tool

1. Add one line to `web/lib/sites.ts` with the tool's name and address (so the panel can offer an **Open** button).
2. Write a short guide in `web/lib/guides/` (copy `canva.md` and change it): when to use it, the steps in order, and the goal state.
3. Nothing else. The server reads every file in that folder each time.

## Permissions

| Permission | Plain-language reason |
|---|---|
| `sidePanel` | Shows the panel next to the page you are on. |
| `scripting` | Lets it list the buttons on your page and draw the arrow. |
| Access to all websites | The journey moves between several sites (an AI builder, GitHub, Vercel), and Chrome hides a tab from an extension unless it has access. The extension only looks when you have pressed Go, never reads password fields, hidden fields or what you type, and drops anything that looks like a key. Before publishing for real users, narrow this to the specific sites. |

## What it never does

- Click or type for you.
- Read password fields, hidden fields, what you have typed, or anything that looks like a key or token.
- Send an empty goal to the AI.
- Send the full web address of your page (only the site name).

## Known limits

- It only reads the top of a page, not boxes embedded inside it (iframes).
- It can't point inside something a page draws itself, like a single spreadsheet cell or a word inside a Canva design. It points at menus and buttons, and describes the rest in words.
- It can't see desktop apps (Claude Desktop, Excel, VS Code), only pages in Chrome.
- Chrome's own pages (`chrome://`) and the Chrome Web Store can't be read. On those it simply tells you which website to open.
- Builder websites change often. The AI reads the real buttons on your screen and marks anything it isn't sure about as "I'm not 100% sure".
