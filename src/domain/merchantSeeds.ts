import { matchingKey } from "./rules";
import type { CategoryKey } from "./types";

/**
 * Starter purpose suggestions for merchants the household has not taught yet.
 *
 * This is a static lookup table, not a classifier: it only ever *pre-selects a
 * dropdown* in the review queue. It never writes a merchant rule, never touches a
 * transaction, and never overrides something the household already decided. The
 * user still teaches each merchant exactly once (ADR #5) — a seed just means the
 * answer is already filled in, so the decision costs a tap instead of a search
 * through the category list. A wrong seed costs one dropdown change, which is
 * precisely what an unseeded merchant costs today.
 *
 * Matching is substring-based via `matchingKey`, because statement text carries
 * branch and location suffixes. Keys must be canonical (upper case, single
 * spaced) — `merchantSeeds.test.ts` enforces that.
 *
 * Nesting is deliberate and safe: longest-match-wins means "UBER EATS" resolves
 * to dining while a bare "UBER" resolves to transport, without either entry
 * knowing about the other. Prefer distinctive keys; a short token like "SHELL"
 * would collide with unrelated merchants and is left out on purpose.
 *
 * Provenance: entries marked (fixture) appear in this repo's statement parser
 * tests, so they are known-real statement text. The rest are widely recognizable
 * brands. This table is a starting point, not a claim about any household's
 * actual merchants — the moment a user confirms anything, their own rule wins.
 */
export const MERCHANT_SEEDS: Readonly<Record<string, CategoryKey>> = {
  // --- Groceries -----------------------------------------------------------
  "KEELLS": "food", // (fixture) KEELLS SUPER, KEELLS SUPER WATTALA
  "LEGACY MARKET": "food", // (fixture)
  "CARGILLS": "food",
  "FOOD CITY": "food",
  "ARPICO": "food",
  "GLOMARK": "food",
  "SATHOSA": "food",
  "LAUGFS SUPER": "food", // narrower than the fuel/gas business of the same brand
  "SUPERMARKET": "food",
  "GROCER": "food",

  // --- Dining --------------------------------------------------------------
  "UBER EATS": "dining", // (fixture) must outrank the bare UBER transport entry
  "THE FAB": "dining", // (fixture) THE FAB COLOMBO 03
  "PICKME FOOD": "dining",
  "KFC": "dining",
  "PIZZA HUT": "dining",
  "DOMINO": "dining",
  "MCDONALD": "dining",
  "BURGER KING": "dining",
  "STARBUCKS": "dining",
  "BARISTA": "dining",
  "COFFEE BEAN": "dining",
  "RESTAURANT": "dining",
  "CAFE": "dining",
  "BAKERY": "dining",

  // --- Transport -----------------------------------------------------------
  "UBER": "transport", // (fixture, via UBER EATS) plain rides
  "PICKME": "transport",
  "CEYPETCO": "transport",
  "LANKA IOC": "transport",
  "PETROL": "transport",
  "FUEL": "transport",
  "PARKING": "transport",
  "RAILWAY": "transport",
  "SLTB": "transport",

  // --- Bills & utilities ---------------------------------------------------
  "DIALOG": "utilities", // (fixture) Dialog Axiata PLC Colombo 02
  "MOBITEL": "utilities",
  "HUTCH": "utilities",
  "AIRTEL": "utilities",
  "SLT": "utilities",
  "LECO": "utilities",
  "NWSDB": "utilities",
  "WATER BOARD": "utilities",
  "ELECTRICITY": "utilities",
  "BROADBAND": "utilities",
  "INTERNET BILL": "utilities",

  // --- Health --------------------------------------------------------------
  "PHARMACY": "health",
  "HOSPITAL": "health",
  "ASIRI": "health",
  "NAWALOKA": "health",
  "DURDANS": "health",
  "MEDICAL": "health",
  "CLINIC": "health",
  "DENTAL": "health",
  "LABORATORY": "health",

  // --- Lifestyle -----------------------------------------------------------
  "YOUTUBE": "lifestyle", // (fixture) GOOGLE YOUTUBE, FX FEE Google YouTube ...
  "GOOGLE": "lifestyle",
  "NETFLIX": "lifestyle",
  "SPOTIFY": "lifestyle",
  "DISNEY": "lifestyle",
  "AMAZON": "lifestyle",
  "APPLE.COM": "lifestyle",
  "ITUNES": "lifestyle",
  "ADOBE": "lifestyle",
  "MICROSOFT": "lifestyle",
  "OPENAI": "lifestyle",
  "ANTHROPIC": "lifestyle",
  "STEAMGAMES": "lifestyle",
  "SPA CEYLON": "lifestyle",
  "ODEL": "lifestyle",
  "NOLIMIT": "lifestyle",
  "HAMEEDIA": "lifestyle",
  "CINEMA": "lifestyle",
  "FITNESS": "lifestyle",
  "SALON": "lifestyle",

  // --- Housing -------------------------------------------------------------
  "RENT PAYMENT": "housing",
};

/**
 * The starter table's purpose suggestion for a statement description, or null
 * when nothing matches. Suggestion only — callers must not persist this without
 * the user confirming it.
 */
export function seededCategory(description: string): CategoryKey | null {
  const key = matchingKey(description, Object.keys(MERCHANT_SEEDS));
  return key ? MERCHANT_SEEDS[key] ?? null : null;
}
