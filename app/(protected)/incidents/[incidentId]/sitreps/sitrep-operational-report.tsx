import { formatDateTime, formatNumber } from "@/lib/format";
import { STATUS_GROUP_LABELS, type NumericDelta, type SitrepDelta } from "./sitrep-delta";
import { numberValue, textValue, type SituationReportRow } from "./sitrep-types";

const INCIDENT_TYPES: Record<string, string> = {
  missile_strike: "פגיעת טיל", structure_collapse: "קריסת מבנה", earthquake: "רעידת אדמה", fire: "שריפה",
  hazmat: "אירוע חומרים מסוכנים", flood: "הצפה", height_rescue: "חילוץ מגובה", elevator_rescue: "חילוץ ממעלית", other: "אחר"
};

function DeltaIndicator({ delta, inverse = false }: { delta: NumericDelta; inverse?: boolean }) {
  const direction = delta.difference > 0 ? "up" : delta.difference < 0 ? "down" : "same";
  const symbol = delta.difference > 0 ? "↑" : delta.difference < 0 ? "↓" : "→";
  return <span className={`sitrep-delta delta-${direction}${inverse ? " delta-inverse" : ""}`} dir="ltr">{symbol} {delta.difference > 0 ? "+" : ""}{delta.difference}</span>;
}

function siteName(site: Record<string, unknown>) { return textValue(site.name, `אתר ${numberValue(site.site_number)}`); }
function personName(person: Record<string, unknown>) {
  const direct = [person.first_name, person.last_name].map((value) => textValue(value, "")).filter(Boolean).join(" ");
  const resident = [person.resident_first_name, person.resident_last_name].map((value) => textValue(value, "")).filter(Boolean).join(" ");
  return direct || resident || "שם לא ידוע";
}
function teamLabel(team: Record<string, unknown>) {
  const number = numberValue(team.team_number);
  return textValue(team.name, number === 9 ? "צוות אוכלוסייה" : `צוות ${number}`);
}
function ValueWithDelta({ delta, showDelta, inverse = false }: { delta: NumericDelta; showDelta: boolean; inverse?: boolean }) {
  return <strong>{showDelta ? <span className="sitrep-value-transition" dir="ltr"><bdi>{formatNumber(delta.before)}</bdi> → <bdi>{formatNumber(delta.after)}</bdi></span> : formatNumber(delta.after)} {showDelta ? <DeltaIndicator delta={delta} inverse={inverse} /> : null}</strong>;
}

export function SitrepOperationalReport({ report, delta, canEditMeeting = false }: { report: SituationReportRow; delta: SitrepDelta; canEditMeeting?: boolean }) {
  const { snapshot } = report;
  const siteDeltas = new Map(delta.sites.map((site) => [site.siteId, site]));
  const teamDeltas = new Map(delta.teams.map((team) => [team.teamNumber, team]));

  return <article className="sitrep-document" dir="rtl">
    <header className="sitrep-document-header">
      <div><p className="eyebrow">דוח פיקודי</p><h1>חיתוך מצב #{report.report_number}</h1><h2>{snapshot.incident.name}</h2></div>
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
        <div><span>אתרים פעילים</span><ValueWithDelta delta={delta.incident.sites} showDelta={delta.hasPrevious} /></div>
        <div><span>צוותים פעילים</span><ValueWithDelta delta={delta.incident.activeTeams} showDelta={delta.hasPrevious} /></div>
        <div><span>מספרים מבצעיים</span><ValueWithDelta delta={delta.incident.operationalNumbers} showDelta={delta.hasPrevious} /></div>
        <div><span>פוטנציאל מעודכן</span><ValueWithDelta delta={delta.incident.updatedPotential} showDelta={delta.hasPrevious} /></div>
        <div><span>כוח אדם</span><ValueWithDelta delta={delta.incident.personnel} showDelta={delta.hasPrevious} /></div>
        <div className="critical"><span>פער מבצעי</span><ValueWithDelta delta={delta.incident.operationalGap} showDelta={delta.hasPrevious} inverse /></div>
      </div>
      <div className="sitrep-anchor-grid">{delta.anchor.map((row) => <div key={row.group}><span>{row.label}</span><ValueWithDelta delta={row.value} showDelta={delta.hasPrevious} /></div>)}</div>
    </section>

    <section className="sitrep-section sitrep-alerts-section">
      <h2>נקודות לתשומת לב המפקד</h2>
      {delta.alerts.length ? <ul>{delta.alerts.map((alert) => <li key={alert}><span aria-hidden="true">!</span>{alert}</li>)}</ul> : <p className="muted">לא זוהו התראות פיקודיות אוטומטיות.</p>}
    </section>

    <section className="sitrep-section"><h2>סיכום אתרים</h2><div className="sitrep-site-list">
      {snapshot.sites.map((site) => {
        const siteId = textValue(site.site_id, "");
        const siteDelta = siteDeltas.get(siteId);
        const siteTeams = snapshot.teams.filter((team) => {
          const assignments = Array.isArray(team.assignments) ? team.assignments as Array<Record<string, unknown>> : [];
          return assignments.some((assignment) => textValue(assignment.site_id, "") === siteId && assignment.assignment_status === "active");
        });
        const siteNumbers = snapshot.operational_numbers.filter((person) => textValue(person.site_id, "") === siteId);
        return <article className="sitrep-site-card" key={siteId || siteName(site)}>
          <h3>{siteName(site)}</h3><p>{[site.street, site.house_number, site.city].map((value) => textValue(value, "")).filter(Boolean).join(" ") || "ללא כתובת"}</p>
          <dl className="sitrep-site-metrics">
            <div><dt>פוטנציאל מעודכן</dt><dd>{siteDelta ? <ValueWithDelta delta={siteDelta.updatedPotential} showDelta={delta.hasPrevious} /> : formatNumber(numberValue(site.updated_potential))}</dd></div>
            <div><dt>מספרים מבצעיים</dt><dd>{siteDelta ? <ValueWithDelta delta={siteDelta.operationalNumbers} showDelta={delta.hasPrevious} /> : formatNumber(numberValue(site.active_operational_numbers_count))}</dd></div>
            <div><dt>פער</dt><dd>{siteDelta ? <ValueWithDelta delta={siteDelta.gap} showDelta={delta.hasPrevious} inverse /> : formatNumber(numberValue(site.operational_gap))}</dd></div>
          </dl>
          <p><strong>צוותים:</strong> {siteTeams.map(teamLabel).join(", ") || "ללא צוות משויך"}</p>
          <div className="sitrep-mini-statuses">{Array.from(siteNumbers.reduce<Map<string, number>>((map, person) => {
            const group = textValue(person.dashboard_status_group, "other"); map.set(group, (map.get(group) ?? 0) + 1); return map;
          }, new Map())).map(([group, count]) => <span key={group}>{STATUS_GROUP_LABELS[group] ?? group}: {count}</span>)}</div>
        </article>;
      })}
    </div></section>

    <section className="sitrep-section"><h2>פעילות צוותים</h2><div className="table-wrap"><table className="table sitrep-table">
      <thead><tr><th>צוות</th><th>אתרים</th><th>מספרים מבצעיים</th><th>סה״כ</th></tr></thead>
      <tbody>{snapshot.teams.map((team) => {
        const teamNumber = numberValue(team.team_number);
        const assignments = Array.isArray(team.assignments) ? team.assignments as Array<Record<string, unknown>> : [];
        const siteIds = assignments.filter((row) => row.assignment_status === "active").map((row) => textValue(row.site_id, ""));
        const teamNumbers = snapshot.operational_numbers.filter((person) => numberValue(person.team_number) === teamNumber);
        const teamDelta = teamDeltas.get(teamNumber);
        return <tr key={textValue(team.id, String(teamNumber))}><td>{teamLabel(team)}</td><td>{snapshot.sites.filter((site) => siteIds.includes(textValue(site.site_id, ""))).map(siteName).join(", ") || "-"}</td><td>{teamNumbers.map((person) => `#${numberValue(person.operational_number)}`).join(", ") || "-"}</td><td>{teamDelta ? <ValueWithDelta delta={teamDelta.operationalNumbers} showDelta={delta.hasPrevious} /> : teamNumbers.length}</td></tr>;
      })}</tbody>
    </table></div></section>

    <section className="sitrep-section"><h2>מספרים מבצעיים</h2><div className="table-wrap"><table className="table sitrep-table">
      <thead><tr><th>מספר</th><th>שם</th><th>סטטוס</th><th>צוות</th><th>אתר</th><th>הערות</th></tr></thead>
      <tbody>{snapshot.operational_numbers.map((person) => <tr key={textValue(person.person_id, String(person.operational_number))}><td><strong>#{numberValue(person.operational_number)}</strong></td><td>{personName(person)}</td><td>{textValue(person.latest_report_status_label, textValue(person.current_status_label, "לא ידוע"))}</td><td>{numberValue(person.team_number)}</td><td>{textValue(person.site_name, "ללא אתר")}</td><td>{textValue(person.latest_notes)}</td></tr>)}</tbody>
    </table></div></section>

    <section className="sitrep-section sitrep-delta-intelligence"><h2>שינויים מאז חיתוך מצב קודם</h2>
      {!delta.hasPrevious ? <p className="muted">זהו חיתוך המצב הראשון.</p> : <div className="sitrep-delta-sections">
        <section><h3>שינויי סטטוס מבצעי</h3>{delta.statusChanges.length ? delta.statusChanges.map((change) => <article className="sitrep-change-card" key={change.key}><strong>#{change.operationalNumber} - {change.name}</strong><p className="sitrep-transition" dir="ltr"><bdi>{change.previousStatus}</bdi><b>→</b><bdi>{change.currentStatus}</bdi></p><small>אתר: {change.site} · צוות: {change.team}</small></article>) : <p className="muted">לא נרשמו שינויי סטטוס.</p>}</section>
        <section><h3>מספרים מבצעיים שנוספו</h3>{delta.addedNumbers.length ? <ul>{delta.addedNumbers.map((person) => <li key={person.key}>#{person.operationalNumber} - {person.name} · {person.detail}</li>)}</ul> : <p className="muted">לא נוספו מספרים.</p>}</section>
        <section><h3>מספרים מבצעיים שהוסרו</h3>{delta.removedNumbers.length ? <ul>{delta.removedNumbers.map((person) => <li key={person.key}>#{person.operationalNumber} - {person.name} · {person.detail}</li>)}</ul> : <p className="muted">לא הוסרו מספרים.</p>}</section>
        <section><h3>שינויי צוות</h3>{delta.teamMoves.length ? <ul>{delta.teamMoves.map((move) => <li key={move.key}>#{move.operationalNumber}: <span className="sitrep-transition" dir="ltr"><bdi>{move.previousTeam}</bdi> → <bdi>{move.currentTeam}</bdi></span></li>)}</ul> : <p className="muted">לא זוהו מעברים בין צוותים.</p>}</section>
        <section className="sitrep-gap-explanation"><h3>פער מבצעי</h3><p className="sitrep-gap-transition" dir="ltr"><bdi>{delta.incident.operationalGap.before}</bdi> → <bdi>{delta.incident.operationalGap.after}</bdi> <DeltaIndicator delta={delta.incident.operationalGap} inverse /></p><h4>גורמים מרכזיים</h4>{delta.gapContributors.length ? <ul>{delta.gapContributors.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="muted">לא זוהה גורם מספרי מרכזי לשינוי.</p>}</section>
        <section><h3>שינויים בכוח אדם</h3>{delta.personnelChanges.length ? delta.personnelChanges.map((change) => <article className="sitrep-change-card" key={change.department}><strong>{change.department}: <span className="sitrep-transition" dir="ltr"><bdi>{change.count.before}</bdi> → <bdi>{change.count.after}</bdi></span> <DeltaIndicator delta={change.count} /></strong>{change.joined.length ? <p>נוספו: {change.joined.join(", ")}</p> : null}{change.left.length ? <p>יצאו: {change.left.join(", ")}</p> : null}</article>) : <p className="muted">לא זוהו שינויים בכוח האדם.</p>}</section>
      </div>}
    </section>

    <section className={`sitrep-section sitrep-meeting-summary${canEditMeeting ? " print-only-meeting" : ""}`}>
      <h2>השלמת ישיבת חיתוך מצב</h2>
      <div className="sitrep-meeting-summary-grid">
        <div><h3>החלטות מפקד</h3><p>{report.commander_decisions || "טרם הושלמו החלטות המפקד."}</p></div>
        <div><h3>סיכום חיתוך מצב</h3><p>{report.meeting_summary || "טרם הושלם סיכום הישיבה."}</p></div>
      </div>
    </section>
  </article>;
}
