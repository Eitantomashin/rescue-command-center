"use client";

import { useState } from "react";
import { formatDateTime, formatNumber } from "@/lib/format";

export type PersonnelTeamRow = {
  id: string;
  fullName: string;
  roleLabel: string;
  phone: string | null;
  attendanceStatus: "present" | "en_route" | "unavailable" | "inactive";
  attendanceLabel: string;
  updatedAt: string | null;
};

export type PersonnelTeamOperationalRow = {
  personId: string;
  operationalNumber: number;
  personName: string | null;
  siteName: string;
  statusLabel: string;
  gridCell: string | null;
  latestReportedAt: string | null;
};

export type PersonnelTeamItem = {
  id: string;
  label: string;
  present: number;
  enRoute: number;
  unavailable: number;
  inactive: number;
  total: number;
  rows: PersonnelTeamRow[];
  operationalRows: PersonnelTeamOperationalRow[];
};

type DrilldownMode = "personnel" | "operational";

function statusClass(status: PersonnelTeamRow["attendanceStatus"]) {
  if (status === "present") return "success";
  if (status === "en_route") return "warning";
  if (status === "unavailable") return "danger";
  return "neutral";
}

export function PersonnelTeamDrilldown({ teams }: { teams: PersonnelTeamItem[] }) {
  const [openDrilldown, setOpenDrilldown] = useState<{ teamId: string; mode: DrilldownMode } | null>(null);
  const openTeam = teams.find((team) => team.id === openDrilldown?.teamId) ?? null;

  function toggleDrilldown(teamId: string, mode: DrilldownMode) {
    setOpenDrilldown((current) => {
      if (current?.teamId === teamId && current.mode === mode) {
        return null;
      }

      return { teamId, mode };
    });
  }

  return (
    <div className="personnel-team-dashboard">
      <div className="personnel-team-grid">
        {teams.map((team) => {
          const personnelOpen = openDrilldown?.teamId === team.id && openDrilldown.mode === "personnel";
          const operationalOpen = openDrilldown?.teamId === team.id && openDrilldown.mode === "operational";

          return (
            <article className={`personnel-team-card ${personnelOpen || operationalOpen ? "selected" : ""}`} key={team.id}>
              <div className="section-title-row">
                <h3>{team.label}</h3>
                <span className="status-pill neutral">סה״כ {formatNumber(team.total)}</span>
              </div>
              <dl className="personnel-team-counts">
                <div>
                  <dt>נוכחים</dt>
                  <dd>{formatNumber(team.present)}</dd>
                </div>
                <div>
                  <dt>בדרך</dt>
                  <dd>{formatNumber(team.enRoute)}</dd>
                </div>
                <div>
                  <dt>לא זמין</dt>
                  <dd>{formatNumber(team.unavailable)}</dd>
                </div>
                <div>
                  <dt>לא פעיל</dt>
                  <dd>{formatNumber(team.inactive)}</dd>
                </div>
              </dl>
              <div className="personnel-team-actions" aria-label={`פעולות ${team.label}`}>
                <button
                  className={`button compact ${personnelOpen ? "" : "secondary"}`}
                  type="button"
                  aria-expanded={personnelOpen}
                  onClick={() => toggleDrilldown(team.id, "personnel")}
                >
                  כ״א
                </button>
                <button
                  className={`button compact ${operationalOpen ? "" : "secondary"}`}
                  type="button"
                  aria-expanded={operationalOpen}
                  onClick={() => toggleDrilldown(team.id, "operational")}
                >
                  מספרים מבצעיים
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {openTeam && openDrilldown?.mode === "personnel" ? (
        <div className="team-drilldown-panel personnel-dashboard-drilldown">
          <div className="command-section-heading compact-heading">
            <h3>כ״א - {openTeam.label}</h3>
          </div>
          {openTeam.rows.length === 0 ? (
            <p className="muted">אין אנשי כ״א להצגה בצוות זה.</p>
          ) : (
            <div className="table-scroll">
              <table className="table compact-analysis-table">
                <thead>
                  <tr>
                    <th>שם מלא</th>
                    <th>תפקיד</th>
                    <th>טלפון</th>
                    <th>סטטוס</th>
                    <th>זמן עדכון אחרון</th>
                  </tr>
                </thead>
                <tbody>
                  {openTeam.rows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.fullName}</td>
                      <td>{row.roleLabel}</td>
                      <td>{row.phone ?? "-"}</td>
                      <td>
                        <span className={`status-pill ${statusClass(row.attendanceStatus)}`}>{row.attendanceLabel}</span>
                      </td>
                      <td>{row.updatedAt ? formatDateTime(row.updatedAt) : "לא עודכן"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      {openTeam && openDrilldown?.mode === "operational" ? (
        <div className="team-drilldown-panel personnel-dashboard-drilldown">
          <div className="command-section-heading compact-heading">
            <h3>מספרים מבצעיים - {openTeam.label}</h3>
          </div>
          {openTeam.operationalRows.length === 0 ? (
            <p className="muted">אין מספרים מבצעיים להצגה לצוות זה.</p>
          ) : (
            <div className="table-scroll">
              <table className="table compact-analysis-table">
                <thead>
                  <tr>
                    <th>מספר מבצעי</th>
                    <th>שם</th>
                    <th>אתר</th>
                    <th>סטטוס אחרון</th>
                    <th>תא שטח</th>
                    <th>זמן עדכון אחרון</th>
                  </tr>
                </thead>
                <tbody>
                  {openTeam.operationalRows.map((row) => (
                    <tr key={row.personId}>
                      <td>#{row.operationalNumber}</td>
                      <td>{row.personName ?? "שם לא ידוע"}</td>
                      <td>{row.siteName}</td>
                      <td>{row.statusLabel}</td>
                      <td>{row.gridCell ?? "-"}</td>
                      <td>{row.latestReportedAt ? formatDateTime(row.latestReportedAt) : "לא עודכן"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
