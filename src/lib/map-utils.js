import * as topojson from 'topojson-client';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { base } from '$app/paths';

let boundaries = [];
let areaNames = [];
let areaNameToCode = {};
let topoData = null;

const UK_POSTCODE_RE = /^[A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2}$/i;

function withBase(path) {
  return `${base}${path}`;
}

/**
 * Load and cache TopoJSON data
 * @param {string} topoPath - Path to TopoJSON file (default: '/master-topo.json')
 * @returns {object|null} Loaded TopoJSON data or null if error
 */
export async function loadTopoJSON(topoPath = withBase('/master-topo.json')) {
  if (topoData) return topoData;
  
  try {
    const response = await fetch(topoPath);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    topoData = await response.json();
    buildAreaLookups(topoData);
    return topoData;
  } catch (error) {
    return null;
  }
}

/**
 * Build internal lookup structures from TopoJSON
 * @private
 */
function buildAreaLookups(topo) {
  boundaries = [];
  areaNames = [];
  areaNameToCode = {};
  const uniqueNames = new Set();

  for (const [key, geometryCollection] of Object.entries(topo.objects)) {
    // Only include ltla (lower tier local authorities) in search
    if (key !== 'ltla') continue;
    
    const features = topojson.feature(topo, geometryCollection).features;
    
    features.forEach((feature) => {
      const props = feature.properties || {};
      const id = props.areacd || props.id || props.code;
      const name = props.areanm || props.name || props.NAME;

      if (!id || !name) return;

      const bounds = calculateBounds(feature.geometry);

      boundaries.push({
        id,
        name,
        bounds,
        geometry: feature.geometry,
        properties: props,
        type: key,
      });

      if (!uniqueNames.has(name.toLowerCase())) {
        areaNames.push(name);
        uniqueNames.add(name.toLowerCase());
      }
      areaNameToCode[name.toLowerCase()] = id;
    });
  }

  areaNames.sort((a, b) => a.localeCompare(b));
}

/**
 * Calculate bounding box from geometry
 * @private
 */
function calculateBounds(geometry) {
  if (!geometry || !geometry.coordinates) return null;

  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;

  function processBounds(coords) {
    if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      const [lng, lat] = coords;
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    } else if (Array.isArray(coords[0])) {
      coords.forEach(c => processBounds(c));
    }
  }

  processBounds(geometry.coordinates);

  return isFinite(minLng) ? [[minLng, minLat], [maxLng, maxLat]] : null;
}

/**
 * Normalize postcode format (trim, uppercase, normalize spaces)
 * @param {string} input - Raw postcode input
 * @returns {string} Normalized postcode
 */
export function normalizePostcode(input) {
  if (input === null || typeof input === 'undefined') return '';
  return String(input)
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

/**
 * Check if input looks like UK postcode
 * @param {string} input - Input to validate
 * @returns {boolean} True if matches UK postcode pattern
 */
export function isLikelyUkPostcode(input) {
  const normalized = normalizePostcode(input);
  return UK_POSTCODE_RE.test(normalized);
}

/**
 * Fetch postcode suggestions from postcodes.io API
 * @param {string} query - Partial or full postcode
 * @returns {array} Array of postcode suggestions
 */
export async function fetchPostcodes(query) {
  const q = (query === null || typeof query === 'undefined') ? '' : String(query).trim();
  if (!q) return [];
  
  const url = `https://api.postcodes.io/postcodes/${encodeURIComponent(q)}/autocomplete`;
  try {
    const response = await fetch(url);
    if (!response.ok) return [];
    const json = await response.json();
    return json && Array.isArray(json.result) ? json.result : [];
  } catch (e) {
    return [];
  }
}

/**
 * Get boundary by ID
 * @param {string} id - Boundary ID
 * @returns {object|null} Boundary object or null
 */
export function getBoundaryById(id) {
  return boundaries.find((b) => b.id === id) || null;
}

/**
 * Get boundary by name
 * @param {string} name - Boundary name
 * @returns {object|null} Boundary object or null
 */
export function getBoundaryByName(name) {
  const id = areaNameToCode[name.toLowerCase()];
  return id ? getBoundaryById(id) : null;
}

/**
 * Get all area names for search
 * @returns {array} Sorted array of unique area names
 */
export function getAreaNames() {
  return [...areaNames];
}

/**
 * Convert boundaries to GeoJSON FeatureCollection
 * @returns {object} GeoJSON FeatureCollection with all boundaries as features
 */
export function getBoundariesGeoJSON() {
  const geojson = {
    type: "FeatureCollection",
    features: boundaries.map((boundary) => ({
      type: "Feature",
      id: boundary.id,
      properties: {
        id: boundary.id,
        name: boundary.name,
        ...boundary.properties,
      },
      geometry: boundary.geometry || {
        type: "Polygon",
        coordinates: [
          [
            [boundary.bounds[0][0], boundary.bounds[0][1]],
            [boundary.bounds[1][0], boundary.bounds[0][1]],
            [boundary.bounds[1][0], boundary.bounds[1][1]],
            [boundary.bounds[0][0], boundary.bounds[1][1]],
            [boundary.bounds[0][0], boundary.bounds[0][1]],
          ],
        ],
      },
    })),
  };
  return geojson;
}

/**
 * Find boundary of given type containing a point
 * @param {number} lng - Longitude
 * @param {number} lat - Latitude
 * @param {string} boundaryType - Boundary type to search (default: 'ltla')
 * @returns {object|null} Boundary containing point, or null
 */
export function findBoundaryAtPoint(lng, lat, boundaryType = 'ltla') {
  const point = [lng, lat];
  
  for (const boundary of boundaries) {
    if (boundary.type !== boundaryType) continue;
    
    try {
      if (booleanPointInPolygon(point, boundary.geometry)) {
        return boundary;
      }
    } catch (e) {
      continue;
    }
  }
  
  return null;
}

// ========== AFFORDABILITY DATA & COLORING ==========

// Cache for affordability data by property type and price level
const affordabilityCache = {};
const localAuthorityAffordabilityCache = {};
const localAuthorityDataCache = {};
const nationalAffordabilityCache = {};
const regionalMedianAffordabilityCache = {};
const geographyAuthoritiesCache = {
  authorities: null,
};
const AFFORDABILITY_COLOR_PALETTE = [
  "#EAECB1",
  "#A9D891",
  "#00A7BA",
  "#004EA6",
  "#002D7D",
  "#000D54",
];
const AFFORDABILITY_COLOR_BREAKS = [1, 5, 10, 15, 20, 40, 60];

function roundToTwoDecimals(value) {
  return Math.round(value * 100) / 100;
}

/**
 * Load affordability data for a property type and price level
 * @param {string} propertyType - Property type (all, detached, semi-detached, terraced, flats)
 * @param {string} priceLevel - Price level (median, lq)
 * @returns {object} Object mapping MSOA codes to color-ready data
 */
export async function loadAffordabilityData(propertyType = 'all', priceLevel = 'median') {
  const cacheKey = `${propertyType}:${priceLevel}`;
  if (affordabilityCache[cacheKey]) {
    return affordabilityCache[cacheKey];
  }

  try {
    const response = await fetch(withBase(`/data/${propertyType}/msoas-latest.json`));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    // Create a map: MSOA code -> affordability ratio
    const msoas = {};
    if (data.msoas && Array.isArray(data.msoas)) {
      data.msoas.forEach((msoa) => {
        const ratio = msoa.affordability?.[priceLevel]?.ratio;
        msoas[msoa.code] = {
          code: msoa.code,
          name: msoa.name,
          la_code: msoa.la_code,
          la_name: msoa.la_name,
          region_code: msoa.region_code,
          region_name: msoa.region_name,
          ratio: ratio !== undefined ? ratio : null,
        };
      });
    }

    affordabilityCache[cacheKey] = msoas;
    return msoas;
  } catch (error) {
    console.error(`Failed to load affordability data for ${propertyType}/${priceLevel}:`, error.message);
    return {};
  }
}

/**
 * Load and cache full Local Authority data file
 * @param {string} propertyType - Property type (all, detached, semi-detached, terraced, flats)
 * @param {string} laCode - Local Authority code
 * @returns {object|null} Full Local Authority data object
 */
export async function loadLocalAuthorityData(propertyType = 'all', laCode = '') {
  if (!laCode) return null;

  const cacheKey = `${propertyType}:${laCode}`;
  if (localAuthorityDataCache[cacheKey]) {
    return localAuthorityDataCache[cacheKey];
  }

  try {
    const response = await fetch(withBase(`/data/${propertyType}/la/${laCode}.json`));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    localAuthorityDataCache[cacheKey] = data;
    return data;
  } catch (error) {
    console.error(
      `Failed to load Local Authority data for ${propertyType}/${laCode}:`,
      error.message
    );
    return null;
  }
}

/**
 * Load and cache Local Authority affordability data (stripped to MSOA affordability only)
 * @param {string} propertyType - Property type (all, detached, semi-detached, terraced, flats)
 * @param {string} laCode - Local Authority code
 * @returns {object} Object mapping MSOA codes to {code, name, affordability}
 */
export async function loadLocalAuthorityAffordabilityData(propertyType = 'all', laCode = '') {
  if (!laCode) return {};

  const cacheKey = `${propertyType}:${laCode}`;
  if (localAuthorityAffordabilityCache[cacheKey]) {
    return localAuthorityAffordabilityCache[cacheKey];
  }

  const data = await loadLocalAuthorityData(propertyType, laCode);
  if (!data) {
    return {};
  }

  const msoas = {};
  if (Array.isArray(data?.msoas)) {
    data.msoas.forEach((msoa) => {
      if (!msoa?.code) return;
      msoas[msoa.code] = {
        code: msoa.code,
        name: msoa.name,
        affordability: {
          median: msoa.affordability?.median ?? null,
          lq: msoa.affordability?.lq ?? null,
        },
      };
    });
  }

  localAuthorityAffordabilityCache[cacheKey] = msoas;
  return msoas;
}

/**
 * Get a single MSOA affordability record from its Local Authority file
 * @param {string} propertyType - Property type
 * @param {string} laCode - Local Authority code
 * @param {string} msoaCode - MSOA code
 * @returns {object|null} MSOA affordability record or null
 */
export async function getMsoaAffordabilityFromLocalAuthority(
  propertyType = 'all',
  laCode = '',
  msoaCode = ''
) {
  if (!laCode || !msoaCode) return null;

  const msoas = await loadLocalAuthorityAffordabilityData(propertyType, laCode);
  return msoas[msoaCode] || null;
}

export async function loadGeographyAuthorities() {
  if (geographyAuthoritiesCache.authorities) {
    return geographyAuthoritiesCache.authorities;
  }

  try {
    const response = await fetch(withBase('/data/geography/authorities.json'));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    geographyAuthoritiesCache.authorities = Array.isArray(data?.authorities)
      ? data.authorities
      : [];
    return geographyAuthoritiesCache.authorities;
  } catch (error) {
    console.error('Failed to load geography authorities:', error.message);
    return [];
  }
}

function aggregateMedianAffordability(laDataArray = []) {
  let totalMedianPrice = 0;
  let totalMedianEarnings = 0;
  let count = 0;

  for (const laData of laDataArray) {
    const median = laData?.affordability?.median;
    if (!median?.price || !median?.earnings) continue;
    totalMedianPrice += median.price;
    totalMedianEarnings += median.earnings;
    count += 1;
  }

  if (count === 0) {
    return null;
  }

  const price = Math.round(totalMedianPrice / count);
  const earnings = Math.round(totalMedianEarnings / count);
  return {
    price,
    earnings,
    ratio: roundToTwoDecimals(price / earnings),
  };
}

/**
 * Load country affordability summary from national files
 * @param {string} propertyType - Property type
 * @param {string} country - 'england' or 'wales'
 * @returns {object|null} Affordability object with median/lq, or null
 */
export async function loadCountryAffordability(propertyType = 'all', country = 'england') {
  const normalizedCountry = String(country).toLowerCase() === 'wales' ? 'wales' : 'england';
  const cacheKey = `${propertyType}:${normalizedCountry}`;

  if (nationalAffordabilityCache[cacheKey]) {
    return nationalAffordabilityCache[cacheKey];
  }

  try {
    const response = await fetch(withBase(`/data/${propertyType}/national/${normalizedCountry}.json`));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const affordability = data?.affordability ?? null;
    nationalAffordabilityCache[cacheKey] = affordability;
    return affordability;
  } catch (error) {
    console.error(
      `Failed to load country affordability for ${propertyType}/${normalizedCountry}:`,
      error.message
    );
    return null;
  }
}

/**
 * Compute region-level median affordability from LA files
 * @param {string} propertyType - Property type
 * @param {string} regionCode - Region code
 * @returns {object|null} Region summary with median affordability
 */
export async function loadRegionMedianAffordability(propertyType = 'all', regionCode = '') {
  if (!regionCode) return null;

  const cacheKey = `${propertyType}:${regionCode}`;
  if (regionalMedianAffordabilityCache[cacheKey]) {
    return regionalMedianAffordabilityCache[cacheKey];
  }

  const authorities = await loadGeographyAuthorities();
  const regionAuthorities = authorities.filter((authority) => authority.region_code === regionCode);

  if (regionAuthorities.length === 0) {
    return null;
  }

  const laDataArray = await Promise.all(
    regionAuthorities.map((authority) => loadLocalAuthorityData(propertyType, authority.code))
  );
  const median = aggregateMedianAffordability(laDataArray);
  if (!median) {
    return null;
  }

  const summary = {
    code: regionCode,
    name: regionAuthorities[0]?.region_name ?? null,
    median,
  };
  regionalMedianAffordabilityCache[cacheKey] = summary;
  return summary;
}

function calculateEqualIntervalBreaks(ratios = [], numClasses = 7) {
  if (!Array.isArray(ratios) || ratios.length === 0) {
    return [];
  }

  const minRatio = ratios[0];
  const maxRatio = ratios[ratios.length - 1];

  if (numClasses <= 1 || minRatio === maxRatio) {
    return [minRatio, maxRatio];
  }

  const range = maxRatio - minRatio;
  const bounds = [minRatio];

  for (let i = 1; i < numClasses; i++) {
    bounds.push(minRatio + (range * i) / numClasses);
  }
  bounds.push(maxRatio);

  return bounds;
}

function getPaletteForBreaks(colorPalette = [], breakCount = 0) {
  if (!Array.isArray(colorPalette) || colorPalette.length === 0 || breakCount <= 0) {
    return [];
  }

  if (breakCount <= colorPalette.length) {
    return colorPalette.slice(0, breakCount);
  }

  // If more classes are requested than base colors, sample across the palette.
  return Array.from({ length: breakCount }, (_, i) => {
    const paletteIndex = Math.round((i * (colorPalette.length - 1)) / (breakCount - 1));
    return colorPalette[paletteIndex];
  });
}

/**
 * Return fixed manual breaks for affordability classes.
 * @returns {array} Array of break bounds for legend/map classes
 */
export function calculateColorBreaks() {
  return [...AFFORDABILITY_COLOR_BREAKS];
}

/**
 * Create a simple paint expression for data-driven coloring using feature state colors
 * @param {array} colorPalette - Color array (default: affordability palette)
 * @returns {array} Maplibre GL paint expression
 */
export function createColorExpression(colorPalette = null) {
  if (!colorPalette) {
    colorPalette = AFFORDABILITY_COLOR_PALETTE;
  }

  // Simple expression: if feature-state color is set, use it; otherwise transparent
  return [
    "case",
    ["!=", ["feature-state", "color"], null],
    ["feature-state", "color"],
    "rgba(255, 255, 255, 0)"
  ];
}

/**
 * Set feature states on a map for affordability visualization
 * @param {object} map - Maplibre GL map instance
 * @param {string} sourceId - Source ID (e.g., 'msoa-source')
 * @param {object} msoas - Map of MSOA code -> {ratio: number}
 * @param {array} colorBounds - Bounds array for color breaks
 * @param {array} colorPalette - Color palette
 */
export function updateMapFeatureStates(map, sourceId, msoas, colorBounds, colorPalette) {
  if (!map || !msoas) {
    console.warn("updateMapFeatureStates: map or msoas missing");
    return;
  }
  const source = map.getSource(sourceId);
  if (!source) {
    return;
  }

  if (!colorPalette) {
    colorPalette = AFFORDABILITY_COLOR_PALETTE;
  }

  const intervalCount = Math.max(0, (Array.isArray(colorBounds) ? colorBounds.length : 0) - 1);
  const activePalette = getPaletteForBreaks(colorPalette, intervalCount);

  // Update feature state for each MSOA with its color
  Object.entries(msoas).forEach(([msoacd, data]) => {
    try {
      // Calculate the color for this MSOA based on its ratio
      let color = "#ccc"; // default unavailable
      
      if (Number.isFinite(data.ratio) && intervalCount > 0) {
        // Find which color range this ratio falls into
        for (let i = 0; i < intervalCount; i++) {
          const lowerBound = colorBounds[i];
          const upperBound = colorBounds[i + 1];
          
          if (i === 0 && data.ratio <= upperBound) {
            color = activePalette[i];
            break;
          } else if (i === intervalCount - 1 && data.ratio >= lowerBound) {
            color = activePalette[i];
            break;
          } else if (data.ratio >= lowerBound && data.ratio < upperBound) {
            color = activePalette[i];
            break;
          }
        }
      }
      
      map.setFeatureState(
        { source: sourceId, sourceLayer: 'msoa', id: msoacd },
        { color: color }
      );
    } catch (e) {
      // Feature may not exist on current zoom level
    }
  });
}

/**
 * Get MSOA by postcode using the postcodes.io API
 * @param {string} postcode - Postcode to search
 * @returns {object|null} MSOA data or null if not found
 */
export async function getMSOAByPostcode(postcode, msoas) {
  try {
    const normalized = normalizePostcode(postcode);
    const response = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(normalized)}`);
    if (!response.ok) return null;

    const json = await response.json();
    if (!json.result || !json.result.longitude || !json.result.latitude) return null;

    const lon = json.result.longitude;
    const lat = json.result.latitude;

    // Find MSOA containing this point
    // For now, return the nearest MSOA or use bulk lookup
    // TODO: Implement spatial lookup if needed
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Search for places including LTLAs and MSOAs
 * @param {string} query - Search query
 * @param {array} allAreaNames - LTLA names from master-topo
 * @param {object} msoas - MSOA data (code -> {name, la_code, ...})
 * @returns {array} Array of search results
 */
export async function searchPlaces(query, allAreaNames = [], msoas = {}) {
  if (!query || query.length < 2) return [];

  const queryLower = query.toLowerCase();
  const results = [];

  // Search LTLA names (from master-topo)
  const areaMatches = allAreaNames.filter((name) =>
    name.toLowerCase().includes(queryLower)
  );

  areaMatches.slice(0, 5).forEach((name) => {
    results.push({
      id: name,
      label: name,
      type: "ltla",
      priority: 2,
    });
  });

  // Search MSOA names from affordability data
  Object.values(msoas).forEach((msoa) => {
    if (msoa.name.toLowerCase().includes(queryLower) && results.length < 15) {
      results.push({
        id: msoa.code,
        label: `${msoa.name} (${msoa.la_name})`,
        type: "msoa",
        priority: 1,
        msoaCode: msoa.code,
        laCode: msoa.la_code,
      });
    }
  });

  // Try postcode lookup only if query has at least 1-2 letters and a number
  // UK postcodes start with 1-2 letters followed by a digit
  const postcodePattern = /^[a-z]{1,2}\d/i;
  if (postcodePattern.test(query)) {
    try {
      const postcodes = await fetchPostcodes(query);
      postcodes.slice(0, 10).forEach((postcode) => {
        results.push({
          id: postcode,
          label: postcode,
          type: "postcode",
          priority: 0,
        });
      });
    } catch (e) {
      // Silently fail on postcode lookup
    }
  }

  // Sort by priority, then by query match position
  results.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    const aPos = a.label.toLowerCase().indexOf(queryLower);
    const bPos = b.label.toLowerCase().indexOf(queryLower);
    return aPos - bPos;
  });

  return results;
}

/**
 * Get Local Authority boundaries as GeoJSON from topoJSON
 * Filters the 'ltla' features from master-topo
 * @returns {object} GeoJSON FeatureCollection with LA boundaries
 */
export function getLocalAuthorityGeoJSON() {
  if (!topoData || !topoData.objects || !topoData.objects.ltla) {
    return { type: "FeatureCollection", features: [] };
  }

  try {
    const features = topojson.feature(topoData, topoData.objects.ltla).features;
    
    const geojson = {
      type: "FeatureCollection",
      features: features.map((feature) => ({
        type: "Feature",
        id: feature.properties?.areacd || feature.properties?.code,
        properties: {
          id: feature.properties?.areacd || feature.properties?.code,
          name: feature.properties?.areanm || feature.properties?.name,
          ...feature.properties,
        },
        geometry: feature.geometry,
      })),
    };

    return geojson;
  } catch (e) {
    console.error("Failed to extract LA boundaries from topoJSON:", e);
    return { type: "FeatureCollection", features: [] };
  }
}

// ========== BEESWARM DATA ==========

/**
 * Load national affordability for a property type
 * @param {string} propertyType - Property type (all, detached, semi-detached, terraced, flats)
 * @param {string} country - 'england' or 'wales'
 * @returns {object|null} National affordability data or null
 */
export async function loadNationalAffordability(propertyType = 'all', country = 'england') {
  const cacheKey = `${propertyType}:national:${country}`;
  if (nationalAffordabilityCache[cacheKey]) {
    return nationalAffordabilityCache[cacheKey];
  }

  try {
    const response = await fetch(withBase(`/data/${propertyType}/national/${country}.json`));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    nationalAffordabilityCache[cacheKey] = data.affordability?.median || null;
    return nationalAffordabilityCache[cacheKey];
  } catch (error) {
    console.error(`Failed to load national affordability for ${propertyType}/${country}:`, error.message);
    return null;
  }
}

/**
 * Load regional affordability by aggregating LAs in a region
 * @param {string} propertyType - Property type (all, detached, semi-detached, terraced, flats)
 * @param {string} regionCode - Region code
 * @param {string} regionName - Region name (for caching)
 * @returns {object|null} Regional median affordability or null
 */
export async function loadRegionalAffordability(propertyType = 'all', regionCode = '', regionName = '') {
  if (!regionCode && !regionName) return null;

  const cacheKey = `${propertyType}:region:${regionCode || regionName}`;
  if (regionalMedianAffordabilityCache[cacheKey]) {
    return regionalMedianAffordabilityCache[cacheKey];
  }

  try {
    const authorities = await loadGeographyAuthorities();
    const regionLAs = authorities.filter(auth => auth.region_code === regionCode);

    if (regionLAs.length === 0) {
      return null;
    }

    let totalPrice = 0;
    let totalEarnings = 0;
    let count = 0;

    for (const la of regionLAs) {
      try {
        const laData = await loadLocalAuthorityData(propertyType, la.code);
        const median = laData?.affordability?.median;
        if (median?.price && median?.earnings) {
          totalPrice += median.price;
          totalEarnings += median.earnings;
          count += 1;
        }
      } catch (e) {
        // Skip LAs that fail to load
      }
    }

    if (count === 0) {
      return null;
    }

    const regional = {
      price: Math.round(totalPrice / count),
      earnings: Math.round(totalEarnings / count),
      ratio: roundToTwoDecimals((totalPrice / count) / (totalEarnings / count)),
    };

    regionalMedianAffordabilityCache[cacheKey] = regional;
    return regional;
  } catch (error) {
    console.error(`Failed to load regional affordability for ${regionCode}:`, error.message);
    return null;
  }
}

/**
 * Transform MSOA affordability data into beeswarm chart format
 * @param {array} msoas - Array of MSOA objects with affordability data
 * @param {object} regionAffordability - Region average affordability
 * @param {object} nationalAffordability - National average affordability
 * @returns {array} Array formatted for ScatterChart
 */
export function transformMsoaDataForBeeswarm(msoas = [], regionAffordability = null, nationalAffordability = null) {
  const data = [];

  msoas.forEach((msoa, index) => {
    if (msoa?.affordability?.median?.ratio) {
      data.push({
        x: index,
        y: msoa.affordability.median.ratio,
        label: msoa.name || msoa.code,
        code: msoa.code,
        type: 'msoa',
      });
    }
  });

  if (regionAffordability?.ratio) {
    data.push({
      x: data.length,
      y: regionAffordability.ratio,
      label: 'Region Average',
      type: 'region',
    });
  }

  if (nationalAffordability?.ratio) {
    data.push({
      x: data.length,
      y: nationalAffordability.ratio,
      label: 'Nation Average',
      type: 'nation',
    });
  }

  return data;
}
