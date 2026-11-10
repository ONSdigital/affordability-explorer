import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { parse } from "svelte/compiler";

const source = readFileSync(
  new URL("../src/routes/+page.svelte", import.meta.url),
  "utf8",
);
const scriptBody = parse(source).instance.content.body;
const loader = scriptBody.find(
  (node) =>
    node.type === "FunctionDeclaration" &&
    node.id.name === "loadBuySectionData",
);

const taxBindings = new Set([
  "DEPOSIT_RATE",
  "ENGLAND_STAMP_DUTY_BANDS",
  "ENGLAND_FIRST_TIME_BUYER_PRICE_LIMIT",
  "ENGLAND_FIRST_TIME_BUYER_BANDS",
  "WALES_LTT_BANDS",
  "calculateTaxFromBands",
  "calculateEnglandStampDuty",
  "calculateTotalSavingsNeeded",
]);
const taxSource = scriptBody
  .filter((node) =>
    node.type === "FunctionDeclaration"
      ? taxBindings.has(node.id.name)
      : node.type === "VariableDeclaration" &&
        node.declarations.some(({ id }) => taxBindings.has(id.name)),
  )
  .map((node) => source.slice(node.start, node.end))
  .join("\n");
const calculateSavings = runInNewContext(
  `${taxSource}\ncalculateTotalSavingsNeeded`,
);

test("England standard stamp duty uses current progressive bands", () => {
  for (const [price, expectedTax] of [
    [125000, 0],
    [125001, 0.02],
    [250000, 2500],
    [250001, 2500.05],
    [295000, 4750],
    [925000, 36250],
    [925001, 36250.1],
    [1500000, 93750],
    [1500001, 93750.12],
  ]) {
    const savings = calculateSavings(price, "england", false);
    assert.ok(
      Math.abs(savings.transactionTax - expectedTax) < 1e-8,
      `Standard stamp duty for ${price}: expected ${expectedTax}, got ${savings.transactionTax}`,
    );
    assert.equal(savings.firstTimeBuyerReliefApplied, false);
    assert.equal(savings.deposit, price * 0.1);
    assert.equal(savings.total, savings.deposit + savings.transactionTax);
  }
});

test("England first-time buyer relief ends above £500,000", () => {
  for (const [price, expectedTax, reliefApplied] of [
    [300000, 0, true],
    [300001, 0.05, true],
    [425000, 6250, true],
    [500000, 10000, true],
    [500001, 15000.05, false],
    [625000, 21250, false],
  ]) {
    const savings = calculateSavings(price, "england", true);
    assert.ok(
      Math.abs(savings.transactionTax - expectedTax) < 1e-8,
      `First-time buyer stamp duty for ${price}: expected ${expectedTax}, got ${savings.transactionTax}`,
    );
    assert.equal(savings.firstTimeBuyerReliefApplied, reliefApplied);
    assert.equal(savings.total, savings.deposit + savings.transactionTax);
  }
});

test("Wales land transaction tax remains independent of first-time buyer state", () => {
  for (const [price, expectedTax] of [
    [225000, 0],
    [280000, 3300],
    [500000, 18000],
  ]) {
    for (const firstTimeBuyer of [false, true]) {
      const savings = calculateSavings(price, "wales", firstTimeBuyer);
      assert.equal(savings.transactionTax, expectedTax);
      assert.equal(savings.firstTimeBuyerReliefApplied, false);
      assert.equal(savings.transactionTaxLabel, "Land Transaction Tax");
      assert.equal(savings.total, price * 0.1 + expectedTax);
    }
  }
});

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
