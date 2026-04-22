import { useEffect, useRef, useState } from "react";

const IS_DEV = import.meta.env.DEV;
const DEFAULT_CENTER = [127.592328, 34.900905];
const DEFAULT_BEARING = -38;
const DEFAULT_PITCH = 0;
const DEFAULT_GRID_ROTATION = -52;
const METERS_PER_DEGREE_LAT = 111320;
const MAX_GRID_RENDER_LINES = 500;
const RAW_MAPBOX_ACCESS_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
const MAPBOX_STYLE = "mapbox://styles/mapbox/satellite-streets-v12";
const MAPBOX_GL_CSS_ID = "mapbox-gl-css";
const MAPBOX_GL_SCRIPT_ID = "mapbox-gl-script";
const KOREAN_LABEL_FIELD = ["coalesce", ["get", "name_ko"], ["get", "name"]];
const GRID_SOURCE_ID = "echotech-grid-source";
const GRID_LAYER_ID = "echotech-grid-layer";

function normalizeMapboxToken(value) {
  if (!value) {
    return "";
  }

  const trimmed = String(value).trim().replace(/^['"]|['"]$/g, "");
  const prefixed = trimmed.match(/VITE_MAPBOX_ACCESS_TOKEN\s*=\s*(.+)$/);
  return (prefixed ? prefixed[1] : trimmed).trim();
}

function metersToLatitudeDegrees(meters) {
  return meters / METERS_PER_DEGREE_LAT;
}

function metersToLongitudeDegrees(meters, latitude) {
  const cosLat = Math.max(Math.cos((latitude * Math.PI) / 180), 0.000001);
  return meters / (METERS_PER_DEGREE_LAT * cosLat);
}

function latLngToLocalMeters(lat, lng, origin) {
  const metersPerDegreeLng =
    METERS_PER_DEGREE_LAT * Math.max(Math.cos((origin.lat * Math.PI) / 180), 0.000001);
  return {
    x: (lng - origin.lng) * metersPerDegreeLng,
    y: (lat - origin.lat) * METERS_PER_DEGREE_LAT,
  };
}

function localMetersToLatLng(x, y, origin) {
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

function ensureMapboxGlCss() {
  if (document.getElementById(MAPBOX_GL_CSS_ID)) {
    return;
  }

  const link = document.createElement("link");
  link.id = MAPBOX_GL_CSS_ID;
  link.rel = "stylesheet";
  link.href = "https://api.mapbox.com/mapbox-gl-js/v3.12.0/mapbox-gl.css";
  document.head.appendChild(link);
}

function ensureMapboxGlScript() {
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

function applyKoreanLabels(map) {
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

function createEmptyFeatureCollection() {
  return {
    type: "FeatureCollection",
    features: [],
  };
}

function ensureGridLayer(map) {
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

function buildGridGeoJson({ corners, origin, gridWidth, gridHeight, rotationDeg }) {
  const safeGridWidth = Math.max(5, Number(gridWidth) || 50);
  const safeGridHeight = Math.max(5, Number(gridHeight) || 50);
  const radians = (rotationDeg * Math.PI) / 180;

  const uvCorners = corners.map((coord) => {
    const local = latLngToLocalMeters(coord.lat, coord.lng, origin);
    return worldToGridFrame(local.x, local.y, radians);
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

export default function MapboxRotatePage({ onBack }) {
  const mapRootRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const rafRef = useRef(0);
  const drawStateRef = useRef({
    gridWidth: 50,
    gridHeight: 50,
    gridVisible: true,
    rotationDeg: DEFAULT_GRID_ROTATION,
    origin: { lat: DEFAULT_CENTER[1], lng: DEFAULT_CENTER[0] },
  });
  const mapboxAccessToken = normalizeMapboxToken(RAW_MAPBOX_ACCESS_TOKEN);

  const [gridWidth, setGridWidth] = useState(50);
  const [gridHeight, setGridHeight] = useState(50);
  const [gridVisible, setGridVisible] = useState(true);
  const [rotationDeg, setRotationDeg] = useState(DEFAULT_GRID_ROTATION);
  const [origin, setOrigin] = useState({ lat: DEFAULT_CENTER[1], lng: DEFAULT_CENTER[0] });
  const [bearing, setBearing] = useState(DEFAULT_BEARING);
  const [pitch, setPitch] = useState(DEFAULT_PITCH);
  const [zoom, setZoom] = useState("15.20");
  const [center, setCenter] = useState(`${DEFAULT_CENTER[1].toFixed(6)}, ${DEFAULT_CENTER[0].toFixed(6)}`);
  const [renderCount, setRenderCount] = useState(0);
  const [statusMessage, setStatusMessage] = useState("Mapbox GL JS 로딩 중");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    drawStateRef.current = {
      gridWidth,
      gridHeight,
      gridVisible,
      rotationDeg,
      origin,
    };
    scheduleGridDraw();
  }, [gridWidth, gridHeight, gridVisible, rotationDeg, origin]);

  useEffect(() => {
    let cancelled = false;

    if (!mapboxAccessToken) {
      setStatusMessage("Mapbox 토큰이 없어 지도를 초기화하지 않음");
      setErrorMessage(
        "`.env` 파일에 `VITE_MAPBOX_ACCESS_TOKEN=...` 값을 추가한 뒤 개발 서버를 다시 시작하세요.",
      );
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

        map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), "bottom-right");
        if (IS_DEV) {
          map.dragRotate.enable();
          map.touchZoomRotate.enableRotation();
          map.keyboard.enable();
        } else {
          map.dragRotate.disable();
          map.touchZoomRotate.disableRotation();
        }

        const marker = new mapboxgl.Marker({ color: "#9cf2bd" })
          .setLngLat(DEFAULT_CENTER)
          .setPopup(
            new mapboxgl.Popup({ offset: 18 }).setHTML(
              "<strong>ECHOTECH</strong><br />Rotate-enabled Mapbox page",
            ),
          )
          .addTo(map);

        mapRef.current = map;
        markerRef.current = marker;

        const syncStatus = () => {
          const mapCenter = map.getCenter();
          setCenter(`${mapCenter.lat.toFixed(6)}, ${mapCenter.lng.toFixed(6)}`);
          setZoom(map.getZoom().toFixed(2));
          setBearing(Math.round(map.getBearing()));
          setPitch(Math.round(map.getPitch()));
        };

        map.on("load", () => {
          if (cancelled) {
            return;
          }
          applyKoreanLabels(map);
          ensureGridLayer(map);
          setStatusMessage(
            IS_DEV
              ? "개발 모드입니다. 우클릭 드래그로 지도 회전과 틸트 수정이 가능합니다."
              : "토큰 확인 완료. 운영 모드에서는 개발용 회전/틸트 제어가 숨겨집니다.",
          );
          syncStatus();
          scheduleGridDraw();
        });

        map.on("styledata", () => {
          if (!cancelled) {
            applyKoreanLabels(map);
            if (map.isStyleLoaded()) {
              ensureGridLayer(map);
              scheduleGridDraw();
            }
          }
        });
        map.on("move", syncStatus);
        map.on("rotate", syncStatus);
        map.on("pitch", syncStatus);
        map.on("move", scheduleGridDraw);
        map.on("rotate", scheduleGridDraw);
        map.on("pitch", scheduleGridDraw);
        map.on("zoom", scheduleGridDraw);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setErrorMessage(
          `Mapbox GL JS 초기화 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}`,
        );
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

  function drawGrid() {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded() || !map.getSource(GRID_SOURCE_ID)) {
      return;
    }

    const { gridWidth: currentGridWidth, gridHeight: currentGridHeight, gridVisible: currentGridVisible, rotationDeg: currentRotationDeg, origin: currentOrigin } =
      drawStateRef.current;

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

  function setMapPitch(nextPitch) {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    map.easeTo({
      pitch: nextPitch,
      duration: 0,
    });
  }

  return (
    <div className="app-shell">
      <aside className="control-panel control-panel--mapbox">
        <button className="back-button" type="button" aria-label="뒤로" onClick={onBack}>
          &#x2039;
        </button>

        <p className="eyebrow">MAPBOX VIEW</p>
        <h1>Rotate Map</h1>
        {IS_DEV ? (
          <section className="dev-panel-block">
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

            <label className="field">
              <span>격자 회전({rotationDeg}deg)</span>
              <input
                type="range"
                min="-180"
                max="180"
                step="1"
                value={rotationDeg}
                onChange={(event) => setRotationDeg(Number(event.target.value))}
              />
            </label>

            <label className="field">
              <span>지도 회전({bearing}deg)</span>
              <input
                type="range"
                min="-180"
                max="180"
                step="1"
                value={bearing}
                onChange={(event) => setMapBearing(Number(event.target.value))}
              />
            </label>

            <label className="field">
              <span>지도 틸트({pitch}deg)</span>
              <input
                type="range"
                min="0"
                max="85"
                step="1"
                value={pitch}
                onChange={(event) => setMapPitch(Number(event.target.value))}
              />
            </label>

            <p className="rotation-hint">
              개발 모드에서는 지도와 격자를 슬라이더로 수정할 수 있고, 지도는 우클릭 드래그로 rotation과 tilt도 직접 조정할 수 있습니다.
            </p>

            <div className="button-row">
              <button type="button" onClick={() => spinCamera(-30)}>
                좌로 30deg
              </button>
              <button type="button" onClick={() => spinCamera(30)}>
                우로 30deg
              </button>
              <button type="button" onClick={setOriginToCenter}>
                현재 중심을 원점으로
              </button>
              <button type="button" onClick={resetCamera}>
                카메라 초기화
              </button>
            </div>
          </section>
        ) : null}

        <dl className="status-list">
          <div>
            <dt>현재 중심</dt>
            <dd>{center}</dd>
          </div>
          <div>
            <dt>격자 원점</dt>
            <dd>{`${origin.lat.toFixed(6)}, ${origin.lng.toFixed(6)}`}</dd>
          </div>
          <div>
            <dt>Zoom</dt>
            <dd>{zoom}</dd>
          </div>
          <div>
            <dt>Bearing</dt>
            <dd>{bearing}deg</dd>
          </div>
          <div>
            <dt>Pitch</dt>
            <dd>{pitch}deg</dd>
          </div>
          <div>
            <dt>렌더 선 수</dt>
            <dd>{renderCount}</dd>
          </div>
        </dl>

        <p className="mapbox-status">{statusMessage}</p>
      </aside>

      <main ref={mapRootRef} className="map-root map-root--mapbox" aria-label="Mapbox 지도" />

      {errorMessage ? <div className="error-banner">{errorMessage}</div> : null}
    </div>
  );
}
