# Glovebox — accounts setup (Supabase)

Glovebox now supports multiple users, each with their own private, invite-only
account. This is a one-time setup — once done, everything (rebuilds,
deploys) just works.

## 1. Create a Supabase project

Go to [supabase.com](https://supabase.com) → sign up (free) → **New project**.
Pick any name/region/password (the database password isn't something you'll
need day-to-day — Supabase manages the connection for you).

## 2. Run the database schema

Dashboard → **SQL Editor** → **New query** → paste the entire contents of
[`supabase/schema.sql`](./schema.sql) → **Run**.

This creates one table (`app_data`) with row-level security enabled, so each
user can only ever read or write their own row — enforced by the database
itself, not just app code.

## 3. Turn off public sign-ups

Since this is invite-only:

Dashboard → **Authentication** → **Sign In / Providers** → **Email** → turn
**off** "Allow new users to sign up" (wording may vary slightly — look for
the self-signup toggle). This means the *only* way to create an account is
via the invite flow in step 5.

## 4. Set the redirect URL

Dashboard → **Authentication** → **URL Configuration**:
- **Site URL**: `https://carlybrennan84.github.io/taxmate-tradie/`
- **Redirect URLs**: add the same URL

This matters — without it, invite emails link to the wrong place and won't
work.

## 5. Invite people

Dashboard → **Authentication** → **Users** → **Invite user** → enter their
email → send. They'll get an email with a link that logs them straight into
Glovebox and prompts them to set a password. Repeat for each person.

## 6. Get your API credentials

Dashboard → **Project Settings** → **API**:
- **Project URL**
- **anon public** key (NOT the `service_role` key — that one must never be
  used client-side)

## 7. Wire them into the app

In the **project root** (not `worker/`), create/edit `.env.production`:

```
VITE_RECEIPT_SCANNER_URL=https://taxmate-receipt-scanner.<your-subdomain>.workers.dev
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<your anon public key>
```

The anon key is designed to be public (that's the whole point of row-level
security) — safe to commit, unlike the Worker's secrets. Push to `main` and
the existing GitHub Pages workflow rebuilds and deploys automatically.

## What changed for existing data

If you (or an invited user) already had receipts/trips saved in a browser
before logging in, the very first login automatically uploads that local
data into the new account, then switches to using the account from then on.
Nothing is lost.

## Cost

Supabase's free tier covers this comfortably: 500MB database, unlimited API
requests, up to 50,000 monthly active users. A handful of tradies logging
receipts is nowhere near those limits.
