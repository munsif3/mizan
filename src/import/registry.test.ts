import { describe, expect, it } from "vitest";
import { parsersFor } from "./registry";

function fileNamed(name: string): File {
  return new File(["x"], name);
}

describe("parsersFor", () => {
  it("routes .html/.htm files to the NTB parser", () => {
    expect(parsersFor(fileNamed("statement.html")).map((parser) => parser.id)).toEqual(["ntb-html"]);
    expect(parsersFor(fileNamed("statement.HTM")).map((parser) => parser.id)).toEqual(["ntb-html"]);
  });

  it("routes .pdf files to the DFCC parser", () => {
    expect(parsersFor(fileNamed("statement.pdf")).map((parser) => parser.id)).toEqual(["dfcc-visa-pdf"]);
  });

  it("returns no parser for an unrecognized extension", () => {
    expect(parsersFor(fileNamed("statement.csv"))).toEqual([]);
  });
});
