"use client";

import { useEffect, useMemo, useState } from "react";
import { formatNumber } from "@/lib/format";
import { operationalTeamLabel } from "@/lib/operational-teams";
import { DashboardSiteCommandSummary, type SiteAnalysisRow } from "./dashboard-site-command-summary-v2";
import { CommandStatusDashboard, type CommandStatusDefinition, type CommandStatusRow } from "./command-dashboard/command-status-dashboard";
import { loadOperationalPersonCommandTimeline } from "./command-dashboard/actions";
import { CreateSitrepButton } from "./sitreps/create-sitrep-button";
import type { PersonnelTeamItem } from "./personnel-team-drilldown";
import { PersonnelTeamCommandWidget } from "./personnel-team-command-widget";

export type DashboardScopeOperationalNumber = {
  personId: string;
  siteId: string | null;
  operationalNumber: number;
  teamNumber: number | null;
  firstName: string | null;
  lastName: string | null;
  residentFirstName: string | null;
  residentLastName: string | null;
  currentStatusKey: string | null;
  currentStatusLabel: string | null;
  latestReportStatusLabel: string | null;
  latestReportedAt: string | null;
  latestSourcePhone?: string | null;
  latestNotes?: string | null;
  latestGridCell?: string | null;
  floorNumber?: number | null;
  unitNumber?: string | null;
  dashboardStatusGroup: string | null;
  mergedOperationalNumbers?: number[] | null;
};

type CommandKpi = {
  id: string;
  label: string;
  value: string;
  detail: string;
  tone?: string;
  clickable?: boolean;
  detailLines?: string[];
  clockParts?: ActivityClockParts;
};

type ActivityClockParts = {
  missingStart: boolean;
  days: number;
  hours: number;
  minutes: number;
  startLabel: string;
  currentLabel: string;
};

const STATUS_GROUPS: CommandStatusDefinition[] = [
  { id: "missing_unknown", label: "\u05e0\u05e2\u05d3\u05e8 / \u05dc\u05d0 \u05d9\u05d3\u05d5\u05e2", tone: "blue", icon: "?" },
  { id: "trapped_located_not_yet_rescued", label: "\u05dc\u05db\u05d5\u05d3 \u05e9\u05d0\u05d5\u05ea\u05e8 \u05d5\u05d8\u05e8\u05dd \u05d7\u05d5\u05dc\u05e5", tone: "orange", icon: "!" },
  { id: "rescued", label: "\u05de\u05d7\u05d5\u05dc\u05e6\u05d9\u05dd", tone: "green", icon: "?" },
  { id: "evacuated", label: "\u05e4\u05d5\u05e0\u05d4", tone: "green", icon: "?" },
  { id: "located_outside_site", label: "\u05d4\u05d5\u05e6\u05d0\u05d5 \u05de\u05d7\u05d5\u05e5 \u05dc\u05d0\u05ea\u05e8", tone: "green", icon: "?" },
  { id: "deceased", label: "\u05e0\u05e4\u05d8\u05e8\u05d9\u05dd", tone: "red", icon: "?" }
];

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


function formatClockDateTime(date: Date | null) {
  if (!date) return "\u05DC\u05D0 \u05D4\u05D5\u05D2\u05D3\u05E8\u05D4";

  const datePart = new Intl.DateTimeFormat("he-IL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(date);
  const timePart = new Intl.DateTimeFormat("he-IL", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);

  return `${datePart} | ${timePart}`;
}

function incidentStartDate(openedAt: string | null | undefined) {
  if (!openedAt) return null;
  const date = new Date(openedAt);
  return Number.isFinite(date.getTime()) ? date : null;
}

function activityClockParts(now: Date, openedAt: string | null | undefined): ActivityClockParts {
  const opened = incidentStartDate(openedAt);
  if (!opened) {
    return {
      missingStart: true,
      days: 0,
      hours: 0,
      minutes: 0,
      startLabel: "\u05DC\u05D0 \u05D4\u05D5\u05D2\u05D3\u05E8\u05D4 \u05E9\u05E2\u05EA \u05D4\u05EA\u05D7\u05DC\u05D4",
      currentLabel: formatClockDateTime(now)
    };
  }

  const diffMinutes = Math.max(0, Math.floor((now.getTime() - opened.getTime()) / 60000));
  return {
    missingStart: false,
    days: Math.floor(diffMinutes / 1440),
    hours: Math.floor((diffMinutes % 1440) / 60),
    minutes: diffMinutes % 60,
    startLabel: formatClockDateTime(opened),
    currentLabel: formatClockDateTime(now)
  };
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

function mergedNumberGroups(operationalNumbers: DashboardScopeOperationalNumber[]) {
  return operationalNumbers
    .map((person) => ({
      ...person,
      mergedOperationalNumbers: person.mergedOperationalNumbers?.filter((number) => Number.isFinite(number)) ?? []
    }))
    .filter((person) => person.mergedOperationalNumbers.length > 0)
    .sort((a, b) => a.operationalNumber - b.operationalNumber);
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

function floorApartmentLabel(person: DashboardScopeOperationalNumber) {
  const parts: string[] = [];
  if (person.floorNumber !== null && person.floorNumber !== undefined) parts.push("\u05e7\u05d5\u05de\u05d4 " + person.floorNumber);
  if (person.unitNumber) parts.push("\u05d3\u05d9\u05e8\u05d4 " + person.unitNumber);
  if (person.latestGridCell && parts.length === 0) parts.push(person.latestGridCell);
  return parts.join(" / ") || null;
}

function statusDashboardRows(incidentId: string, operationalNumbers: DashboardScopeOperationalNumber[], sitesById: Map<string, SiteAnalysisRow>): CommandStatusRow[] {
  return operationalNumbers.map((person) => {
    const site = person.siteId ? sitesById.get(person.siteId) : null;
    return {
      personId: person.personId,
      statusId: person.dashboardStatusGroup ?? "missing_unknown",
      statusLabel: person.latestReportStatusLabel?.trim() || person.currentStatusLabel?.trim() || person.currentStatusKey?.trim() || "\u05dc\u05d0 \u05d9\u05d3\u05d5\u05e2",
      operationalNumber: person.operationalNumber,
      name: operationalPersonName(person),
      siteName: site?.name ?? null,
      floorApartment: floorApartmentLabel(person),
      assignedTeam: person.teamNumber ? operationalTeamLabel(person.teamNumber) : null,
      lastUpdatedAt: person.latestReportedAt,
      phone: person.latestSourcePhone ?? null,
      notes: person.latestNotes ?? null,
      siteHref: site ? site.structureHref : null,
      teamHref: person.teamNumber ? "/incidents/" + incidentId + "/personnel" : null,
      operationalNumberHref: site ? site.operationalNumbersHref + "?personId=" + person.personId : null
    };
  });
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
  const [openKpi, setOpenKpi] = useState<string | null>(null);
  const selectedSite = sites.find((site) => site.siteId === selectedSiteId) ?? null;
  const visibleSites = selectedSite ? [selectedSite] : sites;
  const visibleOperationalNumbers = selectedSite
    ? operationalNumbers.filter((person) => person.siteId === selectedSite.siteId)
    : operationalNumbers;
  const visiblePersonIds = useMemo(
    () => new Set(visibleOperationalNumbers.map((person) => person.personId)),
    [visibleOperationalNumbers]
  );
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 60 * 1000);
    return () => window.clearInterval(interval);
  }, []);
  const latestOperationalUpdate = latestDate(visibleOperationalNumbers.map((person) => person.latestReportedAt));
  const visiblePersonnelTeams = scopedTeams(personnelTeams, visiblePersonIds);
  const visibleMergedGroups = mergedNumberGroups(visibleOperationalNumbers);
  const sitesById = useMemo(() => new Map(sites.map((site) => [site.siteId, site])), [sites]);
  const anchorRows = statusDashboardRows(incidentId, visibleOperationalNumbers, sitesById);
  const clockParts = activityClockParts(now, openedAt);
  const kpis: CommandKpi[] = [
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
      id: "activity-clock",
      label: "\u05E9\u05E2\u05D5\u05DF \u05E4\u05E2\u05D9\u05DC\u05D5\u05EA",
      value: clockParts.missingStart ? "\u05DC\u05D0 \u05D4\u05D5\u05D2\u05D3\u05E8\u05D4 \u05E9\u05E2\u05EA \u05D4\u05EA\u05D7\u05DC\u05D4" : "",
      detail: "\u05D6\u05DE\u05DF \u05DE\u05EA\u05D7\u05D9\u05DC\u05EA \u05D4\u05E4\u05E2\u05D9\u05DC\u05D5\u05EA",
      tone: "clock",
      clockParts
    }
  ];
  const commandKpis: CommandKpi[] = [
    ...kpis,
    {
      id: "merged",
      label: "\u05de\u05e1\u05e4\u05e8\u05d9\u05dd \u05de\u05d0\u05d5\u05d7\u05d3\u05d9\u05dd",
      value: formatNumber(visibleMergedGroups.length),
      detail: "\u05e7\u05d1\u05d5\u05e6\u05d5\u05ea \u05de\u05d9\u05d6\u05d5\u05d2 \u05e4\u05e2\u05d9\u05dc\u05d5\u05ea",
      tone: visibleMergedGroups.length > 0 ? "warning" : "default",
      clickable: true
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
        {commandKpis.map((item) => (
          <button
            className={`command-kpi-card tone-${item.tone ?? "default"} ${openKpi === item.id ? "active" : ""}`}
            key={item.id}
            type="button"
            disabled={!item.clickable}
            onClick={() => item.clickable && setOpenKpi(openKpi === item.id ? null : item.id)}
          >
            <span>{item.label}</span>
            {item.clockParts ? (
              <div className="activity-clock-content">
                {item.clockParts.missingStart ? (
                  <strong className="activity-clock-missing">{item.value}</strong>
                ) : (
                  <div className="activity-clock-values" aria-label={"\u05D6\u05DE\u05DF \u05E9\u05D7\u05DC\u05E3"}>
                    <div className="activity-clock-unit">
                      <strong>{formatNumber(item.clockParts.days)}</strong>
                      <span>{"\u05D9\u05DE\u05D9\u05DD"}</span>
                    </div>
                    <span className="activity-clock-colon" aria-hidden="true">:</span>
                    <div className="activity-clock-unit">
                      <strong>{formatNumber(item.clockParts.hours)}</strong>
                      <span>{"\u05E9\u05E2\u05D5\u05EA"}</span>
                    </div>
                    <span className="activity-clock-colon" aria-hidden="true">:</span>
                    <div className="activity-clock-unit">
                      <strong>{formatNumber(item.clockParts.minutes)}</strong>
                      <span>{"\u05D3\u05E7\u05D5\u05EA"}</span>
                    </div>
                  </div>
                )}
                <div className="activity-clock-times">
                  <span><b>{"\u05D4\u05EA\u05D7\u05DC\u05D4"}</b>{item.clockParts.startLabel}</span>
                  <span><b>{"\u05DB\u05E2\u05EA"}</b>{item.clockParts.currentLabel}</span>
                </div>
              </div>
            ) : (
              <>
                <strong>{item.value}</strong>
                <small>{item.detail}</small>
                {item.detailLines?.length ? (
                  <small className="command-kpi-detail-lines">
                    {item.detailLines.map((line) => (
                      <span key={line}>{line}</span>
                    ))}
                  </small>
                ) : null}
              </>
            )}
          </button>
        ))}
      </section>

      {openKpi === "merged" ? (
        <section className="panel section-spaced merged-kpi-panel">
          <div className="command-section-heading compact-heading">
            <h2>מספרים מאוחדים</h2>
            <button className="button compact secondary" type="button" onClick={() => setOpenKpi(null)}>
              סגור
            </button>
          </div>
          {visibleMergedGroups.length === 0 ? (
            <p className="muted">אין מספרים מאוחדים בתחום הנבחר.</p>
          ) : (
            <div className="merged-pair-list">
              {visibleMergedGroups.map((person) => (
                <article className="merged-pair-row" key={person.personId}>
                  <strong>
                    #{formatNumber(person.operationalNumber)} ←{" "}
                    {person.mergedOperationalNumbers?.map((number) => `#${formatNumber(number)}`).join(", ")}
                  </strong>
                  <span>{operationalPersonName(person) ?? "שם לא ידוע"}</span>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : null}

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
        {anchorOpen ? (
          <CommandStatusDashboard
            statuses={STATUS_GROUPS}
            rows={anchorRows}
            initialStatusId={STATUS_GROUPS[0].id}
            loadTimeline={(personId) => loadOperationalPersonCommandTimeline(incidentId, personId)}
          />
        ) : null}
      </section>

      <DashboardSiteCommandSummary sites={visibleSites} />

      <section className="panel section-spaced">
        <PersonnelTeamCommandWidget teams={visiblePersonnelTeams} />
      </section>
    </>
  );
}
