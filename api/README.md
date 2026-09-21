# Share & sync server

A tiny Cloudflare Worker plus a D1 database, serving two features off the
same deployment:

- **Share** — one row per share link (the label and the latest computed
  snapshot: income, budgets, expenses), overwritten in place every time the
  app pushes an update. Exactly one writer (your own app, authenticated with
  a token) and any number of anonymous readers (whoever has the link) —
  there's no join code to type on the viewer's end, just open the link.
- **Sync** — one row per sync link, holding the full editable dataset
  (including Net Worth) instead of a read-only snapshot. Two-way: any device
  holding the same code+secret can both read and write it, for keeping the
  same budget updating live across your own phone and desktop. See "How
  access works" below for how this differs from Share.

Both use the same random-code-plus-secret-token pattern and live in their
own tables (`shares` and `syncs`) in the one database, so deploying once
covers both features.

## Deploying it

You need a free Cloudflare account. There are two ways in.

### From a phone (or any browser) — no terminal

Use the **Deploy share server** GitHub Action. It creates the database,
applies the schema and publishes the Worker on a GitHub runner, then prints
the address to paste into the app. Setup is two secrets, added once:

1. Cloudflare dashboard → profile menu → **My Profile → API Tokens → Create
   Token → Create Custom Token**. Give it:
   - Account · **Workers Scripts** · Edit
   - Account · **D1** · Edit
2. Copy your **Account ID**: it is the hex string in the dashboard URL,
   `dash.cloudflare.com/<account-id>/...`
3. In this repo: **Settings → Secrets and variables → Actions → New repository
   secret**, twice — `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
4. **Actions → Deploy share server → Run workflow.**

The run summary shows the URL. Re-running is safe: it reuses the database it
already made and the schema is written with `IF NOT EXISTS`.

### From a terminal

```
npm run api:setup     # creates the D1 database and applies the schema
npm run api:deploy    # publishes the Worker, prints its URL
```

Take the URL that `api:deploy` prints (it looks like
`https://budget-tracker-share.<your-subdomain>.workers.dev`) and paste it into
the app. For **Share**: **Share → Share server address**, then tap **Turn on
live sharing**, and send the link it gives you to whoever you want viewing
your budget. For **Sync**: **Share → Sync devices → Start syncing on this
device**, then paste the code it shows into **Join existing sync** on your
other device.

Already deployed the server before Sync existed? Re-run the same deploy (the
GitHub Action, or `npm run api:deploy` from a terminal) — it reapplies
`schema.sql`, which is written with `IF NOT EXISTS`, so it adds the new
`syncs` table alongside your existing one without touching any share links
already in use.

## What it costs

Nothing, at the size this is built for. A share's row is overwritten in
place regardless of how often you edit your budget, so even active use stays
inside Cloudflare's free allowances — Workers' free plan covers 100,000
requests a day, and D1's free tier is far more storage than this will ever
need. Sync polls more often (every 20 seconds per linked device while the
app is open, in each direction) and its row holds your full history rather
than one month, but two devices polling that often is still a small fraction
of the free daily request allowance.

## How access works

**Share** has no password on either side. Creating a share returns a token
that only your own app keeps, used to authenticate every push of a new
snapshot. The link's code is the only thing gating who can *view* it — there
is no way to write through the viewer page, only read. That is a deliberate
trade for sharing a household budget with someone you trust, but be
clear-eyed about it: anyone who gets the link (or it gets forwarded on) can
see everything in the snapshot for as long as sharing stays on. Turning off
sharing in the app deletes the share on the server, and the link stops
working immediately.

**Sync** is stricter, because it holds everything rather than a read-only
snapshot: the code alone is *not* enough to read it — every request, reads
included, needs the same secret token that's needed to write. That token is
exactly what the app shows you as the "sync code" to copy from one device to
another, so treat it like a password rather than something to forward
around; anyone who has it has full read/write access to that budget, Net
Worth included, for as long as the sync stays linked. Unlinking a device in
the app only removes that device's own copy of the code — it doesn't revoke
the sync itself, since other devices may still be using it.
