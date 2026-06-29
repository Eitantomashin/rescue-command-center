"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatNumber } from "@/lib/format";
import { searchLiveStatus, searchScannedCount, type SearchStatusSummary, type SearchUnitStatus } from "@/lib/search-site-status";
import { DashboardCollapsibleSection } from "./dashboard-collapsible-section";

export type SearchKpiKind = "scanned" | "completed" | "no_answer" | "casualties";

export type SearchKpiDrilldownEntry = {
  unitId: string;
  siteName: string | null;
  floorNumber: number | null;
  unitLabel: string;
  familyName: string | null;
  status: SearchUnitStatus;
  anxietyCasualtiesCount: number;
  physicalCasualtiesCount: number;
  hasApartmentDamage: boolean;
  apartmentDamageNotes: string | null;
};

export type SearchSiteWidgetSite = {
  id: string;
  name: string;
  address: string | null;
  parentName: string | null;
  searchPriority: string | null;
  searchReason: string | null;
  summary: SearchStatusSummary;
  anxietyCasualtiesCount: number;
  physicalCasualtiesCount: number;
  damagedUnitsCount: number;
  entries: SearchKpiDrilldownEntry[];
};

export type SearchSitesWidgetData = {
  sites: SearchSiteWidgetSite[];
  updatedAt: string;
};

function searchUnitStatusLabel(status: SearchUnitStatus) {
  const labels: Record<SearchUnitStatus, string> = {
    not_visited: "טרם נסרקה",
    no_answer: "אין מענה",
    clear: "תקין",
    casualties: "דווחו נפגעים",
    completed: "סיום טיפול / מזוכה"
  };

  return labels[status];
}

function searchUnitTone(status: SearchUnitStatus) {
  if (status === "completed") return "complete";
  if (status === "clear") return "clear";
  if (status === "casualties") return "casualties";
  if (status === "no_answer") return "no-answer";
  return "not-visited";
}

function matchesSearchKpi(status: SearchUnitStatus, kind: SearchKpiKind) {
  if (kind === "scanned") return ["clear", "no_answer", "casualties", "completed"].includes(status);
  if (kind === "completed") return status === "completed";
  if (kind === "no_answer") return status === "no_answer";
  return status === "casualties";
}

function SearchKpiDrilldown({ title, entries }: { title: string; entries: SearchKpiDrilldownEntry[] }) {
  return (
    <div className="search-kpi-drilldown-panel">
      <strong>{title}</strong>
      {entries.length === 0 ? (
        <p className="muted">אין דירות להצגה</p>
      ) : (
        <ul className="search-kpi-drilldown-list">
          {entries.map((entry) => (
            <li key={`${entry.siteName ?? "site"}-${entry.unitId}`}>
              {entry.siteName ? <span>{entry.siteName}</span> : null}
              <span>קומה {entry.floorNumber ?? "-"}</span>
              <strong>{entry.unitLabel}</strong>
              <span>{entry.familyName ? `משפחת ${entry.familyName}` : "משפחה לא צוינה"}</span>
              {entry.anxietyCasualtiesCount > 0 ? <span>נפגעי חרדה: {formatNumber(entry.anxietyCasualtiesCount)}</span> : null}
              {entry.physicalCasualtiesCount > 0 ? <span>נפגעי גוף: {formatNumber(entry.physicalCasualtiesCount)}</span> : null}
              {entry.hasApartmentDamage ? <span>נזק לדירה</span> : null}
              {entry.apartmentDamageNotes ? <span>{entry.apartmentDamageNotes}</span> : null}
              <span className={`search-unit-status ${searchUnitTone(entry.status)}`}>{searchUnitStatusLabel(entry.status)}</span>
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
    return {
      scanned: allEntries.filter((entry) => matchesSearchKpi(entry.status, "scanned")),
      completed: allEntries.filter((entry) => matchesSearchKpi(entry.status, "completed")),
      no_answer: allEntries.filter((entry) => matchesSearchKpi(entry.status, "no_answer")),
      casualties: allEntries.filter((entry) => matchesSearchKpi(entry.status, "casualties")),
      damaged: allEntries.filter((entry) => entry.hasApartmentDamage)
    };
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
          acc.damagedUnits += site.damagedUnitsCount;
          return acc;
        },
        { totalUnits: 0, scanned: 0, completed: 0, noAnswer: 0, casualties: 0, anxietyCasualties: 0, physicalCasualties: 0, damagedUnits: 0 }
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
      <div className="search-sites-summary-grid search-sites-kpi-grid" aria-label="סיכום דירות באתרי סריקה">
        <div className="search-kpi-total">
          <span>סה״כ דירות</span>
          <strong>{formatNumber(totals.totalUnits)}</strong>
        </div>
        <details className="search-kpi-click-card search-kpi-scanned">
          <summary><span>דירות שנסרקו</span><strong>{formatNumber(totals.scanned)}</strong></summary>
          <SearchKpiDrilldown title="דירות שנסרקו" entries={entriesByKpi.scanned} />
        </details>
        <details className="search-kpi-click-card search-kpi-completed">
          <summary><span>דירות זוכו</span><strong>{formatNumber(totals.completed)}</strong></summary>
          <SearchKpiDrilldown title="דירות זוכו" entries={entriesByKpi.completed} />
        </details>
        <details className="search-kpi-click-card search-kpi-no-answer">
          <summary><span>אין מענה</span><strong>{formatNumber(totals.noAnswer)}</strong></summary>
          <SearchKpiDrilldown title="דירות ללא מענה" entries={entriesByKpi.no_answer} />
        </details>
        <details className="search-kpi-click-card search-kpi-casualties">
          <summary><span>דווחו נפגעים</span><strong>{formatNumber(totals.casualties)}</strong></summary>
          <SearchKpiDrilldown title="דירות עם דיווח נפגעים" entries={entriesByKpi.casualties} />
        </details>
        <div className="search-kpi-total search-kpi-warning">
          <span>סה"כ נפגעי חרדה</span>
          <strong>{formatNumber(totals.anxietyCasualties)}</strong>
        </div>
        <div className="search-kpi-total search-kpi-danger">
          <span>סה"כ נפגעי גוף</span>
          <strong>{formatNumber(totals.physicalCasualties)}</strong>
        </div>
        <details className="search-kpi-click-card search-kpi-damage">
          <summary><span>דירות עם נזק</span><strong>{formatNumber(totals.damagedUnits)}</strong></summary>
          <SearchKpiDrilldown title="דירות עם נזק" entries={entriesByKpi.damaged} />
        </details>
      </div>

      <div className="search-sites-dashboard-list">
        {data.sites.map((site) => {
          const siteScanned = searchScannedCount(site.summary);
          const siteLiveStatus = searchLiveStatus(site.summary);
          const siteEntriesByKpi = {
            scanned: site.entries.filter((entry) => matchesSearchKpi(entry.status, "scanned")),
            completed: site.entries.filter((entry) => matchesSearchKpi(entry.status, "completed")),
            no_answer: site.entries.filter((entry) => matchesSearchKpi(entry.status, "no_answer")),
            casualties: site.entries.filter((entry) => matchesSearchKpi(entry.status, "casualties")),
            damaged: site.entries.filter((entry) => entry.hasApartmentDamage)
          };

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
              <div className="search-site-card-kpis" aria-label="סיכום סריקה לאתר">
                <div className="search-kpi-total"><span>סה״כ</span><strong>{formatNumber(site.summary.total_units)}</strong></div>
                <details className="search-kpi-click-card search-kpi-scanned">
                  <summary><span>נסרקו</span><strong>{formatNumber(siteScanned)}</strong></summary>
                  <SearchKpiDrilldown title="דירות שנסרקו" entries={siteEntriesByKpi.scanned} />
                </details>
                <details className="search-kpi-click-card search-kpi-completed">
                  <summary><span>זוכו</span><strong>{formatNumber(site.summary.completed_count)}</strong></summary>
                  <SearchKpiDrilldown title="דירות זוכו" entries={siteEntriesByKpi.completed} />
                </details>
                <details className="search-kpi-click-card search-kpi-no-answer">
                  <summary><span>אין מענה</span><strong>{formatNumber(site.summary.no_answer_count)}</strong></summary>
                  <SearchKpiDrilldown title="דירות ללא מענה" entries={siteEntriesByKpi.no_answer} />
                </details>
                <details className="search-kpi-click-card search-kpi-casualties">
                  <summary><span>נפגעים</span><strong>{formatNumber(site.summary.casualties_count)}</strong></summary>
                  <SearchKpiDrilldown title="דירות עם דיווח נפגעים" entries={siteEntriesByKpi.casualties} />
                </details>
                <div className="search-kpi-total search-kpi-warning"><span>חרדה</span><strong>{formatNumber(site.anxietyCasualtiesCount)}</strong></div>
                <div className="search-kpi-total search-kpi-danger"><span>גוף</span><strong>{formatNumber(site.physicalCasualtiesCount)}</strong></div>
                <details className="search-kpi-click-card search-kpi-damage">
                  <summary><span>נזק</span><strong>{formatNumber(site.damagedUnitsCount)}</strong></summary>
                  <SearchKpiDrilldown title="דירות עם נזק" entries={siteEntriesByKpi.damaged} />
                </details>
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
