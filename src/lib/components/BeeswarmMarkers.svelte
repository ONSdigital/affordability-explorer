<script>
  import { getContext } from "svelte";

  const { data, xScale, yScale, custom, width, height } =
    getContext("LayerCake");
  const coords = $custom.coords;

  const markerColors = {
    selected: "#003c57",
    la: "#003c57",
    region: "#fd7e14",
    nation: "#e74c3c",
    other: "#d9d9d9",
  };

  function getPoint(index) {
    return {
      ...$data[index],
      ...$coords[index],
    };
  }

  function getReferenceLabel(point) {
    const prefix = point.marker === "region" ? "Regional" : "National";
    return `${prefix}: ${Number(point.x).toFixed(2)}`;
  }

  function clampLabelX(x, labelWidth) {
    return Math.max(labelWidth / 2, Math.min($width - labelWidth / 2, x));
  }

  $: points = $coords ? $coords.map((_, index) => getPoint(index)) : [];
  $: references = points.filter(
    (point) => point.marker === "region" || point.marker === "nation",
  );
</script>

{#if $coords}
  <g class="beeswarm-reference-lines">
    {#each references as point, index}
      {@const x = $xScale(point.x)}
      {@const labelWidth = 116}
      {@const labelY = 2 + index * 28}
      {@const labelX = clampLabelX(x, labelWidth)}
      <line
        x1={x}
        x2={x}
        y1={labelY + 22}
        y2={$height}
        stroke={markerColors[point.marker]}
        stroke-width="1.5"
      />
      <rect
        x={labelX - labelWidth / 2}
        y={labelY}
        width={labelWidth}
        height="22"
        fill="#ffffff"
        stroke={markerColors[point.marker]}
        stroke-width="1.5"
      />
      <text
        x={labelX}
        y={labelY + 15}
        text-anchor="middle"
        fill="#222222"
        font-size="11"
        font-weight="600"
      >
        {getReferenceLabel(point)}
      </text>
    {/each}
  </g>

  <g class="beeswarm-markers">
    {#each points as point}
      {@const x = $xScale(point.x)}
      {@const y = $yScale(point.y)}
      {#if point.marker === "selected"}
        <circle cx={x} cy={y} r="10" fill={markerColors.selected} />
      {:else if point.marker === "la"}
        <circle
          cx={x}
          cy={y}
          r={point.selected ? 10 : 7}
          fill="#ffffff"
          stroke={markerColors.la}
          stroke-width="2"
        />
      {:else if point.marker === "region"}
        <rect
          x={x - 7}
          y={y - 7}
          width="14"
          height="14"
          fill={markerColors.region}
        />
      {:else if point.marker === "nation"}
        <rect
          x={x - 6}
          y={y - 6}
          width="12"
          height="12"
          fill={markerColors.nation}
          transform={`rotate(45 ${x} ${y})`}
        />
      {:else}
        <circle cx={x} cy={y} r="3" fill={markerColors.other} />
      {/if}
    {/each}
  </g>
{/if}
