import {
  MEASURE_FILL_LAYER_ID,
  MEASURE_LABEL_LAYER_ID,
  MEASURE_LINE_LAYER_ID,
  MEASURE_MODES,
  MEASURE_POINT_LAYER_ID,
  MEASURE_SOURCE_ID,
} from "./constants";
import {
  createEmptyFeatureCollection,
  latLngToLocalMeters,
  localMetersToLatLng,
  metersToLatitudeDegrees,
  metersToLongitudeDegrees,
} from "./gridUtils";

const METERS_PER_DEGREE_LAT = 111320;
const EARTH_RADIUS_METERS = 6371008.8;

export { MEASURE_MODES };

export function haversineDistanceMeters(a, b) {
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const deltaLat = ((b.lat - a.lat) * Math.PI) / 180;
  const deltaLng = ((b.lng - a.lng) * Math.PI) / 180;
  const sinLat = Math.sin(deltaLat / 2);
  const sinLng = Math.sin(deltaLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function polygonAreaSquareMeters(points) {
  if (points.length < 3) {
    return 0;
  }

  const origin = points[0];
  const localPoints = points.map((point) => latLngToLocalMeters(point.lat, point.lng, origin));
  let area = 0;

  for (let index = 0; index < localPoints.length; index += 1) {
    const current = localPoints[index];
    const next = localPoints[(index + 1) % localPoints.length];
    area += current.x * next.y - next.x * current.y;
  }

  return Math.abs(area) / 2;
}

export function formatMeters(value) {
  if (!Number.isFinite(value)) {
    return "-";
  }

  if (value >= 1000) {
    return `${(value / 1000).toFixed(2)} km`;
  }

  return `${value.toFixed(1)} m`;
}

export function formatSquareMeters(value) {
  if (!Number.isFinite(value)) {
    return "-";
  }

  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(2)} km2`;
  }

  return `${value.toFixed(1)} m2`;
}

export function createCircleCoordinates(center, radiusMeters, steps = 64) {
  if (!center || !Number.isFinite(radiusMeters) || radiusMeters <= 0) {
    return [];
  }

  const coordinates = [];
  for (let index = 0; index <= steps; index += 1) {
    const angle = (index / steps) * Math.PI * 2;
    const dx = Math.cos(angle) * radiusMeters;
    const dy = Math.sin(angle) * radiusMeters;
    const point = localMetersToLatLng(dx, dy, center);
    coordinates.push([point.lng, point.lat]);
  }

  return coordinates;
}

export function offsetLatLng(point, deltaXMeters, deltaYMeters) {
  return {
    lat: point.lat + metersToLatitudeDegrees(deltaYMeters),
    lng: point.lng + metersToLongitudeDegrees(deltaXMeters, point.lat),
  };
}

function createRectanglePoints(start, end) {
  return [
    { lat: start.lat, lng: start.lng },
    { lat: start.lat, lng: end.lng },
    { lat: end.lat, lng: end.lng },
    { lat: end.lat, lng: start.lng },
  ];
}

export function getDeltaMetersBetween(a, b) {
  const averageLatitude = (a.lat + b.lat) / 2;
  return {
    dx: (b.lng - a.lng) * METERS_PER_DEGREE_LAT * Math.max(Math.cos((averageLatitude * Math.PI) / 180), 0.000001),
    dy: (b.lat - a.lat) * METERS_PER_DEGREE_LAT,
  };
}

function getPolygonCentroid(points) {
  if (points.length === 0) {
    return null;
  }

  if (points.length < 3) {
    return points[0];
  }

  const origin = points[0];
  const localPoints = points.map((point) => latLngToLocalMeters(point.lat, point.lng, origin));
  let areaFactor = 0;
  let centroidX = 0;
  let centroidY = 0;

  for (let index = 0; index < localPoints.length; index += 1) {
    const current = localPoints[index];
    const next = localPoints[(index + 1) % localPoints.length];
    const cross = current.x * next.y - next.x * current.y;
    areaFactor += cross;
    centroidX += (current.x + next.x) * cross;
    centroidY += (current.y + next.y) * cross;
  }

  if (Math.abs(areaFactor) < 0.000001) {
    return points[0];
  }

  return localMetersToLatLng(centroidX / (3 * areaFactor), centroidY / (3 * areaFactor), origin);
}

function getMidpoint(a, b) {
  return {
    lat: (a.lat + b.lat) / 2,
    lng: (a.lng + b.lng) / 2,
  };
}

function createLabelFeature(point, label, measureId, shapeType) {
  return {
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: [point.lng, point.lat],
    },
    properties: {
      role: "label",
      label,
      measureId,
      shapeType,
    },
  };
}

export function buildMeasurementFeatures(
  mode,
  points,
  previewPoint,
  circles,
  polygons,
  rectangles,
  draftRectanglePoints = null,
) {
  const features = [];

  circles.forEach((circle) => {
    const circleCoordinates = createCircleCoordinates(circle.center, circle.radiusMeters);
    if (circleCoordinates.length === 0) {
      return;
    }

    features.push({
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [circleCoordinates],
      },
      properties: {
        role: "radius-fill",
        draggable: true,
        measureId: circle.id,
        shapeType: "circle",
      },
    });
    features.push({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: circleCoordinates,
      },
      properties: {
        role: "radius-outline",
        draggable: true,
        measureId: circle.id,
        shapeType: "circle",
      },
    });
    features.push(
      createLabelFeature(
        circle.center,
        formatSquareMeters(Math.PI * circle.radiusMeters * circle.radiusMeters),
        circle.id,
        "circle",
      ),
    );
  });

  polygons.forEach((polygon) => {
    const closedCoordinates = [...polygon.points, polygon.points[0]].map((point) => [point.lng, point.lat]);
    features.push({
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [closedCoordinates],
      },
      properties: {
        role: "area-fill",
        draggable: true,
        measureId: polygon.id,
        shapeType: "polygon",
      },
    });
    features.push({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: closedCoordinates,
      },
      properties: {
        role: "area-outline",
        draggable: true,
        measureId: polygon.id,
        shapeType: "polygon",
      },
    });
    const centroid = getPolygonCentroid(polygon.points);
    if (centroid) {
      features.push(createLabelFeature(centroid, formatSquareMeters(polygonAreaSquareMeters(polygon.points)), polygon.id, "polygon"));
    }
  });

  rectangles.forEach((rectangle) => {
    const closedCoordinates = [...rectangle.points, rectangle.points[0]].map((point) => [point.lng, point.lat]);
    features.push({
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [closedCoordinates],
      },
      properties: {
        role: "rectangle-fill",
        draggable: true,
        measureId: rectangle.id,
        shapeType: "rectangle",
      },
    });
    features.push(
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: closedCoordinates,
        },
        properties: {
          role: "rectangle-outline",
          draggable: true,
          measureId: rectangle.id,
          shapeType: "rectangle",
        },
      },
    );
    const centroid = getPolygonCentroid(rectangle.points);
    if (centroid) {
      features.push(
        createLabelFeature(
          centroid,
          formatSquareMeters(polygonAreaSquareMeters(rectangle.points)),
          rectangle.id,
          "rectangle",
        ),
      );
    }
  });

  points.forEach((point, index) => {
    features.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [point.lng, point.lat],
      },
      properties: {
        role: "anchor",
        index,
      },
    });
  });

  if (previewPoint && mode !== MEASURE_MODES.none) {
    features.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [previewPoint.lng, previewPoint.lat],
      },
      properties: {
        role: "preview",
      },
    });
  }

  if (mode === MEASURE_MODES.rectangle && points[0]) {
    const rectanglePoints = draftRectanglePoints ?? (previewPoint ?? points[1] ? createRectanglePoints(points[0], previewPoint ?? points[1]) : null);
    if (rectanglePoints) {
      features.push({
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [[...rectanglePoints, rectanglePoints[0]].map((point) => [point.lng, point.lat])],
        },
        properties: {
          role: "rectangle-fill",
        },
      });
      features.push({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [...rectanglePoints, rectanglePoints[0]].map((point) => [point.lng, point.lat]),
        },
        properties: {
          role: "rectangle-outline",
        },
      });
    }
  }

  if (mode === MEASURE_MODES.polygon) {
    const polygonPoints = previewPoint ? [...points, previewPoint] : points;
    if (polygonPoints.length >= 2) {
      features.push({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [...polygonPoints, polygonPoints[0]].map((point) => [point.lng, point.lat]),
        },
        properties: {
          role: "area-outline",
        },
      });
    }
    if (polygonPoints.length >= 3) {
      features.push({
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [[...polygonPoints, polygonPoints[0]].map((point) => [point.lng, point.lat])],
        },
        properties: {
          role: "area-fill",
        },
      });
    }
  }

  if (mode === MEASURE_MODES.circle && points[0]) {
    const edgePoint = previewPoint ?? points[1];
    if (edgePoint) {
      const radiusMeters = haversineDistanceMeters(points[0], edgePoint);
      const circleCoordinates = createCircleCoordinates(points[0], radiusMeters);

      features.push({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [points[0].lng, points[0].lat],
            [edgePoint.lng, edgePoint.lat],
          ],
        },
        properties: {
          role: "radius-line",
        },
      });

      if (circleCoordinates.length > 0) {
        features.push({
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [circleCoordinates],
          },
          properties: {
            role: "radius-fill",
          },
        });
        features.push({
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: circleCoordinates,
          },
          properties: {
            role: "radius-outline",
          },
        });
      }
    }
  }

  return {
    type: "FeatureCollection",
    features,
  };
}

export function ensureMeasurementLayers(map) {
  if (!map.getSource(MEASURE_SOURCE_ID)) {
    map.addSource(MEASURE_SOURCE_ID, {
      type: "geojson",
      data: createEmptyFeatureCollection(),
    });
  }

  if (!map.getLayer(MEASURE_FILL_LAYER_ID)) {
    map.addLayer({
      id: MEASURE_FILL_LAYER_ID,
      type: "fill",
      source: MEASURE_SOURCE_ID,
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: {
        "fill-color": "#ffd56a",
        "fill-opacity": 0.18,
      },
    });
  }

  if (!map.getLayer(MEASURE_LINE_LAYER_ID)) {
    map.addLayer({
      id: MEASURE_LINE_LAYER_ID,
      type: "line",
      source: MEASURE_SOURCE_ID,
      filter: ["==", ["geometry-type"], "LineString"],
      paint: {
        "line-color": "#ffd56a",
        "line-width": 3,
      },
    });
  }

  if (!map.getLayer(MEASURE_POINT_LAYER_ID)) {
    map.addLayer({
      id: MEASURE_POINT_LAYER_ID,
      type: "circle",
      source: MEASURE_SOURCE_ID,
      filter: ["all", ["==", ["geometry-type"], "Point"], ["!=", ["get", "role"], "label"]],
      paint: {
        "circle-radius": 5,
        "circle-color": "#132026",
        "circle-stroke-width": 2,
        "circle-stroke-color": "#90f0b7",
      },
    });
  }

  if (!map.getLayer(MEASURE_LABEL_LAYER_ID)) {
    map.addLayer({
      id: MEASURE_LABEL_LAYER_ID,
      type: "symbol",
      source: MEASURE_SOURCE_ID,
      filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "role"], "label"]],
      layout: {
        "text-field": ["get", "label"],
        "text-size": 12,
        "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
        "text-anchor": "center",
        "text-allow-overlap": true,
      },
      paint: {
        "text-color": "#fff4d0",
        "text-halo-color": "rgba(19, 32, 38, 0.92)",
        "text-halo-width": 1.4,
      },
    });
  }
}

export function getMeasureModeLabel(mode) {
  if (mode === MEASURE_MODES.circle) {
    return "원";
  }
  if (mode === MEASURE_MODES.polygon) {
    return "다각형";
  }
  if (mode === MEASURE_MODES.rectangle) {
    return "사각형";
  }
  return "없음";
}

export function createRectangleFromDiagonal(id, start, end) {
  return {
    id,
    points: createRectanglePoints(start, end),
  };
}
