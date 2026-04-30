import { useEffect, useRef, useState } from "react";
import GpsTestPanel from "../components/GpsTestPanel";
import GpsTrackVisibilityPanel from "../components/GpsTrackVisibilityPanel";
import {
  DEFAULT_BEARING,
  DEFAULT_CENTER,
  DEFAULT_MAPBOX_STYLE,
  DEFAULT_PITCH,
  GRID_SOURCE_ID,
  MAPBOX_STYLES,
  RAW_MAPBOX_ACCESS_TOKEN,
} from "../features/mapbox/constants";
import {
  applyKoreanLabels,
  buildGridGeoJson,
  createEmptyFeatureCollection,
  ensureGridLayer,
  ensureMapboxGlCss,
  ensureMapboxGlScript,
  getDefaultDrawState,
  normalizeMapboxToken,
} from "../features/mapbox/gridUtils";

const GPS_API_BASE_URL = "https://api-playground.musma.net";
const GPS_TRACK_SOURCE_ID = "echotech-gps-track-source";
const GPS_TRACK_RAW_LAYER_ID = "echotech-gps-track-raw-layer";
const GPS_TRACK_CORRECTED_LAYER_ID = "echotech-gps-track-corrected-layer";
const GPS_TRACK_RAW_POINT_LAYER_ID = "echotech-gps-track-raw-point-layer";
const GPS_TRACK_CORRECTED_POINT_LAYER_ID = "echotech-gps-track-corrected-point-layer";
const GPS_TRACK_START_LAYER_ID = "echotech-gps-track-start-layer";

function formatGpsSessionDate(value) {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(parsed);
}

function formatGpsMetric(value, suffix = "") {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "-";
  }

  return `${Number(value).toFixed(1)}${suffix}`;
}

function getGpsResultRows(summary) {
  if (!summary) {
    return [];
  }

  return [
    { label: "총 포인트 수", before: summary.totalPoints ?? "-", after: summary.totalPoints ?? "-", effect: "-" },
    { label: "이상 좌표 차단", before: "-", after: `${summary.rejectedPoints ?? 0}건`, effect: "노이즈 제거" },
    {
      label: "최대 위치 점프",
      before: formatGpsMetric(summary.rawMaxJumpM, "m"),
      after: formatGpsMetric(summary.correctedMaxJumpM, "m"),
      effect: `${formatGpsMetric(summary.maxJumpReductionPercent, "%")} 감소`,
    },
    {
      label: "평균 이동 흔들림",
      before: formatGpsMetric(summary.rawAverageStepM, "m"),
      after: formatGpsMetric(summary.correctedAverageStepM, "m"),
      effect: `${formatGpsMetric(summary.averageStepReductionPercent, "%")} 감소`,
    },
    {
      label: "평균 GPS 정확도",
      before: formatGpsMetric(summary.rawAverageAccuracyM ?? summary.averageAccuracyM, "m"),
      after: formatGpsMetric(summary.correctedAverageAccuracyM, "m"),
      effect: "단말 측정 품질",
    },
  ];
}

function sortGpsSessions(list) {
  return [...list].sort((a, b) => {
    const left = new Date(b.startedAt ?? b.createdAt ?? 0).getTime();
    const right = new Date(a.startedAt ?? a.createdAt ?? 0).getTime();
    return left - right;
  });
}

function createGpsTrackGeoJson(tracks) {
  const rawCoordinates = Array.isArray(tracks?.raw) ? tracks.raw.map((point) => [point.lng, point.lat]) : [];
  const correctedCoordinates = Array.isArray(tracks?.corrected) ? tracks.corrected.map((point) => [point.lng, point.lat]) : [];
  const firstPoint = correctedCoordinates[0] ?? rawCoordinates[0] ?? null;
  const features = [];

  if (rawCoordinates.length > 1) {
    features.push({
      type: "Feature",
      properties: { kind: "raw" },
      geometry: { type: "LineString", coordinates: rawCoordinates },
    });
  }

  if (correctedCoordinates.length > 1) {
    features.push({
      type: "Feature",
      properties: { kind: "corrected" },
      geometry: { type: "LineString", coordinates: correctedCoordinates },
    });
  }

  if (firstPoint) {
    features.push({
      type: "Feature",
      properties: { kind: "start" },
      geometry: { type: "Point", coordinates: firstPoint },
    });
  }

  if (Array.isArray(tracks?.raw)) {
    tracks.raw.forEach((point) => {
      features.push({
        type: "Feature",
        properties: {
          kind: "raw-point",
          pointIndex: point.pointIndex,
          recordedAt: point.recordedAt ?? "",
          lat: point.lat,
          lng: point.lng,
          accuracy: point.accuracy,
        },
        geometry: { type: "Point", coordinates: [point.lng, point.lat] },
      });
    });
  }

  if (Array.isArray(tracks?.corrected)) {
    tracks.corrected.forEach((point) => {
      features.push({
        type: "Feature",
        properties: {
          kind: "corrected-point",
          pointIndex: point.pointIndex,
          status: point.status,
          recordedAt: point.recordedAt ?? "",
          lat: point.lat,
          lng: point.lng,
          accuracy: point.accuracy,
        },
        geometry: { type: "Point", coordinates: [point.lng, point.lat] },
      });
    });
  }

  return { type: "FeatureCollection", features };
}

export default function GpsTestPage() {
  const mapRootRef = useRef(null);
  const mapRef = useRef(null);
  const mapboxGlRef = useRef(null);
  const gpsHoverPopupRef = useRef(null);
  const gpsPanelRef = useRef(null);
  const gpsTrackGeoJsonRef = useRef(createEmptyFeatureCollection());
  const drawStateRef = useRef(getDefaultDrawState());
  const forceSelectFirstSessionRef = useRef(false);
  const rafRef = useRef(0);
  const mapboxAccessToken = normalizeMapboxToken(RAW_MAPBOX_ACCESS_TOKEN);

  const [errorMessage, setErrorMessage] = useState("");
  const [gpsSessions, setGpsSessions] = useState([]);
  const [gpsSessionsLoading, setGpsSessionsLoading] = useState(false);
  const [gpsSessionsError, setGpsSessionsError] = useState("");
  const [selectedGpsSessionId, setSelectedGpsSessionId] = useState("");
  const [gpsTrackLoading, setGpsTrackLoading] = useState(false);
  const [gpsTrackError, setGpsTrackError] = useState("");
  const [gpsTrackSummary, setGpsTrackSummary] = useState(null);
  const [gpsSessionsRefreshToken, setGpsSessionsRefreshToken] = useState(0);
  const [rawTrackVisible, setRawTrackVisible] = useState(true);
  const [correctedTrackVisible, setCorrectedTrackVisible] = useState(true);

  useEffect(() => {
    const controller = new AbortController();

    setGpsSessionsLoading(true);
    setGpsSessionsError("");

    fetch(`${GPS_API_BASE_URL}/gps/sessions`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`세션 목록 조회 실패 (${response.status})`);
        }

        const payload = await response.json();
        if (!Array.isArray(payload)) {
          throw new Error("세션 목록 응답 형식이 올바르지 않습니다.");
        }

        const sortedPayload = sortGpsSessions(payload);
        setGpsSessions(sortedPayload);
        setSelectedGpsSessionId((current) => {
          if (forceSelectFirstSessionRef.current) {
            forceSelectFirstSessionRef.current = false;
            return sortedPayload[0]?.id || "";
          }

          return sortedPayload.some((session) => session.id === current) ? current : sortedPayload[0]?.id || "";
        });
      })
      .catch((error) => {
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }
        setGpsSessionsError(error instanceof Error ? error.message : "세션 목록을 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setGpsSessionsLoading(false);
        }
      });

    return () => controller.abort();
  }, [gpsSessionsRefreshToken]);

  useEffect(() => {
    function handleFlutterSessionEnded(event) {
      const sessionId = event.detail?.sessionId;
      if (!sessionId) {
        return;
      }

      forceSelectFirstSessionRef.current = true;
      setGpsSessionsRefreshToken((current) => current + 1);
    }

    window.addEventListener("flutterSessionEnded", handleFlutterSessionEnded);
    return () => window.removeEventListener("flutterSessionEnded", handleFlutterSessionEnded);
  }, []);

  useEffect(() => {
    if (!selectedGpsSessionId) {
      gpsTrackGeoJsonRef.current = createEmptyFeatureCollection();
      setGpsTrackSummary(null);
      setGpsTrackError("");
      syncGpsTrackLayers();
      return undefined;
    }

    const controller = new AbortController();
    setGpsTrackLoading(true);
    setGpsTrackError("");

    Promise.all([
      fetch(`${GPS_API_BASE_URL}/gps/sessions/${selectedGpsSessionId}/tracks`, { signal: controller.signal }),
      fetch(`${GPS_API_BASE_URL}/gps/sessions/${selectedGpsSessionId}/summary`, { signal: controller.signal }),
    ])
      .then(async ([tracksResponse, summaryResponse]) => {
        if (!tracksResponse.ok) {
          throw new Error(`트래킹 경로 조회 실패 (${tracksResponse.status})`);
        }
        if (!summaryResponse.ok) {
          throw new Error(`테스트 결과 조회 실패 (${summaryResponse.status})`);
        }

        const tracksPayload = await tracksResponse.json();
        const summaryPayload = await summaryResponse.json();
        gpsTrackGeoJsonRef.current = createGpsTrackGeoJson(tracksPayload);
        setGpsTrackSummary(summaryPayload);
        syncGpsTrackLayers();

        const firstCoordinate = gpsTrackGeoJsonRef.current.features.find((feature) => feature.properties?.kind === "start")?.geometry?.coordinates;
        if (Array.isArray(firstCoordinate) && firstCoordinate.length === 2) {
          mapRef.current?.easeTo({
            center: firstCoordinate,
            zoom: 18,
            offset: getPanelAwareOffset(),
            duration: 900,
          });
        }
      })
      .catch((error) => {
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }
        gpsTrackGeoJsonRef.current = createEmptyFeatureCollection();
        setGpsTrackSummary(null);
        setGpsTrackError(error instanceof Error ? error.message : "트래킹 결과를 불러오지 못했습니다.");
        syncGpsTrackLayers();
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setGpsTrackLoading(false);
        }
      });

    return () => controller.abort();
  }, [selectedGpsSessionId]);

  useEffect(() => {
    updateGpsTrackVisibility();
  }, [rawTrackVisible, correctedTrackVisible]);

  useEffect(() => {
    if (!mapboxAccessToken) {
      setErrorMessage("`.env` 파일에 `VITE_MAPBOX_ACCESS_TOKEN=...` 값을 추가한 뒤 개발 서버를 다시 시작하세요.");
      return undefined;
    }

    let cancelled = false;

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
          zoom: 18,
          bearing: DEFAULT_BEARING,
          pitch: DEFAULT_PITCH,
          antialias: true,
        });

        gpsHoverPopupRef.current = new mapboxgl.Popup({
          closeButton: false,
          closeOnClick: false,
          offset: 14,
        });

        mapRef.current = map;

        const handleStyleLoad = () => {
          if (cancelled) {
            return;
          }
          applyKoreanLabels(map);
          ensureGridLayer(map);
          ensureGpsTrackLayers(map);
          scheduleGridDraw();
          syncGpsTrackLayers();
        };

        map.on("load", handleStyleLoad);
        map.on("style.load", handleStyleLoad);
        map.on("move", scheduleGridDraw);
        map.on("rotate", scheduleGridDraw);
        map.on("zoom", scheduleGridDraw);
        map.on("mouseenter", GPS_TRACK_RAW_POINT_LAYER_ID, handleGpsTrackPointMouseEnter);
        map.on("mouseenter", GPS_TRACK_CORRECTED_POINT_LAYER_ID, handleGpsTrackPointMouseEnter);
        map.on("mousemove", GPS_TRACK_RAW_POINT_LAYER_ID, handleGpsTrackPointMouseMove);
        map.on("mousemove", GPS_TRACK_CORRECTED_POINT_LAYER_ID, handleGpsTrackPointMouseMove);
        map.on("mouseleave", GPS_TRACK_RAW_POINT_LAYER_ID, handleGpsTrackPointMouseLeave);
        map.on("mouseleave", GPS_TRACK_CORRECTED_POINT_LAYER_ID, handleGpsTrackPointMouseLeave);
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
      gpsHoverPopupRef.current?.remove();
      gpsHoverPopupRef.current = null;
      mapboxGlRef.current = null;
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

    const { gridVisible, gridWidth, gridHeight, rotationDeg, offsetX, offsetY, origin } = drawStateRef.current;
    const gridSource = map.getSource(GRID_SOURCE_ID);
    if (!gridSource) {
      return;
    }

    if (!gridVisible) {
      gridSource.setData(createEmptyFeatureCollection());
      return;
    }

    const canvas = map.getCanvas();
    const corners = [
      map.unproject([0, 0]),
      map.unproject([canvas.width, 0]),
      map.unproject([canvas.width, canvas.height]),
      map.unproject([0, canvas.height]),
    ].map((point) => ({ lat: point.lat, lng: point.lng }));

    const { data } = buildGridGeoJson({
      corners,
      origin,
      gridWidth,
      gridHeight,
      rotationDeg,
      offsetX,
      offsetY,
    });

    gridSource.setData(data);
  }

  function ensureGpsTrackLayers(map) {
    if (!map.getSource(GPS_TRACK_SOURCE_ID)) {
      map.addSource(GPS_TRACK_SOURCE_ID, {
        type: "geojson",
        data: gpsTrackGeoJsonRef.current,
      });
    }

    if (!map.getLayer(GPS_TRACK_RAW_LAYER_ID)) {
      map.addLayer({
        id: GPS_TRACK_RAW_LAYER_ID,
        type: "line",
        source: GPS_TRACK_SOURCE_ID,
        filter: ["==", ["get", "kind"], "raw"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#ef4444",
          "line-width": 3,
          "line-opacity": 0.95,
          "line-dasharray": [2, 2],
        },
      });
    }

    if (!map.getLayer(GPS_TRACK_CORRECTED_LAYER_ID)) {
      map.addLayer({
        id: GPS_TRACK_CORRECTED_LAYER_ID,
        type: "line",
        source: GPS_TRACK_SOURCE_ID,
        filter: ["==", ["get", "kind"], "corrected"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#2563eb",
          "line-width": 4,
          "line-opacity": 0.95,
        },
      });
    }

    if (!map.getLayer(GPS_TRACK_RAW_POINT_LAYER_ID)) {
      map.addLayer({
        id: GPS_TRACK_RAW_POINT_LAYER_ID,
        type: "circle",
        source: GPS_TRACK_SOURCE_ID,
        filter: ["==", ["get", "kind"], "raw-point"],
        paint: {
          "circle-radius": 4,
          "circle-color": "#ef4444",
          "circle-opacity": 0.38,
          "circle-stroke-width": 1,
          "circle-stroke-color": "#fecaca",
        },
      });
    }

    if (!map.getLayer(GPS_TRACK_CORRECTED_POINT_LAYER_ID)) {
      map.addLayer({
        id: GPS_TRACK_CORRECTED_POINT_LAYER_ID,
        type: "circle",
        source: GPS_TRACK_SOURCE_ID,
        filter: ["==", ["get", "kind"], "corrected-point"],
        paint: {
          "circle-radius": 4,
          "circle-color": "#2563eb",
          "circle-opacity": 0.82,
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#dbeafe",
        },
      });
    }

    if (!map.getLayer(GPS_TRACK_START_LAYER_ID)) {
      map.addLayer({
        id: GPS_TRACK_START_LAYER_ID,
        type: "circle",
        source: GPS_TRACK_SOURCE_ID,
        filter: ["==", ["get", "kind"], "start"],
        paint: {
          "circle-radius": 6,
          "circle-color": "#ffffff",
          "circle-stroke-width": 3,
          "circle-stroke-color": "#0f1720",
        },
      });
    }
  }

  function syncGpsTrackLayers() {
    const gpsTrackSource = mapRef.current?.getSource(GPS_TRACK_SOURCE_ID);
    if (!gpsTrackSource) {
      return;
    }

    gpsTrackSource.setData(gpsTrackGeoJsonRef.current);
    updateGpsTrackVisibility();
  }

  function updateGpsTrackVisibility() {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    if (map.getLayer(GPS_TRACK_RAW_LAYER_ID)) {
      map.setLayoutProperty(GPS_TRACK_RAW_LAYER_ID, "visibility", rawTrackVisible ? "visible" : "none");
    }
    if (map.getLayer(GPS_TRACK_RAW_POINT_LAYER_ID)) {
      map.setLayoutProperty(GPS_TRACK_RAW_POINT_LAYER_ID, "visibility", rawTrackVisible ? "visible" : "none");
    }
    if (map.getLayer(GPS_TRACK_CORRECTED_LAYER_ID)) {
      map.setLayoutProperty(GPS_TRACK_CORRECTED_LAYER_ID, "visibility", correctedTrackVisible ? "visible" : "none");
    }
    if (map.getLayer(GPS_TRACK_CORRECTED_POINT_LAYER_ID)) {
      map.setLayoutProperty(GPS_TRACK_CORRECTED_POINT_LAYER_ID, "visibility", correctedTrackVisible ? "visible" : "none");
    }
    if (map.getLayer(GPS_TRACK_START_LAYER_ID)) {
      map.setLayoutProperty(
        GPS_TRACK_START_LAYER_ID,
        "visibility",
        rawTrackVisible || correctedTrackVisible ? "visible" : "none",
      );
    }
  }

  function buildGpsTrackTooltipHtml(feature) {
    const properties = feature?.properties ?? {};
    const pointType = properties.kind === "corrected-point" ? "보정 좌표" : "원본 좌표";
    const lat = Number(properties.lat);
    const lng = Number(properties.lng);

    return `
      <div class="gps-track-tooltip">
        <div><strong>유형</strong>${pointType}</div>
        <div><strong>순번</strong>${properties.pointIndex ?? "-"}</div>
        <div><strong>위도</strong>${Number.isFinite(lat) ? lat.toFixed(6) : "-"}</div>
        <div><strong>경도</strong>${Number.isFinite(lng) ? lng.toFixed(6) : "-"}</div>
        <div><strong>정확도</strong>${formatGpsMetric(properties.accuracy, "m")}</div>
        <div><strong>기록시각</strong>${formatGpsSessionDate(properties.recordedAt)}</div>
      </div>
    `;
  }

  function handleGpsTrackPointMouseEnter(event) {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    map.getCanvas().style.cursor = "pointer";
    handleGpsTrackPointMouseMove(event);
  }

  function handleGpsTrackPointMouseMove(event) {
    const popup = gpsHoverPopupRef.current;
    const map = mapRef.current;
    const feature = event.features?.[0];
    if (!popup || !map || !feature) {
      return;
    }

    popup.setLngLat(event.lngLat).setHTML(buildGpsTrackTooltipHtml(feature)).addTo(map);
  }

  function handleGpsTrackPointMouseLeave() {
    if (mapRef.current) {
      mapRef.current.getCanvas().style.cursor = "";
    }
    gpsHoverPopupRef.current?.remove();
  }

  function getPanelAwareOffset() {
    const panelWidth = gpsPanelRef.current?.offsetWidth ?? 0;
    if (!panelWidth) {
      return [0, 0];
    }

    return [Math.round(panelWidth * -0.45), 0];
  }

  return (
    <div className="app-shell">
      <GpsTrackVisibilityPanel
        rawVisible={rawTrackVisible}
        correctedVisible={correctedTrackVisible}
        onToggleRawVisible={setRawTrackVisible}
        onToggleCorrectedVisible={setCorrectedTrackVisible}
      />
      <GpsTestPanel
        panelRef={gpsPanelRef}
        gpsSessions={gpsSessions}
        gpsSessionsLoading={gpsSessionsLoading}
        gpsSessionsError={gpsSessionsError}
        selectedGpsSessionId={selectedGpsSessionId}
        gpsTrackLoading={gpsTrackLoading}
        gpsTrackError={gpsTrackError}
        gpsTrackSummary={gpsTrackSummary}
        formatGpsSessionDate={formatGpsSessionDate}
        getGpsResultRows={getGpsResultRows}
        onRefresh={() => setGpsSessionsRefreshToken((current) => current + 1)}
        onSelectSession={setSelectedGpsSessionId}
      />
      <main ref={mapRootRef} className="map-root map-root--mapbox" aria-label="GPS 테스트 지도" />
      {errorMessage ? <div className="error-banner">{errorMessage}</div> : null}
    </div>
  );
}
