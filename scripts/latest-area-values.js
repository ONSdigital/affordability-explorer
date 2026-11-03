import XLSX from "xlsx";

function parsePeriodHeader(value) {
  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1900 &&
    value <= 2100
  ) {
    return String(value);
  }
  if (typeof value !== "string") return null;
  if (/^\d{4}$/.test(value)) return value;
  const match = value.match(/Year ending (Mar|Jun|Sep|Dec) (\d{4})/);
  if (!match) return null;
  const quarter = { Mar: "Q1", Jun: "Q2", Sep: "Q3", Dec: "Q4" }[match[1]];
  return `${match[2]}-${quarter}`;
}

export function readLatestAreaValues(workbook, sheetName, codeCol = 0) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`Missing worksheet ${sheetName}`);
  const range = XLSX.utils.decode_range(sheet["!ref"] || "A1");
  let latest = null;
  for (let row = range.s.r; row <= Math.min(range.e.r, 15); row++) {
    for (let col = codeCol + 2; col <= range.e.c; col++) {
      const period = parsePeriodHeader(
        sheet[XLSX.utils.encode_cell({ r: row, c: col })]?.v,
      );
      if (period && (!latest || period > latest.period)) {
        latest = { col, period };
      }
    }
    if (latest) break;
  }
  if (!latest)
    throw new Error(`Missing period headers in worksheet ${sheetName}`);
  const values = {};
  for (let row = 2; row <= range.e.r; row++) {
    const code = sheet[XLSX.utils.encode_cell({ r: row, c: codeCol })]?.v;
    const name =
      sheet[XLSX.utils.encode_cell({ r: row, c: codeCol + 1 })]?.v ?? null;
    const value = sheet[XLSX.utils.encode_cell({ r: row, c: latest.col })]?.v;
    if (typeof code !== "string" || !code || !Number.isFinite(value)) continue;
    values[code] = { code, name, value: Math.round(value) };
  }
  return { period: latest.period, values };
}
