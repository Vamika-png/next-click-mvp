import { existsSync } from "node:fs";
import { join } from "node:path";

// The Download button only works once the zip file exists in web/public.
const ZIP = "next-click-extension.zip";
const hasZip = existsSync(join(process.cwd(), "public", ZIP));

export default function Home() {
  return (
    <>
      <div className="wrap">
        <nav className="nav">
          <a className="logo" href="#top">Next Click</a>
          <a className="small" href="#install">How to install</a>
        </nav>

        <header className="hero" id="top">
          <h1>Never get lost on a website again.</h1>
          <p>
            Tell Next Click what you want to do. It shows you the very next button to press, one tiny step at a time,
            in words anyone can follow.
          </p>
          {hasZip ? (
            <a className="btn" href={`/${ZIP}`} download>Download for Chrome</a>
          ) : (
            <span className="btn off">Download coming soon</span>
          )}
          <p className="sub">Free prototype. Works in Chrome on a computer.</p>

          <div className="demo" aria-label="Example of what you see">
            <div className="label">Step 1</div>
            <p className="say">Press the orange button that says &ldquo;Get started&rdquo; at the top right.</p>
            <p className="note">We need an account so your website can be saved.</p>
          </div>
        </header>
      </div>

      <div className="wrap">
        <section className="block">
          <h2>What it helps you do</h2>
          <div className="grid">
            <div className="card">
              <h3>Make an app and put it online</h3>
              <p>From your idea to a real website: it opens the right sites, writes the message for the app builder, and points you through.</p>
            </div>
            <div className="card">
              <h3>Make a poster in Canva</h3>
              <p>Start a design, pick a look, change the words, and download it.</p>
            </div>
            <div className="card">
              <h3>Use Google Sheets</h3>
              <p>Set up a budget or a list, add totals, and share it.</p>
            </div>
          </div>
        </section>

        <section className="block">
          <h2>How it works</h2>
          <ol className="steps">
            <li><span>Type what you want to do, like &ldquo;a website for my tailoring shop&rdquo;, and press <strong>Go</strong>.</span></li>
            <li><span>A big card tells you one thing to do. An orange arrow points at the right button on the page.</span></li>
            <li><span>Do it. Next Click notices the page changed and shows the next step by itself. Stuck? Press <strong>I&rsquo;m lost</strong>.</span></li>
          </ol>
        </section>

        <section className="block" id="install">
          <h2>Install it in 2 minutes</h2>
          <ol className="steps">
            <li><span><strong>Download</strong> the file above, then unzip it (right-click, Extract All).</span></li>
            <li><span>In Chrome, type <code>chrome://extensions</code> in the address bar and press Enter.</span></li>
            <li><span>Turn on <strong>Developer mode</strong> (the switch at the top right).</span></li>
            <li><span>Click <strong>Load unpacked</strong> and choose the unzipped folder (the one with <code>manifest.json</code> inside).</span></li>
            <li><span>Click the puzzle-piece icon in Chrome and pin <strong>Next Click</strong>. Click it any time to start.</span></li>
          </ol>
        </section>

        <section className="block">
          <h2>Safe by design</h2>
          <ul className="ticks">
            <li>It only points. It never clicks or types for you.</li>
            <li>It never reads password boxes or what you type.</li>
            <li>It only looks at your page when you press Go, and it sends only the website name and the names of the buttons.</li>
            <li>You always type your own passwords.</li>
          </ul>
        </section>

        <footer>
          Next Click is an early prototype made for a hackathon. Some answers may be wrong. It tells you when it is not sure.{" "}
          <a href="https://github.com/Vamika-png/next-click-mvp">Source code on GitHub</a>.
        </footer>
      </div>
    </>
  );
}
