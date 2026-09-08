<script>
  import { createEventDispatcher } from "svelte";

  export let bounds = [];
  export let colorPalette = ["#EAECB1", "#A9D891", "#00A7BA", "#004EA6", "#002D7D", "#000D54"];
  export let unavailableColor = "#ccc";
  export let selectedRangeIndex = null;
  export let hoverValue = null;
  export let selectedValue = null;

  const dispatch = createEventDispatcher();
  let hoveredRangeIndex = null;

  function formatIntegerValue(val) {
    if (!Number.isFinite(val)) return "—";
    return new Intl.NumberFormat("en-GB", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(val);
  }

  function roundBoundaryValue(value, { isFirst = false, isLast = false } = {}) {
    if (!Number.isFinite(value)) return null;
    if (isFirst) return Math.floor(value);
    if (isLast) return Math.ceil(value);
    return Math.round(value);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function toIndicatorPosition(value, currentBounds) {
    if (!Number.isFinite(value)) {
      return null;
    }

    if (!Array.isArray(currentBounds) || currentBounds.length < 2) {
      return null;
    }

    const minBound = currentBounds[0];
    const maxBound = currentBounds[currentBounds.length - 1];
    const domain = maxBound - minBound;

    if (!Number.isFinite(minBound) || !Number.isFinite(maxBound) || domain <= 0) {
      return null;
    }

    return clamp(((value - minBound) / domain) * 100, 0, 100);
  }

  function getPaletteForBreaks(breakCount) {
    if (!Number.isFinite(breakCount) || breakCount <= 0) {
      return [];
    }

    if (breakCount <= colorPalette.length) {
      return colorPalette.slice(0, breakCount);
    }

    return Array.from({ length: breakCount }, (_, i) => {
      const paletteIndex = Math.round((i * (colorPalette.length - 1)) / (breakCount - 1));
      return colorPalette[paletteIndex];
    });
  }

  function createTickMarks(currentBounds) {
    if (!Array.isArray(currentBounds) || currentBounds.length < 2) {
      return [];
    }

    const minBound = currentBounds[0];
    const maxBound = currentBounds[currentBounds.length - 1];
    const domain = maxBound - minBound;

    return currentBounds.map((value, index) => {
      const left =
        Number.isFinite(domain) && domain > 0
          ? ((value - minBound) / domain) * 100
          : (index / (currentBounds.length - 1)) * 100;
      const roundedValue = roundBoundaryValue(value, {
        isFirst: index === 0,
        isLast: index === currentBounds.length - 1,
      });

      return {
        value,
        left,
        label: formatIntegerValue(roundedValue),
      };
    });
  }

  function createLegendRanges(currentBounds) {
    if (!Array.isArray(currentBounds) || currentBounds.length < 2) {
      return [];
    }

    const minBound = currentBounds[0];
    const maxBound = currentBounds[currentBounds.length - 1];
    const domain = maxBound - minBound;
    const breakCount = currentBounds.length - 1;
    const palette = getPaletteForBreaks(breakCount);

    return Array.from({ length: breakCount }, (_, index) => {
      const min = currentBounds[index];
      const max = currentBounds[index + 1];
      const left =
        Number.isFinite(domain) && domain > 0
          ? ((min - minBound) / domain) * 100
          : (index / breakCount) * 100;
      const width = Number.isFinite(domain) && domain > 0 ? ((max - min) / domain) * 100 : 100 / breakCount;

      return {
        index,
        min,
        max,
        isLast: index === breakCount - 1,
        minLabel: formatIntegerValue(
          roundBoundaryValue(min, { isFirst: index === 0 })
        ),
        maxLabel: formatIntegerValue(
          roundBoundaryValue(max, { isLast: index === breakCount - 1 })
        ),
        color: palette[index] ?? colorPalette[colorPalette.length - 1],
        left,
        width: Math.max(0, width),
      };
    });
  }

  function getRangeLabel(range) {
    return `${range.minLabel} to ${range.maxLabel}`;
  }

  function setHoveredRange(range) {
    hoveredRangeIndex = range.index;
    dispatch("rangehover", { range });
  }

  function clearHoveredRange() {
    hoveredRangeIndex = null;
    dispatch("rangeleave");
  }

  function handleKeyScaleFocusOut(event) {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      clearHoveredRange();
    }
  }

  function selectRange(range) {
    dispatch("rangeselect", { range });
  }

  function isRangeDimmed(index) {
    if (hoveredRangeIndex !== null) {
      return hoveredRangeIndex !== index;
    }

    if (selectedRangeIndex !== null && selectedRangeIndex !== undefined) {
      return selectedRangeIndex !== index;
    }

    return false;
  }

  $: tickMarks = createTickMarks(bounds);
  $: legendRanges = createLegendRanges(bounds);
  $: hoverIndicatorPosition = toIndicatorPosition(hoverValue, bounds);
  $: selectedIndicatorPosition = toIndicatorPosition(selectedValue, bounds);
</script>

<div class="keycontainer">
  <div class="key-title">Affordability ratio (price / earnings)</div>

  {#if legendRanges.length > 0}
    <div class="keyscale">
      <div class="keyscale-indicators" aria-hidden="true">
        {#if Number.isFinite(selectedIndicatorPosition)}
          <svg
            class="key-indicator key-indicator--selected"
            style="left: {selectedIndicatorPosition}%;"
            width="18"
            height="14"
            viewBox="0 0 18 14"
          >
            <polygon points="1,1 17,1 9,13" />
          </svg>
        {/if}
        {#if Number.isFinite(hoverIndicatorPosition)}
          <svg
            class="key-indicator key-indicator--hover"
            style="left: {hoverIndicatorPosition}%;"
            width="18"
            height="14"
            viewBox="0 0 18 14"
          >
            <polygon points="1,1 17,1 9,13" />
          </svg>
        {/if}
      </div>

      <div
        class="keyscale-bar"
        role="group"
        aria-label="Affordability legend ranges"
        on:mouseleave={clearHoveredRange}
        on:focusout={handleKeyScaleFocusOut}
      >
        {#each legendRanges as range}
          <button
            type="button"
            class="keyscale-rect"
            class:is-dimmed={isRangeDimmed(range.index)}
            class:is-hovered={hoveredRangeIndex === range.index}
            class:is-selected={hoveredRangeIndex === null && selectedRangeIndex === range.index}
            style="left: {range.left}%; width: {range.width}%; background-color: {range.color};"
            aria-label={`Select affordability range ${getRangeLabel(range)}`}
            aria-pressed={selectedRangeIndex === range.index}
            on:mouseenter={() => setHoveredRange(range)}
            on:focus={() => setHoveredRange(range)}
            on:click={() => selectRange(range)}
          ></button>
        {/each}
      </div>

      <div class="keyscale-ticks">
        {#each tickMarks as tick, index}
          <span
            class="keyscale-tick"
            class:keyscale-tick--start={index === 0}
            class:keyscale-tick--end={index === tickMarks.length - 1}
            style="left: {tick.left}%;"
          >
            {tick.label}
          </span>
        {/each}
      </div>
    </div>
  {/if}

  <div class="legend-unavailable">
    <span class="legend-unavailable__swatch" style="background-color: {unavailableColor};"></span>
    <span>Data unavailable</span>
  </div>
</div>

<style>
  .keycontainer {
    width: 100%;
    box-sizing: border-box;
  }

  .key-title {
    margin: 0 0 8px;
    font-weight: 600;
    font-size: 13px;
    color: #333;
  }

  .keyscale {
    width: 100%;
    position: relative;
    padding-top: 17px;
  }

  .keyscale-indicators {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    height: 14px;
    pointer-events: none;
  }

  .key-indicator {
    position: absolute;
    top: 0;
    transform: translateX(-50%);
    overflow: visible;
    z-index: 2;
  }

  .key-indicator polygon {
    fill: #fff;
    stroke: #111827;
    stroke-width: 2;
    stroke-linejoin: round;
  }

  .key-indicator--selected {
    opacity: 0.5;
    z-index: 1;
  }

  .keyscale-bar {
    position: relative;
    width: 100%;
    height: 22px;
    overflow: hidden;
    border-radius: 2px;
    border: 1px solid rgba(0, 0, 0, 0.1);
  }

  .keyscale-rect {
    position: absolute;
    top: 0;
    bottom: 0;
    border: 0;
    margin: 0;
    padding: 0;
    cursor: pointer;
  }

  .keyscale-rect.is-dimmed {
    opacity: 0.35;
  }

  .keyscale-rect.is-hovered,
  .keyscale-rect.is-selected {
    box-shadow: inset 0 0 0 2px #414042;
    opacity: 1;
    z-index: 1;
  }

  .keyscale-rect:focus-visible {
    outline: 3px solid #fbc900;
    outline-offset: 2px;
    z-index: 3;
  }

  .keyscale-ticks {
    position: relative;
    margin-top: 7px;
    min-height: 28px;
  }

  .keyscale-tick {
    position: absolute;
    top: 0;
    transform: translateX(-50%);
    color: #666;
    font-size: 13px;
    white-space: nowrap;
    line-height: 1.2;
  }

  .keyscale-tick--start {
    transform: translateX(0);
  }

  .keyscale-tick--end {
    transform: translateX(-100%);
  }

  .legend-unavailable {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #666;
    font-size: 12px;
    margin-top: 6px;
  }

  .legend-unavailable__swatch {
    width: 14px;
    height: 14px;
    border: 1px solid rgba(0, 0, 0, 0.1);
    border-radius: 2px;
    flex-shrink: 0;
  }
</style>
