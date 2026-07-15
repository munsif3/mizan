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
| 5 | Rules engine instead of AI categorization | Deterministic matching: exact merchant match wins, else the *longest* matching substring rule (ties broken alphabetically). Unknown purpose or beneficiary lands in Review; confirming there creates a merchant-wide rule, while a ledger-only mixed-use override is locked to one row. |
| 6 | No personal figures or identities in source | The app ships empty and generic. On first run, onboarding collects members, currency, and incomes; real figures live only in stored data. Legacy member data migrates in (see schema note). |
| 7 | Splits stored on the transaction (`txn.split`), not a parallel map | One concept fewer; no orphaned split entries when a transaction is deleted. |
| 8 | `pdfjs-dist` bundled as a regular dependency (not CDN-loaded), for PDF statement support | PDF.js's `getDocument({ password })` opens password-protected PDFs directly. The worker ships as a local build asset (imported via Vite's `?url`), so statement parsing does not fetch a runtime CDN script. The "legacy" build is used so the same import works under both a real browser and Vitest/jsdom. |
| 9 | Per-bank statement parsers behind a small registry (`src/import/registry.ts`) | Each bank/format is a `StatementParser` plugin (`canHandle`, `parse`, its own password label) in its own file; the registry dispatches by file extension. Adding a bank means adding one file. When one bank has multiple formats sharing an extension, the plugin decrypts once and dispatches on a content marker (see `ntbHtml.ts`). |
| 10 | NTB statement tables are rendered client-side from embedded page data | Both NTB formats ship an empty `<tbody>` filled by a JS variable at load time. Parsers extract that variable directly (JSON via balanced-bracket scanning for the card statement; targeted per-key regexes for the savings/current statement) rather than `eval`/`Function` on statement content, which would be a code-injection surface. |
| 11 | `Transaction.direction` + `Transaction.kind` | `direction` is the raw bank sign, kept for display and dedupe. `kind` (movement type) — not `direction` — decides spend: `isSpend` is kind-based, so account hops, lending, repayments, investments, and plain credits stay out of every spend/save-rate figure. Income resolves from expected portions and monthly confirmations, not statement credits. |
| 12 | No generic/speculative HTML-table fallback parser | A generic heuristic risks *silently* parsing a wrong format into plausible-but-wrong transactions — worse for financial data than a loud "not a format Mizan recognizes yet" error. Each bank/format gets a parser verified against a real statement, or the import fails clearly. Generic CSV is the escape hatch, but it's explicit and user-mapped, never guessed silently. |
| 13 | Generic CSV import is a separate route, not a `StatementParser` | CSV needs an interactive column-mapping step (which columns, date order, sign convention), which doesn't fit the file-in / transactions-out parser contract. It lives in `src/import/csv.ts` + `src/import/csvMap.ts` with its own modal; mappings are remembered per layout signature in `settings.csvPresets`. |
| 14 | N-member household with independent beneficiaries | Members are a list in settings (`Member { id, name, color, portions }`), not a hardcoded pair. `CategoryKey` records purpose only; `SpendBeneficiary` separately records Household, one member, or Unassigned, so “what,” “for whom,” and paying account never overwrite one another. |
| 15 | Fair-split settlement, computed in `summary.ts` | Member beneficiary spend is that member's responsibility; Household beneficiary spend is divided equally. Paying-account ownership and confirmed contribution evidence determine who fronted it, so cross-paid personal costs are repaid directly. Fixed commitments stay forecast-only because they contain no payer evidence. |
| 16 | Currency/locale through one domain seam | `normalizeCurrency`, `resolveIncomeCurrency`, and `formatMoney` centralize ISO normalization, native-income resolution, conversion evidence, and locale-aware display. Income rows use their received currency while household totals remain in the household currency. No currency is assumed; onboarding requires one. |
| 17 | Movement `kind` as the single spend seam | Spend/non-spend is defined once in `SPEND_KINDS`/`isSpend` (`summary.ts`); every money sum, category total, review-queue entry, and member settlement inherits it. Migration defaults `kind` from `direction` (debit → `expense`, credit → `account_credit`), so v5 data carries forward with no math change. |
| 18 | Counterparties are tag-only | `money_lent` / `repayment_received` / `gift_or_handout` carry a `counterpartyId` label surfaced via the movement filter, but Mizan computes no per-person "who owes me" ledger — that would be a fourth screen (principle #1). |
| 19 | Custom categories via `custom:<id>` keys | User-defined buckets live in `settings.customCategories` and are resolved by `categoryInfo`/`categoryOptions` alongside fixed and personal keys, so the taxonomy stays one member-aware lookup. |
| 20 | Internal-transfer detection is a suggestion | `detectTransferCandidates` (`transfers.ts`) deterministically pairs same-amount debit/credit legs between registered household accounts (personal, card, or joint) within a few days; the user confirms before any `kind` flips to `internal_transfer`. No silent reclassification (principle #2). |
| 21 | Bank parsers load on demand | The everyday dashboard does not download PDF.js or bank-specific parsing code. The parser registry exposes lightweight descriptors and dynamically imports the selected implementation only after a statement file is chosen. |
| 22 | One household currency, explicit FX normalization | `Transaction.amount` is the household-currency ledger value. A bank row whose description explicitly states a foreign amount and rate (for example `USD 1900 @332`) is normalized to that converted value and keeps an audit note; already-converted rows keep their booked amount. This avoids silently presenting USD 1,900 as LKR 1,900 without turning Mizan into a multi-currency portfolio ledger. |
| 23 | Merchant defaults and one-row overrides are distinct | Review-queue decisions create merchant-wide purpose + beneficiary rules. A ledger edit is a `classificationLocked` one-row override, so later rule reapplication cannot silently replace an intentional mixed-use classification. |
| 24 | Household reset preserves the household shell | The active household owner can replace all `AppData` collections with `emptyData()` after typing `RESET`. Authentication, `meta/current`, invite/member access, the active-household selection, and privacy preference remain; onboarding starts again. The reset is serialized after queued saves so stale autosave data cannot repopulate the household. |
| 25 | Income portions resolve through one pure seam | Each member can have several expected deposits with currency, tax treatment, and an arrival window. `resolveMonthIncome` converts expectations, applies tax, prefers household-currency monthly receipts, and supplies Home and History so UI code performs no finance arithmetic. |
| 26 | Income reconciliation is a suggestion; the link is provenance | `detectIncomeCandidates` proposes an unlinked registered-account credit within an FX-aware tolerance and the portion's arrival window. Foreign-account credits match in their native currency. Confirmation retains the received amount/currency/rate for audit and stores `receipt.amount` in household currency; `transactionId` remains evidence, never a second income source. |
| 27 | Account identity is stable and keeps import provenance | Accounts have a stable id, currency, payer, and explicit beneficiary default (`owner`, `household`, or `review`). Transactions retain `rawAccount` plus `accountId`; later match rules and label edits can repair rows without losing source text. Account-derived beneficiaries carry provenance so only inferred or unresolved rows are recalculated. |
| 28 | Shared contributions are confirmed statement evidence | A `SharedContribution` links one member's outgoing transfer, the matching credit into another member's account, and explicit allocations across one or more partial loan-recovery debits. Transfer legs stay non-spend and every recovery remains a single spend source; settlement reallocates only the proven amount. Suggestions never create links silently. |
| 29 | Beneficiary precedence is explicit | A locked one-row override wins, then an explicit merchant beneficiary, then the registered account's beneficiary default, then Unassigned. Merchant rules may select `account_default`, so one merchant can stay personal to whichever member card paid while a household merchant overrides every account. |
| 30 | Transaction clearing preserves reusable household setup | The owner may delete every ledger row without rebuilding the household. Transaction-backed contribution records are removed and income-receipt statement links are detached, while accounts, card/bank matching, members, income confirmations, rules, fixed costs, categories, presets, settings, household access, and the invite remain. Like a full reset, the clear is serialized after queued saves so stale autosaves cannot restore deleted rows. |
| 31 | Recurring commitment type is separate from purpose | A fixed commitment stores `kind: expense | loan_payment` independently from `category`. The settings editor labels both fields, so a car loan can be a Loan / debt payment for the Transport purpose without treating Transport as the loan type. Both remain forecast spend; imported statement rows remain the actual ledger evidence. Legacy loan-like names get a user-confirmed suggestion, never silent reclassification. |
| 32 | One-off income is scheduled and protected by default | An income portion has a monthly or exact-month one-off schedule plus an ordinary/protected budget treatment. Confirmed bonuses count in income, savings, and save rate, while protected amounts do not expand target spend or daily allowance. A combined salary-and-bonus credit may evidence several atomically saved receipts; the credit remains provenance only and is never counted again. |

## Data model (schema v14)

```
AppData
├── schemaVersion: 14
├── transactions: Transaction[]   { id, date, description, amount, category, beneficiary, beneficiarySource?, classificationLocked?, account, accountId?, rawAccount?, note, source, direction, kind, counterpartyId?, split? }
├── sharedContributions: SharedContribution[] { id, allocations: { expenseTransactionId, amount }[], transferDebitTransactionId, transferCreditTransactionId, contributorMemberId, amount }
├── merchantRules: { CLEANED_MERCHANT: { category, beneficiary | account_default, kind, counterpartyId? } }
├── accounts: Account[]           { id, label, currency, owner, beneficiaryDefault, match[] }
├── fixedCosts: FixedCost[]       { id, label, amount, kind, category, beneficiary, until? }   // kind = expense | loan_payment; until = "YYYY-MM", inclusive
├── incomeReceipts: IncomeReceipt[] { id, month, memberId, portionId, amount, receivedAmount?, receivedCurrency?, fxRate?, currencyReview?, date?, transactionId?, label?, taxRate?, taxWithheld?, budgetTreatment? }
└── settings:
    ├── members: Member[]         { id, name, color, portions: IncomePortion[] { schedule: monthly | one_off(YYYY-MM), budgetTreatment: ordinary | protected } }
    ├── fxRates: { [ISO currency]: householdCurrencyPerUnit }
    ├── targetSaveRate: number
    ├── currency: string          // ISO 4217, e.g. "USD"
    ├── locale: string            // BCP 47, e.g. "en-US"
    ├── csvPresets: { [headerSignature]: CsvMapping }
    ├── counterparties: Counterparty[]     { id, name }
    └── customCategories: CustomCategory[] { id, label, color }
```

Schema v7 replaces the old scalar `Member.income` with `Member.portions: IncomePortion[]`.
Each portion stores the expected deposit, its currency, tax rate/treatment, schedule, budget treatment,
and an optional arrival-day window. One-offs exist only in their scheduled month; an overdue unconfirmed
one-off contributes zero rather than leaving a stale estimate in history. `AppData.incomeReceipts.amount` stores confirmed monthly actuals in the household
currency; foreign confirmations also retain the statement-native received amount/currency and the
rate used. Confirmations snapshot label, tax, and budget treatment so later source edits cannot rewrite
history. `settings.fxRates` converts foreign expected portions for projections and prefills confirmations.

- `category` is purpose only: a fixed key (`housing`, `food`, `transport`, `lifestyle`,
  `family_support`, `investments`, `uncategorized`) or a user-defined key
  `custom:<id>` (resolved against `settings.customCategories`).
- `beneficiary` is `{ type: "household" }`, `{ type: "member", memberId }`, or
  `{ type: "unassigned" }`. The paying member remains derived from registered account ownership
  and confirmed contribution evidence; fixed commitments have no payer evidence.
- `beneficiarySource: "account_default"` marks only concrete beneficiaries inferred from an account policy.
  Account edits may recalculate those rows and unlocked Unassigned rows, but never overwrite an explicit
  Household/member classification. `owner` still means who funded the account; it does not itself mean who consumed the spend.
- `direction` is the raw bank-row sign, `"debit"` (money out) or `"credit"` (money in).
- `amount` is always the value used by the household-currency ledger. Recognizable explicit FX rows are converted from their stated original amount and rate; the original currency/rate remain in the description and audit note.
- `kind` (`MovementKind`) is what decides spend, not `direction`: `expense`,
  `gift_or_handout`, and `loan_payment` count as spend; `internal_transfer`,
  `money_lent`, `repayment_received`, `investment_transfer`, and `account_credit`
  do not (see `SPEND_KINDS` in `src/domain/movements.ts` and `isSpend` in `src/domain/summary.ts`).
- `counterpartyId` tags the other party on `money_lent` / `repayment_received` /
  `gift_or_handout`. Counterparties are a **label only** — Mizan tracks no running
  outstanding balance (deliberate: keeps to three screens).

## Cloud household model (sync v7)

`AppData` remains the canonical in-app shape. Firestore publishes one active snapshot revision
through a small manifest; each revision keeps the same split-collection layout:

```
households/{householdId}/meta/current  HouseholdMeta
households/{householdId}/joinRequests/{uid}  Short-lived invite proof
households/{householdId}/snapshotManifest/current  { activeRevision, versionToken, ... }
households/{householdId}/snapshots/{revision}  CloudSettings
households/{householdId}/snapshots/{revision}/transactions/{transactionId}
households/{householdId}/snapshots/{revision}/sharedContributions/{contributionId}
households/{householdId}/snapshots/{revision}/accounts/{accountId}
households/{householdId}/snapshots/{revision}/fixedCosts/{fixedCostId}
households/{householdId}/snapshots/{revision}/incomeReceipts/{receiptId}
households/{householdId}/snapshots/{revision}/members/{memberId}
households/{householdId}/snapshots/{revision}/customCategories/{categoryId}
households/{householdId}/snapshots/{revision}/counterparties/{counterpartyId}
households/{householdId}/snapshots/{revision}/merchantRules/{safeDocId(ruleKey)}
households/{householdId}/snapshots/{revision}/csvPresets/{safeDocId(layoutSignature)}
users/{uid}/households/{householdId}   UserHouseholdLink
users/{uid}/profile/current            UserProfile
```

Normal saves diff the active revision and commit its changed documents, settings, and manifest in
one Firestore transaction. Large replacements stage a complete new revision in bounded batches and
publish it only after every batch succeeds, so readers never observe a half-written reset/import.
Every manifest write has a unique `versionToken`; the transaction rejects a stale client even when
two writes share a timestamp. The former root split collections remain read-only migration input
until the first revisioned save.

Firebase Auth identifies users; household membership controls Firestore access. Roles are `owner`
and `member`; both can read/write household data, while owner-only metadata changes are enforced by
Firestore rules. `users/{uid}/profile/current` stores non-financial cross-device state such as active
household, privacy mode, last view, filters, and the user's last weekly check-in per household.

`App.tsx` shows an authentication gate until Firebase Auth reports a signed-in Google user. After
sign-in, the user must create or join a household before onboarding or dashboard data can be edited.
If a legacy `mizan_v2` or `trackr_v1` browser payload is found, only an explicitly created new
household receives it. Joining or switching never overwrites an existing household, and the browser
financial keys are cleared only after the Firestore save succeeds.

**Migration.** `migrate()` normalizes any known shape into v14; unrelated junk degrades to empty
data, while a newer schema fails loudly so an older client cannot discard unknown fields. Legacy
data (schema v4, or a v1 "trackr" backup) seeds members from ids already present
and pins the previous currency. v5 → v6 adds movement kinds, v6 → v7 adds income portions, v7 → v8
adds stable account identity/currency, v8 → v9 adds shared contributions, v9 → v10 adds multi-expense
contribution allocations, and v10 → v11 repairs foreign-income receipt currency when the evidence is
decisive. v11 → v12 separates purpose from beneficiary across transactions, fixed commitments, and
merchant rules: a valid `personal:<memberId>` becomes `category: "uncategorized"` plus that member,
previously classified shared-purpose categories remain Household, and uncategorized/missing beneficiaries
remain Unassigned. Existing accounts start with `beneficiaryDefault: "review"`; choosing a policy fills only
unlocked Unassigned rows, while explicit Household/member history stays untouched. Split-cloud v4 hydrates
as pre-beneficiary data, v5 round-trips account policies, rule policies, and beneficiary provenance,
v12 → v13 defaults existing fixed commitments to `kind: "expense"`, and v13 → v14 defaults income
portions to monthly/ordinary while conservatively snapshotting receipt metadata. Split-cloud v7 retains
scheduled income and protected-budget semantics.
The migrator preserves statement provenance, movement semantics, contribution evidence, and locked one-row
classifications. Fresh data with no member list triggers onboarding.

History uses confirmed receipts in the month where they were recorded. Monthly sources without receipts
use current expectations; scheduled one-offs use their estimate only before the arrival deadline and zero
after becoming overdue. History annotates one-off and protected amounts explicitly.

## Determinism guarantees

- Same statement/CSV + same rules/settings ⇒ identical import result (dedupe by
  date|merchant|amount|account signature).
- Imported rows and id-less legacy records receive deterministic content identities.
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
