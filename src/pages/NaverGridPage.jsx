import { useEffect, useRef, useState } from "react";

const NAVER_MAP_KEY_ID = "s31twgmyf4";
const DEFAULT_CENTER = { lat: 34.903349, lng: 127.596771 };
const METERS_PER_DEGREE_LAT = 111320;
const MAX_GRID_RENDER_LINES = 500;

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

export default function NaverGridPage({ onBack }) {
  const mapRootRef = useRef(null);
  const mapRef = useRef(null);
  const mapEventsRef = useRef([]);
  const gridLinesRef = useRef([]);
  const rafRef = useRef(0);
  const drawStateRef = useRef({
    gridWidth: 50,
    gridHeight: 50,
    gridVisible: true,
    rotationDeg: 0,
    origin: DEFAULT_CENTER,
  });

  const [gridWidth, setGridWidth] = useState(50);
  const [gridHeight, setGridHeight] = useState(50);
  const [gridVisible, setGridVisible] = useState(true);
  const [baseMapType, setBaseMapType] = useState("hybrid");
  const [rotationDeg, setRotationDeg] = useState(0);
  const [origin, setOrigin] = useState(DEFAULT_CENTER);
  const [currentCenter, setCurrentCenter] = useState("-");
  const [zoomLevel, setZoomLevel] = useState("-");
  const [renderCount, setRenderCount] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    drawStateRef.current = {
      gridWidth,
      gridHeight,
      gridVisible,
      rotationDeg,
      origin,
    };
  }, [gridWidth, gridHeight, gridVisible, rotationDeg, origin]);

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
        });

        mapRef.current = map;

        const onMapChanged = () => scheduleDraw();
        mapEventsRef.current = [
          naver.maps.Event.addListener(map, "idle", onMapChanged),
          naver.maps.Event.addListener(map, "zoom_changed", onMapChanged),
          naver.maps.Event.addListener(map, "center_changed", onMapChanged),
          naver.maps.Event.addListener(map, "bounds_changed", onMapChanged),
          naver.maps.Event.addListener(map, "mapTypeId_changed", onMapChanged),
          naver.maps.Event.addListener(map, "dragstart", onMapChanged),
          naver.maps.Event.addListener(map, "drag", onMapChanged),
          naver.maps.Event.addListener(map, "dragend", onMapChanged),
        ];

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
      mapEventsRef.current.forEach((listener) => {
        if (listener) {
          window.naver?.maps?.Event.removeListener(listener);
        }
      });
      mapEventsRef.current = [];
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
  }, [gridWidth, gridHeight, gridVisible, origin, rotationDeg]);

  function scheduleDraw() {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(drawGrid);
  }

  function clearGridLines() {
    gridLinesRef.current.forEach((line) => line.setMap(null));
    gridLinesRef.current = [];
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
      rotationDeg: currentRotationDeg,
      origin: currentOrigin,
    } = drawStateRef.current;

    clearGridLines();

    if (!currentGridVisible) {
      setRenderCount(0);
      updateStatusText(map);
      return;
    }

    const bounds = map.getBounds();
    if (!bounds) {
      return;
    }

    const southWest = bounds.getSW();
    const northEast = bounds.getNE();
    const corners = [
      new naver.maps.LatLng(northEast.lat(), southWest.lng()),
      new naver.maps.LatLng(northEast.lat(), northEast.lng()),
      new naver.maps.LatLng(southWest.lat(), northEast.lng()),
      new naver.maps.LatLng(southWest.lat(), southWest.lng()),
    ];

    const safeGridWidth = Math.max(5, Number(currentGridWidth) || 50);
    const safeGridHeight = Math.max(5, Number(currentGridHeight) || 50);
    const radians = (currentRotationDeg * Math.PI) / 180;

    const uvCorners = corners.map((coord) => {
      const local = latLngToLocalMeters(coord.lat(), coord.lng(), currentOrigin);
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

    const uLineCount =
      Math.floor((maxU + safeGridWidth - firstU) / safeGridWidth) + 1;
    const vLineCount =
      Math.floor((maxV + safeGridHeight - firstV) / safeGridHeight) + 1;
    const estimatedLineCount = uLineCount + vLineCount;

    if (estimatedLineCount > MAX_GRID_RENDER_LINES) {
      setRenderCount(estimatedLineCount);
      updateStatusText(map);
      return;
    }

    let lines = 0;
    const lineOverdraw = Math.hypot(safeGridWidth, safeGridHeight) * 3;

    for (let u = firstU; u <= maxU + safeGridWidth; u += safeGridWidth) {
      const a = gridToWorldFrame(u, minV - lineOverdraw, radians);
      const b = gridToWorldFrame(u, maxV + lineOverdraw, radians);
      const aCoord = localMetersToLatLng(a.x, a.y, currentOrigin);
      const bCoord = localMetersToLatLng(b.x, b.y, currentOrigin);
      const line = new naver.maps.Polyline({
        map,
        path: [
          new naver.maps.LatLng(aCoord.lat, aCoord.lng),
          new naver.maps.LatLng(bCoord.lat, bCoord.lng),
        ],
        strokeColor: "rgba(77, 240, 222, 0.54)",
        strokeWeight: 1,
        strokeOpacity: 1,
        clickable: false,
        zIndex: 1000,
      });
      gridLinesRef.current.push(line);
      lines += 1;
    }

    for (let v = firstV; v <= maxV + safeGridHeight; v += safeGridHeight) {
      const a = gridToWorldFrame(minU - lineOverdraw, v, radians);
      const b = gridToWorldFrame(maxU + lineOverdraw, v, radians);
      const aCoord = localMetersToLatLng(a.x, a.y, currentOrigin);
      const bCoord = localMetersToLatLng(b.x, b.y, currentOrigin);
      const line = new naver.maps.Polyline({
        map,
        path: [
          new naver.maps.LatLng(aCoord.lat, aCoord.lng),
          new naver.maps.LatLng(bCoord.lat, bCoord.lng),
        ],
        strokeColor: "rgba(77, 240, 222, 0.54)",
        strokeWeight: 1,
        strokeOpacity: 1,
        clickable: false,
        zIndex: 1000,
      });
      gridLinesRef.current.push(line);
      lines += 1;
    }

    setRenderCount(lines);
    updateStatusText(map);
  }

  function updateStatusText(map) {
    const center = map.getCenter();
    setCurrentCenter(`${center.lat().toFixed(6)}, ${center.lng().toFixed(6)}`);
    setZoomLevel(String(map.getZoom()));
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

  const rotationHintVisible = rotationDeg !== 0;

  return (
    <div className="app-shell">
      <aside className="control-panel">
        <button className="back-button" type="button" aria-label="뒤로" onClick={onBack}>
          &#x2039;
        </button>

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

        <label className="field">
          <span>지도 타입</span>
          <select value={baseMapType} onChange={(event) => setBaseMapType(event.target.value)}>
            <option value="normal">NORMAL</option>
            <option value="satellite">SATELLITE</option>
            <option value="hybrid">HYBRID</option>
            <option value="terrain">TERRAIN</option>
          </select>
        </label>

        <label className="field">
          <span>회전값({rotationDeg}deg)</span>
          <input
            type="range"
            min="-180"
            max="180"
            step="1"
            value={rotationDeg}
            onChange={(event) => setRotationDeg(Number(event.target.value))}
          />
        </label>
        {rotationHintVisible ? (
          <p className="rotation-hint">
            네이버 기본 2D 지도는 자유 회전이 제한적이어서 현재는 격자만 회전합니다.
          </p>
        ) : null}

        <div className="button-row">
          <button type="button" onClick={setOriginToCenter}>
            현재 중심을 원점으로
          </button>
          <button type="button" onClick={moveToDefault}>
            기본 위치로 이동
          </button>
          <button type="button" onClick={() => setRotationDeg(0)}>
            회전 초기화
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
            <dt>렌더 선 수</dt>
            <dd>{renderCount}</dd>
          </div>
        </dl>
      </aside>

      <main ref={mapRootRef} className="map-root" aria-label="네이버 지도" />

      {errorMessage ? <div className="error-banner">{errorMessage}</div> : null}
    </div>
  );
}
