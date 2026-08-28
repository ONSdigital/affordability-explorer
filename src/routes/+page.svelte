<script>
  import { onMount } from "svelte";
  import { Map, MapSource, MapLayer } from "@onsvisual/svelte-maps";
  import {
    AccessibleSelect,
    Container,
    Section,
    ButtonGroup,
    ButtonGroupItem,
    Grid,
    Card,
  } from "@onsvisual/svelte-components";
  import {
    loadTopoJSON,
    getBoundariesGeoJSON,
    getLocalAuthorityGeoJSON,
    getBoundaryById,
    getBoundaryByName,
    getAreaNames,
    fetchPostcodes,
    findBoundaryAtPoint,
    loadAffordabilityData,
    createColorExpression,
    calculateColorBreaks,
    updateMapFeatureStates,
    searchPlaces,
  } from "../lib/map-utils.js";
  import ColorLegend from "../lib/components/ColorLegend.svelte";

  let map;
  let geojson;
  let laGeojson;
  let selectedBoundary = null;
  let selectedFeatureId = null;
  let hovered = null;
  let selected = null;
  let selectedLACode = null;
  let zoom = 7;
  let center = { lng: -3.5, lat: 54 };
  let loading = true;
  let error = null;

  // Filter controls
  let propertyType = "all";
  let priceLevel = "median";
  let affordabilityData = {};
  let colorExpression = null;
  let colorBounds = [];
  let mapLoading = false;

  // UK bounds
  const bounds = {
    uk: [
      [-9, 49],
      [2, 61],
    ],
  };

  let mapStyle = {
    version: 8,
    sources: {},
    layers: [],
  };
  let allAreaNames = [];
  let selectedValue = null;
  let clearInput;
  let selectElement;

  onMount(async () => {
    console.log("Page mounted, initializing map...");
    try {
      await loadTopoJSON();

      allAreaNames = getAreaNames();

      geojson = getBoundariesGeoJSON();

      // Extract LA boundaries from topoJSON for highlighting
      laGeojson = getLocalAuthorityGeoJSON();

      // Load the style
      const styleResponse = await fetch("/style.json");
      mapStyle = await styleResponse.json();
      console.log("Map style and data loaded");

      loading = false;
    } catch (e) {
      error = "Failed to load map data";
      loading = false;
      console.error("Mount error:", e);
    }
  });

  // Reactive: Load affordability data and update map colors when filters change
  $: {
    console.log('Reactive check: map =', !!map, 'propertyType =', propertyType, 'priceLevel =', priceLevel);
    if (map && propertyType && priceLevel) {
      console.log('Triggering loadAndColorMap with:', { propertyType, priceLevel });
      loadAndColorMap(propertyType, priceLevel);
    }
  }

  // Separate reactive for when map loads
  $: if (map && Object.keys(mapStyle).length > 0) {
    console.log("Map component loaded, waiting for layers...");
  }
  
  $: if (map && Object.keys(mapStyle).length > 0) {
    console.log("Map fully initialized");
    // Trigger color map load if not already triggered
    if (propertyType && priceLevel && !mapLoading && Object.keys(affordabilityData).length === 0) {
      console.log("Explicitly triggering loadAndColorMap after map ready");
      loadAndColorMap(propertyType, priceLevel);
    }
  }

  // When selected changes, update selectedBoundary and zoom
  $: if (selected !== null && selected !== undefined) {
    const boundary = getBoundaryById(selected);
    if (boundary) {
      selectBoundary(boundary);
    }
  } else if (selected === null && selectedFeatureId) {
    // Cleared selection
    clearSelection();
  }

  function highlightLA(laCode) {
    // Highlight the LA boundary when MSOA is selected using feature state
    if (!map || !laCode || !laGeojson) return;

    try {
      // Only try to highlight if the source exists on the map
      if (map.getSource("la-geojson")) {
        map.setFeatureState(
          { source: "la-geojson", id: laCode },
          { highlighted: true }
        );
        selectedLACode = laCode;
      }
    } catch (e) {
      console.warn("Could not highlight LA boundary:", e);
    }
  }

  function clearLAHighlight(laCode) {
    if (!map || !laCode || !laGeojson) return;

    try {
      // Only try to clear if the source exists on the map
      if (map.getSource("la-geojson")) {
        map.setFeatureState(
          { source: "la-geojson", id: laCode },
          { highlighted: false }
        );
      }
    } catch (e) {
      // Silently fail
    }
  }

  async function loadAndColorMap(pType, pLevel) {
    console.log("=== Starting loadAndColorMap ===", { pType, pLevel });
    mapLoading = true;
    try {
      console.log("Fetching affordability data...");
      affordabilityData = await loadAffordabilityData(pType, pLevel);
      console.log(`Loaded affordability data: ${Object.keys(affordabilityData).length} MSOAs`);
      
      if (Object.keys(affordabilityData).length === 0) {
        console.error("CRITICAL: affordabilityData is empty! Check console for loadAffordabilityData errors.");
        error = "Failed to load affordability data - check console";
        mapLoading = false;
        return;
      }
      
      colorBounds = calculateColorBreaks(affordabilityData);
      console.log("Color bounds:", colorBounds);
      
      colorExpression = createColorExpression();
      console.log("Color expression created:", colorExpression.length > 0);
      
      // Wait for both source and layer to exist in the map
      if (map) {
        let attempts = 0;
        let sourceExists = false;
        let layerExists = false;
        
        while ((!sourceExists || !layerExists) && attempts < 50) {
          try {
            sourceExists = !!map.getSource("msoa-source");
          } catch (e) {
            sourceExists = false;
          }
          
          try {
            layerExists = !!map.getLayer("msoa-fill");
          } catch (e) {
            layerExists = false;
          }
          
          console.log("Waiting for source/layer...", attempts, { sourceExists, layerExists });
          
          if (!sourceExists || !layerExists) {
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
          } else {
            break;
          }
        }
        
        if (!sourceExists) {
          console.error("msoa-source never appeared in map");
          mapLoading = false;
          return;
        }
        
        if (!layerExists) {
          console.error("msoa-fill layer never appeared in map");
          mapLoading = false;
          return;
        }
        
        console.log("Source and layer found, updating styles");
      }
      
      // First, update feature states on map so they're available when paint expression evaluates
      if (map && affordabilityData) {
        console.log("Setting feature states for", Object.keys(affordabilityData).length, "MSOAs");
        updateMapFeatureStates(map, "msoa-source", affordabilityData, colorBounds);
        
        // Apply the color expression to the layer
        try {
          const expr = [
            "case",
            ["!=", ["feature-state", "color"], null],
            ["feature-state", "color"],
            "rgba(255, 255, 255, 0)"
          ];
          map.setPaintProperty("msoa-fill", "fill-color", expr);
          console.log("Fill color paint expression applied");
        } catch (e) {
          console.warn("Could not apply fill-color expression:", e);
        }
      }

      mapLoading = false;
    } catch (e) {
      console.error("Error in loadAndColorMap - Full error:", e);
      console.error("Error message:", e.message);
      console.error("Error stack:", e.stack);
      console.error("affordabilityData state:", affordabilityData);
      console.error("colorBounds state:", colorBounds);
      console.error("colorExpression state:", colorExpression);
      error = `Failed to load affordability data: ${e.message}`;
      mapLoading = false;
    }
  }

  async function customLoadOptions(query, populateResults) {
    const results = [];

    if (!query) {
      // Show LTLAs and MSOAs
      const ltlaOptions = allAreaNames.slice(0, 10).map((name) => ({
        id: name,
        label: name,
        type: "ltla",
      }));
      
      const msoaOptions = Object.values(affordabilityData).slice(0, 10).map((msoa) => ({
        id: msoa.code,
        label: `${msoa.name} (${msoa.la_name})`,
        type: "msoa",
        msoaCode: msoa.code,
        laCode: msoa.la_code,
      }));
      
      populateResults([...ltlaOptions, ...msoaOptions]);
      return;
    }

    // Use new search function
    const searchResults = await searchPlaces(query, allAreaNames, affordabilityData);
    populateResults(searchResults);
  }

  function handleSelectChange(value) {
    if (!value) return;

    const selectedOption = value;
    const { type, id, msoaCode, laCode } = selectedOption;

    if (type === "postcode") {
      selectAreaByPostcode(id);
    } else if (type === "ltla") {
      const boundary = getBoundaryByName(id);
      if (boundary) {
        selectBoundary(boundary);
      }
    } else if (type === "msoa") {
      // Clear any previous selection
      if (selected && map) {
        try {
          map.setFeatureState(
            { source: "msoa-source", sourceLayer: "msoa", id: selected },
            { selected: false }
          );
        } catch (e) {
          // Silently fail
        }
      }
      
      // Clear any previous LA highlight
      if (selectedLACode) {
        clearLAHighlight(selectedLACode);
      }
      
      // For MSOA selection, highlight the parent LA
      if (laCode) {
        highlightLA(laCode);
      }
      
      // Set the MSOA as selected
      if (msoaCode) {
        // Update reactive variable for MapLayer binding
        selected = msoaCode;
        selectedFeatureId = msoaCode;
        
        // Also set feature state for paint expression (opacity)
        if (map) {
          try {
            map.setFeatureState(
              { source: "msoa-source", sourceLayer: "msoa", id: msoaCode },
              { selected: true }
            );
            console.log("MSOA selected:", msoaCode);
          } catch (e) {
            console.warn("Could not set feature state:", e);
          }
        }
        
        // Populate search box with selected MSOA
        if (affordabilityData && affordabilityData[msoaCode]) {
          const msoa = affordabilityData[msoaCode];
          selectedValue = {
            id: msoaCode,
            label: `${msoa.name} (${msoa.la_name})`,
            type: "msoa",
          };
        }
        
        // Zoom to show the MSOA area better
        if (map) {
          map.flyTo({
            center: [-3.5, 54],
            zoom: 8,
            duration: 1000
          });
        }
      }
    }
    
    // Close search menu
    closeSearchMenu();
  }

  function closeSearchMenu() {
    if (selectElement) {
      const input = selectElement.querySelector("input");
      if (input) {
        input.blur();
      }
    }
  }

  function selectBoundary(boundary) {
    selectedBoundary = boundary;
    selectedFeatureId = boundary.id;

    // Populate search box with selected area
    selectedValue = {
      id: boundary.name,
      label: boundary.name,
      type: "area",
    };

    // Close search menu
    closeSearchMenu();

    // Highlight parent LA if this is an MSOA
    if (affordabilityData && affordabilityData[boundary.id]) {
      const msoaData = affordabilityData[boundary.id];
      highlightLA(msoaData.la_code);
    }

    if (map) {
      // Zoom to the selected boundary
      const [minLng, minLat, maxLng, maxLat] = [
        boundary.bounds[0][0],
        boundary.bounds[0][1],
        boundary.bounds[1][0],
        boundary.bounds[1][1],
      ];

      map.fitBounds(
        [
          [minLng, minLat],
          [maxLng, maxLat],
        ],
        {
          padding: 50,
          duration: 1000,
        },
      );
    }
  }

  async function selectAreaByPostcode(code) {
    const url = `https://api.postcodes.io/postcodes/${encodeURIComponent(code)}`;
    try {
      const response = await fetch(url);
      if (!response.ok) {
        error = "Invalid postcode";
        return;
      }

      const json = await response.json();
      if (!json || !json.result) {
        error = "Invalid postcode";
        return;
      }

      const lon = +json.result.longitude;
      const lat = +json.result.latitude;
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
        error = "Area unavailable";
        return;
      }

      // Find the LTLA boundary containing this postcode
      const ltla = findBoundaryAtPoint(lon, lat, "ltla");
      if (ltla) {
        selectBoundary(ltla);
      } else {
        error = "Area not found for this postcode";
      }
    } catch (e) {
      error = "Area unavailable";
    }
  }

  function clearSelection() {
    selectedBoundary = null;
    selectedFeatureId = null;
    selected = null;
    selectedValue = null;
    error = null;

    // Clear LA highlight if one was set
    if (selectedLACode) {
      clearLAHighlight(selectedLACode);
      selectedLACode = null;
    }

    if (clearInput) {
      clearInput();
    }

    // Zoom back to UK bounds
    if (map) {
      map.fitBounds(
        [
          [-9, 49],
          [2, 61],
        ],
        {
          padding: 50,
          duration: 1000,
        },
      );
    }
  }
</script>

<Section>
  <Container width="full">
    <ButtonGroup name="property-type" legend="Property type" bind:value={propertyType}>
      <ButtonGroupItem value="all" label="All properties" />
      <ButtonGroupItem value="detached" label="Detached" />
      <ButtonGroupItem value="semi-detached" label="Semi-detached" />
      <ButtonGroupItem value="terraced" label="Terraced" />
      <ButtonGroupItem value="flats" label="Flats and maisonettes" />
    </ButtonGroup>

    <ButtonGroup name="price-level" legend="Price level" bind:value={priceLevel}>
      <ButtonGroupItem value="median" label="Median" />
      <ButtonGroupItem value="lq" label="Entry level" />
    </ButtonGroup>
  </Container>
</Section>

<Section title="Explore an area">
  <Container width="full">
    {#if error}
      <div class="error-message">
        <p><strong>Error:</strong> {error}</p>
      </div>
    {:else if loading}
      <div class="loading-message">
        <p>Loading map data...</p>
      </div>
    {:else}
      <div bind:this={selectElement}>
        <AccessibleSelect
          id="search-input"
          label="Search for an area or postcode"
          placeholder="e.g. London, SW1A 1AA, North East..."
          mode="search"
          bind:value={selectedValue}
          bind:clearInput
          loadOptions={customLoadOptions}
          on:change={(e) => handleSelectChange(e.detail)}
        />
      </div>
    {/if}
  </Container>
</Section>

<Section>
  <Container width="full">
    <div class="map-wrapper">
      {#if mapStyle}
        {#if mapLoading}
          <div class="map-loading-overlay">
            <p>Loading affordability data...</p>
          </div>
        {/if}
        <Map
          id="mapsearch-map"
          style={mapStyle}
          location={{ lng: -3.5, lat: 54, zoom: 6 }}
          bind:map
          bind:zoom
          bind:center
          minzoom={6}
          controls={true}
          attribution={true}
          scrollZoomGuard={true}
        >
          <!-- Vector tile source for MSOA boundaries with affordability coloring -->
          <MapSource
            id="msoa-source"
            type="vector"
            url="https://cdn.ons.gov.uk/maptiles/administrative/2021/msoa/v2/boundaries/{'{z}/{x}/{y}'}.pbf"
            layer="msoa"
            promoteId="areacd"
          >
            <MapLayer
              id="msoa-fill"
              type="fill"
              hover={true}
              bind:hovered
              select={true}
              bind:selected
              paint={{
                "fill-opacity": [
                  "case",
                  ["==", ["feature-state", "selected"], true],
                  0.9,
                  ["==", ["feature-state", "hovered"], true],
                  0.85,
                  0.7,
                ],
              }}
            />
            <MapLayer
              id="msoa-outline"
              type="line"
              paint={{
                "line-color": [
                  "case",
                  ["==", ["feature-state", "selected"], true],
                  "#333",
                  ["==", ["feature-state", "hovered"], true],
                  "#666",
                  "#999",
                ],
                "line-width": [
                  "case",
                  ["==", ["feature-state", "selected"], true],
                  2,
                  ["==", ["feature-state", "hovered"], true],
                  1,
                  0.5,
                ],
                "line-opacity": 0.5,
              }}
            />
          </MapSource>

          <!-- Local Authority boundaries highlight (from master-topo GeoJSON) -->
          {#if laGeojson}
            <MapSource
              id="la-geojson"
              type="geojson"
              data={laGeojson}
              promoteId="id"
            >
              <MapLayer
                id="la-outline"
                type="line"
                paint={{
                  "line-color": [
                    "case",
                    ["==", ["feature-state", "highlighted"], true],
                    "#1f77b4",
                    "transparent",
                  ],
                  "line-width": [
                    "case",
                    ["==", ["feature-state", "highlighted"], true],
                    2.5,
                    0,
                  ],
                  "line-opacity": 0.8,
                }}
              />
            </MapSource>
          {/if}
        </Map>
      {/if}
    </div>

    {#if selectedBoundary}
      <div class="selection-info">
        <p>
          <strong>Selected:</strong>
          {selectedBoundary.name}
          ({selectedBoundary.type})
        </p>
        <button on:click={clearSelection} class="clear-btn"
          >Clear Selection</button
        >
      </div>
    {/if}

    <div class="map-footer">
      <div class="map-info">
        <strong>Map Info:</strong>
        Zoom: {zoom ? zoom.toFixed(1) : "—"} | Lng: {center.lng
          ? center.lng.toFixed(2)
          : "—"} | Lat: {center.lat ? center.lat.toFixed(2) : "—"}
        {#if hovered}
          | Hovered: {hovered}
        {/if}
        {#if mapLoading}
          | <span class="status-loading">Loading data...</span>
        {/if}
      </div>

      {#if affordabilityData && colorBounds.length > 0}
        <div class="legend-container">
          <ColorLegend bounds={colorBounds} />
        </div>
      {/if}
    </div>
  </Container>
</Section>

<Section title="Affordability snapshot">
  <Grid width="full">
    <Card title="House price to earnings ratio"></Card>
    <Card title="Comparisons"></Card>
    <Card title="Property sales over time"></Card>
  </Grid>
</Section>

<Section title="What would I need to buy?">
  <Grid width="full">
    <Card title="Property cost"></Card>
    <Card title="Income required"></Card>
    <Card title="Total savings needed"></Card>
  </Grid>
</Section>

<style>
  .error-message {
    padding: 12px 16px;
    background-color: #fef2f2;
    border-left: 4px solid #dc2626;
    border-radius: 2px;
    margin: 16px 0;
  }

  .error-message p {
    margin: 0;
    font-size: 13px;
    color: #7f1d1d;
  }

  .loading-message {
    padding: 12px 16px;
    background-color: #f3f4f6;
    border-left: 4px solid #9ca3af;
    border-radius: 2px;
    margin: 16px 0;
  }

  .loading-message p {
    margin: 0;
    font-size: 13px;
    color: #374151;
  }

  .selection-info {
    padding: 12px 16px;
    background-color: #f0f7ff;
    border-left: 4px solid #0078d4;
    border-radius: 2px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    margin: 16px 0;
  }

  .selection-info p {
    margin: 0;
    font-size: 13px;
  }

  .clear-btn {
    padding: 6px 12px;
    background-color: white;
    border: 1px solid #ccc;
    border-radius: 3px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
    transition: background-color 0.2s;
  }

  .clear-btn:hover {
    background-color: #f0f0f0;
  }

  .map-wrapper {
    height: 600px;
    border-radius: 4px;
    overflow: hidden;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    position: relative;
  }

  .map-loading-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgba(255, 255, 255, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10;
    border-radius: 4px;
  }

  .map-loading-overlay p {
    font-size: 14px;
    color: #333;
    margin: 0;
  }

  .map-footer {
    margin-top: 12px;
    display: flex;
    gap: 16px;
    align-items: flex-start;
  }

  .map-info {
    font-size: 12px;
    color: #666;
    padding: 8px 12px;
    background-color: #f9f9f9;
    border-radius: 3px;
    border: 1px solid #ddd;
    font-family: "Courier New", monospace;
    flex: 1;
    margin: 0;
  }

  .legend-container {
    max-width: 300px;
  }

  .status-loading {
    color: #0078d4;
    font-weight: 500;
  }

  .map-wrapper :global(.mapboxgl-canvas) {
    cursor: pointer;
  }

  @media (max-width: 768px) {
    .map-wrapper {
      height: 400px;
    }

    .selection-info {
      flex-direction: column;
      align-items: flex-start;
    }

    .map-footer {
      flex-direction: column;
    }

    .legend-container {
      max-width: 100%;
    }
  }
</style>
