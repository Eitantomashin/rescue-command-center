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

type PotentialBreakdownRow = {
  label: string;
  value: number;
  tone: "blue" | "orange" | "green" | "red" | "neutral";
  note?: string;
};

function updatedPotentialBreakdown(site: SiteAnalysisRow): PotentialBreakdownRow[] {
  const netChange = site.updatedPotential - site.initialPotential;
  const rows: PotentialBreakdownRow[] = [
    {
      label: "\u05e4\u05d5\u05d8\u05e0\u05e6\u05d9\u05d0\u05dc \u05e8\u05d0\u05e9\u05d5\u05e0\u05d9",
      value: site.initialPotential,
      tone: "blue",
      note: "\u05d4\u05d1\u05e1\u05d9\u05e1 \u05e9\u05d4\u05d5\u05d2\u05d3\u05e8 \u05dc\u05d0\u05ea\u05e8 \u05d1\u05ea\u05d7\u05d9\u05dc\u05ea \u05d4\u05e4\u05e2\u05d9\u05dc\u05d5\u05ea."
    }
  ];

  if (netChange > 0) {
    rows.push({
      label: "\u05d0\u05e0\u05e9\u05d9\u05dd \u05e9\u05e0\u05d5\u05e1\u05e4\u05d5/\u05e0\u05e8\u05e9\u05de\u05d5",
      value: netChange,
      tone: "green",
      note: "\u05ea\u05d5\u05e1\u05e4\u05ea \u05e0\u05d8\u05d5 \u05dc\u05e4\u05d9 \u05e2\u05d3\u05db\u05d5\u05e0\u05d9 \u05d4\u05d0\u05ea\u05e8 \u05d5\u05d4\u05d3\u05d9\u05d5\u05d5\u05d7\u05d9\u05dd \u05d4\u05d0\u05d7\u05e8\u05d5\u05e0\u05d9\u05dd."
    });
  } else if (netChange < 0) {
    rows.push({
      label: "\u05d0\u05e0\u05e9\u05d9\u05dd \u05e9\u05e0\u05d2\u05e8\u05e2\u05d5 \u05de\u05d4\u05e4\u05d5\u05d8\u05e0\u05e6\u05d9\u05d0\u05dc",
      value: Math.abs(netChange),
      tone: "green",
      note: "\u05d2\u05e8\u05d9\u05e2\u05d4 \u05e0\u05d8\u05d5 \u05dc\u05e4\u05d9 \u05e2\u05d3\u05db\u05d5\u05e0\u05d9 \u05d4\u05d0\u05ea\u05e8, \u05d6\u05d9\u05db\u05d5\u05d9 \u05d3\u05d9\u05e8\u05d5\u05ea \u05d0\u05d5 \u05d3\u05d9\u05d5\u05d5\u05d7\u05d9\u05dd \u05e9\u05d4\u05d5\u05e9\u05dc\u05de\u05d5."
    });
  } else {
    rows.push({
      label: "\u05e9\u05d9\u05e0\u05d5\u05d9 \u05e0\u05d8\u05d5 \u05de\u05d4\u05e2\u05d3\u05db\u05d5\u05e0\u05d9\u05dd",
      value: 0,
      tone: "neutral",
      note: "\u05dc\u05d0 \u05e0\u05e8\u05e9\u05dd \u05e9\u05d9\u05e0\u05d5\u05d9 \u05d1\u05d9\u05df \u05d4\u05e4\u05d5\u05d8\u05e0\u05e6\u05d9\u05d0\u05dc \u05d4\u05e8\u05d0\u05e9\u05d5\u05e0\u05d9 \u05dc\u05de\u05e2\u05d5\u05d3\u05db\u05df."
    });
  }

  rows.push(
    {
      label: "\u05d9\u05d3\u05d5\u05e2\u05d9\u05dd / \u05d8\u05d5\u05e4\u05dc\u05d5 \u05d1\u05d0\u05ea\u05e8",
      value: site.knownHandled,
      tone: "green",
      note: "\u05e0\u05ea\u05d5\u05df \u05ea\u05e4\u05e2\u05d5\u05dc\u05d9 \u05de\u05e9\u05dc\u05d9\u05dd \u05de\u05ea\u05d5\u05da \u05e1\u05d9\u05db\u05d5\u05dd \u05d4\u05d0\u05ea\u05e8."
    },
    {
      label: "\u05e4\u05e2\u05e8 \u05de\u05d1\u05e6\u05e2\u05d9 \u05e0\u05d5\u05db\u05d7\u05d9",
      value: site.operationalGap,
      tone: site.operationalGap > 0 ? "red" : "green",
      note: "\u05d4\u05e4\u05e2\u05e8 \u05d4\u05e0\u05d5\u05ea\u05e8 \u05de\u05d5\u05dc \u05d4\u05e4\u05d5\u05d8\u05e0\u05e6\u05d9\u05d0\u05dc \u05d4\u05de\u05e2\u05d5\u05d3\u05db\u05df."
    },
    {
      label: "\u05d9\u05ea\u05e8\u05d4 \u05de\u05e2\u05d5\u05d3\u05db\u05e0\u05ea",
      value: site.updatedPotential,
      tone: "orange",
      note: "\u05d6\u05d4\u05d5 \u05d4\u05e2\u05e8\u05da \u05e9\u05de\u05d5\u05e6\u05d2 \u05d1\u05db\u05e8\u05d8\u05d9\u05e1 \u05d4\u05e4\u05d5\u05d8\u05e0\u05e6\u05d9\u05d0\u05dc \u05d4\u05de\u05e2\u05d5\u05d3\u05db\u05df."
    }
  );

  return rows;
}

function operationalGapBreakdown(site: SiteAnalysisRow): PotentialBreakdownRow[] {
  return [
    {
      label: "\u05e4\u05d5\u05d8\u05e0\u05e6\u05d9\u05d0\u05dc \u05de\u05e2\u05d5\u05d3\u05db\u05df",
      value: site.updatedPotential,
      tone: "orange",
      note: "\u05d4\u05d1\u05e1\u05d9\u05e1 \u05d4\u05e0\u05d5\u05db\u05d7\u05d9 \u05dc\u05d7\u05d9\u05e9\u05d5\u05d1 \u05d4\u05e4\u05e2\u05e8."
    },
    {
      label: "\u05d9\u05d3\u05d5\u05e2\u05d9\u05dd / \u05d8\u05d5\u05e4\u05dc\u05d5",
      value: site.knownHandled,
      tone: "green",
      note: "\u05d0\u05e0\u05e9\u05d9\u05dd \u05e9\u05d6\u05d5\u05d4\u05d5, \u05d8\u05d5\u05e4\u05dc\u05d5 \u05d0\u05d5 \u05e0\u05e1\u05d2\u05e8\u05d5 \u05de\u05d1\u05e6\u05e2\u05d9\u05ea \u05dc\u05e4\u05d9 \u05e1\u05d9\u05db\u05d5\u05dd \u05d4\u05d0\u05ea\u05e8."
    },
    {
      label: "\u05e4\u05d5\u05e0\u05d5 / \u05d0\u05d5\u05ea\u05e8\u05d5 / \u05d4\u05d5\u05e9\u05dc\u05de\u05d5",
      value: site.statusSegments.completed,
      tone: "green",
      note: "\u05de\u05e1\u05e4\u05e8\u05d9\u05dd \u05de\u05d1\u05e6\u05e2\u05d9\u05d9\u05dd \u05d1\u05e1\u05d8\u05d8\u05d5\u05e1\u05d9 \u05e1\u05d9\u05d5\u05dd \u05d8\u05d9\u05e4\u05d5\u05dc."
    },
    {
      label: "\u05dc\u05dc\u05d0 \u05e1\u05d8\u05d8\u05d5\u05e1 \u05d1\u05e8\u05d5\u05e8",
      value: site.statusSegments.missingUnknown + site.statusSegments.other,
      tone: "blue",
      note: "\u05e0\u05e2\u05d3\u05e8 / \u05dc\u05d0 \u05d9\u05d3\u05d5\u05e2 \u05d0\u05d5 \u05e1\u05d8\u05d8\u05d5\u05e1\u05d9\u05dd \u05d0\u05d7\u05e8\u05d9\u05dd \u05e9\u05d3\u05d5\u05e8\u05e9\u05d9\u05dd \u05ea\u05e9\u05d5\u05de\u05ea \u05dc\u05d1."
    },
    {
      label: "\u05e6\u05d5\u05d5\u05ea\u05d9\u05dd \u05e4\u05e2\u05d9\u05dc\u05d9\u05dd",
      value: site.teams.length,
      tone: "neutral",
      note: site.teams.length ? site.teams.join(", ") : "\u05dc\u05dc\u05d0 \u05e6\u05d5\u05d5\u05ea \u05e4\u05e2\u05d9\u05dc"
    },
    {
      label: "\u05e4\u05e2\u05e8 \u05de\u05d1\u05e6\u05e2\u05d9 \u05e0\u05d5\u05db\u05d7\u05d9",
      value: site.operationalGap,
      tone: site.operationalGap > 0 ? "red" : "green",
      note: "\u05d6\u05d4\u05d5 \u05d4\u05e2\u05e8\u05da \u05e9\u05de\u05d5\u05e6\u05d2 \u05d1\u05db\u05e8\u05d8\u05d9\u05e1 \u05d4\u05e4\u05e2\u05e8 \u05d4\u05de\u05d1\u05e6\u05e2\u05d9."
    }
  ];
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
  const [potentialDetailSite, setPotentialDetailSite] = useState<SiteAnalysisRow | null>(null);
  const [gapDetailSite, setGapDetailSite] = useState<SiteAnalysisRow | null>(null);

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
                  <button
                    className="site-command-fact fact-updated clickable"
                    type="button"
                    onClick={() => setPotentialDetailSite(site)}
                    aria-label={`${"\u05e4\u05d9\u05e8\u05d5\u05d8 \u05e4\u05d5\u05d8\u05e0\u05e6\u05d9\u05d0\u05dc \u05de\u05e2\u05d5\u05d3\u05db\u05df"} - ${site.name}`}
                  >
                    <span>{"\u05e4\u05d5\u05d8\u05e0\u05e6\u05d9\u05d0\u05dc \u05de\u05e2\u05d5\u05d3\u05db\u05df"}</span>
                    <strong>{formatNumber(site.updatedPotential)}</strong>
                    <small>{"\u05dc\u05d7\u05e5 \u05dc\u05e4\u05d9\u05e8\u05d5\u05d8"}</small>
                  </button>
                  <button
                    className="site-command-fact fact-gap clickable"
                    type="button"
                    onClick={() => setGapDetailSite(site)}
                    aria-label={`\u05e4\u05d9\u05e8\u05d5\u05d8 \u05e4\u05e2\u05e8 \u05de\u05d1\u05e6\u05e2\u05d9 - ${site.name}`}
                  >
                    <span>{"\u05e4\u05e2\u05e8 \u05de\u05d1\u05e6\u05e2\u05d9"}</span>
                    <strong>{formatNumber(site.operationalGap)}</strong>
                    <small>{"\u05dc\u05d7\u05e5 \u05dc\u05e4\u05d9\u05e8\u05d5\u05d8"}</small>
                  </button>
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


      {potentialDetailSite ? (
        <div className="updated-potential-modal-backdrop" role="presentation" onClick={() => setPotentialDetailSite(null)}>
          <section
            className="updated-potential-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="updated-potential-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="updated-potential-modal-header">
              <div>
                <p className="muted">{potentialDetailSite.name}</p>
                <h2 id="updated-potential-modal-title">{"\u05e4\u05d9\u05e8\u05d5\u05d8 \u05e4\u05d5\u05d8\u05e0\u05e6\u05d9\u05d0\u05dc \u05de\u05e2\u05d5\u05d3\u05db\u05df"}</h2>
              </div>
              <button className="button compact secondary" type="button" onClick={() => setPotentialDetailSite(null)}>
                {"\u05e1\u05d2\u05d5\u05e8"}
              </button>
            </div>

            <p className="updated-potential-helper">
              {"\u05d4\u05e4\u05d5\u05d8\u05e0\u05e6\u05d9\u05d0\u05dc \u05d4\u05de\u05e2\u05d5\u05d3\u05db\u05df \u05de\u05d7\u05d5\u05e9\u05d1 \u05dc\u05e4\u05d9 \u05e0\u05ea\u05d5\u05e0\u05d9 \u05d4\u05d0\u05ea\u05e8, \u05d4\u05d3\u05d9\u05d5\u05d5\u05d7\u05d9\u05dd \u05d5\u05d4\u05e2\u05d3\u05db\u05d5\u05e0\u05d9\u05dd \u05d4\u05d0\u05d7\u05e8\u05d5\u05e0\u05d9\u05dd."}
            </p>

            <div className="updated-potential-total-card">
              <span>{"\u05e1\u05d4\u05f4\u05db \u05e4\u05d5\u05d8\u05e0\u05e6\u05d9\u05d0\u05dc \u05de\u05e2\u05d5\u05d3\u05db\u05df"}</span>
              <strong>{formatNumber(potentialDetailSite.updatedPotential)}</strong>
            </div>

            <div className="updated-potential-breakdown" aria-label={"\u05de\u05e8\u05db\u05d9\u05d1\u05d9 \u05e4\u05d5\u05d8\u05e0\u05e6\u05d9\u05d0\u05dc \u05de\u05e2\u05d5\u05d3\u05db\u05df"}>
              {updatedPotentialBreakdown(potentialDetailSite).map((row) => (
                <div className={`updated-potential-row tone-${row.tone}`} key={row.label}>
                  <div>
                    <span>{row.label}</span>
                    {row.note ? <small>{row.note}</small> : null}
                  </div>
                  <strong>{formatNumber(row.value)}</strong>
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {gapDetailSite ? (
        <div className="updated-potential-modal-backdrop" role="presentation" onClick={() => setGapDetailSite(null)}>
          <section
            className="updated-potential-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="operational-gap-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="updated-potential-modal-header">
              <div>
                <p className="muted">{gapDetailSite.name}</p>
                <h2 id="operational-gap-modal-title">{"\u05e4\u05d9\u05e8\u05d5\u05d8 \u05e4\u05e2\u05e8 \u05de\u05d1\u05e6\u05e2\u05d9"}</h2>
              </div>
              <button className="button compact secondary" type="button" onClick={() => setGapDetailSite(null)}>
                {"\u05e1\u05d2\u05d5\u05e8"}
              </button>
            </div>

            <p className="updated-potential-helper">
              {"\u05d4\u05e4\u05e2\u05e8 \u05d4\u05de\u05d1\u05e6\u05e2\u05d9 \u05de\u05e6\u05d9\u05d2 \u05d0\u05ea \u05d4\u05d4\u05e4\u05e8\u05e9 \u05d1\u05d9\u05df \u05d4\u05e4\u05d5\u05d8\u05e0\u05e6\u05d9\u05d0\u05dc \u05d4\u05de\u05e2\u05d5\u05d3\u05db\u05df \u05dc\u05d1\u05d9\u05df \u05d4\u05e0\u05ea\u05d5\u05e0\u05d9\u05dd \u05d4\u05d9\u05d3\u05d5\u05e2\u05d9\u05dd \u05e9\u05d8\u05d5\u05e4\u05dc\u05d5 \u05d0\u05d5 \u05e0\u05e1\u05d2\u05e8\u05d5 \u05de\u05d1\u05e6\u05e2\u05d9\u05ea."}
            </p>

            <div className="updated-potential-total-card gap-total">
              <span>{"\u05e1\u05d4\u05f4\u05db \u05e4\u05e2\u05e8 \u05de\u05d1\u05e6\u05e2\u05d9"}</span>
              <strong>{formatNumber(gapDetailSite.operationalGap)}</strong>
            </div>

            <div className="updated-potential-breakdown" aria-label={"\u05de\u05e8\u05db\u05d9\u05d1\u05d9 \u05e4\u05e2\u05e8 \u05de\u05d1\u05e6\u05e2\u05d9"}>
              {operationalGapBreakdown(gapDetailSite).map((row) => (
                <div className={`updated-potential-row tone-${row.tone}`} key={row.label}>
                  <div>
                    <span>{row.label}</span>
                    {row.note ? <small>{row.note}</small> : null}
                  </div>
                  <strong>{formatNumber(row.value)}</strong>
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
