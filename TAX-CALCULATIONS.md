# Stamp Duty and Land Transaction Tax calculations

The calculations use the selected MSOA or local authority's property price for
the chosen property type and median or lower-quartile price level. Tax is
calculated on the full price, not the price after subtracting the deposit.

## Progressive tax calculation

Each rate applies only to the portion of the price within its band:

```text
Taxable portion = max(0, min(property price, upper boundary) - lower boundary)
Band tax = taxable portion x band rate
Total tax = sum of all band taxes
```

The first band's lower boundary is zero. Each subsequent band's lower boundary
is the preceding band's upper boundary. The last band has no upper limit.

## England: Stamp Duty Land Tax

These are the main residential rates from 1 April 2025.

| Portion of purchase price         | Rate |
| --------------------------------- | ---: |
| Up to and including GBP 125,000   |   0% |
| Over GBP 125,000 to GBP 250,000   |   2% |
| Over GBP 250,000 to GBP 925,000   |   5% |
| Over GBP 925,000 to GBP 1,500,000 |  10% |
| Over GBP 1,500,000                |  12% |

For a GBP 295,000 purchase:

```text
First GBP 125,000 x 0% = GBP 0
Next GBP 125,000 x 2% = GBP 2,500
Remaining GBP 45,000 x 5% = GBP 2,250
Total Stamp Duty = GBP 4,750
```

### First-time buyer relief

When "I'm a first-time buyer" is checked and the price is no more than
GBP 500,000:

| Portion of purchase price       | Rate |
| ------------------------------- | ---: |
| Up to and including GBP 300,000 |   0% |
| Over GBP 300,000 to GBP 500,000 |   5% |

If the entire price exceeds GBP 500,000, no first-time buyer relief applies:
the whole purchase is recalculated using the standard bands above.

```text
GBP 500,000 purchase, first-time buyer:
GBP 300,000 x 0% + GBP 200,000 x 5% = GBP 10,000

GBP 500,001 purchase, first-time buyer:
GBP 125,000 x 0% + GBP 125,000 x 2% + GBP 250,001 x 5%
= GBP 15,000.05 before display rounding
```

Selecting lower-quartile prices does not automatically enable first-time buyer
relief; the checkbox controls it.

## Wales: Land Transaction Tax

These are the main residential rates from 10 October 2022. The app applies the
same calculation regardless of first-time buyer state.

| Portion of purchase price         | Rate |
| --------------------------------- | ---: |
| Up to and including GBP 225,000   |   0% |
| Over GBP 225,000 to GBP 400,000   |   6% |
| Over GBP 400,000 to GBP 750,000   | 7.5% |
| Over GBP 750,000 to GBP 1,500,000 |  10% |
| Over GBP 1,500,000                |  12% |

For a GBP 500,000 purchase:

```text
First GBP 225,000 x 0% = GBP 0
Next GBP 175,000 x 6% = GBP 10,500
Remaining GBP 100,000 x 7.5% = GBP 7,500
Total Land Transaction Tax = GBP 18,000
```

## Deposit and total savings

```text
Deposit = property price x 10%
Total savings = deposit + transaction tax
Displayed total savings = ceil(total savings / 10) x 10
```

Tax and deposit are displayed to the nearest whole pound. The total is rounded
up to the next GBP 10. Calculations retain fractional amounts until display;
there is no explicit tax-specific truncation or pence-rounding step.
Displayed components may therefore not add up exactly to the displayed total.

For an England standard purchase at GBP 295,000:

```text
Deposit = GBP 29,500
Stamp Duty = GBP 4,750
Total savings = GBP 34,250
```

Missing, non-numeric, non-finite, zero or negative prices do not produce a
valid savings estimate.

## Calculation scope

These estimates assume main residential rates. They do not include additional
property higher rates, non-resident surcharges, lease rent tax, special reliefs
or other purchase costs. First-time buyer eligibility is represented by the
checkbox, not independently assessed. There is no transaction-date input.

Implementation: `src/routes/+page.svelte`.

Rate references:

- [GOV.UK: residential Stamp Duty rates](https://www.gov.uk/stamp-duty-land-tax/residential-property-rates)
- [Welsh Government: Land Transaction Tax rates and bands](https://www.gov.wales/land-transaction-tax-rates-and-bands)
