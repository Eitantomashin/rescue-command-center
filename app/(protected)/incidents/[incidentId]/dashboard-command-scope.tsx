"use client";

import { useMemo, useState } from "react";
import { formatNumber } from "@/lib/format";
import { DashboardSiteCommandSummary, type SiteAnalysisRow } from "./dashboard-site-command-summary";
import type { PersonnelTeamItem } from "./personnel-team-drilldown";
import { PersonnelTeamCommandWidget } from "./personnel-team-command-widget";

export type CommandDashboardKpi = {
  id: string;
  label: string;
  value: string;
  detail: string;
  tone?: "default" | "warning" | "danger";
};

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
    .filter((team) => {
      const alwaysVisible = ["team_1", "team_2", "team_3", "population", "command_post", "logistics", "medical"].includes(team.id);
      return alwaysVisible || team.operationalRows.length > 0 || team.total > 0;
    });
}

export function DashboardCommandScope({
  openedAt,
  latestSitrepAt,
  sites,
  operationalNumbers,
  personnelTeams
}: {
  openedAt: string;
  latestSitrepAt: string | null;
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
  const visiblePersonIds = useMemo(
    () => new Set(visibleOperationalNumbers.map((person) => person.personId)),
    [visibleOperationalNumbers]
  );
  const now = useMemo(() => new Date(), []);
  const latestOperationalUpdate = latestDate(visibleOperationalNumbers.map((person) => person.latestReportedAt));
  const visiblePersonnelTeams = scopedTeams(personnelTeams, visiblePersonIds);
  const kpis: CommandDashboardKpi[] = [
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

      <DashboardSiteCommandSummary sites={visibleSites} />

      <section className="panel section-spaced">
        <PersonnelTeamCommandWidget teams={visiblePersonnelTeams} />
      </section>
    </>
  );
}
