export default function GpsTrackVisibilityPanel({
  rawVisible,
  correctedVisible,
  onToggleRawVisible,
  onToggleCorrectedVisible,
}) {
  return (
    <aside className="gps-track-visibility-panel" aria-label="경로 표시 설정">
      <label className="gps-track-visibility-panel__row gps-track-visibility-panel__row--raw">
        <input type="checkbox" checked={rawVisible} onChange={(event) => onToggleRawVisible(event.target.checked)} />
        <span>보정전</span>
      </label>
      <label className="gps-track-visibility-panel__row gps-track-visibility-panel__row--corrected">
        <input type="checkbox" checked={correctedVisible} onChange={(event) => onToggleCorrectedVisible(event.target.checked)} />
        <span>보정후</span>
      </label>
    </aside>
  );
}
