import { uid, type Transaction } from "../domain/types";

/**
 * NTB's savings/current-account statement builds its transaction tables at
 * render time from JS data pushed into arrays (`savingsDataList`/`stData`,
 * `currentDataList`/`ctData`), not from static `<table>` rows — the same
 * situation as the card statement (see ntbAmexHtml.ts). Rather than parse
 * JavaScript, we isolate each `X.push({ ... })` call's object literal by
 * balanced-brace scanning and pull known fields out of it with per-key
 * regexes — deterministic, no `eval`/`Function`.
 *
 * The scan is string-aware (tracks whether it's inside a `"..."` value and
 * skips `\`-escaped characters there) so a brace or quote inside a
 * transaction description — a reference/memo field can contain either —
 * doesn't truncate the object literal early.
 */
function pushedObjectBlocks(html: string, callPrefix: string): string[] {
  const blocks: string[] = [];
  let from = 0;
  for (;;) {
    const callIndex = html.indexOf(callPrefix, from);
    if (callIndex < 0) break;
    const braceStart = html.indexOf("{", callIndex);
    if (braceStart < 0) break;
    let depth = 0;
    let end = -1;
    let inString = false;
    for (let i = braceStart; i < html.length; i++) {
      const ch = html[i];
      if (inString) {
        if (ch === "\\") i++; // skip the escaped character, whatever it is
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end < 0) break;
    blocks.push(html.slice(braceStart, end + 1));
    from = end + 1;
  }
  return blocks;
}

/** Matches a `"..."` value allowing `\"`-escaped quotes inside it. */
function field(block: string, key: string): string {
  const quoted = block.match(new RegExp(`${key}\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
  if (quoted) return quoted[1]!.replace(/\\(.)/g, "$1");
  const bare = block.match(new RegExp(`${key}\\s*:\\s*(-?[\\d.]+)`));
  return bare ? bare[1]! : "";
}

/**
 * One account's worth of `X.push({...})` transaction blocks, split out by the
 * `var <resetVar> = [];` markers that precede each account's batch — verified
 * against a real statement to align 1:1 with that account's summary push.
 */
function transactionSegments(html: string, resetVar: string): string[] {
  return html.split(new RegExp(`var\\s+${resetVar}\\s*=\\s*\\[\\]\\s*;?`)).slice(1);
}

interface DepositAccountGroup {
  accounts: string[]; // one raw account-number/type label per account, in file order
  transactionBlocks: string[][]; // per-account list of transaction object-literal blocks
}

/**
 * `prefix` is NTB's field-naming convention for this account type ("savings"
 * or "current"): `${prefix}AccountNo`, `${prefix}AccountType`,
 * `${prefix}TransactionDetails`. The unprefixed fields (`transactionDateFull`,
 * `transactionDebit`, `transactionCredit`, `runningTotal`) are shared, per the
 * verified savings structure.
 *
 * `accounts` and `transactionBlocks` are derived independently — one from
 * `X.push({...})` account-summary calls, the other from splitting on
 * `var <resetVar> = [];` reset markers — and matched up purely by position.
 * That 1:1 correspondence is verified against a real statement (including
 * zero-transaction accounts, which still get their own empty reset/segment),
 * but nothing in the source guarantees it holds for every statement. If the
 * counts ever disagree there is no reliable way to say which segment belongs
 * to which account, so this throws rather than silently truncating and
 * risking a transaction attributed to the wrong bank account.
 */
function extractDepositGroup(html: string, prefix: "savings" | "current", listVar: string, resetVar: string): DepositAccountGroup {
  const accountBlocks = pushedObjectBlocks(html, `${listVar}.push(`);
  const accounts = accountBlocks.map(
    (block) => field(block, `${prefix}AccountNo`) || field(block, `${prefix}AccountType`),
  );
  const segments = transactionSegments(html, resetVar);
  if (segments.length !== accounts.length) {
    throw new Error(
      `Found ${accounts.length} ${prefix} account(s) but ${segments.length} transaction batch(es) in the statement — ` +
        "can't reliably match transactions to the right account.",
    );
  }
  // Each segment also contains the trailing `${listVar}.push({...})` account-summary
  // call that follows its transactions (see the doc comment on parseDepositStatement) —
  // search for `${resetVar}.push(` specifically so that summary block isn't picked up
  // as a (bogus, unparseable) transaction block.
  const transactionBlocks = segments.map((segment) => pushedObjectBlocks(segment, `${resetVar}.push(`));
  return { accounts, transactionBlocks };
}

function transactionFromBlock(block: string, prefix: "savings" | "current", accountLabel: string): Transaction | null {
  const dateFull = field(block, "transactionDateFull"); // "DD-MM-YYYY"
  const details = field(block, `${prefix}TransactionDetails`).trim();
  const debit = Number(field(block, "transactionDebit") || 0);
  const credit = Number(field(block, "transactionCredit") || 0);

  const dateMatch = dateFull.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (!dateMatch || !details) return null;
  const date = `${dateMatch[3]}-${dateMatch[2]!.padStart(2, "0")}-${dateMatch[1]!.padStart(2, "0")}`;

  const direction = credit > 0 ? "credit" : "debit";
  const amount = direction === "credit" ? credit : debit;
  if (!amount || amount < 0) return null;

  return {
    id: uid("txn"),
    date,
    description: details,
    amount: Number(amount.toFixed(2)),
    category: "uncategorized",
    account: accountLabel,
    note: "",
    source: "imported",
    direction,
  };
}

/**
 * Parses NTB's combined savings/current-account statement. Unlike the card
 * statement, credit rows (deposits, transfers in, salary) are kept, not
 * dropped — this statement is the account's full history, not a spend-only
 * card ledger.
 *
 * The savings-account path (`savingsDataList`/`stData`) is verified against a
 * real statement. The current-account path (`currentDataList`/`ctData`) is
 * built by field-naming analogy with the savings path (NTB's own naming
 * convention is consistent throughout the file) but has not yet been checked
 * against a statement that actually has current-account transactions — this
 * user's sample statement had an empty current-account section. If a future
 * statement with real current-account data fails to import, check the actual
 * field names in its decrypted HTML against this file's assumptions first.
 */
export function parseDepositStatement(html: string, fallbackAccount: string): Transaction[] {
  const groups: { prefix: "savings" | "current"; group: DepositAccountGroup; label: string }[] = [
    { prefix: "savings", group: extractDepositGroup(html, "savings", "savingsDataList", "stData"), label: "NTB Savings" },
    { prefix: "current", group: extractDepositGroup(html, "current", "currentDataList", "ctData"), label: "NTB Current" },
  ];

  const transactions: Transaction[] = [];
  for (const { prefix, group, label } of groups) {
    group.accounts.forEach((accountNo, index) => {
      const accountLabel = accountNo ? `${label} ${accountNo}` : fallbackAccount;
      const blocks = group.transactionBlocks[index] ?? [];
      const parsed = blocks
        .map((block) => transactionFromBlock(block, prefix, accountLabel))
        .filter((txn): txn is Transaction => txn !== null);
      // Real transaction data was found for this account but none of it parsed —
      // almost certainly a field-naming mismatch (the current-account path is
      // unverified, see the doc comment above). Fail loudly instead of quietly
      // reporting a successful import that's missing this account's history.
      if (blocks.length > 0 && parsed.length === 0) {
        throw new Error(
          `Found ${blocks.length} transaction(s) for ${accountLabel} but couldn't read any of them — ` +
            `the ${prefix === "current" ? "current-account" : "savings"} statement format may have changed.`,
        );
      }
      transactions.push(...parsed);
    });
  }

  if (!transactions.length) {
    throw new Error("Decrypted the file, but found no savings/current-account transactions in a known format.");
  }
  return transactions;
}
