"use client";

import { useMemo, useState } from "react";
import { DashboardSiteAnalysis, type SiteAnalysisRow } from "./dashboard-site-analysis";
import { KpiDrilldown, type KpiDrilldownItem } from "./kpi-drilldown";
import { OperationalStatusOverview, type OperationalStatusSiteBreakdown, type OperationalStatusTile } from "./operational-status-overview";
import { PersonnelTeamDrilldown, type PersonnelTeamItem } from "./personnel-team-drilldown";

export type DashboardScopeOperationalNumber = {
  personId: string;
  siteId: string | null;
  operationalNumber: number;
  firstName: string | null;
  lastName: string | null;
  residentFirstName: string | null;
  residentLastName: string | null;
  currentStatusKey: string | null;
  currentStatusLabel: string | null;
  latestReportStatusLabel: string | null;
  dashboardStatusGroup: string | null;
};

const STATUS_GROUPS = [
  { group: "missing_unknown", label: "נעדר / לא ידוע", tone: "blue" },
  { group: "trapped_located_not_yet_rescued", label: "לכוד אותר וטרם חולץ", tone: "orange" },
  { group: "rescued", label: "מחולצים", tone: "green" },
  { group: "evacuated", label: "פונו", tone: "green" },
  { group: "located_outside_site", label: "אותרו מחוץ לאתר", tone: "green" },
  { group: "deceased", label: "נפטרים", tone: "red" }
] as const;

function operationalPersonName(person: DashboardScopeOperationalNumber) {
  const personName = [person.firstName, person.lastName].filter(Boolean).join(" ").trim();
  if (personName) return personName;

  const residentName = [person.residentFirstName, person.residentLastName].filter(Boolean).join(" ").trim();
  return residentName || null;
}

function statusBreakdown(operationalNumbers: DashboardScopeOperationalNumber[], group: string) {
  const counts = operationalNumbers
    .filter((person) => person.dashboardStatusGroup === group)
    .reduce((map, person) => {
      const label = person.currentStatusLabel?.trim() || person.currentStatusKey?.trim() || "לא ידוע";
      map.set(label, (map.get(label) ?? 0) + 1);
      return map;
    }, new Map<string, number>());

  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "he"));
}

function statusTile(
  operationalNumbers: DashboardScopeOperationalNumber[],
  sitesById: Map<string, SiteAnalysisRow>,
  group: string,
  label: string,
  tone: string
): OperationalStatusTile {
  const details = statusBreakdown(operationalNumbers, group);
  const filteredNumbers = operationalNumbers.filter((person) => person.dashboardStatusGroup === group);
  const siteBreakdown = filteredNumbers.reduce((map, person) => {
    const site = person.siteId ? sitesById.get(person.siteId) : null;
    const siteName = site?.name ?? "ללא אתר";
    const current: OperationalStatusSiteBreakdown = map.get(person.siteId ?? "none") ?? {
      siteId: person.siteId,
      siteName,
      count: 0,
      people: []
    };
    current.count += 1;
    current.people.push({
      operationalNumber: person.operationalNumber,
      statusLabel:
        person.latestReportStatusLabel?.trim() ||
        person.currentStatusLabel?.trim() ||
        person.currentStatusKey?.trim() ||
        "לא ידוע",
      personName: operationalPersonName(person)
    });
    map.set(person.siteId ?? "none", current);
    return map;
  }, new Map<string, OperationalStatusSiteBreakdown>());

  return {
    group,
    label,
    tone,
    details,
    siteBreakdown: Array.from(siteBreakdown.values()).sort((a, b) => b.count - a.count || a.siteName.localeCompare(b.siteName, "he")),
    value: details.reduce((sum, row) => sum + row.count, 0)
  };
}

function scopedKpis(allKpis: KpiDrilldownItem[], selectedSite: SiteAnalysisRow | null): KpiDrilldownItem[] {
  if (!selectedSite) return allKpis;

  return [
    {
      id: "initial-potential",
      label: "פוטנציאל ראשוני",
      value: selectedSite.initialPotential,
      detailLabel: "פוטנציאל ראשוני",
      rows: [{ label: selectedSite.name, href: selectedSite.structureHref, value: selectedSite.initialPotential }]
    },
    {
      id: "updated-potential",
      label: "פוטנציאל מעודכן",
      value: selectedSite.updatedPotential,
      detailLabel: "פוטנציאל מעודכן",
      rows: [{ label: selectedSite.name, href: selectedSite.structureHref, value: selectedSite.updatedPotential }]
    },
    {
      id: "active-operational-numbers",
      label: "מספרים מבצעיים פעילים",
      value: selectedSite.activeOperationalNumbers,
      detailLabel: "מספרים פעילים",
      rows: [{ label: selectedSite.name, href: selectedSite.structureHref, value: selectedSite.activeOperationalNumbers }]
    },
    {
      id: "operational-gap",
      label: "פער מבצעי",
      value: selectedSite.operationalGap,
      tone: "gap",
      detailLabel: "פער",
      rows: [{ label: selectedSite.name, href: selectedSite.structureHref, value: selectedSite.operationalGap }]
    }
  ];
}

export function DashboardSiteScope({
  kpiItems,
  sites,
  operationalNumbers,
  personnelTeams
}: {
  kpiItems: KpiDrilldownItem[];
  sites: SiteAnalysisRow[];
  operationalNumbers: DashboardScopeOperationalNumber[];
  personnelTeams: PersonnelTeamItem[];
}) {
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const selectedSite = sites.find((site) => site.siteId === selectedSiteId) ?? null;
  const visibleSites = selectedSite ? [selectedSite] : sites;
  const visibleOperationalNumbers = selectedSite
    ? operationalNumbers.filter((person) => person.siteId === selectedSite.siteId)
    : operationalNumbers;
  const visiblePersonIds = new Set(visibleOperationalNumbers.map((person) => person.personId));
  const visiblePersonnelTeams = personnelTeams.map((team) => ({
    ...team,
    operationalRows: selectedSite ? team.operationalRows.filter((row) => visiblePersonIds.has(row.personId)) : team.operationalRows
  }));
  const sitesById = useMemo(() => new Map(sites.map((site) => [site.siteId, site])), [sites]);
  const visibleKpis = scopedKpis(kpiItems, selectedSite);
  const visibleTiles = STATUS_GROUPS.map((status) =>
    statusTile(visibleOperationalNumbers, sitesById, status.group, status.label, status.tone)
  );

  return (
    <>
      <section className="dashboard-scope-toolbar" aria-label="סינון תמונת מצב פיקודית">
        <div className="site-scope-tabs">
          <button className={`site-scope-tab ${!selectedSiteId ? "active" : ""}`} type="button" onClick={() => setSelectedSiteId(null)}>
            כל האתרים
          </button>
          {sites.map((site) => (
            <button
              className={`site-scope-tab ${selectedSiteId === site.siteId ? "active" : ""}`}
              type="button"
              key={site.siteId}
              onClick={() => setSelectedSiteId(site.siteId)}
            >
              {site.name}
            </button>
          ))}
        </div>
      </section>

      <KpiDrilldown items={visibleKpis} />

      <section className="panel section-spaced">
        <div className="command-section-heading">
          <div>
            <h2>טבלת עוגן</h2>
            <p className="muted">פירוק לפי הסטטוס המבצעי העדכני</p>
          </div>
        </div>
        <OperationalStatusOverview tiles={visibleTiles} />
      </section>

      <DashboardSiteAnalysis sites={visibleSites} />

      <section className="panel section-spaced">
        <PersonnelTeamDrilldown teams={visiblePersonnelTeams} />
      </section>
    </>
  );
}
