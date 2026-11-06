import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { parse } from "svelte/compiler";

const source = readFileSync(
  new URL("../src/routes/+page.svelte", import.meta.url),
  "utf8",
);
const loader = parse(source).instance.content.body.find(
  (node) =>
    node.type === "FunctionDeclaration" &&
    node.id.name === "loadBuySectionData",
);

test("buy cards load MSOA and LA ratios for the selected property type and price level", async () => {
  const laData = {
    name: "Local authority",
    affordability: {
      median: { price: 250000, ratio: 8 },
      lq: { price: 180000, ratio: 6 },
    },
    msoas: [
      {
        code: "msoa",
        name: "Neighbourhood",
        affordability: {
          median: { price: 200000, ratio: 7 },
          lq: { price: 150000, ratio: null },
        },
      },
    ],
  };
  for (const [type, level, price, ratio] of [
    ["la", "median", 250000, 8],
    ["la", "lq", 180000, 6],
    ["msoa", "median", 200000, 7],
    ["msoa", "lq", 150000, null],
  ]) {
    const context = {
      buySectionRequestId: 0,
      loadLocalAuthorityData: async (propertyType, code) => {
        assert.equal(propertyType, "flats");
        assert.equal(code, "la");
        return laData;
      },
      getPriceLevelLabel: (value) => value,
      getCountryFromRegionCode: () => "england",
      roundUp: (value, increment) => Math.ceil(value / increment) * increment,
      INCOME_MULTIPLIER: 4.5,
      selection: { type, code: type, la_code: "la" },
      level,
    };
    await runInNewContext(
      `${source.slice(loader.start, loader.end)}
       loadBuySectionData("flats", level, selection)`,
      context,
    );
    assert.equal(context.buySectionError, null);
    assert.equal(context.buySectionLoading, false);
    assert.equal(context.buySectionData.propertyPrice, price);
    assert.equal(context.buySectionData.ratio, ratio);
  }
});
