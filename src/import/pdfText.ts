// The "legacy" build (rather than the default browser build) is used because it
// polyfills canvas APIs (DOMMatrix, etc.) that jsdom doesn't provide, so the same
// import works under both the real browser (Vite build) and Vitest (jsdom/Node).
import { GlobalWorkerOptions, PasswordResponses, getDocument, type PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";

/** The subset of pdf.js's TextItem we rely on (it isn't part of the package's public type exports). */
interface PositionedTextItem {
  str: string;
  transform: number[];
  width?: number;
}
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";
import { assertPdfPageCount, assertStatementFiles } from "../security/resourceLimits";

// Only point at the bundled worker when a real Worker is available (the browser
// build/runtime). Under Vitest/jsdom there is no Worker, and pdf.js's own
// no-worker fallback handles that case correctly if left untouched.
if (typeof Worker !== "undefined") {
  GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
}

/** One text run with the horizontal span it occupies, used to rebuild columns. */
export interface PdfCell {
  x: number;
  width: number;
  text: string;
}

export interface PdfLine {
  y: number;
  /** cells left-to-right; a "cell" is a run of text items that sit close together on the same line */
  cells: string[];
  /**
   * The same runs with their horizontal spans kept. Bank-specific parsers read
   * `cells`; generic table reconstruction needs the geometry, because which
   * column a run belongs to is a fact about position, not order.
   */
  positioned: PdfCell[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function destroyLoadingTask(loadingTask: ReturnType<typeof getDocument>): Promise<void> {
  try {
    await loadingTask.destroy();
  } catch {
    // Teardown is best-effort: it must not discard parsed transactions or
    // replace the useful open/parse error that the caller should receive.
  }
}

/**
 * Open a (possibly password-protected) PDF, use it, and always release its
 * worker/loading task. Keeping task ownership here prevents callers from
 * mistaking PDFDocumentProxy for the object that owns `destroy()`.
 */
export async function withPdf<T>(
  file: File,
  password: string,
  useDocument: (doc: PDFDocumentProxy) => Promise<T>,
): Promise<T> {
  assertStatementFiles([file]);
  let data: ArrayBuffer;
  try {
    data = await file.arrayBuffer();
  } catch (error) {
    throw new Error(`Could not open PDF: ${errorMessage(error)}`);
  }

  const loadingTask = getDocument({ data, password: password || undefined });
  // Fail fast instead of pdf.js's default of prompting again for another password.
  loadingTask.onPassword = (_callback: (password: string) => void, reason: number) => {
    throw reason === PasswordResponses.INCORRECT_PASSWORD
      ? new Error("Incorrect password.")
      : new Error("This PDF is password protected.");
  };

  let doc: PDFDocumentProxy;
  try {
    doc = await loadingTask.promise;
    assertPdfPageCount(doc.numPages);
  } catch (error) {
    await destroyLoadingTask(loadingTask);
    throw new Error(`Could not open PDF: ${errorMessage(error)}`);
  }

  try {
    return await useDocument(doc);
  } finally {
    await destroyLoadingTask(loadingTask);
  }
}

/**
 * Extract text from every page as reconstructed rows: text items are grouped by
 * y-coordinate (same visual line) and ordered left-to-right by x-coordinate, since
 * pdf.js gives positioned text items, not tables/rows.
 */
export async function extractLines(doc: PDFDocumentProxy): Promise<PdfLine[]> {
  const lines: PdfLine[] = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    // pdf.js's TextItem type isn't part of this package's public type exports, so we
    // narrow structurally at runtime ("str" only exists on TextItem, not TextMarkedContent)
    // and cast rather than fight the exported union's type predicate assignability.
    const items = content.items.filter(
      (item) => "str" in item && Boolean(item.str.trim()),
    ) as PositionedTextItem[];

    const rows = new Map<number, PdfCell[]>();
    for (const item of items) {
      const y = Math.round(item.transform[5] ?? 0);
      const bucket = [...rows.keys()].find((existingY) => Math.abs(existingY - y) <= 2) ?? y;
      const row = rows.get(bucket) ?? [];
      row.push({ x: item.transform[4] ?? 0, width: Math.max(0, Number(item.width) || 0), text: item.str.trim() });
      rows.set(bucket, row);
    }

    const pageLines = [...rows.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([y, entries]) => {
        const positioned = entries.sort((a, b) => a.x - b.x).filter((entry) => entry.text);
        return { y, cells: positioned.map((entry) => entry.text), positioned };
      });
    lines.push(...pageLines);
  }
  return lines;
}
