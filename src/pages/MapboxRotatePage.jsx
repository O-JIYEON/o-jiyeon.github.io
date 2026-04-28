import { useEffect, useRef, useState } from "react";
import MapboxControlPanel from "../components/MapboxControlPanel";
import MeasurePanel from "../components/MeasurePanel";
import {
  DEFAULT_BEARING,
  DEFAULT_CENTER,
  DEFAULT_GRID_OFFSET_Y,
  DEFAULT_GRID_ROTATION,
  DEFAULT_PITCH,
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
  normalizeMapboxToken,
} from "../features/mapbox/gridUtils";
import {
  buildMeasurementFeatures,
  ensureMeasurementLayers,
  formatMeters,
  formatSquareMeters,
  getDeltaMetersBetween,
  haversineDistanceMeters,
  MEASURE_MODES,
  offsetLatLng,
  polygonAreaSquareMeters,
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
  const distancesRef = useRef([]);
  const dragStateRef = useRef(null);
  const dragSuppressUntilRef = useRef(0);
  const drawStateRef = useRef({
    gridWidth: 50,
    gridHeight: 50,
    gridVisible: true,
    rotationDeg: DEFAULT_GRID_ROTATION,
    offsetX: 0,
    offsetY: DEFAULT_GRID_OFFSET_Y,
    origin: { lat: DEFAULT_CENTER[1], lng: DEFAULT_CENTER[0] },
  });
  const mapboxAccessToken = normalizeMapboxToken(RAW_MAPBOX_ACCESS_TOKEN);

  const [gridWidth, setGridWidth] = useState(50);
  const [gridHeight, setGridHeight] = useState(50);
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
  const [measureValue, setMeasureValue] = useState("-");
  const [measureSecondaryValue, setMeasureSecondaryValue] = useState("-");
  const [measureHint, setMeasureHint] = useState("측정 없음");
  const [circleMeasures, setCircleMeasures] = useState([]);
  const [polygonMeasures, setPolygonMeasures] = useState([]);
  const [distanceMeasures, setDistanceMeasures] = useState([]);

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
    distancesRef.current = distanceMeasures;
    syncMeasurementOverlay();
    syncMeasurementSummary();
  }, [distanceMeasures]);

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
      gridWidth,
      gridHeight,
      gridVisible,
      rotationDeg,
      offsetX,
      offsetY,
      origin,
    };
    scheduleGridDraw();
  }, [gridWidth, gridHeight, gridVisible, rotationDeg, offsetX, offsetY, origin]);

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
    measurementSource.setData(
      buildMeasurementFeatures(
        mode,
        points,
        previewPoint,
        circlesRef.current,
        polygonsRef.current,
        distancesRef.current,
      ),
    );
  }

  function createMeasureId(prefix) {
    const nextId = `${prefix}-${measureIdRef.current}`;
    measureIdRef.current += 1;
    return nextId;
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
    const { mode, points, previewPoint } = measureRef.current;

    if (mode === MEASURE_MODES.none) {
      setMeasureValue("-");
      setMeasureSecondaryValue(`원 ${circleMeasures.length}개 / 면적 ${polygonMeasures.length}개 / 거리 ${distanceMeasures.length}개`);
      setMeasureHint("측정 없음");
      return;
    }

    if (mode === MEASURE_MODES.distance) {
      const startPoint = points[0];
      const endPoint = previewPoint ?? points[1];
      const distanceMeters = startPoint && endPoint ? haversineDistanceMeters(startPoint, endPoint) : 0;
      setMeasureValue(formatMeters(distanceMeters));
      setMeasureSecondaryValue(`거리 ${distanceMeasures.length}개`);
      setMeasureHint("첫 클릭은 시작점, 두 번째 클릭은 종료점");
      return;
    }

    if (mode === MEASURE_MODES.area) {
      const activePoints = previewPoint ? [...points, previewPoint] : points;
      setMeasureValue(formatSquareMeters(polygonAreaSquareMeters(activePoints)));
      setMeasureSecondaryValue(`도형 ${polygonMeasures.length}개 / ${points.length} 포인트`);
      setMeasureHint("점을 찍고 시작점을 다시 누르면 폴리곤 완성");
      return;
    }

    if (mode === MEASURE_MODES.radius) {
      const centerPoint = points[0];
      const edgePoint = previewPoint ?? points[1];
      const radiusMeters = centerPoint && edgePoint ? haversineDistanceMeters(centerPoint, edgePoint) : 0;
      setMeasureValue(formatMeters(radiusMeters));
      setMeasureSecondaryValue(`원 ${circleMeasures.length}개 / ${formatSquareMeters(Math.PI * radiusMeters * radiusMeters)}`);
      setMeasureHint("첫 클릭은 중심, 두 번째 클릭은 반경 종료점");
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
      distancesRef.current = [];
      setCircleMeasures([]);
      setPolygonMeasures([]);
      setDistanceMeasures([]);
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

    if (mode === MEASURE_MODES.area && points.length >= 3) {
      const nextPolygon = { id: createMeasureId("polygon"), points: [...points] };
      const nextPolygons = [...polygonsRef.current, nextPolygon];
      polygonsRef.current = nextPolygons;
      setPolygonMeasures(nextPolygons);
      measureRef.current = { mode, points: [], previewPoint: null };
      syncMeasurementOverlay();
      syncMeasurementSummary();
      return;
    }

    if (mode === MEASURE_MODES.distance && points.length >= 2) {
      const nextDistance = { id: createMeasureId("distance"), start: points[0], end: points[1] };
      const nextDistances = [...distancesRef.current, nextDistance];
      distancesRef.current = nextDistances;
      setDistanceMeasures(nextDistances);
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

    const clickedPoint = { lat: event.lngLat.lat, lng: event.lngLat.lng };

    if (mode === MEASURE_MODES.radius) {
      if (points.length === 0) {
        measureRef.current = { mode, points: [clickedPoint], previewPoint: clickedPoint };
      } else {
        const radiusMeters = haversineDistanceMeters(points[0], clickedPoint);
        const nextCircle = { id: createMeasureId("circle"), center: points[0], radiusMeters };
        const nextCircles = [...circlesRef.current, nextCircle];
        circlesRef.current = nextCircles;
        setCircleMeasures(nextCircles);
        measureRef.current = { mode, points: [], previewPoint: null };
      }
    } else if (mode === MEASURE_MODES.distance) {
      if (points.length === 0) {
        measureRef.current = { mode, points: [clickedPoint], previewPoint: clickedPoint };
      } else {
        const nextDistance = { id: createMeasureId("distance"), start: points[0], end: clickedPoint };
        const nextDistances = [...distancesRef.current, nextDistance];
        distancesRef.current = nextDistances;
        setDistanceMeasures(nextDistances);
        measureRef.current = { mode, points: [], previewPoint: null };
      }
    } else if (mode === MEASURE_MODES.area) {
      if (points.length >= 3 && isNearFirstPoint(clickedPoint)) {
        const nextPolygon = { id: createMeasureId("polygon"), points: [...points] };
        const nextPolygons = [...polygonsRef.current, nextPolygon];
        polygonsRef.current = nextPolygons;
        setPolygonMeasures(nextPolygons);
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
      previewPoint: { lat: event.lngLat.lat, lng: event.lngLat.lng },
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

    if ((mode === MEASURE_MODES.distance || mode === MEASURE_MODES.area) && points.length >= 2) {
      measureRef.current = { mode, points, previewPoint: null };
      syncMeasurementOverlay();
      syncMeasurementSummary();
    }
  }

  function translateCircle(circle, dx, dy) {
    return {
      ...circle,
      center: offsetLatLng(circle.center, dx, dy),
    };
  }

  function translatePolygon(polygon, dx, dy) {
    return {
      ...polygon,
      points: polygon.points.map((point) => offsetLatLng(point, dx, dy)),
    };
  }

  function translateDistance(distance, dx, dy) {
    return {
      ...distance,
      start: offsetLatLng(distance.start, dx, dy),
      end: offsetLatLng(distance.end, dx, dy),
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

    if (dragState.shapeType === "distance") {
      const nextDistances = distancesRef.current.map((distance) =>
        distance.id === dragState.measureId ? translateDistance(distance, dx, dy) : distance,
      );
      distancesRef.current = nextDistances;
      setDistanceMeasures(nextDistances);
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
        gridWidth={gridWidth}
        setGridWidth={setGridWidth}
        gridHeight={gridHeight}
        setGridHeight={setGridHeight}
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
        measureValue={measureValue}
        measureSecondaryValue={measureSecondaryValue}
        measureHint={measureHint}
      />

      <main ref={mapRootRef} className="map-root map-root--mapbox" aria-label="Mapbox 지도" />

      {errorMessage ? <div className="error-banner">{errorMessage}</div> : null}
    </div>
  );
}
