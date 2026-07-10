# TaxMate Tradie

A modern, mobile-first tax deduction dashboard for Australian apprentices and tradies — receipts, vehicle logbook, expense tracking, refund estimator and an end-of-year accountant summary pack, all in one place.

Built with React, TypeScript, Tailwind CSS and Chart.js. Data currently persists to the browser's `localStorage`; the storage layer (`src/lib/storage.ts`) is deliberately isolated so it can be swapped for Supabase later without touching any UI code.

**This is a standalone project — kept intentionally separate from TradieFirst.** Different repo, different Supabase project, different domain.

## Getting started

```bash
npm install
npm run dev
```

Opens at `http://localhost:5173`.

## Build

```bash
npm run build
npm run preview   # preview the production build locally
```

## Deploy to GitHub Pages

This repo ships with a GitHub Actions workflow (`.github/workflows/deploy.yml`) that builds and deploys automatically on every push to `main`.

One-time setup after you push this repo to GitHub:

1. Go to **Settings → Pages** in the GitHub repo.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Push to `main` — the workflow builds and deploys automatically.
4. Your app will be live at `https://<your-username>.github.io/taxmate-tradie/`.

If you rename the repo, update the `base` path in `vite.config.ts` to match.

Alternatively, you can deploy manually at any time with:

```bash
npm run deploy
```

(uses the `gh-pages` package to push the `dist` folder to a `gh-pages` branch — make sure Pages is set to deploy from that branch if you use this method instead of Actions).

## Project structure

```
src/
  App.tsx          — the whole dashboard UI (single file, mirrors how you iterate on it)
  types.ts         — shared TypeScript types (Receipt, Trip, Profile, AppData)
  lib/storage.ts   — persistence layer: localStorage today, Supabase-ready
  index.css        — Tailwind + a handful of custom animations
```

## Next steps (when you're ready)

- **Supabase**: replace `loadData`/`saveData` in `src/lib/storage.ts` with Supabase calls (sketch included in that file's comments). Add auth so each tradie's data is private.
- **Receipt OCR**: hook the Dropzone's `onFiles` callback up to an OCR/AI categorisation step before the receipt is saved.
- **Driversnote import**: add an import button on the Vehicle tab that parses a Driversnote CSV export into `trips`.

## A note on the numbers

The refund estimator uses simplified 2024–25-style resident tax brackets and a simplified Medicare Levy calculation. It's a planning tool, not tax advice — always confirm with a registered tax agent.
