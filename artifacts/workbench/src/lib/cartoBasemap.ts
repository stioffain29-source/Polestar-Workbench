const cartoBasemapKey = import.meta.env.VITE_CARTO_BASEMAP_KEY?.trim();

if (!cartoBasemapKey) {
  throw new Error(
    "VITE_CARTO_BASEMAP_KEY is required to load the CARTO Positron basemap.",
  );
}

export const CARTO_POSITRON_TILE_URL =
  `https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(cartoBasemapKey)}`;

export const CARTO_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

export const CARTO_ATTRIBUTION_TEXT =
  "Leaflet | (c) OpenStreetMap | (c) CARTO";

export const CARTO_SUBDOMAINS = ["a", "b", "c", "d"];