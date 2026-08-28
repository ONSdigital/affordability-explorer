# affordability-explorer

An interactive data visualization application built with SvelteKit and ONS visual components.

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
- `/src/app.html` - HTML shell
- `/src/app.css` - Global styles
- `/static/` - Static assets

## Built With

- [SvelteKit](https://kit.svelte.dev/) - Framework
- [Svelte 5](https://svelte.dev/) - UI framework
- [ONS Svelte Components](https://github.com/ONSvisual/svelte-components/) - Visual components library
- [ONS Svelte Charts](https://github.com/ONSvisual/svelte-charts/) - Charting library
- [ONS Svelte Maps](https://github.com/ONSvisual/svelte-maps/) - Mapping library
- [Vite](https://vitejs.dev/) - Build tool

## License

MIT
