const mapDataRequests = new Map();

export function loadMapData(url) {
  if (!mapDataRequests.has(url)) {
    const request = fetch(url)
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (!Array.isArray(data.msoas)) {
          throw new Error(`Invalid map data from ${url}: missing MSOAs`);
        }
        return data;
      })
      .catch((error) => {
        mapDataRequests.delete(url);
        throw error;
      });
    mapDataRequests.set(url, request);
  }

  return mapDataRequests.get(url);
}

export function createLegendRangeExpression(range) {
  if (!range) return false;

  const ratio = ["coalesce", ["feature-state", "ratio"], -1];
  const expression = [
    "all",
    ["!=", ["feature-state", "ratio"], null],
    [">=", ratio, range.min],
  ];
  if (range.max !== Infinity) {
    expression.push([range.isLast ? "<=" : "<", ratio, range.max]);
  }
  return expression;
}

export function getLegendDisplayBounds(bounds) {
  const displayBounds = [...bounds];
  if (displayBounds.at(-1) === Infinity && displayBounds.length >= 3) {
    const start = displayBounds.at(-2);
    // Give the open-ended band the same visual width as the preceding band.
    displayBounds[displayBounds.length - 1] =
      start + (start - displayBounds.at(-3));
  }
  return displayBounds;
}
