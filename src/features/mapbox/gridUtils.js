import { DEFAULT_GRID_OFFSET_Y, DEFAULT_GRID_ROTATION, GRID_LAYER_ID, GRID_SOURCE_ID, KOREAN_LABEL_FIELD, MAPBOX_GL_CSS_ID, MAPBOX_GL_SCRIPT_ID, MAX_GRID_RENDER_LINES } from "./constants";

const METERS_PER_DEGREE_LAT = 111320;

export function normalizeMapboxToken(value) {
  if (!value) {
    return "";
  }

  const trimmed = String(value).trim().replace(/^['"]|['"]$/g, "");
  const prefixed = trimmed.match(/VITE_MAPBOX_ACCESS_TOKEN\s*=\s*(.+)$/);
  return (prefixed ? prefixed[1] : trimmed).trim();
}

export function getDefaultDrawState() {
  return {
    gridWidth: 50,
    gridHeight: 50,
    gridVisible: true,
    rotationDeg: DEFAULT_GRID_ROTATION,
    offsetX: 0,
    offsetY: DEFAULT_GRID_OFFSET_Y,
    origin: { lat: 34.900905, lng: 127.592328 },
  };
}

export function metersToLatitudeDegrees(meters) {
  return meters / METERS_PER_DEGREE_LAT;
}

export function metersToLongitudeDegrees(meters, latitude) {
  const cosLat = Math.max(Math.cos((latitude * Math.PI) / 180), 0.000001);
  return meters / (METERS_PER_DEGREE_LAT * cosLat);
}

export function latLngToLocalMeters(lat, lng, origin) {
  const metersPerDegreeLng =
    METERS_PER_DEGREE_LAT * Math.max(Math.cos((origin.lat * Math.PI) / 180), 0.000001);
  return {
    x: (lng - origin.lng) * metersPerDegreeLng,
    y: (lat - origin.lat) * METERS_PER_DEGREE_LAT,
  };
}

export function localMetersToLatLng(x, y, origin) {
  return {
    lat: origin.lat + metersToLatitudeDegrees(y),
    lng: origin.lng + metersToLongitudeDegrees(x, origin.lat),
  };
}

function worldToGridFrame(x, y, radians) {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    u: x * cos + y * sin,
    v: -x * sin + y * cos,
  };
}

function gridToWorldFrame(u, v, radians) {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: u * cos - v * sin,
    y: u * sin + v * cos,
  };
}

export function ensureMapboxGlCss() {
  if (document.getElementById(MAPBOX_GL_CSS_ID)) {
    return;
  }

  const link = document.createElement("link");
  link.id = MAPBOX_GL_CSS_ID;
  link.rel = "stylesheet";
  link.href = "https://api.mapbox.com/mapbox-gl-js/v3.12.0/mapbox-gl.css";
  document.head.appendChild(link);
}

export function ensureMapboxGlScript() {
  if (window.mapboxgl?.Map) {
    return Promise.resolve(window.mapboxgl);
  }

  if (window.__mapboxGlPromise) {
    return window.__mapboxGlPromise;
  }

  window.__mapboxGlPromise = new Promise((resolve, reject) => {
    const existingScript = document.getElementById(MAPBOX_GL_SCRIPT_ID);
    if (existingScript) {
      existingScript.addEventListener("load", () => resolve(window.mapboxgl), { once: true });
      existingScript.addEventListener("error", () => reject(new Error("Mapbox GL JS load failed")), {
        once: true,
      });
      return;
    }

    const script = document.createElement("script");
    script.id = MAPBOX_GL_SCRIPT_ID;
    script.src = "https://api.mapbox.com/mapbox-gl-js/v3.12.0/mapbox-gl.js";
    script.async = true;
    script.onload = () => resolve(window.mapboxgl);
    script.onerror = () => reject(new Error("Mapbox GL JS load failed"));
    document.head.appendChild(script);
  });

  return window.__mapboxGlPromise;
}

export function applyKoreanLabels(map) {
  const style = map.getStyle();
  const layers = style?.layers ?? [];

  layers.forEach((layer) => {
    if (layer.type !== "symbol") {
      return;
    }

    const textField = map.getLayoutProperty(layer.id, "text-field");
    if (!textField) {
      return;
    }

    try {
      map.setLayoutProperty(layer.id, "text-field", KOREAN_LABEL_FIELD);
    } catch {
      // Some generated symbol layers may reject runtime changes. Ignore and continue.
    }
  });
}

export function createEmptyFeatureCollection() {
  return {
    type: "FeatureCollection",
    features: [],
  };
}

export function ensureGridLayer(map) {
  if (!map.getSource(GRID_SOURCE_ID)) {
    map.addSource(GRID_SOURCE_ID, {
      type: "geojson",
      data: createEmptyFeatureCollection(),
    });
  }

  if (!map.getLayer(GRID_LAYER_ID)) {
    map.addLayer({
      id: GRID_LAYER_ID,
      type: "line",
      source: GRID_SOURCE_ID,
      paint: {
        "line-color": "rgba(77, 240, 222, 0.58)",
        "line-width": 1.4,
      },
    });
  }
}

export function buildGridGeoJson({ corners, origin, gridWidth, gridHeight, rotationDeg, offsetX = 0, offsetY = 0 }) {
  const safeGridWidth = Math.max(5, Number(gridWidth) || 50);
  const safeGridHeight = Math.max(5, Number(gridHeight) || 50);
  const radians = (rotationDeg * Math.PI) / 180;
  const safeOffsetX = Number(offsetX) || 0;
  const safeOffsetY = Number(offsetY) || 0;

  const uvCorners = corners.map((coord) => {
    const local = latLngToLocalMeters(coord.lat, coord.lng, origin);
    return worldToGridFrame(local.x - safeOffsetX, local.y - safeOffsetY, radians);
  });

  const uValues = uvCorners.map((point) => point.u);
  const vValues = uvCorners.map((point) => point.v);
  const margin = Math.hypot(safeGridWidth, safeGridHeight) * 2;
  const minU = Math.min(...uValues) - margin;
  const maxU = Math.max(...uValues) + margin;
  const minV = Math.min(...vValues) - margin;
  const maxV = Math.max(...vValues) + margin;
  const firstU = Math.floor(minU / safeGridWidth) * safeGridWidth;
  const firstV = Math.floor(minV / safeGridHeight) * safeGridHeight;

  const uLineCount = Math.floor((maxU + safeGridWidth - firstU) / safeGridWidth) + 1;
  const vLineCount = Math.floor((maxV + safeGridHeight - firstV) / safeGridHeight) + 1;
  const estimatedLineCount = uLineCount + vLineCount;

  if (estimatedLineCount > MAX_GRID_RENDER_LINES) {
    return { data: createEmptyFeatureCollection(), lineCount: estimatedLineCount, skipped: true };
  }

  const lineOverdraw = Math.hypot(safeGridWidth, safeGridHeight) * 3;
  const features = [];

  for (let u = firstU; u <= maxU + safeGridWidth; u += safeGridWidth) {
    const a = gridToWorldFrame(u, minV - lineOverdraw, radians);
    const b = gridToWorldFrame(u, maxV + lineOverdraw, radians);
    a.x += safeOffsetX;
    a.y += safeOffsetY;
    b.x += safeOffsetX;
    b.y += safeOffsetY;
    const aCoord = localMetersToLatLng(a.x, a.y, origin);
    const bCoord = localMetersToLatLng(b.x, b.y, origin);
    features.push({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [aCoord.lng, aCoord.lat],
          [bCoord.lng, bCoord.lat],
        ],
      },
      properties: {},
    });
  }

  for (let v = firstV; v <= maxV + safeGridHeight; v += safeGridHeight) {
    const a = gridToWorldFrame(minU - lineOverdraw, v, radians);
    const b = gridToWorldFrame(maxU + lineOverdraw, v, radians);
    a.x += safeOffsetX;
    a.y += safeOffsetY;
    b.x += safeOffsetX;
    b.y += safeOffsetY;
    const aCoord = localMetersToLatLng(a.x, a.y, origin);
    const bCoord = localMetersToLatLng(b.x, b.y, origin);
    features.push({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [aCoord.lng, aCoord.lat],
          [bCoord.lng, bCoord.lat],
        ],
      },
      properties: {},
    });
  }

  return {
    data: {
      type: "FeatureCollection",
      features,
    },
    lineCount: features.length,
    skipped: false,
  };
}
