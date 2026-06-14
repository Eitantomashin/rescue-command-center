import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatNumber } from "@/lib/format";

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
  unassigned_operational_numbers_count?: number;
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
  metadata: Record<string, unknown>;
};

const RESOLVED_STATUS_GROUPS = new Set(["rescued", "evacuated", "located_outside_site", "deceased"]);

function pct(value: number, total: number) {
  if (total <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round((value / total) * 100)));
}

function coverageLevel(updatedPotential: number, activeOperationalNumbers: number) {
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

function coverageLabel(level: string) {
  if (level === "high") {
    return "פער גבוה";
  }

  if (level === "medium") {
    return "פער בינוני";
  }

  return "פער נמוך";
}

function siteDisplayName(site: SiteSummaryRow) {
  return site.name?.trim() || `אתר ${site.site_number}`;
}

function siteAddress(site: SiteSummaryRow) {
  return [site.street, site.house_number, site.city].filter(Boolean).join(" ");
}

function teamName(teamNumber: number, name?: string | null) {
  if (teamNumber === 9) {
    return name?.trim() || "צוות אוכלוסייה";
  }

  return name?.trim() || `צוות ${teamNumber}`;
}

function importanceLabel(importance: string) {
  if (importance === "critical") {
    return "קריטי";
  }

  if (importance === "important") {
    return "חשוב";
  }

  return "רגיל";
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
    { data: importantLogRows }
  ] = await Promise.all([
    supabase
      .from("site_dashboard_summary")
      .select("*")
      .eq("incident_id", params.incidentId)
      .order("site_number", { ascending: true }),
    supabase
      .from("operational_numbers_dashboard")
      .select("person_id,site_id,operational_number,team_number,dashboard_status_group,is_merged")
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
      .select("id,site_id,person_id,log_type,title,description,importance,reported_at,metadata")
      .eq("incident_id", params.incidentId)
      .in("importance", ["important", "critical"])
      .order("reported_at", { ascending: false })
      .limit(10)
  ]);

  const sites = (siteRows ?? []) as SiteSummaryRow[];
  const operationalNumbers = ((operationalRows ?? []) as OperationalNumberRow[]).filter((person) => !person.is_merged);
  const teams = (teamRows ?? []) as TeamRow[];
  const assignments = (assignmentRows ?? []) as TeamAssignmentRow[];
  const importantLogs = (importantLogRows ?? []) as EventLogRow[];
  const siteWizardHref = `/incidents/${summary.incident_id}/sites/new`;
  const activeOperationalNumbers =
    summary.active_operational_numbers_count ?? summary.gap_resolved_count ?? operationalNumbers.length;
  const coveragePercent = pct(activeOperationalNumbers, summary.updated_potential);
  const incidentCoverageLevel = coverageLevel(summary.updated_potential, activeOperationalNumbers);
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

  const statusTiles = [
    {
      label: "נעדר / לא ידוע",
      value: summary.operational_numbers_missing_unknown_count ?? 0,
      tone: "blue"
    },
    {
      label: "לכוד אותר וטרם חולץ",
      value: summary.operational_numbers_trapped_located_count ?? 0,
      tone: "orange"
    },
    {
      label: "מחולצים",
      value: summary.operational_numbers_rescued_count ?? 0,
      tone: "green"
    },
    {
      label: "פונו",
      value: summary.operational_numbers_evacuated_count ?? 0,
      tone: "green"
    },
    {
      label: "אותרו מחוץ לאתר",
      value: summary.operational_numbers_located_outside_site_count ?? 0,
      tone: "green"
    },
    {
      label: "נפטרים",
      value: summary.operational_numbers_deceased_count ?? 0,
      tone: "red"
    }
  ];

  return (
    <main className="page commander-dashboard-page">
      <div className="command-hero">
        <div>
          <p className="eyebrow">תמונת מצב פיקודית</p>
          <h1>{summary.name}</h1>
          <p>
            {[summary.city, summary.address].filter(Boolean).join(" · ") || "ללא מיקום ראשי"} · נפתח{" "}
            {formatDateTime(summary.opened_at)}
          </p>
          <div className="command-hero-badges">
            <span className="command-badge">{summary.incident_status_label ?? (summary.is_closed ? "סגור" : "פעיל")}</span>
            <span className={`command-badge coverage-${incidentCoverageLevel}`}>{coverageLabel(incidentCoverageLevel)}</span>
            <span className="command-badge">{formatNumber(summary.total_sites)} אתרים</span>
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

      <section className="kpi-grid" aria-label="מדדי פיקוד">
        <article className="kpi-card">
          <span>פוטנציאל ראשוני</span>
          <strong>{formatNumber(summary.initial_potential)}</strong>
        </article>
        <article className="kpi-card">
          <span>פוטנציאל מעודכן</span>
          <strong>{formatNumber(summary.updated_potential)}</strong>
        </article>
        <article className="kpi-card">
          <span>מספרים מבצעיים פעילים</span>
          <strong>{formatNumber(activeOperationalNumbers)}</strong>
          <small>{coveragePercent}% כיסוי מבצעי</small>
        </article>
        <article className={`kpi-card kpi-gap coverage-${incidentCoverageLevel}`}>
          <span>פער מבצעי</span>
          <strong>{formatNumber(summary.operational_gap)}</strong>
          <small>{coverageLabel(incidentCoverageLevel)}</small>
        </article>
      </section>

      <section className="panel command-coverage-panel section-spaced">
        <div className="command-section-heading">
          <div>
            <h2>כיסוי מבצעי</h2>
            <p className="muted">מספרים מבצעיים פעילים מתוך הפוטנציאל המעודכן</p>
          </div>
          <strong>{coveragePercent}%</strong>
        </div>
        <div className={`command-progress coverage-${incidentCoverageLevel}`}>
          <span style={{ width: `${coveragePercent}%` }} />
        </div>
      </section>

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

      <section className="panel section-spaced">
        <div className="command-section-heading">
          <div>
            <h2>מצב מספרים מבצעיים</h2>
            <p className="muted">פירוק לפי הסטטוס המבצעי העדכני</p>
          </div>
        </div>
        <div className="status-overview-grid">
          {statusTiles.map((tile) => (
            <article className={`status-tile tone-${tile.tone}`} key={tile.label}>
              <span>{tile.label}</span>
              <strong>{formatNumber(tile.value)}</strong>
            </article>
          ))}
        </div>
      </section>

      <section className="panel section-spaced">
        <div className="command-section-heading">
          <div>
            <h2>אתרים</h2>
            <p className="muted">פער, כיסוי וצוותים לכל אתר</p>
          </div>
          <Link className="button secondary" href={`/incidents/${summary.incident_id}/sites`}>
            כל האתרים
          </Link>
        </div>

        {sites.length === 0 ? (
          <p className="muted">לא נמצאו אתרים לאירוע זה.</p>
        ) : (
          <div className="site-command-grid">
            {sites.map((site) => {
              const activeForSite = site.active_operational_numbers_count ?? site.gap_resolved_count ?? 0;
              const siteCoverage = pct(activeForSite, site.updated_potential);
              const level = coverageLevel(site.updated_potential, activeForSite);
              const assignedTeams = (assignedTeamIdsBySite.get(site.site_id) ?? [])
                .map((teamId) => teamsById.get(teamId))
                .filter(Boolean) as TeamRow[];
              const hasRescueTeam = assignedTeams.some((team) => team.team_number !== 9);
              const completed = site.updated_potential > 0 && site.operational_gap === 0;

              return (
                <article className={`site-command-card coverage-${level}`} key={site.site_id}>
                  <div className="site-command-card-header">
                    <div>
                      <h3>{siteDisplayName(site)}</h3>
                      <p className="muted">{siteAddress(site)}</p>
                    </div>
                    <span className={`command-badge coverage-${completed ? "low" : level}`}>
                      {completed ? "הושלם" : coverageLabel(level)}
                    </span>
                  </div>

                  <div className="site-command-metrics">
                    <div>
                      <span>פוטנציאל</span>
                      <strong>{formatNumber(site.updated_potential)}</strong>
                    </div>
                    <div>
                      <span>מספרים פעילים</span>
                      <strong>{formatNumber(activeForSite)}</strong>
                    </div>
                    <div>
                      <span>פער</span>
                      <strong>{formatNumber(site.operational_gap)}</strong>
                    </div>
                  </div>

                  <div className={`command-progress coverage-${level}`}>
                    <span style={{ width: `${siteCoverage}%` }} />
                  </div>
                  <p className="muted">{siteCoverage}% כיסוי · {formatNumber(site.open_units)} יחידות פתוחות</p>

                  <div className="site-alerts">
                    {!hasRescueTeam ? <span className="alert-chip danger">ללא צוות חילוץ משויך</span> : null}
                    {site.operational_gap > 0 ? <span className="alert-chip warning">פער פעיל</span> : null}
                    {completed ? <span className="alert-chip success">ללא פער</span> : null}
                  </div>

                  <div className="assigned-team-list">
                    {assignedTeams.length === 0 ? (
                      <span className="muted">אין צוותים משויכים</span>
                    ) : (
                      assignedTeams.map((team) => <span key={team.id}>{teamName(team.team_number, team.name)}</span>)
                    )}
                  </div>

                  <div className="site-command-actions">
                    <Link className="button secondary" href={`/incidents/${summary.incident_id}/sites/${site.site_id}`}>
                      תמונת מבנה
                    </Link>
                    <Link className="button secondary" href={`/incidents/${summary.incident_id}/sites/${site.site_id}/operational-numbers`}>
                      מספרים מבצעיים
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        )}
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
    </main>
  );
}
