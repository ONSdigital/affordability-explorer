<script>
  import { onMount } from "svelte";
  import { base } from "$app/paths";
  import { ColumnChart, LineChart, ScatterChart } from "@onsvisual/svelte-charts";
  import { Map, MapSource, MapLayer } from "@onsvisual/svelte-maps";
  import {
    AccessibleSelect,
    Container,
    Section,
    ButtonGroup,
    ButtonGroupItem,
    Grid,
    Card,
    Checkbox,
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
    loadLocalAuthorityData,
    getMsoaAffordabilityFromLocalAuthority,
    loadCountryAffordability,
    createColorExpression,
    calculateColorBreaks,
    updateMapFeatureStates,
    searchPlaces,
    loadNationalAffordability,
    loadRegionalAffordability,
    transformMsoaDataForBeeswarm,
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
  const defaultMapView = {
    lng: -1.9,
    lat: 52.5,
    zoom: 6,
  };
  let zoom = defaultMapView.zoom;
  let center = { lng: defaultMapView.lng, lat: defaultMapView.lat };
  let loading = true;
  let error = null;

  // Filter controls
  let propertyType = "all";
  let priceLevel = "median";
  let affordabilityData = {};
  let colorExpression = null;
  let colorBounds = [];
  let mapLoading = false;
  let snapshotRatios = null;
  let snapshotLoading = false;
  let snapshotError = null;
  let selectedMsoaForSnapshot = null;
  let selectedLAForSnapshot = null;
  let selectedAreaType = null;
  let selectedAreaForData = null;
  let snapshotSelectionKey = "";
  let snapshotRequestId = 0;
  let comparisonRatios = null;
  let comparisonLoading = false;
  let comparisonError = null;
  let comparisonSelectionKey = "";
  let comparisonRequestId = 0;
  let salesOverTimeData = [];
  let salesOverTimeName = null;
  let salesOverTimePeriodLabel = null;
  let salesOverTimeLoading = false;
  let salesOverTimeError = null;
  let salesOverTimeSelectionKey = "";
  let salesOverTimeRequestId = 0;
  let buySectionData = null;
  let buySectionLoading = false;
  let buySectionError = null;
  let buySectionSelectionKey = "";
  let buySectionRequestId = 0;
  let isFirstTimeBuyer = false;
  let totalSavingsData = null;
  let legendHoveredRange = null;
  let legendSelectedRange = null;
  let legendHoverIndicatorValue = null;
  let legendSelectedIndicatorValue = null;
  let beeswarmData = null;
  let beeswarmLoading = false;
  let beeswarmError = null;
  let beeswarmSelectionKey = "";
  let beeswarmRequestId = 0;
  let beeswarmLegendDomain = [];
  let beeswarmColors = [];
  let beeswarmXMin = null;
  let beeswarmXMax = null;
  const BEESWARM_TYPE_ORDER = [
    "Selected area",
    "Other MSOAs in LA",
    "Region average",
    "National average",
  ];
  const BEESWARM_COLOR_MAP = {
    "Selected area": "#003c57",
    "Other MSOAs in LA": "#1570bf",
    "Region average": "#fd7e14",
    "National average": "#e74c3c",
  };
  const snapshotFlagThreshold = 5;
  const propertyTypeLabels = {
    all: "All properties",
    detached: "Detached",
    "semi-detached": "Semi-detached",
    terraced: "Terraced",
    flats: "Flats and maisonettes",
  };
  const SALES_YEARS_TO_SHOW = 10;
  const INCOME_MULTIPLIER = 4.5;
  const DEPOSIT_RATE = 0.1;
  const ENGLAND_STAMP_DUTY_BANDS = [
    { upTo: 250000, rate: 0 },
    { upTo: 925000, rate: 0.05 },
    { upTo: 1500000, rate: 0.1 },
    { upTo: Infinity, rate: 0.12 },
  ];
  const ENGLAND_FIRST_TIME_BUYER_BANDS = [
    { upTo: 425000, rate: 0 },
    { upTo: 625000, rate: 0.05 },
  ];
  const ONS_GREY_15 = "#e2e2e3";
  const ONS_GREY_100 = "#414042";
  const ONS_GREY_75 = "#707071";
  const WALES_LTT_BANDS = [
    { upTo: 225000, rate: 0 },
    { upTo: 400000, rate: 0.06 },
    { upTo: 750000, rate: 0.075 },
    { upTo: 1500000, rate: 0.1 },
    { upTo: Infinity, rate: 0.12 },
  ];
  const CITY_LABEL_LAYER_ID = "place_city";
  const LA_OUTLINE_SOURCE_ID = "la-outline-source";
  const LA_OUTLINE_LAYER_ID = "la-outline-layer";
  const MSOA_OUTLINE_BASE_LAYER_ID = "msoa-outline-base";
  const MSOA_LEGEND_MATCH_LAYER_ID = "msoa-legend-match";
  const NO_LA_SELECTION = "__no_la_selection__";

  let mapStyle = null;
  let allAreaNames = [];
  let selectedValue = null;
  let clearInput;
  let selectElement;
  let detachMapHandlers = null;

  onMount(async () => {
    try {
      await loadTopoJSON();

      allAreaNames = getAreaNames();

      geojson = getBoundariesGeoJSON();

      // Extract LA boundaries from topoJSON for highlighting
      laGeojson = getLocalAuthorityGeoJSON();

      // Load the style
      const styleResponse = await fetch(`${base}/style.json`);
      mapStyle = await styleResponse.json();

      loading = false;
    } catch (e) {
      error = "Failed to load map data";
      loading = false;
    }

    return () => {
      if (detachMapHandlers) {
        detachMapHandlers();
      }
    };
  });

  // Reactive: Load affordability data and update map colors when filters change
  $: {
    if (map && propertyType && priceLevel) {
      loadAndColorMap(propertyType, priceLevel);
    }
  }

  // Separate reactive for when map loads
  $: if (map && mapStyle && Object.keys(mapStyle).length > 0) {
    // Trigger color map load if not already triggered
    if (propertyType && priceLevel && !mapLoading && Object.keys(affordabilityData).length === 0) {
      loadAndColorMap(propertyType, priceLevel);
    }
  }

  $: if (map && !detachMapHandlers) {
    const reapplyMapColors = () => {
      applyAffordabilityColors();
      syncLocalAuthorityOutline(selectedLACode);
      if (legendHoveredRange || legendSelectedRange) {
        refreshLegendRangeHighlight();
      }
    };

    const handleSourceData = (event) => {
      if (event?.sourceId === "msoa-source") {
        applyAffordabilityColors();
        if (legendHoveredRange || legendSelectedRange) {
          refreshLegendRangeHighlight();
        }
      }
      syncLocalAuthorityOutline(selectedLACode);
    };

    map.on("idle", reapplyMapColors);
    map.on("sourcedata", handleSourceData);

    detachMapHandlers = () => {
      map.off("idle", reapplyMapColors);
      map.off("sourcedata", handleSourceData);
      detachMapHandlers = null;
    };
  }

  // Clear current selection when an MSOA map selection is explicitly removed.
  $: if (selectedAreaType === "msoa" && selected === null && selectedFeatureId) {
    clearSelection();
  }

  $: selectedMsoaForSnapshot =
    selectedBoundary && affordabilityData[selectedBoundary.id]
      ? affordabilityData[selectedBoundary.id]
      : null;

  $: selectedAreaForData = selectedMsoaForSnapshot
    ? { ...selectedMsoaForSnapshot, type: "msoa" }
    : selectedLAForSnapshot
      ? { ...selectedLAForSnapshot, type: "la" }
      : null;

  $: legendHoverIndicatorValue = getAffordabilityRatioForCode(hovered);
  $: legendSelectedIndicatorValue = getAffordabilityRatioForCode(selected);

  $: {
    const nextSnapshotSelectionKey = selectedAreaForData
      ? `${propertyType}:${selectedAreaForData.type}:${selectedAreaForData.code}`
      : "";

    if (nextSnapshotSelectionKey !== snapshotSelectionKey) {
      snapshotSelectionKey = nextSnapshotSelectionKey;
      if (selectedAreaForData) {
        loadSnapshotRatios(propertyType, selectedAreaForData);
      } else {
        resetSnapshotRatios();
      }
    }
  }

  $: {
    const nextComparisonSelectionKey = selectedAreaForData
      ? `${propertyType}:${selectedAreaForData.type}:${selectedAreaForData.code}`
      : "";

    if (nextComparisonSelectionKey !== comparisonSelectionKey) {
      comparisonSelectionKey = nextComparisonSelectionKey;
      if (selectedAreaForData) {
        loadComparisonRatios(propertyType, selectedAreaForData);
      } else {
        resetComparisonRatios();
      }
    }
  }

  $: {
    const nextSalesOverTimeSelectionKey = selectedAreaForData
      ? `${propertyType}:${selectedAreaForData.type}:${selectedAreaForData.code}`
      : "";

    if (nextSalesOverTimeSelectionKey !== salesOverTimeSelectionKey) {
      salesOverTimeSelectionKey = nextSalesOverTimeSelectionKey;
      if (selectedAreaForData) {
        loadSalesOverTime(propertyType, selectedAreaForData);
      } else {
        resetSalesOverTime();
      }
    }
  }

  $: {
    const nextBuySectionSelectionKey = selectedAreaForData
      ? `${propertyType}:${priceLevel}:${selectedAreaForData.type}:${selectedAreaForData.code}`
      : "";

    if (nextBuySectionSelectionKey !== buySectionSelectionKey) {
      buySectionSelectionKey = nextBuySectionSelectionKey;
      if (selectedAreaForData) {
        loadBuySectionData(propertyType, priceLevel, selectedAreaForData);
      } else {
        resetBuySectionData();
      }
    }
  }

  $: totalSavingsData =
    buySectionData && Number.isFinite(buySectionData.propertyPrice)
      ? calculateTotalSavingsNeeded(
          buySectionData.propertyPrice,
          buySectionData.country,
          isFirstTimeBuyer,
        )
      : null;

  $: if (map && laGeojson) {
    syncLocalAuthorityOutline(selectedLACode);
  }

  $: {
    const nextBeeswarmSelectionKey = selectedAreaForData
      ? `${propertyType}:${selectedAreaForData.type}:${selectedAreaForData.code}`
      : "";

    if (nextBeeswarmSelectionKey !== beeswarmSelectionKey) {
      beeswarmSelectionKey = nextBeeswarmSelectionKey;
      if (selectedAreaForData) {
        loadBeeswarmData(propertyType, selectedAreaForData);
      } else {
        resetBeeswarmData();
      }
    }
  }

  function getLocalAuthorityFeature(laCode) {
    if (!laCode || !laGeojson?.features) return null;

    return (
      laGeojson.features.find((feature) => {
        const props = feature?.properties ?? {};
        return props.areacd === laCode || props.code === laCode || props.id === laCode;
      }) ?? null
    );
  }

  function getFeatureBounds(feature) {
    if (!feature) return null;

    if (Array.isArray(feature.bbox) && feature.bbox.length === 4) {
      const [minLng, minLat, maxLng, maxLat] = feature.bbox;
      if (
        Number.isFinite(minLng) &&
        Number.isFinite(minLat) &&
        Number.isFinite(maxLng) &&
        Number.isFinite(maxLat)
      ) {
        return [
          [minLng, minLat],
          [maxLng, maxLat],
        ];
      }
    }

    if (!feature?.geometry?.coordinates) {
      return null;
    }

    let minLng = Infinity;
    let maxLng = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;

    const extractCoords = (coords) => {
      if (!Array.isArray(coords)) return;

      if (typeof coords[0] === "number" && typeof coords[1] === "number") {
        minLng = Math.min(minLng, coords[0]);
        maxLng = Math.max(maxLng, coords[0]);
        minLat = Math.min(minLat, coords[1]);
        maxLat = Math.max(maxLat, coords[1]);
        return;
      }

      coords.forEach((child) => extractCoords(child));
    };

    extractCoords(feature.geometry.coordinates);

    if (
      !Number.isFinite(minLng) ||
      !Number.isFinite(maxLng) ||
      !Number.isFinite(minLat) ||
      !Number.isFinite(maxLat)
    ) {
      return null;
    }

    return [
      [minLng, minLat],
      [maxLng, maxLat],
    ];
  }

  function zoomToLocalAuthority(laCode) {
    if (!map || !laCode) return;

    const laFeature = getLocalAuthorityFeature(laCode);
    const bounds = getFeatureBounds(laFeature);
    if (!bounds) return;

    map.fitBounds(bounds, {
      padding: 50,
      duration: 1000,
    });
  }

  function getLocalAuthorityOutlineFilter(laCode) {
    if (!laCode) {
      return ["==", ["get", "areacd"], NO_LA_SELECTION];
    }

    return [
      "any",
      ["==", ["get", "areacd"], laCode],
      ["==", ["get", "code"], laCode],
      ["==", ["get", "id"], laCode],
    ];
  }

  function syncLocalAuthorityOutline(laCode) {
    if (!map || !laGeojson?.features?.length) return;
    if (typeof map.isStyleLoaded === "function" && !map.isStyleLoaded()) return;

    try {
      const existingSource = map.getSource(LA_OUTLINE_SOURCE_ID);
      if (!existingSource) {
        map.addSource(LA_OUTLINE_SOURCE_ID, {
          type: "geojson",
          data: laGeojson,
        });
      }

      const msoaOutlineBaseExists = Boolean(map.getLayer(MSOA_OUTLINE_BASE_LAYER_ID));
      const msoaLegendMatchExists = Boolean(map.getLayer(MSOA_LEGEND_MATCH_LAYER_ID));
      const targetBeforeLayer = msoaLegendMatchExists
        ? MSOA_LEGEND_MATCH_LAYER_ID
        : CITY_LABEL_LAYER_ID;

      if (!map.getLayer(LA_OUTLINE_LAYER_ID)) {
        map.addLayer({
          id: LA_OUTLINE_LAYER_ID,
          type: "line",
          source: LA_OUTLINE_SOURCE_ID,
          filter: getLocalAuthorityOutlineFilter(laCode),
          layout: {
            "line-join": "round",
            "line-cap": "round",
          },
          paint: {
            "line-color": ONS_GREY_15,
            "line-width": 3,
            "line-opacity": 1,
          },
        }, targetBeforeLayer);
        return;
      }

      map.setFilter(LA_OUTLINE_LAYER_ID, getLocalAuthorityOutlineFilter(laCode));

      if (msoaLegendMatchExists) {
        map.moveLayer(LA_OUTLINE_LAYER_ID, MSOA_LEGEND_MATCH_LAYER_ID);
      } else if (msoaOutlineBaseExists) {
        map.moveLayer(LA_OUTLINE_LAYER_ID, CITY_LABEL_LAYER_ID);
      }
    } catch (e) {
      console.error("Could not sync local authority outline:", e.message);
    }
  }

  function getAffordabilityRatioForCode(msoaCode) {
    if (!msoaCode || !affordabilityData) {
      return null;
    }

    const ratio = affordabilityData[msoaCode]?.ratio;
    return Number.isFinite(ratio) ? ratio : null;
  }

  function isLegendRangeMatch(value, range) {
    if (!Number.isFinite(value) || !range) {
      return false;
    }

    const min = Number(range.min);
    const max = Number(range.max);
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return false;
    }

    return value >= min && (range.isLast ? value <= max : value < max);
  }

  function clearLegendRangeHighlight() {
    if (!map || !affordabilityData || Object.keys(affordabilityData).length === 0) {
      return;
    }

    try {
      if (!map.getSource("msoa-source")) {
        return;
      }
    } catch (e) {
      return;
    }

    for (const msoaCode of Object.keys(affordabilityData)) {
      try {
        map.setFeatureState(
          { source: "msoa-source", sourceLayer: "msoa", id: msoaCode },
          { legendActive: false, legendMatch: false },
        );
      } catch (e) {
        // Feature may not be available at current zoom.
      }
    }
  }

  function applyLegendRangeHighlight(range) {
    if (!map || !range || !affordabilityData || Object.keys(affordabilityData).length === 0) {
      return;
    }

    try {
      if (!map.getSource("msoa-source")) {
        return;
      }
    } catch (e) {
      return;
    }

    for (const [msoaCode, msoaData] of Object.entries(affordabilityData)) {
      const ratio = msoaData?.ratio;
      const legendMatch = isLegendRangeMatch(ratio, range);

      try {
        map.setFeatureState(
          { source: "msoa-source", sourceLayer: "msoa", id: msoaCode },
          { legendActive: true, legendMatch },
        );
      } catch (e) {
        // Feature may not be available at current zoom.
      }
    }
  }

  function refreshLegendRangeHighlight() {
    const activeRange = legendHoveredRange ?? legendSelectedRange;
    if (activeRange) {
      applyLegendRangeHighlight(activeRange);
      return;
    }

    clearLegendRangeHighlight();
  }

  function normalizeLegendRange(range) {
    if (!range) {
      return null;
    }

    const min = Number(range.min);
    const max = Number(range.max);
    const index = Number(range.index);

    if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(index)) {
      return null;
    }

    return {
      min,
      max,
      index,
      isLast: Boolean(range.isLast),
    };
  }

  function isSameLegendRange(left, right) {
    if (!left || !right) {
      return false;
    }

    return (
      left.index === right.index &&
      left.min === right.min &&
      left.max === right.max &&
      left.isLast === right.isLast
    );
  }

  function handleLegendRangeHover(event) {
    legendHoveredRange = normalizeLegendRange(event?.detail?.range);
    refreshLegendRangeHighlight();
  }

  function handleLegendRangeLeave() {
    legendHoveredRange = null;
    refreshLegendRangeHighlight();
  }

  function handleLegendRangeSelect(event) {
    const nextRange = normalizeLegendRange(event?.detail?.range);
    if (!nextRange) {
      return;
    }

    legendSelectedRange = isSameLegendRange(legendSelectedRange, nextRange)
      ? null
      : nextRange;
    legendHoveredRange = null;
    refreshLegendRangeHighlight();
  }

  function highlightLA(laCode) {
    if (!laCode) return;
    selectedLACode = laCode;
  }

  function clearLAHighlight(laCode) {
    if (!laCode) return;
    if (selectedLACode === laCode) {
      selectedLACode = null;
    }
  }

  async function loadAndColorMap(pType, pLevel) {
    mapLoading = true;
    try {
      affordabilityData = await loadAffordabilityData(pType, pLevel);
      legendHoveredRange = null;
      legendSelectedRange = null;
      
      if (Object.keys(affordabilityData).length === 0) {
        error = "Failed to load affordability data";
        mapLoading = false;
        return;
      }
      
      colorBounds = calculateColorBreaks(affordabilityData);
      colorExpression = createColorExpression();
      
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
          
          if (!sourceExists || !layerExists) {
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
          } else {
            break;
          }
        }
        
        if (!sourceExists) {
          error = "Map source failed to load";
          mapLoading = false;
          return;
        }
        
        if (!layerExists) {
          error = "Map layer failed to load";
          mapLoading = false;
          return;
        }
      }
      
      applyAffordabilityColors();
      clearLegendRangeHighlight();

      mapLoading = false;
    } catch (e) {
      console.error("Error loading map colors:", e.message);
      error = "Failed to load map data";
      mapLoading = false;
    }
  }

  function applyAffordabilityColors() {
    if (!map || !affordabilityData || Object.keys(affordabilityData).length === 0) {
      return;
    }

    try {
      if (!map.getSource("msoa-source") || !map.getLayer("msoa-fill")) {
        return;
      }

      updateMapFeatureStates(map, "msoa-source", affordabilityData, colorBounds);

      map.setPaintProperty(
        "msoa-fill",
        "fill-color",
        colorExpression ?? [
          "case",
          ["!=", ["feature-state", "color"], null],
          ["feature-state", "color"],
          "#ccc",
        ],
      );
    } catch (e) {
      console.error("Could not apply affordability colors:", e.message);
    }
  }

  function resetSnapshotRatios() {
    snapshotRequestId += 1;
    snapshotRatios = null;
    snapshotLoading = false;
    snapshotError = null;
  }

  function getSelectedAreaTypeLabel(selectionType) {
    return selectionType === "la" ? "local authority" : "MSOA";
  }

  function getCountryFromRegionCode(regionCode) {
    return String(regionCode ?? "").startsWith("W") ? "wales" : "england";
  }

  async function loadSnapshotRatios(propertyTypeValue, selection) {
    const requestId = ++snapshotRequestId;
    snapshotLoading = true;
    snapshotError = null;

    try {
      if (selection?.type === "msoa") {
        const msoa = await getMsoaAffordabilityFromLocalAuthority(
          propertyTypeValue,
          selection.la_code,
          selection.code,
        );

        if (requestId !== snapshotRequestId) {
          return;
        }

        if (!msoa || !msoa.affordability) {
          snapshotRatios = null;
          snapshotError = "Affordability data unavailable for this MSOA";
          return;
        }

        snapshotRatios = {
          areaName: msoa.name || selection.name || selection.code,
          areaTypeLabel: "MSOA",
          medianRatio: msoa.affordability?.median?.ratio ?? null,
          lowerQuartileRatio: msoa.affordability?.lq?.ratio ?? null,
        };
        return;
      }

      if (selection?.type === "la") {
        const laData = await loadLocalAuthorityData(propertyTypeValue, selection.code);

        if (requestId !== snapshotRequestId) {
          return;
        }

        if (!laData?.affordability) {
          snapshotRatios = null;
          snapshotError = "Affordability data unavailable for this local authority";
          return;
        }

        snapshotRatios = {
          areaName: laData.name || selection.name || selection.code,
          areaTypeLabel: "LA",
          medianRatio: laData.affordability?.median?.ratio ?? null,
          lowerQuartileRatio: laData.affordability?.lq?.ratio ?? null,
        };
        return;
      }

      snapshotRatios = null;
    } catch (e) {
      if (requestId !== snapshotRequestId) {
        return;
      }
      snapshotRatios = null;
      snapshotError = "Failed to load affordability ratios";
    } finally {
      if (requestId === snapshotRequestId) {
        snapshotLoading = false;
      }
    }
  }

  function resetComparisonRatios() {
    comparisonRequestId += 1;
    comparisonRatios = null;
    comparisonLoading = false;
    comparisonError = null;
  }

  function calculateRegionMedianRatioFromCurrentData(regionCode) {
    if (!regionCode || !affordabilityData) return null;

    const regionalRatios = Object.values(affordabilityData)
      .filter((msoa) => msoa.region_code === regionCode && Number.isFinite(msoa.ratio))
      .map((msoa) => msoa.ratio);

    if (regionalRatios.length === 0) {
      return null;
    }

    const total = regionalRatios.reduce((sum, ratio) => sum + ratio, 0);
    return Math.round((total / regionalRatios.length) * 100) / 100;
  }

  async function loadComparisonRatios(propertyTypeValue, selection) {
    const requestId = ++comparisonRequestId;
    comparisonLoading = true;
    comparisonError = null;

    try {
      const isMsoaSelection = selection?.type === "msoa";
      const laCode = isMsoaSelection ? selection.la_code : selection?.code;
      const laData = await loadLocalAuthorityData(propertyTypeValue, laCode);

      if (requestId !== comparisonRequestId) {
        return;
      }

      const regionCode = isMsoaSelection
        ? selection.region_code ?? laData?.region_code
        : laData?.region_code ?? selection?.region_code;
      const regionName = isMsoaSelection
        ? selection.region_name ?? laData?.region_name
        : laData?.region_name ?? selection?.region_name;
      const country = getCountryFromRegionCode(regionCode);
      const showRegionComparison = country !== "wales";
      const regionMedianRatio = showRegionComparison
        ? calculateRegionMedianRatioFromCurrentData(regionCode)
        : null;
      const countryAffordability = await loadCountryAffordability(propertyTypeValue, country);

      if (requestId !== comparisonRequestId) {
        return;
      }

      const selectedMsoaData = isMsoaSelection
        ? laData?.msoas?.find((msoa) => msoa.code === selection.code)
        : null;

      const nextComparisonRatios = {
        selectionType: isMsoaSelection ? "msoa" : "la",
        msoaMedianRatio: selectedMsoaData?.affordability?.median?.ratio ?? null,
        laMedianRatio: laData?.affordability?.median?.ratio ?? null,
        regionMedianRatio,
        countryMedianRatio: countryAffordability?.median?.ratio ?? null,
        laName: laData?.name ?? selection?.la_name ?? selection?.name ?? "Local authority",
        regionName: regionName ?? "Region",
        countryName: country === "wales" ? "Wales" : "England",
        showRegionComparison,
      };

      const comparisonValues = isMsoaSelection
        ? [
            nextComparisonRatios.msoaMedianRatio,
            nextComparisonRatios.laMedianRatio,
            nextComparisonRatios.countryMedianRatio,
          ]
        : [nextComparisonRatios.laMedianRatio, nextComparisonRatios.countryMedianRatio];

      if (showRegionComparison) {
        comparisonValues.push(nextComparisonRatios.regionMedianRatio);
      }

      const hasComparisonData = comparisonValues.some((value) => Number.isFinite(value));

      if (!hasComparisonData) {
        comparisonRatios = null;
        comparisonError = `Comparison data unavailable for this ${getSelectedAreaTypeLabel(
          selection?.type,
        )}`;
        return;
      }

      comparisonRatios = nextComparisonRatios;
    } catch (e) {
      if (requestId !== comparisonRequestId) {
        return;
      }
      comparisonRatios = null;
      comparisonError = "Failed to load comparison ratios";
    } finally {
      if (requestId === comparisonRequestId) {
        comparisonLoading = false;
      }
    }
  }

  function resetSalesOverTime() {
    salesOverTimeRequestId += 1;
    salesOverTimeData = [];
    salesOverTimeName = null;
    salesOverTimePeriodLabel = null;
    salesOverTimeLoading = false;
    salesOverTimeError = null;
  }

  function parseQuarterParts(quarterValue) {
    const match = String(quarterValue ?? "").match(/^(\d{4})-Q([1-4])$/);
    if (!match) {
      return null;
    }

    return {
      year: Number(match[1]),
      quarter: Number(match[2]),
    };
  }

  function quarterPartsToIndex({ year, quarter }) {
    return year * 4 + (quarter - 1);
  }

  function aggregateRollingAnnualSales(series = [], maxYears = SALES_YEARS_TO_SHOW) {
    const quarterToSales = new globalThis.Map();

    for (const point of series) {
      if (!Number.isFinite(point?.sales)) continue;

      const quarterParts = parseQuarterParts(point.quarter);
      if (!quarterParts) continue;

      const quarterIndex = quarterPartsToIndex(quarterParts);
      quarterToSales.set(quarterIndex, (quarterToSales.get(quarterIndex) ?? 0) + point.sales);
    }

    const availableQuarterIndices = Array.from(quarterToSales.keys()).sort((a, b) => a - b);
    if (availableQuarterIndices.length === 0) {
      return { sales: [], periodLabel: null };
    }

    const latestQuarterIndex = availableQuarterIndices[availableQuarterIndices.length - 1];
    const anchorQuarter = (latestQuarterIndex % 4) + 1;
    const periodLabel = `Q${anchorQuarter}`;
    const annualizedSales = [];

    for (const endQuarterIndex of availableQuarterIndices) {
      const quarter = (endQuarterIndex % 4) + 1;
      if (quarter !== anchorQuarter) continue;

      let rollingTotal = 0;
      let hasAllFourQuarters = true;

      for (let i = endQuarterIndex - 3; i <= endQuarterIndex; i++) {
        const salesValue = quarterToSales.get(i);
        if (!Number.isFinite(salesValue)) {
          hasAllFourQuarters = false;
          break;
        }
        rollingTotal += salesValue;
      }

      if (!hasAllFourQuarters) {
        continue;
      }

      annualizedSales.push({
        year: String(Math.floor(endQuarterIndex / 4)),
        sales: rollingTotal,
      });
    }

    const trimmedSales =
      Number.isFinite(maxYears) && maxYears > 0
        ? annualizedSales.slice(-maxYears)
        : annualizedSales;

    return {
      sales: trimmedSales,
      periodLabel,
    };
  }

  function aggregateLocalAuthorityQuarterlySales(msoas = []) {
    const quarterToSales = new globalThis.Map();

    for (const msoa of msoas) {
      for (const point of msoa?.timeSeries?.median ?? []) {
        if (!point?.quarter || !Number.isFinite(point.sales)) continue;

        quarterToSales.set(
          point.quarter,
          (quarterToSales.get(point.quarter) ?? 0) + point.sales,
        );
      }
    }

    return Array.from(quarterToSales.entries())
      .sort(([quarterA], [quarterB]) => quarterA.localeCompare(quarterB))
      .map(([quarter, sales]) => ({
        quarter,
        sales,
      }));
  }

  async function loadSalesOverTime(propertyTypeValue, selection) {
    const requestId = ++salesOverTimeRequestId;
    salesOverTimeLoading = true;
    salesOverTimeError = null;

    try {
      const isMsoaSelection = selection?.type === "msoa";
      const laCode = isMsoaSelection ? selection.la_code : selection?.code;
      const laData = await loadLocalAuthorityData(propertyTypeValue, laCode);

      if (requestId !== salesOverTimeRequestId) {
        return;
      }

      let annualSales = [];
      let areaName = selection?.name ?? selection?.code ?? null;
      let rollingPeriodLabel = null;

      if (isMsoaSelection) {
        const msoaData = laData?.msoas?.find((msoa) => msoa.code === selection.code);
        const rollingSales = aggregateRollingAnnualSales(msoaData?.timeSeries?.median ?? []);
        annualSales = rollingSales.sales;
        rollingPeriodLabel = rollingSales.periodLabel;
        areaName = msoaData?.name ?? areaName;
      } else {
        let rollingSales = aggregateRollingAnnualSales(laData?.timeSeries?.median ?? []);
        annualSales = rollingSales.sales;
        rollingPeriodLabel = rollingSales.periodLabel;
        if (annualSales.length === 0) {
          const fallbackQuarterlySales = aggregateLocalAuthorityQuarterlySales(laData?.msoas ?? []);
          rollingSales = aggregateRollingAnnualSales(fallbackQuarterlySales);
          annualSales = rollingSales.sales;
          rollingPeriodLabel = rollingSales.periodLabel;
        }
        areaName = laData?.name ?? areaName;
      }

      if (annualSales.length === 0) {
        salesOverTimeData = [];
        salesOverTimeName = areaName;
        salesOverTimePeriodLabel = null;
        salesOverTimeError = `Property sales data unavailable for this ${getSelectedAreaTypeLabel(
          selection?.type,
        )}`;
        return;
      }

      salesOverTimeData = annualSales;
      salesOverTimeName = areaName;
      salesOverTimePeriodLabel = rollingPeriodLabel;
    } catch (e) {
      if (requestId !== salesOverTimeRequestId) {
        return;
      }
      salesOverTimeData = [];
      salesOverTimeName = selection?.name ?? selection?.code ?? null;
      salesOverTimePeriodLabel = null;
      salesOverTimeError = "Failed to load property sales data";
    } finally {
      if (requestId === salesOverTimeRequestId) {
        salesOverTimeLoading = false;
      }
    }
  }

  function resetBuySectionData() {
    buySectionRequestId += 1;
    buySectionData = null;
    buySectionLoading = false;
    buySectionError = null;
  }

  function resetBeeswarmData() {
    beeswarmRequestId += 1;
    beeswarmSelectionKey = "";
    beeswarmData = null;
    beeswarmLoading = false;
    beeswarmError = null;
    beeswarmLegendDomain = [];
    beeswarmColors = [];
    beeswarmXMin = null;
    beeswarmXMax = null;
  }

  function decorateBeeswarmData(data = [], selectedArea = null, laData = null) {
    const selectedCode = selectedArea?.type === "msoa" ? selectedArea.code : null;
    const decoratedData = data.map((point) => {
      if (point.type === "region") {
        return {
          ...point,
          type: "Region average",
          radius: 5,
        };
      }

      if (point.type === "nation") {
        return {
          ...point,
          type: "National average",
          radius: 5,
        };
      }

      if (selectedCode && point.code === selectedCode) {
        return {
          ...point,
          type: "Selected area",
          radius: 5,
        };
      }

      return {
        ...point,
        type: "Other MSOAs in LA",
        radius: 3,
      };
    });

    if (selectedArea?.type === "la" && laData?.affordability?.median?.ratio) {
      decoratedData.push({
        x: laData.affordability.median.ratio,
        label: `${laData.name} average`,
        code: laData.code,
        type: "Selected area",
        radius: 5,
      });
    }

    return decoratedData;
  }

  function setBeeswarmLegend(data = []) {
    const presentTypes = new Set(data.map((point) => point?.type).filter(Boolean));
    beeswarmLegendDomain = BEESWARM_TYPE_ORDER.filter((type) => presentTypes.has(type));
    beeswarmColors = beeswarmLegendDomain.map((type) => BEESWARM_COLOR_MAP[type]);
  }

  function setBeeswarmXBounds(data = []) {
    const values = data
      .map((point) => Number(point?.x))
      .filter((value) => Number.isFinite(value));

    if (values.length === 0) {
      beeswarmXMin = null;
      beeswarmXMax = null;
      return;
    }

    const min = Math.min(...values);
    const max = Math.max(...values);
    const padding = Math.max((max - min) * 0.1, 0.25);

    beeswarmXMin = Math.max(0, min - padding);
    beeswarmXMax = max + padding;
  }

  async function loadBeeswarmData(propertyTypeValue, selectedArea) {
    const requestId = ++beeswarmRequestId;

    if (!selectedArea) {
      resetBeeswarmData();
      return;
    }

    beeswarmLoading = true;
    beeswarmError = null;

    try {
      let laCode = null;
      let regionCode = null;
      let regionName = null;
      let country = "england";

      if (selectedArea.type === "la") {
        laCode = selectedArea.code;
      } else if (selectedArea.type === "msoa") {
        laCode = selectedMsoaForSnapshot?.la_code;
      }

      if (!laCode) {
        if (requestId !== beeswarmRequestId) {
          return;
        }
        beeswarmError = "Could not determine Local Authority";
        beeswarmData = [];
        beeswarmLegendDomain = [];
        beeswarmColors = [];
        beeswarmXMin = null;
        beeswarmXMax = null;
        return;
      }

      const laData = await loadLocalAuthorityData(propertyTypeValue, laCode);
      if (requestId !== beeswarmRequestId) {
        return;
      }

      if (!laData) {
        beeswarmError = "Failed to load Local Authority data";
        beeswarmData = [];
        beeswarmLegendDomain = [];
        beeswarmColors = [];
        beeswarmXMin = null;
        beeswarmXMax = null;
        return;
      }

      regionCode = laData.region_code;
      regionName = laData.region_name;
      country = laData.code?.startsWith("W") ? "wales" : "england";

      const msoas = laData.msoas || [];

      const [regionAffordability, nationalAffordability] = await Promise.all([
        loadRegionalAffordability(propertyTypeValue, regionCode, regionName),
        loadNationalAffordability(propertyTypeValue, country),
      ]);

      if (requestId !== beeswarmRequestId) {
        return;
      }

      beeswarmData = decorateBeeswarmData(
        transformMsoaDataForBeeswarm(msoas, regionAffordability, nationalAffordability),
        selectedArea,
        laData,
      );
      setBeeswarmLegend(beeswarmData);
      setBeeswarmXBounds(beeswarmData);
    } catch (e) {
      if (requestId !== beeswarmRequestId) {
        return;
      }
      console.error("Error loading beeswarm data:", e);
      beeswarmError = "Failed to load beeswarm data";
      beeswarmData = [];
      beeswarmLegendDomain = [];
      beeswarmColors = [];
      beeswarmXMin = null;
      beeswarmXMax = null;
    } finally {
      if (requestId === beeswarmRequestId) {
        beeswarmLoading = false;
      }
    }
  }

  function parseQuarterToDate(quarterValue) {
    const match = String(quarterValue ?? "").match(/^(\d{4})-Q([1-4])$/);
    if (!match) return null;

    const year = Number(match[1]);
    const quarter = Number(match[2]);
    const month = (quarter - 1) * 3;
    return new Date(Date.UTC(year, month, 1));
  }

  function formatCurrency(value) {
    if (!Number.isFinite(value)) return "—";
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: "GBP",
      maximumFractionDigits: 0,
    }).format(value);
  }

  function calculateTaxFromBands(price, bands) {
    if (!Number.isFinite(price) || price <= 0) return 0;

    let tax = 0;
    let lowerBound = 0;

    for (const { upTo, rate } of bands) {
      const upperBound = Number.isFinite(upTo) ? upTo : price;
      const taxableAmount = Math.max(0, Math.min(price, upperBound) - lowerBound);
      tax += taxableAmount * rate;

      if (price <= upperBound) {
        break;
      }

      lowerBound = upperBound;
    }

    return tax;
  }

  function calculateEnglandStampDuty(price, isFirstTimeBuyerValue) {
    const firstTimeBuyerReliefApplied = isFirstTimeBuyerValue && price <= 625000;
    const bands = firstTimeBuyerReliefApplied
      ? ENGLAND_FIRST_TIME_BUYER_BANDS
      : ENGLAND_STAMP_DUTY_BANDS;

    return {
      amount: calculateTaxFromBands(price, bands),
      firstTimeBuyerReliefApplied,
    };
  }

  function calculateTotalSavingsNeeded(propertyPrice, country, isFirstTimeBuyerValue) {
    if (!Number.isFinite(propertyPrice) || propertyPrice <= 0) {
      return null;
    }

    const deposit = propertyPrice * DEPOSIT_RATE;

    if (country === "wales") {
      const transactionTax = calculateTaxFromBands(propertyPrice, WALES_LTT_BANDS);

      return {
        deposit,
        transactionTax,
        transactionTaxLabel: "Land Transaction Tax",
        firstTimeBuyerReliefApplied: false,
        total: deposit + transactionTax,
      };
    }

    const stampDuty = calculateEnglandStampDuty(propertyPrice, isFirstTimeBuyerValue);

    return {
      deposit,
      transactionTax: stampDuty.amount,
      transactionTaxLabel: "Stamp Duty",
      firstTimeBuyerReliefApplied: stampDuty.firstTimeBuyerReliefApplied,
      total: deposit + stampDuty.amount,
    };
  }

  function getPriceLevelLabel(level) {
    return level === "lq" ? "Lower quartile" : "Median";
  }

  async function loadBuySectionData(propertyTypeValue, priceLevelValue, selection) {
    const requestId = ++buySectionRequestId;
    buySectionLoading = true;
    buySectionError = null;

    try {
      const isMsoaSelection = selection?.type === "msoa";
      const laCode = isMsoaSelection ? selection.la_code : selection?.code;
      const laData = await loadLocalAuthorityData(propertyTypeValue, laCode);

      if (requestId !== buySectionRequestId) {
        return;
      }

      const msoaData = isMsoaSelection
        ? laData?.msoas?.find((msoa) => msoa.code === selection.code)
        : null;
      const priceSeriesRaw = isMsoaSelection
        ? msoaData?.timeSeries?.[priceLevelValue] ?? []
        : laData?.timeSeries?.[priceLevelValue] ?? [];

      const priceSeries = priceSeriesRaw
        .map((point) => {
          const date = parseQuarterToDate(point?.quarter);
          if (!date || !Number.isFinite(point?.price)) return null;
          return {
            date,
            price: point.price,
          };
        })
        .filter(Boolean);

      const affordabilityPrice = isMsoaSelection
        ? msoaData?.affordability?.[priceLevelValue]?.price
        : laData?.affordability?.[priceLevelValue]?.price;
      const latestSeriesPrice = priceSeries.length
        ? priceSeries[priceSeries.length - 1].price
        : null;
      const selectedPrice = Number.isFinite(affordabilityPrice)
        ? affordabilityPrice
        : latestSeriesPrice;

      if (!Number.isFinite(selectedPrice)) {
        buySectionData = null;
        buySectionError = `Property price data unavailable for this ${getSelectedAreaTypeLabel(
          selection?.type,
        )}`;
        return;
      }

      buySectionData = {
        areaName: isMsoaSelection
          ? msoaData?.name ?? selection.name ?? selection.code
          : laData?.name ?? selection?.name ?? selection?.code,
        areaTypeLabel: isMsoaSelection ? "MSOA" : "LA",
        priceLevelLabel: getPriceLevelLabel(priceLevelValue),
        country: getCountryFromRegionCode(laData?.region_code ?? selection?.region_code),
        propertyPrice: selectedPrice,
        incomeRequired: selectedPrice / INCOME_MULTIPLIER,
        priceSeries,
      };
    } catch (e) {
      if (requestId !== buySectionRequestId) {
        return;
      }
      buySectionData = null;
      buySectionError = "Failed to load buy-cost data";
    } finally {
      if (requestId === buySectionRequestId) {
        buySectionLoading = false;
      }
    }
  }

  function formatRatio(value) {
    return Number.isFinite(value) ? value.toFixed(2) : "—";
  }

  function showSnapshotFlag(value) {
    return Number.isFinite(value) && value > snapshotFlagThreshold;
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

  function clearSelectedMsoaFeatureState() {
    if (!selected || !map) {
      return;
    }

    try {
      map.setFeatureState(
        { source: "msoa-source", sourceLayer: "msoa", id: selected },
        { selected: false },
      );
    } catch (e) {
      // Feature may not be loaded at current zoom.
    }
  }

  function resolveLocalAuthorityBoundary(selectionValue) {
    const candidates = [];

    if (typeof selectionValue === "string") {
      candidates.push(selectionValue);
    } else if (selectionValue && typeof selectionValue === "object") {
      if (selectionValue.id) candidates.push(selectionValue.id);
      if (selectionValue.label) candidates.push(selectionValue.label);
    }

    for (const candidate of candidates) {
      const normalizedCandidate = String(candidate).trim();
      if (!normalizedCandidate) continue;

      const boundaryById = getBoundaryById(normalizedCandidate);
      if (boundaryById) {
        return boundaryById;
      }

      const boundaryByName = getBoundaryByName(normalizedCandidate);
      if (boundaryByName) {
        return boundaryByName;
      }
    }

    return null;
  }

  function selectMsoa(msoaCode, msoaData, options = {}) {
    if (!msoaCode || !msoaData) {
      return;
    }

    const { zoomToParentLA = true, flyToPoint = null } = options;

    clearSelectedMsoaFeatureState();

    if (selectedLACode) {
      clearLAHighlight(selectedLACode);
    }

    selectedAreaType = "msoa";
    selectedLAForSnapshot = null;
    selected = msoaCode;
    selectedFeatureId = msoaCode;

    if (map) {
      try {
        map.setFeatureState(
          { source: "msoa-source", sourceLayer: "msoa", id: msoaCode },
          { selected: true },
        );
      } catch (e) {
        console.error("Could not set MSOA feature state:", e.message);
      }
    }

    selectedValue = {
      id: msoaCode,
      label: `${msoaData.name} (${msoaData.la_name})`,
      type: "msoa",
      msoaCode,
      laCode: msoaData.la_code,
    };

    selectedBoundary = {
      id: msoaCode,
      name: msoaData.name,
      type: "msoa",
      bounds: [[-3.5, 54], [-3.5, 54]],
    };

    if (msoaData.la_code) {
      highlightLA(msoaData.la_code);
      if (zoomToParentLA) {
        zoomToLocalAuthority(msoaData.la_code);
      }
    }

    if (flyToPoint && map) {
      map.flyTo({
        center: flyToPoint,
        zoom: 7,
        duration: 1000,
      });
    }

    closeSearchMenu();
  }

  function handleSelectChange(value) {
    if (!value) return;

    const selectedOption =
      typeof value === "string"
        ? { type: "ltla", id: value, label: value }
        : value;
    const { type, id, msoaCode } = selectedOption;
    const resolvedMsoaCode = msoaCode ?? (type === "msoa" ? id : null);

    if (type === "postcode") {
      selectAreaByPostcode(id);
      return;
    }

    if (type === "msoa" && resolvedMsoaCode && affordabilityData?.[resolvedMsoaCode]) {
      selectMsoa(resolvedMsoaCode, affordabilityData[resolvedMsoaCode], { zoomToParentLA: true });
      return;
    }

    const boundary = resolveLocalAuthorityBoundary(selectedOption);
    if (type === "ltla" || type === "area" || boundary) {
      if (boundary) {
        selectBoundary(boundary);
      }
      return;
    }

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
    if (!boundary) return;

    clearSelectedMsoaFeatureState();
    selected = null;
    selectedAreaType = "la";
    selectedLAForSnapshot = {
      code: boundary.id,
      name: boundary.name,
      region_code: boundary?.properties?.rgncd ?? null,
      region_name: boundary?.properties?.rgnnm ?? null,
    };
    selectedBoundary = { ...boundary, type: "la" };
    selectedFeatureId = boundary.id;

    // Populate search box with selected area
    selectedValue = {
      id: boundary.id,
      label: boundary.name,
      type: "ltla",
    };

    // Close search menu
    closeSearchMenu();

    // Highlight selected LA
    highlightLA(boundary.id);

    if (map && boundary?.bounds?.[0] && boundary?.bounds?.[1]) {
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

      // Try to find MSOA from vector tiles using map querySourceFeatures
      let msoaCode = null;
      if (map) {
        try {
          const features = map.querySourceFeatures("msoa-source", {
            sourceLayer: "msoa",
          });
          
          // Find the feature containing this point
          for (const feature of features) {
            if (feature.geometry && feature.geometry.type === "Polygon") {
              // Check if point is in polygon (simple bounding box check first)
              const bounds = feature.geometry.coordinates[0];
              let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
              
              bounds.forEach(coord => {
                minX = Math.min(minX, coord[0]);
                maxX = Math.max(maxX, coord[0]);
                minY = Math.min(minY, coord[1]);
                maxY = Math.max(maxY, coord[1]);
              });
              
              if (lon >= minX && lon <= maxX && lat >= minY && lat <= maxY) {
                msoaCode = feature.id || feature.properties?.areacd;
                if (msoaCode) break;
              }
            }
          }
        } catch (e) {
          console.error("Could not query MSOA from vector tiles:", e.message);
        }
      }

      // If we found an MSOA, select it
      if (msoaCode && affordabilityData && affordabilityData[msoaCode]) {
        selectMsoa(msoaCode, affordabilityData[msoaCode], {
          zoomToParentLA: false,
          flyToPoint: [lon, lat],
        });
      } else {
        // Fallback: find the LTLA boundary containing this postcode
        const ltla = findBoundaryAtPoint(lon, lat, "ltla");
        if (ltla) {
          selectBoundary(ltla);
        } else {
          error = "Area not found for this postcode";
        }
      }
    } catch (e) {
      error = "Area unavailable";
      console.error("Postcode error:", e);
    }
  }

  function clearSelection() {
    clearSelectedMsoaFeatureState();
    selectedBoundary = null;
    selectedFeatureId = null;
    selected = null;
    selectedAreaType = null;
    selectedLAForSnapshot = null;
    selectedValue = null;
    legendHoveredRange = null;
    legendSelectedRange = null;
    error = null;

    // Clear LA highlight if one was set
    if (selectedLACode) {
      clearLAHighlight(selectedLACode);
      selectedLACode = null;
    }

    if (clearInput) {
      clearInput();
    }

    clearLegendRangeHighlight();

    // Reset map back to the default England and Wales framing.
    if (map) {
      map.stop?.();
      map.flyTo({
        center: [defaultMapView.lng, defaultMapView.lat],
        zoom: defaultMapView.zoom,
        duration: 1000,
      });
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
    <div class="map-beeswarm-container">
      <div class="map-grid">
        <Grid width="full">
          <div class="map-column">
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
                location={defaultMapView}
                bind:map
                bind:zoom
                bind:center
                minzoom={6}
                maxzoom={13}
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
                    order={CITY_LABEL_LAYER_ID}
                    hover={true}
                    bind:hovered
                    select={true}
                    bind:selected
                    on:select={({ detail }) => {
                      const msoaCode = String(detail?.id ?? "");
                      if (msoaCode && affordabilityData && affordabilityData[msoaCode]) {
                        selectMsoa(msoaCode, affordabilityData[msoaCode], {
                          zoomToParentLA: true,
                        });
                      }
                    }}
                    paint={{
                      "fill-color": [
                        "case",
                        ["!=", ["feature-state", "color"], null],
                        ["feature-state", "color"],
                        "#ccc",
                      ],
                      "fill-opacity": 1,
                    }}
                  />
                  <MapLayer
                    id="msoa-outline-base"
                    type="line"
                    order={CITY_LABEL_LAYER_ID}
                    paint={{
                      "line-color": ONS_GREY_75,
                      "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.2, 11, 1],
                      "line-opacity": [
                        "case",
                        ["==", ["feature-state", "legendActive"], true],
                        [
                          "case",
                          ["==", ["feature-state", "legendMatch"], true],
                          1,
                          0.2,
                        ],
                        1,
                      ],
                    }}
                  />
                  <MapLayer
                    id="msoa-legend-match"
                    type="line"
                    order={CITY_LABEL_LAYER_ID}
                    paint={{
                      "line-color": ONS_GREY_100,
                      "line-width": 1.5,
                      "line-opacity": [
                        "case",
                        ["==", ["feature-state", "legendMatch"], true],
                        1,
                        0,
                      ],
                    }}
                  />
                  <MapLayer
                    id="msoa-hover-white"
                    type="line"
                    order={CITY_LABEL_LAYER_ID}
                    paint={{
                      "line-color": "#ffffff",
                      "line-width": 3,
                      "line-opacity": [
                        "case",
                        ["==", ["feature-state", "hovered"], true],
                        0.8,
                        0,
                      ],
                    }}
                  />
                  <MapLayer
                    id="msoa-hover-outline"
                    type="line"
                    order={CITY_LABEL_LAYER_ID}
                    paint={{
                      "line-color": ONS_GREY_100,
                      "line-width": 2,
                      "line-opacity": [
                        "case",
                        ["==", ["feature-state", "hovered"], true],
                        1,
                        0,
                      ],
                    }}
                  />
                  <MapLayer
                    id="msoa-selected-white"
                    type="line"
                    order={CITY_LABEL_LAYER_ID}
                    paint={{
                      "line-color": "#ffffff",
                      "line-width": 5,
                      "line-opacity": [
                        "case",
                        ["==", ["feature-state", "selected"], true],
                        0.8,
                        0,
                      ],
                    }}
                  />
                  <MapLayer
                    id="msoa-selected-outline"
                    type="line"
                    order={CITY_LABEL_LAYER_ID}
                    paint={{
                      "line-color": ONS_GREY_100,
                      "line-width": 3,
                      "line-opacity": [
                        "case",
                        ["==", ["feature-state", "selected"], true],
                        1,
                        0,
                      ],
                    }}
                  />
                </MapSource>
              </Map>
            {/if}
          </div>

        {#if selectedBoundary}
          <div class="selection-info">
            <p>
              <strong>Selected:</strong>
              {selectedBoundary.name}
              ({selectedBoundary.type})
              {#if selectedMsoaForSnapshot?.la_name}
                | <strong>Parent LA:</strong> {selectedMsoaForSnapshot.la_name}
              {/if}
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
              <ColorLegend
                bounds={colorBounds}
                selectedRangeIndex={legendSelectedRange ? legendSelectedRange.index : null}
                hoverValue={legendHoverIndicatorValue}
                selectedValue={legendSelectedIndicatorValue}
                on:rangehover={handleLegendRangeHover}
                on:rangeleave={handleLegendRangeLeave}
                on:rangeselect={handleLegendRangeSelect}
              />
            </div>
          {/if}
        </div>
          </div>
        </Grid>
      </div>

      {#if selectedBoundary}
        <div class="beeswarm-card">
          <Card title="MSOA Distribution">
            {#if beeswarmLoading}
              <p class="snapshot-status">Loading beeswarm data...</p>
            {:else if beeswarmError}
              <p class="snapshot-status snapshot-status--error">{beeswarmError}</p>
            {:else if beeswarmData && beeswarmData.length > 0}
              <div class="beeswarm-chart">
                <ScatterChart
                  data={beeswarmData}
                  xKey="x"
                  yKey={null}
                  zKey="type"
                  zDomain={beeswarmLegendDomain}
                  xMin={beeswarmXMin}
                  xMax={beeswarmXMax}
                  xAxisLabel="Affordability Ratio"
                  yAxis={false}
                  yFitBeeswarm={true}
                  legend={true}
                  rKey="radius"
                  buffer={2}
                  height={180}
                  padding={{ top: 8, right: 8, bottom: 50, left: 20 }}
                  colors={beeswarmColors}
                />
              </div>
            {:else}
              <p class="snapshot-status">No beeswarm data available.</p>
            {/if}
          </Card>
        </div>
      {/if}
    </div>
  </Container>
</Section>

<Section title="Affordability snapshot">
  <Grid width="full">
    <Card title="House price to earnings ratio">
      {#if snapshotLoading}
        <p class="snapshot-status">Loading affordability ratios...</p>
      {:else if snapshotError}
        <p class="snapshot-status snapshot-status--error">{snapshotError}</p>
      {:else if snapshotRatios}
        <p class="snapshot-area-name">
          {snapshotRatios.areaName} ({snapshotRatios.areaTypeLabel})
        </p>
        <div class="snapshot-ratios">
          <div class="snapshot-ratio">
            <p class="snapshot-ratio__label">
              {propertyTypeLabels[propertyType] ?? "Selected property type"} median price /
              median earnings
            </p>
            <p class="snapshot-ratio__value">
              {formatRatio(snapshotRatios.medianRatio)}
            </p>
            {#if showSnapshotFlag(snapshotRatios.medianRatio)}
              <p class="snapshot-ratio__flag">
                <span class="snapshot-ratio__flag-icon" aria-hidden="true"></span>
                Over {snapshotFlagThreshold}
              </p>
            {/if}
          </div>

          <div class="snapshot-ratio">
            <p class="snapshot-ratio__label">
              {propertyTypeLabels[propertyType] ?? "Selected property type"} lower quartile
              price / lower quartile earnings
            </p>
            <p class="snapshot-ratio__value">
              {formatRatio(snapshotRatios.lowerQuartileRatio)}
            </p>
            {#if showSnapshotFlag(snapshotRatios.lowerQuartileRatio)}
              <p class="snapshot-ratio__flag">
                <span class="snapshot-ratio__flag-icon" aria-hidden="true"></span>
                Over {snapshotFlagThreshold}
              </p>
            {/if}
          </div>
        </div>
      {:else}
        <p class="snapshot-status">
          Select an MSOA or local authority on the map to view affordability ratios.
        </p>
      {/if}
    </Card>
    <Card title="Comparisons">
      {#if comparisonLoading}
        <p class="snapshot-status">Loading comparison ratios...</p>
      {:else if comparisonError}
        <p class="snapshot-status snapshot-status--error">{comparisonError}</p>
      {:else if comparisonRatios}
        <div class="comparison-values">
          {#if comparisonRatios.selectionType === "msoa"}
            <div class="comparison-value">
              <p class="comparison-value__label">MSOA</p>
              <p class="comparison-value__number">
                {formatRatio(comparisonRatios.msoaMedianRatio)}
              </p>
            </div>
          {/if}
          <div class="comparison-value">
            <p class="comparison-value__label">{comparisonRatios.laName} (LA)</p>
            <p class="comparison-value__number">
              {formatRatio(comparisonRatios.laMedianRatio)}
            </p>
          </div>
          {#if comparisonRatios.showRegionComparison}
            <div class="comparison-value">
              <p class="comparison-value__label">{comparisonRatios.regionName} (Region)</p>
              <p class="comparison-value__number">
                {formatRatio(comparisonRatios.regionMedianRatio)}
              </p>
            </div>
          {/if}
          <div class="comparison-value">
            <p class="comparison-value__label">{comparisonRatios.countryName}</p>
            <p class="comparison-value__number">
              {formatRatio(comparisonRatios.countryMedianRatio)}
            </p>
          </div>
        </div>
      {:else}
        <p class="snapshot-status">
          Select an MSOA or local authority on the map to view comparison ratios.
        </p>
      {/if}
    </Card>
    <Card title="Property sales over time">
      {#if salesOverTimeLoading}
        <p class="snapshot-status">Loading property sales...</p>
      {:else if salesOverTimeError}
        <p class="snapshot-status snapshot-status--error">{salesOverTimeError}</p>
      {:else if salesOverTimeData.length > 0}
        <p class="snapshot-area-name">{salesOverTimeName}</p>
        {#if salesOverTimePeriodLabel}
          <p class="snapshot-status">
            Rolling 4-quarter total (year ending {salesOverTimePeriodLabel})
          </p>
        {/if}
        <div class="sales-over-time-chart">
          <ColumnChart
            data={salesOverTimeData}
            xKey="year"
            yKey="sales"
            yAxisLabel="Sales"
            xAxisLabel={salesOverTimePeriodLabel ? `Year ending ${salesOverTimePeriodLabel}` : "Year"}
            height={260}
            yTicks={5}
            padding={{ top: 0, right: 8, bottom: 28, left: 42 }}
          />
        </div>
      {:else}
        <p class="snapshot-status">
          Select an MSOA or local authority on the map to view property sales over time.
        </p>
      {/if}
    </Card>
  </Grid>
</Section>

<Section title="What would I need to buy?">
  <Grid width="full">
    <Card title="Property cost">
      {#if buySectionLoading}
        <p class="snapshot-status">Loading property costs...</p>
      {:else if buySectionError}
        <p class="snapshot-status snapshot-status--error">{buySectionError}</p>
      {:else if buySectionData}
        <p class="snapshot-area-name">
          {buySectionData.areaName} ({buySectionData.areaTypeLabel})
        </p>
        <p class="buy-metric-label">{buySectionData.priceLevelLabel} price</p>
        <p class="buy-metric-value">{formatCurrency(buySectionData.propertyPrice)}</p>
        {#if buySectionData.priceSeries.length > 0}
          <div class="buy-price-chart">
            <LineChart
              data={buySectionData.priceSeries}
              xKey="date"
              yKey="price"
              xScale="time"
              xFormatTickString="%Y"
              xTicks={5}
              yTicks={5}
              yPrefix="£"
              yAxisLabel="Price"
              xAxisLabel="Year"
              height={250}
              padding={{ top: 0, right: 8, bottom: 28, left: 50 }}
            />
          </div>
        {/if}
      {:else}
        <p class="snapshot-status">
          Select an MSOA or local authority on the map to view property costs.
        </p>
      {/if}
    </Card>
    <Card title="Income required">
      {#if buySectionLoading}
        <p class="snapshot-status">Loading income requirement...</p>
      {:else if buySectionError}
        <p class="snapshot-status snapshot-status--error">{buySectionError}</p>
      {:else if buySectionData}
        <p class="snapshot-area-name">
          {buySectionData.areaName} ({buySectionData.areaTypeLabel})
        </p>
        <p class="buy-metric-label">
          {buySectionData.priceLevelLabel} price divided by {INCOME_MULTIPLIER}
        </p>
        <p class="buy-metric-value">{formatCurrency(buySectionData.incomeRequired)}</p>
      {:else}
        <p class="snapshot-status">
          Select an MSOA or local authority on the map to view income required.
        </p>
      {/if}
    </Card>
    <Card title="Total savings needed">
      {#if buySectionLoading}
        <p class="snapshot-status">Loading total savings...</p>
      {:else if buySectionError}
        <p class="snapshot-status snapshot-status--error">{buySectionError}</p>
      {:else if buySectionData && totalSavingsData}
        <p class="snapshot-area-name">
          {buySectionData.areaName} ({buySectionData.areaTypeLabel})
        </p>
        <div class="buy-checkbox">
          <Checkbox
            id="first-time-buyer-checkbox"
            label="I'm a first-time buyer"
            bind:checked={isFirstTimeBuyer}
            compact
          />
        </div>
        <p class="buy-metric-label">10% deposit + {totalSavingsData.transactionTaxLabel}</p>
        <p class="buy-metric-value">{formatCurrency(totalSavingsData.total)}</p>
        <div class="savings-breakdown">
          <p class="savings-breakdown__row">
            <span>10% deposit</span>
            <strong>{formatCurrency(totalSavingsData.deposit)}</strong>
          </p>
          <p class="savings-breakdown__row">
            <span>{totalSavingsData.transactionTaxLabel}</span>
            <strong>{formatCurrency(totalSavingsData.transactionTax)}</strong>
          </p>
        </div>
        {#if isFirstTimeBuyer && buySectionData.country === "wales"}
          <p class="snapshot-status">First-time buyer relief is not available in Wales.</p>
        {:else if isFirstTimeBuyer &&
          buySectionData.country === "england" &&
          !totalSavingsData.firstTimeBuyerReliefApplied}
          <p class="snapshot-status">First-time buyer relief is not applied above £625,000.</p>
        {/if}
      {:else}
        <p class="snapshot-status">
          Select an MSOA or local authority on the map to view total savings needed.
        </p>
      {/if}
    </Card>
  </Grid>
</Section>

<style>
  .map-beeswarm-container {
    display: flex;
    flex-direction: column;
    gap: 16px;
    width: 100%;
  }

  .map-grid {
    width: 100%;
  }

  .map-column {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }

  .beeswarm-card {
    width: 100%;
    min-width: 0;
    overflow: hidden;
  }

  .beeswarm-chart {
    width: 100%;
    max-width: 100%;
    display: block;
    min-width: 0;
  }

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

  .snapshot-status {
    margin: 0;
    font-size: 13px;
    color: #374151;
  }

  .snapshot-status--error {
    color: #7f1d1d;
  }

  .snapshot-area-name {
    margin: 0 0 12px;
    font-size: 13px;
    color: #374151;
    font-weight: 600;
  }

  .snapshot-ratios {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .snapshot-ratio {
    padding: 10px;
    border: 1px solid #ddd;
    border-radius: 4px;
  }

  .snapshot-ratio__label {
    margin: 0;
    min-height: 34px;
    font-size: 12px;
    color: #4b5563;
  }

  .snapshot-ratio__value {
    margin: 8px 0 0;
    font-size: 30px;
    font-weight: 700;
    line-height: 1;
    color: #222;
  }

  .snapshot-ratio__flag {
    margin: 8px 0 0;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 600;
    color: #b42318;
  }

  .snapshot-ratio__flag-icon {
    position: relative;
    display: inline-block;
    width: 10px;
    height: 10px;
    border-left: 2px solid #6b7280;
  }

  .snapshot-ratio__flag-icon::after {
    content: "";
    position: absolute;
    top: 0;
    left: 2px;
    width: 8px;
    height: 6px;
    background-color: #e92730;
    border-radius: 1px;
  }

  .comparison-values {
    display: grid;
    gap: 8px;
  }

  .comparison-value {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: baseline;
    padding: 8px 0;
    border-bottom: 1px solid #e5e7eb;
  }

  .comparison-value:last-child {
    border-bottom: 0;
  }

  .comparison-value__label {
    margin: 0;
    font-size: 12px;
    color: #4b5563;
  }

  .comparison-value__number {
    margin: 0;
    font-size: 20px;
    font-weight: 700;
    line-height: 1;
    color: #222;
  }

  .sales-over-time-chart {
    margin-top: 4px;
  }

  .buy-metric-label {
    margin: 0;
    font-size: 12px;
    color: #4b5563;
  }

  .buy-metric-value {
    margin: 8px 0 0;
    font-size: 34px;
    font-weight: 700;
    line-height: 1.1;
    color: #222;
  }

  .buy-price-chart {
    margin-top: 12px;
  }

  .buy-checkbox {
    margin: 8px 0 12px;
  }

  .savings-breakdown {
    margin-top: 12px;
    padding-top: 8px;
    border-top: 1px solid #e5e7eb;
    display: grid;
    gap: 8px;
  }

  .savings-breakdown__row {
    margin: 0;
    display: flex;
    justify-content: space-between;
    gap: 12px;
    font-size: 12px;
    color: #4b5563;
  }

  .savings-breakdown__row strong {
    color: #222;
    font-weight: 700;
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
    flex: 1;
    min-width: 260px;
    max-width: 420px;
  }

  .status-loading {
    color: #0078d4;
    font-weight: 500;
  }

  .map-wrapper :global(.mapboxgl-canvas) {
    cursor: pointer;
  }

  @media (max-width: 768px) {
    .snapshot-ratios {
      grid-template-columns: 1fr;
    }

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
