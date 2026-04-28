export default function MapboxControlPanel({
  onBack,
  gridWidth,
  setGridWidth,
  gridHeight,
  setGridHeight,
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
  setOriginToCenter,
  resetGridOffset,
  resetCamera,
  center,
  origin,
  zoom,
  pitch,
  renderCount,
  statusMessage,
}) {
  return (
    <aside className="control-panel control-panel--mapbox">
      <button className="back-button" type="button" aria-label="뒤로" onClick={onBack}>
        &#x2039;
      </button>

      <p className="eyebrow">MAPBOX VIEW</p>
      <h1>Rotate Map</h1>
      <section className="dev-panel-block">
        <label className="field">
          <span>가로(m)</span>
          <input type="number" min="5" step="5" value={gridWidth} onChange={(event) => setGridWidth(Number(event.target.value))} />
        </label>

        <label className="field">
          <span>세로(m)</span>
          <input type="number" min="5" step="5" value={gridHeight} onChange={(event) => setGridHeight(Number(event.target.value))} />
        </label>

        <label className="toggle-row">
          <span>격자 표시</span>
          <input type="checkbox" checked={gridVisible} onChange={(event) => setGridVisible(event.target.checked)} />
        </label>

        <label className="field">
          <span>격자 회전({rotationDeg}deg)</span>
          <input type="number" min="-180" max="180" step="1" value={rotationDeg} onChange={(event) => setRotationDeg(Number(event.target.value))} />
        </label>

        <label className="field">
          <span>X offset({offsetX}m)</span>
          <input type="number" min="-200" max="200" step="1" value={offsetX} onChange={(event) => setOffsetX(Number(event.target.value))} />
        </label>

        <label className="field">
          <span>Y offset({offsetY}m)</span>
          <input type="number" min="-200" max="200" step="1" value={offsetY} onChange={(event) => setOffsetY(Number(event.target.value))} />
        </label>

        <label className="field">
          <span>지도 회전({bearing}deg)</span>
          <input type="number" min="-180" max="180" step="1" value={bearing} onChange={(event) => setMapBearing(Number(event.target.value))} />
        </label>

        <p className="rotation-hint">
          지도와 격자 값은 숫자로 직접 입력할 수 있고, 지도는 우클릭 드래그로 rotation만 직접 조정할 수 있습니다. 틸트는 0deg로 고정됩니다.
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
          <button type="button" onClick={resetGridOffset}>
            오프셋 초기화
          </button>
          <button type="button" onClick={resetCamera}>
            카메라 초기화
          </button>
        </div>
      </section>

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
        <div>
          <dt>격자 오프셋</dt>
          <dd>{`${offsetX}m, ${offsetY}m`}</dd>
        </div>
      </dl>

      <p className="mapbox-status">{statusMessage}</p>
    </aside>
  );
}
