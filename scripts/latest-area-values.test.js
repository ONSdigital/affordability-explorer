import assert from "node:assert/strict";
import { test } from "node:test";
import XLSX from "xlsx";
import { readLatestAreaValues } from "./latest-area-values.js";

test("LA prices use the latest dated column without falling back for suppressed values", () => {
  const workbook = {
    Sheets: {
      "2e": XLSX.utils.aoa_to_sheet([
        ["Table 2e"],
        ["Source"],
        [
          "Region code",
          "Region name",
          "LA code",
          "LA name",
          "Year ending Dec 2025",
          "Year ending Mar 2026",
          "Notes",
        ],
        ["E12", "Region", "E06000001", "Hartlepool", 80000, 84529, 999],
        ["E12", "Region", "E06000002", "Missing latest", 78000, "[x]", 999],
      ]),
    },
  };
  const result = readLatestAreaValues(workbook, "2e", 2);
  assert.equal(result.period, "2026-Q1");
  assert.deepEqual(result.values.E06000001, {
    code: "E06000001",
    name: "Hartlepool",
    value: 84529,
  });
  assert.equal(result.values.E06000002, undefined);
});

test("regional reader retains code-column layout and detects the latest date", () => {
  const workbook = {
    Sheets: {
      "1a": XLSX.utils.aoa_to_sheet([
        ["Table 1a"],
        ["Source"],
        ["Code", "Name", "Year ending Mar 2026", "Year ending Dec 2025"],
        ["E12000001", "North East", 160000, 2099],
      ]),
    },
  };
  assert.equal(
    readLatestAreaValues(workbook, "1a").values.E12000001.value,
    160000,
  );
});

test("invalid price worksheets fail explicitly", () => {
  assert.throws(
    () => readLatestAreaValues({ Sheets: {} }, "2a"),
    /Missing worksheet/,
  );
  assert.throws(
    () =>
      readLatestAreaValues(
        { Sheets: { "2a": XLSX.utils.aoa_to_sheet([["No dates"]]) } },
        "2a",
        2,
      ),
    /Missing period headers/,
  );
});
