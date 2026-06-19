"use client";

import Link from "next/link";
import { Fragment, useState } from "react";
import { formatNumber } from "@/lib/format";

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
};

function gapStatusLabel(site: SiteAnalysisRow) {
  if (site.operationalGap === 0) return "ללא פער";
  if (site.level === "high") return "פער גבוה";
  if (site.level === "medium") return "פער בינוני";
  return "פער נמוך";
}

export function DashboardSiteAnalysis({ sites }: { sites: SiteAnalysisRow[] }) {
  const [openUnitsSiteId, setOpenUnitsSiteId] = useState<string | null>(null);

  return (
    <section className="panel section-spaced site-decision-panel">
      <div className="command-section-heading">
        <div>
          <h2>פירוט לפי אתר</h2>
          <p className="muted">היכן נמצא הפער המבצעי המרכזי כרגע</p>
        </div>
      </div>

      {sites.length === 0 ? (
        <p className="muted">לא נמצאו אתרים להצגה.</p>
      ) : (
        <div className="table-scroll">
          <table className="table site-decision-table">
            <thead>
              <tr>
                <th>אתר</th>
                <th>סטטוס</th>
                <th>פוטנציאל מעודכן</th>
                <th>מספרים מבצעיים פעילים</th>
                <th>טופלו / ידועים</th>
                <th>פער מבצעי</th>
                <th>צוותים</th>
                <th>פעולות</th>
              </tr>
            </thead>
            <tbody>
              {sites.map((site) => {
                const unitsOpen = openUnitsSiteId === site.siteId;

                return (
                  <Fragment key={site.siteId}>
                    <tr className={`site-decision-row coverage-${site.level}`}>
                      <td>
                        <Link href={site.structureHref}>
                          <strong>{site.name}</strong>
                        </Link>
                        <div className="muted">{site.address}</div>
                      </td>
                      <td>
                        <span className={`command-badge coverage-${site.level}`}>{gapStatusLabel(site)}</span>
                        <div className="muted">{site.statusLabel ?? "-"}</div>
                      </td>
                      <td>{formatNumber(site.updatedPotential)}</td>
                      <td>{formatNumber(site.activeOperationalNumbers)}</td>
                      <td>{formatNumber(site.knownHandled)}</td>
                      <td className="table-emphasis">{formatNumber(site.operationalGap)}</td>
                      <td>
                        {site.teams.length === 0 ? (
                          <span className="alert-chip danger">ללא צוות</span>
                        ) : (
                          <div className="assigned-team-list compact">
                            {site.teams.map((team) => (
                              <span key={team}>{team}</span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td>
                        <div className="site-decision-actions">
                          <Link className="button compact secondary" href={site.structureHref}>
                            תמונת מבנה
                          </Link>
                          <Link className="button compact secondary" href={site.operationalNumbersHref}>
                            מספרים מבצעיים
                          </Link>
                          <Link className="button compact secondary" href={site.operationalLogHref}>
                            יומן מבצעי אתר
                          </Link>
                          <button
                            className="button compact neutral"
                            type="button"
                            onClick={() => setOpenUnitsSiteId(unitsOpen ? null : site.siteId)}
                          >
                            פירוט דירות
                          </button>
                        </div>
                      </td>
                    </tr>
                    {unitsOpen ? (
                      <tr className="unit-detail-row">
                        <td colSpan={8}>
                          <div className="unit-detail-panel">
                            <div className="command-section-heading compact-heading">
                              <h3>פירוט דירות - {site.name}</h3>
                              <button className="button compact secondary" type="button" onClick={() => setOpenUnitsSiteId(null)}>
                                סגור
                              </button>
                            </div>
                            {site.units.length === 0 ? (
                              <p className="muted">אין יחידות פעילות להצגה באתר זה.</p>
                            ) : (
                              <div className="table-scroll">
                                <table className="table compact-analysis-table">
                                  <thead>
                                    <tr>
                                      <th>קומה</th>
                                      <th>דירה / יחידה</th>
                                      <th>סה״כ דיירים</th>
                                      <th>פוטנציאל צפוי</th>
                                      <th>טופלו / ידועים</th>
                                      <th>פער</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {site.units.map((unit) => (
                                      <tr key={unit.id}>
                                        <td>{unit.floorNumber ?? "-"}</td>
                                        <td>{unit.unitLabel}</td>
                                        <td>{formatNumber(unit.totalResidents)}</td>
                                        <td>{formatNumber(unit.expectedPotential)}</td>
                                        <td>{formatNumber(unit.knownHandled)}</td>
                                        <td className={unit.gap > 0 ? "table-emphasis" : ""}>{formatNumber(unit.gap)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
