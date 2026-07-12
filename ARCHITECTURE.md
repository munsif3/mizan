# Mizan — Architecture

One deterministic system for a household's financial awareness.

## Product principles

1. **Three screens, no more.** Home (weekly review of the current month), Transactions (incl. review queue), History.
   Every new feature must fit inside one of these or it doesn't ship.
2. **Deterministic.** No AI and no hidden financial-data services beyond Firebase Auth and Firestore.
   The app requires Google sign-in before use. Categorization is a rules engine the user teaches
   by categorizing a merchant once; the rule applies forever after.
3. **The statement is the source of truth.** Bank statements and CSV exports are unlocked, parsed,
   and mapped entirely in the browser. Raw files and passwords never leave the device; accepted app
   data is persisted to the active Firestore household.
4. **Informed, not gamified.** The Home screen answers three questions: are we on pace for the
   save-rate target, what needs a two-minute conversation, and what changed since last month.
   It also makes data age explicit and records a user-specific weekly check-in; it does not award
   points, streaks, or badges.

## Engineering decisions (ADR summary)

| # | Decision | Why |
|---|----------|-----|
| 1 | Vite + React + TypeScript (strict), SPA, static build | No server needed — parsing, decryption, and math are all client-side. Static output deploys to any static host. |
| 2 | Pure domain layer (`src/domain`, `src/import`) with Vitest coverage; UI is a thin shell | Money math, rule matching, dedupe, statement parsing, decryption, and settlement are the parts that must never silently break. They are pure functions with tests. UI components contain no arithmetic. |
| 3 | WebCrypto instead of a CDN-loaded crypto library | Runtime CDN fetches are non-deterministic and offline-hostile. NTB's scheme (PBKDF2-SHA1, 15k iterations, 128-bit + AES-128-CBC) is natively supported by `crypto.subtle`. Equivalence is proven by a test that encrypts a fixture with crypto-js (dev dependency only) and decrypts it with our WebCrypto code. |
| 4 | Storage behind a repository seam (`src/storage`) with a versioned schema and migrator | Firestore household collections are the source of truth for all `AppData`. Browser `localStorage` is read only as a one-time legacy migration source and for non-financial convenience state. |
| 5 | Rules engine instead of AI categorization | Deterministic matching: exact merchant match wins, else the *longest* matching substring rule (ties broken alphabetically). Unknown merchants land in a Review queue; categorizing one creates a rule and re-applies everywhere. |
| 6 | No personal figures or identities in source | The app ships empty and generic. On first run, onboarding collects members, currency, and incomes; real figures live only in stored data. Legacy member data migrates in (see schema note). |
| 7 | Splits stored on the transaction (`txn.split`), not a parallel map | One concept fewer; no orphaned split entries when a transaction is deleted. |
| 8 | `pdfjs-dist` bundled as a regular dependency (not CDN-loaded), for PDF statement support | PDF.js's `getDocument({ password })` opens password-protected PDFs directly. The worker ships as a local build asset (imported via Vite's `?url`), so statement parsing does not fetch a runtime CDN script. The "legacy" build is used so the same import works under both a real browser and Vitest/jsdom. |
| 9 | Per-bank statement parsers behind a small registry (`src/import/registry.ts`) | Each bank/format is a `StatementParser` plugin (`canHandle`, `parse`, its own password label) in its own file; the registry dispatches by file extension. Adding a bank means adding one file. When one bank has multiple formats sharing an extension, the plugin decrypts once and dispatches on a content marker (see `ntbHtml.ts`). |
| 10 | NTB statement tables are rendered client-side from embedded page data | Both NTB formats ship an empty `<tbody>` filled by a JS variable at load time. Parsers extract that variable directly (JSON via balanced-bracket scanning for the card statement; targeted per-key regexes for the savings/current statement) rather than `eval`/`Function` on statement content, which would be a code-injection surface. |
| 11 | `Transaction.direction` + `Transaction.kind` | `direction` is the raw bank sign, kept for display and dedupe. `kind` (movement type) — not `direction` — decides spend: `isSpend` is kind-based, so account hops, lending, repayments, investments, and plain credits stay out of every spend/save-rate figure. Income resolves from expected portions and monthly confirmations, not statement credits. |
| 17 | Movement `kind` as the single spend seam | Spend/non-spend is defined once in `SPEND_KINDS`/`isSpend` (`summary.ts`); every money sum, category total, review-queue entry, and member settlement inherits it. Migration defaults `kind` from `direction` (debit → `expense`, credit → `account_credit`), so v5 data carries forward with no math change. |
| 18 | Counterparties are tag-only | `money_lent` / `repayment_received` / `gift_or_handout` carry a `counterpartyId` label surfaced via the movement filter, but Mizan computes no per-person "who owes me" ledger — that would be a fourth screen (principle #1). |
| 19 | Custom categories via `custom:<id>` keys | User-defined buckets live in `settings.customCategories` and are resolved by `categoryInfo`/`categoryOptions` alongside fixed and personal keys, so the taxonomy stays one member-aware lookup. |
| 20 | Internal-transfer detection is a suggestion | `detectTransferCandidates` (`transfers.ts`) deterministically pairs same-amount debit/credit legs between registered household accounts (personal, card, or joint) within a few days; the user confirms before any `kind` flips to `internal_transfer`. No silent reclassification (principle #2). |
| 21 | Bank parsers load on demand | The everyday dashboard does not download PDF.js or bank-specific parsing code. The parser registry exposes lightweight descriptors and dynamically imports the selected implementation only after a statement file is chosen. |
| 22 | One household currency, explicit FX normalization | `Transaction.amount` is the household-currency ledger value. A bank row whose description explicitly states a foreign amount and rate (for example `USD 1900 @332`) is normalized to that converted value and keeps an audit note; already-converted rows keep their booked amount. This avoids silently presenting USD 1,900 as LKR 1,900 without turning Mizan into a multi-currency portfolio ledger. |
| 23 | Classification changes are reversible | Review-queue and ledger classifications create merchant rules, but the Transactions screen keeps a one-step Undo and each classified row can be returned to review. Removing a rule resets the rows it controlled before applying any remaining fallback rule. |
| 24 | Household reset preserves the household shell | The active household owner can replace all `AppData` collections with `emptyData()` after typing `RESET`. Authentication, `meta/current`, invite/member access, the active-household selection, and privacy preference remain; onboarding starts again. The reset is serialized after queued saves so stale autosave data cannot repopulate the household. |
| 12 | No generic/speculative HTML-table fallback parser | A generic heuristic risks *silently* parsing a wrong format into plausible-but-wrong transactions — worse for financial data than a loud "not a format Mizan recognizes yet" error. Each bank/format gets a parser verified against a real statement, or the import fails clearly. Generic CSV is the escape hatch, but it's explicit and user-mapped, never guessed silently. |
| 13 | Generic CSV import is a separate route, not a `StatementParser` | CSV needs an interactive column-mapping step (which columns, date order, sign convention), which doesn't fit the file-in / transactions-out parser contract. It lives in `src/import/csv.ts` + `src/import/csvMap.ts` with its own modal; mappings are remembered per header signature in `settings.csvPresets`. |
| 14 | N-member household with data-driven personal categories | Members are a list in settings (`Member { id, name, color, portions }`), not a hardcoded pair. Each member has a personal spending category keyed `personal:<memberId>`, so `CategoryKey` is the fixed taxonomy plus a per-member template. All category lookups go through `categoryInfo` / `categoryOptions` (member-aware) rather than a static record. |
| 25 | Income portions resolve through one pure seam | Each member can have several expected deposits with currency, tax treatment, and an arrival window. `resolveMonthIncome` converts expectations, applies tax, prefers household-currency monthly receipts, and supplies Home and History so UI code performs no finance arithmetic. |
| 26 | Income reconciliation is a suggestion; the link is provenance | `detectIncomeCandidates` proposes an unlinked registered-account credit within an FX-aware tolerance and the portion's arrival window. Foreign-account credits match in their native currency. Confirmation retains the received amount/currency/rate for audit and stores `receipt.amount` in household currency; `transactionId` remains evidence, never a second income source. |
| 27 | Account identity is stable and keeps import provenance | Accounts have a stable id and their own currency. Transactions retain `rawAccount` from the statement plus `accountId`; later match rules and label edits can repair existing rows without losing the source text. Native rows display in the account currency; explicitly normalized FX rows retain their household-currency ledger value and audit note. |
| 28 | Shared contributions are confirmed statement evidence | A `SharedContribution` links one member's outgoing transfer, the matching credit into another member's account, and explicit allocations across one or more partial loan-recovery debits. Transfer legs stay non-spend and every recovery remains a single spend source; settlement reallocates only the proven amount. Suggestions never create links silently. |
| 15 | Fair-split settlement, computed in `summary.ts` | Each member's own personal spend on their own account is their own cost; only shared spend a member fronts is split equally, and one member fronting another's personal spend is owed back directly. Net positions sum to zero, and `settleUp` greedily produces at most N−1 deterministic transfers. |
| 16 | Currency/locale as a setting | `formatMoney(amount, { currency, locale })` uses `Intl.NumberFormat`, so the currency code and grouping follow the household's choice. No currency is assumed; onboarding requires one. |

## Data model (schema v10)

```
AppData
├── schemaVersion: 10
├── transactions: Transaction[]   { id, date, description, amount, category, account, accountId?, rawAccount?, note, source, direction, kind, counterpartyId?, split? }
├── sharedContributions: SharedContribution[] { id, allocations: { expenseTransactionId, amount }[], transferDebitTransactionId, transferCreditTransactionId, contributorMemberId, amount }
├── merchantRules: { CLEANED_MERCHANT: { category, kind, counterpartyId? } }
├── accounts: Account[]           { id, label, currency, owner, match[] }   // owner = memberId | "joint"
├── fixedCosts: FixedCost[]       { id, label, amount, category, until? }   // until = "YYYY-MM", inclusive
├── incomeReceipts: IncomeReceipt[] { id, month, memberId, portionId, amount, receivedAmount?, receivedCurrency?, fxRate?, date?, transactionId? }
└── settings:
    ├── members: Member[]         { id, name, color, portions: IncomePortion[] }
    ├── fxRates: { [ISO currency]: householdCurrencyPerUnit }
    ├── targetSaveRate: number
    ├── currency: string          // ISO 4217, e.g. "USD"
    ├── locale: string            // BCP 47, e.g. "en-US"
    ├── csvPresets: { [headerSignature]: CsvMapping }
    ├── counterparties: Counterparty[]     { id, name }
    └── customCategories: CustomCategory[] { id, label, color }
```

Schema v7 replaces the old scalar `Member.income` with `Member.portions: IncomePortion[]`.
Each portion stores the expected deposit, its currency, tax rate/treatment, and an optional
arrival-day window. `AppData.incomeReceipts.amount` stores confirmed monthly actuals in the household
currency; foreign confirmations also retain the statement-native received amount/currency and the
rate used. `settings.fxRates` converts foreign expected portions for projections and prefills confirmations.

- `category` is a fixed key (`housing`, `food`, `transport`, `lifestyle`, `family_support`,
  `investments`, `uncategorized`), a personal key `personal:<memberId>`, or a
  user-defined key `custom:<id>` (resolved against `settings.customCategories`).
- `direction` is the raw bank-row sign, `"debit"` (money out) or `"credit"` (money in).
- `amount` is always the value used by the household-currency ledger. Recognizable explicit FX rows are converted from their stated original amount and rate; the original currency/rate remain in the description and audit note.
- `kind` (`MovementKind`) is what decides spend, not `direction`: `expense`,
  `gift_or_handout`, and `loan_payment` count as spend; `internal_transfer`,
  `money_lent`, `repayment_received`, `investment_transfer`, and `account_credit`
  do not (see `SPEND_KINDS` in `src/domain/movements.ts` and `isSpend` in `src/domain/summary.ts`).
- `counterpartyId` tags the other party on `money_lent` / `repayment_received` /
  `gift_or_handout`. Counterparties are a **label only** — Mizan tracks no running
  outstanding balance (deliberate: keeps to three screens).

## Cloud household model (sync v4)

Firestore stores household data in split collections while `AppData` remains the canonical in-app
shape. The repository hydrates collections into `AppData` and writes `AppData` back out to
collections:

```
households/{householdId}/meta/current  HouseholdMeta
households/{householdId}/settings/current  CloudSettings
households/{householdId}/transactions/{transactionId}
households/{householdId}/sharedContributions/{contributionId}
households/{householdId}/accounts/{accountId}
households/{householdId}/fixedCosts/{fixedCostId}
households/{householdId}/incomeReceipts/{receiptId}
households/{householdId}/members/{memberId}
households/{householdId}/customCategories/{categoryId}
households/{householdId}/counterparties/{counterpartyId}
households/{householdId}/merchantRules/{safeDocId(ruleKey)}
households/{householdId}/csvPresets/{safeDocId(headerSignature)}
users/{uid}/households/{householdId}   UserHouseholdLink
users/{uid}/profile/current            UserProfile
```

Firebase Auth identifies users; household membership controls Firestore access. Roles are `owner`
and `member`; both can read/write household data, while owner-only metadata changes are enforced by
Firestore rules. `users/{uid}/profile/current` stores non-financial cross-device state such as active
household, privacy mode, last view, filters, and the user's last weekly check-in per household.

`App.tsx` shows an authentication gate until Firebase Auth reports a signed-in Google user. After
sign-in, the user must create or join a household before onboarding or dashboard data can be edited.
If a legacy `mizan_v2` or `trackr_v1` browser payload is found, the first selected household receives
that payload and the browser financial keys are cleared only after the Firestore save succeeds.

**Migration.** `migrate()` normalizes any known shape into v9 and never throws (junk degrades to
empty data). Legacy data (schema v4, or a v1 "trackr" backup) seeds members from ids already present
in the backup, remaps `<member>_personal` category keys to `personal:<id>`,
and pins the previous currency — so existing installs carry forward losslessly. v5 → v6 defaults
each transaction's `kind` from its `direction` and upgrades bare-string merchant rules to
`{ category, kind: "expense" }`. v6 to v7 converts each positive `Member.income` into one tax-withheld
monthly portion with the same net value. v7 to v8 gives each account the household currency by default;
newly matched transactions retain their raw statement account text and stable account id. v8 to v9 adds
the shared-contribution collection. v9 to v10 converts each single loan target into one explicit allocation;
new confirmations may allocate one proven contribution across several partial recoveries. Migration preserves
only records whose transfer evidence, account ownership, allocation totals, and loan targets remain valid.
Fresh data with no member list triggers onboarding.

History uses confirmed receipts in the month where they were recorded. Months without receipts use
the current expected portions, so projections remain useful before actuals are confirmed.

## Determinism guarantees

- Same statement/CSV + same rules/settings ⇒ identical import result (dedupe by
  date|merchant|amount|account signature).
- Rule application is order-independent (longest-match-wins, alphabetical tiebreak).
- Settlement is a pure function of the month's transactions and confirmed shared-contribution evidence; `settleUp` is deterministic.
- App access requires Firebase Auth. Financial data is written only to the active Firestore
  household; browser financial payloads are legacy migration inputs, not live storage.

## Module map

```
src/
├── auth/            Firebase Auth wrapper + Google sign-in state
├── domain/          pure, tested: types, income, incomeMatch, categories, movements, money, dates, rules, dedupe, accounts, transfers, contributions, summary
├── firebase/        Firebase client initialization from Vite env vars
├── household/       household metadata, invite helpers, Firestore repository
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
├── storage/         schema + migration (tested), repository seam + legacy local migration helpers
└── ui/              thin React components; no business math
```

## Adding a bank parser

Implement the `StatementParser` interface (`src/import/types.ts`): a `canHandle(file)` predicate, a
`parse(file, password)` that returns `Transaction[]`, and password label/placeholder strings. Add it
to the array in `src/import/registry.ts`. Verify it against a real statement with a test fixture
(see the existing `*.test.ts` files). If your bank offers a CSV export, the generic CSV importer may
already cover you — no code needed.
