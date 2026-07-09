import { describe, expect, it } from "vitest";
import { dfccPdfParser } from "./dfccPdf";
import { ntbHtmlParser } from "./ntbHtml";
import { parsersFor } from "./registry";

function fileNamed(name: string): File {
  return new File(["x"], name);
}

describe("parsersFor", () => {
  it("routes .html/.htm files to the NTB parser", () => {
    expect(parsersFor(fileNamed("statement.html"))).toEqual([ntbHtmlParser]);
    expect(parsersFor(fileNamed("statement.HTM"))).toEqual([ntbHtmlParser]);
  });

  it("routes .pdf files to the DFCC parser", () => {
    expect(parsersFor(fileNamed("statement.pdf"))).toEqual([dfccPdfParser]);
  });

  it("returns no parser for an unrecognized extension", () => {
    expect(parsersFor(fileNamed("statement.csv"))).toEqual([]);
  });
});
