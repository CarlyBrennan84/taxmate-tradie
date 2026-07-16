# Glovebox Receipt Scanner (Cloudflare Worker)

A small serverless backend behind the Glovebox app. It exists so API keys
never have to live in the browser-side app (which is a public static site) —
they stay here, server-side. Routes:

- `/` (root) — reads a receipt photo with Claude's vision API, returns
  vendor/date/amount/category
- `/assistant` — the Glovebox AI chat, with tool use for logging trips/expenses
  and looking up/updating receipts
- `/transcribe` — speech-to-text for voice input, via Cloudflare's own
  Whisper model (Workers AI binding, no extra account needed)
- `/distance` — driving distance between two addresses (for "log a trip from
  X to Y"), via the Google Maps Distance Matrix API

## Deploying (via GitHub Actions — recommended)

Wrangler's local dev runtime doesn't ship a Windows-on-ARM64 build, so
`npx wrangler` won't run on this machine. Deployment is set up to happen
through GitHub Actions instead (`.github/workflows/deploy-worker.yml`),
which runs on Linux and works fine.

1. **Get an Anthropic API key** (if you don't have one already):
   https://console.anthropic.com/settings/keys

2. **Get a Cloudflare API token**: Cloudflare dashboard → your profile icon
   → *My Profile* → *API Tokens* → *Create Token* → use the
   **"Edit Cloudflare Workers"** template → create.

3. **Get a Google Maps API key** (only needed for the "log a trip between two
   addresses" feature):
   - Go to https://console.cloud.google.com/ → create a project if you don't
     have one → **Billing** must be enabled (a card on file — the free
     monthly credit comfortably covers normal personal use)
   - **APIs & Services → Library** → search **"Distance Matrix API"** → Enable
   - **APIs & Services → Credentials** → **Create Credentials → API key**
   - Click the new key → **Restrict key** → under *API restrictions*, select
     **Distance Matrix API** only (this key lives server-side in the Worker,
     so IP restriction isn't needed/practical)

4. **Add all three as GitHub repository secrets** — repo → *Settings* →
   *Secrets and variables* → *Actions* → *New repository secret*:
   - `CLOUDFLARE_API_TOKEN` — the token from step 2
   - `ANTHROPIC_API_KEY` — the key from step 1
   - `GOOGLE_MAPS_API_KEY` — the key from step 3

5. **Push to `main`** (or run the workflow manually from the *Actions* tab —
   "Deploy Receipt Scanner Worker" → *Run workflow*). The workflow deploys
   the Worker and sets all three as Worker secrets automatically.

6. **Find the deployed URL** — Cloudflare dashboard → *Workers & Pages* →
   `taxmate-receipt-scanner` → *Domains* tab → enable the **Production**
   toggle if it isn't already, giving you `https://taxmate-receipt-scanner.<your-subdomain>.workers.dev`.

7. **Point the main app at it.** In the **project root** (not this `worker/`
   folder), the URL lives in the committed `.env.production` file:
   ```
   VITE_RECEIPT_SCANNER_URL=https://taxmate-receipt-scanner.<your-subdomain>.workers.dev
   ```
   This is a public endpoint, not a secret, so it's fine to commit — unlike
   a local `.env.local` it survives every future GitHub Actions build. Only
   needs updating if the Worker's URL ever changes.

## Deploying locally (only if your machine supports Wrangler's runtime)

On Linux, macOS, or Windows x64 this works fine:

```bash
cd worker
npm install
npx wrangler login
npx wrangler secret put ANTHROPIC_API_KEY     # paste the key when prompted — never commit it
npx wrangler secret put GOOGLE_MAPS_API_KEY   # same — only needed for /distance
npm run deploy
```

## Cost

- Receipt scan / assistant chat: Claude API calls (`claude-opus-4-8`, low
  effort) — a fraction of a cent each. Check usage/billing at
  https://console.anthropic.com.
- Voice transcription: Cloudflare's own Whisper model via Workers AI —
  ~$0.00045/audio-minute, well inside the free tier for personal use.
- Distance lookups: Google Maps Distance Matrix API — covered by the free
  monthly credit for normal personal use.

Cloudflare Workers' own free tier covers this kind of traffic easily.

## CORS

Only origins listed in `ALLOWED_ORIGINS` in `src/index.ts` can call this
Worker (currently `localhost:5173` and the GitHub Pages origin). Update that
list if you move the app elsewhere.
