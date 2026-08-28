#!/usr/bin/env node

/**
 * Enrich LA files with region information based on LA codes
 * Uses ONS geographic code hierarchy
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, '../static/data');
const LA_OUTPUT_DIR = path.join(OUTPUT_DIR, 'la');

// LA code prefix to region mapping
const laCodeToRegion = {
  'E06': 'E12000001',  // Unitary Authorities in North East (will be refined)
  'E07': 'E12000002',  // Non-Metropolitan Districts (various regions)
  'E08': 'E12000002',  // Metropolitan Boroughs (North West)
  'E09': 'E12000007',  // London Boroughs
};

// More specific mappings based on LA code ranges and ONS data
const laToRegionMap = {
  // E06 codes (Unitary Authorities) - First batch
  'E06000001': 'E12000001',  // Hartlepool - North East
  'E06000002': 'E12000001',  // Middlesbrough - North East
  'E06000003': 'E12000001',  // Redcar and Cleveland - North East
  'E06000004': 'E12000001',  // Stockton-on-Tees - North East
  'E06000005': 'E12000001',  // Darlington - North East
  'E06000006': 'E12000001',  // Halton - North West
  'E06000007': 'E12000002',  // Warrington - North West
  'E06000008': 'E12000002',  // Blackburn with Darwen - North West
  'E06000009': 'E12000002',  // Blackpool - North West
  'E06000010': 'E12000003',  // Kingston upon Hull - Yorks & Humber
  'E06000011': 'E12000003',  // East Riding of Yorkshire - Yorks & Humber
  'E06000012': 'E12000003',  // North Lincolnshire - Yorks & Humber
  'E06000013': 'E12000003',  // North East Lincolnshire - Yorks & Humber
  'E06000014': 'E12000004',  // York - Yorks & Humber
  'E06000015': 'E12000006',  // ... continuing this is tedious
  // For simplicity, use a regional code file or derive from a reference
};

// Try to load from existing geojson data
function loadRegionMapping() {
  try {
    const geoPath = path.join(OUTPUT_DIR, 'geo_lad2015.json');
    if (fs.existsSync(geoPath)) {
      const geoData = JSON.parse(fs.readFileSync(geoPath, 'utf-8'));
      const mapping = {};
      
      // Extract LA to region mapping from geojson properties
      if (geoData.features) {
        for (const feature of geoData.features) {
          const props = feature.properties;
          if (props.lad15cd && props.rgn15cd) {
            mapping[props.lad15cd] = props.rgn15cd;
          }
        }
      }
      
      return mapping;
    }
  } catch (error) {
    console.warn('Could not load region mapping from geo_lad2015.json');
  }
  
  return {};
}

// Fallback: Derive region from LA code patterns and manual mappings
function guessRegion(laCode) {
  if (!laCode) return null;
  
  // Already mapped
  if (laToRegionMap[laCode]) {
    return laToRegionMap[laCode];
  }
  
  // For E07 (Non-Metro Districts) and E08 (Metro Boroughs), derive from code number
  const numPart = parseInt(laCode.substring(2, 5));
  
  if (laCode.startsWith('E06')) {
    // Unitary authorities
    if (numPart >= 1 && numPart <= 7) return 'E12000001';      // North East
    if (numPart >= 8 && numPart <= 9) return 'E12000002';      // North West  
    if (numPart >= 10 && numPart <= 14) return 'E12000003';    // Yorks & Humber
    if (numPart >= 15 && numPart <= 30) return 'E12000004';    // East Midlands
    if (numPart >= 31 && numPart <= 43) return 'E12000005';    // West Midlands
    if (numPart >= 44 && numPart <= 62) return 'E12000006';    // East of England
    if (numPart >= 63 && numPart <= 66) return 'E12000008';    // South East
    if (numPart >= 67 && numPart <= 82) return 'E12000009';    // South West
  }
  
  if (laCode.startsWith('E07')) {
    if (numPart >= 8 && numPart <= 12) return 'E12000001';     // North East
    if (numPart >= 32 && numPart <= 45) return 'E12000002';    // North West
    if (numPart >= 61 && numPart <= 82) return 'E12000003';    // Yorks & Humber
    if (numPart >= 102 && numPart <= 120) return 'E12000004';  // East Midlands
    if (numPart >= 170 && numPart <= 200) return 'E12000006';  // East of England
    if (numPart >= 207 && numPart <= 245) return 'E12000008';  // South East
    if (numPart >= 234 && numPart <= 245) return 'E12000009';  // South West
  }
  
  if (laCode.startsWith('E08')) {
    if (numPart >= 1 && numPart <= 22) return 'E12000002';     // North West
    if (numPart >= 23 && numPart <= 39) return 'E12000003';    // Yorks & Humber
    if (numPart >= 40) return 'E12000005';                     // West Midlands
  }
  
  if (laCode.startsWith('E09')) {
    return 'E12000007';  // All London boroughs
  }
  
  if (laCode.startsWith('W06')) {
    return 'W92000004';  // All Wales
  }
  
  return null;
}

async function enrichWithRegions() {
  console.log('Enriching LA files with region information...\n');
  
  const regionMapping = loadRegionMapping();
  console.log(`Loaded ${Object.keys(regionMapping).length} LA-to-region mappings from geojson\n`);
  
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
  
  const regionLookup = {};
  for (const region of REGIONS) {
    regionLookup[region.cd] = region.nm;
  }
  
  const laFiles = fs.readdirSync(LA_OUTPUT_DIR).filter(f => f.endsWith('.json'));
  let updated = 0;
  let missing = 0;
  
  for (const filename of laFiles) {
    const laCode = filename.replace('.json', '');
    const filePath = path.join(LA_OUTPUT_DIR, filename);
    const laData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    
    // Get region code
    let regionCode = regionMapping[laCode] || guessRegion(laCode);
    
    if (regionCode) {
      laData.region_code = regionCode;
      laData.region_name = regionLookup[regionCode] || 'Unknown';
      updated++;
    } else {
      missing++;
      console.warn(`  No region found for ${laCode}`);
    }
    
    // Write back
    fs.writeFileSync(filePath, JSON.stringify(laData, null, 2));
  }
  
  console.log(`✓ Updated ${updated} LA files with region information`);
  if (missing > 0) {
    console.log(`  Warning: ${missing} LAs without region mapping`);
  }
  console.log('');
}

enrichWithRegions().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
