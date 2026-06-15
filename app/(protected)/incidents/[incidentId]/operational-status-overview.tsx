"use client";

import { useState } from "react";
import { formatNumber } from "@/lib/format";

export type OperationalStatusBreakdownRow = {
  label: string;
  count: number;
};

export type OperationalStatusTile = {
  group: string;
  label: string;
  value: number;
  tone: string;
  details: OperationalStatusBreakdownRow[];
};

export function OperationalStatusOverview({ tiles }: { tiles: OperationalStatusTile[] }) {
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  return (
    <div className="status-overview-grid">
      {tiles.map((tile) => {
        const isOpen = openGroup === tile.group;

        return (
          <article className={`status-tile tone-${tile.tone} ${isOpen ? "open" : ""}`} key={tile.group}>
            <button
              className="status-tile-button"
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpenGroup(isOpen ? null : tile.group)}
            >
              <span>{tile.label}</span>
              <strong>{formatNumber(tile.value)}</strong>
            </button>

            {isOpen ? (
              <div className="status-breakdown-panel">
                <h3>{`\u05e4\u05d9\u05e8\u05d5\u05d8 ${tile.label}`}</h3>
                {tile.details.length === 0 ? (
                  <p>{`\u05d0\u05d9\u05df \u05e4\u05d9\u05e8\u05d5\u05d8 \u05e0\u05d5\u05e1\u05e3`}</p>
                ) : (
                  <>
                    <dl>
                      {tile.details.map((row) => (
                        <div key={row.label}>
                          <dt>{row.label}</dt>
                          <dd>{formatNumber(row.count)}</dd>
                        </div>
                      ))}
                    </dl>
                    <div className="status-breakdown-total">
                      <span>{`\u05e1\u05d4\"\u05db`}</span>
                      <strong>{formatNumber(tile.value)}</strong>
                    </div>
                  </>
                )}
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
