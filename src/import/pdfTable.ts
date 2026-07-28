import { extractLines, withPdf, type PdfCell, type PdfLine } from "./pdfText";

/**
 * How far apart two text runs must be, horizontally, before they are treated as
 * belonging to different columns. PDF units are points, so this is roughly a
 * character width: narrower and ordinary word gaps split a description into
 * several columns, wider and a narrow column merges into its neighbour.
 */
const COLUMN_GAP = 6;

/** A reconstruction that produced more columns than this is noise, not a table. */
const MAX_COLUMNS = 40;

interface ColumnBand {
  start: number;
  end: number;
}

export interface ReconstructedTable {
  /** Rows of equal length, ready for the same mapper the CSV route uses. */
  rows: string[][];
  bands: ColumnBand[];
  /**
   * Stable key for this statement layout. Derived from the column geometry, so
   * next month's statement from the same bank reuses the saved mapping while a
   * different bank's layout gets its own.
   */
  signature: string;
}

/**
 * Fraction of lines that must cover a horizontal position before it counts as
 * being inside a column rather than under a one-off banner.
 */
const COVERAGE_SHARE = 0.1;

/**
 * Group runs into column bands by how often each horizontal position is covered.
 *
 * Merging raw spans does not work: alignment is mixed (dates and descriptions
 * left-aligned, amounts right-aligned against a fixed right edge), and merging
 * is transitive, so a single page-wide title bridges two real columns into one.
 * Counting coverage instead means a banner that appears on one line cannot
 * outvote a column that appears on every line, while spans in a genuine column
 * reinforce the same positions however they are aligned.
 */
function columnBands(lines: PdfLine[], gap: number): ColumnBand[] {
  const runs = lines.flatMap((line) => line.positioned);
  if (!runs.length) return [];

  const minX = Math.floor(Math.min(...runs.map((run) => run.x)));
  const maxX = Math.ceil(Math.max(...runs.map((run) => run.x + run.width)));
  if (maxX <= minX) return [];

  const coverage = new Array<number>(maxX - minX + 1).fill(0);
  for (const run of runs) {
    const from = Math.max(0, Math.floor(run.x) - minX);
    const to = Math.min(coverage.length - 1, Math.ceil(run.x + run.width) - minX);
    for (let index = from; index <= to; index += 1) coverage[index] = (coverage[index] ?? 0) + 1;
  }

  const threshold = Math.max(1, Math.ceil(lines.length * COVERAGE_SHARE));
  const bands: ColumnBand[] = [];
  for (let index = 0; index < coverage.length; index += 1) {
    if ((coverage[index] ?? 0) < threshold) continue;
    const position = index + minX;
    const current = bands[bands.length - 1];
    if (current && position <= current.end + gap) current.end = position;
    else bands.push({ start: position, end: position });
  }
  return bands;
}

/** The band a run sits in, chosen by its midpoint so partial overlaps are unambiguous. */
function bandIndexFor(cell: PdfCell, bands: ColumnBand[]): number {
  const midpoint = cell.x + cell.width / 2;
  const index = bands.findIndex((band) => midpoint >= band.start && midpoint <= band.end);
  if (index >= 0) return index;
  // A run wider than any band (or sitting in a gap) falls to the nearest band.
  let nearest = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  bands.forEach((band, candidate) => {
    const distance = midpoint < band.start ? band.start - midpoint : midpoint - band.end;
    if (distance < bestDistance) {
      bestDistance = distance;
      nearest = candidate;
    }
  });
  return nearest;
}

/**
 * Rebuild a column matrix from positioned PDF text so an unrecognized statement
 * can go through the same explicit, user-confirmed column mapping the CSV route
 * uses. Nothing here decides what a column *means* — that stays the user's
 * choice, so a wrong guess is visible in the preview rather than silently
 * imported (ADR #12).
 */
export function reconstructTable(lines: PdfLine[], options: { gap?: number } = {}): ReconstructedTable {
  const gap = options.gap ?? COLUMN_GAP;
  const usable = lines.filter((line) => line.positioned.length > 0);
  const bands = columnBands(usable, gap);
  if (!bands.length || bands.length > MAX_COLUMNS) {
    return { rows: [], bands: [], signature: "" };
  }

  const rows = usable.map((line) => {
    const columns: string[] = Array.from({ length: bands.length }, () => "");
    for (const cell of line.positioned) {
      const index = bandIndexFor(cell, bands);
      columns[index] = columns[index] ? `${columns[index]} ${cell.text}` : cell.text;
    }
    return columns;
  }).filter((row) => row.some((column) => column.trim()));

  return { rows, bands, signature: layoutSignature(bands) };
}

/**
 * Quantized so a right-aligned column whose left edge shifts with the width of
 * this month's largest amount still resolves to last month's saved mapping. A
 * signature that is slightly too specific only costs one re-mapping; one that is
 * too loose would apply another bank's mapping silently, so this errs tight.
 */
/**
 * Read a statement Mizan has no verified parser for as a plain table, so the user
 * can map its columns. Decryption and extraction stay in the browser exactly as
 * they do for a bank-specific parser.
 */
export async function extractStatementTable(file: File, password: string): Promise<ReconstructedTable> {
  return withPdf(file, password, async (doc) => reconstructTable(await extractLines(doc)));
}

function layoutSignature(bands: ColumnBand[]): string {
  const quantized = bands.map((band) => Math.floor(band.start / SIGNATURE_QUANTUM) * SIGNATURE_QUANTUM);
  return `pdf:${bands.length}:${quantized.join(",")}`;
}

const SIGNATURE_QUANTUM = 20;
