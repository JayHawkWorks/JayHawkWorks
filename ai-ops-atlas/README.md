# AI OPS Atlas v2.6 — Welcome Edition

A standalone, client-side AI model, workflow and prompt atlas authored by **J-HWK**.

## Open the site
This directory is intended to be published as a static site (Vercel / GitHub Pages). [GitHub profile](https://github.com/JayHawkWorks).

## Features
- Onboarding with EN → DE → SK → CZ language rotation, remembered choice and replay
- Collapsible sidebar; responsive layout for desktop, tablet and mobile
- Black / Light themes
- AI Finder, Compare, Prompt Lab, Prompt Builder, AI Stack, Local AI calculator
- Local browser notes/settings and JSON export
- All primary application data embedded in `index.html`; no paid API needed
- Optional service worker for offline reuse after the first successful visit

## Privacy & caveats
This published app is **public**; never put secrets or confidential notes into the repository.
Favorites, language, notes and onboarding state are stored in each browser's localStorage, not sent to GitHub or Vercel by the app.
Model pricing, product capabilities and limits are reference material, **not real-time verified**.
Offline support requires an initial HTTPS visit and browser service-worker support. Clearing site data clears the offline cache and local settings.

## Deployment
For Vercel, link the repository `JayHawkWorks/JayHawkWorks` and set **Root Directory** to `ai-ops-atlas`.
For GitHub Pages, deploy this directory as a Pages artifact or copy it to the publishing branch root.
