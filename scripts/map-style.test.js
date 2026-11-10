import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "svelte/compiler";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";

const style = JSON.parse(
  readFileSync(new URL("../static/style.json", import.meta.url), "utf8"),
);
const page = parse(
  readFileSync(new URL("../src/routes/+page.svelte", import.meta.url), "utf8"),
);

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

test("affordability fills cover urban basemap fills but preserve water, roads and labels", () => {
  const fill = findMapFill(page.html);
  assert.ok(fill, "The affordability fill layer must exist");
  const anchor = fill.attributes.find((attribute) => attribute.name === "order")
    ?.value[0]?.data;
  assert.equal(anchor, "water");
  const anchorIndex = style.layers.findIndex((layer) => layer.id === anchor);
  assert.ok(anchorIndex >= 0, "The insertion anchor must exist in the basemap");

  for (const layer of style.layers) {
    const index = style.layers.indexOf(layer);
    if (
      layer.type === "raster" ||
      ["park", "landcover", "landuse", "building"].includes(layer["source-layer"])
    ) {
      assert.ok(index < anchorIndex, `${layer.id} must be below the map fill`);
    }
    if (
      layer.type === "line" ||
      layer.type === "symbol" ||
      layer["source-layer"] === "aeroway" ||
      layer["source-layer"] === "water"
    ) {
      assert.ok(index >= anchorIndex, `${layer.id} must remain above the map fill`);
    }
  }
});
