import { useEffect, useLayoutEffect, useState } from "react";
import { categoryOptions } from "../domain/categories";
import type { AppData } from "../domain/types";
import type { ThemePreference } from "../household/types";
import type { LedgerFilters } from "../ui/TransactionsView";
import { readLocalConvenience, writeLocalConvenience } from "./localConvenience";
import type { BootstrapPhase } from "./useHouseholdSession";

const PRIVACY_KEY = "mizan.privacy";
const THEME_KEY = "mizan.theme";

export const EMPTY_LEDGER_FILTERS: LedgerFilters = {
  category: "all",
  beneficiary: "all",
  payer: "all",
};

function initialTheme(): ThemePreference {
  const saved = readLocalConvenience(THEME_KEY);
  if (saved === "light" || saved === "dark") return saved;
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/**
 * Device-local UI preferences: the privacy toggle, theme, and ledger filters.
 * Privacy and theme persist to localStorage (and theme drives the document
 * chrome); ledger filters are kept valid against the loaded household's members
 * and categories. None of this is authoritative financial data.
 */
export function useBrowserPreferences(data: AppData, bootstrapPhase: BootstrapPhase) {
  const [privacy, setPrivacy] = useState(() => readLocalConvenience(PRIVACY_KEY) === "true");
  const [theme, setTheme] = useState<ThemePreference>(initialTheme);
  const [ledgerFilters, setLedgerFilters] = useState<LedgerFilters>(EMPTY_LEDGER_FILTERS);

  useEffect(() => {
    writeLocalConvenience(PRIVACY_KEY, String(privacy));
  }, [privacy]);

  useLayoutEffect(() => {
    writeLocalConvenience(THEME_KEY, theme);
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute(
      "content",
      theme === "dark" ? "#0f1713" : "#f1eee5",
    );
  }, [theme]);

  useEffect(() => {
    if (bootstrapPhase !== "ready") return;
    const validCategories = new Set(categoryOptions(data.settings.customCategories).map((option) => option.key));
    const validMembers = new Set(data.settings.members.map((member) => member.id));
    setLedgerFilters((current) => {
      const category = current.category !== "all" && !validCategories.has(current.category) ? "all" : current.category;
      const beneficiary = current.beneficiary.startsWith("member:")
        && !validMembers.has(current.beneficiary.slice("member:".length)) ? "all" : current.beneficiary;
      const payer = current.payer.startsWith("member:")
        && !validMembers.has(current.payer.slice("member:".length)) ? "all" : current.payer;
      return category === current.category && beneficiary === current.beneficiary && payer === current.payer
        ? current
        : { category, beneficiary, payer };
    });
  }, [bootstrapPhase, data.settings.members, data.settings.customCategories]);

  return { privacy, setPrivacy, theme, setTheme, ledgerFilters, setLedgerFilters };
}
