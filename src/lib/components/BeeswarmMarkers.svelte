<script>
  import { createEventDispatcher, getContext } from "svelte";

  const { data, xScale, yScale, custom, width, height, padding } =
    getContext("LayerCake");
  const coords = $custom.coords;
  const dispatch = createEventDispatcher();
  const hoverColor = "#f47721";
  const hoverRadius = 24;
  let hoveredPoint = null;

  const markerColors = {
    selected: "#003c57",
    la: "#206095",
    region: "#a8c61e",
    nation: "#e8528a",
    other: "#d9d9d9",
  };

  function getPoint(index) {
    return {
      ...$data[index],
      ...$coords[index],
    };
  }

  function getCalloutLabel(point) {
    return `${point.label}: ${Number(point.x).toFixed(1)}`;
  }

  function getCalloutWidth(point) {
    const label = getCalloutLabel(point);

    return Math.min(
      Math.max(label.length * 9 + 24, 86),
      $width - 8,
    );
  }

  function getComparisonTextColor(point) {
    return point.marker === "la" ? "#ffffff" : "#222222";
  }

  function isSelectedPoint(point) {
    return point.marker === "selected" || point.selected;
  }

  function getLabelWidth(point) {
    return getCalloutWidth(point);
  }

  function placeLabels(values) {
    const batches = [];

    for (const value of values) {
      batches.push({ size: 1, mean: value });

      while (batches.length > 1) {
        const previous = batches[batches.length - 2];
        const current = batches[batches.length - 1];

        if (previous.mean < current.mean) break;

        previous.mean =
          (previous.mean * previous.size + current.mean * current.size) /
          (previous.size + current.size);
        previous.size += current.size;
        batches.pop();
      }
    }

    return batches.flatMap((batch) =>
      Array.from({ length: batch.size }, () => batch.mean),
    );
  }

  function buildLabelPlacements(labelPoints) {
    const placements = new Map();
    const chartWidth = $width;
    const topPadding = $padding.top;
    const orderedPoints = [...labelPoints].sort((a, b) => a.x - b.x);
    const rows = [];
    const maxHorizontalDodge = 48;

    function fitRow(points) {
      const widths = points.map((point) => getLabelWidth(point));
      const cumulativeWidths = Array(points.length).fill(0);

      for (let index = 1; index < points.length; index += 1) {
        cumulativeWidths[index] =
          cumulativeWidths[index - 1] +
          (widths[index - 1] + widths[index]) / 2 +
          8;
      }

      const pointXs = points.map((point) => $xScale(point.x));
      const baselinedXs = pointXs.map(
        (x, index) => x - cumulativeWidths[index],
      );
      const regressedXs = placeLabels(baselinedXs);
      const fittedXs = regressedXs.map(
        (x, index) => x + cumulativeWidths[index],
      );
      const leftEdge = fittedXs[0] - widths[0] / 2;
      const rightEdge = fittedXs.at(-1) + widths.at(-1) / 2;
      const shift =
        leftEdge < 0
          ? -leftEdge
          : rightEdge > chartWidth
            ? chartWidth - rightEdge
            : 0;
      const xs = fittedXs.map((x) => x + shift);

      return {
        fits: rightEdge - leftEdge <= chartWidth,
        xs,
        maxDodge: Math.max(
          ...xs.map((x, index) => Math.abs(x - pointXs[index])),
        ),
      };
    }

    for (const point of orderedPoints) {
      let placed = false;

      for (const row of rows) {
        const candidatePoints = [...row.points, point].sort(
          (a, b) => a.x - b.x,
        );
        const fit = fitRow(candidatePoints);

        if (fit.fits && fit.maxDodge <= maxHorizontalDodge) {
          row.points = candidatePoints;
          row.fit = fit;
          placed = true;
          break;
        }
      }

      if (!placed) {
        const points = [point];
        rows.push({ points, fit: fitRow(points) });
      }
    }

    rows.forEach((row, rowIndex) => {
      row.points.forEach((point, pointIndex) => {
        placements.set(point, {
          x: row.fit.xs[pointIndex],
          y: -topPadding + 2 + rowIndex * 34,
        });
      });
    });

    return placements;
  }

  function buildElbowFractions(labelPoints, placements) {
    const fractions = new Map();
    const groups = { left: [], right: [] };

    for (const point of labelPoints) {
      const pointX = $xScale(point.x);
      const labelX = placements.get(point).x;
      const direction =
        labelX < pointX ? "left" : labelX > pointX ? "right" : null;

      if (!direction) {
        fractions.set(point, 0.5);
        continue;
      }

      groups[direction].push({
        point,
        distance: Math.abs(labelX - pointX),
      });
    }

    for (const group of Object.values(groups)) {
      group.sort((a, b) => b.distance - a.distance);
      group.forEach(({ point }, index) => {
        fractions.set(point, (index + 1) / (group.length + 1));
      });
    }

    return fractions;
  }

  function getPointerPosition(event) {
    const svg = event.currentTarget.ownerSVGElement;
    const matrix = event.currentTarget.getScreenCTM();

    if (!svg || !matrix) return null;

    const pointer = svg.createSVGPoint();
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    return pointer.matrixTransform(matrix.inverse());
  }

  function updateHoveredPoint(event) {
    const pointer = getPointerPosition(event);
    if (!pointer) return;
    let closestPoint = null;
    let closestDistance = hoverRadius;

    for (const point of interactivePoints) {
      const distance = Math.hypot(
        pointer.x - $xScale(point.x),
        pointer.y - $yScale(point.y),
      );

      if (distance < closestDistance) {
        closestPoint = point;
        closestDistance = distance;
      }
    }

    hoveredPoint = closestPoint;
  }

  function selectHoveredPoint() {
    if (hoveredPoint?.code) {
      dispatch("select", { code: hoveredPoint.code });
    }
  }

  $: points = $coords ? $coords.map((_, index) => getPoint(index)) : [];
  $: interactivePoints = points.filter(
    (point) => point.marker === "other" || point.marker === "selected",
  );
  $: selectedPoints = points.filter(
    (point) =>
      point.marker === "selected" || (point.marker === "la" && point.selected),
  );
  $: comparisons = points
    .filter(
      (point) =>
        (point.marker === "la" && !point.selected) ||
        point.marker === "region" ||
        point.marker === "nation",
    )
    .sort(
      (a, b) =>
        ["nation", "region", "la"].indexOf(a.marker) -
        ["nation", "region", "la"].indexOf(b.marker),
    );
  $: labelPoints = [...selectedPoints, ...comparisons].sort(
    (a, b) => a.x - b.x,
  );
  $: labelPlacements = buildLabelPlacements(labelPoints);
  $: elbowFractions = buildElbowFractions(labelPoints, labelPlacements);
  $: callouts = [...labelPoints].sort(
    (a, b) => labelPlacements.get(b).y - labelPlacements.get(a).y,
  );
</script>

{#if $coords}
  <g class="beeswarm-other-markers">
    {#each points.filter((point) => point.marker === "other") as point}
      {@const x = $xScale(point.x)}
      {@const y = $yScale(point.y)}
      <circle
        cx={x}
        cy={y}
        r="5.5"
        fill={markerColors.other}
        stroke="#bcbec0"
        stroke-width="1.5"
      />
    {/each}
  </g>

  <g class="beeswarm-static-annotations" opacity={hoveredPoint ? 0.2 : 1}>
    {#each callouts as point}
      {@const x = $xScale(point.x)}
      {@const y = $yScale(point.y)}
      {@const labelHeight = 30}
      {@const placement = labelPlacements.get(point)}
      {@const labelY = placement.y}
      {@const labelX = placement.x}
      {@const labelBottom = labelY + labelHeight}
      {@const elbowY =
        labelBottom + (y - labelBottom) * elbowFractions.get(point)}
      <path
        d={`M ${x} ${y} V ${elbowY} H ${labelX} V ${labelY + labelHeight}`}
        fill="none"
        stroke={markerColors[point.marker]}
        stroke-width="3"
      />
    {/each}

    <g class="beeswarm-highlighted-markers">
    {#each points.filter((point) => point.marker !== "other") as point}
      {@const x = $xScale(point.x)}
      {@const y = $yScale(point.y)}
      {#if point.marker === "selected"}
        <circle cx={x} cy={y} r="7.5" fill={markerColors.selected} />
      {:else if point.marker === "la"}
        <rect
          x={x - 5.3}
          y={y - 5.3}
          width="10.6"
          height="10.6"
          fill={point.selected ? markerColors.la : "#ffffff"}
          stroke={markerColors.la}
          stroke-width="2.5"
          transform={`rotate(45 ${x} ${y})`}
        />
      {:else if point.marker === "region"}
        <rect
          x={x - 6}
          y={y - 6}
          width="12"
          height="12"
          fill="#ffffff"
          stroke={markerColors.region}
          stroke-width="2.5"
        />
      {:else if point.marker === "nation"}
        <circle
          cx={x}
          cy={y}
          r="7.5"
          fill="#ffffff"
          stroke={markerColors.nation}
          stroke-width="2.5"
        />
      {/if}
    {/each}
    </g>

    <g class="beeswarm-callout-labels">
    {#each callouts as point}
      {@const labelWidth = getCalloutWidth(point)}
      {@const labelHeight = 30}
      {@const placement = labelPlacements.get(point)}
      {@const labelY = placement.y}
      {@const labelX = placement.x}
      <rect
        x={labelX - labelWidth / 2}
        y={labelY}
        width={labelWidth}
        height={labelHeight}
        rx="5"
        fill={isSelectedPoint(point)
          ? markerColors.selected
          : markerColors[point.marker]}
      />
      <text
        x={labelX}
        y={labelY + 21}
        text-anchor="middle"
        fill={isSelectedPoint(point)
          ? "#ffffff"
          : getComparisonTextColor(point)}
        font-size="17"
        font-weight="600"
      >
        {getCalloutLabel(point)}
      </text>
    {/each}
    </g>
  </g>

  <rect
    x="0"
    y={-$padding.top}
    width={$width}
    height={$height + $padding.top}
    fill="transparent"
    pointer-events="all"
    on:mousemove={updateHoveredPoint}
    on:mouseleave={() => (hoveredPoint = null)}
    on:click={selectHoveredPoint}
  />

  {#if hoveredPoint}
    {@const x = $xScale(hoveredPoint.x)}
    {@const y = $yScale(hoveredPoint.y)}
    {@const labelWidth = getCalloutWidth(hoveredPoint)}
    {@const labelHeight = 30}
    {@const labelX = Math.max(
      labelWidth / 2,
      Math.min($width - labelWidth / 2, x),
    )}
    {@const labelY = -$padding.top + 2}
    {@const elbowY = labelY + labelHeight + (y - labelY - labelHeight) / 2}
    <g class="beeswarm-hover-annotation" pointer-events="none">
      <path
        d={`M ${x} ${y} V ${elbowY} H ${labelX} V ${labelY + labelHeight}`}
        fill="none"
        stroke={hoverColor}
        stroke-width="3"
      />
      <circle
        cx={x}
        cy={y}
        r="7.5"
        fill={hoverColor}
        stroke="#ffffff"
        stroke-width="2.5"
      />
      <rect
        x={labelX - labelWidth / 2}
        y={labelY}
        width={labelWidth}
        height={labelHeight}
        rx="5"
        fill={hoverColor}
      />
      <text
        x={labelX}
        y={labelY + 21}
        text-anchor="middle"
        fill="#ffffff"
        font-size="17"
        font-weight="600"
      >
        {getCalloutLabel(hoveredPoint)}
      </text>
    </g>
  {/if}
{/if}
