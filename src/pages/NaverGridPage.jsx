import { useEffect, useRef, useState } from "react";
import MeasurePanel from "../components/MeasurePanel";
import defaultBlockPatternUrl from "../assets/block-default.png";
import yard1ImageUrl from "../assets/yard1.png";
import yard2ImageUrl from "../assets/yard2.png";
import {
  BLOCK_COLOR_PALETTE,
  DEFAULT_BLOCK_COLOR,
  DEFAULT_CENTER as MAPBOX_DEFAULT_CENTER,
  DEFAULT_GRID_ROTATION,
  DEFAULT_GRID_SIZE_METERS,
  DRAWING_SNAP_METERS,
  FIXED_GRID_BOUNDARY_DIAGONAL_CORNERS,
} from "../features/mapbox/constants";
import {
  createCircleCoordinates,
  createRectangleFromDiagonal,
  formatMeters,
  formatSquareMeters,
  getCircleAreaSquareMeters,
  getCircleDimensions,
  haversineDistanceMeters,
  MEASURE_MODES,
  polygonAreaSquareMeters,
} from "../features/mapbox/measurementUtils";
import {
  gridToWorldFrame,
  latLngToLocalMeters,
  localMetersToLatLng,
  worldToGridFrame,
} from "../features/mapbox/gridUtils";

const NAVER_MAP_KEY_ID = "s31twgmyf4";
const GPS_TRACKS_URL = "https://api-playground.musma.net/gps/sessions/2f91bd66-e1ce-4ad0-aaa0-315ee93b8834/tracks";
const DEFAULT_CENTER = { lat: MAPBOX_DEFAULT_CENTER[1], lng: MAPBOX_DEFAULT_CENTER[0] };
const MAX_GRID_RENDER_LINES = 500;
const FIXED_IMAGE_OVERLAYS = [
  {
    id: "yard-overlay-1",
    name: "yard1",
    label: "2YARD",
    imageSrc: yard2ImageUrl,
    coordinates: [
      [127.587585, 34.899842],
      [127.590244, 34.901574],
      [127.594853, 34.896818],
      [127.592158, 34.895121],
    ],
  },
  {
    id: "yard-overlay-2",
    name: "yard2",
    label: "1YARD",
    imageSrc: yard1ImageUrl,
    coordinates: [
      [127.590772, 34.901531],
      [127.601043, 34.90818],
      [127.603523, 34.905675],
      [127.593202, 34.899038],
    ],
  },
];

function loadNaverScript(src, callbackName) {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error("Naver Maps SDK callback timeout"));
    }, 4000);

    function cleanup() {
      window.clearTimeout(timeoutId);
      try {
        delete window[callbackName];
      } catch {
        window[callbackName] = undefined;
      }
    }

    window[callbackName] = () => {
      cleanup();
      resolve();
    };

    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onerror = () => {
      cleanup();
      reject(new Error("Failed to load Naver Maps SDK script"));
    };
    document.head.appendChild(script);
  });
}

function ensureNaverSdk() {
  if (window.naver?.maps) {
    return Promise.resolve(window.naver);
  }

  if (window.__naverSdkPromise) {
    return window.__naverSdkPromise;
  }

  const callbackA = "__onNaverMapSdkLoadedA";
  const callbackB = "__onNaverMapSdkLoadedB";
  const clientIdUrl = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpClientId=${NAVER_MAP_KEY_ID}&callback=${callbackA}`;
  const keyIdUrl = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${NAVER_MAP_KEY_ID}&callback=${callbackB}`;

  window.__naverSdkPromise = loadNaverScript(clientIdUrl, callbackA)
    .catch(() => loadNaverScript(keyIdUrl, callbackB))
    .then(() => {
      if (!window.naver?.maps) {
        throw new Error("Naver Maps SDK loaded but naver.maps is missing");
      }
      return window.naver;
    });

  return window.__naverSdkPromise;
}

function snapSizeUpToGrid(sizeMeters, stepMeters) {
  const safeStep = Math.max(1, Number(stepMeters) || DEFAULT_GRID_SIZE_METERS);
  const safeSize = Math.max(0, Number(sizeMeters) || 0);
  const epsilon = 0.0001;
  return Math.ceil((safeSize - epsilon) / safeStep) * safeStep;
}

function normalizeLocalVector(vector) {
  const length = Math.hypot(vector.x, vector.y);
  if (!length) {
    return { x: 0, y: 0 };
  }

  return {
    x: vector.x / length,
    y: vector.y / length,
  };
}

function dotLocalVector(a, b) {
  return a.x * b.x + a.y * b.y;
}

function scaleLocalVector(vector, scalar) {
  return {
    x: vector.x * scalar,
    y: vector.y * scalar,
  };
}

function addLocalVector(point, vector) {
  return {
    x: point.x + vector.x,
    y: point.y + vector.y,
  };
}

function cloneGridBoundaryCoordinates(origin) {
  const { topLeft, bottomRight } = FIXED_GRID_BOUNDARY_DIAGONAL_CORNERS ?? {};
  if (!Array.isArray(topLeft) || topLeft.length !== 2 || !Array.isArray(bottomRight) || bottomRight.length !== 2) {
    return [];
  }

  const topLeftPoint = latLngToLocalMeters(topLeft[1], topLeft[0], origin);
  const bottomRightDiagonalPoint = latLngToLocalMeters(bottomRight[1], bottomRight[0], origin);
  const radians = (DEFAULT_GRID_ROTATION * Math.PI) / 180;

  let rightDirection = {
    x: Math.cos(radians),
    y: Math.sin(radians),
  };
  const diagonal = {
    x: bottomRightDiagonalPoint.x - topLeftPoint.x,
    y: bottomRightDiagonalPoint.y - topLeftPoint.y,
  };
  let rawWidth = diagonal.x * rightDirection.x + diagonal.y * rightDirection.y;
  if (rawWidth < 0) {
    rightDirection = {
      x: -rightDirection.x,
      y: -rightDirection.y,
    };
    rawWidth = -rawWidth;
  }

  let downDirection = {
    x: -rightDirection.y,
    y: rightDirection.x,
  };
  let rawHeight = diagonal.x * downDirection.x + diagonal.y * downDirection.y;
  if (rawHeight < 0) {
    downDirection = {
      x: -downDirection.x,
      y: -downDirection.y,
    };
    rawHeight = -rawHeight;
  }

  const width = snapSizeUpToGrid(rawWidth, DEFAULT_GRID_SIZE_METERS);
  const height = snapSizeUpToGrid(rawHeight, DEFAULT_GRID_SIZE_METERS);
  const topRightPoint = addLocalVector(topLeftPoint, scaleLocalVector(rightDirection, width));
  const bottomLeftPoint = addLocalVector(topLeftPoint, scaleLocalVector(downDirection, height));
  const bottomRightPoint = addLocalVector(bottomLeftPoint, scaleLocalVector(rightDirection, width));
  const topRightLatLng = localMetersToLatLng(topRightPoint.x, topRightPoint.y, origin);
  const bottomRightLatLng = localMetersToLatLng(bottomRightPoint.x, bottomRightPoint.y, origin);
  const bottomLeftLatLng = localMetersToLatLng(bottomLeftPoint.x, bottomLeftPoint.y, origin);

  return [
    [topLeft[0], topLeft[1]],
    [topRightLatLng.lng, topRightLatLng.lat],
    [bottomRightLatLng.lng, bottomRightLatLng.lat],
    [bottomLeftLatLng.lng, bottomLeftLatLng.lat],
  ];
}

function getBoundaryMetrics(boundaryCoordinates, origin) {
  if (!Array.isArray(boundaryCoordinates) || boundaryCoordinates.length < 4) {
    return null;
  }

  const [topLeftRaw, topRightRaw, bottomRightRaw, bottomLeftRaw] = boundaryCoordinates;
  const requiredPoints = [topLeftRaw, topRightRaw, bottomRightRaw, bottomLeftRaw];
  if (requiredPoints.some((point) => !Array.isArray(point) || point.length !== 2)) {
    return null;
  }

  const topLeft = latLngToLocalMeters(topLeftRaw[1], topLeftRaw[0], origin);
  const topRight = latLngToLocalMeters(topRightRaw[1], topRightRaw[0], origin);
  const bottomRight = latLngToLocalMeters(bottomRightRaw[1], bottomRightRaw[0], origin);
  const bottomLeft = latLngToLocalMeters(bottomLeftRaw[1], bottomLeftRaw[0], origin);
  const horizontalDirection = normalizeLocalVector({
    x: topRight.x - topLeft.x,
    y: topRight.y - topLeft.y,
  });
  const verticalDirection = normalizeLocalVector({
    x: bottomLeft.x - topLeft.x,
    y: bottomLeft.y - topLeft.y,
  });
  const totalWidth = Math.max(
    0,
    dotLocalVector(
      {
        x: topRight.x - topLeft.x,
        y: topRight.y - topLeft.y,
      },
      horizontalDirection,
    ),
  );
  const totalHeight = Math.max(
    0,
    dotLocalVector(
      {
        x: bottomLeft.x - topLeft.x,
        y: bottomLeft.y - topLeft.y,
      },
      verticalDirection,
    ),
  );

  return {
    topLeft,
    topRight,
    bottomRight,
    bottomLeft,
    horizontalDirection,
    verticalDirection,
    totalWidth,
    totalHeight,
  };
}

function formatGridIndex(index) {
  const safeIndex = Math.max(0, Math.floor(Number(index) || 0));
  return String(safeIndex).padStart(3, "0");
}

function getGridCellPosition(lngLat, origin, gridWidth, gridHeight, boundaryCoordinates) {
  const metrics = getBoundaryMetrics(boundaryCoordinates, origin);
  if (!lngLat || !metrics) {
    return null;
  }

  const target = latLngToLocalMeters(lngLat.lat, lngLat.lng, origin);
  const widthStep = Math.max(1, Number(gridWidth) || DEFAULT_GRID_SIZE_METERS);
  const heightStep = Math.max(1, Number(gridHeight) || DEFAULT_GRID_SIZE_METERS);
  const delta = {
    x: target.x - metrics.topLeft.x,
    y: target.y - metrics.topLeft.y,
  };
  const xMeters = dotLocalVector(delta, metrics.horizontalDirection);
  const yMeters = dotLocalVector(delta, metrics.verticalDirection);

  if (xMeters < 0 || yMeters < 0 || xMeters > metrics.totalWidth || yMeters > metrics.totalHeight) {
    return null;
  }

  const maxColumns = Math.max(1, Math.floor((metrics.totalWidth + 0.0001) / widthStep));
  const maxRows = Math.max(1, Math.floor((metrics.totalHeight + 0.0001) / heightStep));
  const columnIndex = Math.min(maxColumns - 1, Math.max(0, Math.floor(xMeters / widthStep)));
  const rowIndex = Math.min(maxRows - 1, Math.max(0, Math.floor(yMeters / heightStep)));

  return {
    ...metrics,
    widthStep,
    heightStep,
    columnIndex,
    rowIndex,
  };
}

function getGridCellCode(lngLat, origin, gridWidth, gridHeight, boundaryCoordinates) {
  const position = getGridCellPosition(lngLat, origin, gridWidth, gridHeight, boundaryCoordinates);
  if (!position) {
    return "";
  }

  return `g${formatGridIndex(position.rowIndex + 1)}-${formatGridIndex(position.columnIndex + 1)}`;
}

function getGridCellSelectionCoordinates(lngLat, origin, gridWidth, gridHeight, boundaryCoordinates) {
  const position = getGridCellPosition(lngLat, origin, gridWidth, gridHeight, boundaryCoordinates);
  if (!position) {
    return [];
  }

  const left = position.columnIndex * position.widthStep;
  const right = Math.min(position.totalWidth, left + position.widthStep);
  const top = position.rowIndex * position.heightStep;
  const bottom = Math.min(position.totalHeight, top + position.heightStep);

  const topLeft = addLocalVector(
    addLocalVector(position.topLeft, scaleLocalVector(position.horizontalDirection, left)),
    scaleLocalVector(position.verticalDirection, top),
  );
  const topRight = addLocalVector(
    addLocalVector(position.topLeft, scaleLocalVector(position.horizontalDirection, right)),
    scaleLocalVector(position.verticalDirection, top),
  );
  const bottomRight = addLocalVector(
    addLocalVector(position.topLeft, scaleLocalVector(position.horizontalDirection, right)),
    scaleLocalVector(position.verticalDirection, bottom),
  );
  const bottomLeft = addLocalVector(
    addLocalVector(position.topLeft, scaleLocalVector(position.horizontalDirection, left)),
    scaleLocalVector(position.verticalDirection, bottom),
  );

  return [topLeft, topRight, bottomRight, bottomLeft].map((point) => {
    const latLng = localMetersToLatLng(point.x, point.y, origin);
    return [latLng.lng, latLng.lat];
  });
}

function buildGridInfoPopupHtml(lngLat, origin, gridWidth, gridHeight, boundaryCoordinates) {
  const gridCellCode = getGridCellCode(lngLat, origin, gridWidth, gridHeight, boundaryCoordinates);
  const selectedCellCoordinates = getGridCellSelectionCoordinates(
    lngLat,
    origin,
    gridWidth,
    gridHeight,
    boundaryCoordinates,
  );
  const displayCoordinate = selectedCellCoordinates[0]
    ? `${selectedCellCoordinates[0][0].toFixed(6)}, ${selectedCellCoordinates[0][1].toFixed(6)}`
    : `${lngLat.lng.toFixed(6)}, ${lngLat.lat.toFixed(6)}`;

  return `
    <div class="grid-info-popup">
      <div><strong>좌표</strong>${displayCoordinate}</div>
      <div><strong>물리지번</strong>${gridCellCode || "-"}</div>
    </div>
  `;
}

function extractLatLngFromNaverEvent(event, naver) {
  const directLatLng = event?.latlng ?? event?.coord;
  if (directLatLng && typeof directLatLng.lat === "function" && typeof directLatLng.lng === "function") {
    return directLatLng;
  }

  if (directLatLng && typeof directLatLng.toLatLng === "function") {
    return directLatLng.toLatLng();
  }

  if (typeof event?.lat === "number" && typeof event?.lng === "number" && naver?.maps?.LatLng) {
    return new naver.maps.LatLng(event.lat, event.lng);
  }

  if (directLatLng && naver?.maps?.TransCoord?.fromCoordToLatLng) {
    try {
      return naver.maps.TransCoord.fromCoordToLatLng(directLatLng);
    } catch {
      return null;
    }
  }

  return null;
}

function getRectangleSize(rectangle) {
  if (!rectangle || rectangle.points.length < 4) {
    return { width: 0, height: 0 };
  }

  const originPoint = rectangle.points[0];
  const localP1 = latLngToLocalMeters(rectangle.points[1].lat, rectangle.points[1].lng, originPoint);
  const localP3 = latLngToLocalMeters(rectangle.points[3].lat, rectangle.points[3].lng, originPoint);
  return {
    width: Math.hypot(localP1.x, localP1.y),
    height: Math.hypot(localP3.x, localP3.y),
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

function getGroundOverlayBounds(points, naver) {
  if (!naver?.maps || !Array.isArray(points) || points.length === 0) {
    return null;
  }

  const lats = points.map((point) => point.lat);
  const lngs = points.map((point) => point.lng);
  return new naver.maps.LatLngBounds(
    new naver.maps.LatLng(Math.min(...lats), Math.min(...lngs)),
    new naver.maps.LatLng(Math.max(...lats), Math.max(...lngs)),
  );
}

function cloneFixedImageOverlays() {
  return FIXED_IMAGE_OVERLAYS.map((overlay) => ({
    ...overlay,
    coordinates: overlay.coordinates.map((coordinate) => [...coordinate]),
  }));
}

function createFixedOverlayView(naver, overlay, opacity) {
  function FixedOverlayView() {
    this.root = document.createElement("div");
    this.root.className = "fixed-overlay-layer";

    this.imageNode = document.createElement("div");
    this.imageNode.className = "fixed-overlay-warp";
    this.imageNode.style.backgroundImage = `url("${overlay.imageSrc}")`;
    this.imageNode.style.opacity = String(opacity);

    this.labelNode = document.createElement("div");
    this.labelNode.className = "fixed-overlay-label fixed-overlay-label--floating";
    this.labelNode.textContent = overlay.label;

    this.root.appendChild(this.imageNode);
    this.root.appendChild(this.labelNode);
  }

  FixedOverlayView.prototype = new naver.maps.OverlayView();
  FixedOverlayView.prototype.constructor = FixedOverlayView;

  FixedOverlayView.prototype.onAdd = function onAdd() {
    const panes = this.getPanes();
    panes?.overlayImage?.appendChild(this.root);
  };

  FixedOverlayView.prototype.draw = function draw() {
    const projection = this.getProjection();
    if (!projection) {
      return;
    }

    const [topLeft, topRight, bottomRight, bottomLeft] = overlay.coordinates;
    if (!topLeft || !topRight || !bottomRight || !bottomLeft) {
      return;
    }

    const projectedTopLeft = projection.fromCoordToOffset(new naver.maps.LatLng(topLeft[1], topLeft[0]));
    const projectedTopRight = projection.fromCoordToOffset(new naver.maps.LatLng(topRight[1], topRight[0]));
    const projectedBottomLeft = projection.fromCoordToOffset(new naver.maps.LatLng(bottomLeft[1], bottomLeft[0]));
    const projectedBottomRight = projection.fromCoordToOffset(new naver.maps.LatLng(bottomRight[1], bottomRight[0]));

    if (!projectedTopLeft || !projectedTopRight || !projectedBottomLeft || !projectedBottomRight) {
      return;
    }

    const u = {
      x: projectedTopRight.x - projectedTopLeft.x,
      y: projectedTopRight.y - projectedTopLeft.y,
    };
    const v = {
      x: projectedBottomLeft.x - projectedTopLeft.x,
      y: projectedBottomLeft.y - projectedTopLeft.y,
    };

    this.imageNode.style.transform = `matrix(${u.x}, ${u.y}, ${v.x}, ${v.y}, ${projectedTopLeft.x}, ${projectedTopLeft.y})`;

    const centerX =
      (projectedTopLeft.x + projectedTopRight.x + projectedBottomLeft.x + projectedBottomRight.x) / 4;
    const centerY =
      (projectedTopLeft.y + projectedTopRight.y + projectedBottomLeft.y + projectedBottomRight.y) / 4;
    this.labelNode.style.left = `${centerX}px`;
    this.labelNode.style.top = `${centerY}px`;
  };

  FixedOverlayView.prototype.onRemove = function onRemove() {
    this.root.remove();
  };

  return new FixedOverlayView();
}

export default function NaverGridPage({ onBack }) {
  const mapRootRef = useRef(null);
  const mapRef = useRef(null);
  const mapEventsRef = useRef([]);
  const gridLinesRef = useRef([]);
  const trackLinesRef = useRef([]);
  const selectionPolygonRef = useRef(null);
  const infoWindowRef = useRef(null);
  const fixedOverlayRefs = useRef([]);
  const measureOverlayRefs = useRef([]);
  const statusTextRef = useRef({
    center: "-",
    zoom: "-",
  });
  const rafRef = useRef(0);
  const overlayClickSuppressUntilRef = useRef(0);
  const measureIdRef = useRef(1);
  const measureNameRef = useRef({ polygon: 1, block: 1 });
  const [boundaryCoordinates, setBoundaryCoordinates] = useState(() =>
    cloneGridBoundaryCoordinates(DEFAULT_CENTER),
  );

  const [gridWidth, setGridWidth] = useState(10);
  const [gridHeight, setGridHeight] = useState(10);
  const [gridVisible, setGridVisible] = useState(true);
  const [baseMapType, setBaseMapType] = useState("hybrid");
  const [origin, setOrigin] = useState(DEFAULT_CENTER);
  const [selectedGridCellCoordinates, setSelectedGridCellCoordinates] = useState([]);
  const [currentCenter, setCurrentCenter] = useState("-");
  const [zoomLevel, setZoomLevel] = useState("-");
  const [renderCount, setRenderCount] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");
  const [mapReady, setMapReady] = useState(false);

  const [measureMode, setMeasureMode] = useState(MEASURE_MODES.none);
  const [measureHint, setMeasureHint] = useState("");
  const [measureDraft, setMeasureDraft] = useState({
    mode: MEASURE_MODES.none,
    points: [],
    previewPoint: null,
  });
  const [circleMeasures, setCircleMeasures] = useState([]);
  const [polygonMeasures, setPolygonMeasures] = useState([]);
  const [rectangleMeasures, setRectangleMeasures] = useState([]);
  const [selectedShape, setSelectedShape] = useState(null);
  const [parcelVisible, setParcelVisible] = useState(true);
  const [blockVisible, setBlockVisible] = useState(true);
  const [draftBlockColor, setDraftBlockColor] = useState(DEFAULT_BLOCK_COLOR);
  const [defaultBlockImageSrc, setDefaultBlockImageSrc] = useState(defaultBlockPatternUrl);
  const [fixedOverlayVisible, setFixedOverlayVisible] = useState(true);
  const [fixedOverlayOpacity, setFixedOverlayOpacity] = useState("0.82");
  const [fixedOverlays] = useState(() => cloneFixedImageOverlays());

  const drawStateRef = useRef({
    gridWidth,
    gridHeight,
    gridVisible,
    origin,
    boundaryCoordinates,
  });
  const measureStateRef = useRef({
    measureMode,
    measureDraft,
    circleMeasures,
    polygonMeasures,
    rectangleMeasures,
    selectedShape,
    parcelVisible,
    blockVisible,
    draftBlockColor,
    defaultBlockImageSrc,
  });

  useEffect(() => {
    drawStateRef.current = {
      gridWidth,
      gridHeight,
      gridVisible,
      origin,
      boundaryCoordinates,
    };
  }, [gridWidth, gridHeight, gridVisible, origin, boundaryCoordinates]);

  useEffect(() => {
    measureStateRef.current = {
      measureMode,
      measureDraft,
      circleMeasures,
      polygonMeasures,
      rectangleMeasures,
      selectedShape,
      parcelVisible,
      blockVisible,
      draftBlockColor,
      defaultBlockImageSrc,
    };
  }, [
    measureMode,
    measureDraft,
    circleMeasures,
    polygonMeasures,
    rectangleMeasures,
    selectedShape,
    parcelVisible,
    blockVisible,
    draftBlockColor,
    defaultBlockImageSrc,
  ]);

  useEffect(() => {
    const nextBoundaryCoordinates = cloneGridBoundaryCoordinates(origin);
    setBoundaryCoordinates(nextBoundaryCoordinates);
    setSelectedGridCellCoordinates([]);
    infoWindowRef.current?.close();
  }, [origin]);

  useEffect(() => {
    let cancelled = false;

    ensureNaverSdk()
      .then((naver) => {
        if (cancelled || !mapRootRef.current) {
          return;
        }

        const map = new naver.maps.Map(mapRootRef.current, {
          center: new naver.maps.LatLng(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng),
          zoom: 18,
          mapTypeId: naver.maps.MapTypeId.HYBRID,
          scaleControl: false,
          logoControl: false,
          mapDataControl: false,
          zoomControl: false,
          gl: true,
        });

        mapRef.current = map;
        infoWindowRef.current = new naver.maps.InfoWindow({
          content: "",
          borderWidth: 0,
          backgroundColor: "transparent",
          disableAnchor: true,
        });

        const onMapIdle = () => scheduleDraw();
        const onMapClick = (event) => handleMapClick(event, naver);
        const onMapMouseMove = (event) => handleMapMouseMove(event, naver);

        mapEventsRef.current = [
          naver.maps.Event.addListener(map, "idle", onMapIdle),
          naver.maps.Event.addListener(map, "mapTypeId_changed", onMapIdle),
          naver.maps.Event.addListener(map, "click", onMapClick),
          naver.maps.Event.addListener(map, "mousemove", onMapMouseMove),
        ];

        setMapReady(true);
        scheduleDraw();
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setErrorMessage(
          `네이버 지도 SDK 초기화 실패. 현재 origin: ${window.location.origin}. NCP 콘솔 웹 서비스 URL 허용 목록(localhost/127.0.0.1:8082)과 키 타입(ncpClientId/ncpKeyId) 확인 필요.`,
        );
      });

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      clearGridLines();
      clearTrackLines();
      clearSelectionPolygon();
      clearFixedOverlays();
      clearMeasureOverlays();
      infoWindowRef.current?.close();
      infoWindowRef.current = null;
      mapEventsRef.current.forEach((listener) => {
        if (listener) {
          window.naver?.maps?.Event.removeListener(listener);
        }
      });
      mapEventsRef.current = [];
      setMapReady(false);
    };
  }, []);

  useEffect(() => {
    const onResize = () => scheduleDraw();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const naver = window.naver;
    if (!map || !naver?.maps) {
      return;
    }

    const mapTypes = {
      normal: naver.maps.MapTypeId.NORMAL,
      satellite: naver.maps.MapTypeId.SATELLITE,
      hybrid: naver.maps.MapTypeId.HYBRID,
      terrain: naver.maps.MapTypeId.TERRAIN,
    };
    map.setMapTypeId(mapTypes[baseMapType] ?? naver.maps.MapTypeId.HYBRID);
    scheduleDraw();
  }, [baseMapType]);

  useEffect(() => {
    scheduleDraw();
  }, [gridWidth, gridHeight, gridVisible, boundaryCoordinates]);

  useEffect(() => {
    renderSelectionPolygon();
  }, [selectedGridCellCoordinates, mapReady]);

  useEffect(() => {
    renderMeasureOverlays();
  }, [
    mapReady,
    polygonMeasures,
    rectangleMeasures,
    circleMeasures,
    selectedShape,
    parcelVisible,
    blockVisible,
    measureMode,
    measureDraft,
  ]);

  useEffect(() => {
    renderFixedOverlays();
  }, [mapReady, fixedOverlayVisible, fixedOverlayOpacity, fixedOverlays]);

  useEffect(() => {
    const map = mapRef.current;
    const naver = window.naver;
    if (!mapReady || !map || !naver?.maps) {
      return undefined;
    }

    let cancelled = false;

    fetch(GPS_TRACKS_URL)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`트랙 조회 실패 (${response.status})`);
        }
        return response.json();
      })
      .then((payload) => {
        if (cancelled) {
          return;
        }

        clearTrackLines();

        const rawPath = Array.isArray(payload?.raw)
          ? payload.raw
              .filter((point) => point?.lat != null && point?.lng != null)
              .map((point) => new naver.maps.LatLng(point.lat, point.lng))
          : [];

        const correctedPath = Array.isArray(payload?.corrected)
          ? payload.corrected
              .filter((point) => point?.lat != null && point?.lng != null)
              .map((point) => new naver.maps.LatLng(point.lat, point.lng))
          : [];

        if (rawPath.length > 1) {
          trackLinesRef.current.push(
            new naver.maps.Polyline({
              map,
              path: rawPath,
              strokeColor: "#ef4444",
              strokeWeight: 4,
              strokeOpacity: 0.9,
              strokeStyle: "shortdash",
              clickable: false,
              zIndex: 1800,
            }),
          );
        }

        if (correctedPath.length > 1) {
          trackLinesRef.current.push(
            new naver.maps.Polyline({
              map,
              path: correctedPath,
              strokeColor: "#2563eb",
              strokeWeight: 5,
              strokeOpacity: 0.95,
              clickable: false,
              zIndex: 1801,
            }),
          );
        }

        const fitPath = correctedPath.length > 0 ? correctedPath : rawPath;
        if (fitPath.length > 0) {
          const bounds = new naver.maps.LatLngBounds(fitPath[0], fitPath[0]);
          fitPath.forEach((latLng) => bounds.extend(latLng));
          map.fitBounds(bounds, {
            top: 40,
            right: 280,
            bottom: 40,
            left: 40,
          });
        }
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setErrorMessage(error instanceof Error ? error.message : "트랙 경로를 불러오지 못했습니다.");
      });

    return () => {
      cancelled = true;
      clearTrackLines();
    };
  }, [mapReady]);

  function scheduleDraw() {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(drawGrid);
  }

  function clearGridLines() {
    gridLinesRef.current.forEach((line) => line.setMap(null));
    gridLinesRef.current = [];
  }

  function clearTrackLines() {
    trackLinesRef.current.forEach((line) => line.setMap(null));
    trackLinesRef.current = [];
  }

  function clearSelectionPolygon() {
    selectionPolygonRef.current?.setMap(null);
    selectionPolygonRef.current = null;
  }

  function clearFixedOverlays() {
    fixedOverlayRefs.current.forEach((entry) => entry?.setMap?.(null));
    fixedOverlayRefs.current = [];
  }

  function clearMeasureOverlays() {
    measureOverlayRefs.current.forEach((entry) => {
      entry.listeners?.forEach((listener) => window.naver?.maps?.Event.removeListener(listener));
      entry.overlay?.setMap?.(null);
    });
    measureOverlayRefs.current = [];
  }

  function registerMeasureOverlay(overlay, listeners = []) {
    measureOverlayRefs.current.push({ overlay, listeners });
  }

  function renderFixedOverlays() {
    const map = mapRef.current;
    const naver = window.naver;
    if (!map || !naver?.maps) {
      return;
    }

    clearFixedOverlays();

    if (!fixedOverlayVisible) {
      return;
    }

    const safeOpacity = Math.min(1, Math.max(0, Number(fixedOverlayOpacity) || 0));

    fixedOverlays.forEach((overlay) => {
      const overlayView = createFixedOverlayView(naver, overlay, safeOpacity);
      overlayView.setMap(map);
      fixedOverlayRefs.current.push(overlayView);
    });
  }

  function renderSelectionPolygon() {
    const map = mapRef.current;
    const naver = window.naver;
    clearSelectionPolygon();

    if (!map || !naver?.maps || selectedGridCellCoordinates.length < 4) {
      return;
    }

    selectionPolygonRef.current = new naver.maps.Polygon({
      map,
      paths: [selectedGridCellCoordinates.map(([lng, lat]) => new naver.maps.LatLng(lat, lng))],
      strokeColor: "#f97316",
      strokeWeight: 2,
      strokeOpacity: 0.95,
      fillColor: "rgba(249, 115, 22, 0.18)",
      fillOpacity: 0.5,
      clickable: false,
      zIndex: 1600,
    });
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

  function focusOverlayInVisibleArea(shape) {
    const map = mapRef.current;
    const naver = window.naver;
    const centerPoint = getOverlayCenter(shape);
    if (!map || !naver?.maps || !centerPoint) {
      return;
    }

    map.panTo(new naver.maps.LatLng(centerPoint.lat, centerPoint.lng));
  }

  function handleSelectOverlay(nextShape) {
    infoWindowRef.current?.close();
    setSelectedGridCellCoordinates([]);
    setSelectedShape(nextShape ? { type: nextShape.type, id: nextShape.id } : null);
    if (nextShape?.focusFromList) {
      focusOverlayInVisibleArea(nextShape);
    }
  }

  function handleFocusOverlay(nextShape) {
    if (!nextShape) {
      return;
    }

    infoWindowRef.current?.close();
    setSelectedGridCellCoordinates([]);
    setSelectedShape({ type: nextShape.type, id: nextShape.id });
    focusOverlayInVisibleArea(nextShape);
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
    const { origin: snapOrigin } = drawStateRef.current;
    const localPoint = latLngToLocalMeters(point.lat, point.lng, snapOrigin);
    const radians = (DEFAULT_GRID_ROTATION * Math.PI) / 180;
    const gridPoint = worldToGridFrame(localPoint.x, localPoint.y, radians);
    const snappedU =
      Math.round(gridPoint.u / Math.max(1, DRAWING_SNAP_METERS)) * Math.max(1, DRAWING_SNAP_METERS);
    const snappedV =
      Math.round(gridPoint.v / Math.max(1, DRAWING_SNAP_METERS)) * Math.max(1, DRAWING_SNAP_METERS);
    const snappedWorld = gridToWorldFrame(snappedU, snappedV, radians);
    return localMetersToLatLng(snappedWorld.x, snappedWorld.y, snapOrigin);
  }

  function syncMeasurementSummary(nextMode) {
    if (nextMode === MEASURE_MODES.none) {
      setMeasureHint("");
      return;
    }
    if (nextMode === MEASURE_MODES.rectangle || nextMode === MEASURE_MODES.imageBlock) {
      setMeasureHint("첫 클릭은 시작점, 두 번째 클릭은 대각선 반대편 점입니다.");
      return;
    }
    if (nextMode === MEASURE_MODES.polygon) {
      setMeasureHint("점을 찍고 마지막 점을 더블클릭하거나 시작점 근처를 누르면 완료됩니다.");
      return;
    }
    if (nextMode === MEASURE_MODES.circle) {
      setMeasureHint("첫 클릭은 중심, 두 번째 클릭은 원의 크기를 결정합니다.");
      return;
    }
    setMeasureHint("");
  }

  function stopDrawingMode() {
    const nextDraft = {
      mode: MEASURE_MODES.none,
      points: [],
      previewPoint: null,
    };
    setMeasureMode(MEASURE_MODES.none);
    setMeasureDraft(nextDraft);
    measureStateRef.current = {
      ...measureStateRef.current,
      measureMode: MEASURE_MODES.none,
      measureDraft: nextDraft,
    };
    syncMeasurementSummary(MEASURE_MODES.none);
  }

  function activateMeasureMode(nextMode) {
    if (nextMode === measureStateRef.current.measureMode) {
      stopDrawingMode();
      return;
    }

    const nextDraft = {
      mode: nextMode,
      points: [],
      previewPoint: null,
    };
    setMeasureMode(nextMode);
    setMeasureDraft(nextDraft);
    setSelectedShape(null);
    setSelectedGridCellCoordinates([]);
    infoWindowRef.current?.close();
    measureStateRef.current = {
      ...measureStateRef.current,
      measureMode: nextMode,
      measureDraft: nextDraft,
    };
    syncMeasurementSummary(nextMode);
  }

  function deleteOverlay(type, id) {
    if (type === "circle") {
      const nextCircles = circleMeasures.filter((item) => item.id !== id);
      setCircleMeasures(nextCircles);
    }

    if (type === "rectangle") {
      const nextRectangles = rectangleMeasures.filter((item) => item.id !== id);
      setRectangleMeasures(nextRectangles);
    }

    if (type === "polygon") {
      const nextPolygons = polygonMeasures.filter((item) => item.id !== id);
      setPolygonMeasures(nextPolygons);
    }

    if (selectedShape?.type === type && selectedShape.id === id) {
      setSelectedShape(null);
    }
  }

  function updateRectangleDimensionById(id, axis, nextValue) {
    const parsed = Math.round(Number(nextValue));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return;
    }

    setRectangleMeasures((current) =>
      current.map((rectangle) => {
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
        const nextWidthVector = scaleVector(
          widthVector,
          axis === "width" ? parsed : Math.hypot(widthVector.x, widthVector.y),
        );
        const nextHeightVector = scaleVector(
          heightVector,
          axis === "height" ? parsed : Math.hypot(heightVector.x, heightVector.y),
        );

        return {
          ...rectangle,
          points: [
            originPoint,
            localMetersToLatLng(nextWidthVector.x, nextWidthVector.y, originPoint),
            localMetersToLatLng(
              nextWidthVector.x + nextHeightVector.x,
              nextWidthVector.y + nextHeightVector.y,
              originPoint,
            ),
            localMetersToLatLng(nextHeightVector.x, nextHeightVector.y, originPoint),
          ],
        };
      }),
    );
  }

  function updateCircleDiameterById(id, nextValue) {
    const parsed = Math.round(Number(nextValue));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return;
    }

    setCircleMeasures((current) =>
      current.map((circle) =>
        circle.id === id
          ? {
              ...circle,
              widthMeters: parsed,
              heightMeters: parsed,
              radiusMeters: parsed / 2,
            }
          : circle,
      ),
    );
  }

  function updateOverlayName(type, id, nextName) {
    const trimmed = nextName.trim();
    if (!trimmed) {
      return;
    }

    if (type === "polygon") {
      setPolygonMeasures((current) =>
        current.map((polygon) => (polygon.id === id ? { ...polygon, name: trimmed } : polygon)),
      );
      return;
    }

    if (type === "rectangle") {
      setRectangleMeasures((current) =>
        current.map((rectangle) => (rectangle.id === id ? { ...rectangle, name: trimmed } : rectangle)),
      );
      return;
    }

    if (type === "circle") {
      setCircleMeasures((current) =>
        current.map((circle) => (circle.id === id ? { ...circle, name: trimmed } : circle)),
      );
    }
  }

  function updateBlockColor(type, id, nextColor) {
    if (!BLOCK_COLOR_PALETTE.includes(nextColor)) {
      return;
    }

    if (type === "circle") {
      setCircleMeasures((current) =>
        current.map((circle) => (circle.id === id ? { ...circle, color: nextColor } : circle)),
      );
      return;
    }

    if (type === "rectangle") {
      setRectangleMeasures((current) =>
        current.map((rectangle) => (rectangle.id === id ? { ...rectangle, color: nextColor } : rectangle)),
      );
    }
  }

  function updateBlockImage(id, nextImageSrc) {
    if (!nextImageSrc) {
      return;
    }

    setRectangleMeasures((current) =>
      current.map((rectangle) =>
        rectangle.id === id
          ? {
              ...rectangle,
              imageSrc: nextImageSrc,
            }
          : rectangle,
      ),
    );
  }

  function updateDefaultBlockImage(nextImageSrc) {
    if (!nextImageSrc) {
      return;
    }
    setDefaultBlockImageSrc(nextImageSrc);
  }

  function drawGrid() {
    const map = mapRef.current;
    const naver = window.naver;
    if (!map || !naver?.maps) {
      return;
    }

    const {
      gridWidth: currentGridWidth,
      gridHeight: currentGridHeight,
      gridVisible: currentGridVisible,
      origin: currentOrigin,
      boundaryCoordinates: currentBoundaryCoordinates,
    } = drawStateRef.current;

    clearGridLines();

    if (!currentGridVisible) {
      setRenderCount(0);
      updateStatusText(map);
      return;
    }

    const metrics = getBoundaryMetrics(currentBoundaryCoordinates, currentOrigin);
    if (!metrics) {
      setRenderCount(0);
      updateStatusText(map);
      return;
    }

    const safeGridWidth = Math.max(5, Number(currentGridWidth) || 50);
    const safeGridHeight = Math.max(5, Number(currentGridHeight) || 50);
    const columnSteps = Math.max(0, Math.floor(metrics.totalWidth / safeGridWidth));
    const rowSteps = Math.max(0, Math.floor(metrics.totalHeight / safeGridHeight));
    const estimatedLineCount = columnSteps + rowSteps + 6;

    if (estimatedLineCount > MAX_GRID_RENDER_LINES) {
      setRenderCount(estimatedLineCount);
      updateStatusText(map);
      return;
    }

    const createPathLine = (startPoint, endPoint, color = "rgba(77, 240, 222, 0.54)", weight = 1) => {
      const startLatLng = localMetersToLatLng(startPoint.x, startPoint.y, currentOrigin);
      const endLatLng = localMetersToLatLng(endPoint.x, endPoint.y, currentOrigin);
      gridLinesRef.current.push(
        new naver.maps.Polyline({
          map,
          path: [
            new naver.maps.LatLng(startLatLng.lat, startLatLng.lng),
            new naver.maps.LatLng(endLatLng.lat, endLatLng.lng),
          ],
          strokeColor: color,
          strokeWeight: weight,
          strokeOpacity: 1,
          clickable: false,
          zIndex: 1000,
        }),
      );
    };

    let lines = 0;

    for (let step = 0; step <= columnSteps; step += 1) {
      const distance = Math.min(metrics.totalWidth, step * safeGridWidth);
      const topPoint = addLocalVector(metrics.topLeft, scaleLocalVector(metrics.horizontalDirection, distance));
      const bottomPoint = addLocalVector(
        metrics.bottomLeft,
        scaleLocalVector(metrics.horizontalDirection, distance),
      );
      createPathLine(topPoint, bottomPoint);
      lines += 1;
    }

    for (let step = 0; step <= rowSteps; step += 1) {
      const distance = Math.min(metrics.totalHeight, step * safeGridHeight);
      const leftPoint = addLocalVector(metrics.topLeft, scaleLocalVector(metrics.verticalDirection, distance));
      const rightPoint = addLocalVector(metrics.topRight, scaleLocalVector(metrics.verticalDirection, distance));
      createPathLine(leftPoint, rightPoint);
      lines += 1;
    }

    createPathLine(metrics.topLeft, metrics.topRight, "rgba(77, 240, 222, 0.88)", 2);
    createPathLine(metrics.topRight, metrics.bottomRight, "rgba(77, 240, 222, 0.88)", 2);
    createPathLine(metrics.bottomRight, metrics.bottomLeft, "rgba(77, 240, 222, 0.88)", 2);
    createPathLine(metrics.bottomLeft, metrics.topLeft, "rgba(77, 240, 222, 0.88)", 2);
    lines += 4;

    setRenderCount(lines);
    updateStatusText(map);
  }

  function updateStatusText(map) {
    const center = map.getCenter();
    const nextCenter = `${center.lat().toFixed(6)}, ${center.lng().toFixed(6)}`;
    const nextZoom = String(map.getZoom());

    if (statusTextRef.current.center !== nextCenter) {
      statusTextRef.current.center = nextCenter;
      setCurrentCenter(nextCenter);
    }

    if (statusTextRef.current.zoom !== nextZoom) {
      statusTextRef.current.zoom = nextZoom;
      setZoomLevel(nextZoom);
    }
  }

  function renderMeasureOverlays() {
    const map = mapRef.current;
    const naver = window.naver;
    clearMeasureOverlays();

    if (!map || !naver?.maps) {
      return;
    }

    const selectShape = (shape) => {
      overlayClickSuppressUntilRef.current = Date.now() + 120;
      setSelectedShape(shape);
      infoWindowRef.current?.close();
    };

    const createPolygonOverlay = ({
      shape,
      points,
      strokeColor,
      fillColor,
      fillOpacity,
      strokeWeight = 2,
      zIndex = 1700,
      clickable = true,
      strokeStyle,
    }) => {
      const overlay = new naver.maps.Polygon({
        map,
        paths: [points.map((point) => new naver.maps.LatLng(point.lat, point.lng))],
        strokeColor,
        strokeWeight,
        strokeOpacity: 0.95,
        fillColor,
        fillOpacity,
        clickable,
        zIndex,
        strokeStyle,
      });

      const listeners = [];
      if (shape && clickable) {
        listeners.push(
          naver.maps.Event.addListener(overlay, "click", () => {
            selectShape(shape);
          }),
        );
      }

      registerMeasureOverlay(overlay, listeners);
      return overlay;
    };

    if (parcelVisible) {
      polygonMeasures.forEach((polygon) => {
        const isSelected = selectedShape?.type === "polygon" && selectedShape.id === polygon.id;
        createPolygonOverlay({
          shape: { type: "polygon", id: polygon.id },
          points: polygon.points,
          strokeColor: isSelected ? "#ffffff" : "#ffd56a",
          fillColor: "rgba(255, 213, 106, 0.18)",
          fillOpacity: isSelected ? 0.42 : 0.18,
          strokeWeight: isSelected ? 4 : 2,
          zIndex: isSelected ? 1810 : 1710,
        });
      });
    }

    if (blockVisible) {
      rectangleMeasures.forEach((rectangle) => {
        const isSelected = selectedShape?.type === "rectangle" && selectedShape.id === rectangle.id;
        if (rectangle.imageSrc) {
          const bounds = getGroundOverlayBounds(rectangle.points, naver);
          if (bounds) {
            const imageOverlay = new naver.maps.GroundOverlay(rectangle.imageSrc, bounds, {
              map,
              opacity: isSelected ? 0.95 : 0.82,
              clickable: false,
            });
            registerMeasureOverlay(imageOverlay);
          }
        }

        createPolygonOverlay({
          shape: { type: "rectangle", id: rectangle.id },
          points: rectangle.points,
          strokeColor: isSelected ? "#ffffff" : rectangle.color ?? DEFAULT_BLOCK_COLOR,
          fillColor: rectangle.color ?? DEFAULT_BLOCK_COLOR,
          fillOpacity: rectangle.imageSrc ? 0.02 : isSelected ? 0.52 : 0.3,
          strokeWeight: isSelected ? 4 : 2,
          zIndex: isSelected ? 1820 : 1720,
        });
      });

      circleMeasures.forEach((circle) => {
        const isSelected = selectedShape?.type === "circle" && selectedShape.id === circle.id;
        const { widthMeters, heightMeters } = getCircleDimensions(circle);
        const coordinates = createCircleCoordinates(circle.center, widthMeters, heightMeters).map(([lng, lat]) => ({
          lat,
          lng,
        }));
        createPolygonOverlay({
          shape: { type: "circle", id: circle.id },
          points: coordinates,
          strokeColor: isSelected ? "#ffffff" : circle.color ?? DEFAULT_BLOCK_COLOR,
          fillColor: circle.color ?? DEFAULT_BLOCK_COLOR,
          fillOpacity: isSelected ? 0.52 : 0.3,
          strokeWeight: isSelected ? 4 : 2,
          zIndex: isSelected ? 1830 : 1730,
        });
      });
    }

    if (measureMode === MEASURE_MODES.polygon) {
      const previewPoints = measureDraft.previewPoint
        ? [...measureDraft.points, measureDraft.previewPoint]
        : measureDraft.points;
      if (previewPoints.length >= 2) {
        const previewLine = new naver.maps.Polyline({
          map,
          path: previewPoints.map((point) => new naver.maps.LatLng(point.lat, point.lng)),
          strokeColor: "#ffd56a",
          strokeWeight: 2,
          strokeOpacity: 0.95,
          strokeStyle: "shortdash",
          clickable: false,
          zIndex: 1900,
        });
        registerMeasureOverlay(previewLine);
      }
      if (previewPoints.length >= 3) {
        createPolygonOverlay({
          points: previewPoints,
          strokeColor: "#ffd56a",
          fillColor: "rgba(255, 213, 106, 0.18)",
          fillOpacity: 0.2,
          strokeWeight: 2,
          zIndex: 1890,
          clickable: false,
        });
      }
    }

    if ((measureMode === MEASURE_MODES.rectangle || measureMode === MEASURE_MODES.imageBlock) && measureDraft.points[0]) {
      const endPoint = measureDraft.previewPoint ?? measureDraft.points[1];
      if (endPoint) {
        const draftRectangle = createRectangleFromDiagonal("draft", measureDraft.points[0], endPoint);
        createPolygonOverlay({
          points: draftRectangle.points,
          strokeColor: "#90f0b7",
          fillColor: "rgba(144, 240, 183, 0.16)",
          fillOpacity: 0.2,
          strokeWeight: 2,
          zIndex: 1890,
          clickable: false,
        });
      }
    }

    if (measureMode === MEASURE_MODES.circle && measureDraft.points[0]) {
      const edgePoint = measureDraft.previewPoint ?? measureDraft.points[1];
      if (edgePoint) {
        const radiusMeters = haversineDistanceMeters(measureDraft.points[0], edgePoint);
        const diameterMeters = radiusMeters * 2;
        const draftCoordinates = createCircleCoordinates(
          measureDraft.points[0],
          diameterMeters,
          diameterMeters,
        ).map(([lng, lat]) => ({ lat, lng }));
        createPolygonOverlay({
          points: draftCoordinates,
          strokeColor: "#90f0b7",
          fillColor: "rgba(144, 240, 183, 0.16)",
          fillOpacity: 0.2,
          strokeWeight: 2,
          zIndex: 1890,
          clickable: false,
        });
      }
    }
  }

  function completeCurrentMeasure(clickedPoint) {
    const {
      measureMode: currentMeasureMode,
      measureDraft: currentMeasureDraft,
      draftBlockColor: currentDraftBlockColor,
      defaultBlockImageSrc: currentDefaultBlockImageSrc,
    } = measureStateRef.current;

    if (currentMeasureMode === MEASURE_MODES.circle) {
      const centerPoint = currentMeasureDraft.points[0];
      const radiusMeters = haversineDistanceMeters(centerPoint, clickedPoint);
      const nextCircle = {
        id: createMeasureId("circle"),
        name: createMeasureName("block"),
        color: currentDraftBlockColor,
        center: centerPoint,
        edgePoint: clickedPoint,
        radiusMeters,
        widthMeters: radiusMeters * 2,
        heightMeters: radiusMeters * 2,
      };
      setCircleMeasures((current) => [...current, nextCircle]);
      setSelectedShape({ type: "circle", id: nextCircle.id });
      stopDrawingMode();
      return;
    }

    if (currentMeasureMode === MEASURE_MODES.rectangle || currentMeasureMode === MEASURE_MODES.imageBlock) {
      const nextRectangle = createRectangleFromDiagonal(
        createMeasureId("rectangle"),
        currentMeasureDraft.points[0],
        clickedPoint,
      );
      nextRectangle.name = createMeasureName("block");
      nextRectangle.color = currentDraftBlockColor;
      if (currentMeasureMode === MEASURE_MODES.imageBlock) {
        nextRectangle.imageSrc = currentDefaultBlockImageSrc;
      }
      setRectangleMeasures((current) => [...current, nextRectangle]);
      setSelectedShape({ type: "rectangle", id: nextRectangle.id });
      stopDrawingMode();
      return;
    }

    if (currentMeasureMode === MEASURE_MODES.polygon && currentMeasureDraft.points.length >= 2) {
      const nextPolygon = {
        id: createMeasureId("polygon"),
        name: createMeasureName("polygon"),
        points: [...currentMeasureDraft.points, clickedPoint],
      };
      setPolygonMeasures((current) => [...current, nextPolygon]);
      setSelectedShape({ type: "polygon", id: nextPolygon.id });
      stopDrawingMode();
    }
  }

  function handleMapClick(event, naver) {
    const map = mapRef.current;
    if (!map || !naver?.maps) {
      return;
    }

    if (Date.now() < overlayClickSuppressUntilRef.current) {
      return;
    }

    const latLng = extractLatLngFromNaverEvent(event, naver);
    if (!latLng) {
      return;
    }

    const clickedPoint = snapPointToMeter({ lat: latLng.lat(), lng: latLng.lng() });
    const {
      measureMode: currentMeasureMode,
      measureDraft: currentMeasureDraft,
    } = measureStateRef.current;

    if (currentMeasureMode === MEASURE_MODES.none) {
      const {
        origin: currentOrigin,
        gridWidth: currentGridWidth,
        gridHeight: currentGridHeight,
        gridVisible: currentGridVisible,
        boundaryCoordinates: currentBoundaryCoordinates,
      } = drawStateRef.current;

      setSelectedShape(null);
      if (!currentGridVisible) {
        setSelectedGridCellCoordinates([]);
        infoWindowRef.current?.close();
        return;
      }

      const nextSelectedGridCellCoordinates = getGridCellSelectionCoordinates(
        clickedPoint,
        currentOrigin,
        currentGridWidth,
        currentGridHeight,
        currentBoundaryCoordinates,
      );
      setSelectedGridCellCoordinates(nextSelectedGridCellCoordinates);

      if (nextSelectedGridCellCoordinates.length < 4) {
        infoWindowRef.current?.close();
        return;
      }

      infoWindowRef.current
        ?.setContent(
          buildGridInfoPopupHtml(
            clickedPoint,
            currentOrigin,
            currentGridWidth,
            currentGridHeight,
            currentBoundaryCoordinates,
          ),
        );
      infoWindowRef.current?.open(map, latLng);
      return;
    }

    infoWindowRef.current?.close();
    setSelectedGridCellCoordinates([]);

    if (currentMeasureMode === MEASURE_MODES.circle) {
      if (currentMeasureDraft.points.length === 0) {
        const nextDraft = {
          mode: currentMeasureMode,
          points: [clickedPoint],
          previewPoint: clickedPoint,
        };
        setMeasureDraft(nextDraft);
        measureStateRef.current = {
          ...measureStateRef.current,
          measureDraft: nextDraft,
        };
      } else {
        completeCurrentMeasure(clickedPoint);
      }
      return;
    }

    if (currentMeasureMode === MEASURE_MODES.rectangle || currentMeasureMode === MEASURE_MODES.imageBlock) {
      if (currentMeasureDraft.points.length === 0) {
        const nextDraft = {
          mode: currentMeasureMode,
          points: [clickedPoint],
          previewPoint: clickedPoint,
        };
        setMeasureDraft(nextDraft);
        measureStateRef.current = {
          ...measureStateRef.current,
          measureDraft: nextDraft,
        };
      } else {
        completeCurrentMeasure(clickedPoint);
      }
      return;
    }

    if (currentMeasureMode === MEASURE_MODES.polygon) {
      if (currentMeasureDraft.points.length >= 2) {
        const firstPoint = currentMeasureDraft.points[0];
        const distanceToStart = haversineDistanceMeters(firstPoint, clickedPoint);
        if (distanceToStart <= Math.max(gridWidth, gridHeight)) {
          const nextPolygon = {
            id: createMeasureId("polygon"),
            name: createMeasureName("polygon"),
            points: [...currentMeasureDraft.points],
          };
          setPolygonMeasures((current) => [...current, nextPolygon]);
          setSelectedShape({ type: "polygon", id: nextPolygon.id });
          stopDrawingMode();
          return;
        }
      }

      const nextDraft = {
        mode: currentMeasureMode,
        points: [...currentMeasureDraft.points, clickedPoint],
        previewPoint: null,
      };
      setMeasureDraft(nextDraft);
      measureStateRef.current = {
        ...measureStateRef.current,
        measureDraft: nextDraft,
      };
    }
  }

  function handleMapMouseMove(event, naver) {
    if (measureStateRef.current.measureMode === MEASURE_MODES.none) {
      return;
    }

    if (measureStateRef.current.measureDraft.points.length === 0) {
      return;
    }

    const latLng = extractLatLngFromNaverEvent(event, naver);
    if (!latLng) {
      return;
    }

    const nextDraft = {
      mode: measureStateRef.current.measureMode,
      points: measureStateRef.current.measureDraft.points,
      previewPoint: snapPointToMeter({ lat: latLng.lat(), lng: latLng.lng() }),
    };
    setMeasureDraft(nextDraft);
    measureStateRef.current = {
      ...measureStateRef.current,
      measureDraft: nextDraft,
    };
  }

  function setOriginToCenter() {
    const map = mapRef.current;
    if (!map) {
      return;
    }
    const center = map.getCenter();
    setOrigin({ lat: center.lat(), lng: center.lng() });
  }

  function moveToDefault() {
    const map = mapRef.current;
    const naver = window.naver;
    if (!map || !naver?.maps) {
      return;
    }
    map.panTo(new naver.maps.LatLng(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng));
  }

  function recenterBoundaryToMapboxGrid() {
    const naver = window.naver;
    const map = mapRef.current;
    if (!map || !naver?.maps || boundaryCoordinates.length < 4) {
      return;
    }

    const bounds = new naver.maps.LatLngBounds(
      new naver.maps.LatLng(boundaryCoordinates[0][1], boundaryCoordinates[0][0]),
      new naver.maps.LatLng(boundaryCoordinates[0][1], boundaryCoordinates[0][0]),
    );
    boundaryCoordinates.forEach(([lng, lat]) => {
      bounds.extend(new naver.maps.LatLng(lat, lng));
    });
    map.fitBounds(bounds, {
      top: 40,
      right: 280,
      bottom: 40,
      left: 40,
    });
  }

  return (
    <div className="app-shell">
      <aside className="control-panel">
        {onBack ? (
          <button className="back-button" type="button" aria-label="뒤로" onClick={onBack}>
            &#x2039;
          </button>
        ) : null}

        <p className="eyebrow">ECHOTECH DEMO</p>
        <h1>Grid Controls</h1>

        <label className="field">
          <span>가로(m)</span>
          <input
            type="number"
            min="5"
            step="5"
            value={gridWidth}
            onChange={(event) => setGridWidth(Number(event.target.value))}
          />
        </label>

        <label className="field">
          <span>세로(m)</span>
          <input
            type="number"
            min="5"
            step="5"
            value={gridHeight}
            onChange={(event) => setGridHeight(Number(event.target.value))}
          />
        </label>

        <label className="toggle-row">
          <span>격자 표시</span>
          <input
            type="checkbox"
            checked={gridVisible}
            onChange={(event) => setGridVisible(event.target.checked)}
          />
        </label>

        <label className="toggle-row">
          <span>도면 이미지</span>
          <input
            type="checkbox"
            checked={fixedOverlayVisible}
            onChange={(event) => setFixedOverlayVisible(event.target.checked)}
          />
        </label>

        <label className="field">
          <span>도면 Opacity({fixedOverlayOpacity})</span>
          <input
            type="number"
            min="0"
            max="1"
            step="0.1"
            value={fixedOverlayOpacity}
            onChange={(event) => setFixedOverlayOpacity(event.target.value)}
          />
        </label>

        <label className="field">
          <span>지도 타입</span>
          <select value={baseMapType} onChange={(event) => setBaseMapType(event.target.value)}>
            <option value="normal">NORMAL</option>
            <option value="satellite">SATELLITE</option>
            <option value="hybrid">HYBRID</option>
            <option value="terrain">TERRAIN</option>
          </select>
        </label>

        <div className="button-row">
          <button type="button" onClick={setOriginToCenter}>
            현재 중심을 원점으로
          </button>
          <button type="button" onClick={moveToDefault}>
            기본 위치로 이동
          </button>
          <button type="button" onClick={recenterBoundaryToMapboxGrid}>
            격자 영역 맞추기
          </button>
        </div>

        <dl className="status-list">
          <div>
            <dt>현재 중심</dt>
            <dd>{currentCenter}</dd>
          </div>
          <div>
            <dt>격자 원점</dt>
            <dd>{`${origin.lat.toFixed(6)}, ${origin.lng.toFixed(6)}`}</dd>
          </div>
          <div>
            <dt>지도 레벨</dt>
            <dd>{zoomLevel}</dd>
          </div>
          <div>
            <dt>격자 회전</dt>
            <dd>{DEFAULT_GRID_ROTATION}° (고정)</dd>
          </div>
          <div>
            <dt>렌더 선 수</dt>
            <dd>{renderCount}</dd>
          </div>
        </dl>
      </aside>

      <main ref={mapRootRef} className="map-root" aria-label="네이버 지도" />

      <MeasurePanel
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

      {errorMessage ? <div className="error-banner">{errorMessage}</div> : null}
    </div>
  );
}
