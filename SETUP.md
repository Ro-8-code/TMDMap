# TMD Map — setup

Three things to do, in order. Roughly 20 minutes total. Everything below is free.

---

## 1. Supabase — accounts, email verification, login

1. Go to <https://supabase.com> and sign up (free tier is fine).
2. **New project** → name it `tmdmap`, pick region **London (eu-west-2)**, set a
   database password (save it somewhere; you won't need it for this app).
3. Wait ~2 minutes for it to provision.
4. Go to **Project Settings → API**. Copy these two values:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon / public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
5. Go to **Authentication → Providers → Email** and make sure
   **Confirm email** is switched **ON**. This is what forces the verify-email
   step before anyone can get in.
6. Go to **Authentication → URL Configuration**:
   - **Site URL**: `https://tmdmap.services`
   - **Redirect URLs**: add both
     - `https://tmdmap.services/auth/callback`
     - `http://localhost:3100/auth/callback`

> **Note on verification emails.** Supabase's built-in mail sender is rate
> limited (a handful of emails per hour) — fine for you and Jordan, not fine
> once you have a team. When you outgrow it, add a free Resend account under
> **Authentication → Emails → SMTP Settings**.

---

## 2. Ordnance Survey Data Hub — the maps

1. Go to <https://osdatahub.os.uk> and **Sign up** (free account).
2. Once in, go to **API Dashboard → My Projects → Add project**. Call it
   `tmdmap`.
3. Add the **OS Maps API** to the project.
4. Copy the **Project API Key** → `OS_API_KEY`.

**What you get for free.** Every OS Data Hub account includes a monthly free
allowance that covers OS *Premium* data, not just OpenData. That's what makes
the **Leisure** layer — the actual 1:25,000 Explorer and 1:50,000 Landranger
paper-map styling — available at no cost at the volume one or two people will
use. The other three layers (Outdoor, Road, Light) are OpenData and free
outright.

Check your usage occasionally under **Dashboard → Usage**. If you ever get
close to the allowance, OS will tell you before it charges anything.

**Licensing — read this before issuing a drawing.** Capturing OS mapping into
a drawing you send to a paying client is *commercial* use. The free Data Hub
allowance covers the API calls; it does not by itself grant you the right to
redistribute OS mapping inside a deliverable. Check the OS licence terms for
your use case, or talk to OS about a Partner/Contractor licence. Every layer in
the app carries the required
`Contains OS data © Crown copyright and database right` attribution on screen,
so it appears in the screenshot.

---

## 3. Run it

**Locally:**

```bash
cd ~/Projects/tmdmap && cp .env.example .env.local
```

Fill in `.env.local` with the four values, then:

```bash
cd ~/Projects/tmdmap && npm run dev
```

Open <http://localhost:3100>.

**Deploy to Vercel:**

1. Push this folder to a new GitHub repo.
2. At <https://vercel.com/new>, import that repo. Framework detects as Next.js.
3. Add the four environment variables from `.env.local` under
   **Settings → Environment Variables**, but set
   `NEXT_PUBLIC_SITE_URL=https://tmdmap.services`.
4. Deploy.
5. **Settings → Domains** → add `tmdmap.services`, and point your domain's
   nameservers (or an A/CNAME record) at Vercel as instructed there.

---

## How Jordan uses it

1. Go to `tmdmap.services`, create an account, click the link in the
   verification email, sign in.
2. Type the site address or postcode into the search bar, hit Enter.
3. The map flies to it and drops an amber pin.
4. Pick a basemap on the left — **OS Leisure** for the classic OS look,
   **OS Outdoor** when he needs more detail at close zoom.
5. Click a scale — **1:200**, **1:500**, **1:1250** or **1:2500** — to snap the
   view to a standard drawing scale.
6. Click **Export PNG**. That beats a screenshot: you get the map at full
   resolution with no UI over it, and a caption strip burned in along the
   bottom with a scale bar, the National Grid reference, the coordinates and
   the OS attribution.

**Getting it to scale in AutoCAD.** Insert the PNG, then use `SCALE` with the
Reference option and draw along the scale bar in the caption strip — type the
bar's stated length as the new length. The raster is then at true ground
scale. The metres-per-pixel figure in the strip is there as a cross-check.

> **Zoom tip.** OS Leisure runs out of detail at zoom 16 (that's the limit of
> the 1:25k product) and will look soft past that. Switch to **OS Outdoor** for
> zoom 17–20 when he needs street-level detail.
