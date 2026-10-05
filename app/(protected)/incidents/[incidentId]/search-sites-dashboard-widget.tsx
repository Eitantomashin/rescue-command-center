"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatNumber } from "@/lib/format";
import { isOpenSearchCasualtyUnit, isResolvedSearchCasualtyUnit, searchUnitProcessLabel, searchUnitStatusTone, searchLiveStatus, searchScannedCount, type SearchStatusSummary, type SearchUnitStatus } from "@/lib/search-site-status";
import { DashboardCollapsibleSection } from "./dashboard-collapsible-section";
import { SearchOperationalKpis } from "@/app/mobile/search/search-operational-kpis";
import type { SearchCasualtyPerson } from "@/lib/search-casualty-person";

export type SearchKpiDrilldownEntry = {
  unitId: string;
  siteName: string | null;
  floorNumber: number | null;
  unitLabel: string;
  familyName: string | null;
  occupantsCount: number | null;
  status: SearchUnitStatus;
  anxietyCasualtiesCount: number;
  physicalCasualtiesCount: number;
  casualtiesResolved: boolean;
  hasCasualtyFinding: boolean;
  medicalEvacuation: boolean;
  hasApartmentDamage: boolean;
  apartmentDamageNotes: string | null;
  notes: string | null;
};

export type SearchSiteWidgetSite = {
  id: string;
  name: string;
  address: string | null;
  parentName: string | null;
  searchPriority: string | null;
  searchReason: string | null;
  initialPotential: number | null;
  updatedPotential: number | null;
  operationalGap: number | null;
  summary: SearchStatusSummary;
  anxietyCasualtiesCount: number;
  physicalCasualtiesCount: number;
  damagedUnitsCount: number;
  casualtyPeople: SearchCasualtyPerson[];
  entries: SearchKpiDrilldownEntry[];
};

export type SearchSitesWidgetData = {
  sites: SearchSiteWidgetSite[];
  updatedAt: string;
};

function searchUnitStatusLabel(status: SearchUnitStatus) {
  return searchUnitProcessLabel(status);
}

function searchUnitTone(status: SearchUnitStatus) {
  return searchUnitStatusTone(status);
}

function isScannedEntry(entry: SearchKpiDrilldownEntry) {
  return ["clear", "no_answer", "casualties", "completed"].includes(entry.status);
}

function searchKpiBuckets(entries: SearchKpiDrilldownEntry[]) {
  return {
    all: entries,
    scanned: entries.filter(isScannedEntry),
    completed: entries.filter((entry) => entry.status === "completed"),
    no_answer: entries.filter((entry) => entry.status === "no_answer"),
    reported_casualties: entries.filter((entry) => entry.hasCasualtyFinding),
    casualties: entries.filter((entry) => isOpenSearchCasualtyUnit(entry.status, entry.casualtiesResolved)),
    resolved_casualties: entries.filter((entry) => isResolvedSearchCasualtyUnit(entry.status, entry.casualtiesResolved)),
    anxiety: entries.filter((entry) => entry.anxietyCasualtiesCount > 0),
    physical: entries.filter((entry) => entry.physicalCasualtiesCount > 0),
    damaged: entries.filter((entry) => entry.hasApartmentDamage)
  };
}

function SearchKpiCard({
  className,
  label,
  value,
  title,
  entries
}: {
  className: string;
  label: string;
  value: number;
  title: string;
  entries: SearchKpiDrilldownEntry[];
}) {
  return (
    <details className={"search-kpi-click-card " + className}>
      <summary><span>{label}</span><strong>{formatNumber(value)}</strong></summary>
      <SearchKpiDrilldown title={title} entries={entries} />
    </details>
  );
}

function SearchKpiDrilldown({ title, entries }: { title: string; entries: SearchKpiDrilldownEntry[] }) {
  return (
    <div className="search-kpi-drilldown-panel">
      <strong>{title}</strong>
      {entries.length === 0 ? (
        <p className="muted">{"\u05D0\u05D9\u05DF \u05E4\u05E8\u05D9\u05D8\u05D9\u05DD \u05DC\u05D4\u05E6\u05D2\u05D4"}</p>
      ) : (
        <ul className="search-kpi-drilldown-list">
          {entries.map((entry) => (
            <li key={(entry.siteName ?? "site") + "-" + entry.unitId}>
              {entry.siteName ? <span>{entry.siteName}</span> : null}
              <span>{"\u05E7\u05D5\u05DE\u05D4"} {entry.floorNumber ?? "-"}</span>
              <strong>{entry.unitLabel}</strong>
              <span>{entry.familyName ? "\u05DE\u05E9\u05E4\u05D7\u05EA " + entry.familyName : "\u05DE\u05E9\u05E4\u05D7\u05D4 \u05DC\u05D0 \u05E6\u05D5\u05D9\u05E0\u05D4"}</span>
              {entry.occupantsCount !== null ? <span>{"\u05D3\u05D9\u05D9\u05E8\u05D9\u05DD"}: {formatNumber(entry.occupantsCount)}</span> : null}
              <span className={"search-unit-status " + searchUnitTone(entry.status)}>{searchUnitStatusLabel(entry.status)}</span>
              {entry.anxietyCasualtiesCount > 0 ? <span>{"\u05E0\u05E4\u05D2\u05E2\u05D9 \u05D7\u05E8\u05D3\u05D4"}: {formatNumber(entry.anxietyCasualtiesCount)}</span> : null}
              {entry.physicalCasualtiesCount > 0 ? <span>{"\u05E0\u05E4\u05D2\u05E2\u05D9 \u05D2\u05D5\u05E3"}: {formatNumber(entry.physicalCasualtiesCount)}</span> : null}
              {entry.medicalEvacuation ? <span>{"\u05E4\u05D9\u05E0\u05D5\u05D9 \u05E8\u05E4\u05D5\u05D0\u05D9"}</span> : null}
              {isResolvedSearchCasualtyUnit(entry.status, entry.casualtiesResolved) ? <span>{"\u05D4\u05D8\u05D9\u05E4\u05D5\u05DC \u05D1\u05E0\u05E4\u05D2\u05E2\u05D9\u05DD \u05D4\u05D5\u05E9\u05DC\u05DD"}</span> : null}
              {isOpenSearchCasualtyUnit(entry.status, entry.casualtiesResolved) ? <span>{"\u05D8\u05D9\u05E4\u05D5\u05DC \u05D1\u05E0\u05E4\u05D2\u05E2\u05D9\u05DD \u05E4\u05EA\u05D5\u05D7"}</span> : null}
              {entry.hasApartmentDamage ? <span>{"\u05E0\u05D6\u05E7 \u05DC\u05D3\u05D9\u05E8\u05D4"}</span> : null}
              {entry.apartmentDamageNotes ? <span>{"\u05E4\u05D9\u05E8\u05D5\u05D8 \u05E0\u05D6\u05E7"}: {entry.apartmentDamageNotes}</span> : null}
              {entry.notes ? <span>{"\u05D4\u05E2\u05E8\u05D5\u05EA"}: {entry.notes}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatUpdatedAt(value: string) {
  return new Intl.DateTimeFormat("he-IL", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

export function SearchSitesDashboardWidget({
  incidentId,
  initialData
}: {
  incidentId: string;
  initialData: SearchSitesWidgetData;
}) {
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/incidents/${incidentId}/search-sites-widget-data`, {
        cache: "no-store"
      });
      if (!response.ok) return;
      setData((await response.json()) as SearchSitesWidgetData);
    } finally {
      setLoading(false);
    }
  }, [incidentId]);

  useEffect(() => {
    const interval = window.setInterval(refresh, 10000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const entriesByKpi = useMemo(() => {
    const allEntries = data.sites.flatMap((site) => site.entries);
    return searchKpiBuckets(allEntries);
  }, [data.sites]);

  const totals = useMemo(
    () =>
      data.sites.reduce(
        (acc, site) => {
          acc.totalUnits += site.summary.total_units;
          acc.scanned += searchScannedCount(site.summary);
          acc.completed += site.summary.completed_count;
          acc.noAnswer += site.summary.no_answer_count;
          acc.casualties += site.summary.casualties_count;
          acc.anxietyCasualties += site.anxietyCasualtiesCount;
          acc.physicalCasualties += site.physicalCasualtiesCount;
          acc.reportedCasualties += site.entries.filter((entry) => entry.hasCasualtyFinding).length;
          acc.openCasualtyUnits += site.entries.filter((entry) => isOpenSearchCasualtyUnit(entry.status, entry.casualtiesResolved)).length;
          acc.resolvedCasualtyUnits += site.entries.filter((entry) => isResolvedSearchCasualtyUnit(entry.status, entry.casualtiesResolved)).length;
          acc.damagedUnits += site.damagedUnitsCount;
          return acc;
        },
        { totalUnits: 0, scanned: 0, completed: 0, noAnswer: 0, casualties: 0, anxietyCasualties: 0, physicalCasualties: 0, reportedCasualties: 0, openCasualtyUnits: 0, resolvedCasualtyUnits: 0, damagedUnits: 0 }
      ),
    [data.sites]
  );

  if (data.sites.length === 0) {
    return null;
  }

  return (
    <DashboardCollapsibleSection
      title="אתרי סריקה"
      defaultOpen={false}
      className="search-sites-dashboard-widget"
      action={(
        <div className="search-widget-refresh-row">
          <span>עודכן: {formatUpdatedAt(data.updatedAt)}</span>
          <button className="button compact secondary" type="button" onClick={refresh} disabled={loading}>
            {loading ? "מרענן..." : "רענן נתוני סריקה"}
          </button>
        </div>
      )}
    >
      <SearchOperationalKpis units={data.sites.flatMap((site) => site.entries)} people={data.sites.flatMap((site) => site.casualtyPeople)} />

      <div className="search-sites-dashboard-list">
        {data.sites.map((site) => {
          const siteScanned = searchScannedCount(site.summary);
          const siteLiveStatus = searchLiveStatus(site.summary);
          const siteEntriesByKpi = searchKpiBuckets(site.entries);
          const siteReportedCasualties = site.entries.filter((entry) => entry.hasCasualtyFinding).length;
          const siteOpenCasualtyUnits = site.entries.filter((entry) => isOpenSearchCasualtyUnit(entry.status, entry.casualtiesResolved)).length;
          const siteResolvedCasualtyUnits = site.entries.filter((entry) => isResolvedSearchCasualtyUnit(entry.status, entry.casualtiesResolved)).length;

          return (
            <article className="search-site-dashboard-card" key={site.id}>
              <div>
                <div className="search-site-card-heading">
                  <strong>{site.name}</strong>
                  <span className="site-type-badge search-site">אתר סריקה</span>
                  <span className={`search-status-badge search-site-live-${siteLiveStatus.tone}`}>{siteLiveStatus.label}</span>
                </div>
                {site.address ? <p className="muted">{site.address}</p> : null}
              </div>
              <dl className="search-site-card-details">
                <div><dt>אתר אב</dt><dd>{site.parentName ?? "ללא"}</dd></div>
                <div><dt>עדיפות</dt><dd>{site.searchPriority?.trim() || "-"}</dd></div>
                <div><dt>סיבת סריקה</dt><dd>{site.searchReason?.trim() || "-"}</dd></div>
              </dl>
              <section className="search-site-population-kpis" aria-label="תמונת אוכלוסייה לאתר">
                <h3>תמונת אוכלוסייה</h3>
                <dl>
                  <div><dt>פוטנציאל ראשוני</dt><dd>{site.initialPotential === null ? "—" : formatNumber(site.initialPotential)}</dd></div>
                  <div><dt>פוטנציאל מעודכן</dt><dd>{site.updatedPotential === null ? "—" : formatNumber(site.updatedPotential)}</dd></div>
                  <div><dt>פער מבצעי</dt><dd>{site.operationalGap === null ? "—" : formatNumber(site.operationalGap)}</dd></div>
                </dl>
              </section>
              <p className="search-site-metrics-heading">מצב הסריקה</p>
              <div className="search-site-card-kpis" aria-label={"\u05E1\u05D9\u05DB\u05D5\u05DD \u05E1\u05E8\u05D9\u05E7\u05D4 \u05DC\u05D0\u05EA\u05E8"}>
                <SearchKpiCard className="search-kpi-total" label={"\u05E1\u05D4\u05F4\u05DB"} value={site.summary.total_units} title={"\u05DB\u05DC \u05D4\u05D3\u05D9\u05E8\u05D5\u05EA \u05D1\u05D0\u05EA\u05E8"} entries={siteEntriesByKpi.all} />
                <SearchKpiCard className="search-kpi-scanned" label={"\u05E0\u05E1\u05E8\u05E7\u05D5"} value={siteScanned} title={"\u05D3\u05D9\u05E8\u05D5\u05EA \u05E9\u05E0\u05E1\u05E8\u05E7\u05D5 \u05D1\u05D0\u05EA\u05E8"} entries={siteEntriesByKpi.scanned} />
                <SearchKpiCard className="search-kpi-completed" label={"\u05D6\u05D5\u05DB\u05D5"} value={site.summary.completed_count} title={"\u05D3\u05D9\u05E8\u05D5\u05EA \u05E9\u05D6\u05D5\u05DB\u05D5 \u05D1\u05D0\u05EA\u05E8"} entries={siteEntriesByKpi.completed} />
                <SearchKpiCard className="search-kpi-no-answer" label={"\u05D0\u05D9\u05DF \u05DE\u05E2\u05E0\u05D4"} value={site.summary.no_answer_count} title={"\u05D3\u05D9\u05E8\u05D5\u05EA \u05DC\u05DC\u05D0 \u05DE\u05E2\u05E0\u05D4 \u05D1\u05D0\u05EA\u05E8"} entries={siteEntriesByKpi.no_answer} />
                <SearchKpiCard className="search-kpi-casualties" label={"\u05D3\u05D5\u05D5\u05D7\u05D5 \u05E0\u05E4\u05D2\u05E2\u05D9\u05DD"} value={siteReportedCasualties} title={"\u05D3\u05D9\u05E8\u05D5\u05EA \u05E2\u05DD \u05D3\u05D9\u05D5\u05D5\u05D7 \u05E0\u05E4\u05D2\u05E2\u05D9\u05DD \u05D1\u05D0\u05EA\u05E8"} entries={siteEntriesByKpi.reported_casualties} />
                <SearchKpiCard className="search-kpi-danger" label={"\u05D8\u05D9\u05E4\u05D5\u05DC \u05E4\u05EA\u05D5\u05D7"} value={siteOpenCasualtyUnits} title={"\u05D3\u05D9\u05E8\u05D5\u05EA \u05E2\u05DD \u05D8\u05D9\u05E4\u05D5\u05DC \u05E0\u05E4\u05D2\u05E2\u05D9\u05DD \u05E4\u05EA\u05D5\u05D7 \u05D1\u05D0\u05EA\u05E8"} entries={siteEntriesByKpi.casualties} />
                <SearchKpiCard className="search-kpi-completed" label={"\u05D3\u05D9\u05E8\u05D5\u05EA \u05E9\u05D8\u05D5\u05E4\u05DC\u05D5"} value={siteResolvedCasualtyUnits} title={"\u05D3\u05D9\u05E8\u05D5\u05EA \u05E9\u05D1\u05D4\u05DF \u05D4\u05D8\u05D9\u05E4\u05DC\u05D5 \u05D1\u05E0\u05E4\u05D2\u05E2\u05D9\u05DD \u05D4\u05D5\u05E9\u05DC\u05DD \u05D1\u05D0\u05EA\u05E8"} entries={siteEntriesByKpi.resolved_casualties} />
                <SearchKpiCard className="search-kpi-warning" label={"\u05D7\u05E8\u05D3\u05D4"} value={site.anxietyCasualtiesCount} title={"\u05D3\u05D9\u05E8\u05D5\u05EA \u05E2\u05DD \u05E0\u05E4\u05D2\u05E2\u05D9 \u05D7\u05E8\u05D3\u05D4 \u05D1\u05D0\u05EA\u05E8"} entries={siteEntriesByKpi.anxiety} />
                <SearchKpiCard className="search-kpi-danger" label={"\u05D2\u05D5\u05E3"} value={site.physicalCasualtiesCount} title={"\u05D3\u05D9\u05E8\u05D5\u05EA \u05E2\u05DD \u05E0\u05E4\u05D2\u05E2\u05D9 \u05D2\u05D5\u05E3 \u05D1\u05D0\u05EA\u05E8"} entries={siteEntriesByKpi.physical} />
                <SearchKpiCard className="search-kpi-damage" label={"\u05E0\u05D6\u05E7"} value={site.damagedUnitsCount} title={"\u05D3\u05D9\u05E8\u05D5\u05EA \u05E2\u05DD \u05E0\u05D6\u05E7 \u05D1\u05D0\u05EA\u05E8"} entries={siteEntriesByKpi.damaged} />
              </div>
              <Link className="button compact secondary" href={`/incidents/${incidentId}/sites/${site.id}`}>
                פתח אתר
              </Link>
            </article>
          );
        })}
      </div>
    </DashboardCollapsibleSection>
  );
}
