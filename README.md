# affordability-explorer

An interactive data visualization application for exploring UK housing affordability by Middle Super Output Area (MSOA), built with SvelteKit and ONS visual components.

## Features

- **Interactive Map**: Visualize housing affordability across Middle Super Output Areas (MSOAs) in England and Wales using ONS vector tiles
- **Color-Coded Affordability Ratios**: Map displays 7-color gradient representing price-to-earnings ratios
- **Property Type Filtering**: Switch between "All", Detached, Semi-detached, Terraced, and Flats
- **Price Level Filtering**: View Median or Lower Quartile affordability ratios
- **Dynamic Legend**: Shows affordability ratio ranges with automatic color breaks calculated from data
- **Responsive Design**: Works on desktop and mobile devices

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- npm

### Installation

Install dependencies:

```bash
npm install
```

### Development

To start the development server:

```bash
npm run dev
```

The app will be available at [http://localhost:5173](http://localhost:5173)

### Building

To build the production version:

```bash
npm run build
```

To build the preview version (for staging):

```bash
npm run build:preview
```

To preview the built app locally:

```bash
npm run preview
```

### Data Generation

The application requires pre-processed ONS housing affordability data. Generate the data from raw Excel files:

```bash
npm run generate-data
```

This processes:
- 7 Excel files with 5 property types each
- 7,264 MSOAs across 318 Local Authorities
- Calculates affordability ratios (price ÷ earnings)
- Creates time series data (119 quarters: 1995-Q4 to 2025-Q2)
- Generates map-ready files with property-type-specific aggregates
- Creates shared geography files (authorities + regions)

**Output**: ~834 MB of JSON files in `static/data/` (not committed to git)
- Shared geography folder: authorities.json + regions.json
- 5 property-type directories: each with LA files + msoas-latest + national aggregates
- 1,607 JSON files total

**Time**: ~9 minutes (5 min parse + 2 min calculate + 2 min generate)

For detailed information about the data pipeline, see [PIPELINE.md](./PIPELINE.md)

## Map Implementation

The interactive map displays MSOA boundaries from ONS Vector Tiles and colors them based on housing affordability data:

### Data Sources
- **MSOA Boundaries**: https://cdn.ons.gov.uk/maptiles/administrative/2021/msoa/v2/boundaries/{z}/{x}/{y}.pbf
- **Affordability Data**: Generated from `/data/[property-type]/msoas-latest.json`
- **Base Map**: OpenStreetMap raster tiles

### Color Breaks
Uses equal-interval method to divide affordability ratios into 7 color ranges:
- Red (#E92730) = Most affordable (lowest ratios)
- Green (#0a8647) = Least affordable (highest ratios)
- Gray (#ccc) = Data unavailable

Breaks are calculated dynamically based on the minimum and maximum affordability ratios in the selected property type and price level.

### Map Features
- Zoom: 6 (centered on England and Wales)
- Vector tile layer: `msoa` with feature IDs from `areacd` (MSOA codes)
- Feature state: Each MSOA has a `color` property set based on affordability ratio
- Paint expression: Simple case statement using feature state color
- Hover/select: Visual feedback when hovering or selecting MSOAs

### Code Quality

Format code with Prettier:

```bash
npm run format
```

Check code formatting:

```bash
npm run lint
```

## Configuration

Edit the base paths in `/src/app.config.js` to match your deployment environment:

```javascript
export const base_prod = '/visualisations/affordability-explorer'; // Production path
export const base_preview = '/affordability-explorer'; // Preview/staging path
```

## Project Structure

- `/src/routes/` - Page components and routing
- `/src/lib/` - Reusable components and utilities
- `/src/lib/components/` - Svelte components (ColorLegend, etc.)
- `/static/data/` - Generated affordability data files (not committed)
- `/src/app.html` - HTML shell
- `/src/app.css` - Global styles

## Built With

- [SvelteKit](https://kit.svelte.dev/) - Framework
- [Svelte 5](https://svelte.dev/) - UI framework
- [ONS Svelte Components](https://github.com/ONSvisual/svelte-components/) - Visual components library
- [ONS Svelte Charts](https://github.com/ONSvisual/svelte-charts/) - Charting library
- [ONS Svelte Maps](https://github.com/ONSvisual/svelte-maps/) - Mapping library with Maplibre GL
- [Vite](https://vitejs.dev/) - Build tool

## License

MIT
