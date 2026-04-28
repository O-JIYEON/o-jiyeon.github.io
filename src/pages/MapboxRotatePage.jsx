import { useEffect, useRef, useState } from "react";
import MapboxControlPanel from "../components/MapboxControlPanel";
import MeasurePanel from "../components/MeasurePanel";
import {
  DEFAULT_BEARING,
  DEFAULT_CENTER,
  DEFAULT_GRID_OFFSET_Y,
  DEFAULT_GRID_ROTATION,
  DEFAULT_GRID_SIZE_METERS,
  DEFAULT_PITCH,
  DRAWING_SNAP_METERS,
  GRID_SOURCE_ID,
  MAPBOX_STYLE,
  MEASURE_FILL_LAYER_ID,
  MEASURE_LINE_LAYER_ID,
  RAW_MAPBOX_ACCESS_TOKEN,
} from "../features/mapbox/constants";
import {
  applyKoreanLabels,
  buildGridGeoJson,
  createEmptyFeatureCollection,
  ensureGridLayer,
  ensureMapboxGlCss,
  ensureMapboxGlScript,
  gridToWorldFrame,
  latLngToLocalMeters,
  localMetersToLatLng,
  normalizeMapboxToken,
  worldToGridFrame,
} from "../features/mapbox/gridUtils";
import {
  buildMeasurementFeatures,
  ensureMeasurementLayers,
  getDeltaMetersBetween,
  haversineDistanceMeters,
  MEASURE_MODES,
  offsetLatLng,
} from "../features/mapbox/measurementUtils";

export default function MapboxRotatePage({ onBack }) {
  const mapRootRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const rafRef = useRef(0);
  const measureIdRef = useRef(1);
  const measureRef = useRef({
    mode: MEASURE_MODES.none,
    points: [],
    previewPoint: null,
  });
  const circlesRef = useRef([]);
  const polygonsRef = useRef([]);
  const rectanglesRef = useRef([]);
  const dragStateRef = useRef(null);
  const dragSuppressUntilRef = useRef(0);
  const drawStateRef = useRef({
    gridWidth: DEFAULT_GRID_SIZE_METERS,
    gridHeight: DEFAULT_GRID_SIZE_METERS,
    gridVisible: true,
    rotationDeg: DEFAULT_GRID_ROTATION,
    offsetX: 0,
    offsetY: DEFAULT_GRID_OFFSET_Y,
    origin: { lat: DEFAULT_CENTER[1], lng: DEFAULT_CENTER[0] },
  });
  const mapboxAccessToken = normalizeMapboxToken(RAW_MAPBOX_ACCESS_TOKEN);

  const [gridVisible, setGridVisible] = useState(true);
  const [rotationDeg, setRotationDeg] = useState(DEFAULT_GRID_ROTATION);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(DEFAULT_GRID_OFFSET_Y);
  const [origin, setOrigin] = useState({ lat: DEFAULT_CENTER[1], lng: DEFAULT_CENTER[0] });
  const [bearing, setBearing] = useState(DEFAULT_BEARING);
  const [pitch, setPitch] = useState(DEFAULT_PITCH);
  const [zoom, setZoom] = useState("15.20");
  const [center, setCenter] = useState(`${DEFAULT_CENTER[1].toFixed(6)}, ${DEFAULT_CENTER[0].toFixed(6)}`);
  const [renderCount, setRenderCount] = useState(0);
  const [statusMessage, setStatusMessage] = useState("Mapbox GL JS 로딩 중");
  const [errorMessage, setErrorMessage] = useState("");
  const [measureMode, setMeasureMode] = useState(MEASURE_MODES.none);
  const [measureHint, setMeasureHint] = useState("");
  const [circleMeasures, setCircleMeasures] = useState([]);
  const [polygonMeasures, setPolygonMeasures] = useState([]);
  const [rectangleMeasures, setRectangleMeasures] = useState([]);
  const [selectedShape, setSelectedShape] = useState(null);

  useEffect(() => {
    measureRef.current.mode = measureMode;
    syncMeasurementOverlay();
  }, [measureMode]);

  useEffect(() => {
    circlesRef.current = circleMeasures;
    syncMeasurementOverlay();
    syncMeasurementSummary();
  }, [circleMeasures]);

  useEffect(() => {
    polygonsRef.current = polygonMeasures;
    syncMeasurementOverlay();
    syncMeasurementSummary();
  }, [polygonMeasures]);

  useEffect(() => {
    rectanglesRef.current = rectangleMeasures;
    syncMeasurementOverlay();
    syncMeasurementSummary();
  }, [rectangleMeasures]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return undefined;
    }

    const canvas = map.getCanvas();
    canvas.style.cursor = measureMode === MEASURE_MODES.none ? "" : "crosshair";

    if (measureMode === MEASURE_MODES.none) {
      map.doubleClickZoom.enable();
    } else {
      map.doubleClickZoom.disable();
    }

    return () => {
      canvas.style.cursor = "";
    };
  }, [measureMode]);

  useEffect(() => {
    drawStateRef.current = {
      gridWidth: DEFAULT_GRID_SIZE_METERS,
      gridHeight: DEFAULT_GRID_SIZE_METERS,
      gridVisible,
      rotationDeg,
      offsetX,
      offsetY,
      origin,
    };
    scheduleGridDraw();
  }, [gridVisible, rotationDeg, offsetX, offsetY, origin]);

  useEffect(() => {
    let cancelled = false;

    if (!mapboxAccessToken) {
      setStatusMessage("Mapbox 토큰이 없어 지도를 초기화하지 않음");
      setErrorMessage("`.env` 파일에 `VITE_MAPBOX_ACCESS_TOKEN=...` 값을 추가한 뒤 개발 서버를 다시 시작하세요.");
      return undefined;
    }

    ensureMapboxGlCss();
    ensureMapboxGlScript()
      .then((mapboxgl) => {
        if (cancelled || !mapRootRef.current) {
          return;
        }

        mapboxgl.accessToken = mapboxAccessToken;

        const map = new mapboxgl.Map({
          container: mapRootRef.current,
          style: MAPBOX_STYLE,
          center: DEFAULT_CENTER,
          zoom: 15.2,
          bearing: DEFAULT_BEARING,
          pitch: DEFAULT_PITCH,
          antialias: true,
        });

        map.addControl(new mapboxgl.NavigationControl({ visualizePitch: false }), "bottom-right");
        map.dragRotate.enable();
        map.touchZoomRotate.disableRotation();
        map.keyboard.enable();

        const marker = new mapboxgl.Marker({ color: "#9cf2bd" })
          .setLngLat(DEFAULT_CENTER)
          .setPopup(new mapboxgl.Popup({ offset: 18 }).setHTML("<strong>ECHOTECH</strong><br />Rotate-enabled Mapbox page"))
          .addTo(map);

        mapRef.current = map;
        markerRef.current = marker;

        const syncStatus = () => {
          const mapCenter = map.getCenter();
          setCenter(`${mapCenter.lat.toFixed(6)}, ${mapCenter.lng.toFixed(6)}`);
          setZoom(map.getZoom().toFixed(2));
          setBearing(Math.round(map.getBearing()));
          if (map.getPitch() !== DEFAULT_PITCH) {
            map.setPitch(DEFAULT_PITCH);
          }
          setPitch(DEFAULT_PITCH);
        };

        map.on("load", () => {
          if (cancelled) {
            return;
          }
          applyKoreanLabels(map);
          ensureGridLayer(map);
          ensureMeasurementLayers(map);
          setStatusMessage("지도 회전은 가능하고, 틸트는 0deg로 고정됩니다.");
          syncStatus();
          scheduleGridDraw();
          syncMeasurementOverlay();
        });

        map.on("styledata", () => {
          if (!cancelled) {
            applyKoreanLabels(map);
            if (map.isStyleLoaded()) {
              ensureGridLayer(map);
              ensureMeasurementLayers(map);
              scheduleGridDraw();
              syncMeasurementOverlay();
            }
          }
        });
        map.on("move", syncStatus);
        map.on("rotate", syncStatus);
        map.on("move", scheduleGridDraw);
        map.on("rotate", scheduleGridDraw);
        map.on("zoom", scheduleGridDraw);
        map.on("click", handleMeasureClick);
        map.on("mousemove", handleMeasureMouseMove);
        map.on("dblclick", handleMeasureDoubleClick);
        map.on("mousedown", MEASURE_FILL_LAYER_ID, handleMeasureDragStart);
        map.on("mousedown", MEASURE_LINE_LAYER_ID, handleMeasureDragStart);
        map.on("mousemove", handleMeasureDragMove);
        map.on("mouseup", handleMeasureDragEnd);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setErrorMessage(`Mapbox GL JS 초기화 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}`);
      });

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      markerRef.current?.remove();
      markerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [mapboxAccessToken]);

  function scheduleGridDraw() {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(drawGrid);
  }

  function syncMeasurementOverlay() {
    const map = mapRef.current;
    const measurementSource = map?.getSource("echotech-measure-source");
    if (!measurementSource) {
      return;
    }

    const { mode, points, previewPoint } = measureRef.current;
    const draftRectanglePoints =
      mode === MEASURE_MODES.rectangle && points[0] && (previewPoint ?? points[1])
        ? createScreenAlignedRectangle("draft-rectangle", points[0], previewPoint ?? points[1])?.points ?? null
        : null;
    measurementSource.setData(
      buildMeasurementFeatures(
        mode,
        points,
        previewPoint,
        circlesRef.current,
        polygonsRef.current,
        rectanglesRef.current,
        draftRectanglePoints,
      ),
    );
  }

  function createMeasureId(prefix) {
    const nextId = `${prefix}-${measureIdRef.current}`;
    measureIdRef.current += 1;
    return nextId;
  }

  function snapPointToMeter(point) {
    const { origin: snapOrigin, rotationDeg, offsetX, offsetY, gridWidth, gridHeight } = drawStateRef.current;
    const localPoint = latLngToLocalMeters(point.lat, point.lng, snapOrigin);
    const radians = (rotationDeg * Math.PI) / 180;
    const gridPoint = worldToGridFrame(localPoint.x - offsetX, localPoint.y - offsetY, radians);
    const snappedU = Math.round(gridPoint.u / Math.max(1, gridWidth)) * Math.max(1, gridWidth);
    const snappedV = Math.round(gridPoint.v / Math.max(1, gridHeight)) * Math.max(1, gridHeight);
    const snappedWorld = gridToWorldFrame(snappedU, snappedV, radians);
    return localMetersToLatLng(
      snappedWorld.x + offsetX,
      snappedWorld.y + offsetY,
      snapOrigin,
    );
  }

  function formatCoordinate(point) {
    return `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`;
  }

  function getSelectedCoordinateRows() {
    if (!selectedShape) {
      return [];
    }

    if (selectedShape.type === "circle") {
      const circle = circleMeasures.find((item) => item.id === selectedShape.id);
      if (!circle) {
        return [];
      }

      const rows = [{ label: "중심", value: formatCoordinate(circle.center) }];
      if (circle.edgePoint) {
        rows.push({ label: "경계", value: formatCoordinate(circle.edgePoint) });
      }
      return rows;
    }

    if (selectedShape.type === "polygon") {
      const polygon = polygonMeasures.find((item) => item.id === selectedShape.id);
      return polygon
        ? polygon.points.map((point, index) => ({
            label: `꼭짓점 ${index + 1}`,
            value: formatCoordinate(point),
          }))
        : [];
    }

    if (selectedShape.type === "rectangle") {
      const rectangle = rectangleMeasures.find((item) => item.id === selectedShape.id);
      return rectangle
        ? rectangle.points.map((point, index) => ({
            label: `꼭짓점 ${index + 1}`,
            value: formatCoordinate(point),
          }))
        : [];
    }

    return [];
  }

  function createScreenAlignedRectangle(id, start, end) {
    const map = mapRef.current;
    if (!map) {
      return null;
    }

    const startPixel = map.project([start.lng, start.lat]);
    const endPixel = map.project([end.lng, end.lat]);
    const corners = [
      startPixel,
      { x: endPixel.x, y: startPixel.y },
      endPixel,
      { x: startPixel.x, y: endPixel.y },
    ].map((point) => {
      const lngLat = map.unproject([point.x, point.y]);
      return {
        lat: lngLat.lat,
        lng: lngLat.lng,
      };
    });

    return {
      id,
      points: corners,
    };
  }

  function isNearFirstPoint(candidatePoint) {
    const map = mapRef.current;
    const firstPoint = measureRef.current.points[0];
    if (!map || !firstPoint) {
      return false;
    }

    const first = map.project([firstPoint.lng, firstPoint.lat]);
    const candidate = map.project([candidatePoint.lng, candidatePoint.lat]);
    return Math.hypot(first.x - candidate.x, first.y - candidate.y) <= 14;
  }

  function syncMeasurementSummary() {
    const { mode } = measureRef.current;

    if (mode === MEASURE_MODES.none) {
      setMeasureHint("");
      return;
    }

    if (mode === MEASURE_MODES.rectangle) {
      setMeasureHint("첫 클릭은 시작점, 두 번째 클릭은 대각선 반대편 점입니다.");
      return;
    }

    if (mode === MEASURE_MODES.polygon) {
      setMeasureHint("점을 찍고 시작점을 다시 누르면 다각형이 완성됩니다.");
      return;
    }

    if (mode === MEASURE_MODES.circle) {
      setMeasureHint("첫 클릭은 중심, 두 번째 클릭은 원의 크기를 결정합니다.");
    }
  }

  function clearMeasurement({ keepMode = true, clearCompleted = false } = {}) {
    measureRef.current = {
      mode: keepMode ? measureRef.current.mode : MEASURE_MODES.none,
      points: [],
      previewPoint: null,
    };
    if (clearCompleted) {
      circlesRef.current = [];
      polygonsRef.current = [];
      rectanglesRef.current = [];
      setCircleMeasures([]);
      setPolygonMeasures([]);
      setRectangleMeasures([]);
      setSelectedShape(null);
    }
    if (!keepMode) {
      setMeasureMode(MEASURE_MODES.none);
    }
    syncMeasurementOverlay();
    syncMeasurementSummary();
  }

  function activateMeasureMode(nextMode) {
    if (nextMode === measureRef.current.mode) {
      clearMeasurement({ keepMode: false });
      return;
    }

    measureRef.current = {
      mode: nextMode,
      points: [],
      previewPoint: null,
    };
    setMeasureMode(nextMode);
    syncMeasurementOverlay();
    syncMeasurementSummary();
  }

  function finishMeasurement() {
    const { mode, points } = measureRef.current;
    if (mode === MEASURE_MODES.none) {
      return;
    }

    if (mode === MEASURE_MODES.polygon && points.length >= 3) {
      const nextPolygon = { id: createMeasureId("polygon"), points: [...points] };
      const nextPolygons = [...polygonsRef.current, nextPolygon];
      polygonsRef.current = nextPolygons;
      setPolygonMeasures(nextPolygons);
      setSelectedShape({ type: "polygon", id: nextPolygon.id });
      measureRef.current = { mode, points: [], previewPoint: null };
      syncMeasurementOverlay();
      syncMeasurementSummary();
      return;
    }

    if (mode === MEASURE_MODES.rectangle && points.length >= 2) {
      const nextRectangle = createScreenAlignedRectangle(createMeasureId("rectangle"), points[0], points[1]);
      if (!nextRectangle) {
        return;
      }
      const nextRectangles = [...rectanglesRef.current, nextRectangle];
      rectanglesRef.current = nextRectangles;
      setRectangleMeasures(nextRectangles);
      setSelectedShape({ type: "rectangle", id: nextRectangle.id });
      measureRef.current = { mode, points: [], previewPoint: null };
      syncMeasurementOverlay();
      syncMeasurementSummary();
      return;
    }

    measureRef.current = { mode, points, previewPoint: null };
    syncMeasurementOverlay();
    syncMeasurementSummary();
  }

  function handleMeasureClick(event) {
    if (dragStateRef.current || Date.now() < dragSuppressUntilRef.current) {
      return;
    }

    const { mode, points } = measureRef.current;
    if (mode === MEASURE_MODES.none) {
      return;
    }

    const clickedPoint = snapPointToMeter({ lat: event.lngLat.lat, lng: event.lngLat.lng });

    if (mode === MEASURE_MODES.circle) {
      if (points.length === 0) {
        measureRef.current = { mode, points: [clickedPoint], previewPoint: clickedPoint };
      } else {
        const radiusMeters = haversineDistanceMeters(points[0], clickedPoint);
        const nextCircle = {
          id: createMeasureId("circle"),
          center: points[0],
          edgePoint: clickedPoint,
          radiusMeters,
        };
        const nextCircles = [...circlesRef.current, nextCircle];
        circlesRef.current = nextCircles;
        setCircleMeasures(nextCircles);
        setSelectedShape({ type: "circle", id: nextCircle.id });
        measureRef.current = { mode, points: [], previewPoint: null };
      }
    } else if (mode === MEASURE_MODES.rectangle) {
      if (points.length === 0) {
        measureRef.current = { mode, points: [clickedPoint], previewPoint: clickedPoint };
      } else {
        const nextRectangle = createScreenAlignedRectangle(createMeasureId("rectangle"), points[0], clickedPoint);
        if (!nextRectangle) {
          return;
        }
        const nextRectangles = [...rectanglesRef.current, nextRectangle];
        rectanglesRef.current = nextRectangles;
        setRectangleMeasures(nextRectangles);
        setSelectedShape({ type: "rectangle", id: nextRectangle.id });
        measureRef.current = { mode, points: [], previewPoint: null };
      }
    } else if (mode === MEASURE_MODES.polygon) {
      if (points.length >= 3 && isNearFirstPoint(clickedPoint)) {
        const nextPolygon = { id: createMeasureId("polygon"), points: [...points] };
        const nextPolygons = [...polygonsRef.current, nextPolygon];
        polygonsRef.current = nextPolygons;
        setPolygonMeasures(nextPolygons);
        setSelectedShape({ type: "polygon", id: nextPolygon.id });
        measureRef.current = { mode, points: [], previewPoint: null };
      } else {
        measureRef.current = { mode, points: [...points, clickedPoint], previewPoint: null };
      }
    } else {
      measureRef.current = { mode, points: [...points, clickedPoint], previewPoint: null };
    }

    syncMeasurementOverlay();
    syncMeasurementSummary();
  }

  function handleMeasureMouseMove(event) {
    const { mode, points } = measureRef.current;
    if (dragStateRef.current || mode === MEASURE_MODES.none || points.length === 0) {
      return;
    }

    measureRef.current = {
      mode,
      points,
      previewPoint: snapPointToMeter({ lat: event.lngLat.lat, lng: event.lngLat.lng }),
    };
    syncMeasurementOverlay();
    syncMeasurementSummary();
  }

  function handleMeasureDoubleClick(event) {
    const { mode, points } = measureRef.current;
    if (mode === MEASURE_MODES.none) {
      return;
    }

    event.preventDefault();

    if ((mode === MEASURE_MODES.rectangle || mode === MEASURE_MODES.polygon) && points.length >= 2) {
      measureRef.current = { mode, points, previewPoint: null };
      syncMeasurementOverlay();
      syncMeasurementSummary();
    }
  }

  function translateCircle(circle, dx, dy) {
    const nextCenter = snapPointToMeter(offsetLatLng(circle.center, dx, dy));
    const nextEdgePoint = circle.edgePoint
      ? snapPointToMeter(offsetLatLng(circle.edgePoint, dx, dy))
      : undefined;
    return {
      ...circle,
      center: nextCenter,
      edgePoint: nextEdgePoint,
      radiusMeters:
        nextCenter && nextEdgePoint ? haversineDistanceMeters(nextCenter, nextEdgePoint) : circle.radiusMeters,
    };
  }

  function translatePolygon(polygon, dx, dy) {
    return {
      ...polygon,
      points: polygon.points.map((point) => snapPointToMeter(offsetLatLng(point, dx, dy))),
    };
  }

  function translateRectangle(rectangle, dx, dy) {
    return {
      ...rectangle,
      points: rectangle.points.map((point) => snapPointToMeter(offsetLatLng(point, dx, dy))),
    };
  }

  function handleMeasureDragStart(event) {
    const feature = event.features?.[0];
    if (!feature?.properties?.draggable) {
      return;
    }

    dragStateRef.current = {
      measureId: feature.properties.measureId,
      shapeType: feature.properties.shapeType,
      lastPoint: { lat: event.lngLat.lat, lng: event.lngLat.lng },
      moved: false,
    };
    setSelectedShape({ type: feature.properties.shapeType, id: feature.properties.measureId });

    mapRef.current?.dragPan.disable();
    const canvas = mapRef.current?.getCanvas();
    if (canvas) {
      canvas.style.cursor = "grabbing";
    }
  }

  function handleMeasureDragMove(event) {
    const dragState = dragStateRef.current;
    if (!dragState) {
      return;
    }

    const currentPoint = { lat: event.lngLat.lat, lng: event.lngLat.lng };
    const { dx, dy } = getDeltaMetersBetween(dragState.lastPoint, currentPoint);
    dragStateRef.current = { ...dragState, lastPoint: currentPoint, moved: true };

    if (dragState.shapeType === "circle") {
      const nextCircles = circlesRef.current.map((circle) =>
        circle.id === dragState.measureId ? translateCircle(circle, dx, dy) : circle,
      );
      circlesRef.current = nextCircles;
      setCircleMeasures(nextCircles);
      return;
    }

    if (dragState.shapeType === "polygon") {
      const nextPolygons = polygonsRef.current.map((polygon) =>
        polygon.id === dragState.measureId ? translatePolygon(polygon, dx, dy) : polygon,
      );
      polygonsRef.current = nextPolygons;
      setPolygonMeasures(nextPolygons);
      return;
    }

    if (dragState.shapeType === "rectangle") {
      const nextRectangles = rectanglesRef.current.map((rectangle) =>
        rectangle.id === dragState.measureId ? translateRectangle(rectangle, dx, dy) : rectangle,
      );
      rectanglesRef.current = nextRectangles;
      setRectangleMeasures(nextRectangles);
    }
  }

  function handleMeasureDragEnd() {
    if (!dragStateRef.current) {
      return;
    }

    const didMove = dragStateRef.current.moved;
    dragStateRef.current = null;
    if (didMove) {
      dragSuppressUntilRef.current = Date.now() + 150;
    }
    const map = mapRef.current;
    if (!map) {
      return;
    }

    map.dragPan.enable();
    map.getCanvas().style.cursor = measureMode === MEASURE_MODES.none ? "" : "crosshair";
  }

  function drawGrid() {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded() || !map.getSource(GRID_SOURCE_ID)) {
      return;
    }

    const {
      gridWidth: currentGridWidth,
      gridHeight: currentGridHeight,
      gridVisible: currentGridVisible,
      rotationDeg: currentRotationDeg,
      offsetX: currentOffsetX,
      offsetY: currentOffsetY,
      origin: currentOrigin,
    } = drawStateRef.current;

    const gridSource = map.getSource(GRID_SOURCE_ID);
    if (!gridSource) {
      return;
    }

    if (!currentGridVisible) {
      gridSource.setData(createEmptyFeatureCollection());
      setRenderCount(0);
      return;
    }

    const canvas = map.getCanvas();
    const corners = [
      map.unproject([0, 0]),
      map.unproject([canvas.width, 0]),
      map.unproject([canvas.width, canvas.height]),
      map.unproject([0, canvas.height]),
    ].map((point) => ({ lat: point.lat, lng: point.lng }));

    const { data, lineCount, skipped } = buildGridGeoJson({
      corners,
      origin: currentOrigin,
      gridWidth: currentGridWidth,
      gridHeight: currentGridHeight,
      rotationDeg: currentRotationDeg,
      offsetX: currentOffsetX,
      offsetY: currentOffsetY,
    });

    gridSource.setData(data);
    setRenderCount(lineCount);

    if (skipped) {
      setStatusMessage("현재 확대 수준에서는 격자 선 수가 너무 많아 일부 렌더링을 생략했습니다.");
    }
  }

  function resetCamera() {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    map.easeTo({
      center: DEFAULT_CENTER,
      zoom: 15.2,
      bearing: DEFAULT_BEARING,
      pitch: DEFAULT_PITCH,
      duration: 900,
    });
  }

  function setOriginToCenter() {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const mapCenter = map.getCenter();
    setOrigin({ lat: mapCenter.lat, lng: mapCenter.lng });
  }

  function resetGridOffset() {
    setOffsetX(0);
    setOffsetY(DEFAULT_GRID_OFFSET_Y);
  }

  function spinCamera(delta) {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    map.easeTo({
      bearing: map.getBearing() + delta,
      duration: 500,
    });
  }

  function setMapBearing(nextBearing) {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    map.easeTo({
      bearing: nextBearing,
      duration: 0,
    });
  }

  return (
    <div className="app-shell">
      <MapboxControlPanel
        onBack={onBack}
        gridVisible={gridVisible}
        setGridVisible={setGridVisible}
        rotationDeg={rotationDeg}
        setRotationDeg={setRotationDeg}
        offsetX={offsetX}
        setOffsetX={setOffsetX}
        offsetY={offsetY}
        setOffsetY={setOffsetY}
        bearing={bearing}
        setMapBearing={setMapBearing}
        spinCamera={spinCamera}
        setOriginToCenter={setOriginToCenter}
        resetGridOffset={resetGridOffset}
        resetCamera={resetCamera}
        center={center}
        origin={origin}
        zoom={zoom}
        pitch={pitch}
        renderCount={renderCount}
        statusMessage={statusMessage}
      />

      <MeasurePanel
        measureMode={measureMode}
        activateMeasureMode={activateMeasureMode}
        finishMeasurement={finishMeasurement}
        clearMeasurement={clearMeasurement}
        measureHint={measureHint}
        selectedCoordinateRows={getSelectedCoordinateRows()}
      />

      <main ref={mapRootRef} className="map-root map-root--mapbox" aria-label="Mapbox 지도" />

      {errorMessage ? <div className="error-banner">{errorMessage}</div> : null}
    </div>
  );
}
