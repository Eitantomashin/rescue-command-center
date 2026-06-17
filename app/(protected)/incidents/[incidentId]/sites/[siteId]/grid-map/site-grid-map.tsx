"use client";

import { useMemo, useState } from "react";
import { formatDateTime, formatNumber } from "@/lib/format";

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

type ParsedMarker = GridMarker & {
  normalizedCell: string;
  x: number;
  y: number;
};

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
    x: ((numberIndex + 0.5) / GRID_NUMBERS.length) * 100,
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

export function SiteGridMap({
  imageUrl,
  markers
}: {
  imageUrl: string | null;
  markers: GridMarker[];
}) {
  const [showGrid, setShowGrid] = useState(true);
  const [filter, setFilter] = useState("all");
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
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
  const visibleMarkers = parsed.valid.filter((marker) => markerMatchesFilter(marker, filter));
  const selectedMarker = visibleMarkers.find((marker) => marker.personId === selectedPersonId) ?? null;
  const activeCells = new Set(visibleMarkers.map((marker) => marker.normalizedCell));
  const rescuedCount = visibleMarkers.filter((marker) => marker.statusGroup === "rescued").length;
  const evacuatedCount = visibleMarkers.filter((marker) => marker.statusGroup === "evacuated").length;
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
        <button className="button secondary" type="button" onClick={() => setShowGrid((value) => !value)}>
          {showGrid ? "הסתר גריד" : "הצג גריד"}
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

      <section className="grid-map-stage" aria-label="מפת פעילות אתר">
        {imageUrl ? (
          <div className="grid-map-image-frame">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl} alt="תמונת אתר" />
            {showGrid ? (
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
            {visibleMarkers.map((marker) => (
              <button
                className={`grid-marker marker-${markerTone(marker)}`}
                key={marker.personId}
                type="button"
                style={{ left: `${marker.x}%`, top: `${marker.y}%` }}
                onClick={() => setSelectedPersonId(selectedPersonId === marker.personId ? null : marker.personId)}
                title={`#${marker.operationalNumber} ${marker.normalizedCell}`}
              >
                #{marker.operationalNumber}
              </button>
            ))}
            {selectedMarker ? (
              <aside className="grid-marker-popup">
                <strong>#{selectedMarker.operationalNumber}</strong>
                <span>{selectedMarker.personName ?? "שם לא ידוע"}</span>
                <span>{selectedMarker.statusLabel ?? "סטטוס לא ידוע"}</span>
                <span>{selectedMarker.normalizedCell}</span>
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
    </div>
  );
}
