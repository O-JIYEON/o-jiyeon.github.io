import { getMeasureModeLabel, MEASURE_MODES } from "../features/mapbox/measurementUtils";

export default function MeasurePanel({
  measureMode,
  activateMeasureMode,
  finishMeasurement,
  clearMeasurement,
  measureValue,
  measureSecondaryValue,
  measureHint,
}) {
  return (
    <aside className="measure-panel" aria-label="측정 도구">
      <p className="eyebrow">MEASURE TOOLS</p>
      <h2>측정</h2>
      <div className="measure-mode-row">
        <button type="button" className={measureMode === MEASURE_MODES.radius ? "is-active" : ""} onClick={() => activateMeasureMode(MEASURE_MODES.radius)}>
          반경
        </button>
        <button type="button" className={measureMode === MEASURE_MODES.area ? "is-active" : ""} onClick={() => activateMeasureMode(MEASURE_MODES.area)}>
          면적
        </button>
        <button type="button" className={measureMode === MEASURE_MODES.distance ? "is-active" : ""} onClick={() => activateMeasureMode(MEASURE_MODES.distance)}>
          거리
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
      <dl className="status-list measure-status-list">
        <div>
          <dt>현재 도구</dt>
          <dd>{getMeasureModeLabel(measureMode)}</dd>
        </div>
        <div>
          <dt>주요 값</dt>
          <dd>{measureValue}</dd>
        </div>
        <div>
          <dt>보조 값</dt>
          <dd>{measureSecondaryValue}</dd>
        </div>
      </dl>
      <p className="mapbox-status">{measureHint}</p>
    </aside>
  );
}
