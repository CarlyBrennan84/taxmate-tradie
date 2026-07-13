# TaxMate Receipt Scanner (Cloudflare Worker)

A small serverless backend that reads a receipt photo with Claude's vision
API and returns the vendor, date, amount, and suggested deduction category.
It exists so the Anthropic API key never has to live in the browser-side
TaxMate app (which is a public static site) — the key stays here, server-side.

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

3. **Add both as GitHub repository secrets** — repo → *Settings* →
   *Secrets and variables* → *Actions* → *New repository secret*:
   - `CLOUDFLARE_API_TOKEN` — the token from step 2
   - `ANTHROPIC_API_KEY` — the key from step 1

4. **Push to `main`** (or run the workflow manually from the *Actions* tab —
   "Deploy Receipt Scanner Worker" → *Run workflow*). The workflow deploys
   the Worker and sets `ANTHROPIC_API_KEY` as a Worker secret automatically.

5. **Find the deployed URL** — Cloudflare dashboard → *Workers & Pages* →
   `taxmate-receipt-scanner` → the `*.workers.dev` URL shown there.

6. **Point the main app at it.** In the **project root** (not this `worker/`
   folder), create `.env.local`:
   ```
   VITE_RECEIPT_SCANNER_URL=https://taxmate-receipt-scanner.<your-subdomain>.workers.dev
   ```
   Then rebuild/redeploy the main TaxMate app so the URL is baked into the
   production build (push to `main` — the existing Pages workflow handles it,
   or run `npm run build && npm run deploy` from the project root).

## Deploying locally (only if your machine supports Wrangler's runtime)

On Linux, macOS, or Windows x64 this works fine:

```bash
cd worker
npm install
npx wrangler login
npx wrangler secret put ANTHROPIC_API_KEY   # paste the key when prompted — never commit it
npm run deploy
```

## Cost

Each scan is one Claude API call (`claude-opus-4-8`, low effort, vision +
structured output) — a fraction of a cent per receipt. Check usage/billing
at https://console.anthropic.com. Cloudflare Workers' free tier covers this
kind of traffic easily.

## CORS

Only origins listed in `ALLOWED_ORIGINS` in `src/index.ts` can call this
Worker (currently `localhost:5173` and the GitHub Pages origin). Update that
list if you move the app elsewhere.
