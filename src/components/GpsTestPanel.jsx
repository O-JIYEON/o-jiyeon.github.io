export default function GpsTestPanel({
  gpsSessions,
  gpsSessionsLoading,
  gpsSessionsError,
  selectedGpsSessionId,
  gpsTrackLoading,
  gpsTrackError,
  gpsTrackSummary,
  formatGpsSessionDate,
  getGpsResultRows,
  onRefresh,
  onSelectSession,
}) {
  return (
    <aside className="gps-test-panel" aria-label="GPS 테스트 결과 패널">
      <p className="eyebrow">GPS TEST</p>
      <h2>GPS 테스트 결과</h2>
      <section className="gps-session-list-section" aria-label="GPS 세션 목록">
        <div className="gps-session-list-section__header">
          <h3>세션 목록</h3>
          <div className="gps-session-list-section__actions">
            <span>{gpsSessions.length}건</span>
            <button type="button" className="gps-session-refresh-button" onClick={onRefresh} disabled={gpsSessionsLoading}>
              새로고침
            </button>
          </div>
        </div>

        {gpsSessionsLoading ? <p className="gps-session-list__status">세션 목록을 불러오는 중입니다.</p> : null}
        {gpsSessionsError ? <p className="gps-session-list__status gps-session-list__status--error">{gpsSessionsError}</p> : null}
        {!gpsSessionsLoading && !gpsSessionsError && gpsSessions.length === 0 ? (
          <p className="gps-session-list__status">조회된 GPS 세션이 없습니다.</p>
        ) : null}

        {!gpsSessionsLoading && !gpsSessionsError && gpsSessions.length > 0 ? (
          <div className="gps-session-list">
            {gpsSessions.map((session) => (
              <button
                key={session.id}
                type="button"
                className={`gps-session-card ${selectedGpsSessionId === session.id ? "is-selected" : ""}`}
                onClick={() => onSelectSession(session.id)}
              >
                <div className="gps-session-card__header">
                  <strong>{session.name || "이름 없는 세션"}</strong>
                  <span>{session.pointCount ?? 0} pts</span>
                </div>
                <dl className="gps-session-card__meta">
                  <div>
                    <dt>시작</dt>
                    <dd>{formatGpsSessionDate(session.startedAt)}</dd>
                  </div>
                  <div>
                    <dt>종료</dt>
                    <dd>{formatGpsSessionDate(session.endedAt)}</dd>
                  </div>
                </dl>
              </button>
            ))}
          </div>
        ) : null}
      </section>

      <section className="gps-result-section" aria-label="GPS 테스트 결과">
        <div className="gps-session-list-section__header">
          <h3>테스트 결과</h3>
          <span>{selectedGpsSessionId ? "선택됨" : "미선택"}</span>
        </div>

        {gpsTrackLoading ? <p className="gps-session-list__status">트래킹 결과를 불러오는 중입니다.</p> : null}
        {gpsTrackError ? <p className="gps-session-list__status gps-session-list__status--error">{gpsTrackError}</p> : null}
        {!gpsTrackLoading && !gpsTrackError && !selectedGpsSessionId ? (
          <p className="gps-session-list__status">트래킹 목록에서 항목을 선택하면 결과와 경로를 표시합니다.</p>
        ) : null}
        {!gpsTrackLoading && !gpsTrackError && gpsTrackSummary ? (
          <div className="gps-result-table-wrap">
            <div className="gps-result-table-title">{gpsTrackSummary.name || "선택한 트래킹"}</div>
            <table className="gps-result-table">
              <thead>
                <tr>
                  <th>항목</th>
                  <th>보정 전</th>
                  <th>보정 후</th>
                  <th>개선 효과</th>
                </tr>
              </thead>
              <tbody>
                {getGpsResultRows(gpsTrackSummary).map((row) => (
                  <tr key={row.label}>
                    <td>{row.label}</td>
                    <td>{row.before}</td>
                    <td>{row.after}</td>
                    <td>{row.effect}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </aside>
  );
}
