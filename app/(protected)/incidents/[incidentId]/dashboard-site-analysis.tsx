"use client";

import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
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

function segmentTotal(segments: SiteStatusSegments) {
  return segments.missingUnknown + segments.inProgress + segments.completed + segments.deceased + segments.other;
}

function segmentWidth(value: number, total: number) {
  if (total <= 0 || value <= 0) {
    return 0;
  }

  return Math.max(4, Math.round((value / total) * 100));
}

export function DashboardSiteAnalysis({ sites }: { sites: SiteAnalysisRow[] }) {
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [openUnitsSiteId, setOpenUnitsSiteId] = useState<string | null>(null);
  const maxGap = Math.max(1, ...sites.map((site) => site.operationalGap));
  const visibleSites = selectedSiteId ? sites.filter((site) => site.siteId === selectedSiteId) : sites;
  const selectedSite = useMemo(
    () => (selectedSiteId ? sites.find((site) => site.siteId === selectedSiteId) ?? null : null),
    [selectedSiteId, sites]
  );

  return (
    <>
      <section className="panel section-spaced command-chart-panel">
        <div className="command-section-heading">
          <div>
            <h2>פער מבצעי לפי אתר</h2>
            <p className="muted">לחיצה על אתר ממקדת את תמונת האתרים.</p>
          </div>
          {selectedSite ? (
            <button className="button compact secondary" type="button" onClick={() => setSelectedSiteId(null)}>
              נקה סינון
            </button>
          ) : null}
        </div>

        <div className="gap-bar-chart">
          {sites.map((site) => {
            const width = Math.round((site.operationalGap / maxGap) * 100);
            const isSelected = selectedSiteId === site.siteId;

            return (
              <button
                className={`gap-bar-row coverage-${site.level} ${isSelected ? "selected" : ""}`}
                type="button"
                key={site.siteId}
                onClick={() => setSelectedSiteId(isSelected ? null : site.siteId)}
              >
                <span className="gap-bar-label">{site.name}</span>
                <span className="gap-bar-track">
                  <span style={{ width: `${Math.max(2, width)}%` }} />
                </span>
                <strong>{formatNumber(site.operationalGap)}</strong>
              </button>
            );
          })}
        </div>
      </section>

      <section className="panel section-spaced command-chart-panel">
        <div className="command-section-heading">
          <div>
            <h2>מצב מספרים מבצעיים לפי אתר</h2>
            <p className="muted">פילוח סטטוסים מבצעיים לפי האתר שבו המספר מנוהל.</p>
          </div>
        </div>

        <div className="stacked-status-chart">
          {sites.map((site) => {
            const total = segmentTotal(site.statusSegments);

            return (
              <div className={`stacked-status-row ${selectedSiteId === site.siteId ? "selected" : ""}`} key={site.siteId}>
                <div>
                  <strong>{site.name}</strong>
                  <span>{formatNumber(total)} מספרים</span>
                </div>
                <div className="stacked-bar" aria-label={`פילוח סטטוס ${site.name}`}>
                  <span className="segment missing" style={{ width: `${segmentWidth(site.statusSegments.missingUnknown, total)}%` }} />
                  <span className="segment in-progress" style={{ width: `${segmentWidth(site.statusSegments.inProgress, total)}%` }} />
                  <span className="segment completed" style={{ width: `${segmentWidth(site.statusSegments.completed, total)}%` }} />
                  <span className="segment deceased" style={{ width: `${segmentWidth(site.statusSegments.deceased, total)}%` }} />
                  <span className="segment other" style={{ width: `${segmentWidth(site.statusSegments.other, total)}%` }} />
                </div>
              </div>
            );
          })}
        </div>
        <div className="chart-legend">
          <span className="legend-missing">נעדר / לא ידוע</span>
          <span className="legend-progress">בטיפול / לכוד</span>
          <span className="legend-completed">חולצו / פונו / אותרו</span>
          <span className="legend-deceased">נפטרים</span>
          <span className="legend-other">אחר</span>
        </div>
      </section>

      <section className="panel section-spaced site-decision-panel">
        <div className="command-section-heading">
          <div>
            <h2>תמונת אתרים</h2>
            <p className="muted">
              {selectedSite ? `מוצג סינון לאתר ${selectedSite.name}` : "היכן נמצא הפער המבצעי המרכזי כרגע"}
            </p>
          </div>
        </div>

        {visibleSites.length === 0 ? (
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
                {visibleSites.map((site) => {
                  const unitsOpen = openUnitsSiteId === site.siteId;

                  return (
                    <Fragment key={site.siteId}>
                      <tr className={`site-decision-row coverage-${site.level}`} key={site.siteId}>
                        <td>
                          <Link href={site.structureHref}>
                            <strong>{site.name}</strong>
                          </Link>
                          <div className="muted">{site.address}</div>
                        </td>
                        <td>
                          <span className={`command-badge coverage-${site.level}`}>
                            {site.operationalGap === 0 ? "ללא פער" : site.level === "high" ? "פער גבוה" : site.level === "medium" ? "פער בינוני" : "פער נמוך"}
                          </span>
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
                                        <th>סה"כ דיירים</th>
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
    </>
  );
}
