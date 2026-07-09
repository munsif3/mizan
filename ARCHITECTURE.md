# Mizan — Architecture

One deterministic, offline system for a household's financial awareness.

## Product principles

1. **Three screens, no more.** Home (monthly check-in), Transactions (incl. review queue), History.
   Every new feature must fit inside one of these or it doesn't ship.
2. **Deterministic.** No AI, no network calls, no external services at runtime. Categorization is a
   rules engine the user teaches by categorizing a merchant once; the rule applies forever after.
3. **The statement is the source of truth.** Bank statements and CSV exports are unlocked, parsed,
   and mapped entirely in the browser. Nothing financial ever leaves the device.
4. **Informed, not gamified.** The Home screen answers three questions: are we on pace for the
   save-rate target, what needs a two-minute conversation, and what changed since last month.

## Engineering decisions (ADR summary)

| # | Decision | Why |
|---|----------|-----|
| 1 | Vite + React + TypeScript (strict), SPA, static build | No server needed — parsing, decryption, and math are all client-side. Static output deploys to any static host. |
| 2 | Pure domain layer (`src/domain`, `src/import`) with Vitest coverage; UI is a thin shell | Money math, rule matching, dedupe, statement parsing, decryption, and settlement are the parts that must never silently break. They are pure functions with tests. UI components contain no arithmetic. |
| 3 | WebCrypto instead of a CDN-loaded crypto library | Runtime CDN fetches are non-deterministic and offline-hostile. NTB's scheme (PBKDF2-SHA1, 15k iterations, 128-bit + AES-128-CBC) is natively supported by `crypto.subtle`. Equivalence is proven by a test that encrypts a fixture with crypto-js (dev dependency only) and decrypts it with our WebCrypto code. |
| 4 | Storage behind a single module (`src/storage`) with a versioned schema and migrator | Today: localStorage + JSON export/import backups. A cloud-sync adapter can be added behind the same load/save seam without touching domain or UI. |
| 5 | Rules engine instead of AI categorization | Deterministic matching: exact merchant match wins, else the *longest* matching substring rule (ties broken alphabetically). Unknown merchants land in a Review queue; categorizing one creates a rule and re-applies everywhere. |
| 6 | No personal figures or identities in source | The app ships empty and generic. On first run, onboarding collects members, currency, and incomes; real figures live only in stored data. Legacy two-person data migrates in (see schema note). |
| 7 | Splits stored on the transaction (`txn.split`), not a parallel map | One concept fewer; no orphaned split entries when a transaction is deleted. |
| 8 | `pdfjs-dist` bundled as a regular dependency (not CDN-loaded), for PDF statement support | PDF.js's `getDocument({ password })` opens password-protected PDFs directly. The worker ships as a local build asset (imported via Vite's `?url`), preserving the "no runtime network calls" guarantee. The "legacy" build is used so the same import works under both a real browser and Vitest/jsdom. |
| 9 | Per-bank statement parsers behind a small registry (`src/import/registry.ts`) | Each bank/format is a `StatementParser` plugin (`canHandle`, `parse`, its own password label) in its own file; the registry dispatches by file extension. Adding a bank means adding one file. When one bank has multiple formats sharing an extension, the plugin decrypts once and dispatches on a content marker (see `ntbHtml.ts`). |
| 10 | NTB statement tables are rendered client-side from embedded page data | Both NTB formats ship an empty `<tbody>` filled by a JS variable at load time. Parsers extract that variable directly (JSON via balanced-bracket scanning for the card statement; targeted per-key regexes for the savings/current statement) rather than `eval`/`Function` on statement content, which would be a code-injection surface. |
| 11 | `Transaction.direction` | Card statements are debit-only; deposit/salary/transfer-in rows from savings/current statements are kept for account history but excluded from every spend/save-rate calculation. Income is the manual per-member `settings.members[].income` figure, not statement-derived. |
| 12 | No generic/speculative HTML-table fallback parser | A generic heuristic risks *silently* parsing a wrong format into plausible-but-wrong transactions — worse for financial data than a loud "not a format Mizan recognizes yet" error. Each bank/format gets a parser verified against a real statement, or the import fails clearly. Generic CSV is the escape hatch, but it's explicit and user-mapped, never guessed silently. |
| 13 | Generic CSV import is a separate route, not a `StatementParser` | CSV needs an interactive column-mapping step (which columns, date order, sign convention), which doesn't fit the file-in / transactions-out parser contract. It lives in `src/import/csv.ts` + `src/import/csvMap.ts` with its own modal; mappings are remembered per header signature in `settings.csvPresets`. |
| 14 | N-member household with data-driven personal categories | Members are a list in settings (`Member { id, name, color, income }`), not a hardcoded pair. Each member has a personal spending category keyed `personal:<memberId>`, so `CategoryKey` is the fixed taxonomy plus a per-member template. All category lookups go through `categoryInfo` / `categoryOptions` (member-aware) rather than a static record. |
| 15 | Fair-split settlement, computed in `summary.ts` | Each member's own personal spend on their own account is their own cost; only shared spend a member fronts is split equally, and one member fronting another's personal spend is owed back directly. Net positions sum to zero, and `settleUp` greedily produces at most N−1 deterministic transfers. |
| 16 | Currency/locale as a setting | `formatMoney(amount, { currency, locale })` uses `Intl.NumberFormat`, so the currency code and grouping follow the household's choice. No currency is assumed; onboarding requires one. |

## Data model (schema v5)

```
AppData
├── schemaVersion: 5
├── transactions: Transaction[]   { id, date, description, amount, category, account, note, source, direction, split? }
├── merchantRules: { CLEANED_MERCHANT: category }
├── accounts: Account[]           { id, label, owner, match[] }   // owner = memberId | "joint"
├── fixedCosts: FixedCost[]       { id, label, amount, category, until? }   // until = "YYYY-MM", inclusive
└── settings:
    ├── members: Member[]         { id, name, color, income }
    ├── targetSaveRate: number
    ├── currency: string          // ISO 4217, e.g. "USD"
    ├── locale: string            // BCP 47, e.g. "en-US"
    └── csvPresets: { [headerSignature]: CsvMapping }
```

- `category` is a fixed key (`housing`, `food`, `transport`, `lifestyle`, `family_support`,
  `investments`, `uncategorized`) or a personal key `personal:<memberId>`.
- `direction` is `"debit"` (spend) or `"credit"` (deposit/salary/transfer in).

**Migration.** `migrate()` normalizes any known shape into v5 and never throws (junk degrades to
empty data). Legacy two-person data (schema v4, or a v1 "trackr" backup) seeds two members whose ids
are the literal names, remaps `munsif_personal` / `sara_personal` category keys to `personal:<id>`,
and pins the previous currency — so existing installs carry forward losslessly. Fresh data with no
member list triggers onboarding.

Known simplification (deliberate): History uses *current* income for all months. Per-month income
history would add a concept for little decision value today.

## Determinism guarantees

- Same statement/CSV + same rules ⇒ identical import result (dedupe by
  date|merchant|amount|account signature).
- Rule application is order-independent (longest-match-wins, alphabetical tiebreak).
- Settlement is a pure function of the month's transactions; `settleUp` is deterministic.
- No runtime network access of any kind. `npm run build` output is fully self-contained.

## Module map

```
src/
├── domain/          pure, tested: types, categories, money, dates, rules, dedupe, accounts, summary
├── import/          pure-ish, tested: statement parser registry + CSV importer
│   ├── types.ts          StatementParser interface (canHandle, parse, password label)
│   ├── registry.ts       dispatches a statement file to the right parser by extension
│   ├── csv.ts            RFC-4180 CSV parser
│   ├── csvMap.ts         column mapping: inference, header signature, row -> Transaction
│   ├── ntbCrypto.ts      generic AES-CBC/PBKDF2 WebCrypto helper
│   ├── ntbHtml.ts        NTB plugin: decrypts once, dispatches by content marker
│   ├── ntbAmexHtml.ts    NTB card statement parser
│   ├── ntbSavingsHtml.ts NTB savings/current statement parser (keeps credit rows)
│   ├── dfccPdf.ts        DFCC password-protected-PDF plugin
│   └── pdfText.ts        pdf.js wrapper: unlock + reconstruct text rows
├── storage/         schema + migration (tested), localStorage persistence
└── ui/              thin React components; no business math
```

## Adding a bank parser

Implement the `StatementParser` interface (`src/import/types.ts`): a `canHandle(file)` predicate, a
`parse(file, password)` that returns `Transaction[]`, and password label/placeholder strings. Add it
to the array in `src/import/registry.ts`. Verify it against a real statement with a test fixture
(see the existing `*.test.ts` files). If your bank offers a CSV export, the generic CSV importer may
already cover you — no code needed.
