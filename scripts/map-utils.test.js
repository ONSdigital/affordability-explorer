import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let server;
let mapUtils;

before(async () => {
  server = await createServer({
    server: { middlewareMode: true },
    appType: "custom",
  });
  mapUtils = await server.ssrLoadModule("/src/lib/map-utils.js");
});

after(async () => {
  await server?.close();
});

test("map loader shares a compact payload across median and lower-quartile filters", async (t) => {
  const area = {
    code: "E02002483",
    name: "Clavering",
    la_code: "E06000001",
    la_name: "Hartlepool",
    region_code: "E12000001",
    region_name: "North East",
    median: 5.18,
    lq: null,
  };
  const fetchMock = t.mock.method(globalThis, "fetch", async () => ({
    ok: true,
    json: async () => ({ msoas: [area] }),
  }));
  const [median, lq] = await Promise.all([
    mapUtils.loadAffordabilityData("all", "median"),
    mapUtils.loadAffordabilityData("all", "lq"),
  ]);
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.match(fetchMock.mock.calls[0].arguments[0], /\/all\/msoas-map\.json$/);
  assert.equal(median[area.code].ratio, area.median);
  assert.equal(lq[area.code].ratio, null);
  assert.equal(median[area.code].la_name, area.la_name);
  assert.equal(await mapUtils.loadAffordabilityData("all", "median"), median);
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("map colours use five bands including 35+ and avoid repeated feature-state writes", (t) => {
  const bounds = mapUtils.calculateColorBreaks();
  assert.deepEqual(bounds, [1, 5, 10, 20, 35, Infinity]);
  const palette = ["a", "b", "c", "d", "e"];
  const data = Object.fromEntries(
    [0.71, 1, 4.99, 5, 10, 20, 34.99, 35, 120.84, null].map((ratio, id) => [
      String(id),
      { ratio },
    ]),
  );
  let source = {};
  const states = [];
  const map = {
    getSource: () => source,
    setFeatureState: t.mock.fn((feature, state) => {
      states.push(state);
    }),
  };
  const update = (values = data) =>
    mapUtils.updateMapFeatureStates(
      map,
      "msoa-source",
      values,
      bounds,
      palette,
    );
  update();
  assert.deepEqual(
    states.map((state) => state.color),
    ["a", "a", "a", "b", "c", "d", "d", "e", "e", "#ccc"],
  );
  assert.equal(states[8].ratio, 120.84);
  assert.equal(states[9].ratio, null);
  assert.equal(map.setFeatureState.mock.callCount(), 10);

  update();
  assert.equal(map.setFeatureState.mock.callCount(), 10);
  source = {};
  update();
  assert.equal(map.setFeatureState.mock.callCount(), 20);
  update({ ...data });
  assert.equal(map.setFeatureState.mock.callCount(), 30);
});
