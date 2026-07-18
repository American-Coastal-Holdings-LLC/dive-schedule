# Dive Schedule

A scheduling app built for hull-cleaning and dive crews. It keeps every
recurring boat on its rotation, tracks diver pay, runs a checklist/certify
workflow for each cleaning, emails a service report to the customer the
moment a job's marked done, and includes simple point-of-sale, inventory,
and income tracking — all from a phone, tablet, or computer.

This repo holds the deployed app: everything in it is what actually runs
live for the team, nothing more.

## What's in here

| File | What it is |
|---|---|
| `index.html` | The entire app — every screen, all the logic. One file by design, so hosting and updates stay simple. |
| `manifest.webmanifest` | Lets the app install to a phone's home screen like a real app (PWA). |
| `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` | The home-screen icons for Android and iOS. |

## How it's hosted

This repo is connected to Netlify, which auto-deploys the live site on
every push to the default branch — see `GITHUB-SETUP.md` for how that
link was set up. To ship an update: push a change here, and the live site
picks it up automatically within seconds. No manual upload step.

## Where the data lives

None of it is in this repo. Every job, diver, dive record, sale, and
stock item lives in a separate Firebase (Firestore) database in the
cloud. This code only contains the app's *logic* — the screens and
buttons — plus the database's connection details (project ID and API
key) so the app knows where to read and write. Updating this code never
touches the data.

## A note on the Firebase config

`index.html` contains a `firebaseConfig` block (project ID + API key) and
an admin PIN, both in plain text. Firebase web API keys aren't secret the
way a password is — normally a database's security rules are what
actually protect it. This app's rules are intentionally wide open (no
login required, so the whole crew can use it with zero setup), which
means anyone who found this project ID could read or write the schedule
directly. Keeping this repository **private** is a simple, worthwhile
precaution on top of that. See `GITHUB-SETUP.md` for where to set that
when creating the repo.

## Making changes

`index.html` is a single self-contained file — HTML, CSS, and JavaScript
together, no build step and no dependencies to install. Edit it directly
(on GitHub, or in any text editor) and push; Netlify handles the rest.
