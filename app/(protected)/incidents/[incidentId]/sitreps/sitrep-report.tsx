import { formatDateTime, formatNumber } from "@/lib/format";
import { operationalTeamLabel } from "@/lib/operational-teams";
import { numberValue, textValue, type SituationReportRow, type SitrepSnapshot } from "./sitrep-types";

const INCIDENT_TYPES: Record<string, string> = {
  missile_strike: "פגיעת טיל",
  structure_collapse: "קריסת מבנה",
  earthquake: "רעידת אדמה",
  fire: "שריפה",
  hazmat: "אירוע חומרים מסוכנים",
  flood: "הצפה",
  height_rescue: "חילוץ מגובה",
  elevator_rescue: "חילוץ ממעלית",
  other: "אחר"
};

const STATUS_GROUP_LABELS: Record<string, string> = {
  missing_unknown: "נעדר / לא ידוע",
  trapped_located_not_yet_rescued: "לכוד אותר וטרם חולץ",
  rescued: "מחולצים",
  evacuated: "פונו",
  located_outside_site: "אותרו מחוץ לאתר",
  deceased: "נפטרים",
  other: "אחר"
};

function siteName(site: Record<string, unknown>) {
  return textValue(site.name, `אתר ${numberValue(site.site_number)}`);
}

function personName(person: Record<string, unknown>) {
  const direct = [person.first_name, person.last_name].map((value) => textValue(value, "")).filter(Boolean).join(" ");
  const resident = [person.resident_first_name, person.resident_last_name]
    .map((value) => textValue(value, ""))
    .filter(Boolean)
    .join(" ");
  return direct || resident || "שם לא ידוע";
}

function teamLabel(team: Record<string, unknown>) {
  const number = numberValue(team.team_number);
  return operationalTeamLabel(number, textValue(team.name, ""));
}

function statusCounts(snapshot: SitrepSnapshot) {
  return snapshot.operational_numbers.reduce<Map<string, number>>((counts, person) => {
    const group = textValue(person.dashboard_status_group, "other");
    counts.set(group, (counts.get(group) ?? 0) + 1);
    return counts;
  }, new Map());
}

export function compareSnapshots(current: SitrepSnapshot, previous?: SitrepSnapshot | null) {
  if (!previous) return [];

  const changes: string[] = [];
  const currentCounts = statusCounts(current);
  const previousCounts = statusCounts(previous);
  const groups = new Set([...Array.from(currentCounts.keys()), ...Array.from(previousCounts.keys())]);

  groups.forEach((group) => {
    const difference = (currentCounts.get(group) ?? 0) - (previousCounts.get(group) ?? 0);
    if (difference !== 0) {
      changes.push(`${STATUS_GROUP_LABELS[group] ?? group} ${difference > 0 ? "+" : ""}${difference}`);
    }
  });

  const previousSiteIds = new Set(previous.sites.map((site) => textValue(site.site_id, "")));
  current.sites
    .filter((site) => !previousSiteIds.has(textValue(site.site_id, "")))
    .forEach((site) => changes.push(`נוסף אתר: ${siteName(site)}`));

  const previousMapObjectIds = new Set(previous.map_objects.map((object) => textValue(object.id, "")));
  const newMapObjects = current.map_objects.filter((object) => !previousMapObjectIds.has(textValue(object.id, "")));
  if (newMapObjects.length > 0) changes.push(`נוספו גזרות/אובייקטי מפה: +${newMapObjects.length}`);

  return changes;
}

export function SitrepReport({ report, changes }: { report: SituationReportRow; changes: string[] }) {
  const { snapshot } = report;
  const summary = snapshot.summary ?? {};
  const statusRows = Array.from(statusCounts(snapshot).entries()).sort((a, b) => b[1] - a[1]);

  return (
    <article className="sitrep-document" dir="rtl">
      <header className="sitrep-document-header">
        <div>
          <p className="eyebrow">דוח פיקודי</p>
          <h1>חיתוך מצב #{report.report_number}</h1>
          <h2>{snapshot.incident.name}</h2>
        </div>
        <dl className="sitrep-header-details">
          <div><dt>סוג אירוע</dt><dd>{INCIDENT_TYPES[snapshot.incident.incident_type ?? ""] ?? snapshot.incident.incident_type ?? "-"}</dd></div>
          <div><dt>פתיחת האירוע</dt><dd>{formatDateTime(snapshot.incident.opened_at)}</dd></div>
          <div><dt>מועד החיתוך</dt><dd>{formatDateTime(report.created_at)}</dd></div>
          <div><dt>עורך הדוח</dt><dd>{snapshot.author.display_name}</dd></div>
        </dl>
      </header>

      <section className="sitrep-section">
        <h2>תמונת מצב כללית</h2>
        <div className="sitrep-kpis">
          <div><span>אתרים פעילים</span><strong>{formatNumber(numberValue(summary.total_sites))}</strong></div>
          <div><span>צוותים פעילים</span><strong>{formatNumber(numberValue(summary.active_teams))}</strong></div>
          <div><span>מספרים מבצעיים</span><strong>{formatNumber(numberValue(summary.active_operational_numbers_count))}</strong></div>
          <div className="critical"><span>פער מבצעי</span><strong>{formatNumber(numberValue(summary.operational_gap))}</strong></div>
        </div>
        <div className="sitrep-anchor-grid">
          {statusRows.map(([group, count]) => (
            <div key={group}><span>{STATUS_GROUP_LABELS[group] ?? group}</span><strong>{formatNumber(count)}</strong></div>
          ))}
        </div>
      </section>

      <section className="sitrep-section">
        <h2>סיכום אתרים</h2>
        <div className="sitrep-site-list">
          {snapshot.sites.map((site) => {
            const siteId = textValue(site.site_id, "");
            const siteTeams = snapshot.teams.filter((team) => {
              const assignments = Array.isArray(team.assignments) ? team.assignments as Array<Record<string, unknown>> : [];
              return assignments.some((assignment) => textValue(assignment.site_id, "") === siteId && assignment.assignment_status === "active");
            });
            const siteNumbers = snapshot.operational_numbers.filter((person) => textValue(person.site_id, "") === siteId);

            return (
              <article className="sitrep-site-card" key={siteId || siteName(site)}>
                <h3>{siteName(site)}</h3>
                <p>{[site.street, site.house_number, site.city].map((value) => textValue(value, "")).filter(Boolean).join(" ") || "ללא כתובת"}</p>
                <dl className="sitrep-site-metrics">
                  <div><dt>פוטנציאל מעודכן</dt><dd>{formatNumber(numberValue(site.updated_potential))}</dd></div>
                  <div><dt>מספרים מבצעיים</dt><dd>{formatNumber(numberValue(site.active_operational_numbers_count))}</dd></div>
                  <div><dt>פער</dt><dd>{formatNumber(numberValue(site.operational_gap))}</dd></div>
                </dl>
                <p><strong>צוותים:</strong> {siteTeams.map(teamLabel).join(", ") || "ללא צוות משויך"}</p>
                <div className="sitrep-mini-statuses">
                  {Array.from(siteNumbers.reduce<Map<string, number>>((map, person) => {
                    const group = textValue(person.dashboard_status_group, "other");
                    map.set(group, (map.get(group) ?? 0) + 1);
                    return map;
                  }, new Map())).map(([group, count]) => <span key={group}>{STATUS_GROUP_LABELS[group] ?? group}: {count}</span>)}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="sitrep-section">
        <h2>פעילות צוותים</h2>
        <div className="table-wrap">
          <table className="table sitrep-table">
            <thead><tr><th>צוות</th><th>אתרים</th><th>מספרים מבצעיים</th></tr></thead>
            <tbody>
              {snapshot.teams.map((team) => {
                const teamNumber = numberValue(team.team_number);
                const assignments = Array.isArray(team.assignments) ? team.assignments as Array<Record<string, unknown>> : [];
                const siteIds = assignments.filter((row) => row.assignment_status === "active").map((row) => textValue(row.site_id, ""));
                const teamNumbers = snapshot.operational_numbers.filter((person) => numberValue(person.team_number) === teamNumber);
                return (
                  <tr key={textValue(team.id, String(teamNumber))}>
                    <td>{teamLabel(team)}</td>
                    <td>{snapshot.sites.filter((site) => siteIds.includes(textValue(site.site_id, ""))).map(siteName).join(", ") || "-"}</td>
                    <td>{teamNumbers.map((person) => `#${numberValue(person.operational_number)}`).join(", ") || "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="sitrep-section">
        <h2>מספרים מבצעיים</h2>
        <div className="table-wrap">
          <table className="table sitrep-table">
            <thead><tr><th>מספר</th><th>שם</th><th>סטטוס</th><th>צוות</th><th>אתר</th><th>הערות</th></tr></thead>
            <tbody>
              {snapshot.operational_numbers.map((person) => (
                <tr key={textValue(person.person_id, String(person.operational_number))}>
                  <td><strong>#{numberValue(person.operational_number)}</strong></td>
                  <td>{personName(person)}</td>
                  <td>{textValue(person.latest_report_status_label, textValue(person.current_status_label, "לא ידוע"))}</td>
                  <td>{operationalTeamLabel(numberValue(person.team_number))}</td>
                  <td>{textValue(person.site_name, "ללא אתר")}</td>
                  <td>{textValue(person.latest_notes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="sitrep-section">
        <h2>שינויים מאז חיתוך מצב קודם</h2>
        {changes.length ? <ul>{changes.map((change) => <li key={change}>{change}</li>)}</ul> : <p className="muted">אין שינויים מזוהים או שזהו חיתוך המצב הראשון.</p>}
      </section>

      <section className="sitrep-section sitrep-text-section">
        <h2>החלטות מפקד</h2>
        <p>{report.commander_decisions || "לא הוזנו החלטות."}</p>
      </section>
      <section className="sitrep-section sitrep-text-section">
        <h2>סיכום חיתוך מצב</h2>
        <p>{report.meeting_summary || "לא הוזן סיכום."}</p>
      </section>
    </article>
  );
}
