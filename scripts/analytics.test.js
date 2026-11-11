import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { parse } from "svelte/compiler";

const pageSource = readFileSync(
  new URL("../src/routes/+page.svelte", import.meta.url),
  "utf8",
);
const markersSource = readFileSync(
  new URL("../src/lib/components/BeeswarmMarkers.svelte", import.meta.url),
  "utf8",
);

function functionsFrom(source, names) {
  return parse(source).instance.content.body
    .filter((node) =>
      node.type === "FunctionDeclaration" && names.includes(node.id.name),
    )
    .map((node) => source.slice(node.start, node.end))
    .join("\n");
}

function createTrackingContext(overrides = {}) {
  const events = [];
  const context = {
    selectedBoundary: { id: "E02000001", name: "Neighbourhood", type: "msoa" },
    analyticsEvent: (event) => events.push(event),
    ...overrides,
  };
  runInNewContext(functionsFrom(pageSource, [
    "trackInteraction",
    "handleDataDownload",
    "trackAreaSelection",
    "handleFilterChange",
    "handleBeeswarmSelect",
    "handleSelectChange",
    "selectAreaByPostcode",
    "clearSelection",
  ]), context);
  return { context, events };
}

test("the page content is a sibling of the slotless analytics banner", () => {
  const template = parse(pageSource).html.children;
  const banner = template.find(
    (node) => node.type === "InlineComponent" && node.name === "AnalyticsBanner",
  );
  assert.ok(banner);
  assert.equal(banner.children.length, 0);
  assert.ok(template.some(
    (node) => node.type === "Element" && node.name === "div" &&
      node.attributes.some((attribute) =>
        attribute.name === "class" &&
        attribute.value?.some((value) => value.data === "page-container"),
      ),
  ));
});

test("interaction payloads use the GTM schema and clear stale area metadata", () => {
  const { context, events } = createTrackingContext();
  context.trackAreaSelection("map");
  assert.deepEqual(JSON.parse(JSON.stringify(events[0])), {
    event: "interaction",
    interactionType: "map",
    interactionValue: "E02000001",
    interactionLabel: "Select area",
    areaName: "Neighbourhood",
    areaCode: "E02000001",
    areaType: "msoa",
  });
  context.selectedBoundary = null;
  context.trackInteraction("accordion", "open", "Property and price filters");
  assert.equal(events[1].areaCode, null);
  assert.equal(events[1].areaName, null);
  assert.equal(events[1].areaType, null);
});

test("data download clicks send one GTM fileDownload event with the deployed CSV URL", () => {
  for (const base of ["", "/visualisations/affordability-explorer"]) {
    const { context, events } = createTrackingContext({
      base,
      URL,
      window: { location: { href: `https://www.ons.gov.uk${base}/` } },
    });
    assert.equal(events.length, 0);
    context.handleDataDownload();
    assert.equal(events.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(events[0])), {
      event: "fileDownload",
      fileExtension: "csv",
      filename: "datadownload.csv",
      linkText: "Download all data",
      linkUrl: `https://www.ons.gov.uk${base}/data/datadownload.csv`,
      linkDomain: "www.ons.gov.uk",
    });
  }
});

test("filter listeners only track explicit property and price changes", () => {
  const { context, events } = createTrackingContext();
  assert.equal(events.length, 0);
  context.handleFilterChange({ target: { name: "property-type", value: "flats" } });
  context.handleFilterChange({ target: { name: "price-level", value: "lq" } });
  context.handleFilterChange({ target: { name: "unrelated", value: "ignored" } });
  assert.equal(events.length, 2);
  assert.equal(events[0].interactionType, "radio");
  assert.equal(events[0].interactionValue, "flats");
  assert.equal(events[0].interactionLabel, "Property type");
  assert.equal(events[1].interactionValue, "lq");
  assert.equal(events[1].interactionLabel, "Price level");
});

test("search emits once for resolved areas and nothing for empty or unresolved selections", () => {
  const { context, events } = createTrackingContext({
    affordabilityData: { E02000001: { name: "Neighbourhood" } },
    selectMsoa: () => {},
    selectBoundary: (boundary) => { context.selectedBoundary = boundary; },
    resolveLocalAuthorityBoundary: (option) => option.id === "authority"
      ? { id: "E09000001", name: "Authority", type: "la" }
      : null,
    closeSearchMenu: () => {},
  });
  context.handleSelectChange(null);
  context.handleSelectChange({ type: "msoa", id: "missing" });
  assert.equal(events.length, 0);
  context.handleSelectChange({ type: "msoa", id: "E02000001" });
  context.handleSelectChange({ type: "ltla", id: "authority" });
  assert.equal(events.length, 2);
  assert.ok(events.every((event) => event.interactionType === "search"));
  assert.equal(events[1].areaType, "local-authority");
});

test("postcode lookup tracks one resolved area without the raw postcode", async () => {
  for (const useMsoa of [true, false]) {
    const { context, events } = createTrackingContext({
      map: useMsoa ? {
        getZoom: () => 9,
        once: (event, resolve) => resolve(),
        flyTo: () => {},
        querySourceFeatures: () => [{ id: "E02000001", geometry: {} }],
      } : null,
      fetch: async () => ({
        ok: true,
        json: async () => ({ result: { longitude: 0, latitude: 51 } }),
      }),
      booleanPointInPolygon: () => true,
      affordabilityData: { E02000001: {} },
      selectMsoa: () => {},
      findBoundaryAtPoint: () => ({ id: "E09000001", name: "Authority", type: "la" }),
      selectBoundary: (boundary) => { context.selectedBoundary = boundary; },
    });
    await context.selectAreaByPostcode("SW1A 1AA");
    assert.equal(events.length, 1);
    assert.equal(events[0].interactionType, "postcode-search");
    assert.equal(events[0].areaType, useMsoa ? "msoa" : "local-authority");
    assert.ok(!JSON.stringify(events).includes("SW1A"));
    context.fetch = async () => ({ ok: false });
    await context.selectAreaByPostcode("invalid");
    assert.equal(events.length, 1);
  }
});

test("clear selection records the previous area once before resetting state", () => {
  const { context, events } = createTrackingContext({
    clearSelectedMsoaFeatureState: () => {},
    selectedLACode: null,
    clearInput: () => {},
  });
  context.clearSelection();
  assert.equal(events.length, 1);
  assert.equal(events[0].areaCode, "E02000001");
  assert.equal(events[0].interactionValue, "clear");
  assert.equal(context.selectedBoundary, null);
  context.clearSelection();
  assert.equal(events.length, 1);
});

test("beeswarm tracking emits once after selecting a valid neighbourhood", () => {
  const selections = [];
  const { context, events } = createTrackingContext({
    affordabilityData: { E02000002: { name: "New neighbourhood" } },
    selectMsoa: (code, data) => {
      assert.equal(events.length, 0);
      selections.push(code);
      context.selectedBoundary = { id: code, name: data.name, type: "msoa" };
    },
  });
  context.handleBeeswarmSelect({ code: "E02000002" });
  assert.deepEqual(selections, ["E02000002"]);
  assert.equal(events.length, 1);
  assert.equal(events[0].interactionType, "beeswarm");
  assert.equal(events[0].interactionLabel, "Select area");
  assert.equal(events[0].areaType, "msoa");
  assert.equal(events[0].areaCode, "E02000002");
  assert.equal(events[0].areaName, "New neighbourhood");
  context.handleBeeswarmSelect({ code: "unavailable" });
  assert.equal(events.length, 1);
  assert.equal(selections.length, 1);
});

test("beeswarm clicks dispatch only selection and ignore empty space", () => {
  const selectSource = functionsFrom(markersSource, ["selectHoveredPoint"]);
  const dispatched = [];
  const context = {
    hoveredPoint: { code: "E02000002" },
    dispatch: (name, detail) => dispatched.push({ name, detail }),
  };
  runInNewContext(`${selectSource}\nselectHoveredPoint();`, context);
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].name, "select");
  assert.equal(dispatched[0].detail.code, "E02000002");
  context.hoveredPoint = null;
  runInNewContext("selectHoveredPoint();", context);
  assert.equal(dispatched.length, 1);
});