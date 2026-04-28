import { getMeasureModeLabel, MEASURE_MODES } from "../features/mapbox/measurementUtils";

export default function MeasurePanel({
  measureMode,
  activateMeasureMode,
  finishMeasurement,
  clearMeasurement,
  measureHint,
  selectedCoordinateRows,
}) {
  return (
    <aside className="measure-panel" aria-label="그리기 도구">
      <p className="eyebrow">DRAWING TOOLS</p>
      <h2>그리기 도구</h2>
      <div className="measure-mode-row">
        <button type="button" className={measureMode === MEASURE_MODES.circle ? "is-active" : ""} onClick={() => activateMeasureMode(MEASURE_MODES.circle)}>
          원
        </button>
        <button type="button" className={measureMode === MEASURE_MODES.polygon ? "is-active" : ""} onClick={() => activateMeasureMode(MEASURE_MODES.polygon)}>
          다각형
        </button>
        <button type="button" className={measureMode === MEASURE_MODES.rectangle ? "is-active" : ""} onClick={() => activateMeasureMode(MEASURE_MODES.rectangle)}>
          사각형
        </button>
      </div>
      <div className="measure-action-row">
        <button type="button" onClick={finishMeasurement}>
          완료
        </button>
        <button type="button" onClick={() => clearMeasurement({ keepMode: true })}>
          현재 도형 취소
        </button>
        <button type="button" onClick={() => clearMeasurement({ keepMode: true, clearCompleted: true })}>
          전체 도형 삭제
        </button>
        <button type="button" onClick={() => clearMeasurement({ keepMode: false })}>
          종료
        </button>
      </div>
      {measureMode === MEASURE_MODES.none ? null : (
        <>
          <p className="mapbox-status">{`${getMeasureModeLabel(measureMode)}: ${measureHint}`}</p>
          {selectedCoordinateRows.length > 0 ? (
            <div className="coordinate-panel">
              <p className="coordinate-panel__title">선택 좌표</p>
              <div className="coordinate-list">
                {selectedCoordinateRows.map((row) => (
                  <div key={row.label} className="coordinate-row">
                    <span>{row.label}</span>
                    <code>{row.value}</code>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}
    </aside>
  );
}
