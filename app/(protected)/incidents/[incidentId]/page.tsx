import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatNumber } from "@/lib/format";
import { KpiDrilldown, type KpiDrilldownItem, type KpiDrilldownRow } from "./kpi-drilldown";
import { OperationalStatusOverview, type OperationalStatusTile } from "./operational-status-overview";

type DashboardRow = {
  incident_id: string;
  name: string;
  city: string | null;
  address: string | null;
  opened_at: string;
  ended_at: string | null;
  is_closed: boolean;
  incident_status_label: string | null;
  total_sites: number;
  initial_potential: number;
  updated_potential: number;
  operational_gap: number;
  active_operational_numbers_count?: number;
  gap_resolved_count?: number;
  active_teams: number;
  available_teams: number;
  active_team_site_assignments: number;
  operational_numbers_missing_unknown_count?: number;
  operational_numbers_trapped_located_count?: number;
  operational_numbers_rescued_count?: number;
  operational_numbers_evacuated_count?: number;
  operational_numbers_located_outside_site_count?: number;
  operational_numbers_deceased_count?: number;
  operational_numbers_other_count?: number;
  active_rescue_teams_count?: number;
};

type SiteSummaryRow = {
  site_id: string;
  site_number: number;
  name: string | null;
  city: string | null;
  street: string;
  house_number: string;
  site_status_label: string | null;
  initial_potential: number;
  updated_potential: number;
  total_active_units: number;
  open_units: number;
  operational_gap: number;
  gap_resolved_count?: number;
  active_operational_numbers_count?: number;
  active_rescue_teams_count?: number;
};

type OperationalNumberRow = {
  person_id: string;
  site_id: string | null;
  operational_number: number;
  team_number: number;
  current_status_key: string | null;
  current_status_label: string | null;
  dashboard_status_group: string | null;
  is_merged: boolean;
};

type TeamRow = {
  id: string;
  team_number: number;
  name: string | null;
  commander_name: string | null;
  personnel_count: number | null;
  is_active: boolean;
};

type TeamAssignmentRow = {
  site_id: string;
  team_id: string;
  assignment_status: string;
};

type EventLogRow = {
  id: string;
  site_id: string | null;
  person_id: string | null;
  log_type: string;
  title: string;
  description: string | null;
  importance: "normal" | "important" | "critical" | string;
  reported_at: string;
  source_type?: string | null;
  metadata: Record<string, unknown>;
};

function metadataText(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

const RESOLVED_STATUS_GROUPS = new Set(["rescued", "evacuated", "located_outside_site", "deceased"]);

function pct(value: number, total: number) {
  if (total <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round((value / total) * 100)));
}

function gapLevel(updatedPotential: number, activeOperationalNumbers: number) {
  if (updatedPotential <= 0) {
    return "low";
  }

  const gapPercent = 100 - pct(activeOperationalNumbers, updatedPotential);

  if (gapPercent >= 35) {
    return "high";
  }

  if (gapPercent >= 10) {
    return "medium";
  }

  return "low";
}

function gapLabel(level: string) {
  if (level === "high") {
    return "\u05e4\u05e2\u05e8 \u05d2\u05d1\u05d5\u05d4";
  }

  if (level === "medium") {
    return "\u05e4\u05e2\u05e8 \u05d1\u05d9\u05e0\u05d5\u05e0\u05d9";
  }

  return "\u05e4\u05e2\u05e8 \u05e0\u05de\u05d5\u05da";
}

function siteDisplayName(site: SiteSummaryRow) {
  return site.name?.trim() || `\u05d0\u05ea\u05e8 ${site.site_number}`;
}

function siteAddress(site: SiteSummaryRow) {
  return [site.street, site.house_number, site.city].filter(Boolean).join(" ");
}

function teamName(teamNumber: number, name?: string | null) {
  if (teamNumber === 9) {
    return name?.trim() || "\u05e6\u05d5\u05d5\u05ea \u05d0\u05d5\u05db\u05dc\u05d5\u05e1\u05d9\u05d9\u05d4";
  }

  return name?.trim() || `\u05e6\u05d5\u05d5\u05ea ${teamNumber}`;
}

function importanceLabel(importance: string) {
  if (importance === "critical") {
    return "\u05e7\u05e8\u05d9\u05d8\u05d9";
  }

  if (importance === "important") {
    return "\u05d7\u05e9\u05d5\u05d1";
  }

  return "\u05e8\u05d2\u05d9\u05dc";
}

function statusBreakdown(operationalNumbers: OperationalNumberRow[], group: string) {
  const counts = operationalNumbers
    .filter((person) => person.dashboard_status_group === group)
    .reduce((map, person) => {
      const label =
        person.current_status_label?.trim() ||
        person.current_status_key?.trim() ||
        "\u05dc\u05d0 \u05d9\u05d3\u05d5\u05e2";
      map.set(label, (map.get(label) ?? 0) + 1);
      return map;
    }, new Map<string, number>());

  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "he"));
}

function statusTile(
  operationalNumbers: OperationalNumberRow[],
  group: string,
  label: string,
  tone: string
): OperationalStatusTile {
  const details = statusBreakdown(operationalNumbers, group);

  return {
    group,
    label,
    tone,
    details,
    value: details.reduce((sum, row) => sum + row.count, 0)
  };
}

function siteKpiRows(
  sites: SiteSummaryRow[],
  selector: (site: SiteSummaryRow) => number,
  total: number,
  incidentId: string
): KpiDrilldownRow[] {
  const rows: KpiDrilldownRow[] = sites.map((site) => ({
    label: siteDisplayName(site),
    href: `/incidents/${incidentId}/sites/${site.site_id}`,
    value: selector(site)
  }));
  const rowTotal = rows.reduce((sum, row) => sum + row.value, 0);
  const difference = total - rowTotal;

  if (difference !== 0) {
    rows.push({
      label: "\u05dc\u05dc\u05d0 \u05d0\u05ea\u05e8 / \u05d4\u05ea\u05d0\u05de\u05d4",
      href: null,
      value: difference
    });
  }

  return rows;
}

export default async function IncidentDashboardPage({
  params,
  searchParams
}: {
  params: { incidentId: string };
  searchParams?: { created?: string };
}) {
  const supabase = createClient();
  const { data: dashboard, error } = await supabase
    .from("incident_dashboard_summary")
    .select("*")
    .eq("incident_id", params.incidentId)
    .maybeSingle();

  if (error || !dashboard) {
    notFound();
  }

  const summary = dashboard as DashboardRow;

  const [
    { data: siteRows },
    { data: operationalRows },
    { data: teamRows },
    { data: assignmentRows },
    { data: importantLogRows },
    { data: openNoteRows }
  ] = await Promise.all([
    supabase
      .from("site_dashboard_summary")
      .select("*")
      .eq("incident_id", params.incidentId)
      .order("site_number", { ascending: true }),
    supabase
      .from("operational_numbers_dashboard")
      .select("person_id,site_id,operational_number,team_number,current_status_key,current_status_label,dashboard_status_group,is_merged")
      .eq("incident_id", params.incidentId),
    supabase
      .from("teams")
      .select("id,team_number,name,commander_name,personnel_count,is_active")
      .eq("incident_id", params.incidentId)
      .eq("is_active", true)
      .order("team_number", { ascending: true }),
    supabase
      .from("team_site_assignments")
      .select("site_id,team_id,assignment_status")
      .eq("incident_id", params.incidentId)
      .eq("assignment_status", "active"),
    supabase
      .from("event_logs")
      .select("id,site_id,person_id,log_type,title,description,importance,reported_at,source_type,metadata")
      .eq("incident_id", params.incidentId)
      .in("importance", ["important", "critical"])
      .order("reported_at", { ascending: false })
      .limit(10),
    supabase
      .from("event_logs")
      .select("id,site_id,person_id,log_type,title,description,importance,reported_at,source_type,metadata")
      .eq("incident_id", params.incidentId)
      .in("log_type", ["general_operational_note", "general_operational_note_status_changed"])
      .order("reported_at", { ascending: false })
      .limit(200)
  ]);

  const sites = (siteRows ?? []) as SiteSummaryRow[];
  const operationalNumbers = ((operationalRows ?? []) as OperationalNumberRow[]).filter((person) => !person.is_merged);
  const teams = (teamRows ?? []) as TeamRow[];
  const assignments = (assignmentRows ?? []) as TeamAssignmentRow[];
  const importantLogs = (importantLogRows ?? []) as EventLogRow[];
  const noteRows = (openNoteRows ?? []) as EventLogRow[];
  const latestNoteStatusByGroup = noteRows.reduce((map, note) => {
    if (note.log_type !== "general_operational_note_status_changed") {
      return map;
    }

    const groupId = metadataText(note.metadata, "note_group_id") ?? metadataText(note.metadata, "original_note_event_log_id");
    const status = metadataText(note.metadata, "new_treatment_status");
    if (groupId && status && !map.has(groupId)) {
      map.set(groupId, status);
    }
    return map;
  }, new Map<string, string>());
  const openNotes = noteRows
    .filter((note) => note.log_type === "general_operational_note")
    .filter((note) => {
      const groupId = metadataText(note.metadata, "note_group_id") ?? note.id;
      const latestStatus = latestNoteStatusByGroup.get(groupId) ?? metadataText(note.metadata, "treatment_status") ?? "open";
      return ["open", "in_progress"].includes(latestStatus);
    })
    .filter((note, index, allNotes) => {
      const noteGroupId = metadataText(note.metadata, "note_group_id");
      return !noteGroupId || allNotes.findIndex((candidate) => metadataText(candidate.metadata, "note_group_id") === noteGroupId) === index;
    })
    .slice(0, 10);
  const siteWizardHref = `/incidents/${summary.incident_id}/sites/new`;
  const activeOperationalNumbers =
    summary.active_operational_numbers_count ?? summary.gap_resolved_count ?? operationalNumbers.length;
  const incidentGapLevel = gapLevel(summary.updated_potential, activeOperationalNumbers);
  const assignedTeamIdsBySite = assignments.reduce((map, assignment) => {
    const next = map.get(assignment.site_id) ?? [];
    next.push(assignment.team_id);
    map.set(assignment.site_id, next);
    return map;
  }, new Map<string, string[]>());
  const teamsById = new Map(teams.map((team) => [team.id, team]));
  const operationalByTeam = operationalNumbers.reduce((map, person) => {
    const current = map.get(person.team_number) ?? { open: 0, resolved: 0, total: 0 };
    current.total += 1;
    if (RESOLVED_STATUS_GROUPS.has(person.dashboard_status_group ?? "")) {
      current.resolved += 1;
    } else {
      current.open += 1;
    }
    map.set(person.team_number, current);
    return map;
  }, new Map<number, { open: number; resolved: number; total: number }>());
  const rescueTeams = teams.filter((team) => team.team_number !== 9);
  const populationTeam = teams.find((team) => team.team_number === 9);

  const kpiItems: KpiDrilldownItem[] = [
    {
      id: "initial-potential",
      label: "\u05e4\u05d5\u05d8\u05e0\u05e6\u05d9\u05d0\u05dc \u05e8\u05d0\u05e9\u05d5\u05e0\u05d9",
      value: summary.initial_potential,
      detailLabel: "\u05e4\u05d5\u05d8\u05e0\u05e6\u05d9\u05d0\u05dc \u05e8\u05d0\u05e9\u05d5\u05e0\u05d9",
      rows: siteKpiRows(sites, (site) => site.initial_potential, summary.initial_potential, summary.incident_id)
    },
    {
      id: "updated-potential",
      label: "\u05e4\u05d5\u05d8\u05e0\u05e6\u05d9\u05d0\u05dc \u05de\u05e2\u05d5\u05d3\u05db\u05df",
      value: summary.updated_potential,
      detailLabel: "\u05e4\u05d5\u05d8\u05e0\u05e6\u05d9\u05d0\u05dc \u05de\u05e2\u05d5\u05d3\u05db\u05df",
      rows: siteKpiRows(sites, (site) => site.updated_potential, summary.updated_potential, summary.incident_id)
    },
    {
      id: "active-operational-numbers",
      label: "\u05de\u05e1\u05e4\u05e8\u05d9\u05dd \u05de\u05d1\u05e6\u05e2\u05d9\u05d9\u05dd \u05e4\u05e2\u05d9\u05dc\u05d9\u05dd",
      value: activeOperationalNumbers,
      detailLabel: "\u05de\u05e1\u05e4\u05e8\u05d9\u05dd \u05e4\u05e2\u05d9\u05dc\u05d9\u05dd",
      rows: siteKpiRows(
        sites,
        (site) => site.active_operational_numbers_count ?? site.gap_resolved_count ?? 0,
        activeOperationalNumbers,
        summary.incident_id
      )
    },
    {
      id: "operational-gap",
      label: "\u05e4\u05e2\u05e8 \u05de\u05d1\u05e6\u05e2\u05d9",
      value: summary.operational_gap,
      tone: "gap",
      detailLabel: "\u05e4\u05e2\u05e8",
      rows: siteKpiRows(sites, (site) => site.operational_gap, summary.operational_gap, summary.incident_id)
    }
  ];

  const interactiveStatusTiles = [
    statusTile(operationalNumbers, "missing_unknown", "\u05e0\u05e2\u05d3\u05e8 / \u05dc\u05d0 \u05d9\u05d3\u05d5\u05e2", "blue"),
    statusTile(
      operationalNumbers,
      "trapped_located_not_yet_rescued",
      "\u05dc\u05db\u05d5\u05d3 \u05d0\u05d5\u05ea\u05e8 \u05d5\u05d8\u05e8\u05dd \u05d7\u05d5\u05dc\u05e5",
      "orange"
    ),
    statusTile(operationalNumbers, "rescued", "\u05de\u05d7\u05d5\u05dc\u05e6\u05d9\u05dd", "green"),
    statusTile(operationalNumbers, "evacuated", "\u05e4\u05d5\u05e0\u05d5", "green"),
    statusTile(
      operationalNumbers,
      "located_outside_site",
      "\u05d0\u05d5\u05ea\u05e8\u05d5 \u05de\u05d7\u05d5\u05e5 \u05dc\u05d0\u05ea\u05e8",
      "green"
    ),
    statusTile(operationalNumbers, "deceased", "\u05e0\u05e4\u05d8\u05e8\u05d9\u05dd", "red")
  ];

  return (
    <main className="page commander-dashboard-page">
      <div className="command-hero">
        <div>
          <p className="eyebrow">{"\u05ea\u05de\u05d5\u05e0\u05ea \u05de\u05e6\u05d1 \u05e4\u05d9\u05e7\u05d5\u05d3\u05d9\u05ea"}</p>
          <h1>{summary.name}</h1>
          <p>
            {[summary.city, summary.address].filter(Boolean).join(" · ") || "\u05dc\u05dc\u05d0 \u05de\u05d9\u05e7\u05d5\u05dd \u05e8\u05d0\u05e9\u05d9"} ·{" "}
            {"\u05e0\u05e4\u05ea\u05d7"} {formatDateTime(summary.opened_at)}
          </p>
          <div className="command-hero-badges">
            <span className="command-badge">{summary.incident_status_label ?? (summary.is_closed ? "\u05e1\u05d2\u05d5\u05e8" : "\u05e4\u05e2\u05d9\u05dc")}</span>
            <span className={`command-badge coverage-${incidentGapLevel}`}>{gapLabel(incidentGapLevel)}</span>
            <span className="command-badge">{formatNumber(summary.total_sites)} {"\u05d0\u05ea\u05e8\u05d9\u05dd"}</span>
          </div>
        </div>

        <div className="actions">
          <Link className="button secondary" href="/incidents">
            חזרה לאירועים
          </Link>
          <Link className="button secondary" href="/incidents/new">
            פתיחת אירוע חדש
          </Link>
          <Link className="button secondary" href={`/incidents/${summary.incident_id}/sites`}>
            אתרים
          </Link>
          <Link className="button" href={`/incidents/${summary.incident_id}/operational-log`}>
            פתח יומן מבצעי מלא
          </Link>
        </div>
      </div>

      {searchParams?.created === "1" ? (
        <section className="panel success-panel">
          <div>
            <h2>האירוע נפתח בהצלחה</h2>
            <p className="muted">השלב המבצעי הבא הוא הקמת האתר הראשון באירוע.</p>
          </div>
          <Link className="button" href={siteWizardHref}>
            הקם אתר ראשון
          </Link>
        </section>
      ) : null}

      <KpiDrilldown items={kpiItems} />

      {summary.total_sites === 0 ? (
        <section className="panel section-spaced next-action-panel">
          <div>
            <h2>צור אתר ראשון</h2>
            <p className="muted">האתר הוא המקום שבו מגדירים מבנה, דירות, אזורים וצוותים.</p>
          </div>
          <Link className="button" href={siteWizardHref}>
            צור אתר ראשון
          </Link>
        </section>
      ) : null}

      <section className="panel section-spaced site-decision-panel">
        <div className="command-section-heading">
          <div>
            <h2>תמונת אתרים</h2>
            <p className="muted">היכן נמצא הפער המבצעי המרכזי כרגע</p>
          </div>
          <Link className="button secondary" href={`/incidents/${summary.incident_id}/sites`}>
            כל האתרים
          </Link>
        </div>

        {sites.length === 0 ? (
          <p className="muted">לא נמצאו אתרים לאירוע זה.</p>
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
                  const activeForSite = site.active_operational_numbers_count ?? site.gap_resolved_count ?? 0;
                  const level = gapLevel(site.updated_potential, activeForSite);
                  const assignedTeams = (assignedTeamIdsBySite.get(site.site_id) ?? [])
                    .map((teamId) => teamsById.get(teamId))
                    .filter(Boolean) as TeamRow[];
                  const rowLevel = site.operational_gap === 0 ? "low" : level;

                  return (
                    <tr className={`site-decision-row coverage-${rowLevel}`} key={site.site_id}>
                      <td>
                        <Link href={`/incidents/${summary.incident_id}/sites/${site.site_id}`}>
                          <strong>{siteDisplayName(site)}</strong>
                        </Link>
                        <div className="muted">{siteAddress(site)}</div>
                      </td>
                      <td>
                        <span className={`command-badge coverage-${rowLevel}`}>
                          {site.operational_gap === 0 ? "\u05dc\u05dc\u05d0 \u05e4\u05e2\u05e8" : gapLabel(rowLevel)}
                        </span>
                        <div className="muted">{site.site_status_label ?? "-"}</div>
                      </td>
                      <td>{formatNumber(site.updated_potential)}</td>
                      <td>{formatNumber(activeForSite)}</td>
                      <td>{formatNumber(site.gap_resolved_count ?? activeForSite)}</td>
                      <td className="table-emphasis">{formatNumber(site.operational_gap)}</td>
                      <td>
                        {assignedTeams.length === 0 ? (
                          <span className="alert-chip danger">ללא צוות</span>
                        ) : (
                          <div className="assigned-team-list compact">
                            {assignedTeams.map((team) => (
                              <span key={team.id}>{teamName(team.team_number, team.name)}</span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td>
                        <div className="site-decision-actions">
                          <Link className="button compact secondary" href={`/incidents/${summary.incident_id}/sites/${site.site_id}`}>
                            תמונת מבנה
                          </Link>
                          <Link className="button compact secondary" href={`/incidents/${summary.incident_id}/sites/${site.site_id}/operational-numbers`}>
                            מספרים מבצעיים
                          </Link>
                          <Link className="button compact secondary" href={`/incidents/${summary.incident_id}/sites/${site.site_id}/operational-log`}>
                            יומן מבצעי אתר
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel section-spaced">
        <div className="command-section-heading">
          <div>
            <h2>מצב מספרים מבצעיים</h2>
            <p className="muted">פירוק לפי הסטטוס המבצעי העדכני</p>
          </div>
        </div>
        <OperationalStatusOverview tiles={interactiveStatusTiles} />
      </section>

      <section className="panel section-spaced">
        <div className="command-section-heading">
          <div>
            <h2>צוותים</h2>
            <p className="muted">תיקים פתוחים וסגורים לפי צוות חילוץ</p>
          </div>
          <span className="command-badge">{formatNumber(summary.active_rescue_teams_count ?? summary.active_teams)} צוותי חילוץ פעילים</span>
        </div>

        <div className="team-overview-grid">
          {rescueTeams.map((team) => {
            const counts = operationalByTeam.get(team.team_number) ?? { open: 0, resolved: 0, total: 0 };

            return (
              <article className="team-card" key={team.id}>
                <div>
                  <h3>{teamName(team.team_number, team.name)}</h3>
                  <p className="muted">{team.commander_name || "ללא מפקד צוות"}</p>
                </div>
                <div className="team-card-counts">
                  <span>
                    פתוחים <strong>{formatNumber(counts.open)}</strong>
                  </span>
                  <span>
                    נפתרו <strong>{formatNumber(counts.resolved)}</strong>
                  </span>
                </div>
              </article>
            );
          })}

          {populationTeam ? (
            <article className="team-card population-team-card">
              <div>
                <h3>צוות אוכלוסייה</h3>
                <p className="muted">{populationTeam.commander_name || "צוות 9"}</p>
              </div>
              <div className="team-card-counts">
                <span>
                  פתוחים <strong>{formatNumber((operationalByTeam.get(9) ?? { open: 0 }).open)}</strong>
                </span>
                <span>
                  נפתרו <strong>{formatNumber((operationalByTeam.get(9) ?? { resolved: 0 }).resolved)}</strong>
                </span>
              </div>
            </article>
          ) : null}
        </div>
      </section>

      <section className="panel section-spaced">
        <div className="command-section-heading">
          <div>
            <h2>עדכונים חשובים אחרונים</h2>
            <p className="muted">10 העדכונים החשובים או הקריטיים האחרונים</p>
          </div>
          <Link className="button" href={`/incidents/${summary.incident_id}/operational-log`}>
            פתח יומן מבצעי מלא
          </Link>
        </div>

        {importantLogs.length === 0 ? (
          <p className="muted">אין עדכונים חשובים או קריטיים להצגה כרגע.</p>
        ) : (
          <ol className="dashboard-update-list">
            {importantLogs.map((log) => (
              <li className={`dashboard-update-row importance-${log.importance}`} key={log.id}>
                <time>{formatDateTime(log.reported_at)}</time>
                <div>
                  <strong>{log.title || log.log_type}</strong>
                  {log.description ? <p>{log.description}</p> : null}
                </div>
                <span>{importanceLabel(log.importance)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
      <section className="panel section-spaced open-notes-panel">
        <div className="command-section-heading">
          <div>
            <h2>📌 הערות פתוחות</h2>
            <p className="muted">הערות כלליות שעדיין פתוחות או בטיפול</p>
          </div>
          <Link className="button secondary" href={`/incidents/${summary.incident_id}/operational-log?eventType=general_notes`}>
            כל ההערות
          </Link>
        </div>

        {openNotes.length === 0 ? (
          <p className="muted">אין הערות פתוחות להצגה כרגע.</p>
        ) : (
          <div className="open-notes-list">
            {openNotes.map((note) => (
              <article className={`open-note-card importance-${note.importance}`} key={note.id}>
                <strong>{metadataText(note.metadata, "note_title") ?? note.description ?? "הערה כללית"}</strong>
                <div className="timeline-meta">
                  <span>{metadataText(note.metadata, "information_source_type") ?? note.source_type ?? "מקור לא ידוע"}</span>
                  <span>{formatDateTime(metadataText(note.metadata, "received_at") ?? note.reported_at)}</span>
                  <span>{note.importance === "critical" ? "קריטי" : note.importance === "important" ? "חשוב" : "רגיל"}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
