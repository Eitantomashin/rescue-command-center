"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { formatNumber } from "@/lib/format";
import { isOpenSearchCasualtyUnit, isResolvedSearchCasualtyUnit, searchLiveStatus, searchUnitProcessLabel, searchUnitStatusTone, type SearchStatusSummary, type SearchUnitStatus } from "@/lib/search-site-status";
import { DashboardCollapsibleSection } from "./dashboard-collapsible-section";
import { SearchOperationalKpis } from "@/app/mobile/search/search-operational-kpis";
import { formatSearchEvacuatedAt, searchCasualtyPersonStatusLabel, searchEvacuationState, type SearchCasualtyPerson } from "@/lib/search-casualty-person";
import { searchOperationalKpiCollections } from "@/lib/search-operational-kpis";
import type { SearchOperationalGapEntry } from "@/lib/search-population-operational-gap";

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
  operationalGapEntries: SearchOperationalGapEntry[];
  summary: SearchStatusSummary;
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

function SearchApartmentKpiCard({
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

function SearchPersonKpiCard({ className, label, title, people }: { className: string; label: string; title: string; people: SearchCasualtyPerson[] }) {
  return <details className={"search-kpi-click-card " + className}><summary><span>{label}</span><strong>{formatNumber(people.length)}</strong></summary><div className="search-kpi-drilldown-panel"><strong>{title}</strong>{people.length ? <ul className="search-kpi-drilldown-list">{people.map((person) => { const evacuation = searchEvacuationState(person); return <li key={person.residentId}><strong>{[person.firstName, person.lastName].filter(Boolean).join(" ") || "ללא שם"}</strong><span>קומה {person.floorNumber ?? "-"} · דירה {person.unitNumber}</span><span>{searchCasualtyPersonStatusLabel(person.status)}</span>{evacuation === "waiting" ? <span>ממתין לפינוי</span> : evacuation === "evacuated" ? <span>פונה{formatSearchEvacuatedAt(person.evacuatedAt) ? ` ב־${formatSearchEvacuatedAt(person.evacuatedAt)}` : ""}</span> : null}</li>; })}</ul> : <p className="muted">אין פריטים להצגה</p>}</div></details>;
}

function operationalGapStatusLabel(status: string | null) {
  if (status === "not_checked") return "טרם נבדק";
  if (status === "resident_clear") return "תקין";
  return status === "anxiety_casualty" ? "נפגע חרדה" : status === "physical_casualty" ? "נפגע גוף" : status === "deceased" ? "חלל" : "מצב דייר לא ידוע";
}

function SearchOperationalGapKpiCard({ value, entries }: { value: number; entries: SearchOperationalGapEntry[] }) {
  return <details className="search-operational-gap-card search-kpi-click-card"><summary><span>פער מבצעי</span><strong>{formatNumber(value)}</strong></summary><div className="search-kpi-drilldown-panel"><strong>פירוט אנשים שטרם נסגרו מבצעית</strong>{entries.length ? <ul className="search-kpi-drilldown-list">{entries.map((entry, index) => <li key={entry.kind === "resident" ? entry.residentId ?? String(index) : `${entry.unitId}-unidentified`}><strong>{entry.kind === "unidentified" ? `${entry.reason}: ${formatNumber(entry.representedCount)}` : [entry.firstName, entry.lastName].filter(Boolean).join(" ") || "ללא שם"}</strong><span>{entry.siteName} · קומה {entry.floorNumber ?? "-"} · {entry.unitLabel}</span>{entry.kind === "resident" ? <><span>{operationalGapStatusLabel(entry.statusKey)}</span><span>{entry.reason}</span>{entry.requiresEvacuation ? <span>{searchEvacuationState({ status: entry.statusKey as "anxiety_casualty" | "physical_casualty" | "deceased", requiresEvacuation: entry.requiresEvacuation, evacuatedAt: entry.evacuatedAt }) === "waiting" ? "ממתין לפינוי" : "פונה"}</span> : null}</> : null}</li>)}</ul> : <p className="muted">אין אנשים פתוחים להצגה</p>}</div></details>;
}

function SearchSiteKpiRow({ label, children }: { label: string; children: ReactNode }) {
  return <section className="search-site-card-kpi-row"><h3>{label}</h3><div className="search-site-card-kpis">{children}</div></section>;
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
          const kpis = searchOperationalKpiCollections(site.entries, site.casualtyPeople);
          const siteLiveStatus = searchLiveStatus(site.summary);

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
                  <div><dt>פער מבצעי</dt><dd><SearchOperationalGapKpiCard value={site.operationalGap ?? 0} entries={site.operationalGapEntries} /></dd></div>
                </dl>
              </section>
              <div className="search-site-kpi-rows" aria-label={"\u05E1\u05D9\u05DB\u05D5\u05DD \u05E1\u05E8\u05D9\u05E7\u05D4 \u05DC\u05D0\u05EA\u05E8"}>
              <SearchSiteKpiRow label="סטטוס הסריקה">
                <SearchApartmentKpiCard className="search-kpi-total" label="סה״כ דירות" value={kpis.process.total.length} title="כל הדירות באתר" entries={kpis.process.total} />
                <SearchApartmentKpiCard className="search-kpi-no-answer" label="טרם התחילה" value={kpis.process.notStarted.length} title="דירות שטרם החלה בהן סריקה" entries={kpis.process.notStarted} />
                <SearchApartmentKpiCard className="search-kpi-scanned" label="בסריקה" value={kpis.process.inProgress.length} title="דירות בסריקה" entries={kpis.process.inProgress} />
                <SearchApartmentKpiCard className="search-kpi-no-answer" label="אין מענה" value={kpis.process.noAnswer.length} title="דירות ללא מענה" entries={kpis.process.noAnswer} />
                <SearchApartmentKpiCard className="search-kpi-completed" label="סריקה הושלמה" value={kpis.process.completed.length} title="דירות שהסריקה בהן הושלמה" entries={kpis.process.completed} />
              </SearchSiteKpiRow>
              <SearchSiteKpiRow label="ממצאים בדירות">
                <SearchApartmentKpiCard className="search-kpi-completed" label="דירות שזוכו" value={kpis.findings.cleared.length} title="דירות שזוכו" entries={kpis.findings.cleared} />
                <SearchApartmentKpiCard className="search-kpi-damage" label="דירות עם נזק" value={kpis.findings.damaged.length} title="דירות עם נזק" entries={kpis.findings.damaged} />
                <SearchApartmentKpiCard className="search-kpi-danger" label="טיפול בנפגעים פתוח" value={kpis.findings.openCasualties.length} title="דירות עם טיפול פתוח בנפגעים" entries={kpis.findings.openCasualties} />
                <SearchApartmentKpiCard className="search-kpi-completed" label="טיפול בנפגעים הסתיים" value={kpis.findings.resolvedCasualties.length} title="דירות שבהן הטיפול בנפגעים הסתיים" entries={kpis.findings.resolvedCasualties} />
              </SearchSiteKpiRow>
              <SearchSiteKpiRow label="תמונת נפגעים ופינוי">
                <SearchPersonKpiCard className="search-kpi-warning" label="נפגעי חרדה" title="נפגעי חרדה" people={kpis.findings.anxiety} />
                <SearchPersonKpiCard className="search-kpi-danger" label="נפגעי גוף" title="נפגעי גוף" people={kpis.findings.physical} />
                <SearchPersonKpiCard className="search-kpi-danger" label="חללים" title="חללים" people={kpis.findings.deceased} />
                <SearchPersonKpiCard className="search-kpi-warning" label="ממתינים לפינוי" title="ממתינים לפינוי" people={kpis.findings.waitingEvacuation} />
              </SearchSiteKpiRow>
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
