"use client";

import { useMemo, useState } from "react";
import { formatNumber } from "@/lib/format";
import { DashboardSiteCommandSummary, type SiteAnalysisRow } from "./dashboard-site-command-summary-v2";
import { OperationalStatusOverview, type OperationalStatusSiteBreakdown, type OperationalStatusTile } from "./operational-status-overview";
import { CreateSitrepButton } from "./sitreps/create-sitrep-button";
import type { PersonnelTeamItem } from "./personnel-team-drilldown";
import { PersonnelTeamCommandWidget } from "./personnel-team-command-widget";

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
  latestReportedAt: string | null;
  dashboardStatusGroup: string | null;
};

const STATUS_GROUPS = [
  { group: "missing_unknown", label: "נעדר / לא ידוע", tone: "blue" },
  { group: "trapped_located_not_yet_rescued", label: "לכוד שאותר וטרם חולץ", tone: "orange" },
  { group: "rescued", label: "מחולצים", tone: "green" },
  { group: "evacuated", label: "פונו", tone: "green" },
  { group: "located_outside_site", label: "אותרו מחוץ לאתר", tone: "green" },
  { group: "deceased", label: "נפטרים", tone: "red" }
] as const;

function latestDate(rows: Array<string | null | undefined>) {
  const timestamps = rows
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value));

  if (timestamps.length === 0) return null;
  return new Date(Math.max(...timestamps));
}

function timeAgo(now: Date, date: Date | null) {
  if (!date) return "אין עדכון";

  const diffMinutes = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 60000));
  if (diffMinutes < 1) return "כעת";
  if (diffMinutes < 60) return `לפני ${diffMinutes} דק׳`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `לפני ${diffHours} שעות`;

  const diffDays = Math.floor(diffHours / 24);
  return `לפני ${diffDays} ימים`;
}

function eventDuration(now: Date, openedAt: string) {
  const opened = new Date(openedAt);
  const diffMinutes = Math.max(0, Math.floor((now.getTime() - opened.getTime()) / 60000));
  const days = Math.floor(diffMinutes / 1440);
  const hours = Math.floor((diffMinutes % 1440) / 60);
  const minutes = diffMinutes % 60;

  if (days > 0) return `${days} ימים ${hours} שעות`;
  if (hours > 0) return `${hours} שעות ${minutes} דק׳`;
  return `${minutes} דק׳`;
}

function exceptionCount(sites: SiteAnalysisRow[]) {
  return sites.filter((site) => site.level === "high" || site.teams.length === 0 || site.operationalGap > 0).length;
}

function scopedTeams(teams: PersonnelTeamItem[], visiblePersonIds: Set<string>) {
  return teams
    .map((team) => ({
      ...team,
      operationalRows: team.operationalRows.filter((row) => visiblePersonIds.has(row.personId))
    }))
    .filter((team) => team.operationalRows.length > 0 || team.total > 0);
}

function operationalPersonName(person: DashboardScopeOperationalNumber) {
  const directName = [person.firstName, person.lastName].filter(Boolean).join(" ").trim();
  if (directName) return directName;

  const residentName = [person.residentFirstName, person.residentLastName].filter(Boolean).join(" ").trim();
  return residentName || null;
}

function statusBreakdown(operationalNumbers: DashboardScopeOperationalNumber[], group: string) {
  const counts = operationalNumbers
    .filter((person) => person.dashboardStatusGroup === group)
    .reduce((map, person) => {
      const label = person.latestReportStatusLabel?.trim() || person.currentStatusLabel?.trim() || person.currentStatusKey?.trim() || "לא ידוע";
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
      statusLabel: person.latestReportStatusLabel?.trim() || person.currentStatusLabel?.trim() || person.currentStatusKey?.trim() || "לא ידוע",
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

export function DashboardCommandScope({
  incidentId,
  canCreateSitrep,
  openedAt,
  latestSitrepAt,
  sites,
  operationalNumbers,
  personnelTeams
}: {
  incidentId: string;
  canCreateSitrep: boolean;
  openedAt: string;
  latestSitrepAt: string | null;
  sites: SiteAnalysisRow[];
  operationalNumbers: DashboardScopeOperationalNumber[];
  personnelTeams: PersonnelTeamItem[];
}) {
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [anchorOpen, setAnchorOpen] = useState(true);
  const selectedSite = sites.find((site) => site.siteId === selectedSiteId) ?? null;
  const visibleSites = selectedSite ? [selectedSite] : sites;
  const visibleOperationalNumbers = selectedSite
    ? operationalNumbers.filter((person) => person.siteId === selectedSite.siteId)
    : operationalNumbers;
  const visiblePersonIds = useMemo(
    () => new Set(visibleOperationalNumbers.map((person) => person.personId)),
    [visibleOperationalNumbers]
  );
  const now = useMemo(() => new Date(), []);
  const latestOperationalUpdate = latestDate(visibleOperationalNumbers.map((person) => person.latestReportedAt));
  const visiblePersonnelTeams = scopedTeams(personnelTeams, visiblePersonIds);
  const sitesById = useMemo(() => new Map(sites.map((site) => [site.siteId, site])), [sites]);
  const visibleTiles = STATUS_GROUPS.map((status) =>
    statusTile(visibleOperationalNumbers, sitesById, status.group, status.label, status.tone)
  );
  const kpis = [
    {
      id: "duration",
      label: "משך האירוע",
      value: eventDuration(now, openedAt),
      detail: "מאז פתיחת האירוע"
    },
    {
      id: "last-update",
      label: "עדכון מבצעי אחרון",
      value: timeAgo(now, latestOperationalUpdate),
      detail: "לפי הדיווח המבצעי האחרון",
      tone: latestOperationalUpdate && now.getTime() - latestOperationalUpdate.getTime() > 60 * 60 * 1000 ? "warning" : "default"
    },
    {
      id: "last-sitrep",
      label: "חיתוך מצב אחרון",
      value: timeAgo(now, latestSitrepAt ? new Date(latestSitrepAt) : null),
      detail: "לפי דוח חיתוך המצב האחרון"
    },
    {
      id: "exceptions",
      label: "חריגים פעילים",
      value: formatNumber(exceptionCount(visibleSites)),
      detail: "פער גבוה, אתר ללא צוות או פער פתוח",
      tone: exceptionCount(visibleSites) > 0 ? "danger" : "default"
    }
  ];

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
        {canCreateSitrep ? <CreateSitrepButton incidentId={incidentId} className="button dashboard-sitrep-action" /> : null}
      </section>

      <section className="command-kpi-bar" aria-label="מדדי פיקוד">
        {kpis.map((item) => (
          <article className={`command-kpi-card tone-${item.tone ?? "default"}`} key={item.id}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <small>{item.detail}</small>
          </article>
        ))}
      </section>

      <section className="panel section-spaced">
        <div className="command-section-heading">
          <div>
            <h2>טבלת עוגן</h2>
            <p className="muted">פירוק לפי הסטטוס המבצעי העדכני</p>
          </div>
          <button className="button compact secondary" type="button" onClick={() => setAnchorOpen((value) => !value)}>
            {anchorOpen ? "סגור" : "פתח"}
          </button>
        </div>
        {anchorOpen ? <OperationalStatusOverview tiles={visibleTiles} /> : null}
      </section>

      <DashboardSiteCommandSummary sites={visibleSites} />

      <section className="panel section-spaced">
        <PersonnelTeamCommandWidget teams={visiblePersonnelTeams} />
      </section>
    </>
  );
}
