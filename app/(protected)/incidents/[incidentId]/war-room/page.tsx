import Image from "next/image";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatNumber } from "@/lib/format";
import { operationalTeamLabel } from "@/lib/operational-teams";
import { normalizeSearchUnitStatus, searchLiveStatus, searchScannedCount, searchSummaryFromStatuses, type SearchUnitStatus } from "@/lib/search-site-status";
import { WarRoomFooterStatus, WarRoomLiveClock } from "./war-room-live-clock";
import { WarRoomPresentationToggle } from "./war-room-presentation-toggle";

type IncidentSummaryRow = { incident_id: string; name: string; opened_at: string | null; is_closed: boolean; incident_status_label: string | null; total_sites: number; initial_potential: number; updated_potential: number; operational_gap: number; active_teams: number; active_operational_numbers_count?: number | null; gap_resolved_count?: number | null };
type RescueSiteSummaryRow = { site_id: string; site_number: number; name: string | null; city: string | null; street: string | null; house_number: string | null; site_status_label: string | null; updated_potential: number; operational_gap: number; gap_resolved_count?: number | null; active_operational_numbers_count?: number | null };
type SiteMetaRow = { id: string; site_number: number; name: string | null; city: string | null; street: string | null; house_number: string | null; site_type: string | null; search_status: string | null; search_reason: string | null; search_priority: string | null; parent_site_id: string | null };
type OperationalNumberRow = { site_id: string | null; dashboard_status_group: string | null; current_status_label: string | null; latest_report_status_label: string | null; latest_reported_at: string | null };
type TeamRow = { id: string; team_number: number; name: string | null; is_active: boolean };
type AssignmentRow = { site_id: string; team_id: string; assignment_status: string | null };
type EventRow = { id: string; site_id: string | null; title: string; description: string | null; importance: string | null; reported_at: string; log_type?: string | null };
type AttendanceRow = { attendance_status: string | null };
type UnitRow = { id: string; site_id: string; floor_id: string | null; unit_number: string; zone_type: string | null; zone_name: string | null; zone_sequence: number | null };
type SearchResultRow = { unit_id: string; search_status: string | null; casualty_psych: boolean | null; casualty_body: boolean | null; medical_evacuation: boolean | null; anxiety_casualties_count: number | null; physical_casualties_count: number | null; casualties_resolved: boolean | null; has_apartment_damage: boolean | null; updated_at: string | null };

type RescueColumn = { key: string; label: string; match: (row: OperationalNumberRow) => boolean };

type RescueTableRow = RescueSiteSummaryRow & {
  latest: string | null;
  teams: string[];
  tone: string;
  counts: Record<string, number>;
};

const T = {
  title: "\u05de\u05e1\u05da \u05d7\u05de\u05f4\u05dc", subtitle: "\u05ea\u05de\u05d5\u05e0\u05ea \u05e4\u05d9\u05e7\u05d5\u05d3 \u05de\u05d1\u05e6\u05e2\u05d9\u05ea \u05dc\u05d7\u05d3\u05e8 \u05d7\u05de\u05f4\u05dc", yanshof: "\u05d9\u05e0\u05e9\u05d5\u05f4\u05e4", system: "\u05de\u05e2\u05e8\u05db\u05ea \u05e4\u05d9\u05e7\u05d5\u05d3 \u05d5\u05e9\u05dc\u05d9\u05d8\u05d4",
  status: "\u05e1\u05d8\u05d8\u05d5\u05e1", risk: "\u05e8\u05de\u05ea \u05e1\u05d9\u05db\u05d5\u05df", fieldForces: "\u05db\u05d5\u05d7\u05d5\u05ea \u05d1\u05e9\u05d8\u05d7", rescuersOnScene: "\u05de\u05d7\u05dc\u05e6\u05d9\u05dd \u05d1\u05d6\u05d9\u05e8\u05d4", activeTeams: "\u05e6\u05d5\u05d5\u05ea\u05d9\u05dd \u05e4\u05e2\u05d9\u05dc\u05d9\u05dd", teamsEnRoute: "\u05e6\u05d5\u05d5\u05ea\u05d9\u05dd \u05d1\u05d3\u05e8\u05da",
  updatedPotential: "\u05e4\u05d5\u05d8\u05e0\u05e6\u05d9\u05d0\u05dc \u05de\u05e2\u05d5\u05d3\u05db\u05df", operationalGap: "\u05e4\u05e2\u05e8 \u05de\u05d1\u05e6\u05e2\u05d9", trappedLocated: "\u05dc\u05db\u05d5\u05d3 \u05e9\u05d0\u05d5\u05ea\u05e8 \u05d5\u05d8\u05e8\u05dd \u05d7\u05d5\u05dc\u05e5", cumulativeResolved: "\u05e1\u05db\u05d5\u05dd \u05de\u05e6\u05d8\u05d1\u05e8", evacuated: "\u05e4\u05d5\u05e0\u05d5", rescued: "\u05d7\u05d5\u05dc\u05e6\u05d5", outside: "\u05d0\u05d5\u05ea\u05e8\u05d5 \u05de\u05d7\u05d5\u05e5 \u05dc\u05d0\u05ea\u05e8", deceased: "\u05e0\u05e4\u05d8\u05e8\u05d9\u05dd",
  rescueSites: "\u05d0\u05ea\u05e8\u05d9 \u05d7\u05d9\u05dc\u05d5\u05e5", searchSites: "\u05d0\u05ea\u05e8\u05d9 \u05e1\u05e8\u05d9\u05e7\u05d4", recentEvents: "\u05d0\u05d9\u05e8\u05d5\u05e2\u05d9\u05dd \u05d0\u05d7\u05e8\u05d5\u05e0\u05d9\u05dd", motto: "\u05db\u05dc \u05d3\u05e7\u05d4 \u05d7\u05e9\u05d5\u05d1\u05d4. \u05db\u05dc \u05de\u05d9\u05d3\u05e2 \u05de\u05e6\u05d9\u05dc \u05d7\u05d9\u05d9\u05dd.", noData: "\u05d0\u05d9\u05df \u05e0\u05ea\u05d5\u05e0\u05d9\u05dd",
  missing: "\u05e0\u05e2\u05d3\u05e8", evacSite: "\u05e4\u05e6\u05d5\u05e2 \u05e9\u05e4\u05d5\u05e0\u05d4 \u05de\u05d4\u05d0\u05ea\u05e8", evacNaf: "\u05e4\u05e6\u05d5\u05e2 \u05e9\u05e4\u05d5\u05e0\u05d4 \u05dc\u05e0\u05d0\u05e4\u05f4\u05dc", siteName: "\u05e9\u05dd \u05d4\u05d0\u05ea\u05e8", totalUnits: "\u05e1\u05d4\u05f4\u05db \u05d3\u05d9\u05e8\u05d5\u05ea", scannedUnits: "\u05d3\u05d9\u05e8\u05d5\u05ea \u05e9\u05e0\u05e1\u05e8\u05e7\u05d5", completedUnits: "\u05d3\u05d9\u05e8\u05d5\u05ea \u05e9\u05d6\u05d5\u05db\u05d5", noAnswer: "\u05d0\u05d9\u05df \u05de\u05e2\u05e0\u05d4", damagedUnits: "\u05d3\u05d9\u05e8\u05d5\u05ea \u05e2\u05dd \u05e0\u05d6\u05e7", anxiety: "\u05e0\u05e4\u05d2\u05e2\u05d9 \u05d7\u05e8\u05d3\u05d4", physical: "\u05e0\u05e4\u05d2\u05e2\u05d9 \u05d2\u05d5\u05e3", resolvedCasualties: "\u05e0\u05e4\u05d2\u05e2\u05d9\u05dd \u05e9\u05d8\u05d5\u05e4\u05dc\u05d5", total: "\u05e1\u05d4\u05f4\u05db",
  high: "\u05d2\u05d1\u05d5\u05d4\u05d4", medium: "\u05d1\u05d9\u05e0\u05d5\u05e0\u05d9\u05ea", low: "\u05e0\u05de\u05d5\u05db\u05d4", active: "\u05e4\u05e2\u05d9\u05dc", closed: "\u05e1\u05d2\u05d5\u05e8", noUpdate: "\u05dc\u05dc\u05d0 \u05e2\u05d3\u05db\u05d5\u05df"
};

const FIXED_RESCUE_COLUMNS: RescueColumn[] = [
  { key: "missing", label: T.missing, match: (row) => row.dashboard_status_group === "missing_unknown" || statusLabel(row).includes("\u05e0\u05e2\u05d3\u05e8") },
  { key: "trapped", label: T.trappedLocated, match: (row) => row.dashboard_status_group === "trapped_located_not_yet_rescued" || statusLabel(row).includes("\u05dc\u05db\u05d5\u05d3") },
  { key: "evac_site", label: T.evacSite, match: (row) => statusLabel(row).includes("\u05de\u05d4\u05d0\u05ea\u05e8") },
  { key: "evac_naf", label: T.evacNaf, match: (row) => statusLabel(row).includes("\u05e0\u05d0\u05e4") },
  { key: "rescued", label: T.rescued, match: (row) => row.dashboard_status_group === "rescued" || statusLabel(row).includes("\u05d7\u05d5\u05dc\u05e5") },
  { key: "outside", label: T.outside, match: (row) => row.dashboard_status_group === "located_outside_site" || statusLabel(row).includes("\u05de\u05d7\u05d5\u05e5") }
];

function numberValue(value: unknown) { const parsed = typeof value === "number" ? value : Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }
function siteName(site: { name: string | null; street?: string | null; house_number?: string | null; site_number?: number | null }) { return site.name?.trim() || [site.street, site.house_number].filter(Boolean).join(" ").trim() || (T.siteName + " " + (site.site_number ?? "")).trim(); }
function formatTime(value: string | null | undefined) { if (!value) return "-"; const date = new Date(value); if (Number.isNaN(date.getTime())) return "-"; return new Intl.DateTimeFormat("he-IL", { hour: "2-digit", minute: "2-digit" }).format(date); }
function pct(part: number, total: number) { return total > 0 ? Math.round((part / total) * 100) : 0; }
function statusLabel(row: OperationalNumberRow) { return row.latest_report_status_label?.trim() || row.current_status_label?.trim() || row.dashboard_status_group?.trim() || T.noUpdate; }
function isFixedStatus(row: OperationalNumberRow) { return FIXED_RESCUE_COLUMNS.some((column) => column.match(row)); }
function riskLevel(summary: IncidentSummaryRow) { const percent = pct(summary.operational_gap, summary.updated_potential); if (percent >= 35) return { label: T.high, tone: "danger" }; if (percent >= 10) return { label: T.medium, tone: "warning" }; return { label: T.low, tone: "good" }; }
function statusTone(gap: number, updatedPotential: number, lastUpdate: string | null) { if (!lastUpdate) return "idle"; const gapPercent = pct(gap, updatedPotential); if (gapPercent >= 35) return "danger"; if (gapPercent >= 10) return "warning"; return "good"; }
function effectiveSearchStatus(result: SearchResultRow | undefined): SearchUnitStatus { const status = normalizeSearchUnitStatus(result?.search_status); if (status === "completed") return "completed"; if (numberValue(result?.anxiety_casualties_count) > 0 || numberValue(result?.physical_casualties_count) > 0 || result?.casualty_psych || result?.casualty_body || result?.medical_evacuation) return result?.casualties_resolved ? status : "casualties"; return status; }
function eventIcon(log: EventRow) { if (log.importance === "critical") return "\u26a0"; if ((log.title + " " + (log.description ?? "")).includes("\u05e0\u05e4\u05d2\u05e2")) return "\u2315"; if ((log.title + " " + (log.description ?? "")).includes("\u05e1\u05d9\u05d9\u05dd")) return "\u2713"; return "\u25cf"; }

export default async function WarRoomPage({ params }: { params: { incidentId: string } }) {
  const supabase = createClient();
  const lastRefreshAt = new Date().toISOString();
  const [summaryRes, siteSummaryRes, siteMetaRes, opsRes, teamsRes, assignmentsRes, logsRes, attendanceRes, unitsRes, searchResultsRes] = await Promise.all([
    supabase.from("incident_dashboard_summary").select("*").eq("incident_id", params.incidentId).maybeSingle(),
    supabase.from("site_dashboard_summary").select("*").eq("incident_id", params.incidentId).order("site_number", { ascending: true }),
    supabase.from("sites").select("id,site_number,name,city,street,house_number,site_type,search_status,search_reason,search_priority,parent_site_id").eq("incident_id", params.incidentId).eq("is_active", true).order("site_number", { ascending: true }),
    supabase.from("operational_numbers_dashboard").select("site_id,dashboard_status_group,current_status_label,latest_report_status_label,latest_reported_at").eq("incident_id", params.incidentId),
    supabase.from("teams").select("id,team_number,name,is_active").eq("incident_id", params.incidentId),
    supabase.from("team_site_assignments").select("site_id,team_id,assignment_status").eq("incident_id", params.incidentId),
    supabase.from("event_logs").select("id,site_id,title,description,importance,reported_at,log_type").eq("incident_id", params.incidentId).order("reported_at", { ascending: false }).limit(25),
    supabase.from("event_personnel_status").select("attendance_status").eq("incident_id", params.incidentId),
    supabase.from("units").select("id,site_id,floor_id,unit_number,zone_type,zone_name,zone_sequence").eq("incident_id", params.incidentId).eq("is_active", true),
    supabase.from("site_search_units").select("unit_id,search_status,casualty_psych,casualty_body,medical_evacuation,anxiety_casualties_count,physical_casualties_count,casualties_resolved,has_apartment_damage,updated_at").eq("incident_id", params.incidentId)
  ]);
  if (!summaryRes.data) notFound();
  const summary = summaryRes.data as IncidentSummaryRow;
  const allOps = (opsRes.data ?? []) as OperationalNumberRow[];
  const dynamicStatusLabels = Array.from(new Set(allOps.filter((row) => !isFixedStatus(row)).map(statusLabel).filter((label) => label && label !== T.noUpdate))).sort((a, b) => a.localeCompare(b, "he"));
  const rescueColumns = [...FIXED_RESCUE_COLUMNS, ...dynamicStatusLabels.map((label) => ({ key: "dynamic:" + label, label, match: (row: OperationalNumberRow) => statusLabel(row) === label }))];
  const siteMetadata = new Map(((siteMetaRes.data ?? []) as SiteMetaRow[]).map((site) => [site.id, site]));
  const teamsById = new Map(((teamsRes.data ?? []) as TeamRow[]).map((team) => [team.id, team]));
  const teamNamesBySite = ((assignmentsRes.data ?? []) as AssignmentRow[]).reduce((map, assignment) => { const team = teamsById.get(assignment.team_id); if (!team) return map; const names = map.get(assignment.site_id) ?? []; names.push(team.name?.trim() || operationalTeamLabel(team.team_number)); map.set(assignment.site_id, names); return map; }, new Map<string, string[]>());
  const opsBySite = allOps.reduce((map, row) => { if (!row.site_id) return map; const rows = map.get(row.site_id) ?? []; rows.push(row); map.set(row.site_id, rows); return map; }, new Map<string, OperationalNumberRow[]>());
  const logs = (logsRes.data ?? []) as EventRow[];
  const latestLogBySite = logs.reduce((map, log) => { if (log.site_id && !map.has(log.site_id)) map.set(log.site_id, log.reported_at); return map; }, new Map<string, string>());
  const rescueSites: RescueTableRow[] = ((siteSummaryRes.data ?? []) as RescueSiteSummaryRow[]).filter((site) => siteMetadata.get(site.site_id)?.site_type !== "search_site").map((site) => { const siteOps = opsBySite.get(site.site_id) ?? []; const latestOp = siteOps.map((row) => row.latest_reported_at).filter(Boolean).sort().at(-1) ?? null; const latest = latestLogBySite.get(site.site_id) ?? latestOp; const counts = Object.fromEntries(rescueColumns.map((column) => [column.key, siteOps.filter(column.match).length])); return { ...site, latest, teams: teamNamesBySite.get(site.site_id) ?? [], tone: statusTone(site.operational_gap, site.updated_potential, latest), counts }; });
  const rescueTotals = Object.fromEntries(rescueColumns.map((column) => [column.key, rescueSites.reduce((sum, site) => sum + (site.counts[column.key] ?? 0), 0)]));
  const trappedCount = allOps.filter(FIXED_RESCUE_COLUMNS[1].match).length;
  const cumulativeResolved = allOps.filter((row) => ["rescued", "evacuated", "located_outside_site"].includes(row.dashboard_status_group ?? "")).length;
  const deceasedCount = allOps.filter((row) => row.dashboard_status_group === "deceased" || statusLabel(row).includes("\u05e0\u05e4\u05d8\u05e8")).length;
  const searchResultsByUnit = new Map(((searchResultsRes.data ?? []) as SearchResultRow[]).map((result) => [result.unit_id, result]));
  const unitsBySite = ((unitsRes.data ?? []) as UnitRow[]).reduce((map, unit) => { const rows = map.get(unit.site_id) ?? []; rows.push(unit); map.set(unit.site_id, rows); return map; }, new Map<string, UnitRow[]>());
  const searchSites = ((siteMetaRes.data ?? []) as SiteMetaRow[]).filter((site) => site.site_type === "search_site").map((site) => { const siteUnits = unitsBySite.get(site.id) ?? []; const entries = siteUnits.map((unit) => searchResultsByUnit.get(unit.id)); const statuses = siteUnits.map((unit) => effectiveSearchStatus(searchResultsByUnit.get(unit.id))); const summaryStatus = searchSummaryFromStatuses(statuses); const scanned = searchScannedCount(summaryStatus); const latest = entries.map((entry) => entry?.updated_at ?? null).filter(Boolean).sort().at(-1) ?? null; const damaged = entries.filter((entry) => entry?.has_apartment_damage).length; const anxiety = entries.reduce((sum, entry) => sum + numberValue(entry?.anxiety_casualties_count), 0); const physical = entries.reduce((sum, entry) => sum + numberValue(entry?.physical_casualties_count), 0); const resolved = entries.filter((entry) => (numberValue(entry?.anxiety_casualties_count) > 0 || numberValue(entry?.physical_casualties_count) > 0 || entry?.casualty_psych || entry?.casualty_body || entry?.medical_evacuation) && entry?.casualties_resolved).length; return { site, total: summaryStatus.total_units, scanned, completed: summaryStatus.completed_count, noAnswer: summaryStatus.no_answer_count, damaged, anxiety, physical, resolved, latest, status: searchLiveStatus(summaryStatus) }; });
  const searchTotals = searchSites.reduce((acc, site) => { acc.total += site.total; acc.scanned += site.scanned; acc.completed += site.completed; acc.noAnswer += site.noAnswer; acc.damaged += site.damaged; acc.anxiety += site.anxiety; acc.physical += site.physical; acc.resolved += site.resolved; return acc; }, { total: 0, scanned: 0, completed: 0, noAnswer: 0, damaged: 0, anxiety: 0, physical: 0, resolved: 0 });
  const attendance = (attendanceRes.data ?? []) as AttendanceRow[];
  const rescuersOnScene = attendance.filter((row) => row.attendance_status === "present").length;
  const teamsEnRoute = attendance.filter((row) => row.attendance_status === "en_route").length;
  const recentLogs = logs.slice(0, 5);
  const incidentRisk = riskLevel(summary);

  return <main className="war-room-screen" dir="rtl">
    <WarRoomPresentationToggle />
    <header className="war-room-header"><div className="war-room-brand-block war-room-rescue-brand"><Image src="/brand/rescue-unit-logo.png" alt="" width={64} height={64} /><div><strong>{"\u05d9\u05d7\u05d9\u05d3\u05ea \u05d4\u05d7\u05d9\u05dc\u05d5\u05e5"}</strong><span>{"\u05e8\u05e2\u05e0\u05e0\u05d4"}</span></div></div><div className="war-room-title-block"><p>{T.title}</p><h1>{summary.name}</h1><span>{T.risk}: {incidentRisk.label} | {T.status}: {summary.incident_status_label ?? (summary.is_closed ? T.closed : T.active)}</span></div><div className="war-room-brand-block"><Image src="/brand/yanshof-owl-logo.png" alt="" width={54} height={54} /><div><strong>{T.yanshof}</strong><span>{T.system}</span></div></div></header>
    <section className="war-room-top-grid updated"><WarRoomLiveClock openedAt={summary.opened_at} lastRefreshAt={lastRefreshAt} /><div className="war-room-force-card"><h2>{T.fieldForces}</h2><div className="war-room-force-grid"><div><span>{T.rescuersOnScene}</span><strong>{formatNumber(rescuersOnScene)}</strong></div><div><span>{T.activeTeams}</span><strong>{formatNumber(summary.active_teams)}</strong></div><div><span>{T.teamsEnRoute}</span><strong>{formatNumber(teamsEnRoute)}</strong></div></div></div><section className="war-room-panel war-room-events-panel top"><h2>{T.recentEvents}</h2>{recentLogs.length ? <ul>{recentLogs.map((log) => <li key={log.id}><time>{formatTime(log.reported_at)}</time><span className="war-room-event-icon">{eventIcon(log)}</span><span>{log.title}</span></li>)}</ul> : <p>{T.noData}</p>}</section></section>
    <section className="war-room-kpi-grid secondary"><div className="war-room-kpi orange"><span>{T.updatedPotential}</span><strong>{formatNumber(summary.updated_potential)}</strong></div><div className="war-room-kpi red"><span>{T.operationalGap}</span><strong>{formatNumber(summary.operational_gap)}</strong></div><div className="war-room-kpi orange"><span>{T.trappedLocated}</span><strong>{formatNumber(trappedCount)}</strong></div><div className="war-room-kpi blue wide"><span>{T.cumulativeResolved}</span><strong>{formatNumber(cumulativeResolved)}</strong><small>{T.evacuated} | {T.rescued} | {T.outside}</small></div><div className="war-room-kpi red"><span>{T.deceased}</span><strong>{formatNumber(deceasedCount)}</strong></div></section>
    <section className="war-room-table-stack full"><section className="war-room-panel"><h2>{T.rescueSites}</h2><div className="war-room-table-wrap"><table className="war-room-table rescue-status-table"><thead><tr><th>#</th><th>{T.rescueSites}</th><th>{T.updatedPotential}</th><th>{T.operationalGap}</th>{rescueColumns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead><tbody>{rescueSites.map((site, index) => <tr key={site.site_id}><td>{index + 1}</td><td>{siteName(site)}</td><td>{formatNumber(site.updated_potential)}</td><td className={site.operational_gap > 0 ? "war-room-danger-text" : "war-room-good-text"}>{formatNumber(site.operational_gap)}</td>{rescueColumns.map((column) => <td key={column.key}>{formatNumber(site.counts[column.key] ?? 0)}</td>)}</tr>)}<tr className="war-room-total-row"><td>{T.total}</td><td>-</td><td>{formatNumber(rescueSites.reduce((sum, site) => sum + site.updated_potential, 0))}</td><td>{formatNumber(rescueSites.reduce((sum, site) => sum + site.operational_gap, 0))}</td>{rescueColumns.map((column) => <td key={column.key}>{formatNumber(rescueTotals[column.key] ?? 0)}</td>)}</tr></tbody></table></div></section>
    <section className="war-room-panel"><h2>{T.searchSites}</h2><div className="war-room-table-wrap"><table className="war-room-table search-status-table"><thead><tr><th>#</th><th>{T.siteName}</th><th>{T.totalUnits}</th><th>{T.scannedUnits}</th><th>{T.completedUnits}</th><th>{T.noAnswer}</th><th>{T.damagedUnits}</th><th>{T.anxiety}</th><th>{T.physical}</th><th>{T.resolvedCasualties}</th></tr></thead><tbody>{searchSites.map((row, index) => <tr key={row.site.id}><td>{index + 1}</td><td>{siteName(row.site)}</td><td>{formatNumber(row.total)}</td><td>{formatNumber(row.scanned)}</td><td>{formatNumber(row.completed)}</td><td>{formatNumber(row.noAnswer)}</td><td>{formatNumber(row.damaged)}</td><td>{formatNumber(row.anxiety)}</td><td>{formatNumber(row.physical)}</td><td>{formatNumber(row.resolved)}</td></tr>)}<tr className="war-room-total-row"><td>{T.total}</td><td>-</td><td>{formatNumber(searchTotals.total)}</td><td>{formatNumber(searchTotals.scanned)}</td><td>{formatNumber(searchTotals.completed)}</td><td>{formatNumber(searchTotals.noAnswer)}</td><td>{formatNumber(searchTotals.damaged)}</td><td>{formatNumber(searchTotals.anxiety)}</td><td>{formatNumber(searchTotals.physical)}</td><td>{formatNumber(searchTotals.resolved)}</td></tr></tbody></table></div></section></section>
    <footer className="war-room-footer"><WarRoomFooterStatus lastRefreshAt={lastRefreshAt} /><strong>{T.motto}</strong></footer>
  </main>;
}
