import assert from "node:assert/strict";
import { test } from "node:test";
import { createExpression } from "@maplibre/maplibre-gl-style-spec";
import {
  createLegendRangeExpression,
  getLegendDisplayBounds,
  loadMapData,
} from "../src/lib/map-data.js";

test("map data shares pending and completed requests across price levels", async (t) => {
  let resolveResponse;
  const pendingResponse = new Promise((resolve) => {
    resolveResponse = resolve;
  });
  const data = { msoas: [{ code: "E02002483", median: 5.18, lq: null }] };
  const fetchMock = t.mock.method(globalThis, "fetch", () => pendingResponse);
  const jsonMock = t.mock.fn(async () => data);

  const medianRequest = loadMapData("/all/msoas-map.json");
  const lqRequest = loadMapData("/all/msoas-map.json");
  assert.equal(medianRequest, lqRequest);
  resolveResponse({ ok: true, json: jsonMock });

  assert.equal((await medianRequest).msoas[0].median, 5.18);
  assert.equal((await lqRequest).msoas[0].lq, null);
  assert.equal(await loadMapData("/all/msoas-map.json"), data);
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.equal(jsonMock.mock.callCount(), 1);

  await loadMapData("/flats/msoas-map.json");
  assert.equal(fetchMock.mock.callCount(), 2);
});

test("failed requests are surfaced and can be retried", async (t) => {
  const failures = [
    () => Promise.reject(new Error("Network error")),
    async () => ({ ok: false, status: 503 }),
    async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError("Invalid JSON");
      },
    }),
    async () => ({ ok: true, json: async () => ({}) }),
  ];

  for (const [index, fail] of failures.entries()) {
    await t.test(`failure ${index + 1}`, async (t) => {
      const fetchMock = t.mock.method(globalThis, "fetch", fail);
      const url = `/retry-${index}/msoas-map.json`;
      await assert.rejects(loadMapData(url));
      fetchMock.mock.mockImplementation(async () => ({
        ok: true,
        json: async () => ({ msoas: [] }),
      }));
      assert.deepEqual(await loadMapData(url), { msoas: [] });
      assert.equal(fetchMock.mock.callCount(), 2);
    });
  }
});

test("legend expressions preserve range boundaries and exclude unavailable ratios", () => {
  for (const isLast of [false, true]) {
    const result = createExpression(
      createLegendRangeExpression({ min: 5, max: 10, isLast }),
    );
    assert.equal(result.result, "success");
    const matches = (state) => result.value.evaluate({}, null, state);

    assert.equal(matches({ ratio: 4.99 }), false);
    assert.equal(matches({ ratio: 5 }), true);
    assert.equal(matches({ ratio: 9.99 }), true);
    assert.equal(matches({ ratio: 10 }), isLast);
    assert.equal(matches({ ratio: 10.01 }), false);
    assert.equal(matches({ ratio: null }), false);
    assert.equal(matches({}), false);
  }

  const cleared = createExpression(createLegendRangeExpression(null));
  assert.equal(cleared.result, "success");
  assert.equal(cleared.value.evaluate({}, null, { ratio: 7 }), false);
});

test("35+ matches the boundary and extreme ratios without matching missing data", () => {
  const result = createExpression(
    createLegendRangeExpression({ min: 35, max: Infinity, isLast: true }),
  );
  assert.equal(result.result, "success");
  for (const [ratio, expected] of [
    [34.99, false],
    [35, true],
    [120.84, true],
    [null, false],
  ]) {
    assert.equal(result.value.evaluate({}, null, { ratio }), expected);
  }
});

test("open-ended legend has a finite display extent without changing its cutoffs", () => {
  const bounds = [1, 5, 10, 20, 35, Infinity];
  assert.deepEqual(getLegendDisplayBounds(bounds), [1, 5, 10, 20, 35, 50]);
  assert.equal(bounds.at(-1), Infinity);
});
