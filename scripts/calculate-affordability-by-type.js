#!/usr/bin/env node

/**
 * Calculate affordability ratios for each property type
 * Uses smallareamap.xlsx for MSOA prices, administrative tables for LA prices,
 * and aff2 for earnings.
 */

import XLSX from "xlsx";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { readLatestAreaValues } from "./latest-area-values.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_DIR = path.join(__dirname, "../data/raw");
const OUTPUT_DIR = path.join(__dirname, "../static/data");

const PROPERTY_TYPES = [
  "all",
  "detached",
  "semi-detached",
  "terraced",
  "flats",
];
const PROPERTY_TYPE_SHEET_LETTERS = {
  all: "a",
  detached: "b",
  "semi-detached": "c",
  terraced: "d",
  flats: "e",
};

/**
 * Read LA-level earnings AND region mapping from aff2
 */
function readLAEarningsAndRegions() {
  console.log("Reading LA-level earnings and region mappings from aff2...");

  const workbook = XLSX.readFile(
    path.join(DATA_DIR, "aff2ratioofhousepricetoresidencebasedearnings.xlsx"),
  );

  const earnings = {};
  const regions = {};

  // Sheet 5b: Median earnings + Region mapping
  const ws5b = workbook.Sheets["5b"];
  const range5b = XLSX.utils.decode_range(ws5b["!ref"]);

  for (let row = 2; row <= range5b.e.r; row++) {
    const regionCode = ws5b[XLSX.utils.encode_cell({ r: row, c: 0 })]?.v;
    const regionName = ws5b[XLSX.utils.encode_cell({ r: row, c: 1 })]?.v;
    const laCode = ws5b[XLSX.utils.encode_cell({ r: row, c: 2 })]?.v;
    const laName = ws5b[XLSX.utils.encode_cell({ r: row, c: 3 })]?.v;

    // Get latest year (last numeric column around column 30)
    let latestEarnings = null;
    for (let col = range5b.e.c; col >= 4; col--) {
      const cell = ws5b[XLSX.utils.encode_cell({ r: row, c: col })];
      if (cell && typeof cell.v === "number") {
        latestEarnings = Math.round(cell.v);
        break;
      }
    }

    if (laCode && typeof laCode === "string") {
      if (!earnings[laCode]) {
        earnings[laCode] = {
          name: laName,
          median: null,
          lq: null,
          region_code: regionCode,
          region_name: regionName,
        };
      }
      earnings[laCode].median = latestEarnings;
      regions[laCode] = { code: regionCode, name: regionName };
    }
  }

  // Sheet 6b: LQ earnings
  const ws6b = workbook.Sheets["6b"];
  if (ws6b) {
    const range6b = XLSX.utils.decode_range(ws6b["!ref"]);
    for (let row = 2; row <= range6b.e.r; row++) {
      const laCode = ws6b[XLSX.utils.encode_cell({ r: row, c: 2 })]?.v;

      let latestEarnings = null;
      for (let col = range6b.e.c; col >= 4; col--) {
        const cell = ws6b[XLSX.utils.encode_cell({ r: row, c: col })];
        if (cell && typeof cell.v === "number") {
          latestEarnings = Math.round(cell.v);
          break;
        }
      }

      if (laCode && typeof laCode === "string" && latestEarnings) {
        if (!earnings[laCode]) {
          earnings[laCode] = { name: null, median: null, lq: null };
        }
        earnings[laCode].lq = latestEarnings;
      }
    }
  }

  console.log(`  Loaded earnings for ${Object.keys(earnings).length} LAs\n`);
  return { earnings, regions };
}

/**
 * Calculate affordability and enrich LA files for a property type
 */
function enrichPropertyType(
  propType,
  earnings,
  regions,
  medianWorkbook,
  lqWorkbook,
) {
  console.log(`Calculating affordability for: ${propType}`);

  const typeDir = path.join(OUTPUT_DIR, propType);
  const laDir = path.join(typeDir, "la");

  if (!fs.existsSync(laDir)) {
    console.log(`  Warning: ${typeDir} not found, skipping`);
    return;
  }
  const sheetName = `2${PROPERTY_TYPE_SHEET_LETTERS[propType]}`;
  const medianPrices = readLatestAreaValues(medianWorkbook, sheetName, 2);
  const lqPrices = readLatestAreaValues(lqWorkbook, sheetName, 2);

  const laFiles = fs.readdirSync(laDir).filter((f) => f.endsWith(".json"));
  let processed = 0;
  const startTime = Date.now();

  for (const filename of laFiles) {
    const laCode = filename.replace(".json", "");
    const filePath = path.join(laDir, filename);
    const laData = JSON.parse(fs.readFileSync(filePath, "utf-8"));

    const laEarnings = earnings[laCode];
    const laRegion = regions[laCode];
    if (!laEarnings) continue;

    // Add region information to LA
    laData.region_code = laRegion?.code || null;
    laData.region_name = laRegion?.name || null;

    // Calculate affordability for each MSOA

    for (const msoa of laData.msoas) {
      const medianPrice = msoa.affordability.median.price;
      if (medianPrice && laEarnings.median) {
        const ratio = medianPrice / laEarnings.median;
        msoa.affordability.median = {
          price: medianPrice,
          earnings: laEarnings.median,
          ratio: Math.round(ratio * 100) / 100,
        };
      } else {
        msoa.affordability.median = {};
      }

      const lqPrice = msoa.affordability.lq.price;
      if (lqPrice && laEarnings.lq) {
        const ratio = lqPrice / laEarnings.lq;
        msoa.affordability.lq = {
          price: lqPrice,
          earnings: laEarnings.lq,
          ratio: Math.round(ratio * 100) / 100,
        };
      } else {
        msoa.affordability.lq = {};
      }
    }

    // Use published LA prices, not averages of neighbourhood prices.
    laData.affordability = {
      median: {},
      lq: {},
    };

    const medianPrice = medianPrices.values[laCode]?.value;
    if (
      Number.isFinite(medianPrice) &&
      Number.isFinite(laEarnings.median) &&
      laEarnings.median !== 0
    ) {
      laData.affordability.median = {
        price: medianPrice,
        earnings: laEarnings.median,
        ratio: Math.round((medianPrice / laEarnings.median) * 100) / 100,
        period: medianPrices.period,
      };
    }

    const lqPrice = lqPrices.values[laCode]?.value;
    if (
      Number.isFinite(lqPrice) &&
      Number.isFinite(laEarnings.lq) &&
      laEarnings.lq !== 0
    ) {
      laData.affordability.lq = {
        price: lqPrice,
        earnings: laEarnings.lq,
        ratio: Math.round((lqPrice / laEarnings.lq) * 100) / 100,
        period: lqPrices.period,
      };
    }

    fs.writeFileSync(filePath, JSON.stringify(laData, null, 2));
    processed++;

    // Progress indicator every 50 files
    if (processed % 50 === 0) {
      const elapsedMs = Date.now() - startTime;
      const avgTimePerFile = elapsedMs / processed;
      const remainingFiles = laFiles.length - processed;
      const estimatedMs = remainingFiles * avgTimePerFile;
      const estimatedSec = Math.round(estimatedMs / 1000);
      const pct = Math.round((processed / laFiles.length) * 100);
      console.log(
        `  [${pct}%] ${processed}/${laFiles.length} | ETA: ${estimatedSec}s`,
      );
    }
  }

  console.log(`  ✓ Updated ${processed} LA files\n`);
}

async function main() {
  console.log("Calculating affordability ratios\n");
  console.log("=".repeat(60) + "\n");

  try {
    const { earnings, regions } = readLAEarningsAndRegions();
    const medianWorkbook = XLSX.readFile(
      path.join(DATA_DIR, "medianpricepaidforadministrativegeographies.xlsx"),
    );
    const lqWorkbook = XLSX.readFile(
      path.join(
        DATA_DIR,
        "lowerquartilepricepaidforadministrativegeographies.xlsx",
      ),
    );

    // Process each property type
    for (const propType of PROPERTY_TYPES) {
      enrichPropertyType(
        propType,
        earnings,
        regions,
        medianWorkbook,
        lqWorkbook,
      );
    }

    console.log("=".repeat(60));
    console.log("✓ Affordability calculation complete!\n");
    console.log("Next: Run generate-final-files.js");
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main();
