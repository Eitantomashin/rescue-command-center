"use client";

import { useMemo, useState } from "react";
import type { MouseEvent } from "react";
import { formatDateTime, formatNumber } from "@/lib/format";
import { createSiteMapObject, updateSiteMapObject } from "./actions";

const GRID_LETTERS = ["א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט", "י"];
const GRID_NUMBERS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

export type GridMarker = {
  personId: string;
  operationalNumber: number;
  personName: string | null;
  statusLabel: string | null;
  statusGroup: string | null;
  cardColor: string | null;
  latestReportedAt: string | null;
  teamNumber: number | null;
  gridCell: string | null;
};

export type MapTeam = {
  teamNumber: number;
  label: string;
};

export type MapPoint = {
  x: number;
  y: number;
};

export type MapObject = {
  id: string;
  objectType: "sector" | "entry_point" | "route";
  name: string;
  assignedTeamNumber: number | null;
  color: string | null;
  operationalStatus: string | null;
  notes: string | null;
  geometry: Record<string, unknown>;
};

type ParsedMarker = GridMarker & {
  normalizedCell: string;
  x: number;
  y: number;
};

type DisplayMarker = ParsedMarker & {
  displayX: number;
  displayY: number;
};

type DraftObject = {
  objectType: "sector" | "entry_point" | "route";
  mode: "cells" | "polygon" | "point" | "route";
  geometry: Record<string, unknown>;
};

const SECTOR_COLORS = [
  { value: "#2563eb", label: "כחול" },
  { value: "#2E7D32", label: "ירוק" },
  { value: "#F58220", label: "כתום" },
  { value: "#7c3aed", label: "סגול" },
  { value: "#D32F2F", label: "אדום" }
];

const SECTOR_STATUSES = [
  ["open", "פתוחה"],
  ["searching", "בסריקה"],
  ["scanned", "נסרקה"],
  ["completed", "הושלמה"]
] as const;

function parseGridCell(value: string | null): { normalizedCell: string; x: number; y: number } | null {
  const normalized = value?.replace(/\s+/g, "").trim();
  if (!normalized) {
    return null;
  }

  const match = normalized.match(/^([אבגדהוזחטי])([0-9]{1,3})$/);
  if (!match) {
    return null;
  }

  const letterIndex = GRID_LETTERS.indexOf(match[1]);
  const number = Number.parseInt(match[2], 10);
  const numberIndex = GRID_NUMBERS.indexOf(number);

  if (letterIndex < 0 || numberIndex < 0) {
    return null;
  }

  return {
    normalizedCell: `${match[1]}${number}`,
    x: ((GRID_NUMBERS.length - numberIndex - 0.5) / GRID_NUMBERS.length) * 100,
    y: ((letterIndex + 0.5) / GRID_LETTERS.length) * 100
  };
}

function markerTone(marker: GridMarker) {
  if (marker.cardColor) {
    return marker.cardColor;
  }

  if (marker.statusGroup === "rescued" || marker.statusGroup === "evacuated" || marker.statusGroup === "located_outside_site") {
    return "green";
  }

  if (marker.statusGroup === "trapped_located_not_yet_rescued" || marker.statusGroup === "in_progress") {
    return "orange";
  }

  if (marker.statusGroup === "missing_unknown") {
    return "red";
  }

  return "gray";
}

function markerMatchesFilter(marker: ParsedMarker, filter: string) {
  if (filter === "all" || filter === "active") {
    return true;
  }

  if (filter === "missing") {
    return marker.statusGroup === "missing_unknown";
  }

  if (filter === "in_progress") {
    return marker.statusGroup === "trapped_located_not_yet_rescued" || marker.statusGroup === "in_progress";
  }

  if (filter === "rescued") {
    return marker.statusGroup === "rescued";
  }

  if (filter === "evacuated") {
    return marker.statusGroup === "evacuated";
  }

  return true;
}

function cellFromPoint(x: number, y: number) {
  const visualColumn = Math.max(0, Math.min(9, Math.floor(x / 10)));
  const number = GRID_NUMBERS[GRID_NUMBERS.length - visualColumn - 1];
  const row = Math.max(0, Math.min(9, Math.floor(y / 10)));
  return `${GRID_LETTERS[row]}${number}`;
}

function cellRect(cell: string) {
  const parsed = parseGridCell(cell);
  if (!parsed) {
    return null;
  }

  return {
    left: parsed.x - 5,
    top: parsed.y - 5,
    width: 10,
    height: 10
  };
}

function pointsFromGeometry(geometry: Record<string, unknown>) {
  const raw = geometry.points;
  return Array.isArray(raw)
    ? raw.filter((point): point is MapPoint =>
        typeof point === "object" &&
        point !== null &&
        typeof (point as MapPoint).x === "number" &&
        typeof (point as MapPoint).y === "number"
      )
    : [];
}

function cellsFromGeometry(geometry: Record<string, unknown>) {
  return Array.isArray(geometry.cells) ? geometry.cells.filter((cell): cell is string => typeof cell === "string") : [];
}

function polygonString(points: MapPoint[]) {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

function pointInPolygon(point: MapPoint, polygon: MapPoint[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects = yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi || 1) + xi;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

function markerSector(marker: ParsedMarker | DisplayMarker, sectors: MapObject[]) {
  return sectors.find((sector) => {
    if (sector.objectType !== "sector") {
      return false;
    }

    const cells = cellsFromGeometry(sector.geometry);
    if (cells.includes(marker.normalizedCell)) {
      return true;
    }

    const points = pointsFromGeometry(sector.geometry);
    return points.length >= 3 && pointInPolygon({ x: marker.x, y: marker.y }, points);
  });
}

function teamLabel(teams: MapTeam[], teamNumber: number | null) {
  if (!teamNumber) {
    return "לא משויך";
  }

  return teams.find((team) => team.teamNumber === teamNumber)?.label ?? (teamNumber === 9 ? "צוות אוכלוסייה" : `צוות ${teamNumber}`);
}

function statusLabel(status: string | null) {
  return SECTOR_STATUSES.find(([value]) => value === status)?.[1] ?? "פתוחה";
}

function sectorVisualColor(sector: MapObject, scannedLayerEnabled: boolean) {
  if (!scannedLayerEnabled) {
    return sector.color ?? "#2563eb";
  }

  if (sector.operationalStatus === "completed" || sector.operationalStatus === "scanned") {
    return "#2E7D32";
  }

  if (sector.operationalStatus === "searching") {
    return "#F9A825";
  }

  return sector.color ?? "#64748b";
}

function pointerPercent(event: MouseEvent<Element>) {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100)),
    y: Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100))
  };
}

function spreadMarkers(markers: ParsedMarker[]): DisplayMarker[] {
  const byCell = markers.reduce((map, marker) => {
    const cellMarkers = map.get(marker.normalizedCell) ?? [];
    cellMarkers.push(marker);
    map.set(marker.normalizedCell, cellMarkers);
    return map;
  }, new Map<string, ParsedMarker[]>());

  return markers.map((marker) => {
    const cellMarkers = byCell.get(marker.normalizedCell) ?? [marker];
    const index = cellMarkers.findIndex((cellMarker) => cellMarker.personId === marker.personId);

    if (cellMarkers.length === 1 || index < 0) {
      return { ...marker, displayX: marker.x, displayY: marker.y };
    }

    const angle = (Math.PI * 2 * index) / cellMarkers.length;
    const radius = Math.min(3.2, 1.4 + cellMarkers.length * 0.28);

    return {
      ...marker,
      displayX: Math.max(2, Math.min(98, marker.x + Math.cos(angle) * radius)),
      displayY: Math.max(2, Math.min(98, marker.y + Math.sin(angle) * radius))
    };
  });
}

export function SiteGridMap({
  incidentId,
  siteId,
  siteName,
  imageUrl,
  markers,
  mapObjects,
  teams
}: {
  incidentId: string;
  siteId: string;
  siteName: string;
  imageUrl: string | null;
  markers: GridMarker[];
  mapObjects: MapObject[];
  teams: MapTeam[];
}) {
  const [filter, setFilter] = useState("all");
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [sectorMode, setSectorMode] = useState(false);
  const [drawMode, setDrawMode] = useState<"none" | "cells" | "polygon" | "entry" | "route">("none");
  const [selectedCells, setSelectedCells] = useState<string[]>([]);
  const [draftPoints, setDraftPoints] = useState<MapPoint[]>([]);
  const [draftObject, setDraftObject] = useState<DraftObject | null>(null);
  const [editingObject, setEditingObject] = useState<MapObject | null>(null);
  const [layers, setLayers] = useState({
    image: true,
    grid: true,
    numbers: true,
    sectors: true,
    entryPoints: true,
    routes: true,
    scanned: true
  });
  const parsed = useMemo(() => {
    const valid: ParsedMarker[] = [];
    const invalid: GridMarker[] = [];

    for (const marker of markers) {
      const parsedCell = parseGridCell(marker.gridCell);
      if (parsedCell) {
        valid.push({ ...marker, ...parsedCell });
      } else if (marker.gridCell?.trim()) {
        invalid.push(marker);
      }
    }

    return { valid, invalid };
  }, [markers]);
  const sectors = mapObjects.filter((object) => object.objectType === "sector");
  const entryPoints = mapObjects.filter((object) => object.objectType === "entry_point");
  const routes = mapObjects.filter((object) => object.objectType === "route");
  const visibleMarkers = spreadMarkers(parsed.valid.filter((marker) => markerMatchesFilter(marker, filter)));
  const selectedMarker = visibleMarkers.find((marker) => marker.personId === selectedPersonId) ?? null;
  const selectedMarkerSector = selectedMarker ? markerSector(selectedMarker, sectors) : null;
  const activeCells = new Set(visibleMarkers.map((marker) => marker.normalizedCell));
  const rescuedCount = visibleMarkers.filter((marker) => marker.statusGroup === "rescued").length;
  const inProgressCount = visibleMarkers.filter((marker) => markerMatchesFilter(marker, "in_progress")).length;
  const missingCount = visibleMarkers.filter((marker) => marker.statusGroup === "missing_unknown").length;

  return (
    <div className="grid-map-workspace">
      <section className="grid-map-summary" aria-label="סיכום סמנים">
        <div>
          <span>מספר סמנים פעילים</span>
          <strong>{formatNumber(visibleMarkers.length)}</strong>
        </div>
        <div>
          <span>חולצו</span>
          <strong>{formatNumber(rescuedCount)}</strong>
        </div>
        <div>
          <span>בטיפול</span>
          <strong>{formatNumber(inProgressCount)}</strong>
        </div>
        <div>
          <span>נעדרים</span>
          <strong>{formatNumber(missingCount)}</strong>
        </div>
        <div>
          <span>תאי שטח פעילים</span>
          <strong>{formatNumber(activeCells.size)}</strong>
        </div>
      </section>

      <div className="grid-map-toolbar">
        <button className="button secondary" type="button" onClick={() => setLayers((value) => ({ ...value, grid: !value.grid }))}>
          {layers.grid ? "הסתר גריד" : "הצג גריד"}
        </button>
        <button className={`button ${sectorMode ? "" : "secondary"}`} type="button" onClick={() => setSectorMode((value) => !value)}>
          ניהול גזרות
        </button>
        <button className="button secondary" type="button" onClick={() => window.print()}>
          הדפס מפת גזרות
        </button>
        <button className="button secondary" type="button" onClick={() => window.print()}>
          ייצוא PDF
        </button>
        <div className="grid-map-filters" aria-label="סינון סמנים">
          {[
            ["all", "הכל"],
            ["missing", "נעדרים"],
            ["in_progress", "בטיפול"],
            ["rescued", "חולצו"],
            ["evacuated", "פונו"],
            ["active", "מספרים פעילים"]
          ].map(([value, label]) => (
            <button
              className={`quick-filter-chip ${filter === value ? "active" : ""}`}
              key={value}
              type="button"
              onClick={() => {
                setFilter(value);
                setSelectedPersonId(null);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {sectorMode ? (
        <section className="panel sector-management-panel">
          <div className="sector-tool-row">
            <button className={`button compact ${drawMode === "cells" ? "" : "secondary"}`} type="button" onClick={() => { setDrawMode("cells"); setDraftPoints([]); }}>
              גזרת תאי גריד
            </button>
            <button className={`button compact ${drawMode === "polygon" ? "" : "secondary"}`} type="button" onClick={() => { setDrawMode("polygon"); setSelectedCells([]); }}>
              גזרה חופשית
            </button>
            <button className={`button compact ${drawMode === "entry" ? "" : "secondary"}`} type="button" onClick={() => { setDrawMode("entry"); setDraftPoints([]); }}>
              נקודת כניסה
            </button>
            <button className={`button compact ${drawMode === "route" ? "" : "secondary"}`} type="button" onClick={() => { setDrawMode("route"); setSelectedCells([]); }}>
              ציר תנועה
            </button>
            {drawMode === "polygon" && draftPoints.length >= 3 ? (
              <button className="button compact" type="button" onClick={() => setDraftObject({ objectType: "sector", mode: "polygon", geometry: { mode: "polygon", points: draftPoints } })}>
                סגור גזרה
              </button>
            ) : null}
            {drawMode === "cells" && selectedCells.length > 0 ? (
              <button className="button compact" type="button" onClick={() => setDraftObject({ objectType: "sector", mode: "cells", geometry: { mode: "cells", cells: selectedCells } })}>
                צור גזרה מהתאים
              </button>
            ) : null}
            {drawMode === "route" && draftPoints.length >= 2 ? (
              <button className="button compact" type="button" onClick={() => setDraftObject({ objectType: "route", mode: "route", geometry: { mode: "route", points: draftPoints } })}>
                שמור ציר
              </button>
            ) : null}
            <button className="button compact secondary" type="button" onClick={() => { setDrawMode("none"); setSelectedCells([]); setDraftPoints([]); setDraftObject(null); }}>
              נקה ציור
            </button>
          </div>

          <div className="layers-panel">
            {[
              ["image", "תמונה"],
              ["grid", "גריד"],
              ["numbers", "מספרים מבצעיים"],
              ["sectors", "גזרות"],
              ["entryPoints", "נקודות כניסה"],
              ["routes", "צירים"],
              ["scanned", "אזורים שנסרקו"]
            ].map(([key, label]) => (
              <label className="checkbox-row" key={key}>
                <input
                  type="checkbox"
                  checked={layers[key as keyof typeof layers]}
                  onChange={(event) => setLayers((value) => ({ ...value, [key]: event.target.checked }))}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </section>
      ) : null}

      <section className="grid-map-stage" aria-label="מפת פעילות אתר">
        {imageUrl ? (
          <div className="grid-map-image-frame">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {layers.image ? <img src={imageUrl} alt="תמונת אתר" /> : <div className="grid-map-image-placeholder" />}
            <svg
              className="sector-overlay"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              onClick={(event) => {
                if (!sectorMode || drawMode === "none") return;
                const point = pointerPercent(event);
                if (drawMode === "cells") {
                  const cell = cellFromPoint(point.x, point.y);
                  setSelectedCells((cells) => cells.includes(cell) ? cells.filter((item) => item !== cell) : [...cells, cell]);
                } else if (drawMode === "polygon") {
                  setDraftPoints((points) => [...points, point]);
                } else if (drawMode === "entry") {
                  setDraftObject({ objectType: "entry_point", mode: "point", geometry: { mode: "point", point } });
                } else if (drawMode === "route") {
                  setDraftPoints((points) => [...points, point]);
                }
              }}
            >
              {layers.sectors ? sectors.map((sector) => {
                const points = pointsFromGeometry(sector.geometry);
                const cells = cellsFromGeometry(sector.geometry);
                const color = sectorVisualColor(sector, layers.scanned);
                return (
                  <g key={sector.id} onClick={(event) => { event.stopPropagation(); setEditingObject(sector); }}>
                    {cells.map((cell) => {
                      const rect = cellRect(cell);
                      return rect ? <rect key={cell} x={rect.left} y={rect.top} width={rect.width} height={rect.height} fill={color} opacity="0.24" stroke={color} strokeWidth="0.4" /> : null;
                    })}
                    {points.length >= 3 ? <polygon points={polygonString(points)} fill={color} opacity="0.24" stroke={color} strokeWidth="0.7" /> : null}
                    {points.length >= 3 ? (
                      <text x={points[0].x} y={points[0].y} fill={color} fontSize="3" fontWeight="700">
                        {teamLabel(teams, sector.assignedTeamNumber)}
                      </text>
                    ) : null}
                    {points.length < 3 && cells.length > 0 ? (() => {
                      const rect = cellRect(cells[0]);
                      return rect ? (
                        <text x={rect.left + 1} y={rect.top + 5} fill={color} fontSize="3" fontWeight="700">
                          {teamLabel(teams, sector.assignedTeamNumber)}
                        </text>
                      ) : null;
                    })() : null}
                  </g>
                );
              }) : null}
              {selectedCells.map((cell) => {
                const rect = cellRect(cell);
                return rect ? <rect key={cell} x={rect.left} y={rect.top} width={rect.width} height={rect.height} fill="#F58220" opacity="0.26" stroke="#F58220" strokeWidth="0.5" /> : null;
              })}
              {draftPoints.length > 0 && (drawMode === "polygon" || drawMode === "route") ? (
                <polyline points={polygonString(draftPoints)} fill="none" stroke="#F58220" strokeWidth="0.7" strokeDasharray="1 1" />
              ) : null}
              {layers.routes ? routes.map((route) => {
                const points = pointsFromGeometry(route.geometry);
                return points.length >= 2 ? <polyline key={route.id} points={polygonString(points)} fill="none" stroke={route.color ?? "#7c3aed"} strokeWidth="0.8" markerEnd="url(#route-arrow)" onClick={(event) => { event.stopPropagation(); setEditingObject(route); }} /> : null;
              }) : null}
              <defs>
                <marker id="route-arrow" markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto">
                  <path d="M0,0 L4,2 L0,4 Z" fill="#7c3aed" />
                </marker>
              </defs>
            </svg>
            {layers.entryPoints ? entryPoints.map((entry) => {
              const point = (entry.geometry.point ?? null) as MapPoint | null;
              return point ? (
                <button className="entry-point-marker" key={entry.id} type="button" style={{ left: `${point.x}%`, top: `${point.y}%` }} onClick={() => setEditingObject(entry)}>
                  🚪
                </button>
              ) : null;
            }) : null}
            {layers.grid ? (
              <div className="grid-overlay" aria-hidden="true">
                {GRID_NUMBERS.map((number, index) => (
                  <span className="grid-number-label" key={number} style={{ insetInlineStart: `${((index + 0.5) / GRID_NUMBERS.length) * 100}%` }}>
                    {number}
                  </span>
                ))}
                {GRID_LETTERS.map((letter, index) => (
                  <span className="grid-letter-label" key={letter} style={{ top: `${((index + 0.5) / GRID_LETTERS.length) * 100}%` }}>
                    {letter}
                  </span>
                ))}
              </div>
            ) : null}
            {layers.numbers ? visibleMarkers.map((marker) => (
              <button
                className={`grid-marker marker-${markerTone(marker)}`}
                key={marker.personId}
                type="button"
                style={{ left: `${marker.displayX}%`, top: `${marker.displayY}%` }}
                onClick={() => setSelectedPersonId(selectedPersonId === marker.personId ? null : marker.personId)}
                title={`#${marker.operationalNumber} ${marker.normalizedCell}`}
              >
                #{marker.operationalNumber}
              </button>
            )) : null}
            {selectedMarker ? (
              <aside className="grid-marker-popup">
                <strong>#{selectedMarker.operationalNumber}</strong>
                <span className="grid-popup-cell">תא שטח: {selectedMarker.normalizedCell}</span>
                {selectedMarkerSector ? <span>גזרה: {selectedMarkerSector.name}</span> : null}
                <span>{selectedMarker.personName ?? "שם לא ידוע"}</span>
                <span>{selectedMarker.statusLabel ?? "סטטוס לא ידוע"}</span>
                {selectedMarker.teamNumber ? <span>צוות {selectedMarker.teamNumber}</span> : null}
                <time>{formatDateTime(selectedMarker.latestReportedAt)}</time>
              </aside>
            ) : null}
          </div>
        ) : (
          <div className="grid-map-empty">
            <h2>אין עדיין תמונת אתר</h2>
            <p>העלה תמונת רחפן או תמונת סקירה כדי להציג עליה את תאי השטח והמספרים המבצעיים.</p>
          </div>
        )}
      </section>

      {parsed.invalid.length > 0 ? (
        <section className="panel invalid-grid-cells">
          <h2>תא שטח לא תקין</h2>
          <ul>
            {parsed.invalid.map((marker) => (
              <li key={marker.personId}>
                <strong>#{marker.operationalNumber}</strong>
                <span>{marker.gridCell}</span>
                <span>{marker.statusLabel ?? "סטטוס לא ידוע"}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {(draftObject || editingObject) ? (
        <section className="panel sector-editor-panel">
          <h2>{editingObject ? "עריכת אובייקט מפה" : "יצירת אובייקט מפה"}</h2>
          <form action={editingObject ? updateSiteMapObject : createSiteMapObject} className="form-grid">
            <input type="hidden" name="incidentId" value={incidentId} />
            <input type="hidden" name="siteId" value={siteId} />
            {editingObject ? <input type="hidden" name="mapObjectId" value={editingObject.id} /> : null}
            <input type="hidden" name="objectType" value={editingObject?.objectType ?? draftObject?.objectType ?? "sector"} />
            <input type="hidden" name="geometry" value={JSON.stringify(editingObject?.geometry ?? draftObject?.geometry ?? {})} />
            <input className="input" name="name" defaultValue={editingObject?.name ?? ""} placeholder="שם" required />
            <select className="input" name="assignedTeamNumber" defaultValue={editingObject?.assignedTeamNumber ?? ""}>
              <option value="">לא משויך</option>
              {teams.map((team) => (
                <option key={team.teamNumber} value={team.teamNumber}>{team.label}</option>
              ))}
            </select>
            <select className="input" name="color" defaultValue={editingObject?.color ?? SECTOR_COLORS[0].value}>
              {SECTOR_COLORS.map((color) => (
                <option key={color.value} value={color.value}>{color.label}</option>
              ))}
            </select>
            <select className="input" name="operationalStatus" defaultValue={editingObject?.operationalStatus ?? "open"}>
              {SECTOR_STATUSES.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <textarea className="input wide" name="notes" defaultValue={editingObject?.notes ?? ""} placeholder="הערות" rows={3} />
            <button className="button" type="submit">שמור</button>
            <button className="button secondary" type="button" onClick={() => { setDraftObject(null); setEditingObject(null); }}>
              ביטול
            </button>
          </form>
        </section>
      ) : null}

      <section className="print-grid-map">
        <h1>{siteName}</h1>
        <p>{new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short" }).format(new Date())}</p>
        <h2>מקרא גזרות</h2>
        <ul>
          {sectors.map((sector) => (
            <li key={sector.id}>
              <span style={{ background: sector.color ?? "#2563eb" }} />
              {sector.name} · {teamLabel(teams, sector.assignedTeamNumber)} · {statusLabel(sector.operationalStatus)}
            </li>
          ))}
        </ul>
        <h2>טבלת דיווח ידני</h2>
        <table>
          <thead>
            <tr>
              <th>מספר מבצעי</th>
              <th>תא שטח</th>
              <th>סטטוס</th>
              <th>צוות</th>
              <th>הערות</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 18 }).map((_, index) => (
              <tr key={index}>
                <td />
                <td />
                <td />
                <td />
                <td />
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
