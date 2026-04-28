import { useEffect, useState } from "react";
import { getMeasureModeLabel, MEASURE_MODES } from "../features/mapbox/measurementUtils";

function EditableToken({ active, value, suffix = "", onActivate, onChange, onCommit, className = "" }) {
  const [draft, setDraft] = useState(String(value ?? ""));

  useEffect(() => {
    setDraft(String(value ?? ""));
  }, [value, active]);

  if (active) {
    return (
      <input
        autoFocus
        type="number"
        min="1"
        step="1"
        className={`overlay-inline-input ${className}`.trim()}
        value={draft}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => {
          const digitsOnly = event.target.value.replace(/[^\d]/g, "");
          setDraft(digitsOnly);
          onChange?.(digitsOnly);
        }}
        onBlur={() => onCommit?.(draft)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            onCommit?.(draft);
            event.currentTarget.blur();
          }
          if (event.key === "Escape") {
            setDraft(String(value ?? ""));
            event.currentTarget.blur();
          }
        }}
      />
    );
  }

  return (
    <button type="button" className={`overlay-inline-button ${className}`.trim()} onClick={onActivate}>
      {value}
      {suffix}
    </button>
  );
}

function EditableName({ active, value, onActivate, onCommit }) {
  const [draft, setDraft] = useState(value ?? "");

  useEffect(() => {
    setDraft(value ?? "");
  }, [value, active]);

  if (active) {
    return (
      <input
        autoFocus
        type="text"
        className="overlay-name-input"
        value={draft}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => onCommit?.(draft)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            onCommit?.(draft);
            event.currentTarget.blur();
          }
          if (event.key === "Escape") {
            setDraft(value ?? "");
            event.currentTarget.blur();
          }
        }}
      />
    );
  }

  return (
    <button type="button" className="overlay-name-button" onClick={onActivate}>
      {value}
    </button>
  );
}

export default function MeasurePanel({
  measureMode,
  activateMeasureMode,
  measureHint,
  parcelItems,
  blockItems,
  blockColorPalette,
  draftBlockColor,
  parcelVisible,
  blockVisible,
  selectedShape,
  selectedOverlayLabel,
  onToggleParcelVisible,
  onToggleBlockVisible,
  onSelectDraftBlockColor,
  onSelectOverlay,
  onDeleteOverlay,
  onUpdateOverlayName,
  onUpdateCircleDiameter,
  onUpdateRectangleDimension,
  onUpdateBlockColor,
}) {
  const [editingField, setEditingField] = useState(null);
  const [openColorTarget, setOpenColorTarget] = useState(null);

  function isEditing(id, field) {
    return editingField?.id === id && editingField?.field === field;
  }

  function startEdit(item, field) {
    onSelectOverlay({ type: item.type, id: item.id, focusFromList: true });
    setEditingField({ id: item.id, field });
  }

  function commitName(item, nextName) {
    onUpdateOverlayName(item.type, item.id, nextName);
    setEditingField(null);
  }

  function commitCircleDiameter(item, nextValue) {
    onUpdateCircleDiameter(item.id, nextValue);
    setEditingField(null);
  }

  function commitRectangleDimension(item, axis, nextValue) {
    onUpdateRectangleDimension(item.id, axis, nextValue);
    setEditingField(null);
  }

  function renderColorPalette(activeColor, onSelect, className = "") {
    return (
      <div className={`overlay-color-palette ${className}`.trim()} onClick={(event) => event.stopPropagation()}>
        {blockColorPalette.map((color) => (
          <button
            key={color}
            type="button"
            className={`overlay-color-chip ${activeColor === color ? "is-active" : ""}`}
            style={{ "--swatch-color": color }}
            onClick={() => {
              onSelect(color);
              setOpenColorTarget(null);
            }}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="measure-panel-shell">
      {selectedOverlayLabel ? <div className="measure-panel__selected-name">{selectedOverlayLabel}</div> : null}

      <aside className="measure-panel" aria-label="그리기 도구">
        <section className="builder-section builder-section--parcel">
          <div className="builder-section__header">
            <h3>지번 생성</h3>
            <button type="button" className={`measure-panel__ghost-button ${parcelVisible ? "is-active" : ""}`} onClick={onToggleParcelVisible}>
              {parcelVisible ? "ON" : "OFF"}
            </button>
          </div>
          <div className="measure-mode-row measure-mode-row--stacked">
            <button
              type="button"
              className={measureMode === MEASURE_MODES.polygon ? "is-active" : ""}
              onClick={() => activateMeasureMode(MEASURE_MODES.polygon)}
            >
              지번 생성
            </button>
          </div>
          {measureMode === MEASURE_MODES.polygon ? <p className="mapbox-status">{`${getMeasureModeLabel(measureMode)} 생성 중: ${measureHint}`}</p> : null}
          <div className="overlay-list">
            {parcelItems.length === 0 ? (
              <p className="overlay-list__empty">생성된 지번이 없습니다.</p>
            ) : (
              parcelItems.map((item) => (
                <div key={item.id} className={`overlay-list__item ${selectedShape?.id === item.id ? "is-selected" : ""}`} onClick={() => onSelectOverlay({ type: item.type, id: item.id, focusFromList: true })}>
                  <div className="overlay-list__content">
                    <EditableName active={isEditing(item.id, "name")} value={item.title} onActivate={() => startEdit(item, "name")} onCommit={(nextValue) => commitName(item, nextValue)} />
                    <div className="overlay-meta">
                      <span>{item.width}m</span>
                      <span>x</span>
                      <span>{item.height}m</span>
                      <span>,</span>
                      <span>면적 {item.area}m2</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="overlay-list__delete"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDeleteOverlay(item.type, item.id);
                    }}
                  >
                    삭제
                  </button>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="builder-section builder-section--block">
          <div className="builder-section__header">
            <h3>블록 생성</h3>
            <button type="button" className={`measure-panel__ghost-button ${blockVisible ? "is-active" : ""}`} onClick={onToggleBlockVisible}>
              {blockVisible ? "ON" : "OFF"}
            </button>
          </div>
          <div className="measure-mode-row">
            <button
              type="button"
              className={measureMode === MEASURE_MODES.circle ? "is-active" : ""}
              onClick={() => activateMeasureMode(MEASURE_MODES.circle)}
            >
              원
            </button>
            <button
              type="button"
              className={measureMode === MEASURE_MODES.rectangle ? "is-active" : ""}
              onClick={() => activateMeasureMode(MEASURE_MODES.rectangle)}
            >
              사각형
            </button>
          </div>
          <div className="block-color-picker">
            <span>색상</span>
            {renderColorPalette(draftBlockColor, onSelectDraftBlockColor, "overlay-color-palette--static")}
          </div>
          {measureMode === MEASURE_MODES.circle || measureMode === MEASURE_MODES.rectangle ? (
            <p className="mapbox-status">{`${getMeasureModeLabel(measureMode)} 생성 중: ${measureHint}`}</p>
          ) : null}
          <div className="overlay-list">
            {blockItems.length === 0 ? (
              <p className="overlay-list__empty">생성된 블록이 없습니다.</p>
            ) : (
              blockItems.map((item) => (
                <div
                  key={item.id}
                  className={`overlay-list__item ${selectedShape?.id === item.id ? "is-selected" : ""}`}
                  style={item.color ? { "--overlay-item-color": item.color } : undefined}
                  onClick={() => onSelectOverlay({ type: item.type, id: item.id, focusFromList: true })}
                >
                  <div className="overlay-list__content">
                    <EditableName active={isEditing(item.id, "name")} value={item.title} onActivate={() => startEdit(item, "name")} onCommit={(nextValue) => commitName(item, nextValue)} />
                    {item.type === "circle" ? (
                      <div className="overlay-meta">
                        <div className="overlay-color-control">
                          {openColorTarget?.id === item.id && openColorTarget?.field === "color"
                            ? renderColorPalette(item.color, (nextColor) => onUpdateBlockColor(item.type, item.id, nextColor), "overlay-color-palette--popup")
                            : null}
                          <button
                            type="button"
                            className="overlay-color-current"
                            style={{ "--swatch-color": item.color }}
                            onClick={(event) => {
                              event.stopPropagation();
                              setOpenColorTarget(openColorTarget?.id === item.id && openColorTarget?.field === "color" ? null : { id: item.id, field: "color" });
                            }}
                          />
                        </div>
                        <span>지름</span>
                        <EditableToken
                          active={isEditing(item.id, "diameter")}
                          value={item.diameter}
                          suffix="m"
                          onActivate={() => startEdit(item, "diameter")}
                          onCommit={(nextValue) => commitCircleDiameter(item, nextValue)}
                        />
                        <span>,</span>
                        <span>면적 {item.area}m2</span>
                      </div>
                    ) : (
                      <div className="overlay-meta">
                        <div className="overlay-color-control">
                          {openColorTarget?.id === item.id && openColorTarget?.field === "color"
                            ? renderColorPalette(item.color, (nextColor) => onUpdateBlockColor(item.type, item.id, nextColor), "overlay-color-palette--popup")
                            : null}
                          <button
                            type="button"
                            className="overlay-color-current"
                            style={{ "--swatch-color": item.color }}
                            onClick={(event) => {
                              event.stopPropagation();
                              setOpenColorTarget(openColorTarget?.id === item.id && openColorTarget?.field === "color" ? null : { id: item.id, field: "color" });
                            }}
                          />
                        </div>
                        <EditableToken
                          active={isEditing(item.id, "width")}
                          value={item.width}
                          suffix="m"
                          onActivate={() => startEdit(item, "width")}
                          onCommit={(nextValue) => commitRectangleDimension(item, "width", nextValue)}
                        />
                        <span>x</span>
                        <EditableToken
                          active={isEditing(item.id, "height")}
                          value={item.height}
                          suffix="m"
                          onActivate={() => startEdit(item, "height")}
                          onCommit={(nextValue) => commitRectangleDimension(item, "height", nextValue)}
                        />
                        <span>,</span>
                        <span>면적 {item.area}m2</span>
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    className="overlay-list__delete"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDeleteOverlay(item.type, item.id);
                    }}
                  >
                    삭제
                  </button>
                </div>
              ))
            )}
          </div>
        </section>
      </aside>
    </div>
  );
}
