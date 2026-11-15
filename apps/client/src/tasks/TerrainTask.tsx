import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import type { TerrainKind, TerrainMappingPublic, TerrainTile } from "@sm/shared";
import { cssVars } from "./taskTypes";
import type { TaskComponentProps } from "./taskTypes";

const ELEVATION_COLORS = ["#16244a", "#24456b", "#3e6f7d", "#8f8a5f", "#d4bd84"];
const ELEVATION_LABELS = ["Basin floor", "Low plain", "Mid level", "Upland", "Summit"];

const KIND_LABEL: Record<TerrainKind, string> = {
  crater: "Crater",
  mare: "Mare",
  highland: "Highland",
  rille: "Rille",
  ridge: "Wrinkle ridge",
  "landing-site": "Landing site",
};

function elevColor(e: number): string {
  return ELEVATION_COLORS[Math.max(0, Math.min(ELEVATION_COLORS.length - 1, Math.round(e)))];
}

/** Hand-drawn SVG art for each terrain kind. */
export function TileArt({ kind }: { kind: TerrainKind }) {
  switch (kind) {
    case "crater":
      return (
        <svg viewBox="0 0 64 64" className="task-tile-art" aria-hidden="true">
          <rect width="64" height="64" fill="#8c8a86" />
          <circle cx="32" cy="33" r="21" fill="#5a5855" />
          <path d="M13 31 A20 20 0 0 1 50 22" stroke="#d8d4cc" strokeWidth="4" fill="none" strokeLinecap="round" />
          <circle cx="34" cy="36" r="13" fill="#3e3d3b" />
          <circle cx="36" cy="38" r="3.5" fill="#6c6a66" />
          <circle cx="11" cy="54" r="3" fill="#6c6a66" />
          <circle cx="54" cy="10" r="2.4" fill="#6c6a66" />
        </svg>
      );
    case "mare":
      return (
        <svg viewBox="0 0 64 64" className="task-tile-art" aria-hidden="true">
          <rect width="64" height="64" fill="#4b4f5a" />
          <path d="M0 20 Q18 12 34 22 T64 18 V64 H0z" fill="#3c404b" />
          <path d="M0 44 Q20 36 40 46 T64 42 V64 H0z" fill="#33363f" />
          <circle cx="20" cy="30" r="2" fill="#5d626e" />
          <circle cx="46" cy="52" r="1.6" fill="#5d626e" />
          <circle cx="50" cy="28" r="1.2" fill="#5d626e" />
        </svg>
      );
    case "highland":
      return (
        <svg viewBox="0 0 64 64" className="task-tile-art" aria-hidden="true">
          <rect width="64" height="64" fill="#a9a59c" />
          <path d="M0 50 L14 26 L24 40 L36 14 L50 36 L64 22 V64 H0z" fill="#8d8981" />
          <path d="M36 14 L42 24 L38 23 L34 30z" fill="#e3ded3" />
          <path d="M14 26 L18 33 L13 32z" fill="#e3ded3" />
          <circle cx="50" cy="52" r="4" fill="#7a766f" />
          <circle cx="12" cy="10" r="3" fill="#8d8981" />
        </svg>
      );
    case "rille":
      return (
        <svg viewBox="0 0 64 64" className="task-tile-art" aria-hidden="true">
          <rect width="64" height="64" fill="#6b6d72" />
          <path d="M-4 12 C14 8 18 30 30 30 S44 50 68 50" stroke="#2c2d31" strokeWidth="9" fill="none" strokeLinecap="round" />
          <path d="M-4 9 C14 5 18 27 30 27 S44 47 68 47" stroke="#a7a8ab" strokeWidth="1.6" fill="none" />
        </svg>
      );
    case "ridge":
      return (
        <svg viewBox="0 0 64 64" className="task-tile-art" aria-hidden="true">
          <rect width="64" height="64" fill="#5b5e66" />
          <path d="M6 60 C14 44 10 30 22 20 S34 6 40 2" stroke="#9fa2a9" strokeWidth="5" fill="none" strokeLinecap="round" />
          <path d="M8 62 C16 46 12 32 24 22 S36 8 42 4" stroke="#3a3c42" strokeWidth="2.5" fill="none" strokeLinecap="round" />
          <path d="M30 62 C36 50 40 42 54 30" stroke="#8b8e95" strokeWidth="3" fill="none" strokeLinecap="round" />
        </svg>
      );
    case "landing-site":
      return (
        <svg viewBox="0 0 64 64" className="task-tile-art" aria-hidden="true">
          <rect width="64" height="64" fill="#7c7a74" />
          <circle cx="32" cy="32" r="22" fill="#8e8c85" />
          <circle cx="32" cy="32" r="18" fill="none" stroke="#3ddc97" strokeWidth="2.5" strokeDasharray="5 4" />
          <circle cx="32" cy="32" r="7" fill="none" stroke="#3ddc97" strokeWidth="2.5" />
          <path d="M32 18 V46 M18 32 H46" stroke="#3ddc97" strokeWidth="1.5" />
          <path d="M44 12 V24 M44 12 L53 15 L44 18" stroke="#ffffff" strokeWidth="1.6" fill="#ff6b3d" />
        </svg>
      );
  }
}

function ElevationPips({ elevation }: { elevation: number }) {
  return (
    <span className="task-pips" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <i key={i} className={i <= elevation ? "task-pip task-pip--on" : "task-pip"} style={i <= elevation ? { background: elevColor(elevation) } : undefined} />
      ))}
    </span>
  );
}

function TileFace({ tile, locked }: { tile: TerrainTile; locked?: boolean }) {
  return (
    <span className="task-tile-face">
      <TileArt kind={tile.kind} />
      <span className="task-tile-name">{KIND_LABEL[tile.kind]}</span>
      <span className="task-tile-elev">
        <ElevationPips elevation={tile.elevation} />
      </span>
      {locked && (
        <span className="task-tile-lock" aria-hidden="true">
          🔒
        </span>
      )}
    </span>
  );
}

type Source = { from: "tray" } | { from: "cell"; cell: number };

interface DragState {
  tileId: string;
  source: Source;
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  active: boolean; // passed movement threshold
}

const DRAG_THRESHOLD = 6;

export function TerrainTask({ task, onChange }: TaskComponentProps<TerrainMappingPublic>) {
  const cellCount = task.rows * task.cols;
  const tileById = useMemo(() => new Map(task.tiles.map((t) => [t.id, t])), [task.tiles]);
  const anchorCells = useMemo(() => {
    const m = new Map<number, string>();
    for (const [k, v] of Object.entries(task.anchors)) m.set(Number(k), v);
    return m;
  }, [task.anchors]);
  const anchorTileIds = useMemo(() => new Set(anchorCells.values()), [anchorCells]);

  /** Player placements for non-anchor cells: cellIndex -> tileId. */
  const [placed, setPlaced] = useState<Record<number, string>>({});
  const [selected, setSelected] = useState<{ tileId: string; source: Source } | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [hoverCell, setHoverCell] = useState<number | null>(null);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;

  const placedTileIds = useMemo(() => new Set(Object.values(placed)), [placed]);
  const trayTiles = task.tiles.filter((t) => !anchorTileIds.has(t.id) && !placedTileIds.has(t.id));
  const freeCells = cellCount - anchorCells.size;
  const placedCount = Object.keys(placed).length;

  useEffect(() => {
    if (placedCount < freeCells) {
      onChange(null);
      return;
    }
    const mapping: Record<number, string> = {};
    anchorCells.forEach((tileId, cell) => {
      mapping[cell] = tileId;
    });
    for (const [cell, tileId] of Object.entries(placed)) mapping[Number(cell)] = tileId;
    onChange({ taskId: "terrain-mapping", mapping });
  }, [placed, placedCount, freeCells, anchorCells, onChange]);

  /** Move a tile from its source into a cell (swapping with any existing non-anchor tile). */
  const placeInto = (tileId: string, source: Source, cell: number) => {
    if (anchorCells.has(cell)) return;
    setPlaced((prev) => {
      const next = { ...prev };
      const existing = next[cell];
      if (source.from === "cell") {
        if (source.cell === cell) return prev;
        delete next[source.cell];
        if (existing) next[source.cell] = existing; // swap
      }
      // If the source is the tray, an existing tile simply returns to the tray.
      next[cell] = tileId;
      return next;
    });
  };

  const returnToTray = (source: Source) => {
    if (source.from !== "cell") return;
    setPlaced((prev) => {
      const next = { ...prev };
      delete next[source.cell];
      return next;
    });
  };

  const cellFromPoint = (x: number, y: number): number | "tray" | null => {
    const el = document.elementFromPoint(x, y);
    const cellEl = el?.closest<HTMLElement>("[data-cell-index]");
    if (cellEl?.dataset.cellIndex !== undefined) return Number(cellEl.dataset.cellIndex);
    if (el?.closest("[data-tile-tray]")) return "tray";
    return null;
  };

  const startPointer = (e: ReactPointerEvent<HTMLElement>, tileId: string, source: Source) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ tileId, source, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY, active: false });
  };

  const movePointer = (e: ReactPointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const active = d.active || Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > DRAG_THRESHOLD;
    if (active) {
      const target = cellFromPoint(e.clientX, e.clientY);
      setHoverCell(typeof target === "number" ? target : null);
    }
    setDrag({ ...d, x: e.clientX, y: e.clientY, active });
  };

  const endPointer = (e: ReactPointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    setDrag(null);
    setHoverCell(null);
    if (!d.active) {
      activateTile(d.tileId, d.source);
      return;
    }
    const target = cellFromPoint(e.clientX, e.clientY);
    if (typeof target === "number") placeInto(d.tileId, d.source, target);
    else if (target === "tray") returnToTray(d.source);
    setSelected(null);
  };

  /** Click / Enter on a tile: select it, or drop the currently selected tile onto its cell (swap). */
  const activateTile = (tileId: string, source: Source) => {
    if (selected && selected.tileId !== tileId && source.from === "cell") {
      placeInto(selected.tileId, selected.source, source.cell);
      setSelected(null);
      return;
    }
    setSelected((s) => (s && s.tileId === tileId ? null : { tileId, source }));
  };

  const cancelPointer = () => {
    setDrag(null);
    setHoverCell(null);
  };

  const clickCell = (cell: number) => {
    if (anchorCells.has(cell)) return;
    if (selected) {
      placeInto(selected.tileId, selected.source, cell);
      setSelected(null);
    }
  };

  const clickTray = () => {
    if (selected && selected.source.from === "cell") {
      returnToTray(selected.source);
      setSelected(null);
    }
  };

  const draggingId = drag?.active ? drag.tileId : null;
  const dragTile = draggingId ? tileById.get(draggingId) : undefined;

  const tileHandlers = (tileId: string, source: Source) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => startPointer(e, tileId, source),
    onPointerMove: movePointer,
    onPointerUp: endPointer,
    onPointerCancel: cancelPointer,
    onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        activateTile(tileId, source);
      }
    },
  });

  return (
    <div className="task-terrain">
      <div className="task-terrain-main">
        <div
          className="task-terrain-grid"
          style={cssVars({ "--cols": task.cols, "--rows": task.rows })}
          role="grid"
          aria-label="Terrain map"
        >
          {Array.from({ length: cellCount }, (_, i) => {
            const elev = task.cellElevations[i] ?? 0;
            const anchorId = anchorCells.get(i);
            const tileId = anchorId ?? placed[i];
            const tile = tileId ? tileById.get(tileId) : undefined;
            const isAnchor = anchorId !== undefined;
            const match = tile ? tile.elevation === elev : null;
            const row = Math.floor(i / task.cols);
            const col = i % task.cols;
            const cls = [
              "task-terrain-cell",
              isAnchor ? "task-terrain-cell--anchor" : "",
              hoverCell === i && !isAnchor ? "task-terrain-cell--hover" : "",
              selected && !isAnchor && !tile ? "task-terrain-cell--target" : "",
              match === true && !isAnchor ? "task-terrain-cell--match" : "",
              match === false ? "task-terrain-cell--mismatch" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <div
                key={i}
                role="gridcell"
                data-cell-index={i}
                className={cls}
                style={cssVars({ "--elev": elevColor(elev) })}
                onClick={() => clickCell(i)}
                tabIndex={!isAnchor && !tile ? 0 : -1}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    clickCell(i);
                  }
                }}
                aria-label={`Row ${row + 1}, column ${col + 1}, elevation band ${elev}${tile ? `, ${KIND_LABEL[tile.kind]}` : ", empty"}${isAnchor ? ", locked anchor" : ""}`}
              >
                <span className="task-terrain-elev-tag">{elev}</span>
                {tile && (
                  <button
                    type="button"
                    className={`task-tile task-tile--placed${selected?.tileId === tile.id ? " task-tile--selected" : ""}${draggingId === tile.id ? " task-tile--ghosted" : ""}`}
                    disabled={isAnchor}
                    aria-label={`${KIND_LABEL[tile.kind]} tile, elevation ${tile.elevation}${isAnchor ? " (locked)" : ""}`}
                    {...(isAnchor ? {} : tileHandlers(tile.id, { from: "cell", cell: i }))}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <TileFace tile={tile} locked={isAnchor} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <div className="task-terrain-legend" aria-label="Elevation legend">
          {ELEVATION_LABELS.map((l, i) => (
            <span key={l} className="task-terrain-legend-item">
              <i style={{ background: ELEVATION_COLORS[i] }} />
              {i} · {l}
            </span>
          ))}
        </div>
      </div>

      <div className="task-terrain-side">
        <div
          className={`task-panel task-tray${selected?.source.from === "cell" ? " task-tray--drop" : ""}`}
          data-tile-tray
          onClick={clickTray}
        >
          <h4 className="task-panel-title">
            Tile tray <span className="task-muted">({trayTiles.length} left)</span>
          </h4>
          {trayTiles.length === 0 ? (
            <p className="task-muted task-tray-empty">All tiles placed. Drag a tile here to remove it.</p>
          ) : (
            <div className="task-tray-tiles">
              {trayTiles.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`task-tile${selected?.tileId === t.id ? " task-tile--selected" : ""}${draggingId === t.id ? " task-tile--ghosted" : ""}`}
                  aria-pressed={selected?.tileId === t.id}
                  aria-label={`${KIND_LABEL[t.kind]} tile, elevation ${t.elevation}`}
                  {...tileHandlers(t.id, { from: "tray" })}
                  onClick={(e) => e.stopPropagation()}
                >
                  <TileFace tile={t} />
                </button>
              ))}
            </div>
          )}
          <p className="task-caption">
            {selected ? "Now tap a map cell to place the tile" : "Drag tiles onto the map, or tap a tile then a cell"}
          </p>
        </div>

        {task.clues.length > 0 && (
          <div className="task-panel task-clues">
            <h4 className="task-panel-title">Survey clues</h4>
            <ul>
              {task.clues.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {dragTile &&
        drag &&
        createPortal(
          // Portalled to <body> so `position: fixed` isn't trapped by the panel's backdrop-filter.
          <div className="task-drag-ghost" style={{ left: drag.x, top: drag.y }} aria-hidden="true">
            <span className="task-tile">
              <TileFace tile={dragTile} />
            </span>
          </div>,
          document.body,
        )}
    </div>
  );
}
