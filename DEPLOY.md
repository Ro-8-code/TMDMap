# Deploying — the two commands

I can't log you into GitHub or Vercel (both need an interactive browser login,
and I shouldn't be handling your tokens). Everything else is done: the repo is
committed, the remote is set, and an SSH key is generated and waiting.

## Step 1 — add the SSH key to GitHub (one paste)

Go to <https://github.com/settings/ssh/new>, title it `Roman's MacBook`, and
paste this as the key:

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIN6AOornsHNT/Zx7Y9K1lW38A6OFmV4jp9QAZ0v0vF9h roman@acobas.co.uk
```

## Step 2 — create the empty repo

Go to <https://github.com/new>. Name it exactly `tmdmap`. **Do not** tick
"Add a README" — the repo already has one. Private is fine.

## Step 3 — tell me, and I'll push

Once those two are done, say so and I'll run the push and confirm it landed.
Or do it yourself:

```bash
cd ~/Projects/tmdmap && git push -u origin main
```

If your GitHub username isn't `Ro-8-code`, the remote needs correcting first:

```bash
cd ~/Projects/tmdmap && git remote set-url origin git@github.com:YOURNAME/tmdmap.git
```

## Step 4 — Vercel

Easiest through the dashboard rather than the CLI:

1. <https://vercel.com/new> → **Import Git Repository** → pick `tmdmap`.
   It detects Next.js on its own; don't change the build settings.
2. Before deploying, expand **Environment Variables** and add all four:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `OS_API_KEY`
   - `NEXT_PUBLIC_SITE_URL` = `https://tmdmap.services`
3. **Deploy.**
4. **Settings → Domains** → add `tmdmap.services`, then follow the DNS records
   it shows you at your domain registrar.
5. Go back to Supabase → **Authentication → URL Configuration** and make sure
   `https://tmdmap.services/auth/callback` is in the redirect list. Verification
   emails will point at the wrong place otherwise.

The Vercel CLI is installed in the project if you'd rather use it
(`npx vercel login`, then `npx vercel --prod`), but the dashboard flow handles
the environment variables and the domain in one pass.
