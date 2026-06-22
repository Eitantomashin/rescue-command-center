import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatNumber } from "@/lib/format";
import { TimelinePrintButton } from "./print-button";

type TimelineSearchParams = {
  category?: string; siteId?: string; userId?: string; q?: string; eventId?: string; from?: string; to?: string;
};

type TimelineRow = {
  id: string; incident_id: string; site_id: string | null; person_id: string | null; team_id: string | null;
  log_type: string; category: string; reported_at: string; title: string; description: string | null;
  importance: string; metadata: Record<string, unknown>; created_by: string | null; actor_display_name: string;
  site_name: string | null; operational_number: number | null; person_name: string | null;
  entity_type: string | null; entity_id: string | null; before_state: Record<string, unknown> | null; after_state: Record<string, unknown> | null;
};

const CATEGORY_OPTIONS = [
  ["all", "כל הפעילות"], ["operational_numbers", "מספרים מבצעיים"], ["personnel", "כוח אדם"],
  ["sites", "אתרים"], ["incident_admin", "ניהול אירוע"], ["sitreps", "חיתוכי מצב"], ["user_admin", "ניהול משתמשים"]
] as const;

const OPERATIONAL_LOG_TYPES = new Set([
  "operational_number_created", "operational_report_created", "person_status_changed", "operational_person_name_updated",
  "operational_numbers_merged", "person_linked_to_resident", "person_linked_to_unit"
]);
const PERSONNEL_LOG_TYPES = new Set(["event_personnel_added", "event_personnel_updated", "personnel_added", "personnel_updated", "personnel_removed", "personnel_team_changed"]);
const SITE_LOG_TYPES = new Set(["site_created", "site_updated", "site_grid_image_updated", "site_map_object_created", "site_map_object_updated", "site_map_object_deleted"]);
const INCIDENT_LOG_TYPES = new Set(["incident_created", "incident_updated", "incident_archived", "incident_restored"]);
const SITREP_LOG_TYPES = new Set(["situation_report_created", "situation_report_meeting_completed"]);
const USER_LOG_TYPES = new Set(["user_created", "user_role_changed", "user_password_reset"]);

const FIELD_LABELS: Record<string, string> = {
  status_id: "סטטוס", status: "סטטוס", status_label: "סטטוס", attendance_status: "נוכחות",
  team_number: "צוות", team_id: "צוות", notes: "הערות", first_name: "שם פרטי", last_name: "שם משפחה",
  site_id: "אתר", operational_number: "מספר מבצעי", role: "תפקיד", meeting_summary: "סיכום ישיבה",
  commander_decisions: "החלטות מפקד"
};

function eventCategory(logType: string) {
  if (OPERATIONAL_LOG_TYPES.has(logType) || logType.includes("operational") || logType.includes("person_status")) return "operational_numbers";
  if (PERSONNEL_LOG_TYPES.has(logType) || logType.includes("personnel")) return "personnel";
  if (SITE_LOG_TYPES.has(logType) || logType.startsWith("site_")) return "sites";
  if (INCIDENT_LOG_TYPES.has(logType) || logType.startsWith("incident_")) return "incident_admin";
  if (SITREP_LOG_TYPES.has(logType) || logType.startsWith("situation_report")) return "sitreps";
  if (USER_LOG_TYPES.has(logType) || logType.startsWith("user_")) return "user_admin";
  return "other";
}

function actionLabel(row: TimelineRow) {
  const labels: Record<string, string> = {
    operational_number_created: "יצר מספר מבצעי", operational_report_created: "עדכן מספר מבצעי",
    person_status_changed: "שינה סטטוס אדם מבצעי", site_created: "הוסיף אתר", site_updated: "עדכן אתר",
    incident_created: "פתח אירוע", incident_updated: "עדכן אירוע", incident_archived: "העביר אירוע לארכיון",
    incident_restored: "שחזר אירוע", event_personnel_added: "הוסיף כוח אדם", event_personnel_updated: "עדכן כוח אדם",
    site_map_object_created: "יצר אובייקט מפה", site_map_object_updated: "עדכן אובייקט מפה",
    site_map_object_deleted: "מחק אובייקט מפה", situation_report_created: "יצר חיתוך מצב",
    situation_report_meeting_completed: "השלים ישיבת חיתוך מצב", user_created: "יצר משתמש",
    user_role_changed: "שינה תפקיד משתמש", user_password_reset: "איפס סיסמת משתמש"
  };
  return labels[row.log_type] ?? row.title ?? row.log_type;
}

function metadataNumber(metadata: Record<string, unknown>, key: string) {
  const value = metadata?.[key];
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value);
  return null;
}

function operationalNumbers(row: TimelineRow) {
  const values = new Set<number>();
  if (row.operational_number) values.add(row.operational_number);
  ["operational_number", "primary_operational_number", "merged_operational_number", "source_operational_number", "target_operational_number"]
    .forEach((key) => { const value = metadataNumber(row.metadata, key); if (value !== null) values.add(value); });
  const explicitText = `${row.title} ${row.description ?? ""}`;
  const patterns = [/#\s*(\d+)/g, /מספר\s+מבצעי\s*[:=]?\s*#?\s*(\d+)/g, /operational\s+number\s*[:=]?\s*#?\s*(\d+)/gi];
  patterns.forEach((pattern) => {
    for (const match of explicitText.matchAll(pattern)) values.add(Number(match[1]));
  });
  return values;
}

function objectLabel(row: TimelineRow) {
  if (row.operational_number) return `#${row.operational_number}${row.person_name ? ` - ${row.person_name}` : ""}`;
  if (row.site_name) return row.site_name;
  return row.description || row.title;
}

function valueLabel(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? "כן" : "לא";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function legacyState(metadata: Record<string, unknown>, side: "old" | "new") {
  const state: Record<string, unknown> = {};
  const mappings = [
    ["status", [`${side}_status_label`, `${side}_status_key`, `${side}_status_id`]],
    ["team_number", [`${side}_team_number`, `${side}_team`]],
    ["notes", [`${side}_notes`]],
    ["first_name", [`${side}_first_name`]],
    ["last_name", [`${side}_last_name`]],
    ["role", [`${side}_role`]],
    ["attendance_status", [`${side}_attendance_status`]]
  ] as const;
  mappings.forEach(([target, keys]) => {
    const key = keys.find((candidate) => metadata[candidate] !== undefined && metadata[candidate] !== null);
    if (key) state[target] = metadata[key];
  });
  return state;
}

function changeRows(row: TimelineRow) {
  const before = row.before_state ?? legacyState(row.metadata, "old");
  const after = row.after_state ?? legacyState(row.metadata, "new");
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return Array.from(keys)
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map((key) => ({ key, label: FIELD_LABELS[key] ?? key.replaceAll("_", " "), before: valueLabel(before[key]), after: valueLabel(after[key]) }));
}

function queryString(params: TimelineSearchParams, patch: Record<string, string | null>) {
  const next = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => { if (value) next.set(key, value); });
  Object.entries(patch).forEach(([key, value]) => { if (value) next.set(key, value); else next.delete(key); });
  const query = next.toString();
  return query ? `?${query}` : "";
}

export default async function IncidentTimelinePage({ params, searchParams }: { params: { incidentId: string }; searchParams: TimelineSearchParams }) {
  const supabase = createClient();
  const [{ data: incident }, { data, error }, { data: siteRows }] = await Promise.all([
    supabase.from("incidents").select("id,name").eq("id", params.incidentId).maybeSingle(),
    supabase.rpc("get_incident_timeline", { p_incident_id: params.incidentId, p_limit: 1000 }),
    supabase.from("sites").select("id,name,site_number,street,house_number").eq("incident_id", params.incidentId).eq("is_active", true).order("site_number")
  ]);
  if (!incident || error) notFound();
  const rows = (data ?? []) as TimelineRow[];
  const category = searchParams.category ?? "all";
  const siteId = searchParams.siteId ?? "all";
  const userId = searchParams.userId ?? "all";
  const search = (searchParams.q ?? "").trim().toLowerCase();
  const numericSearch = /^\d+$/.test(search) ? Number(search) : null;
  const fromTime = searchParams.from ? new Date(searchParams.from).getTime() : null;
  const toTime = searchParams.to ? new Date(searchParams.to).getTime() : null;
  const actors = Array.from(new Map(rows.filter((row) => row.created_by).map((row) => [row.created_by as string, row.actor_display_name])).entries());

  const filtered = rows.filter((row) => {
    if (category !== "all" && eventCategory(row.log_type) !== category) return false;
    if (siteId !== "all" && row.site_id !== siteId) return false;
    if (userId !== "all" && row.created_by !== userId) return false;
    const timestamp = new Date(row.reported_at).getTime();
    if (fromTime !== null && timestamp < fromTime) return false;
    if (toTime !== null && timestamp > toTime) return false;
    if (numericSearch !== null) return operationalNumbers(row).has(numericSearch);
    if (search) return [row.title, row.description, row.actor_display_name, row.site_name, row.person_name, objectLabel(row)].filter(Boolean).join(" ").toLowerCase().includes(search);
    return true;
  });
  const selected = searchParams.eventId ? filtered.find((row) => row.id === searchParams.eventId) ?? null : null;
  const since24Hours = Date.now() - 24 * 60 * 60 * 1000;
  const last24 = rows.filter((row) => new Date(row.reported_at).getTime() >= since24Hours);
  const summary = {
    sites: last24.filter((row) => row.log_type === "site_created").length,
    statuses: last24.filter((row) => row.log_type === "person_status_changed" || row.log_type === "resident_status_changed").length,
    personnel: last24.filter((row) => eventCategory(row.log_type) === "personnel").length,
    sitreps: last24.filter((row) => row.log_type === "situation_report_created").length
  };
  const baseHref = `/incidents/${params.incidentId}/timeline`;

  return <main className="page incident-timeline-page">
    <div className="header timeline-screen-toolbar"><div><p className="eyebrow">{incident.name}</p><h1>ציר זמן מבצעי</h1><p className="muted">תיעוד כרונולוגי מלא לצורכי תחקיר, שחזור ותדריכים.</p></div><TimelinePrintButton /></div>
    <section className="timeline-summary-strip" aria-label="סיכום 24 שעות אחרונות">
      <div><span>אתרים חדשים</span><strong>{formatNumber(summary.sites)}</strong></div><div><span>שינויי סטטוס</span><strong>{formatNumber(summary.statuses)}</strong></div>
      <div><span>שינויי כוח אדם</span><strong>{formatNumber(summary.personnel)}</strong></div><div><span>חיתוכי מצב</span><strong>{formatNumber(summary.sitreps)}</strong></div>
    </section>
    <section className="panel timeline-filter-panel no-print"><form className="timeline-filters" key={JSON.stringify(searchParams)}>
      <label><span>סוג פעילות</span><select className="input" name="category" defaultValue={category}>{CATEGORY_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label><span>אתר</span><select className="input" name="siteId" defaultValue={siteId}><option value="all">כל האתרים</option>{(siteRows ?? []).map((site) => <option key={site.id} value={site.id}>{site.name || `${site.street} ${site.house_number}`}</option>)}</select></label>
      <label><span>משתמש</span><select className="input" name="userId" defaultValue={userId}><option value="all">כל המשתמשים</option>{actors.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label><span>חיפוש</span><input className="input" name="q" defaultValue={searchParams.q ?? ""} placeholder="מספר מבצעי, שם, משתמש או אתר" /></label>
      {searchParams.from ? <input type="hidden" name="from" value={searchParams.from} /> : null}{searchParams.to ? <input type="hidden" name="to" value={searchParams.to} /> : null}
      <button className="button" type="submit">סנן</button><Link className="button secondary" href={baseHref}>נקה סינון</Link>
    </form></section>
    {searchParams.from || searchParams.to ? <section className="panel timeline-range-banner"><strong>טווח פעילות מחיתוך מצב</strong><span>{searchParams.from ? formatDateTime(searchParams.from) : "תחילת האירוע"} – {searchParams.to ? formatDateTime(searchParams.to) : "כעת"}</span></section> : null}
    <section className="timeline-layout">
      <div className="panel timeline-feed"><div className="command-section-heading"><h2>פעילות מבצעית</h2><span>{formatNumber(filtered.length)} רשומות</span></div>
        {filtered.length === 0 ? <p className="muted">לא נמצאה פעילות התואמת לסינון.</p> : <ol>{filtered.map((row) => {
          const changes = changeRows(row);
          return <li className={`timeline-audit-entry importance-${row.importance}${selected?.id === row.id ? " selected" : ""}`} key={row.id}>
            <Link href={queryString(searchParams, { eventId: row.id })}><time>{formatDateTime(row.reported_at)}</time><div className="timeline-actor"><strong>{row.actor_display_name}</strong><span>{actionLabel(row)}</span></div><div className="timeline-object"><strong>{objectLabel(row)}</strong>{row.site_name ? <span>אתר: {row.site_name}</span> : null}</div>{row.description ? <p>{row.description}</p> : null}{changes.slice(0, 2).map((change) => <div className="timeline-inline-change" key={change.key}><span>{change.label}</span><bdi>{change.before}</bdi><b>→</b><bdi>{change.after}</bdi></div>)}</Link>
          </li>;
        })}</ol>}
      </div>
      <aside className="panel timeline-detail-drawer no-print">{selected ? <><div className="command-section-heading"><h2>פרטי פעולה</h2><Link className="button compact secondary" href={queryString(searchParams, { eventId: null })}>סגור</Link></div><dl>
        <div><dt>זמן</dt><dd>{formatDateTime(selected.reported_at)}</dd></div><div><dt>מבצע הפעולה</dt><dd>{selected.actor_display_name}</dd></div><div><dt>פעולה</dt><dd>{actionLabel(selected)}</dd></div><div><dt>אובייקט</dt><dd>{objectLabel(selected)}</dd></div>{selected.site_name ? <div><dt>אתר</dt><dd>{selected.site_name}</dd></div> : null}{selected.entity_id ? <div><dt>מזהה</dt><dd>{selected.entity_id}</dd></div> : null}
      </dl>{changeRows(selected).length ? <div className="timeline-change-list"><h3>לפני / אחרי</h3>{changeRows(selected).map((change) => <div key={change.key}><strong>{change.label}</strong><span><bdi>{change.before}</bdi> → <bdi>{change.after}</bdi></span></div>)}</div> : null}<details><summary>מידע טכני</summary><pre>{JSON.stringify(selected.metadata, null, 2)}</pre></details></> : <p className="muted">בחרו רשומה כדי להציג פרטים מלאים.</p>}</aside>
    </section>
  </main>;
}
