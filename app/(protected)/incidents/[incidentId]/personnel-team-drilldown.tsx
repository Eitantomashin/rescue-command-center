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

export type PersonnelTeamItem = {
  id: string;
  label: string;
  present: number;
  enRoute: number;
  unavailable: number;
  inactive: number;
  total: number;
  rows: PersonnelTeamRow[];
};

function statusClass(status: PersonnelTeamRow["attendanceStatus"]) {
  if (status === "present") return "success";
  if (status === "en_route") return "warning";
  if (status === "unavailable") return "danger";
  return "neutral";
}

export function PersonnelTeamDrilldown({ teams }: { teams: PersonnelTeamItem[] }) {
  const [openTeamId, setOpenTeamId] = useState<string | null>(null);

  return (
    <div className="personnel-team-dashboard">
      <div className="personnel-team-grid">
        {teams.map((team) => {
          const isOpen = openTeamId === team.id;

          return (
            <button
              className={`personnel-team-card ${isOpen ? "selected" : ""}`}
              type="button"
              key={team.id}
              aria-expanded={isOpen}
              onClick={() => setOpenTeamId(isOpen ? null : team.id)}
            >
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
            </button>
          );
        })}
      </div>

      {openTeamId ? (
        <div className="team-drilldown-panel personnel-dashboard-drilldown">
          {teams.find((team) => team.id === openTeamId)?.rows.length === 0 ? (
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
                  {teams.find((team) => team.id === openTeamId)?.rows.map((row) => (
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
    </div>
  );
}
