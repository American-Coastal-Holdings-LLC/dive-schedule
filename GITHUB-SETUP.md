# Connect this app to GitHub + Netlify — one-time setup

Right now, updating the live site means downloading a zip and dragging it
onto Netlify by hand. This connects the two so it happens automatically:
push a file here, and the live site updates itself within seconds — with
full history, so you can always see (or undo) what changed.

About 10 minutes, all from a browser. No command line, no git to install.

## Step 1 — Create a free GitHub account (skip if you already have one)

Go to **github.com**, sign up. The free plan covers everything here.

## Step 2 — Create a new repository for this app

1. Click the **+** in the top right → **New repository**.
2. Name it anything (e.g. `dive-schedule`), no spaces.
3. Set visibility to **Private** — recommended. This code contains your
   Firebase project's connection details (see the note in `README.md`), so
   private keeps it out of public search/listings. It's free either way.
4. Leave "Initialize this repository with a README" **unchecked** — we're
   uploading our own files in the next step.
5. Click **Create repository**.

## Step 3 — Upload the app files

1. On the new repo's page, look for a link along the lines of
   **"uploading an existing file"**.
2. From the folder you unzipped, drag in all of these:
   - `index.html`
   - `manifest.webmanifest`
   - `icon-192.png`
   - `icon-512.png`
   - `apple-touch-icon.png`
   - `README.md`
   - `.gitignore`
3. Scroll down and click the green **Commit changes** button.

Don't upload anything from your bigger project folder beyond what's in this
zip (demo videos, the desktop app, marketing files, etc.) — this repo is
meant to hold only the live app, so updates stay small and fast.

You now have a GitHub repo containing exactly what's live on your site today.

## Step 4 — Link it to your existing Netlify site

1. Log into Netlify and open the site your team currently uses.
2. Go to **Site configuration** (older Netlify: **Site settings**) →
   **Build & deploy**.
3. Look for the section about connecting to Git — the exact wording varies,
   but look for **"Link repository,"** **"Link site to Git,"** or
   **"Continuous deployment."**
4. Choose **GitHub**, authorize Netlify to access it if asked, and select the
   repo you just created.
5. When it asks for build settings: leave the **build command blank** and set
   the **publish directory to `/`** — this app has no build step, the files
   are served exactly as uploaded. Save.

## Step 5 — Confirm it worked

1. Netlify should start a deploy immediately — check the **Deploys** tab.
   A site this small should finish in well under a minute.
2. Once it shows **Published**, open your live site link and confirm it still
   looks right.

## From now on — shipping an update

Whenever there's a new version of `index.html` — from me, or an edit you make
yourself — put the new version into this GitHub repo (drag it in again via
**Add file → Upload files**, which replaces the old one, or edit the file
directly on GitHub) and commit. Netlify picks it up and republishes
automatically, usually within seconds. Nothing to drag onto Netlify by hand
anymore, and every change is now saved as its own entry in GitHub's history —
so if an update ever caused a problem, you could roll back to the exact
last-good version in a couple of clicks.

## If something goes wrong

- **Site looks empty or broken after connecting** — double-check `index.html`
  itself was uploaded (not left zipped) and that the publish directory is `/`,
  not a subfolder.
- **Can't find the Git-linking option in Netlify** — it lives under
  *Site configuration → Build & deploy* in most accounts; Netlify's own help
  docs (search "link existing site to a Git repository") cover it too, since
  the exact UI wording shifts from time to time.
- **Worried this touched your data** — it didn't. Your jobs, divers, dive
  records, sales, and stock all live in Firebase, completely separate from
  this repo and from Netlify. Changing where the code lives never touches
  where the data lives.
