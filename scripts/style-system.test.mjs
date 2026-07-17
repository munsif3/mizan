import fs from "node:fs";
import path from "node:path";
import postcss from "postcss";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const workspace = process.cwd();
const styleDirectory = path.join(workspace, "src/styles");
const styleFiles = ["tokens.css", "base.css", "components.css", "views.css"];
const dynamicClassTokens = new Set([
  "button-default", "button-compact",
  "button-primary", "button-secondary", "button-ghost", "button-danger",
  "success", "info", "up", "down", "due", "overdue", "upcoming", "received",
]);

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx") ? [full] : [];
  });
}

function staticClassTokens() {
  const tokens = new Set();
  const addText = (value) => {
    for (const token of value.split(/\s+/)) {
      if (/^-?[_a-zA-Z]+[\w-]*$/.test(token) && !token.endsWith("-")) tokens.add(token);
    }
  };

  const collectStrings = (node) => {
    if (ts.isStringLiteralLike(node)) {
      addText(node.text);
      return;
    }
    if (ts.isTemplateExpression(node)) {
      addText(node.head.text);
      for (const span of node.templateSpans) {
        collectStrings(span.expression);
        addText(span.literal.text);
      }
      return;
    }
    if (ts.isConditionalExpression(node)) {
      collectStrings(node.whenTrue);
      collectStrings(node.whenFalse);
      return;
    }
    if (ts.isBinaryExpression(node)) {
      collectStrings(node.left);
      collectStrings(node.right);
      return;
    }
    if (ts.isParenthesizedExpression(node)) {
      collectStrings(node.expression);
      return;
    }
    if (ts.isCallExpression(node) || ts.isPropertyAccessExpression(node)) {
      collectStrings(node.expression);
      return;
    }
    if (ts.isArrayLiteralExpression(node)) {
      for (const element of node.elements) collectStrings(element);
    }
  };

  for (const file of sourceFiles(path.join(workspace, "src"))) {
    const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node) => {
      if (ts.isJsxAttribute(node) && node.name.getText(source) === "className" && node.initializer) {
        if (ts.isStringLiteral(node.initializer)) addText(node.initializer.text);
        else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) collectStrings(node.initializer.expression);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  for (const token of dynamicClassTokens) tokens.add(token);
  return tokens;
}

function stylesheetInventory() {
  const selectorOwners = new Map();
  const contextualSelectors = new Map();
  const mediaBlocks = new Map();
  const cssClasses = new Set();
  const rawColors = [];
  const misplacedImportant = [];
  for (const file of styleFiles) {
    const css = fs.readFileSync(path.join(styleDirectory, file), "utf8");
    const root = postcss.parse(css, { from: file });
    for (const node of root.nodes) {
      if (node.type !== "atrule" || node.name !== "media") continue;
      const key = `${file}: ${node.params}`;
      mediaBlocks.set(key, (mediaBlocks.get(key) ?? 0) + 1);
    }
    root.walkRules((rule) => {
      const context = rule.parent.type === "atrule" && rule.parent.name === "media"
        ? `@media ${rule.parent.params}`
        : "root";
      for (const selector of rule.selectors) {
        const normalized = selector.trim().replace(/\s+/g, " ");
        const owners = selectorOwners.get(normalized) ?? new Set();
        owners.add(file);
        selectorOwners.set(normalized, owners);
        const contextualKey = `${file}: ${context}: ${normalized}`;
        contextualSelectors.set(contextualKey, (contextualSelectors.get(contextualKey) ?? 0) + 1);
        for (const match of normalized.matchAll(/\.(-?[_a-zA-Z]+[\w-]*)/g)) cssClasses.add(match[1]);
      }
    });
    if (file !== "tokens.css") {
      root.walkDecls((declaration) => {
        if (/(#[0-9a-f]{3,8}\b|\b(?:rgb|hsl)a?\()/i.test(declaration.value)) {
          rawColors.push(`${file}:${declaration.source.start.line} ${declaration.prop}: ${declaration.value}`);
        }
        const reducedMotion = declaration.parent.parent?.type === "atrule"
          && declaration.parent.parent.name === "media"
          && declaration.parent.parent.params.includes("prefers-reduced-motion");
        if (declaration.important && !reducedMotion) {
          misplacedImportant.push(`${file}:${declaration.source.start.line} ${declaration.prop}`);
        }
      });
    }
  }
  return { selectorOwners, contextualSelectors, mediaBlocks, cssClasses, rawColors, misplacedImportant };
}

describe("Quiet Ledger style-system ownership", () => {
  it("imports only the four canonical stylesheets", () => {
    const imports = fs.readFileSync(path.join(styleDirectory, "index.css"), "utf8")
      .match(/@import\s+url\("\.\/(.+?)"\);/g) ?? [];
    expect(imports).toEqual(styleFiles.map((file) => `@import url("./${file}");`));
    expect(fs.existsSync(path.join(workspace, "src/styles.css"))).toBe(false);
    expect(fs.existsSync(path.join(workspace, "src/ledger.css"))).toBe(false);
  });

  it("has no legacy tokens or cross-file selector ownership conflicts", () => {
    const { selectorOwners } = stylesheetInventory();
    const conflicts = [...selectorOwners]
      .filter(([, owners]) => owners.size > 1)
      .map(([selector, owners]) => `${selector}: ${[...owners].join(", ")}`);
    const combined = styleFiles.map((file) => fs.readFileSync(path.join(styleDirectory, file), "utf8")).join("\n");
    expect(combined).not.toContain("--ledger-");
    expect(conflicts).toEqual([]);
  });

  it("keeps one selector owner per context and one block per breakpoint", () => {
    const { contextualSelectors, mediaBlocks } = stylesheetInventory();
    const duplicates = [...contextualSelectors].filter(([, count]) => count > 1).map(([key]) => key);
    const fragmentedBreakpoints = [...mediaBlocks].filter(([, count]) => count > 1).map(([key]) => key);
    expect(duplicates).toEqual([]);
    expect(fragmentedBreakpoints).toEqual([]);
  });

  it("uses semantic color tokens and limits important overrides to reduced motion", () => {
    const { rawColors, misplacedImportant } = stylesheetInventory();
    expect(rawColors).toEqual([]);
    expect(misplacedImportant).toEqual([]);
  });

  it("styles every static class used by the UI", () => {
    const { cssClasses } = stylesheetInventory();
    const missing = [...staticClassTokens()].filter((token) => !cssClasses.has(token)).sort();
    expect(missing).toEqual([]);
  });

  it("does not retain selectors for classes the UI never emits", () => {
    const { cssClasses } = stylesheetInventory();
    const emittedClasses = staticClassTokens();
    const unused = [...cssClasses].filter((token) => !emittedClasses.has(token)).sort();
    expect(unused).toEqual([]);
  });

  it("keeps the readable source cascade within the cleanup budget", () => {
    const lines = styleFiles.reduce((total, file) => (
      total + fs.readFileSync(path.join(styleDirectory, file), "utf8").split(/\r?\n/).length - 1
    ), 0);
    expect(lines).toBeLessThanOrEqual(4_500);
  });
});
