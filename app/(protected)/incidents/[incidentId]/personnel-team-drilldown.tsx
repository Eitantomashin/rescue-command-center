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
  statusGroup: string | null;
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

const STATUS_SEGMENTS = [
  { key: "missing_unknown", label: "נעדר / לא ידוע", className: "missing" },
  { key: "trapped_located_not_yet_rescued", label: "לכוד אותר וטרם חולץ", className: "in-progress" },
  { key: "rescued", label: "מחולצים", className: "completed" },
  { key: "evacuated", label: "פונו", className: "completed" },
  { key: "located_outside_site", label: "אותר מחוץ לאתר", className: "completed" },
  { key: "deceased", label: "נפטרים", className: "deceased" },
  { key: "other", label: "אחר", className: "other" }
] as const;

function statusClass(status: PersonnelTeamRow["attendanceStatus"]) {
  if (status === "present") return "success";
  if (status === "en_route") return "warning";
  if (status === "unavailable") return "danger";
  return "neutral";
}

function segmentKey(row: PersonnelTeamOperationalRow) {
  return STATUS_SEGMENTS.some((segment) => segment.key === row.statusGroup) ? row.statusGroup ?? "other" : "other";
}

function chartTeams(teams: PersonnelTeamItem[]) {
  return teams.filter((team) => team.operationalRows.length > 0 || team.id === "other");
}

export function PersonnelTeamDrilldown({ teams }: { teams: PersonnelTeamItem[] }) {
  const [expanded, setExpanded] = useState(false);
  const [openDrilldown, setOpenDrilldown] = useState<{ teamId: string; mode: DrilldownMode } | null>(null);
  const openTeam = teams.find((team) => team.id === openDrilldown?.teamId) ?? null;
  const visibleChartTeams = chartTeams(teams);
  const maxTeamTotal = Math.max(1, ...visibleChartTeams.map((team) => team.operationalRows.length));

  function toggleDrilldown(teamId: string, mode: DrilldownMode) {
    setExpanded(true);
    setOpenDrilldown((current) => {
      if (current?.teamId === teamId && current.mode === mode) return null;
      return { teamId, mode };
    });
  }

  return (
    <div className="personnel-team-dashboard">
      <button className="floor-toggle-row personnel-team-collapse-header" type="button" onClick={() => setExpanded((value) => !value)}>
        <span>פירוט לפי צוותים</span>
        <span className="floor-toggle-indicator">{expanded ? "סגור" : "פתח"}</span>
      </button>

      {expanded ? (
        <>
          <section className="team-activity-chart" aria-label="פעילות מבצעית לפי צוות">
            <div className="command-section-heading compact-heading">
              <h3>פעילות מבצעית לפי צוות</h3>
            </div>
            {visibleChartTeams.length === 0 ? (
              <p className="muted">אין מספרים מבצעיים להצגה בתרשים.</p>
            ) : (
              <div className="team-stacked-chart">
                {visibleChartTeams.map((team) => {
                  const counts = new Map<string, number>();
                  for (const row of team.operationalRows) {
                    const key = segmentKey(row);
                    counts.set(key, (counts.get(key) ?? 0) + 1);
                  }
                  const total = team.operationalRows.length;
                  const height = Math.max(12, Math.round((total / maxTeamTotal) * 100));

                  return (
                    <div className="team-chart-column" key={team.id}>
                      <button
                        className="team-chart-stack"
                        type="button"
                        style={{ height: `${height}%` }}
                        onClick={() => toggleDrilldown(team.id, "operational")}
                        aria-label={`מספרים מבצעיים ${team.label}`}
                      >
                        {STATUS_SEGMENTS.map((segment) => {
                          const value = counts.get(segment.key) ?? 0;
                          if (value === 0) return null;
                          return (
                            <span
                              className={`team-chart-segment segment-${segment.className}`}
                              key={segment.key}
                              style={{ flexGrow: value }}
                              title={`${segment.label}: ${value}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleDrilldown(team.id, "operational");
                              }}
                            >
                              {formatNumber(value)}
                            </span>
                          );
                        })}
                      </button>
                      <span className="team-chart-label">{team.label}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

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
        </>
      ) : null}

      {expanded && openTeam && openDrilldown?.mode === "personnel" ? (
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

      {expanded && openTeam && openDrilldown?.mode === "operational" ? (
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
