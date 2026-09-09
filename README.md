# Budget Tracker

A personal income and budget tracker: salary and rental income, category
budgets split against it, and expense sheets with a pie-chart breakdown — plus
a live link you can share with someone so they can watch it update without an
account, an install, or any ability to edit it.

Everything is stored in the browser on your device (`localStorage`) — no
account, and by default no data leaves your phone. The one exception is
opt-in: if you turn on **Share**, a computed snapshot of your income, budgets,
and expenses is pushed to a small server you deploy yourself, and anyone with
the link can view it live. Nothing leaves your phone unless you turn that on.

## Features

- **Income, Net Worth & Manage** — one tab, three segments (like
  Foods/Recipes in the family's calorie counter):
  - **Income** — add salary or any other regular income (monthly or yearly),
    plus every apartment you earn rent from, with its type (Studio, 1/2/3/4+
    Bedroom, Villa, Townhouse, Penthouse, Office). Properties are entered as
    gross rent per year and service charges per year — the app subtracts
    them for you, live, and shows the net figure as you type — then split
    by however much of the apartment you own (100% by default, less if you
    own a share; a live preview shows your share's actual yearly and
    monthly value as you adjust it). Each property's card always shows
    both the full net figure and, right below it, "Your N% share" in plain
    numbers, so the share's effect is never just an invisible multiplier
    buried in the monthly total. A **vacant** toggle zeroes a property's
    contribution to your income while keeping it listed, for the ones not
    currently earning.
  - **Manage** — a per-apartment ledger of rent payments received and
    maintenance costs paid, kept deliberately separate from Income's
    gross/service-charge projection above (that stays a simple yearly
    estimate; this is the actual history). Pick an apartment from the chip
    row, log payments and costs with a date, amount and note, filter by
    type, and see collected / costs / net for that property. Deleting an
    apartment removes its ledger with it — there's nothing left for it to
    attach to.
  - **Net Worth** — everything you own against everything you owe:
    investments by category (Real Estate, Stocks & Funds, Business, Gold,
    Vehicles, Crypto, Other, or add your own from the investment editor's +
    button), cash & bank accounts, money owed to you, and money you owe,
    with a pie chart of asset composition. Every investment has an
    ownership share, same as a property in Income: enter its full value
    and how much of it is actually yours (100% by default), and net worth
    counts only your share. An investment can also have an annual return
    (dividends, interest, and the like) — if it pays you something, that
    return counts toward your income on Overview, the same way rental
    income from an apartment does, split by your ownership share like
    everything else. Leave it at 0 for anything that's just sitting there
    (a car, gold, a stock you're not drawing income from). A Real Estate
    investment can link to an
    apartment already tracked in Income — its name and ownership share
    then always follow that apartment's own name and share, and each
    property in Income shows its linked net-worth value (or a one-tap
    prompt to add one) right on its card, so the two stay in sync from
    either side. Unlinking never loses data: deleting an apartment freezes
    its investment's name instead of deleting the investment too. A second
    card shows **liquid net worth** — cash & bank minus what you owe, i.e.
    what you actually have to spend right now — separately from the full
    total, since real estate, a business, or stocks aren't money you can
    spend today the way a bank balance is.
- **Budgets** — split your monthly income into categories (Groceries,
  Rent, Utilities, ... or your own), each with its own monthly budget.
  A progress bar on every category tracks what you've actually spent
  against it for the currently viewed month.
- **Expenses** — log expenses against a category with an amount, date, and
  optional note. ‹ › arrows move between calendar months — each one is
  created automatically the first time you visit or log something in it,
  and an expense always lands in the month of its own date, not whichever
  month happened to be on screen when you added it (so back-filling a past
  month's spending just works). A pie chart and per-category legend show
  the current month's spending at a glance; chips filter the list down to
  one category at a time. **Import bank/card statement (CSV or PDF)**
  bulk-adds expenses from an exported statement instead of typing each one
  in.
  - **CSV**: pick which column is the date/amount/description once
    (remembered next time you import that bank's format), and whether
    spending shows as negative or positive numbers.
  - **PDF**: a PDF reader library ([pdf.js](https://mozilla.github.io/pdf.js/),
    fetched from a CDN the first time you use this — the statement itself
    is still never uploaded anywhere) extracts the text and looks for
    lines that read as "date ... amount". Bank PDF layouts vary a lot, so
    treat this as best-effort — it can't reliably tell a purchase from a
    salary deposit or refund the way a CSV's sign column can, which is
    what the "Include in import" checkbox on every merchant is for. CSV
    export is more reliable if a PDF doesn't parse well.
  - Either way, the next step is the same: categorize each merchant that
    appears — optionally "remember" it so future imports with that
    merchant auto-categorize themselves — and uncheck "Include in import"
    for anything that isn't really an expense. Re-importing an overlapping
    statement period is safe: anything matching an existing expense (same
    date, amount, and description) is skipped rather than duplicated.
- **Overview** — total monthly and yearly income, an **Income vs Expenses**
  card showing at a glance whether you're saving or overspending this month
  (with the actual amount, and a savings rate), a budget-remaining gauge for
  the active sheet, and every category's spend-vs-budget in one place.
- **Share** — turn on a live, read-only link. It needs a server, and there's
  a free one included: `npm run api:setup && npm run api:deploy` puts a
  Cloudflare Worker and a D1 database on your own Cloudflare account, which
  costs nothing at this size. See `api/README.md`. Without it the app behaves
  exactly as it always has — fully usable, nothing shared. Whoever opens the
  link sees your numbers update as you edit (polled every 20 seconds), with
  no way to change anything from their end.
- **Backup & restore** — export/import your data as a JSON file, under the
  gear icon.
- **Dark by default**, matching the rest of this family of apps, with a Light
  option and a "match my phone" setting under the gear icon.

## Running it

```
npm install
npm start
```

Then open `http://localhost:3700` on this machine, or the printed network
address on your phone (same WiFi). Over plain HTTP, browsers disable offline
mode and home-screen install — for the full installable app, serve it over
HTTPS instead (see below).

## Installing it on your phone

This is a Progressive Web App: no app store needed.

1. Deploy `public/` somewhere served over HTTPS. The included GitHub Actions
   workflow (`.github/workflows/deploy-pages.yml`) publishes it to GitHub
   Pages automatically on every push — enable Pages for this repo once
   (Settings → Pages → Source: GitHub Actions) and it takes care of the rest.
2. Open the HTTPS URL on your phone.
3. iOS Safari: Share → Add to Home Screen. Android Chrome: menu → Install app
   (or "Add to Home Screen").

It then runs full-screen like a native app and works offline.

## Sharing a live view with someone

The app is useful on its own with no server at all, and that stays the
default. If you want a live link, deploy the included Worker once — to your
own free Cloudflare account — following `api/README.md`, then in the app:
**Share → paste the server address → Turn on live sharing**. Copy the link it
shows you and send it however you'd send any link.

They don't install anything or make an account: opening the link shows your
income, your budget-vs-spend by category, a pie chart of expenses, and a
filterable expense list, refreshing on its own every 20 seconds. There's
nothing on that page they can edit — it only ever reads.
