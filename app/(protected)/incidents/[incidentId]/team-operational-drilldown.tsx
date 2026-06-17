"use client";

import { useState } from "react";
import { formatDateTime, formatNumber } from "@/lib/format";

export type TeamOperationalRow = {
  personId: string;
  operationalNumber: number;
  siteName: string;
  statusLabel: string;
  personName: string | null;
  latestReportedAt: string | null;
};

export type TeamDrilldownItem = {
  id: string;
  label: string;
  commanderName: string | null;
  open: number;
  resolved: number;
  isPopulation: boolean;
  rows: TeamOperationalRow[];
};

export function TeamOperationalDrilldown({ teams }: { teams: TeamDrilldownItem[] }) {
  const [openTeamId, setOpenTeamId] = useState<string | null>(null);

  return (
    <div className="team-overview-grid">
      {teams.map((team) => {
        const isOpen = openTeamId === team.id;

        return (
          <article className={`team-card drilldown-card ${team.isPopulation ? "population-team-card" : ""}`} key={team.id}>
            <button
              className="team-card-button"
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpenTeamId(isOpen ? null : team.id)}
            >
              <div>
                <h3>{team.label}</h3>
                <p className="muted">{team.commanderName || (team.isPopulation ? "צוות 9" : "ללא מפקד צוות")}</p>
              </div>
              <div className="team-card-counts">
                <span>
                  פתוחים <strong>{formatNumber(team.open)}</strong>
                </span>
                <span>
                  נפתרו <strong>{formatNumber(team.resolved)}</strong>
                </span>
              </div>
            </button>

            {isOpen ? (
              <div className="team-drilldown-panel">
                {team.rows.length === 0 ? (
                  <p className="muted">אין מספרים מבצעיים לצוות זה.</p>
                ) : (
                  <div className="table-scroll">
                    <table className="table compact-analysis-table">
                      <thead>
                        <tr>
                          <th>מספר מבצעי</th>
                          <th>אתר</th>
                          <th>סטטוס אחרון</th>
                          <th>שם</th>
                          <th>זמן דיווח אחרון</th>
                        </tr>
                      </thead>
                      <tbody>
                        {team.rows.map((row) => (
                          <tr key={row.personId}>
                            <td>#{row.operationalNumber}</td>
                            <td>{row.siteName}</td>
                            <td>{row.statusLabel}</td>
                            <td>{row.personName ?? "שם לא ידוע"}</td>
                            <td>{formatDateTime(row.latestReportedAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
