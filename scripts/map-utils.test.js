import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";
import { createExpression } from "@maplibre/maplibre-gl-style-spec";
import { readFileSync } from "node:fs";

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

test("map colours use five bands including 20+ and avoid repeated feature-state writes", (t) => {
  const bounds = mapUtils.calculateColorBreaks();
  assert.deepEqual(bounds, [0, 5, 10, 15, 20, Infinity]);
  const palette = ["a", "b", "c", "d", "e"];
  const data = Object.fromEntries(
    [0.71, 1, 4.99, 5, 10, 15, 19.99, 20, 120.84, null].map((ratio, id) => [
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

test("sparse property data retains selectable metadata without borrowing ratios", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => ({
    ok: true,
    json: async () => ({
      msoas: [{ code: "other-area", name: "Other area", median: 7, lq: 6 }],
    }),
  }));
  for (const priceLevel of ["median", "lq"]) {
    const data = await mapUtils.loadAffordabilityData("flats", priceLevel);
    assert.equal(data.E02002483.name, "Clavering");
    assert.equal(data.E02002483.la_code, "E06000001");
    assert.equal(data.E02002483.ratio, null);
    assert.equal(data["other-area"].ratio, priceLevel === "median" ? 7 : 6);
  }
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("beeswarm uses the chosen price level for neighbourhoods and comparisons", async (t) => {
  const affordability = {
    median: { ratio: 5.18 },
    lq: { ratio: 4.43 },
  };
  const fetchMock = t.mock.method(globalThis, "fetch", async () => ({
    ok: true,
    json: async () => ({
      regions: [
        {
          code: "E12000001",
          affordability: { median: 5.18, lq: 4.43 },
        },
      ],
      national: [
        {
          name: "England",
          affordability: { median: 5.18, lq: 4.43 },
        },
      ],
    }),
  }));
  const msoas = [
    { code: "E02002483", name: "Clavering", affordability },
    {
      code: "missing-entry",
      affordability: { median: { ratio: 6 }, lq: { ratio: null } },
    },
  ];
  for (const priceLevel of ["median", "lq", "median"]) {
    const [region, nation] = await Promise.all([
      mapUtils.loadRegionalAffordability(
        "all",
        "E12000001",
        "North East",
        priceLevel,
      ),
      mapUtils.loadNationalAffordability("all", "england", priceLevel),
    ]);
    const points = mapUtils.transformMsoaDataForBeeswarm(
      msoas,
      region,
      nation,
      priceLevel,
    );
    assert.equal(
      points.find((point) => point.code === msoas[0].code).x,
      affordability[priceLevel].ratio,
    );
    assert.equal(
      points.find((point) => point.type === "region").x,
      affordability[priceLevel].ratio,
    );
    assert.equal(
      points.find((point) => point.type === "nation").x,
      affordability[priceLevel].ratio,
    );
    assert.equal(
      points.some((point) => point.code === "missing-entry"),
      priceLevel === "median",
    );
  }
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.match(
    fetchMock.mock.calls[0].arguments[0],
    /\/all\/geographic-summary\.json$/,
  );
  assert.equal(
    (await mapUtils.loadNationalAffordability()).ratio,
    affordability.median.ratio,
  );
  assert.equal(
    mapUtils.transformMsoaDataForBeeswarm(msoas)[0].x,
    affordability.median.ratio,
  );
});

test("generated property summaries produce regional and country beeswarm markers for both price levels", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async (url) => ({
    ok: true,
    json: async () =>
      JSON.parse(
        readFileSync(
          new URL(
            `../static${url.slice(url.indexOf("/data/"))}`,
            import.meta.url,
          ),
          "utf8",
        ),
      ),
  }));
  for (const propertyType of [
    "terraced",
    "detached",
    "semi-detached",
    "flats",
  ]) {
    const summary = JSON.parse(
      readFileSync(
        new URL(
          `../static/data/${propertyType}/geographic-summary.json`,
          import.meta.url,
        ),
        "utf8",
      ),
    );
    for (const priceLevel of ["median", "lq"]) {
      const [region, england, wales, country] = await Promise.all([
        mapUtils.loadRegionalAffordability(
          propertyType,
          "E12000001",
          "North East",
          priceLevel,
        ),
        mapUtils.loadNationalAffordability(propertyType, "england", priceLevel),
        mapUtils.loadNationalAffordability(propertyType, "wales", priceLevel),
        mapUtils.loadCountryAffordability(propertyType, "england"),
      ]);
      const points = mapUtils.transformMsoaDataForBeeswarm(
        [],
        region,
        england,
        priceLevel,
      );
      assert.equal(
        points.find((point) => point.type === "region")?.x,
        summary.regions[0].affordability[priceLevel],
      );
      assert.equal(
        points.find((point) => point.type === "nation")?.x,
        summary.national[0].affordability[priceLevel],
      );
      assert.equal(country[priceLevel].ratio, england.ratio);
      assert.equal(wales.ratio, summary.national[1].affordability[priceLevel]);
    }
  }
  assert.equal(fetchMock.mock.callCount(), 4);
});

test("missing comparison ratios are omitted while zero ratios remain valid", async (t) => {
  t.mock.method(globalThis, "fetch", async () => ({
    ok: true,
    json: async () => ({
      regions: [
        { code: "zero-region", affordability: { median: 0, lq: null } },
      ],
      national: [{ name: "England", affordability: { median: 0, lq: null } }],
    }),
  }));
  for (const priceLevel of ["median", "lq"]) {
    const [region, nation] = await Promise.all([
      mapUtils.loadRegionalAffordability(
        "missing-comparisons",
        "zero-region",
        "",
        priceLevel,
      ),
      mapUtils.loadNationalAffordability(
        "missing-comparisons",
        "england",
        priceLevel,
      ),
    ]);
    const points = mapUtils.transformMsoaDataForBeeswarm(
      [],
      region,
      nation,
      priceLevel,
    );
    assert.equal(points.length, priceLevel === "median" ? 2 : 0);
    if (priceLevel === "median")
      assert.ok(points.every((point) => point.x === 0));
  }
});

test("switching to a sparse property dataset clears omitted areas and restores them on return", (t) => {
  const source = {};
  const states = new Map();
  const map = {
    getSource: () => source,
    setFeatureState: t.mock.fn((feature, state) => {
      states.set(feature.id, state);
    }),
  };
  const all = { Jesmond: { ratio: 3.29 }, Clavering: { ratio: 5.18 } };
  const flats = { Clavering: { ratio: 4.43 } };
  const update = (data) =>
    mapUtils.updateMapFeatureStates(
      map,
      "msoa-source",
      data,
      mapUtils.calculateColorBreaks(),
    );
  update(all);
  const original = { ...states.get("Jesmond") };
  update(flats);
  assert.deepEqual(states.get("Jesmond"), { color: "#ccc", ratio: null });
  assert.equal(states.get("Clavering").ratio, 4.43);
  const writes = map.setFeatureState.mock.callCount();
  update(flats);
  assert.equal(map.setFeatureState.mock.callCount(), writes);
  update(all);
  assert.deepEqual(states.get("Jesmond"), original);

  const expression = createExpression(mapUtils.createColorExpression());
  assert.equal(expression.result, "success");
  assert.equal(expression.value.evaluate({}, null, {}), "#ccc");
  assert.equal(
    expression.value.evaluate({}, null, { color: original.color }),
    original.color,
  );
});
