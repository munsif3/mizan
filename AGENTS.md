# Mizan agent guide

This file applies to the repository root and every descendant directory unless a more specific `AGENTS.md` exists below it.

## Core working rule: use a bounded working set

Do not scan or read the whole repository by default. Mizan is large enough that a complete codebase review is usually slower and less accurate than following the relevant seam.

For each task:

1. Translate the request into one concrete behavior, module, or user surface.
2. Read only the controlling material needed for that behavior:
   - the relevant section of `ARCHITECTURE.md` for product, data, or finance semantics;
   - the relevant section of `README.md` for setup, runtime, privacy, or deployment;
   - the likely implementation file and its nearest test.
3. Search for exact symbols, visible copy, imports, or callers inside the smallest plausible directory. Prefer `rg -n "symbol" src/domain` or `rg -n "visible text" src/ui` over an unscoped repository search.
4. Establish a small working set. As a default exploration budget, inspect no more than six code/test files and use no more than eight discovery commands before either editing or explaining why another dependency hop is necessary.
5. Stop exploring as soon as the edit seam, governing contract, and validation command are known.
6. Expand one dependency hop at a time only when an import/caller proves it relevant, a test failure points there, the change crosses a schema/security boundary, or the user explicitly requests a whole-app audit.

Do not repeatedly reopen unchanged files or rerun equivalent searches. Before broadening a search, identify the unanswered question that the search will resolve.

For an explicit repository-wide request, start with a filename inventory and targeted pattern searches. Do not read every file merely because the requested outcome spans the app.

### Avoid expensive default discovery

- Do not run recursive file-content reads, unbounded `Get-ChildItem -Recurse`, or broad searches from a parent workspace.
- Do not inspect `node_modules/`, `dist/`, `.git/`, `.firebase/`, coverage output, generated assets, or `package-lock.json` unless the task specifically concerns them.
- Do not read all of `ARCHITECTURE.md` on every task. Use its headings and open the relevant section.
- Do not run the entire test suite merely to discover where a feature lives.
- Do not turn a focused fix into an unsolicited architecture, cleanup, security, or UI audit.

## Source of truth and precedence

- Follow the user's current request first, then this guide, then the relevant repository documentation.
- `ARCHITECTURE.md` is authoritative for product boundaries, domain semantics, the data model, and module ownership.
- `README.md` is authoritative for supported setup, privacy behavior, and documented operator workflows.
- Existing code and tests show the current implementation. If they disagree with the architecture, surface the conflict rather than silently choosing a new rule.
- Preserve user-authored and unrelated worktree changes. Do not rewrite or discard them to simplify a task.

## Repository map

Use this map to choose the first directory; do not traverse every directory first.

- `src/app/`: application orchestration and sync-state helpers.
- `src/auth/`: Firebase authentication and sign-in state.
- `src/domain/`: pure financial/domain logic and its focused tests.
- `src/firebase/`: Firebase client initialization.
- `src/household/`: household metadata, access flows, and the Firestore household repository.
- `src/import/`: statement parsers, parser registry, PDF helpers, CSV parsing/mapping, and focused tests.
- `src/platform/`: diagnostics and runtime error boundaries.
- `src/security/`: client-side safety and resource limits.
- `src/storage/`: schema, migrations, backup, repository contracts, and legacy migration helpers.
- `src/styles/`: shared style-system layers.
- `src/ui/`: React screens, modals, and UI tests; business arithmetic does not belong here.
- `src/App.tsx`: top-level composition. Open it only when wiring or app-wide state flow is relevant.
- `src/App.bootstrap.test.tsx`: signed-in bootstrap and initial-load behavior.
- `src/App.test.tsx`: cross-surface application behavior.
- `tests/firestore.rules.test.ts`: Firestore authorization behavior.
- `firestore.rules`: deployed Firestore access policy.
- `scripts/style-system.test.mjs`: style-system guardrails.

### First files by task type

- Finance totals, classifications, settlement, movement types, income, or lifecycle: start in the matching `src/domain/*.ts` file and its `*.test.ts`.
- A screen or modal: start with the matching `src/ui/*` component, its test, and only the directly related style file.
- Startup, save status, or sync behavior: start in `src/app/`, then follow concrete calls into `src/household/` or `src/storage/`.
- Statement or CSV import: start with the specific parser/mapping file and its test. Read `src/import/registry.ts` only when dispatch or registration changes.
- Schema or migration work: start with `src/storage/schema.ts` and its tests, then inspect consumers named by the changed type.
- Firebase authorization: start with `firestore.rules` and `tests/firestore.rules.test.ts`; do not infer deployed behavior from UI code.
- Styling: start with the rendered component and relevant `src/styles/` file, then run the style-system check.

## Product and finance invariants

Preserve these unless the user explicitly approves an architecture change:

- Mizan has three primary screens: Home, Transactions, and History. Settings remains modal rather than a fourth destination.
- Financial behavior is deterministic. Do not add AI classification or hidden financial-data services.
- Statements, passwords, and raw imported files are processed locally and never uploaded.
- Firestore household data is authoritative for live financial state. Browser storage is limited to non-financial convenience state and one-time legacy migration input.
- Financial arithmetic and classification rules belong in pure domain functions, with tests. UI components render results and coordinate actions; they do not independently reproduce money math.
- `Transaction.kind`, not the bank debit/credit sign, determines whether a row counts as spend.
- Statement credits are provenance/evidence; income resolution remains separate so credits are not counted twice.
- Purpose/category, beneficiary, paying account, and contribution evidence are distinct concepts. Preserve explicit classifications and their precedence.
- Importers fail clearly for unsupported formats. Do not add a speculative generic parser that can turn unknown data into plausible but incorrect transactions.
- Schema changes require an explicit versioned migration and backward-compatibility tests. Never rewrite historical financial meaning silently.
- Do not put personal figures, real identities, credentials, Firebase debug tokens, or statement fixtures containing private data in source control or logs.

When a requested change appears to conflict with one of these invariants, explain the conflict with a concrete code/document reference before implementing it.

## Implementation discipline

- Make the smallest coherent change that fully handles the request, including directly affected tests and supporting UI states.
- Prefer existing seams and pure helpers over parallel logic. Consolidate duplication when it is within the task's path and safely covered by tests.
- Do not refactor unrelated modules just because they are nearby. Record a concise follow-up note if discovered debt matters.
- Keep TypeScript strict. Avoid `any`, non-null assertions, and silent fallbacks unless an external boundary makes them unavoidable and the behavior is tested.
- Keep finance operations deterministic and side effects at repository/UI boundaries.
- Treat parser input, imports, backups, and cloud data as untrusted. Preserve validation and resource limits.
- Reuse the existing npm lockfile and package manager. Do not add or upgrade dependencies unless the request requires it.
- Do not edit generated `dist/` output by hand.
- Do not commit, push, deploy, modify live Firebase state, or change secrets unless the user explicitly asks for that external action.

## Verification ladder

Use the narrowest gate that proves the change, then widen only in proportion to risk. This repository is used from Windows PowerShell, so prefer `npm.cmd` over the PowerShell `npm.ps1` shim.

1. Run the nearest test while iterating:
   - `npm.cmd test -- src/domain/summary.test.ts`
   - `npm.cmd test -- src/ui/ImportModal.test.tsx`
2. For cross-file TypeScript changes, run `npm.cmd run typecheck`.
3. For style changes, run `npm.cmd run check:styles` plus the affected component test.
4. For import, schema, summary, sync, or other financial-boundary changes, run the focused tests first, then `npm.cmd test` when the change has multiple consumers.
5. For production-path or cross-cutting changes, run `npm.cmd run build` after tests.
6. Run `npm.cmd run check` only for broad/high-risk changes or when the user asks for the full local gate.
7. Run `npm.cmd run test:rules` only when `firestore.rules` or its authorization assumptions change; it requires Java and the Firebase emulator.
8. Run `npm.cmd run check:deadcode` for structural deletions or consolidation where unused exports are a realistic risk.

Documentation-only edits do not need the application test suite. Do not rerun an unchanged successful gate without a reason. If an environment limitation blocks a relevant check, report the exact unverified boundary rather than implying it passed.

## Communication and completion

- For multi-step work, state a short plan and keep only one step active at a time.
- During discovery, name the current working set and the question being answered. If the set must expand beyond the default budget, say why before continuing.
- Ask the user only when a material product choice cannot be resolved from the request, architecture, code, or tests.
- A task is complete when the requested behavior is implemented, the nearest relevant tests pass, wider checks match the risk, and the final response lists changed files plus any honest verification gap.
- Before handing off code changes, inspect the focused diff and repository status so unrelated files are neither included nor claimed.
