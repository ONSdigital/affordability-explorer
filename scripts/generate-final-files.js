#!/usr/bin/env node

/**
 * Generate msoas-latest.json, msoas-map.json, and geography files
 * Uses data already processed from SAA Machine Readable.csv
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, "../static/data");
const GEOGRAPHY_DIR = path.join(OUTPUT_DIR, "geography");

const PROPERTY_TYPES = [
  "all",
  "detached",
  "semi-detached",
  "terraced",
  "flats",
];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function generateForPropertyType(propType) {
  console.log(`\nProcessing: ${propType}`);

  const typeDir = path.join(OUTPUT_DIR, propType);
  const laDir = path.join(typeDir, "la");

  if (!fs.existsSync(laDir)) {
    console.log("  Skipped (directory not found)");
    return;
  }

  // Read all LA files and build MSOA list + aggregate data
  const laFiles = fs.readdirSync(laDir).filter((f) => f.endsWith(".json"));
  const msoas = [];
  const regionMap = new Map();

  for (const filename of laFiles) {
    const filePath = path.join(laDir, filename);
    const laData = JSON.parse(fs.readFileSync(filePath, "utf-8"));

    // Track regions
    if (!regionMap.has(laData.region_code)) {
      regionMap.set(laData.region_code, {
        code: laData.region_code,
        name: laData.region_name,
        country_code: laData.region_code.startsWith("E") ? "E92000001" : "W92000004",
        country_name: laData.region_code.startsWith("E") ? "England" : "Wales",
      });
    }

    // Collect MSOAs for msoas-latest.json
    for (const msoa of laData.msoas) {
      msoas.push({
        code: msoa.code,
        name: msoa.name,
        la_code: laData.code,
        la_name: laData.name,
        region_code: laData.region_code,
        region_name: laData.region_name,
        affordability: msoa.affordability,
      });
    }
  }

  // Sort MSOAs
  msoas.sort((a, b) => {
    if (a.region_code !== b.region_code)
      return a.region_code.localeCompare(b.region_code);
    if (a.la_code !== b.la_code) return a.la_code.localeCompare(b.la_code);
    return a.code.localeCompare(b.code);
  });

  // Generate msoas-map.json (only file needed for mapping)
  const now = new Date();
  const quarter = Math.ceil((now.getMonth() + 1) / 3);
  const generatedDate = `${now.getFullYear()}-Q${quarter}`;

  fs.writeFileSync(
    path.join(typeDir, "msoas-map.json"),
    JSON.stringify({
      generated_date: generatedDate,
      msoa_count: msoas.length,
      msoas: msoas.map(({ affordability, ...area }) => ({
        ...area,
        median: affordability?.median?.ratio ?? null,
        lq: affordability?.lq?.ratio ?? null,
      })),
    }, null, 2)
  );

  console.log(`  ✓ msoas-map.json (${msoas.length} MSOAs)`);

  return regionMap;
}

async function main() {
  console.log(
    "Generating msoas-map.json and geography files from processed LA data\n"
  );
  console.log("=".repeat(60));

  ensureDir(GEOGRAPHY_DIR);

  // Generate shared geography files from 'all' property type
  const allLADir = path.join(OUTPUT_DIR, "all", "la");
  if (fs.existsSync(allLADir)) {
    const laFiles = fs.readdirSync(allLADir).filter((f) => f.endsWith(".json"));
    const authorities = [];
    const regionSet = new Map();

    for (const filename of laFiles) {
      const filePath = path.join(allLADir, filename);
      const laData = JSON.parse(fs.readFileSync(filePath, "utf-8"));

      authorities.push({
        code: laData.code,
        name: laData.name,
        region_code: laData.region_code,
        region_name: laData.region_name,
        msoa_count: laData.msoas.length,
      });

      if (!regionSet.has(laData.region_code)) {
        regionSet.set(laData.region_code, {
          code: laData.region_code,
          name: laData.region_name,
          country_code: laData.region_code.startsWith("E")
            ? "E92000001"
            : "W92000004",
          country_name: laData.region_code.startsWith("E") ? "England" : "Wales",
        });
      }
    }

    // Write authorities.json
    fs.writeFileSync(
      path.join(GEOGRAPHY_DIR, "authorities.json"),
      JSON.stringify({ authorities }, null, 2)
    );

    // Write regions.json with country hierarchy
    const regions = Array.from(regionSet.values()).sort((a, b) =>
      a.code.localeCompare(b.code)
    );

    fs.writeFileSync(
      path.join(GEOGRAPHY_DIR, "regions.json"),
      JSON.stringify({ regions }, null, 2)
    );

    console.log(
      `\nShared Geography Files (from 'all' property type):`
    );
    console.log(
      `  ✓ geography/authorities.json (${authorities.length} local authorities)`
    );
    console.log(
      `  ✓ geography/regions.json (${regions.length} regions with country hierarchy)`
    );
  }

  console.log("");
  for (const propType of PROPERTY_TYPES) {
    generateForPropertyType(propType);
  }

  console.log("\n" + "=".repeat(60));
  console.log("✓ Generation complete!");
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
