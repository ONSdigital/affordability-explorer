<script>
  export let bounds = [];
  export let colorPalette = ["#E92730", "#f0702f", "#f6ae35", "#f1ec37", "#95ca53", "#2ea949", "#0a8647"];
  export let unavailableColor = "#ccc";

  function formatValue(val) {
    if (val === undefined || val === null) return "Unknown";
    if (val === Infinity) return "No limit";
    return val.toFixed(2);
  }
</script>

<div class="legend">
  <div class="legend-title">Affordability Ratio (Price / Earnings)</div>
  
  <div class="legend-items">
    {#if bounds.length === colorPalette.length + 1}
      {#each colorPalette as color, i}
        <div class="legend-item">
          <div class="legend-color" style="background-color: {color}"></div>
          <div class="legend-label">
            {formatValue(bounds[i])} to {formatValue(bounds[i + 1])}
          </div>
        </div>
      {/each}
    {/if}

    <div class="legend-item">
      <div class="legend-color" style="background-color: {unavailableColor}"></div>
      <div class="legend-label">Data unavailable</div>
    </div>
  </div>

  <div class="legend-note">
    Lower ratios = more affordable (red) | Higher ratios = less affordable (green)
  </div>
</div>

<style>
  .legend {
    background: white;
    padding: 12px;
    border-radius: 4px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    font-size: 12px;
  }

  .legend-title {
    font-weight: 600;
    margin-bottom: 8px;
    font-size: 13px;
    color: #333;
  }

  .legend-items {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 8px;
  }

  .legend-item {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .legend-color {
    width: 16px;
    height: 16px;
    border-radius: 2px;
    border: 1px solid rgba(0, 0, 0, 0.1);
    flex-shrink: 0;
  }

  .legend-label {
    color: #555;
    font-size: 11px;
  }

  .legend-note {
    font-size: 10px;
    color: #999;
    font-style: italic;
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid #eee;
  }
</style>
