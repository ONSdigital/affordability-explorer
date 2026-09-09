#!/usr/bin/env node

/**
 * Generate msoas-latest.json and national files for each property type
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, '../static/data');
const GEOGRAPHY_DIR = path.join(OUTPUT_DIR, 'geography');
const DATA_DIR = path.join(__dirname, '../data/raw');

const PROPERTY_TYPES = ['all', 'detached', 'semi-detached', 'terraced', 'flats'];
const PROPERTY_TYPE_SHEET_LETTERS = {
  all: 'a',
  detached: 'b',
  'semi-detached': 'c',
  terraced: 'd',
  flats: 'e',
};

const REGIONS = [
  { cd: "E12000001", nm: "North East" },
  { cd: "E12000002", nm: "North West" },
  { cd: "E12000003", nm: "Yorkshire and The Humber" },
  { cd: "E12000004", nm: "East Midlands" },
  { cd: "E12000005", nm: "West Midlands" },
  { cd: "E12000006", nm: "East of England" },
  { cd: "E12000007", nm: "London" },
  { cd: "E12000008", nm: "South East" },
  { cd: "E12000009", nm: "South West" },
  { cd: "W92000004", nm: "Wales" }
];

const COUNTRIES = [
  { code: 'E92000001', slug: 'england', name: 'England' },
  { code: 'W92000004', slug: 'wales', name: 'Wales' },
];

const medianAdministrativeWorkbook = XLSX.readFile(
  path.join(DATA_DIR, 'medianpricepaidforadministrativegeographies.xlsx'),
);
const lowerQuartileAdministrativeWorkbook = XLSX.readFile(
  path.join(DATA_DIR, 'lowerquartilepricepaidforadministrativegeographies.xlsx'),
);
const affordabilityWorkbook = XLSX.readFile(
  path.join(DATA_DIR, 'aff2ratioofhousepricetoresidencebasedearnings.xlsx'),
);

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function getLatestNumericValue(sheet, row, startCol) {
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');

  for (let col = range.e.c; col >= startCol; col--) {
    const value = sheet[XLSX.utils.encode_cell({ r: row, c: col })]?.v;
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.round(value);
    }
  }

  return null;
}

function readLatestAreaValues(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    return {};
  }

  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
  const values = {};

  for (let row = 2; row <= range.e.r; row++) {
    const code = sheet[XLSX.utils.encode_cell({ r: row, c: 0 })]?.v;
    const name = sheet[XLSX.utils.encode_cell({ r: row, c: 1 })]?.v ?? null;

    if (!code || typeof code !== 'string') {
      continue;
    }

    const latestValue = getLatestNumericValue(sheet, row, 2);
    if (!Number.isFinite(latestValue)) {
      continue;
    }

    values[code] = {
      code,
      name,
      value: latestValue,
    };
  }

  return values;
}

function createAffordabilityEntry(price, earnings) {
  if (!Number.isFinite(price) || !Number.isFinite(earnings) || earnings === 0) {
    return null;
  }

  return {
    price,
    earnings,
    ratio: Math.round((price / earnings) * 100) / 100,
  };
}

function buildAreaAffordabilitySummary(code, name, medianPrices, lowerQuartilePrices, medianEarnings, lowerQuartileEarnings) {
  const median = createAffordabilityEntry(
    medianPrices[code]?.value ?? null,
    medianEarnings[code]?.value ?? null,
  );
  const lq = createAffordabilityEntry(
    lowerQuartilePrices[code]?.value ?? null,
    lowerQuartileEarnings[code]?.value ?? null,
  );

  return {
    code,
    name: name ?? medianPrices[code]?.name ?? lowerQuartilePrices[code]?.name ?? null,
    affordability: {
      ...(median ? { median } : {}),
      ...(lq ? { lq } : {}),
    },
  };
}

function writeRegionFiles(typeDir, propType) {
  const regionDir = path.join(typeDir, 'region');
  ensureDir(regionDir);

  const sheetLetter = PROPERTY_TYPE_SHEET_LETTERS[propType];
  const medianPrices = readLatestAreaValues(medianAdministrativeWorkbook, `1${sheetLetter}`);
  const lowerQuartilePrices = readLatestAreaValues(lowerQuartileAdministrativeWorkbook, `1${sheetLetter}`);
  const medianEarnings = readLatestAreaValues(affordabilityWorkbook, '1b');
  const lowerQuartileEarnings = readLatestAreaValues(affordabilityWorkbook, '2b');

  for (const region of REGIONS) {
    const summary = buildAreaAffordabilitySummary(
      region.cd,
      region.nm,
      medianPrices,
      lowerQuartilePrices,
      medianEarnings,
      lowerQuartileEarnings,
    );

    fs.writeFileSync(
      path.join(regionDir, `${region.cd}.json`),
      JSON.stringify(summary, null, 2),
    );
  }

  console.log(`  ✓ region/*.json (${REGIONS.length} region files)`);

  return {
    medianPrices,
    lowerQuartilePrices,
    medianEarnings,
    lowerQuartileEarnings,
  };
}

function writeNationalFiles(nationalDir, areaData) {
  ensureDir(nationalDir);

  for (const country of COUNTRIES) {
    const summary = buildAreaAffordabilitySummary(
      country.code,
      country.name,
      areaData.medianPrices,
      areaData.lowerQuartilePrices,
      areaData.medianEarnings,
      areaData.lowerQuartileEarnings,
    );

    fs.writeFileSync(
      path.join(nationalDir, `${country.slug}.json`),
      JSON.stringify(
        {
          region: country.name,
          affordability: summary.affordability,
        },
        null,
        2,
      ),
    );
  }

  console.log(`  ✓ national/*.json (${COUNTRIES.length} country files)`);
}

function generateForPropertyType(propType) {
  console.log(`\nProcessing: ${propType}`);
  
  const typeDir = path.join(OUTPUT_DIR, propType);
  const laDir = path.join(typeDir, 'la');
  const nationalDir = path.join(typeDir, 'national');
  
  if (!fs.existsSync(laDir)) {
    console.log('  Skipped (directory not found)');
    return;
  }
  
  if (!fs.existsSync(nationalDir)) {
    fs.mkdirSync(nationalDir, { recursive: true });
  }
  
  // Read all LA files and build authorities list + aggregate data
  const laFiles = fs.readdirSync(laDir).filter(f => f.endsWith('.json'));
  const authorities = [];
  const msoas = [];
  
  for (const filename of laFiles) {
    const filePath = path.join(laDir, filename);
    const laData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    
    // Add to authorities list with region info
    authorities.push({
      code: laData.code,
      name: laData.name,
      region_code: laData.region_code,
      region_name: laData.region_name,
      msoa_count: laData.msoas.length
    });
    
    // Collect MSOAs for msoas-latest.json
    for (const msoa of laData.msoas) {
      msoas.push({
        code: msoa.code,
        name: msoa.name,
        la_code: laData.code,
        la_name: laData.name,
        region_code: laData.region_code,
        region_name: laData.region_name,
        affordability: msoa.affordability
      });
    }
  }
  
  // Note: authorities.json is now generated once in geography/ folder (see main function)
  
  // Generate msoas-latest.json
  msoas.sort((a, b) => {
    if (a.region_code !== b.region_code) return a.region_code.localeCompare(b.region_code);
    if (a.la_code !== b.la_code) return a.la_code.localeCompare(b.la_code);
    return a.code.localeCompare(b.code);
  });
  
  const now = new Date();
  const quarter = Math.ceil((now.getMonth() + 1) / 3);
  const generatedDate = `${now.getFullYear()}-Q${quarter}`;
  
  const msoasLatest = {
    generated_date: generatedDate,
    msoa_count: msoas.length,
    msoas
  };
  
  fs.writeFileSync(
    path.join(typeDir, 'msoas-latest.json'),
    JSON.stringify(msoasLatest, null, 2)
  );
  
  console.log(`  ✓ msoas-latest.json (${msoas.length} MSOAs)`);

  const areaData = writeRegionFiles(typeDir, propType);
  writeNationalFiles(nationalDir, areaData);
}

async function main() {
  console.log('Generating msoas-latest and national files\n');
  console.log('='.repeat(60));
  
  // Ensure geography directory exists
  if (!fs.existsSync(GEOGRAPHY_DIR)) {
    fs.mkdirSync(GEOGRAPHY_DIR, { recursive: true });
  }
  
  // Generate shared geography files (only once from 'all' property type)
  const allLADir = path.join(OUTPUT_DIR, 'all', 'la');
  if (fs.existsSync(allLADir)) {
    const laFiles = fs.readdirSync(allLADir).filter(f => f.endsWith('.json'));
    const authorities = [];
    const regionSet = new Map();
    
    for (const filename of laFiles) {
      const filePath = path.join(allLADir, filename);
      const laData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      
      authorities.push({
        code: laData.code,
        name: laData.name,
        region_code: laData.region_code,
        region_name: laData.region_name,
        msoa_count: laData.msoas.length
      });
      
      if (!regionSet.has(laData.region_code)) {
        const countryCode = laData.region_code.startsWith('E') ? 'E92000001' : 'W92000004';
        const countryName = laData.region_code.startsWith('E') ? 'England' : 'Wales';
        regionSet.set(laData.region_code, {
          name: laData.region_name,
          country_code: countryCode,
          country_name: countryName
        });
      }
    }
    
    // Write authorities.json
    fs.writeFileSync(
      path.join(GEOGRAPHY_DIR, 'authorities.json'),
      JSON.stringify({ authorities }, null, 2)
    );
    
    // Write regions.json with country hierarchy
    const regions = Array.from(regionSet.entries())
      .map(([code, data]) => ({
        code,
        name: data.name,
        country_code: data.country_code,
        country_name: data.country_name
      }))
      .sort((a, b) => a.code.localeCompare(b.code));
    
    fs.writeFileSync(
      path.join(GEOGRAPHY_DIR, 'regions.json'),
      JSON.stringify({ regions }, null, 2)
    );
    
    console.log(`\nShared Geography Files:`);
    console.log(`  ✓ geography/authorities.json (${authorities.length} LAs with region info)`);
    console.log(`  ✓ geography/regions.json (${regions.length} regions with country hierarchy)`);
  }
  
  console.log('');
  for (const propType of PROPERTY_TYPES) {
    generateForPropertyType(propType);
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('✓ Generation complete!');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
