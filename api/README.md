# Share server

A tiny Cloudflare Worker plus a D1 database. It holds one row per share link
— the label and the latest computed snapshot (income, budgets, expenses) —
overwritten in place every time the app pushes an update, so the database
stays one row per link no matter how often you edit your budget.

Unlike the friend-group servers in the other apps in this family, this one
has exactly one writer (your own app, authenticated with a token) and any
number of anonymous readers (whoever has the link). There's no join code to
type on the viewer's end — just open the link.

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
the app under **Share → Share server address**, then tap **Turn on live
sharing**. Copy the link it gives you and send that to whoever you want
viewing your budget.

## What it costs

Nothing, at the size this is built for. One row is overwritten per share link
regardless of how often you edit your budget, so a household easily stays
inside Cloudflare's free allowances — Workers' free plan covers 100,000
requests a day, and D1's free tier is far more storage than a few kilobytes of
JSON per link will ever use.

## How access works

There is no password on either side. Creating a share returns a token that
only your own app keeps, used to authenticate every push of a new snapshot.
The link's code is the only thing gating who can *view* it — there is no way
to write through the viewer page, only read. That is a deliberate trade for
sharing a household budget with someone you trust, but be clear-eyed about it:
anyone who gets the link (or it gets forwarded on) can see everything in the
snapshot for as long as sharing stays on. Turning off sharing in the app
deletes the share on the server, and the link stops working immediately.
