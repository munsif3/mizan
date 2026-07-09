# Mizan (ميزان)

A deterministic, offline household finance app. Track spending across the people who share a
budget, see who owes whom, and judge every month against a savings target — all in the browser,
with **nothing ever leaving your device**. No account, no server, no telemetry.

*Mizan* means "balance" or "scales" in Arabic.

## Why it's different

- **Fully local & private.** All data lives in your browser's `localStorage`. There is no backend,
  no sign-in, and no network calls at runtime. Bank statements are decrypted and parsed on-device.
- **Deterministic.** Categorization is a rules engine you teach once, not a black box. The same
  input always produces the same result.
- **Multi-member settlement.** Add anyone who shares the budget. Mizan splits shared spending fairly
  and shows the minimal set of payments that settles everyone up.
- **Bring your own bank.** Import a plain CSV export from any bank (with an interactive
  column-mapper), or use a built-in statement parser. Or just enter transactions by hand.
- **Installable PWA.** Works offline, installs to your home screen.

## Screens

- **Home** — the monthly check-in: projected save rate vs. your target, per-member panels, who
  should pay whom to settle up, biggest spending areas, and what changed since last month.
- **Transactions** — the full ledger plus a review queue for teaching categories to new merchants.
- **History** — month-by-month save rate.

## Prerequisites

- Node.js 20.19+ (or 22+) and npm. Nothing else — no API keys, no services, no env files.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # domain, import, migration, and render test suites
npm run build      # typecheck + production build to dist/
```

## First run

On first launch Mizan walks you through onboarding:

1. **Add members** — one per person who shares the budget (name + colour). Each member gets a
   personal spending category, and settlement is calculated across all of them.
2. **Pick your currency** — any ISO 4217 code (USD, EUR, GBP, …) and a locale for number formatting.
3. **Set incomes and a save-rate target** — used to judge each month.

You can change all of this later in **Settings (⚙)**. There you can also add **fixed costs** (rent,
loans, subscriptions) and set up the **account registry** — one row per card/account, whose spending
it is, and match text (a card-number fragment or bank name) so imported statements land on the right
account automatically. Settlement ("who paid what") comes from these account owners.

## Importing transactions

Open **Import (↑)** and choose files. Everything is processed in your browser.

- **CSV** — an export from any bank. Mizan previews the file and lets you map columns
  (date, description, amount or debit/credit, account) with day-first / month-first date handling.
  Your mapping is remembered per file layout, so repeat imports are one click.
- **Bank statement parsers** — bundled parsers for encrypted statements (currently
  Nations Trust Bank HTML and DFCC PDF). Decryption uses your statement password and happens
  entirely on-device.
- **Manual entry** — add one-off transactions by hand.

Duplicates are skipped automatically (by date, merchant, amount, and account). New merchants land in
the review queue; pick a category once and a rule is created and applied everywhere.

**Your bank isn't supported?** Use the CSV importer, or add a parser — see the `StatementParser`
interface in [src/import/types.ts](src/import/types.ts) and the registry in
[src/import/registry.ts](src/import/registry.ts). Adding a bank is one new file. Details in
[ARCHITECTURE.md](ARCHITECTURE.md).

## Data & privacy

- Everything is stored in `localStorage` on the device you're using. It is **not** synced or backed
  up anywhere. Deploying the app to a host does not move or share your data — each browser keeps its
  own copy.
- Back up and restore via **Settings → Export / Import JSON**. Do this after importing statements.
- Nothing is ever transmitted. The service worker only caches the app shell for offline use.

## Deploy (optional)

The build in `dist/` is fully self-contained static files (~70 KB gzipped, zero server calls), so it
can be hosted on any static host — GitHub Pages, Netlify, Cloudflare Pages, Firebase Hosting, or your
own server.

A `firebase.json` is included for Firebase Hosting. The deploy target (`.firebaserc`) is **not**
committed — create your own:

```bash
npm install -g firebase-tools
firebase login
firebase use --add        # pick/create your project (writes .firebaserc, which is gitignored)
npm run build
firebase deploy --only hosting
```

## Roadmap

- Optional cloud sync behind the existing storage seam (so multiple devices share one household).
- Per-month income history (today History uses current income for all months).
- More built-in bank parsers (contributions welcome).

## License

MIT — see [LICENSE](LICENSE).
