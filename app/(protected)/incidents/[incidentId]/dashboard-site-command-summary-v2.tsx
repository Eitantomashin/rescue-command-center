"use client";

import { useState } from "react";
import { formatDateTime, formatNumber } from "@/lib/format";

export type SiteUnitAnalysisRow = {
  id: string;
  floorNumber: number | null;
  unitLabel: string;
  totalResidents: number;
  expectedPotential: number;
  knownHandled: number;
  gap: number;
};

export type SiteStatusSegments = {
  missingUnknown: number;
  inProgress: number;
  completed: number;
  deceased: number;
  other: number;
};

export type SiteStatusPersonRow = {
  personId: string;
  operationalNumber: number;
  fullName: string | null;
  statusLabel: string;
  teamLabel: string;
  gridCell: string | null;
  latestReportedAt: string | null;
  latestNotes: string | null;
};

export type SiteStatusCard = {
  label: string;
  count: number;
  delta: number | null;
  tone: "blue" | "orange" | "green" | "red" | "neutral";
  people: SiteStatusPersonRow[];
};

export type SiteAnalysisRow = {
  siteId: string;
  name: string;
  address: string;
  statusLabel: string | null;
  initialPotential: number;
  updatedPotential: number;
  activeOperationalNumbers: number;
  knownHandled: number;
  operationalGap: number;
  level: "high" | "medium" | "low";
  teams: string[];
  structureHref: string;
  operationalNumbersHref: string;
  operationalLogHref: string;
  units: SiteUnitAnalysisRow[];
  statusSegments: SiteStatusSegments;
  statusCards: SiteStatusCard[];
};

function gapStatusLabel(site: SiteAnalysisRow) {
  if (site.operationalGap === 0) return "ללא פער";
  if (site.level === "high") return "פער גבוה";
  if (site.level === "medium") return "פער בינוני";
  return "פער נמוך";
}

function DeltaBadge({ value }: { value: number | null }) {
  if (value === null || value === 0) {
    return <span className="site-status-delta neutral">0</span>;
  }

  return (
    <span className={`site-status-delta ${value > 0 ? "up" : "down"}`} dir="ltr">
      {value > 0 ? `+${value}` : value}
    </span>
  );
}

export function DashboardSiteCommandSummary({ sites }: { sites: SiteAnalysisRow[] }) {
  const [openStatus, setOpenStatus] = useState<{ siteId: string; label: string } | null>(null);

  return (
    <section className="panel section-spaced site-decision-panel">
      <div className="command-section-heading">
        <div>
          <h2>פירוט לפי אתר</h2>
          <p className="muted">תמונת מצב תפעולית מלאה לפי אתר, כולל דלתא מול חיתוך המצב האחרון.</p>
        </div>
      </div>

      {sites.length === 0 ? (
        <p className="muted">לא נמצאו אתרים להצגה.</p>
      ) : (
        <div className="site-command-summary-list">
          {sites.map((site) => {
            const activeStatus = site.statusCards.find((status) => openStatus?.siteId === site.siteId && openStatus.label === status.label) ?? null;

            return (
              <article className={`site-command-summary-card coverage-${site.level}`} key={site.siteId}>
                <header className="site-command-summary-top">
                  <div>
                    <h3>{site.name}</h3>
                    <p>{site.address || "ללא כתובת"}</p>
                  </div>
                  <span className={`command-badge coverage-${site.level}`}>{gapStatusLabel(site)}</span>
                </header>

                <div className="site-command-facts" aria-label={`תמונת אתר ${site.name}`}>
                  <div className="site-command-fact fact-initial">
                    <span>פוטנציאל ראשוני</span>
                    <strong>{formatNumber(site.initialPotential)}</strong>
                  </div>
                  <div className="site-command-fact fact-updated">
                    <span>פוטנציאל מעודכן</span>
                    <strong>{formatNumber(site.updatedPotential)}</strong>
                  </div>
                  <div className="site-command-fact fact-gap">
                    <span>פער מבצעי</span>
                    <strong>{formatNumber(site.operationalGap)}</strong>
                  </div>
                  <div className="site-command-fact fact-teams">
                    <span>צוותים פעילים</span>
                    <strong>{formatNumber(site.teams.length)}</strong>
                    <small>{site.teams.length ? site.teams.join(", ") : "ללא צוות"}</small>
                  </div>
                </div>

                <div className="site-anchor-status-grid">
                  {site.statusCards.length === 0 ? (
                    <p className="muted">אין מספרים מבצעיים פעילים באתר.</p>
                  ) : (
                    site.statusCards.map((status) => {
                      const isOpen = openStatus?.siteId === site.siteId && openStatus.label === status.label;

                      return (
                        <button
                          className={`site-anchor-status-card tone-${status.tone} ${isOpen ? "active" : ""}`}
                          key={status.label}
                          type="button"
                          aria-expanded={isOpen}
                          onClick={() => setOpenStatus(isOpen ? null : { siteId: site.siteId, label: status.label })}
                        >
                          <span>{status.label}</span>
                          <strong>{formatNumber(status.count)}</strong>
                          <DeltaBadge value={status.delta} />
                        </button>
                      );
                    })
                  )}
                </div>

                {activeStatus ? (
                  <div className="site-status-detail-panel">
                    <div className="command-section-heading compact-heading">
                      <h3>{activeStatus.label} - {site.name}</h3>
                      <button className="button compact secondary" type="button" onClick={() => setOpenStatus(null)}>סגור</button>
                    </div>
                    <div className="table-scroll">
                      <table className="table compact-analysis-table">
                        <thead>
                          <tr>
                            <th>מספר מבצעי</th>
                            <th>שם מלא</th>
                            <th>סטטוס</th>
                            <th>צוות</th>
                            <th>תא שטח</th>
                            <th>זמן עדכון אחרון</th>
                            <th>הערות</th>
                          </tr>
                        </thead>
                        <tbody>
                          {activeStatus.people.map((person) => (
                            <tr key={person.personId}>
                              <td>#{person.operationalNumber}</td>
                              <td>{person.fullName ?? "שם לא ידוע"}</td>
                              <td>{person.statusLabel}</td>
                              <td>{person.teamLabel}</td>
                              <td>{person.gridCell ?? "-"}</td>
                              <td>{person.latestReportedAt ? formatDateTime(person.latestReportedAt) : "לא עודכן"}</td>
                              <td>{person.latestNotes ?? "-"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
