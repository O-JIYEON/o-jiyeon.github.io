import { useEffect, useState } from "react";

export default function MapboxControlPanel({
  onBack,
  mapStyle,
  setMapStyle,
  mapStyleOptions,
  fixedOverlayVisible,
  setFixedOverlayVisible,
  fixedOverlayOpacity,
  setFixedOverlayOpacity,
  gridVisible,
  setGridVisible,
  rotationDeg,
  setRotationDeg,
  offsetX,
  setOffsetX,
  offsetY,
  setOffsetY,
  bearing,
  setMapBearing,
  spinCamera,
  setOrigin,
  resetGridOffset,
  resetCamera,
  center,
  origin,
  zoom,
  pitch,
  renderCount,
  statusMessage,
}) {
  const [originLatInput, setOriginLatInput] = useState(origin.lat.toFixed(6));
  const [originLngInput, setOriginLngInput] = useState(origin.lng.toFixed(6));

  useEffect(() => {
    setOriginLatInput(origin.lat.toFixed(6));
    setOriginLngInput(origin.lng.toFixed(6));
  }, [origin]);

  function applyOriginInput() {
    const nextLat = Number(originLatInput);
    const nextLng = Number(originLngInput);
    if (!Number.isFinite(nextLat) || !Number.isFinite(nextLng)) {
      return;
    }

    setOrigin({ lat: nextLat, lng: nextLng });
  }

  return (
    <aside className="control-panel control-panel--mapbox">
      {onBack ? (
        <button className="back-button" type="button" aria-label="뒤로" onClick={onBack}>
          &#x2039;
        </button>
      ) : null}

      <p className="eyebrow">MAPBOX VIEW</p>
      {/*<h1>Rotate Map</h1>*/}
      <section className="dev-panel-block">
        <label className="field">
          <span>지도 타입</span>
          <select value={mapStyle} onChange={(event) => setMapStyle(event.target.value)}>
            {mapStyleOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="toggle-row">
          <span>격자 표시</span>
          <input type="checkbox" checked={gridVisible} onChange={(event) => setGridVisible(event.target.checked)} />
        </label>

        <label className="toggle-row">
          <span className="field-label--updated">도면 레이어 표시</span>
          <input type="checkbox" checked={fixedOverlayVisible} onChange={(event) => setFixedOverlayVisible(event.target.checked)} />
        </label>

        <label className="field">
          <span className="field-label--updated">도면 Opacity({fixedOverlayOpacity})</span>
          <input
            type="number"
            min="0"
            max="1"
            step="0.1"
            value={fixedOverlayOpacity}
            onChange={(event) => setFixedOverlayOpacity(event.target.value)}
          />
        </label>

        {/*<label className="field">*/}
        {/*  <span>격자 회전({rotationDeg}deg)</span>*/}
        {/*  <input type="number" min="-180" max="180" step="1" value={rotationDeg} onChange={(event) => setRotationDeg(Number(event.target.value))} />*/}
        {/*</label>*/}

        {/*<label className="field">*/}
        {/*  <span>X offset({offsetX}m)</span>*/}
        {/*  <input type="number" min="-200" max="200" step="1" value={offsetX} onChange={(event) => setOffsetX(Number(event.target.value))} />*/}
        {/*</label>*/}

        {/*<label className="field">*/}
        {/*  <span>Y offset({offsetY}m)</span>*/}
        {/*  <input type="number" min="-200" max="200" step="1" value={offsetY} onChange={(event) => setOffsetY(Number(event.target.value))} />*/}
        {/*</label>*/}

        <label className="field">
          <span>지도 회전({bearing}deg)</span>
          <input type="number" min="-180" max="180" step="0.1" value={bearing} onChange={(event) => setMapBearing(Number(event.target.value))} />
        </label>

        {/*<label className="field">*/}
        {/*  <span className="field-label--updated">원점 위도</span>*/}
        {/*  <input type="number" step="0.000001" value={originLatInput} onChange={(event) => setOriginLatInput(event.target.value)} />*/}
        {/*</label>*/}

        {/*<label className="field">*/}
        {/*  <span className="field-label--updated">원점 경도</span>*/}
        {/*  <input type="number" step="0.000001" value={originLngInput} onChange={(event) => setOriginLngInput(event.target.value)} />*/}
        {/*</label>*/}

        {/*<div className="button-row">*/}
        {/*  <button type="button" onClick={applyOriginInput}>*/}
        {/*    원점 적용*/}
        {/*  </button>*/}
        {/*</div>*/}
      </section>

      <dl className="status-list">
        <div>
          <dt>현재 중심</dt>
          <dd>{center}</dd>
        </div>
        {/*<div>*/}
        {/*  <dt>격자 원점</dt>*/}
        {/*  <dd>{`${origin.lat.toFixed(6)}, ${origin.lng.toFixed(6)}`}</dd>*/}
        {/*</div>*/}
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
        {/*<div>*/}
        {/*  <dt>렌더 선 수</dt>*/}
        {/*  <dd>{renderCount}</dd>*/}
        {/*</div>*/}
        {/*<div>*/}
        {/*  <dt>격자 오프셋</dt>*/}
        {/*  <dd>{`${offsetX}m, ${offsetY}m`}</dd>*/}
        {/*</div>*/}
      </dl>

      {/*<p className="mapbox-status">{statusMessage}</p>*/}
    </aside>
  );
}
