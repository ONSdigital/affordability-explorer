import * as topojson from 'topojson-client';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';

let boundaries = [];
let areaNames = [];
let areaNameToCode = {};
let topoData = null;

const UK_POSTCODE_RE = /^[A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2}$/i;

/**
 * Load and cache TopoJSON data
 * @param {string} topoPath - Path to TopoJSON file (default: '/master-topo.json')
 * @returns {object|null} Loaded TopoJSON data or null if error
 */
export async function loadTopoJSON(topoPath = '/master-topo.json') {
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
    const response = await fetch(`/data/${propertyType}/msoas-latest.json`);
    console.log(`Fetching /data/${propertyType}/msoas-latest.json - Status: ${response.status}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    console.log(`Loaded data structure - msoas array:`, data.msoas ? data.msoas.length : 'no msoas key');

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
    console.log(`Processed ${Object.keys(msoas).length} MSOAs for cache key: ${cacheKey}`);

    affordabilityCache[cacheKey] = msoas;
    return msoas;
    } catch (error) {
      console.error(`Failed to load affordability data for ${propertyType}/${priceLevel}:`, error.message, error.stack);
      console.error("Full error object:", error);
      return {};
    }
}

/**
 * Calculate equal interval breaks for affordability ratios
 * Returns array of bounds (numColors + 1 values) for use in legend
 * @param {object} msoas - Map of MSOA code -> {ratio: number}
 * @param {number} numColors - Number of colors (default: 7)
 * @returns {array} Array of bounds including min and max (e.g., [1.64, 9.55, 17.46, ..., 57.02])
 */
export function calculateColorBreaks(msoas, numColors = 7) {
  // Extract non-null ratios and sort
  const ratios = Object.values(msoas)
    .map((m) => m.ratio)
    .filter((r) => r !== null && isFinite(r))
    .sort((a, b) => a - b);

  console.log(`calculateColorBreaks: Found ${ratios.length} valid ratios`);
  console.log(`Min ratio: ${ratios[0]}, Max ratio: ${ratios[ratios.length - 1]}`);

  if (ratios.length === 0) {
    console.warn("No valid ratios found for color breaks");
    return [];
  }

  // Use equal interval breaks
  const minRatio = ratios[0];
  const maxRatio = ratios[ratios.length - 1];
  const range = maxRatio - minRatio;

  // Create bounds array: [min, break1, break2, ..., breakN, max]
  const bounds = [minRatio];
  for (let i = 1; i < numColors; i++) {
    const breakValue = minRatio + (range * i) / numColors;
    bounds.push(Math.round(breakValue * 100) / 100); // Round to 2 decimals
  }
  bounds.push(maxRatio); // Add max value

  console.log("Color bounds:", bounds);
  return bounds;
}

/**
 * Create a simple paint expression for data-driven coloring using feature state colors
 * @param {array} colorPalette - Color array (default: affordability palette)
 * @returns {array} Maplibre GL paint expression
 */
export function createColorExpression(colorPalette = null) {
  if (!colorPalette) {
    colorPalette = ["#E92730", "#f0702f", "#f6ae35", "#f1ec37", "#95ca53", "#2ea949", "#0a8647"];
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
    console.warn("updateMapFeatureStates: source not found:", sourceId);
    console.warn("Available sources:", Object.keys(map.getStyle().sources || {}));
    return;
  }

  if (!colorPalette) {
    colorPalette = ["#E92730", "#f0702f", "#f6ae35", "#f1ec37", "#95ca53", "#2ea949", "#0a8647"];
  }

  let successCount = 0;
  let errorCount = 0;
  let loggedErrors = [];
  
  // Sample first few MSOAs
  const msoacdKeys = Object.keys(msoas).slice(0, 3);
  console.log("Sample MSOAs for feature state:", msoacdKeys);
  
  // Update feature state for each MSOA with its color
  Object.entries(msoas).forEach(([msoacd, data]) => {
    try {
      // Calculate the color for this MSOA based on its ratio
      let color = "#ccc"; // default unavailable
      
      if (data.ratio !== null && colorBounds.length > 0) {
        // Find which color range this ratio falls into
        for (let i = 0; i < colorPalette.length; i++) {
          const lowerBound = colorBounds[i];
          const upperBound = colorBounds[i + 1];
          
          if (i === 0 && data.ratio < upperBound) {
            color = colorPalette[i];
            break;
          } else if (i === colorPalette.length - 1 && data.ratio >= lowerBound) {
            color = colorPalette[i];
            break;
          } else if (data.ratio >= lowerBound && data.ratio < upperBound) {
            color = colorPalette[i];
            break;
          }
        }
      }
      
      map.setFeatureState(
        { source: sourceId, sourceLayer: 'msoa', id: msoacd },
        { color: color }
      );
      successCount++;
    } catch (e) {
      errorCount++;
      if (loggedErrors.length < 3) {
        loggedErrors.push(e.message);
      }
      // Feature may not exist on current zoom level
    }
  });
  
  console.log(`Feature states set: ${successCount} success, ${errorCount} errors`);
  if (loggedErrors.length > 0) {
    console.warn("Sample errors:", loggedErrors);
  }
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

  // Try postcode lookup
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
