import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "svelte/compiler";
import {
  createExpression,
  validateStyleMin,
} from "@maplibre/maplibre-gl-style-spec";

const style = JSON.parse(
  readFileSync(new URL("../static/style.json", import.meta.url), "utf8"),
);
const pageSource = readFileSync(
  new URL("../src/routes/+page.svelte", import.meta.url),
  "utf8",
);
const page = parse(pageSource);

function findMapFill(node) {
  if (node.type === "InlineComponent" && node.name === "MapLayer") {
    const id = node.attributes.find((attribute) => attribute.name === "id");
    if (id?.value[0]?.data === "msoa-fill") return node;
  }
  for (const child of node.children ?? []) {
    const match = findMapFill(child);
    if (match) return match;
  }
}

test("basemap remains a valid MapLibre style", () => {
  assert.deepEqual(validateStyleMin(style), []);
});

test("roads retain thinner widths across zoom levels, including tunnels and bridges", () => {
  const expectedWidths = {
    tunnel_motorway_casing: [[5.8, 0], [6, 1.5], [20, 20]],
    tunnel_motorway_inner: [[4, 1], [6, 0.65], [20, 15]],
    highway_path: [[13, 0.5], [20, 5]],
    highway_minor: [[13, 0.9], [20, 10]],
    highway_major_casing: [[10, 1.5], [20, 11.5]],
    highway_major_inner: [[10, 1], [20, 10]],
    highway_major_subtle: 0.5,
    highway_motorway_casing: [[5.8, 0], [6, 1.5], [20, 20]],
    highway_motorway_inner: [[4, 1], [6, 0.65], [20, 15]],
    highway_motorway_subtle: [[4, 0.5], [6, 0.5]],
    highway_motorway_bridge_casing: [[5.8, 0], [6, 2.5], [20, 22.5]],
    highway_motorway_bridge_inner: [[4, 1], [6, 0.65], [20, 15]],
  };

  for (const [id, expected] of Object.entries(expectedWidths)) {
    const layer = style.layers.find((candidate) => candidate.id === id);
    assert.ok(layer, `${id} must exist`);
    const width = layer.paint["line-width"];
    assert.deepEqual(width.stops ?? width, expected, `${id} road width`);
  }
});

test("building footprints retain full colour while the mask fades surrounding land", () => {
  const fill = findMapFill(page.html);
  const paint = fill.attributes.find((attribute) => attribute.name === "paint")
    .value[0].expression;
  const opacity = paint.properties.find(
    (property) => property.key.value === "fill-opacity",
  ).value;
  assert.equal(opacity.value, 1);
  const mask = style.layers.find((layer) => layer.id === "mask-raster");
  const expression = createExpression(
    mask.paint["raster-opacity"],
    { type: "number", default: 1 },
  );
  assert.equal(expression.result, "success");
  for (const [zoom, expected] of [
    [6, 0],
    [8, 0],
    [9, 0],
    [9.5, 0.25],
    [10, 0.5],
    [11, 0.675],
    [12, 0.85],
  ]) {
    assert.ok(
      Math.abs(expression.value.evaluate({ zoom }) - expected) < 1e-10,
      `Unexpected mask opacity at zoom ${zoom}`,
    );
  }
});

test("affordability fills cover urban basemap fills but preserve water, roads and labels", () => {
  const fill = findMapFill(page.html);
  assert.ok(fill, "The affordability fill layer must exist");
  const anchor = fill.attributes.find((attribute) => attribute.name === "order")
    ?.value[0]?.data;
  assert.equal(anchor, "mask-raster");
  const anchorIndex = style.layers.findIndex((layer) => layer.id === anchor);
  assert.ok(anchorIndex >= 0, "The insertion anchor must exist in the basemap");

  for (const layer of style.layers) {
    const index = style.layers.indexOf(layer);
    if (
      ["park", "landcover", "landuse", "building"].includes(layer["source-layer"])
    ) {
      assert.ok(index < anchorIndex, `${layer.id} must be below the map fill`);
    }
    if (
      layer.type === "line" ||
      layer.type === "symbol" ||
      layer.id === "mask-raster" ||
      layer["source-layer"] === "aeroway" ||
      layer["source-layer"] === "water"
    ) {
      assert.ok(index >= anchorIndex, `${layer.id} must remain above the map fill`);
    }
  }
});
