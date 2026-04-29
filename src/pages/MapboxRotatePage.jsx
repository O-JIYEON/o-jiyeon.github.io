import { useEffect, useRef, useState } from "react";
import MapboxControlPanel from "../components/MapboxControlPanel";
import MeasurePanel from "../components/MeasurePanel";
import defaultBlockPatternUrl from "../assets/block-default.png";
import {
  BLOCK_COLOR_PALETTE,
  DEFAULT_BEARING,
  DEFAULT_BLOCK_COLOR,
  DEFAULT_CENTER,
  DEFAULT_GRID_OFFSET_Y,
  DEFAULT_GRID_ROTATION,
  DEFAULT_MAPBOX_STYLE,
  DEFAULT_GRID_SIZE_METERS,
  DEFAULT_PITCH,
  DRAWING_SNAP_METERS,
  GRID_SOURCE_ID,
  MAPBOX_STYLES,
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
  formatMeters,
  formatSquareMeters,
  getCircleAreaSquareMeters,
  getCircleDimensions,
  haversineDistanceMeters,
  MEASURE_MODES,
  offsetLatLng,
  polygonAreaSquareMeters,
} from "../features/mapbox/measurementUtils";

export default function MapboxRotatePage({ onBack }) {
  const mapRootRef = useRef(null);
  const mapRef = useRef(null);
  const mapboxGlRef = useRef(null);
  const markerRef = useRef(null);
  const overlayNameMarkersRef = useRef([]);
  const blockImageMarkersRef = useRef([]);
  const blockRotateHandleRef = useRef(null);
  const measurePanelRef = useRef(null);
  const rafRef = useRef(0);
  const measureIdRef = useRef(1);
  const measureNameRef = useRef({
    polygon: 1,
    block: 1,
  });
  const measureRef = useRef({
    mode: MEASURE_MODES.none,
    points: [],
    previewPoint: null,
  });
  const circlesRef = useRef([]);
  const polygonsRef = useRef([]);
  const rectanglesRef = useRef([]);
  const dragStateRef = useRef(null);
  const rotateStateRef = useRef(null);
  const dragSuppressUntilRef = useRef(0);
  const draftBlockColorRef = useRef(DEFAULT_BLOCK_COLOR);
  const defaultBlockImageSrcRef = useRef(defaultBlockPatternUrl);
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
  const [mapStyle, setMapStyle] = useState(DEFAULT_MAPBOX_STYLE);
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
  const [parcelVisible, setParcelVisible] = useState(true);
  const [blockVisible, setBlockVisible] = useState(true);
  const [defaultBlockImageSrc, setDefaultBlockImageSrc] = useState(defaultBlockPatternUrl);
  const [draftBlockColor, setDraftBlockColor] = useState(DEFAULT_BLOCK_COLOR);
  const mapStyleOptions = Object.entries(MAPBOX_STYLES).map(([value, option]) => ({
    value,
    label: option.label,
  }));

  useEffect(() => {
    measureRef.current.mode = measureMode;
    syncMeasurementOverlay();
  }, [measureMode]);

  useEffect(() => {
    circlesRef.current = circleMeasures;
    syncMeasurementOverlay();
    syncOverlayNameMarkers();
    syncMeasurementSummary();
  }, [circleMeasures]);

  useEffect(() => {
    polygonsRef.current = polygonMeasures;
    syncMeasurementOverlay();
    syncOverlayNameMarkers();
    syncMeasurementSummary();
  }, [polygonMeasures]);

  useEffect(() => {
    rectanglesRef.current = rectangleMeasures;
    syncMeasurementOverlay();
    syncOverlayNameMarkers();
    syncBlockImageMarkers();
    syncBlockRotateHandle();
    syncMeasurementSummary();
  }, [rectangleMeasures]);

  useEffect(() => {
    syncMeasurementOverlay();
    syncBlockImageMarkers();
    syncBlockRotateHandle();
  }, [selectedShape]);

  useEffect(() => {
    draftBlockColorRef.current = draftBlockColor;
  }, [draftBlockColor]);

  useEffect(() => {
    defaultBlockImageSrcRef.current = defaultBlockImageSrc;
  }, [defaultBlockImageSrc]);

  useEffect(() => {
    syncMeasurementOverlay();
    syncOverlayNameMarkers();
    syncBlockImageMarkers();
    syncBlockRotateHandle();
  }, [parcelVisible, blockVisible]);

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
    const map = mapRef.current;
    const styleUrl = MAPBOX_STYLES[mapStyle]?.url;
    if (!map || !styleUrl) {
      return;
    }

    setStatusMessage(`지도 타입 변경 중: ${MAPBOX_STYLES[mapStyle].label}`);
    map.setStyle(styleUrl);
  }, [mapStyle]);

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
        mapboxGlRef.current = mapboxgl;

        const map = new mapboxgl.Map({
          container: mapRootRef.current,
          style: MAPBOX_STYLES[DEFAULT_MAPBOX_STYLE].url,
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
          syncOverlayNameMarkers();
          syncBlockImageMarkers();
          syncBlockRotateHandle();
        });

        map.on("styledata", () => {
          if (!cancelled) {
            applyKoreanLabels(map);
            if (map.isStyleLoaded()) {
              ensureGridLayer(map);
              ensureMeasurementLayers(map);
              scheduleGridDraw();
              syncMeasurementOverlay();
              syncOverlayNameMarkers();
              syncBlockImageMarkers();
              syncBlockRotateHandle();
            }
          }
        });
        map.on("move", syncStatus);
        map.on("rotate", syncStatus);
        map.on("move", scheduleGridDraw);
        map.on("rotate", scheduleGridDraw);
        map.on("zoom", scheduleGridDraw);
        map.on("move", syncBlockImageMarkers);
        map.on("rotate", syncBlockImageMarkers);
        map.on("zoom", syncBlockImageMarkers);
        map.on("move", syncBlockRotateHandle);
        map.on("rotate", syncBlockRotateHandle);
        map.on("zoom", syncBlockRotateHandle);
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
      overlayNameMarkersRef.current.forEach((marker) => marker.remove());
      overlayNameMarkersRef.current = [];
      blockImageMarkersRef.current.forEach((marker) => marker.remove());
      blockImageMarkersRef.current = [];
      blockRotateHandleRef.current?.remove();
      blockRotateHandleRef.current = null;
      markerRef.current?.remove();
      markerRef.current = null;
      mapboxGlRef.current = null;
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
      (mode === MEASURE_MODES.rectangle || mode === MEASURE_MODES.imageBlock) && points[0] && (previewPoint ?? points[1])
        ? createScreenAlignedRectangle("draft-rectangle", points[0], previewPoint ?? points[1])?.points ?? null
        : null;
    measurementSource.setData(
      buildMeasurementFeatures(
        mode,
        points,
        previewPoint,
        blockVisible ? circlesRef.current : [],
        parcelVisible ? polygonsRef.current : [],
        blockVisible ? rectanglesRef.current : [],
        selectedShape,
        draftRectanglePoints,
      ),
    );
  }

  function syncOverlayNameMarkers() {
    const map = mapRef.current;
    const mapboxgl = mapboxGlRef.current;
    if (!map || !mapboxgl) {
      return;
    }

    overlayNameMarkersRef.current.forEach((marker) => marker.remove());
    overlayNameMarkersRef.current = [];

    const nextMarkers = [];

    if (parcelVisible) {
      polygonsRef.current.forEach((polygon) => {
        const centerPoint = getPointsBoundsCenter(polygon.points);
        if (!centerPoint || !polygon.name) {
          return;
        }

        const element = document.createElement("div");
        element.className = "overlay-name-marker overlay-name-marker--parcel";
        element.textContent = polygon.name;
        nextMarkers.push(new mapboxgl.Marker({ element, anchor: "center" }).setLngLat([centerPoint.lng, centerPoint.lat]).addTo(map));
      });
    }

    if (blockVisible) {
      circlesRef.current.forEach((circle) => {
        if (!circle.center || !circle.name) {
          return;
        }

        const element = document.createElement("div");
        element.className = "overlay-name-marker overlay-name-marker--block";
        element.textContent = circle.name;
        nextMarkers.push(new mapboxgl.Marker({ element, anchor: "center" }).setLngLat([circle.center.lng, circle.center.lat]).addTo(map));
      });

      rectanglesRef.current.forEach((rectangle) => {
        const centerPoint = getAveragePoint(rectangle.points);
        if (!centerPoint || !rectangle.name) {
          return;
        }

        const element = document.createElement("div");
        element.className = "overlay-name-marker overlay-name-marker--block";
        element.textContent = rectangle.name;
        nextMarkers.push(new mapboxgl.Marker({ element, anchor: "center" }).setLngLat([centerPoint.lng, centerPoint.lat]).addTo(map));
      });
    }

    overlayNameMarkersRef.current = nextMarkers;
  }

  function syncBlockImageMarkers() {
    const map = mapRef.current;
    const mapboxgl = mapboxGlRef.current;
    if (!map || !mapboxgl) {
      return;
    }

    blockImageMarkersRef.current.forEach((marker) => marker.remove());
    blockImageMarkersRef.current = [];

    if (!blockVisible) {
      return;
    }

    const nextMarkers = rectanglesRef.current
      .filter((rectangle) => rectangle.imageSrc && rectangle.points?.length >= 4)
      .map((rectangle) => {
        const projected = rectangle.points.map((point) => map.project([point.lng, point.lat]));
        const topLeft = projected[0];
        const topRight = projected[1];
        const bottomLeft = projected[3];
        const width = Math.max(16, Math.hypot(topRight.x - topLeft.x, topRight.y - topLeft.y));
        const height = Math.max(16, Math.hypot(bottomLeft.x - topLeft.x, bottomLeft.y - topLeft.y));
        const rotation = Math.atan2(topRight.y - topLeft.y, topRight.x - topLeft.x);
        const centerPoint = getAveragePoint(rectangle.points);

        if (!centerPoint) {
          return null;
        }

        const wrapper = document.createElement("div");
        wrapper.className = `block-image-marker ${selectedShape?.type === "rectangle" && selectedShape.id === rectangle.id ? "is-selected" : ""}`;

        const frame = document.createElement("div");
        frame.className = "block-image-marker__frame";
        frame.style.width = `${width}px`;
        frame.style.height = `${height}px`;
        frame.style.transform = `translate(-50%, -50%) rotate(${rotation}rad)`;

        const image = document.createElement("img");
        image.className = "block-image-marker__image";
        image.src = rectangle.imageSrc;
        image.alt = rectangle.name ?? "블록 이미지";
        image.draggable = false;
        frame.appendChild(image);
        wrapper.appendChild(frame);

        return new mapboxgl.Marker({ element: wrapper, anchor: "center" }).setLngLat([centerPoint.lng, centerPoint.lat]).addTo(map);
      })
      .filter(Boolean);

    blockImageMarkersRef.current = nextMarkers;
  }

  function syncBlockRotateHandle() {
    const map = mapRef.current;
    const mapboxgl = mapboxGlRef.current;

    blockRotateHandleRef.current?.remove();
    blockRotateHandleRef.current = null;

    if (!map || !mapboxgl || !blockVisible || selectedShape?.type !== "rectangle") {
      return;
    }

    const rectangle = rectanglesRef.current.find((item) => item.id === selectedShape.id);
    if (!rectangle || rectangle.points.length < 4) {
      return;
    }

    const projected = rectangle.points.map((point) => map.project([point.lng, point.lat]));
    const topLeft = projected[0];
    const topRight = projected[1];
    const centerProjected = {
      x: (projected[0].x + projected[2].x) / 2,
      y: (projected[0].y + projected[2].y) / 2,
    };
    const topMid = {
      x: (topLeft.x + topRight.x) / 2,
      y: (topLeft.y + topRight.y) / 2,
    };
    const direction = {
      x: topMid.x - centerProjected.x,
      y: topMid.y - centerProjected.y,
    };
    const length = Math.max(1, Math.hypot(direction.x, direction.y));
    const handlePixel = {
      x: topMid.x + (direction.x / length) * 28,
      y: topMid.y + (direction.y / length) * 28,
    };
    const handleLngLat = map.unproject([handlePixel.x, handlePixel.y]);

    const element = document.createElement("button");
    element.type = "button";
    element.className = "block-rotate-handle";
    element.setAttribute("aria-label", "블록 회전");
    element.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      startRectangleRotation(rectangle, { x: event.clientX, y: event.clientY });
    });

    blockRotateHandleRef.current = new mapboxgl.Marker({ element, anchor: "center" })
      .setLngLat([handleLngLat.lng, handleLngLat.lat])
      .addTo(map);
  }

  function createMeasureId(prefix) {
    const nextId = `${prefix}-${measureIdRef.current}`;
    measureIdRef.current += 1;
    return nextId;
  }

  function createMeasureName(kind) {
    const nextIndex = measureNameRef.current[kind];
    measureNameRef.current[kind] += 1;

    if (kind === "polygon") {
      return `g${String(nextIndex).padStart(3, "0")}`;
    }

    return `blk${String(nextIndex).padStart(3, "0")}`;
  }

  function snapPointToMeter(point) {
    const { origin: snapOrigin, rotationDeg, offsetX, offsetY } = drawStateRef.current;
    const localPoint = latLngToLocalMeters(point.lat, point.lng, snapOrigin);
    const radians = (rotationDeg * Math.PI) / 180;
    const gridPoint = worldToGridFrame(localPoint.x - offsetX, localPoint.y - offsetY, radians);
    const snappedU =
      Math.round(gridPoint.u / Math.max(1, DRAWING_SNAP_METERS)) * Math.max(1, DRAWING_SNAP_METERS);
    const snappedV =
      Math.round(gridPoint.v / Math.max(1, DRAWING_SNAP_METERS)) * Math.max(1, DRAWING_SNAP_METERS);
    const snappedWorld = gridToWorldFrame(snappedU, snappedV, radians);
    return localMetersToLatLng(
      snappedWorld.x + offsetX,
      snappedWorld.y + offsetY,
      snapOrigin,
    );
  }

  function getSnappedGridDelta(fromPoint, toPoint) {
    const { origin: snapOrigin, rotationDeg } = drawStateRef.current;
    const radians = (rotationDeg * Math.PI) / 180;
    const fromLocal = latLngToLocalMeters(fromPoint.lat, fromPoint.lng, snapOrigin);
    const toLocal = latLngToLocalMeters(toPoint.lat, toPoint.lng, snapOrigin);
    const fromGrid = worldToGridFrame(fromLocal.x, fromLocal.y, radians);
    const toGrid = worldToGridFrame(toLocal.x, toLocal.y, radians);
    const deltaU = toGrid.u - fromGrid.u;
    const deltaV = toGrid.v - fromGrid.v;
    const snappedU =
      Math.round(deltaU / Math.max(1, DRAWING_SNAP_METERS)) * Math.max(1, DRAWING_SNAP_METERS);
    const snappedV =
      Math.round(deltaV / Math.max(1, DRAWING_SNAP_METERS)) * Math.max(1, DRAWING_SNAP_METERS);
    return gridToWorldFrame(snappedU, snappedV, radians);
  }

  function getRectangleSize(rectangle) {
    if (!rectangle || rectangle.points.length < 4) {
      return { width: 0, height: 0 };
    }

    return {
      width: haversineDistanceMeters(rectangle.points[0], rectangle.points[1]),
      height: haversineDistanceMeters(rectangle.points[1], rectangle.points[2]),
    };
  }

  function rotatePointAroundOrigin(localPoint, radians) {
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return {
      x: localPoint.x * cos - localPoint.y * sin,
      y: localPoint.x * sin + localPoint.y * cos,
    };
  }

  function getPolygonSize(points) {
    if (!points || points.length < 3) {
      return { width: 0, height: 0 };
    }

    const originPoint = points[0];
    const localPoints = points.map((point) => latLngToLocalMeters(point.lat, point.lng, originPoint));
    const xs = localPoints.map((point) => point.x);
    const ys = localPoints.map((point) => point.y);

    return {
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    };
  }

  function scaleVector(vector, targetLength) {
    const currentLength = Math.hypot(vector.x, vector.y);
    if (currentLength < 0.000001) {
      return { x: 0, y: 0 };
    }
    const scale = targetLength / currentLength;
    return {
      x: vector.x * scale,
      y: vector.y * scale,
    };
  }

  function getOverlayItems() {
    const circleItems = circleMeasures.map((circle) => ({
      id: circle.id,
      type: "circle",
      title: circle.name ?? circle.id,
      color: circle.color ?? DEFAULT_BLOCK_COLOR,
      diameter: Math.round(getCircleDimensions(circle).widthMeters),
      area: Math.round(getCircleAreaSquareMeters(circle)),
      description: `지름 ${formatMeters(getCircleDimensions(circle).widthMeters)}, 면적 ${formatSquareMeters(
        getCircleAreaSquareMeters(circle),
      )}`,
    }));

    const rectangleItems = rectangleMeasures.map((rectangle) => {
      const size = getRectangleSize(rectangle);
      return {
        id: rectangle.id,
        type: "rectangle",
        title: rectangle.name ?? rectangle.id,
        color: rectangle.color ?? DEFAULT_BLOCK_COLOR,
        imageSrc: rectangle.imageSrc ?? "",
        width: Math.round(size.width),
        height: Math.round(size.height),
        area: Math.round(polygonAreaSquareMeters(rectangle.points)),
        description: `${formatMeters(size.width)} x ${formatMeters(size.height)}, 면적 ${formatSquareMeters(
          polygonAreaSquareMeters(rectangle.points),
        )}`,
      };
    });

    const polygonItems = polygonMeasures.map((polygon) => {
      const size = getPolygonSize(polygon.points);
      return {
        id: polygon.id,
        type: "polygon",
        title: polygon.name ?? polygon.id,
        width: Math.round(size.width),
        height: Math.round(size.height),
        area: Math.round(polygonAreaSquareMeters(polygon.points)),
        description: `${formatMeters(size.width)} x ${formatMeters(size.height)}, 면적 ${formatSquareMeters(
          polygonAreaSquareMeters(polygon.points),
        )}`,
      };
    });

    return [...rectangleItems, ...circleItems, ...polygonItems];
  }

  function getParcelItems() {
    return getOverlayItems().filter((item) => item.type === "polygon");
  }

  function getBlockItems() {
    return getOverlayItems().filter((item) => item.type === "rectangle" || item.type === "circle");
  }

  function getSelectedOverlayLabel() {
    if (!selectedShape) {
      return "";
    }

    if (selectedShape.type === "polygon") {
      return polygonMeasures.find((item) => item.id === selectedShape.id)?.name ?? "";
    }

    if (selectedShape.type === "rectangle") {
      return rectangleMeasures.find((item) => item.id === selectedShape.id)?.name ?? "";
    }

    if (selectedShape.type === "circle") {
      return circleMeasures.find((item) => item.id === selectedShape.id)?.name ?? "";
    }

    return "";
  }

  function getPointsBoundsCenter(points) {
    if (!points || points.length === 0) {
      return null;
    }

    const lats = points.map((point) => point.lat);
    const lngs = points.map((point) => point.lng);

    return {
      lat: (Math.min(...lats) + Math.max(...lats)) / 2,
      lng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
    };
  }

  function getAveragePoint(points) {
    if (!points || points.length === 0) {
      return null;
    }

    const sums = points.reduce(
      (accumulator, point) => ({
        lat: accumulator.lat + point.lat,
        lng: accumulator.lng + point.lng,
      }),
      { lat: 0, lng: 0 },
    );

    return {
      lat: sums.lat / points.length,
      lng: sums.lng / points.length,
    };
  }

  function getOverlayCenter(shape) {
    if (!shape) {
      return null;
    }

    if (shape.type === "circle") {
      return circleMeasures.find((item) => item.id === shape.id)?.center ?? null;
    }

    if (shape.type === "rectangle") {
      const rectangle = rectangleMeasures.find((item) => item.id === shape.id);
      return rectangle ? getPointsBoundsCenter(rectangle.points) : null;
    }

    if (shape.type === "polygon") {
      const polygon = polygonMeasures.find((item) => item.id === shape.id);
      return polygon ? getPointsBoundsCenter(polygon.points) : null;
    }

    return null;
  }

  function focusOverlayInVisibleArea(shape, { force = false } = {}) {
    const map = mapRef.current;
    const panelElement = measurePanelRef.current;
    if (!map || !shape) {
      return;
    }

    const centerPoint = getOverlayCenter(shape);
    if (!centerPoint) {
      return;
    }

    const projected = map.project([centerPoint.lng, centerPoint.lat]);
    const canvas = map.getCanvas();
    const panelWidth = panelElement?.offsetWidth ?? 0;
    const padding = {
      top: 24,
      right: panelWidth > 0 ? panelWidth + 24 : 24,
      bottom: 24,
      left: 24,
    };
    const insideVisibleArea =
      projected.x >= padding.left &&
      projected.x <= canvas.clientWidth - padding.right &&
      projected.y >= padding.top &&
      projected.y <= canvas.clientHeight - padding.bottom;

    if (!force && insideVisibleArea) {
      return;
    }

    map.easeTo({
      center: [centerPoint.lng, centerPoint.lat],
      padding,
      duration: 700,
    });
  }

  function handleSelectOverlay(nextShape) {
    setSelectedShape(nextShape ? { type: nextShape.type, id: nextShape.id } : null);

    if (nextShape?.focusFromList) {
      focusOverlayInVisibleArea(nextShape);
    }
  }

  function handleFocusOverlay(nextShape) {
    if (!nextShape) {
      return;
    }

    setSelectedShape({ type: nextShape.type, id: nextShape.id });
    focusOverlayInVisibleArea(nextShape, { force: true });
  }

  function getOverlaySelectionAtPoint(event) {
    const map = mapRef.current;
    if (!map) {
      return null;
    }

    const feature = map
      .queryRenderedFeatures(event.point, {
        layers: [MEASURE_FILL_LAYER_ID, MEASURE_LINE_LAYER_ID],
      })
      .find((item) => item.properties?.measureId && item.properties?.shapeType);

    if (!feature) {
      return null;
    }

    return {
      type: feature.properties.shapeType,
      id: feature.properties.measureId,
    };
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

    if (mode === MEASURE_MODES.rectangle || mode === MEASURE_MODES.imageBlock) {
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

  function stopDrawingMode() {
    measureRef.current = {
      mode: MEASURE_MODES.none,
      points: [],
      previewPoint: null,
    };
    setMeasureMode(MEASURE_MODES.none);
    syncMeasurementOverlay();
    syncMeasurementSummary();
  }

  function deleteOverlay(type, id) {
    if (type === "circle") {
      const nextCircles = circleMeasures.filter((item) => item.id !== id);
      circlesRef.current = nextCircles;
      setCircleMeasures(nextCircles);
    }

    if (type === "rectangle") {
      const nextRectangles = rectangleMeasures.filter((item) => item.id !== id);
      rectanglesRef.current = nextRectangles;
      setRectangleMeasures(nextRectangles);
    }

    if (type === "polygon") {
      const nextPolygons = polygonMeasures.filter((item) => item.id !== id);
      polygonsRef.current = nextPolygons;
      setPolygonMeasures(nextPolygons);
    }

    if (selectedShape?.id === id && selectedShape?.type === type) {
      setSelectedShape(null);
    }
  }

  function updateRectangleDimensionById(id, axis, nextValue) {
    const parsed = Math.round(Number(nextValue));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return;
    }

    const nextRectangles = rectangleMeasures.map((rectangle) => {
      if (rectangle.id !== id) {
        return rectangle;
      }

      const originPoint = rectangle.points[0];
      const p1 = rectangle.points[1];
      const p3 = rectangle.points[3];
      const localP1 = latLngToLocalMeters(p1.lat, p1.lng, originPoint);
      const localP3 = latLngToLocalMeters(p3.lat, p3.lng, originPoint);
      const widthVector = { x: localP1.x, y: localP1.y };
      const heightVector = { x: localP3.x, y: localP3.y };
      const nextWidthVector = scaleVector(widthVector, axis === "width" ? parsed : Math.hypot(widthVector.x, widthVector.y));
      const nextHeightVector = scaleVector(heightVector, axis === "height" ? parsed : Math.hypot(heightVector.x, heightVector.y));

      return {
        ...rectangle,
        points: [
          originPoint,
          localMetersToLatLng(nextWidthVector.x, nextWidthVector.y, originPoint),
          localMetersToLatLng(nextWidthVector.x + nextHeightVector.x, nextWidthVector.y + nextHeightVector.y, originPoint),
          localMetersToLatLng(nextHeightVector.x, nextHeightVector.y, originPoint),
        ],
      };
    });

    rectanglesRef.current = nextRectangles;
    setRectangleMeasures(nextRectangles);
  }

  function rotateRectangleById(id, deltaDegrees) {
    const radians = (deltaDegrees * Math.PI) / 180;
    if (!Number.isFinite(radians) || Math.abs(radians) < 0.000001) {
      return;
    }

    const nextRectangles = rectangleMeasures.map((rectangle) => {
      if (rectangle.id !== id || rectangle.points.length < 4) {
        return rectangle;
      }

      const centerPoint = getAveragePoint(rectangle.points);
      if (!centerPoint) {
        return rectangle;
      }

      const rotatedPoints = rectangle.points.map((point) => {
        const localPoint = latLngToLocalMeters(point.lat, point.lng, centerPoint);
        const rotated = rotatePointAroundOrigin(localPoint, radians);
        return localMetersToLatLng(rotated.x, rotated.y, centerPoint);
      });

      return {
        ...rectangle,
        points: rotatedPoints,
      };
    });

    rectanglesRef.current = nextRectangles;
    setRectangleMeasures(nextRectangles);
  }

  function getClientPointAngle(clientPoint, centerProjected) {
    const rect = mapRef.current?.getCanvasContainer().getBoundingClientRect();
    if (!rect) {
      return 0;
    }

    const pointInMap = {
      x: clientPoint.x - rect.left,
      y: clientPoint.y - rect.top,
    };
    return Math.atan2(pointInMap.y - centerProjected.y, pointInMap.x - centerProjected.x);
  }

  function startRectangleRotation(rectangle, clientPoint) {
    const map = mapRef.current;
    if (!map || rectangle.points.length < 4) {
      return;
    }

    const centerPoint = getAveragePoint(rectangle.points);
    if (!centerPoint) {
      return;
    }

    const centerProjected = map.project([centerPoint.lng, centerPoint.lat]);
    rotateStateRef.current = {
      rectangleId: rectangle.id,
      centerPoint,
      centerProjected,
      initialAngle: getClientPointAngle(clientPoint, centerProjected),
      initialPoints: rectangle.points.map((point) => ({ ...point })),
    };

    map.dragPan.disable();
    window.addEventListener("mousemove", handleRectangleRotateMove);
    window.addEventListener("mouseup", handleRectangleRotateEnd);
  }

  function handleRectangleRotateMove(event) {
    const rotateState = rotateStateRef.current;
    if (!rotateState) {
      return;
    }

    const nextAngle = getClientPointAngle({ x: event.clientX, y: event.clientY }, rotateState.centerProjected);
    const deltaRadians = rotateState.initialAngle - nextAngle;

    const nextRectangles = rectanglesRef.current.map((rectangle) => {
      if (rectangle.id !== rotateState.rectangleId) {
        return rectangle;
      }

      const rotatedPoints = rotateState.initialPoints.map((point) => {
        const localPoint = latLngToLocalMeters(point.lat, point.lng, rotateState.centerPoint);
        const rotatedPoint = rotatePointAroundOrigin(localPoint, deltaRadians);
        return localMetersToLatLng(rotatedPoint.x, rotatedPoint.y, rotateState.centerPoint);
      });

      return {
        ...rectangle,
        points: rotatedPoints,
      };
    });

    rectanglesRef.current = nextRectangles;
    setRectangleMeasures(nextRectangles);
  }

  function handleRectangleRotateEnd() {
    if (!rotateStateRef.current) {
      return;
    }

    rotateStateRef.current = null;
    window.removeEventListener("mousemove", handleRectangleRotateMove);
    window.removeEventListener("mouseup", handleRectangleRotateEnd);
    mapRef.current?.dragPan.enable();
  }

  function updateCircleDimensionById(id, axis, nextValue) {
    const parsed = Math.round(Number(nextValue));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return;
    }

    const nextCircles = circleMeasures.map((circle) => {
      if (circle.id !== id) {
        return circle;
      }

      const current = getCircleDimensions(circle);
      const nextWidth = axis === "width" ? parsed : current.widthMeters;
      const nextHeight = axis === "height" ? parsed : current.heightMeters;

      return {
        ...circle,
        widthMeters: nextWidth,
        heightMeters: nextHeight,
        radiusMeters: Math.max(nextWidth, nextHeight) / 2,
      };
    });

    circlesRef.current = nextCircles;
    setCircleMeasures(nextCircles);
  }

  function updateCircleDiameterById(id, nextValue) {
    const parsed = Math.round(Number(nextValue));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return;
    }

    const nextCircles = circleMeasures.map((circle) => {
      if (circle.id !== id) {
        return circle;
      }

      return {
        ...circle,
        widthMeters: parsed,
        heightMeters: parsed,
        radiusMeters: parsed / 2,
      };
    });

    circlesRef.current = nextCircles;
    setCircleMeasures(nextCircles);
  }

  function updateOverlayName(type, id, nextName) {
    const trimmed = nextName.trim();
    if (!trimmed) {
      return;
    }

    if (type === "polygon") {
      const nextPolygons = polygonMeasures.map((polygon) => (polygon.id === id ? { ...polygon, name: trimmed } : polygon));
      polygonsRef.current = nextPolygons;
      setPolygonMeasures(nextPolygons);
      return;
    }

    if (type === "rectangle") {
      const nextRectangles = rectangleMeasures.map((rectangle) => (rectangle.id === id ? { ...rectangle, name: trimmed } : rectangle));
      rectanglesRef.current = nextRectangles;
      setRectangleMeasures(nextRectangles);
      return;
    }

    if (type === "circle") {
      const nextCircles = circleMeasures.map((circle) => (circle.id === id ? { ...circle, name: trimmed } : circle));
      circlesRef.current = nextCircles;
      setCircleMeasures(nextCircles);
    }
  }

  function updateBlockColor(type, id, nextColor) {
    if (!BLOCK_COLOR_PALETTE.includes(nextColor)) {
      return;
    }

    if (type === "circle") {
      const nextCircles = circleMeasures.map((circle) => (circle.id === id ? { ...circle, color: nextColor } : circle));
      circlesRef.current = nextCircles;
      setCircleMeasures(nextCircles);
      return;
    }

    if (type === "rectangle") {
      const nextRectangles = rectangleMeasures.map((rectangle) => (rectangle.id === id ? { ...rectangle, color: nextColor } : rectangle));
      rectanglesRef.current = nextRectangles;
      setRectangleMeasures(nextRectangles);
    }
  }

  function updateBlockImage(id, nextImageSrc) {
    if (!nextImageSrc) {
      return;
    }

    const nextRectangles = rectangleMeasures.map((rectangle) =>
      rectangle.id === id
        ? {
            ...rectangle,
            imageSrc: nextImageSrc,
          }
        : rectangle,
    );
    rectanglesRef.current = nextRectangles;
    setRectangleMeasures(nextRectangles);
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
      const nextPolygon = { id: createMeasureId("polygon"), name: createMeasureName("polygon"), points: [...points] };
      const nextPolygons = [...polygonsRef.current, nextPolygon];
      polygonsRef.current = nextPolygons;
      setPolygonMeasures(nextPolygons);
      setSelectedShape({ type: "polygon", id: nextPolygon.id });
      stopDrawingMode();
      return;
    }

    if ((mode === MEASURE_MODES.rectangle || mode === MEASURE_MODES.imageBlock) && points.length >= 2) {
      const nextRectangle = createScreenAlignedRectangle(createMeasureId("rectangle"), points[0], points[1]);
      if (!nextRectangle) {
        return;
      }
      nextRectangle.name = createMeasureName("block");
      nextRectangle.color = draftBlockColorRef.current;
      if (mode === MEASURE_MODES.imageBlock) {
        nextRectangle.imageSrc = defaultBlockImageSrcRef.current;
      }
      const nextRectangles = [...rectanglesRef.current, nextRectangle];
      rectanglesRef.current = nextRectangles;
      setRectangleMeasures(nextRectangles);
      setSelectedShape({ type: "rectangle", id: nextRectangle.id });
      stopDrawingMode();
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
      const selection = getOverlaySelectionAtPoint(event);
      setSelectedShape(selection);
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
          name: createMeasureName("block"),
          color: draftBlockColorRef.current,
          center: points[0],
          edgePoint: clickedPoint,
          radiusMeters,
          widthMeters: radiusMeters * 2,
          heightMeters: radiusMeters * 2,
        };
        const nextCircles = [...circlesRef.current, nextCircle];
        circlesRef.current = nextCircles;
        setCircleMeasures(nextCircles);
        setSelectedShape({ type: "circle", id: nextCircle.id });
        stopDrawingMode();
        return;
      }
    } else if (mode === MEASURE_MODES.rectangle || mode === MEASURE_MODES.imageBlock) {
      if (points.length === 0) {
        measureRef.current = { mode, points: [clickedPoint], previewPoint: clickedPoint };
      } else {
        const nextRectangle = createScreenAlignedRectangle(createMeasureId("rectangle"), points[0], clickedPoint);
        if (!nextRectangle) {
          return;
        }
        nextRectangle.name = createMeasureName("block");
        nextRectangle.color = draftBlockColorRef.current;
        if (mode === MEASURE_MODES.imageBlock) {
          nextRectangle.imageSrc = defaultBlockImageSrcRef.current;
        }
        const nextRectangles = [...rectanglesRef.current, nextRectangle];
        rectanglesRef.current = nextRectangles;
        setRectangleMeasures(nextRectangles);
        setSelectedShape({ type: "rectangle", id: nextRectangle.id });
        stopDrawingMode();
        return;
      }
    } else if (mode === MEASURE_MODES.polygon) {
      if (points.length >= 3 && isNearFirstPoint(clickedPoint)) {
        const nextPolygon = { id: createMeasureId("polygon"), name: createMeasureName("polygon"), points: [...points] };
        const nextPolygons = [...polygonsRef.current, nextPolygon];
        polygonsRef.current = nextPolygons;
        setPolygonMeasures(nextPolygons);
        setSelectedShape({ type: "polygon", id: nextPolygon.id });
        stopDrawingMode();
        return;
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

    if ((mode === MEASURE_MODES.rectangle || mode === MEASURE_MODES.imageBlock || mode === MEASURE_MODES.polygon) && points.length >= 2) {
      measureRef.current = { mode, points, previewPoint: null };
      syncMeasurementOverlay();
      syncMeasurementSummary();
    }
  }

  function translateCircle(circle, dx, dy) {
    const nextCenter = offsetLatLng(circle.center, dx, dy);
    const nextEdgePoint = circle.edgePoint ? offsetLatLng(circle.edgePoint, dx, dy) : undefined;
    return {
      ...circle,
      center: nextCenter,
      edgePoint: nextEdgePoint,
      radiusMeters: circle.radiusMeters,
    };
  }

  function translatePolygon(polygon, dx, dy) {
    return {
      ...polygon,
      points: polygon.points.map((point) => offsetLatLng(point, dx, dy)),
    };
  }

  function translateRectangle(rectangle, dx, dy) {
    return {
      ...rectangle,
      points: rectangle.points.map((point) => offsetLatLng(point, dx, dy)),
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
      startPoint: { lat: event.lngLat.lat, lng: event.lngLat.lng },
      initialCircle:
        feature.properties.shapeType === "circle"
          ? circlesRef.current.find((circle) => circle.id === feature.properties.measureId) ?? null
          : null,
      initialPolygon:
        feature.properties.shapeType === "polygon"
          ? polygonsRef.current.find((polygon) => polygon.id === feature.properties.measureId) ?? null
          : null,
      initialRectangle:
        feature.properties.shapeType === "rectangle"
          ? rectanglesRef.current.find((rectangle) => rectangle.id === feature.properties.measureId) ?? null
          : null,
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
    const { x: dx, y: dy } = getSnappedGridDelta(dragState.startPoint, currentPoint);
    dragStateRef.current = { ...dragState, moved: true };

    if (dragState.shapeType === "circle") {
      const nextCircles = circlesRef.current.map((circle) =>
        circle.id === dragState.measureId && dragState.initialCircle
          ? translateCircle(dragState.initialCircle, dx, dy)
          : circle,
      );
      circlesRef.current = nextCircles;
      setCircleMeasures(nextCircles);
      return;
    }

    if (dragState.shapeType === "polygon") {
      const nextPolygons = polygonsRef.current.map((polygon) =>
        polygon.id === dragState.measureId && dragState.initialPolygon
          ? translatePolygon(dragState.initialPolygon, dx, dy)
          : polygon,
      );
      polygonsRef.current = nextPolygons;
      setPolygonMeasures(nextPolygons);
      return;
    }

    if (dragState.shapeType === "rectangle") {
      const nextRectangles = rectanglesRef.current.map((rectangle) =>
        rectangle.id === dragState.measureId && dragState.initialRectangle
          ? translateRectangle(dragState.initialRectangle, dx, dy)
          : rectangle,
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

  function updateDefaultBlockImage(nextImageSrc) {
    if (!nextImageSrc) {
      return;
    }

    defaultBlockImageSrcRef.current = nextImageSrc;
    setDefaultBlockImageSrc(nextImageSrc);
  }

  return (
    <div className="app-shell">
      <MapboxControlPanel
        onBack={onBack}
        mapStyle={mapStyle}
        setMapStyle={setMapStyle}
        mapStyleOptions={mapStyleOptions}
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
        panelRef={measurePanelRef}
        measureMode={measureMode}
        activateMeasureMode={activateMeasureMode}
        measureHint={measureHint}
        parcelItems={getParcelItems()}
        blockItems={getBlockItems()}
        blockColorPalette={BLOCK_COLOR_PALETTE}
        draftBlockColor={draftBlockColor}
        defaultBlockImageSrc={defaultBlockImageSrc}
        parcelVisible={parcelVisible}
        blockVisible={blockVisible}
        selectedShape={selectedShape}
        selectedOverlayLabel={getSelectedOverlayLabel()}
        onToggleParcelVisible={() => setParcelVisible((current) => !current)}
        onToggleBlockVisible={() => setBlockVisible((current) => !current)}
        onSelectDraftBlockColor={setDraftBlockColor}
        onChangeDefaultBlockImage={updateDefaultBlockImage}
        onUpdateBlockImage={updateBlockImage}
        onSelectOverlay={handleSelectOverlay}
        onFocusOverlay={handleFocusOverlay}
        onDeleteOverlay={deleteOverlay}
        onUpdateOverlayName={updateOverlayName}
        onUpdateCircleDiameter={updateCircleDiameterById}
        onUpdateRectangleDimension={updateRectangleDimensionById}
        onUpdateBlockColor={updateBlockColor}
      />

      <main ref={mapRootRef} className="map-root map-root--mapbox" aria-label="Mapbox 지도" />

      {errorMessage ? <div className="error-banner">{errorMessage}</div> : null}
    </div>
  );
}
