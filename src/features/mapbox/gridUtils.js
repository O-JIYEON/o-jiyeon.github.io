import {
  DEFAULT_GRID_OFFSET_Y,
  DEFAULT_GRID_ROTATION,
  DEFAULT_GRID_SIZE_METERS,
  GRID_LAYER_ID,
  GRID_SOURCE_ID,
  KOREAN_LABEL_FIELD,
  MAPBOX_GL_CSS_ID,
  MAPBOX_GL_SCRIPT_ID,
  MAX_GRID_RENDER_LINES,
} from "./constants";

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
    gridWidth: DEFAULT_GRID_SIZE_METERS,
    gridHeight: DEFAULT_GRID_SIZE_METERS,
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

export function worldToGridFrame(x, y, radians) {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    u: x * cos + y * sin,
    v: -x * sin + y * cos,
  };
}

export function gridToWorldFrame(u, v, radians) {
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

function buildLineFeature(startCoord, endCoord) {
  return {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: [
        [startCoord.lng, startCoord.lat],
        [endCoord.lng, endCoord.lat],
      ],
    },
    properties: {},
  };
}

function buildClosedBoundaryFeature(coordinates) {
  return {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: [...coordinates, coordinates[0]],
    },
    properties: {
      role: "boundary",
    },
  };
}

function convertGridPointToLatLng(u, v, radians, offsetX, offsetY, origin) {
  const worldPoint = gridToWorldFrame(u, v, radians);
  worldPoint.x += offsetX;
  worldPoint.y += offsetY;
  return localMetersToLatLng(worldPoint.x, worldPoint.y, origin);
}

function pushBoundaryFeatures(features, minU, maxU, minV, maxV, radians, offsetX, offsetY, origin) {
  const topLeft = convertGridPointToLatLng(minU, maxV, radians, offsetX, offsetY, origin);
  const topRight = convertGridPointToLatLng(maxU, maxV, radians, offsetX, offsetY, origin);
  const bottomRight = convertGridPointToLatLng(maxU, minV, radians, offsetX, offsetY, origin);
  const bottomLeft = convertGridPointToLatLng(minU, minV, radians, offsetX, offsetY, origin);

  features.push(buildLineFeature(topLeft, topRight));
  features.push(buildLineFeature(topRight, bottomRight));
  features.push(buildLineFeature(bottomRight, bottomLeft));
  features.push(buildLineFeature(bottomLeft, topLeft));
}

function buildOrderedBoundaryPolygonFromUvBounds(minU, maxU, minV, maxV, radians, offsetX, offsetY, origin) {
  const topLeft = convertGridPointToLatLng(minU, maxV, radians, offsetX, offsetY, origin);
  const topRight = convertGridPointToLatLng(maxU, maxV, radians, offsetX, offsetY, origin);
  const bottomRight = convertGridPointToLatLng(maxU, minV, radians, offsetX, offsetY, origin);
  const bottomLeft = convertGridPointToLatLng(minU, minV, radians, offsetX, offsetY, origin);

  return [
    [topLeft.lng, topLeft.lat],
    [topRight.lng, topRight.lat],
    [bottomRight.lng, bottomRight.lat],
    [bottomLeft.lng, bottomLeft.lat],
  ];
}

function normalizePolygonOrder(polygon, origin, radians, offsetX, offsetY) {
  if (!Array.isArray(polygon) || polygon.length < 4) {
    return null;
  }

  const points = polygon
    .filter((point) => Array.isArray(point) && point.length === 2)
    .map(([lng, lat]) => {
      const local = latLngToLocalMeters(lat, lng, origin);
      const uv = worldToGridFrame(local.x - offsetX, local.y - offsetY, radians);
      return { raw: [lng, lat], u: uv.u, v: uv.v };
    });

  if (points.length < 4) {
    return null;
  }

  const sortedByTop = [...points].sort((a, b) => b.v - a.v);
  const topPoints = sortedByTop.slice(0, 2).sort((a, b) => a.u - b.u);
  const bottomPoints = sortedByTop.slice(-2).sort((a, b) => a.u - b.u);

  return [topPoints[0].raw, topPoints[1].raw, bottomPoints[1].raw, bottomPoints[0].raw];
}

function normalizeVector(vector) {
  const length = Math.hypot(vector.x, vector.y);
  if (!length) {
    return { x: 0, y: 0 };
  }

  return {
    x: vector.x / length,
    y: vector.y / length,
  };
}

function dotProduct(a, b) {
  return a.x * b.x + a.y * b.y;
}

function scaleVector(vector, scalar) {
  return {
    x: vector.x * scalar,
    y: vector.y * scalar,
  };
}

function addVector(point, vector) {
  return {
    x: point.x + vector.x,
    y: point.y + vector.y,
  };
}

function buildOrderedMaskGridFeatures(features, polygon, origin, gridWidth, gridHeight) {
  if (!Array.isArray(polygon) || polygon.length < 4) {
    return false;
  }

  const [topLeftRaw, topRightRaw, bottomRightRaw, bottomLeftRaw] = polygon;
  const requiredPoints = [topLeftRaw, topRightRaw, bottomRightRaw, bottomLeftRaw];
  if (requiredPoints.some((point) => !Array.isArray(point) || point.length !== 2)) {
    return false;
  }

  const topLeft = latLngToLocalMeters(topLeftRaw[1], topLeftRaw[0], origin);
  const topRight = latLngToLocalMeters(topRightRaw[1], topRightRaw[0], origin);
  const bottomRight = latLngToLocalMeters(bottomRightRaw[1], bottomRightRaw[0], origin);
  const bottomLeft = latLngToLocalMeters(bottomLeftRaw[1], bottomLeftRaw[0], origin);

  const topDirection = normalizeVector({ x: topRight.x - topLeft.x, y: topRight.y - topLeft.y });
  const downDirection = normalizeVector({ x: bottomLeft.x - topLeft.x, y: bottomLeft.y - topLeft.y });

  const usableWidth = Math.max(
    0,
    dotProduct(
      {
        x: topRight.x - topLeft.x,
        y: topRight.y - topLeft.y,
      },
      topDirection,
    ),
  );
  const usableHeight = Math.max(
    0,
    dotProduct(
      {
        x: bottomLeft.x - topLeft.x,
        y: bottomLeft.y - topLeft.y,
      },
      downDirection,
    ),
  );
  const epsilon = 0.0001;
  const snappedWidth = Math.ceil(Math.max(0, usableWidth - epsilon) / gridWidth) * gridWidth;
  const snappedHeight = Math.ceil(Math.max(0, usableHeight - epsilon) / gridHeight) * gridHeight;
  const snappedTopLeft = topLeft;
  const snappedTopRight = addVector(topLeft, scaleVector(topDirection, snappedWidth));
  const snappedBottomLeft = addVector(topLeft, scaleVector(downDirection, snappedHeight));
  const snappedBottomRight = addVector(snappedBottomLeft, scaleVector(topDirection, snappedWidth));
  const snappedBoundary = [
    localMetersToLatLng(snappedTopLeft.x, snappedTopLeft.y, origin),
    localMetersToLatLng(snappedTopRight.x, snappedTopRight.y, origin),
    localMetersToLatLng(snappedBottomRight.x, snappedBottomRight.y, origin),
    localMetersToLatLng(snappedBottomLeft.x, snappedBottomLeft.y, origin),
  ];

  features.push(buildClosedBoundaryFeature(snappedBoundary.map((point) => [point.lng, point.lat])));
  features.push(buildLineFeature(snappedBoundary[0], snappedBoundary[1]));
  features.push(buildLineFeature(snappedBoundary[1], snappedBoundary[2]));
  features.push(buildLineFeature(snappedBoundary[2], snappedBoundary[3]));
  features.push(buildLineFeature(snappedBoundary[3], snappedBoundary[0]));

  for (let offset = gridWidth; offset < snappedWidth - epsilon; offset += gridWidth) {
    const start = {
      x: topLeft.x + topDirection.x * offset,
      y: topLeft.y + topDirection.y * offset,
    };
    const end = {
      x: start.x + downDirection.x * snappedHeight,
      y: start.y + downDirection.y * snappedHeight,
    };
    const startCoord = localMetersToLatLng(start.x, start.y, origin);
    const endCoord = localMetersToLatLng(end.x, end.y, origin);
    features.push(buildLineFeature(startCoord, endCoord));
  }

  for (let offset = gridHeight; offset < snappedHeight - epsilon; offset += gridHeight) {
    const start = {
      x: topLeft.x + downDirection.x * offset,
      y: topLeft.y + downDirection.y * offset,
    };
    const end = {
      x: start.x + topDirection.x * snappedWidth,
      y: start.y + topDirection.y * snappedWidth,
    };
    const startCoord = localMetersToLatLng(start.x, start.y, origin);
    const endCoord = localMetersToLatLng(end.x, end.y, origin);
    features.push(buildLineFeature(startCoord, endCoord));
  }

  return true;
}

export function buildGridGeoJson({
  corners,
  origin,
  gridWidth,
  gridHeight,
  rotationDeg,
  offsetX = 0,
  offsetY = 0,
  maskPolygons = [],
}) {
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
  let minU = Math.min(...uValues) - margin;
  let maxU = Math.max(...uValues) + margin;
  let minV = Math.min(...vValues) - margin;
  let maxV = Math.max(...vValues) + margin;

  const maskUvPoints = maskPolygons.flatMap((polygon) =>
    polygon
      .filter((coordinate) => Array.isArray(coordinate) && coordinate.length === 2)
      .map(([lng, lat]) => {
        const local = latLngToLocalMeters(lat, lng, origin);
        return worldToGridFrame(local.x - safeOffsetX, local.y - safeOffsetY, radians);
      }),
  );

  if (maskUvPoints.length >= 4) {
    minU = Math.min(...maskUvPoints.map((point) => point.u));
    maxU = Math.max(...maskUvPoints.map((point) => point.u));
    minV = Math.min(...maskUvPoints.map((point) => point.v));
    maxV = Math.max(...maskUvPoints.map((point) => point.v));
  }

  const firstU = Math.floor(minU / safeGridWidth) * safeGridWidth;
  const firstV = Math.floor(minV / safeGridHeight) * safeGridHeight;

  const uLineCount = Math.floor((maxU + safeGridWidth - firstU) / safeGridWidth) + 1;
  const vLineCount = Math.floor((maxV + safeGridHeight - firstV) / safeGridHeight) + 1;
  const estimatedLineCount = uLineCount + vLineCount;

  if (estimatedLineCount > MAX_GRID_RENDER_LINES) {
    return { data: createEmptyFeatureCollection(), lineCount: estimatedLineCount, skipped: true };
  }

  const features = [];
  const hasMaskBounds = maskUvPoints.length >= 4;

  if (hasMaskBounds) {
    const boundaryPolygon =
      maskPolygons.length === 1
        ? maskPolygons[0]
        : buildOrderedBoundaryPolygonFromUvBounds(minU, maxU, minV, maxV, radians, safeOffsetX, safeOffsetY, origin);

    if (buildOrderedMaskGridFeatures(features, boundaryPolygon, origin, safeGridWidth, safeGridHeight)) {
      return {
        data: {
          type: "FeatureCollection",
          features,
        },
        lineCount: features.length,
        skipped: false,
      };
    }

    return { data: createEmptyFeatureCollection(), lineCount: 0, skipped: false };
  }

  const lineOverdraw = Math.hypot(safeGridWidth, safeGridHeight) * 3;

  for (let u = firstU; u <= maxU + safeGridWidth; u += safeGridWidth) {
    const aCoord = convertGridPointToLatLng(u, minV - lineOverdraw, radians, safeOffsetX, safeOffsetY, origin);
    const bCoord = convertGridPointToLatLng(u, maxV + lineOverdraw, radians, safeOffsetX, safeOffsetY, origin);
    features.push(buildLineFeature(aCoord, bCoord));
  }

  for (let v = firstV; v <= maxV + safeGridHeight; v += safeGridHeight) {
    const aCoord = convertGridPointToLatLng(minU - lineOverdraw, v, radians, safeOffsetX, safeOffsetY, origin);
    const bCoord = convertGridPointToLatLng(maxU + lineOverdraw, v, radians, safeOffsetX, safeOffsetY, origin);
    features.push(buildLineFeature(aCoord, bCoord));
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
