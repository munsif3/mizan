# Mizan

A deterministic household finance app. Track spending across the people who share a budget, see who
owes whom, and judge every month against a savings target. Mizan requires Google sign-in and a
Firestore household before any financial data screen is available.

## Why it's different

- **Firestore source of truth.** Financial data is stored in the signed-in household's Firestore
  collections. Browser storage is used only for non-financial convenience state and one-time legacy
  migration.
- **Deterministic.** Categorization is a rules engine you teach once, not a black box. The same input
  always produces the same result.
- **Multi-member settlement.** Add anyone who shares the budget. Mizan splits shared spending fairly
  and shows the minimal set of payments that settles everyone up.
- **Works solo, too.** A one-member household automatically drops settlement, the member split, and the
  "for whom" question, so an individual gets a clean single-person view without the shared-budget machinery.
- **Bring your own bank.** Import a plain CSV export from any bank with an interactive column mapper,
  use a built-in statement parser, or enter transactions by hand.
- **Household sync.** Sign in with Google to create or join a household so multiple people can share
  the same budget data.
- **Installable PWA.** Works offline for the app shell and installs to your home screen.
- **A repeatable check-in.** Home shows whether transaction data is current, keeps old review debt
  separate from the selected month, and records a user-specific weekly review for each household.
- **Explainable efficiency opportunities.** Mizan compares classified recorded spending with completed-month
  baselines, asks the household what is actually valuable, and tracks planned changes without altering ledger math.

## Screens

- **Home** - the weekly review of the current month: data freshness, projected save rate vs. your
  target, the next cleanup action, the top three efficiency opportunities, per-member panels, settlement,
  and what changed since last month.
- **Transactions** - the full ledger plus a review queue for teaching categories to new merchants.
- **History** - month-by-month save rate.

## Prerequisites

- Node.js 22.13+ and npm 11.
- Firebase project with Authentication (Google provider) and Cloud Firestore enabled.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # domain, import, migration, and render test suites
npm run test:rules # Firestore authorization suite (requires Java; starts a local emulator)
npm run build      # typecheck + production build to dist/
```

## Google Sign-In & Household Sync

Mizan requires Firebase config for normal app use. Create a Firebase web app with Authentication
(Google provider) and Cloud Firestore, then provide:

```bash
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_APP_ID=...
```

After sign-in, create a household or join one with an invite code. If old browser-local Mizan data is
found, only creating a new household migrates it; joining or switching cannot overwrite an existing
household. The browser financial payload is cleared after the new household save succeeds.

## First Run

After signing in and creating or joining a Firestore household, Mizan walks you through onboarding:

1. **Add members** - one per person who shares the budget. Each member gets a personal spending
   category, and settlement is calculated across all of them.
2. **Pick your currency** - any ISO 4217 code and a locale for number formatting.
3. **Set initial incomes and a save-rate target** - onboarding creates one portion per member; Settings
   can split it into several deposits with currencies, tax treatments, and arrival windows.

You can change this later in Settings. There you can also add recurring fixed costs that are not
already counted in imported transactions; Mizan flags exact category-and-amount matches that may be
the same payment twice. The account registry has one row per card/account, whose spending it is, and
match text so imported statements land on the right account automatically. Settlement comes from
these account owners.

## Importing Transactions

Open Import and choose files. Everything is processed in your browser.

- **CSV** - an export from any bank. Mizan previews the file and lets you map columns. Your mapping is
  remembered per file layout, so repeat imports are one click.
- **Bank statement parsers** - bundled parsers for encrypted statements. Decryption uses your
  statement password and happens on-device.
- **Manual entry** - add one-off transactions by hand.

Duplicates are skipped automatically. New merchants land in the review queue; pick a category once
and a rule is created and applied everywhere.

## Data & Privacy

- All financial and financial-adjacent app data is stored in Firestore for signed-in household
  members: transactions, members, income portions and monthly confirmations, FX rates, accounts, fixed costs, rules, categories, counterparties,
  CSV presets, shared efficiency decisions/outcomes, currency/locale, and target save rate.
- Efficiency recommendations are deterministic and derived from current household data. No financial data is sent
  to an AI or market-comparison service, and estimated or observed reductions never change actual savings figures.
- Browser storage may keep non-financial convenience state such as the last active household and
  privacy toggle; the user profile stores a cloud counterpart for cross-device continuity.
- Raw statement files and passwords are not uploaded by Mizan.
- Back up and restore via Settings -> Export / Import JSON. Backups have an explicit product/version
  envelope; import validates the file and previews record counts before asking to replace the active
  Firestore household.
- During setup/testing, the household owner can use Settings -> Sync & backup -> Reset household
  data. The typed-confirmation reset clears all AppData and returns to onboarding while preserving
  the Firestore household, invite, and Google access.
- The service worker uses network-first navigation with an offline app-shell fallback and safely
  caches immutable build assets.

## Deploy

The build in `dist/` is static files, so it can be hosted on any static host.

A `firebase.json` is included for Firebase Hosting and Firestore rules. The deploy target
(`.firebaserc`) is not committed:

```bash
npm install -g firebase-tools
firebase login
firebase use --add
npm run build
firebase deploy --only hosting,firestore:rules
```

## Roadmap

- Per-record conflict merging beyond the current stale-write rejection and authoritative reload.
- Longer-term income and tax reporting beyond monthly confirmations.
- More built-in bank parsers.

## License

MIT - see [LICENSE](LICENSE).
