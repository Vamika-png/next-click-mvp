# Guide: make an app and put it on the internet (Lovable, GitHub, Vercel)

Use this guide when the user's goal is to make a website or app, or to put an app online. Audience: a non-technical founder launching a web app for the first time. The whole journey has three stages: (A) build the app in an AI app builder (Lovable, v0 or Bolt), (B) save the code on GitHub, (C) deploy it on Vercel. Work out which stage the user is on from the page and what you already told them.

Goal state: the app is live on a vercel.app URL.

## Stage A: Build the app in an AI app builder (Lovable, v0, Bolt)
- The user is new, so they do not have an account yet. Prefer a "Get started" or "Sign up" button over "Log in", and on the next screen prefer "Continue with Google" or "Continue with GitHub" because it needs no new password. Only say "Log in" if the user told you they already have an account. Never ask for a password; they type it themselves.
- The home screen has one big prompt box (labelled like "Ask...", "What do you want to build?" or "Describe your app"). The panel shows a ready-made message with a Copy button; the user pastes it into that box, then clicks the send or build button (an arrow, "Build", or "Generate").
- Wait for the first version. A live preview of the app appears, usually in 1 to 3 minutes.
- If the preview looks wrong, the user types a short follow-up request in the same chat box. Do not write new prompts unless asked.
- Stage A is done when a preview of the app is visible.
- Builder screens change often. Trust the page over this playbook, and set verified false for any button name you are not sure about.

## Stage B: Save the code on GitHub
- Inside the builder, look for a GitHub button or a Settings / Project settings page with a GitHub section. Names vary: "GitHub", "Connect to GitHub", "Sync", "Git".
- Click it, then "Connect" or "Connect GitHub". GitHub asks for approval; the user approves it themselves and chooses their own account.
- Click "Create repository" (or similar). Keep the suggested name unless the user wants another.
- Stage B is done when the builder shows a link to a GitHub repository or says the project is connected or synced.
- If the builder has no GitHub option (for example the plan doesn't include it), set status stuck and tell the user the builder may need a different plan or a manual export; mark verified false.

## Stage C: Deploy on Vercel (steps in order)

1. **Code is on GitHub.**
   - Sign in at github.com (the user types their own password; never ask for it).
   - If the code is not on GitHub yet: click "New" / "New repository", give it a name, keep it Private if the app has secrets, click "Create repository".
   - Then the user must upload the code. The easy way for a beginner: ask their AI coding tool "Push this project to my new GitHub repository" and give them the repository URL. Offer this as copyText. Do not invent terminal commands unless the user asks.
   - Check: the repository page on github.com shows the project files.

2. **Open Vercel.**
   - Go to vercel.com. Click "Sign Up" (or "Log In").
   - Choose "Continue with GitHub". The user approves GitHub access themselves.
   - Pick the free "Hobby" plan if asked.

3. **Import the project.**
   - On the Vercel dashboard click "Add New..." then "Project".
   - In "Import Git Repository" find the repo and click "Import".
   - If the repo is missing: click "Adjust GitHub App Permissions" and allow that repository.

4. **Configure the project.**
   - Vercel usually detects the framework (for example Next.js). Leave defaults unless the user's AI tool says otherwise.
   - If the app needs secret keys (like an API key): open "Environment Variables", type the Name, and let the user type or paste the Value themselves. Never read or repeat the value.

5. **Deploy.**
   - Click "Deploy". Wait for the build (about 1 to 2 minutes).
   - If the build fails: click the failed deployment, open the logs, copy the last red error lines, and give the user copyText for their AI coding tool: "My Vercel build failed with this error: <paste error>. Please fix it and push to GitHub." Mark this step verified true only for this exact flow.

6. **Done.**
   - A "Congratulations" page shows a preview. Click "Continue to Dashboard", then the "Visit" button to open the live URL.
   - Status done when the user is on their live .vercel.app URL.

## Rules of thumb
- Anything not in the steps above (custom domains, databases, paid plans, other hosts) is unverified.
- Pages change. Trust what is on the page over this playbook, and say so.
