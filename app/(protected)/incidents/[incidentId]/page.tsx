import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatNumber } from "@/lib/format";
import { operationalTeamLabel } from "@/lib/operational-teams";
import { searchLiveStatus, searchScannedCount } from "@/lib/search-site-status";
import { DashboardCollapsibleSection } from "./dashboard-collapsible-section";
import type { SiteAnalysisRow, SiteStatusSegments, SiteUnitAnalysisRow } from "./dashboard-site-command-summary-v2";
import { DashboardCommandScope, type DashboardScopeOperationalNumber } from "./dashboard-command-scope-v2";
import { ConnectedUsersWidget } from "./incident-presence";
import { closeIncident, pauseIncident, renameIncident, reopenIncident } from "./lifecycle-actions";
import type { PersonnelTeamItem } from "./personnel-team-drilldown";
import { SearchSitesDashboardWidget, type SearchSitesWidgetData } from "./search-sites-dashboard-widget";
import {
  ATTENDANCE_STATUSES,
  PERSONNEL_DEPARTMENTS,
  type AttendanceStatus,
  labelFromOptions,
  personnelDepartmentLabel,
  personnelRoleLabel
} from "../../personnel/personnel-options";

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

type SearchSiteDashboardRow = {
  id: string;
  name: string | null;
  city: string | null;
  street: string | null;
  house_number: string | null;
  parent_site_id: string | null;
  search_status: string | null;
  search_reason: string | null;
  search_priority: string | null;
};

type SearchSiteSummaryRow = {
  total_units: number;
  not_visited_count: number;
  clear_count: number;
  no_answer_count: number;
  casualties_count: number;
  completed_count: number;
};

type SearchSiteUnitResultRow = {
  site_id: string;
  unit_id: string;
  family_name: string | null;
  search_status: string | null;
  casualty_psych: boolean | null;
  casualty_body: boolean | null;
  anxiety_casualties_count: number | null;
  physical_casualties_count: number | null;
  has_apartment_damage: boolean | null;
  apartment_damage_notes: string | null;
};

type OperationalNumberRow = {
  person_id: string;
  site_id: string | null;
  operational_number: number;
  team_number: number;
  first_name: string | null;
  last_name: string | null;
  resident_first_name: string | null;
  resident_last_name: string | null;
  current_status_key: string | null;
  current_status_label: string | null;
  latest_report_status_label: string | null;
  latest_grid_cell: string | null;
  latest_reported_at: string | null;
  latest_notes: string | null;
  dashboard_status_group: string | null;
  is_merged: boolean;
  merged_operational_numbers: number[] | null;
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

type FloorRow = {
  id: string;
  site_id: string;
  floor_number: number | null;
};

type UnitRow = {
  id: string;
  site_id: string;
  floor_id: string | null;
  unit_number: string;
  zone_type: string | null;
  zone_name: string | null;
  zone_sequence: number | null;
  expected_occupants: number | null;
  known_people_count: number | null;
  is_active: boolean;
};

type ResidentRow = {
  id: string;
  site_id: string;
  unit_id: string | null;
  status_id: string | null;
  linked_person_id: string | null;
  is_active: boolean;
};

type StatusRow = {
  id: string;
  status_key: string;
  counts_as_gap_resolved: boolean;
};

type UnitPersonnelRow = {
  id: string;
  first_name: string;
  last_name: string;
  role: string;
  role_other: string | null;
  department: string;
  department_other: string | null;
  mobile_phone: string | null;
  is_active: boolean;
};

type PersonnelAttendanceRow = {
  personnel_id: string;
  attendance_status: AttendanceStatus;
  updated_at: string;
};

type SituationReportRow = {
  id: string;
  report_number: number;
  created_at: string;
  snapshot: {
    operational_numbers?: Array<Record<string, unknown>>;
  };
};

type IncidentLifecycleRow = {
  lifecycle_status: "active" | "paused" | "closed";
  archived_at: string | null;
  closed_at: string | null;
  paused_at: string | null;
};

function metadataText(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function textValue(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

const RESOLVED_STATUS_GROUPS = new Set(["rescued", "evacuated", "located_outside_site", "deceased"]);
const ATTENDANCE_ORDER: AttendanceStatus[] = ["present", "en_route", "unavailable", "inactive"];

function pct(value: number, total: number) {
  if (total <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round((value / total) * 100)));
}

type GapLevel = "high" | "medium" | "low";

function gapLevel(updatedPotential: number, activeOperationalNumbers: number): GapLevel {
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

function searchSiteDisplayName(site: SearchSiteDashboardRow) {
  return site.name?.trim() || [site.street, site.house_number].filter(Boolean).join(" ").trim() || "\u05d0\u05ea\u05e8 \u05e1\u05e8\u05d9\u05e7\u05d4";
}

function searchSiteAddress(site: SearchSiteDashboardRow) {
  return [site.street, site.house_number, site.city].filter(Boolean).join(" ").trim();
}

function numberValue(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeSearchSiteSummary(row: Partial<SearchSiteSummaryRow> | null | undefined): SearchSiteSummaryRow {
  return {
    total_units: numberValue(row?.total_units),
    not_visited_count: numberValue(row?.not_visited_count),
    clear_count: numberValue(row?.clear_count),
    no_answer_count: numberValue(row?.no_answer_count),
    casualties_count: numberValue(row?.casualties_count),
    completed_count: numberValue(row?.completed_count)
  };
}

function firstSearchSiteSummary(data: unknown) {
  const row = Array.isArray(data) ? data[0] : data;
  return normalizeSearchSiteSummary(row as Partial<SearchSiteSummaryRow> | null | undefined);
}

type SearchUnitStatus = "not_visited" | "no_answer" | "clear" | "casualties" | "completed";
type SearchKpiKind = "scanned" | "completed" | "no_answer" | "casualties";

type SearchKpiDrilldownEntry = {
  unitId: string;
  siteName: string | null;
  floorNumber: number | null;
  unitLabel: string;
  familyName: string | null;
  status: SearchUnitStatus;
  anxietyCasualtiesCount: number;
  physicalCasualtiesCount: number;
  hasApartmentDamage: boolean;
  apartmentDamageNotes: string | null;
};

const SEARCH_UNIT_STATUS_LABELS: Record<SearchUnitStatus, string> = {
  not_visited: "טרם נסרקה",
  no_answer: "אין מענה",
  clear: "תקין",
  casualties: "דווחו נפגעים",
  completed: "סיום טיפול / מזוכה"
};

function normalizeSearchUnitStatus(status: string | null | undefined): SearchUnitStatus {
  return ["not_visited", "no_answer", "clear", "casualties", "completed"].includes(status ?? "")
    ? (status as SearchUnitStatus)
    : "not_visited";
}

function effectiveSearchUnitStatus(result: SearchSiteUnitResultRow | undefined): SearchUnitStatus {
  const status = normalizeSearchUnitStatus(result?.search_status);
  if (
    Number(result?.anxiety_casualties_count ?? 0) > 0 ||
    Number(result?.physical_casualties_count ?? 0) > 0 ||
    result?.casualty_psych ||
    result?.casualty_body
  ) {
    return "casualties";
  }
  if (status === "completed") return "completed";
  return status;
}

function searchUnitStatusLabel(status: SearchUnitStatus) {
  return SEARCH_UNIT_STATUS_LABELS[status];
}

function searchUnitTone(status: SearchUnitStatus) {
  if (status === "completed") return "complete";
  if (status === "clear") return "clear";
  if (status === "casualties") return "casualties";
  if (status === "no_answer") return "no-answer";
  return "not-visited";
}

function matchesSearchKpi(status: SearchUnitStatus, kind: SearchKpiKind) {
  if (kind === "scanned") return ["clear", "no_answer", "casualties", "completed"].includes(status);
  if (kind === "completed") return status === "completed";
  if (kind === "no_answer") return status === "no_answer";
  return status === "casualties";
}

function SearchKpiDrilldown({ title, entries }: { title: string; entries: SearchKpiDrilldownEntry[] }) {
  return (
    <div className="search-kpi-drilldown-panel">
      <strong>{title}</strong>
      {entries.length === 0 ? (
        <p className="muted">אין דירות להצגה</p>
      ) : (
        <ul className="search-kpi-drilldown-list">
          {entries.map((entry) => (
            <li key={`${entry.siteName ?? "site"}-${entry.unitId}`}>
              {entry.siteName ? <span>{entry.siteName}</span> : null}
              <span>קומה {entry.floorNumber ?? "-"}</span>
              <strong>{entry.unitLabel}</strong>
              <span>{entry.familyName ? `משפחת ${entry.familyName}` : "משפחה לא צוינה"}</span>
              <span className={`search-unit-status ${searchUnitTone(entry.status)}`}>{searchUnitStatusLabel(entry.status)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function teamName(teamNumber: number, name?: string | null) {
  return operationalTeamLabel(teamNumber, name);
}

function operationalPersonName(person: OperationalNumberRow) {
  const personName = [person.first_name, person.last_name].filter(Boolean).join(" ").trim();
  if (personName) {
    return personName;
  }

  const residentName = [person.resident_first_name, person.resident_last_name].filter(Boolean).join(" ").trim();
  return residentName || null;
}

function departmentTeamNumber(department: string) {
  if (department === "population") {
    return 9;
  }

  const match = department.match(/^team_(\d+)$/);
  return match ? Number(match[1]) : null;
}

function zoneTypeLabel(zoneType: string | null) {
  const labels = new Map([
    ["apartment", "דירה"],
    ["store", "חנות"],
    ["office", "משרד"],
    ["parking_area", "חניה"],
    ["lobby", "לובי"],
    ["shelter", "מקלט"],
    ["warehouse", "מחסן"],
    ["machine_room", "חדר מכונות"],
    ["commercial_area", "שטח מסחרי"],
    ["other", "אזור"]
  ]);

  return labels.get(zoneType ?? "") ?? "אזור";
}

function unitDisplayLabel(unit: UnitRow) {
  if (unit.zone_type === "apartment" || !unit.zone_type) {
    return `דירה ${unit.zone_sequence ?? unit.unit_number}`;
  }

  if (unit.zone_type === "other" && unit.zone_name) {
    return `${unit.zone_name} ${unit.zone_sequence ?? unit.unit_number}`;
  }

  return `${zoneTypeLabel(unit.zone_type)} ${unit.zone_sequence ?? unit.unit_number}`;
}

function statusSegmentGroup(group: string | null): keyof SiteStatusSegments {
  if (group === "missing_unknown") {
    return "missingUnknown";
  }

  if (group === "trapped_located_not_yet_rescued" || group === "in_progress") {
    return "inProgress";
  }

  if (group === "deceased") {
    return "deceased";
  }

  if (RESOLVED_STATUS_GROUPS.has(group ?? "")) {
    return "completed";
  }

  return "other";
}

function statusTone(group: string | null): "blue" | "orange" | "green" | "red" | "neutral" {
  if (group === "missing_unknown") return "blue";
  if (group === "trapped_located_not_yet_rescued" || group === "in_progress") return "orange";
  if (group === "deceased") return "red";
  if (RESOLVED_STATUS_GROUPS.has(group ?? "")) return "green";
  return "neutral";
}

function operationalStatusLabel(person: OperationalNumberRow) {
  return (
    person.latest_report_status_label?.trim() ||
    person.current_status_label?.trim() ||
    person.current_status_key?.trim() ||
    "לא ידוע"
  );
}

function snapshotStatusCountsBySite(latestSitrep: SituationReportRow | null) {
  const counts = new Map<string, Map<string, number>>();

  for (const person of latestSitrep?.snapshot?.operational_numbers ?? []) {
    const siteId = textValue(person.site_id, "none");
    const label = textValue(person.latest_report_status_label, textValue(person.current_status_label, textValue(person.current_status_key, "לא ידוע")));
    const siteCounts = counts.get(siteId) ?? new Map<string, number>();
    siteCounts.set(label, (siteCounts.get(label) ?? 0) + 1);
    counts.set(siteId, siteCounts);
  }

  return counts;
}

export default async function IncidentDashboardPage({
  params
}: {
  params: { incidentId: string };
}) {
  const supabase = createClient();
  const { data: entryRole } = await supabase.rpc("current_user_role");

  if (entryRole === "search_user") {
    const { data: firstSearchSite } = await supabase
      .from("sites")
      .select("id")
      .eq("incident_id", params.incidentId)
      .eq("site_type", "search_site")
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (firstSearchSite?.id) {
      redirect(`/mobile/search/${params.incidentId}/${firstSearchSite.id}`);
    }

    notFound();
  }

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
    { data: searchSiteRows },
    { data: searchUnitResultRows },
    { data: operationalRows },
    { data: teamRows },
    { data: assignmentRows },
    { data: openNoteRows },
    { data: floorRows },
    { data: unitRows },
    { data: residentRows },
    { data: statusRows },
    { data: personnelRows },
    { data: personnelAttendanceRows },
    { data: sitrepRows },
    { data: lifecycleRow },
    { data: currentRole },
    { data: canManageIncidents }
  ] = await Promise.all([
    supabase
      .from("site_dashboard_summary")
      .select("*")
      .eq("incident_id", params.incidentId)
      .order("site_number", { ascending: true }),
    supabase
      .from("sites")
      .select("id,name,city,street,house_number,parent_site_id,search_status,search_reason,search_priority")
      .eq("incident_id", params.incidentId)
      .eq("is_active", true)
      .eq("site_type", "search_site")
      .order("created_at", { ascending: true }),
    supabase
      .from("site_search_units")
      .select("site_id,unit_id,family_name,search_status,casualty_psych,casualty_body,anxiety_casualties_count,physical_casualties_count,has_apartment_damage,apartment_damage_notes")
      .eq("incident_id", params.incidentId),
    supabase
      .from("operational_numbers_dashboard")
      .select(
        "person_id,site_id,operational_number,team_number,first_name,last_name,resident_first_name,resident_last_name,current_status_key,current_status_label,latest_report_status_label,latest_grid_cell,latest_reported_at,latest_notes,dashboard_status_group,is_merged,merged_operational_numbers"
      )
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
      .in("log_type", ["general_operational_note", "general_operational_note_status_changed"])
      .order("reported_at", { ascending: false })
      .limit(200),
    supabase
      .from("floors")
      .select("id,site_id,floor_number")
      .eq("incident_id", params.incidentId),
    supabase
      .from("units")
      .select("id,site_id,floor_id,unit_number,zone_type,zone_name,zone_sequence,expected_occupants,known_people_count,is_active")
      .eq("incident_id", params.incidentId)
      .eq("is_active", true),
    supabase
      .from("unit_residents")
      .select("id,site_id,unit_id,status_id,linked_person_id,is_active")
      .eq("incident_id", params.incidentId)
      .eq("is_active", true),
    supabase
      .from("status_types")
      .select("id,status_key,counts_as_gap_resolved")
      .eq("is_active", true)
      .in("category", ["resident", "person"]),
    supabase
      .from("unit_personnel")
      .select("id,first_name,last_name,role,role_other,department,department_other,mobile_phone,is_active")
      .eq("is_active", true),
    supabase
      .from("event_personnel_status")
      .select("personnel_id,attendance_status,updated_at")
      .eq("incident_id", params.incidentId),
    supabase
      .from("situation_reports")
      .select("id,report_number,created_at,snapshot")
      .eq("incident_id", params.incidentId)
      .order("report_number", { ascending: false })
      .limit(1),
    supabase
      .from("incidents")
      .select("lifecycle_status,archived_at,closed_at,paused_at")
      .eq("id", params.incidentId)
      .maybeSingle(),
    supabase.rpc("current_user_role"),
    supabase.rpc("can_manage_incidents")
  ]);

  const allSites = (siteRows ?? []) as SiteSummaryRow[];
  const searchSites = (searchSiteRows ?? []) as SearchSiteDashboardRow[];
  const searchSiteIds = new Set(searchSites.map((site) => site.id));
  const sites = allSites.filter((site) => !searchSiteIds.has(site.site_id));

  const operationalNumbers = ((operationalRows ?? []) as OperationalNumberRow[]).filter(
    (person) => !person.is_merged && (!person.site_id || !searchSiteIds.has(person.site_id))
  );
  const teams = (teamRows ?? []) as TeamRow[];
  const assignments = (assignmentRows ?? []) as TeamAssignmentRow[];
  const noteRows = (openNoteRows ?? []) as EventLogRow[];
  const latestSitrep = ((sitrepRows ?? []) as SituationReportRow[])[0] ?? null;
  const lifecycle = lifecycleRow as IncidentLifecycleRow | null;
  const isAdmin = currentRole === "admin";
  const canControlLifecycle = Boolean(canManageIncidents && !lifecycle?.archived_at);
  const isLifecycleClosed = lifecycle?.lifecycle_status === "closed" || summary.is_closed;
  const floors = (floorRows ?? []) as FloorRow[];
  const units = (unitRows ?? []) as UnitRow[];
  const searchUnitResults = (searchUnitResultRows ?? []) as SearchSiteUnitResultRow[];
  const emptySearchSiteSummary = normalizeSearchSiteSummary(null);
  const searchResultsByUnitId = new Map(searchUnitResults.map((result) => [result.unit_id, result]));
  const searchSiteSummaries = new Map(
    searchSites.map((site) => {
      const siteUnits = units.filter((unit) => unit.site_id === site.id && unit.is_active);
      const siteSummary: SearchSiteSummaryRow = {
        total_units: siteUnits.length,
        not_visited_count: 0,
        clear_count: 0,
        no_answer_count: 0,
        casualties_count: 0,
        completed_count: 0
      };

      for (const unit of siteUnits) {
        const status = effectiveSearchUnitStatus(searchResultsByUnitId.get(unit.id));
        if (status === "clear") siteSummary.clear_count += 1;
        else if (status === "no_answer") siteSummary.no_answer_count += 1;
        else if (status === "casualties") siteSummary.casualties_count += 1;
        else if (status === "completed") siteSummary.completed_count += 1;
        else siteSummary.not_visited_count += 1;
      }

      return [site.id, normalizeSearchSiteSummary(siteSummary)] as const;
    })
  );
  const searchFloorNumbersById = new Map(floors.map((floor) => [floor.id, floor.floor_number]));
  const searchEntriesBySite = new Map(
    searchSites.map((site) => {
      const entries = units
        .filter((unit) => unit.site_id === site.id && unit.is_active)
        .sort((a, b) =>
          (searchFloorNumbersById.get(a.floor_id ?? "") ?? -999) - (searchFloorNumbersById.get(b.floor_id ?? "") ?? -999) ||
          unitDisplayLabel(a).localeCompare(unitDisplayLabel(b), "he", { numeric: true, sensitivity: "base" })
        )
        .map((unit) => {
          const result = searchResultsByUnitId.get(unit.id);
          return {
            unitId: unit.id,
            siteName: searchSiteDisplayName(site),
            floorNumber: searchFloorNumbersById.get(unit.floor_id ?? "") ?? null,
            unitLabel: unitDisplayLabel(unit),
            familyName: result?.family_name ?? null,
            status: effectiveSearchUnitStatus(result),
            anxietyCasualtiesCount: numberValue(result?.anxiety_casualties_count),
            physicalCasualtiesCount: numberValue(result?.physical_casualties_count),
            hasApartmentDamage: Boolean(result?.has_apartment_damage),
            apartmentDamageNotes: result?.apartment_damage_notes ?? null
          } satisfies SearchKpiDrilldownEntry;
        });
      return [site.id, entries] as const;
    })
  );
  const allSearchEntries = Array.from(searchEntriesBySite.values()).flat();
  const searchEntriesByKpi = {
    scanned: allSearchEntries.filter((entry) => matchesSearchKpi(entry.status, "scanned")),
    completed: allSearchEntries.filter((entry) => matchesSearchKpi(entry.status, "completed")),
    no_answer: allSearchEntries.filter((entry) => matchesSearchKpi(entry.status, "no_answer")),
    casualties: allSearchEntries.filter((entry) => matchesSearchKpi(entry.status, "casualties"))
  };
  const residents = (residentRows ?? []) as ResidentRow[];
  const residentStatuses = new Map(((statusRows ?? []) as StatusRow[]).map((status) => [status.id, status]));
  const unitPersonnel = (personnelRows ?? []) as UnitPersonnelRow[];
  const attendanceByPersonId = new Map(
    ((personnelAttendanceRows ?? []) as PersonnelAttendanceRow[]).map((row) => [row.personnel_id, row])
  );
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
  const teamNamesByNumber = new Map(teams.map((team) => [team.team_number, team.name]));
  const sitesById = new Map(sites.map((site) => [site.site_id, site]));
  const searchSiteParentNames = new Map(sites.map((site) => [site.site_id, siteDisplayName(site)]));
  const searchSiteTotals = searchSites.reduce(
    (totals, site) => {
      const siteSummary = searchSiteSummaries.get(site.id) ?? emptySearchSiteSummary;
      totals.totalUnits += siteSummary.total_units;
      totals.scanned += searchScannedCount(siteSummary);
      totals.completed += siteSummary.completed_count;
      totals.noAnswer += siteSummary.no_answer_count;
      totals.casualties += siteSummary.casualties_count;
      return totals;
    },
    { totalUnits: 0, scanned: 0, completed: 0, noAnswer: 0, casualties: 0 }
  );
  const activeOperationalPersonIds = new Set(operationalNumbers.map((person) => person.person_id));
  const floorsById = new Map(floors.map((floor) => [floor.id, floor]));
  const residentsByUnitId = residents.reduce((map, resident) => {
    if (!resident.unit_id) {
      return map;
    }

    const unitResidents = map.get(resident.unit_id) ?? [];
    unitResidents.push(resident);
    map.set(resident.unit_id, unitResidents);
    return map;
  }, new Map<string, ResidentRow[]>());
  const unitsBySiteId = units.reduce((map, unit) => {
    const siteUnits = map.get(unit.site_id) ?? [];
    siteUnits.push(unit);
    map.set(unit.site_id, siteUnits);
    return map;
  }, new Map<string, UnitRow[]>());
  const operationalNumbersBySiteId = operationalNumbers.reduce((map, person) => {
    if (!person.site_id) {
      return map;
    }

    const sitePeople = map.get(person.site_id) ?? [];
    sitePeople.push(person);
    map.set(person.site_id, sitePeople);
    return map;
  }, new Map<string, OperationalNumberRow[]>());
  const previousStatusCountsBySite = snapshotStatusCountsBySite(latestSitrep);

  const siteAnalysisRows: SiteAnalysisRow[] = sites.map((site) => {
    const activeForSite = site.active_operational_numbers_count ?? site.gap_resolved_count ?? 0;
    const level = site.operational_gap === 0 ? "low" : gapLevel(site.updated_potential, activeForSite);
    const assignedTeams = (assignedTeamIdsBySite.get(site.site_id) ?? [])
      .map((teamId) => teamsById.get(teamId))
      .filter(Boolean) as TeamRow[];
    const siteOperationalNumbers = operationalNumbersBySiteId.get(site.site_id) ?? [];
    const currentStatusCounts = siteOperationalNumbers.reduce((map, person) => {
      const label = operationalStatusLabel(person);
      map.set(label, (map.get(label) ?? 0) + 1);
      return map;
    }, new Map<string, number>());
    const previousStatusCounts = previousStatusCountsBySite.get(site.site_id) ?? new Map<string, number>();
    const statusCards = Array.from(currentStatusCounts.entries())
      .filter(([, count]) => count > 0)
      .map(([label, count]) => ({
        label,
        count,
        delta: latestSitrep ? count - (previousStatusCounts.get(label) ?? 0) : null,
        tone: statusTone(siteOperationalNumbers.find((person) => operationalStatusLabel(person) === label)?.dashboard_status_group ?? null),
        people: siteOperationalNumbers
          .filter((person) => operationalStatusLabel(person) === label)
          .sort((a, b) => a.operational_number - b.operational_number)
          .map((person) => ({
            personId: person.person_id,
            operationalNumber: person.operational_number,
            fullName: operationalPersonName(person),
            statusLabel: operationalStatusLabel(person),
            teamLabel: teamName(person.team_number, teamNamesByNumber.get(person.team_number)),
            gridCell: person.latest_grid_cell,
            latestReportedAt: person.latest_reported_at,
            latestNotes: person.latest_notes
          }))
      }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "he"));
    const statusSegments = siteOperationalNumbers.reduce<SiteStatusSegments>(
      (segments, person) => {
        const key = statusSegmentGroup(person.dashboard_status_group);
        segments[key] += 1;
        return segments;
      },
      { missingUnknown: 0, inProgress: 0, completed: 0, deceased: 0, other: 0 }
    );
    const siteUnits: SiteUnitAnalysisRow[] = (unitsBySiteId.get(site.site_id) ?? [])
      .map((unit) => {
        const unitResidents = residentsByUnitId.get(unit.id) ?? [];
        const knownHandled = unitResidents.filter((resident) => {
          if (resident.linked_person_id && activeOperationalPersonIds.has(resident.linked_person_id)) {
            return true;
          }

          return Boolean(resident.status_id && residentStatuses.get(resident.status_id)?.counts_as_gap_resolved);
        }).length;
        const totalResidents = unitResidents.length;

        return {
          id: unit.id,
          floorNumber: unit.floor_id ? floorsById.get(unit.floor_id)?.floor_number ?? null : null,
          unitLabel: unitDisplayLabel(unit),
          totalResidents,
          expectedPotential: unit.expected_occupants ?? unit.known_people_count ?? totalResidents,
          knownHandled,
          gap: Math.max(0, totalResidents - knownHandled)
        };
      })
      .sort((a, b) => (a.floorNumber ?? -999) - (b.floorNumber ?? -999) || a.unitLabel.localeCompare(b.unitLabel, "he"));

    return {
      siteId: site.site_id,
      name: siteDisplayName(site),
      address: siteAddress(site),
      statusLabel: site.site_status_label,
      initialPotential: site.initial_potential,
      updatedPotential: site.updated_potential,
      activeOperationalNumbers: activeForSite,
      knownHandled: site.gap_resolved_count ?? activeForSite,
      operationalGap: site.operational_gap,
      level,
      teams: assignedTeams.map((team) => teamName(team.team_number, team.name)),
      structureHref: `/incidents/${summary.incident_id}/sites/${site.site_id}`,
      operationalNumbersHref: `/incidents/${summary.incident_id}/sites/${site.site_id}/operational-numbers`,
      operationalLogHref: `/incidents/${summary.incident_id}/sites/${site.site_id}/operational-log`,
      units: siteUnits,
      statusSegments,
      statusCards
    };
  });

  const operationalRowsForTeam = (teamNumber: number) =>
    operationalNumbers
      .filter((person) => person.team_number === teamNumber)
      .sort((a, b) => a.operational_number - b.operational_number)
      .map((person) => ({
        personId: person.person_id,
        operationalNumber: person.operational_number,
        personName: operationalPersonName(person),
        siteName: person.site_id ? siteDisplayName(sitesById.get(person.site_id) ?? ({
          site_id: person.site_id,
          site_number: 0,
          name: null,
          city: null,
          street: "",
          house_number: "",
          site_status_label: null,
          initial_potential: 0,
          updated_potential: 0,
          total_active_units: 0,
          open_units: 0,
          operational_gap: 0
        } as SiteSummaryRow)) : "\u05dc\u05dc\u05d0 \u05d0\u05ea\u05e8",
        statusLabel:
          person.latest_report_status_label?.trim() ||
          person.current_status_label?.trim() ||
          person.current_status_key?.trim() ||
          "\u05dc\u05d0 \u05d9\u05d3\u05d5\u05e2",
        statusGroup: person.dashboard_status_group,
        gridCell: person.latest_grid_cell,
        latestReportedAt: person.latest_reported_at
      }));

  const basePersonnelTeamItems: PersonnelTeamItem[] = PERSONNEL_DEPARTMENTS.map(([department, departmentLabel]) => {
    const operationalTeamNumber = departmentTeamNumber(department);
    const departmentRows = unitPersonnel
      .filter((person) => person.department === department)
      .map((person) => {
        const attendance = attendanceByPersonId.get(person.id);
        const attendanceStatus: AttendanceStatus = attendance?.attendance_status ?? "unavailable";

        return {
          id: person.id,
          fullName: `${person.first_name} ${person.last_name}`.trim(),
          roleLabel: personnelRoleLabel(person.role, person.role_other),
          phone: person.mobile_phone,
          attendanceStatus,
          attendanceLabel: labelFromOptions(ATTENDANCE_STATUSES, attendanceStatus),
          updatedAt: attendance?.updated_at ?? null
        };
      })
      .sort((a, b) => {
        const byStatus = ATTENDANCE_ORDER.indexOf(a.attendanceStatus) - ATTENDANCE_ORDER.indexOf(b.attendanceStatus);
        if (byStatus !== 0) return byStatus;
        return a.fullName.localeCompare(b.fullName, "he");
      });

    return {
      id: department,
      label: department === "other" ? departmentLabel : personnelDepartmentLabel(department),
      present: departmentRows.filter((row) => row.attendanceStatus === "present").length,
      enRoute: departmentRows.filter((row) => row.attendanceStatus === "en_route").length,
      unavailable: departmentRows.filter((row) => row.attendanceStatus === "unavailable").length,
      inactive: departmentRows.filter((row) => row.attendanceStatus === "inactive").length,
      total: departmentRows.length,
      rows: departmentRows,
      operationalRows: operationalTeamNumber === null ? [] : operationalRowsForTeam(operationalTeamNumber)
    };
  });
  const knownDepartmentTeamNumbers = new Set(
    PERSONNEL_DEPARTMENTS.map(([department]) => departmentTeamNumber(department)).filter((value): value is number => value !== null)
  );
  const dynamicTeamItems: PersonnelTeamItem[] = Array.from(new Set(operationalNumbers.map((person) => person.team_number)))
    .filter((teamNumber) => !knownDepartmentTeamNumbers.has(teamNumber))
    .sort((a, b) => a - b)
    .map((teamNumber) => ({
      id: `operational_team_${teamNumber}`,
      label: teamName(teamNumber, teamNamesByNumber.get(teamNumber)),
      present: 0,
      enRoute: 0,
      unavailable: 0,
      inactive: 0,
      total: 0,
      rows: [],
      operationalRows: operationalRowsForTeam(teamNumber)
    }));
  const personnelTeamItems: PersonnelTeamItem[] = [...basePersonnelTeamItems, ...dynamicTeamItems];
  const dashboardScopeOperationalNumbers: DashboardScopeOperationalNumber[] = operationalNumbers.map((person) => ({
    personId: person.person_id,
    siteId: person.site_id,
    operationalNumber: person.operational_number,
    firstName: person.first_name,
    lastName: person.last_name,
    residentFirstName: person.resident_first_name,
    residentLastName: person.resident_last_name,
    currentStatusKey: person.current_status_key,
    currentStatusLabel: person.current_status_label,
    latestReportStatusLabel: person.latest_report_status_label,
    latestReportedAt: person.latest_reported_at,
    dashboardStatusGroup: person.dashboard_status_group,
    mergedOperationalNumbers: person.merged_operational_numbers ?? []
  }));
  const searchSitesWidgetData: SearchSitesWidgetData = {
    sites: searchSites.map((site) => ({
      id: site.id,
      name: searchSiteDisplayName(site),
      address: searchSiteAddress(site) || null,
      parentName: site.parent_site_id ? searchSiteParentNames.get(site.parent_site_id) ?? null : null,
      searchPriority: site.search_priority,
      searchReason: site.search_reason,
      summary: searchSiteSummaries.get(site.id) ?? emptySearchSiteSummary,
      anxietyCasualtiesCount: (searchEntriesBySite.get(site.id) ?? []).reduce((sum, entry) => sum + entry.anxietyCasualtiesCount, 0),
      physicalCasualtiesCount: (searchEntriesBySite.get(site.id) ?? []).reduce((sum, entry) => sum + entry.physicalCasualtiesCount, 0),
      damagedUnitsCount: (searchEntriesBySite.get(site.id) ?? []).filter((entry) => entry.hasApartmentDamage).length,
      entries: searchEntriesBySite.get(site.id) ?? []
    })),
    updatedAt: new Date().toISOString()
  };

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
            {lifecycle?.lifecycle_status === "paused" ? <span className="command-badge coverage-medium">מושהה</span> : null}
            <span className={`command-badge coverage-${incidentGapLevel}`}>{gapLabel(incidentGapLevel)}</span>
            <span className="command-badge">{formatNumber(summary.total_sites)} {"\u05d0\u05ea\u05e8\u05d9\u05dd"}</span>
          </div>
        </div>

        <ConnectedUsersWidget />
      </div>

      {canControlLifecycle ? (
        <section className="panel lifecycle-control-panel no-print">
          <div>
            <h2>ניהול מחזור חיים</h2>
            <p className="muted">
              {isLifecycleClosed
                ? "האירוע סגור לקריאה בלבד. ניתן להחזיר אותו לפעילות, אך אתרים סגורים לא ייפתחו אוטומטית."
                : lifecycle?.lifecycle_status === "paused"
                  ? "האירוע מושהה. ניתן להחזיר לפעילות או לסגור את הפעילות."
                  : "האירוע פעיל. סגירה תיצור דוח סגירת אירוע ותסגור את כל האתרים."}
            </p>
          </div>
          <div className="actions">
            {isAdmin ? (
              <details className="archive-confirm-panel">
                <summary className="button secondary">עריכת שם אירוע</summary>
                <form action={renameIncident} className="action-form">
                  <input type="hidden" name="incidentId" value={summary.incident_id} />
                  <label>
                    שם אירוע
                    <input className="input" name="newName" defaultValue={summary.name} required />
                  </label>
                  <button className="button" type="submit">שמור שם</button>
                </form>
              </details>
            ) : null}

            {isLifecycleClosed || lifecycle?.lifecycle_status === "paused" ? (
              <form action={reopenIncident}>
                <input type="hidden" name="incidentId" value={summary.incident_id} />
                <button className="button" type="submit">החזר אירוע לפעילות</button>
              </form>
            ) : (
              <>
                {lifecycle?.lifecycle_status !== "paused" ? (
                  <form action={pauseIncident}>
                    <input type="hidden" name="incidentId" value={summary.incident_id} />
                    <button className="button secondary" type="submit">השהה אירוע</button>
                  </form>
                ) : null}
                <details className="archive-confirm-panel">
                  <summary className="button danger">סגירת פעילות באירוע</summary>
                  <form action={closeIncident} className="action-form">
                    <input type="hidden" name="incidentId" value={summary.incident_id} />
                    <strong>{summary.name}</strong>
                    <p className="muted">האם לסגור את פעילות האירוע? כל האתרים הפעילים יסומנו כסגורים ודוח סגירה ייווצר אוטומטית.</p>
                    <button className="button danger" type="submit">סגירת פעילות באירוע</button>
                  </form>
                </details>
              </>
            )}
          </div>
        </section>
      ) : null}

      <DashboardCommandScope
        incidentId={summary.incident_id}
        canCreateSitrep={Boolean(canManageIncidents)}
        openedAt={summary.opened_at}
        latestSitrepAt={latestSitrep?.created_at ?? null}
        sites={siteAnalysisRows}
        operationalNumbers={dashboardScopeOperationalNumbers}
        personnelTeams={personnelTeamItems}
      />

      <SearchSitesDashboardWidget incidentId={summary.incident_id} initialData={searchSitesWidgetData} />

      {false && searchSites.length > 0 ? (
        <DashboardCollapsibleSection
          title={"\u05d0\u05ea\u05e8\u05d9 \u05e1\u05e8\u05d9\u05e7\u05d4"}
          defaultOpen={false}
          className="search-sites-dashboard-widget"
        >
          <div className="search-sites-summary-grid search-sites-kpi-grid" aria-label={"\u05e1\u05d9\u05db\u05d5\u05dd \u05d3\u05d9\u05e8\u05d5\u05ea \u05d1\u05d0\u05ea\u05e8\u05d9 \u05e1\u05e8\u05d9\u05e7\u05d4"}>
            <div className="search-kpi-total">
              <span>{"\u05e1\u05d4\u05f4\u05db \u05d3\u05d9\u05e8\u05d5\u05ea"}</span>
              <strong>{formatNumber(searchSiteTotals.totalUnits)}</strong>
            </div>
            <details className="search-kpi-click-card search-kpi-scanned">
              <summary>
                <span>{"\u05d3\u05d9\u05e8\u05d5\u05ea \u05e9\u05e0\u05e1\u05e8\u05e7\u05d5"}</span>
                <strong>{formatNumber(searchSiteTotals.scanned)}</strong>
              </summary>
              <SearchKpiDrilldown title={"\u05d3\u05d9\u05e8\u05d5\u05ea \u05e9\u05e0\u05e1\u05e8\u05e7\u05d5"} entries={searchEntriesByKpi.scanned} />
            </details>
            <details className="search-kpi-click-card search-kpi-completed">
              <summary>
                <span>{"\u05d3\u05d9\u05e8\u05d5\u05ea \u05d6\u05d5\u05db\u05d5"}</span>
                <strong>{formatNumber(searchSiteTotals.completed)}</strong>
              </summary>
              <SearchKpiDrilldown title={"\u05d3\u05d9\u05e8\u05d5\u05ea \u05d6\u05d5\u05db\u05d5"} entries={searchEntriesByKpi.completed} />
            </details>
            <details className="search-kpi-click-card search-kpi-no-answer">
              <summary>
                <span>{"\u05d0\u05d9\u05df \u05de\u05e2\u05e0\u05d4"}</span>
                <strong>{formatNumber(searchSiteTotals.noAnswer)}</strong>
              </summary>
              <SearchKpiDrilldown title={"\u05d3\u05d9\u05e8\u05d5\u05ea \u05dc\u05dc\u05d0 \u05de\u05e2\u05e0\u05d4"} entries={searchEntriesByKpi.no_answer} />
            </details>
            <details className="search-kpi-click-card search-kpi-casualties">
              <summary>
                <span>{"\u05d3\u05d5\u05d5\u05d7\u05d5 \u05e0\u05e4\u05d2\u05e2\u05d9\u05dd"}</span>
                <strong>{formatNumber(searchSiteTotals.casualties)}</strong>
              </summary>
              <SearchKpiDrilldown title={"\u05d3\u05d9\u05e8\u05d5\u05ea \u05e2\u05dd \u05d3\u05d9\u05d5\u05d5\u05d7 \u05e0\u05e4\u05d2\u05e2\u05d9\u05dd"} entries={searchEntriesByKpi.casualties} />
            </details>
          </div>
          <div className="search-sites-dashboard-list">
            {searchSites.map((site) => {
              const siteSearchSummary = searchSiteSummaries.get(site.id) ?? emptySearchSiteSummary;
              const siteScanned = searchScannedCount(siteSearchSummary);
              const siteLiveStatus = searchLiveStatus(siteSearchSummary);
              const siteEntries = searchEntriesBySite.get(site.id) ?? [];
              const siteEntriesByKpi = {
                scanned: siteEntries.filter((entry) => matchesSearchKpi(entry.status, "scanned")),
                completed: siteEntries.filter((entry) => matchesSearchKpi(entry.status, "completed")),
                no_answer: siteEntries.filter((entry) => matchesSearchKpi(entry.status, "no_answer")),
                casualties: siteEntries.filter((entry) => matchesSearchKpi(entry.status, "casualties"))
              };
              const parentName = site.parent_site_id ? searchSiteParentNames.get(site.parent_site_id) : null;
              return (
                <article className="search-site-dashboard-card" key={site.id}>
                  <div>
                    <div className="search-site-card-heading">
                      <strong>{searchSiteDisplayName(site)}</strong>
                      <span className="site-type-badge search-site">{"\u05d0\u05ea\u05e8 \u05e1\u05e8\u05d9\u05e7\u05d4"}</span>
                      <span className={`search-status-badge search-site-live-${siteLiveStatus.tone}`}>{siteLiveStatus.label}</span>
                    </div>
                    {searchSiteAddress(site) ? <p className="muted">{searchSiteAddress(site)}</p> : null}
                  </div>
                  <dl className="search-site-card-details">
                    <div>
                      <dt>{"\u05d0\u05ea\u05e8 \u05d0\u05d1"}</dt>
                      <dd>{parentName ?? "\u05dc\u05dc\u05d0"}</dd>
                    </div>
                    <div>
                      <dt>{"\u05e2\u05d3\u05d9\u05e4\u05d5\u05ea"}</dt>
                      <dd>{site.search_priority?.trim() || "-"}</dd>
                    </div>
                    <div>
                      <dt>{"\u05e1\u05d9\u05d1\u05ea \u05e1\u05e8\u05d9\u05e7\u05d4"}</dt>
                      <dd>{site.search_reason?.trim() || "-"}</dd>
                    </div>
                  </dl>
                  <div className="search-site-card-kpis" aria-label={"\u05e1\u05d9\u05db\u05d5\u05dd \u05e1\u05e8\u05d9\u05e7\u05d4 \u05dc\u05d0\u05ea\u05e8"}>
                    <div className="search-kpi-total"><span>{"\u05e1\u05d4\u05f4\u05db"}</span><strong>{formatNumber(siteSearchSummary.total_units)}</strong></div>
                    <details className="search-kpi-click-card search-kpi-scanned">
                      <summary><span>{"\u05e0\u05e1\u05e8\u05e7\u05d5"}</span><strong>{formatNumber(siteScanned)}</strong></summary>
                      <SearchKpiDrilldown title={"\u05d3\u05d9\u05e8\u05d5\u05ea \u05e9\u05e0\u05e1\u05e8\u05e7\u05d5"} entries={siteEntriesByKpi.scanned} />
                    </details>
                    <details className="search-kpi-click-card search-kpi-completed">
                      <summary><span>{"\u05d6\u05d5\u05db\u05d5"}</span><strong>{formatNumber(siteSearchSummary.completed_count)}</strong></summary>
                      <SearchKpiDrilldown title={"\u05d3\u05d9\u05e8\u05d5\u05ea \u05d6\u05d5\u05db\u05d5"} entries={siteEntriesByKpi.completed} />
                    </details>
                    <details className="search-kpi-click-card search-kpi-no-answer">
                      <summary><span>{"\u05d0\u05d9\u05df \u05de\u05e2\u05e0\u05d4"}</span><strong>{formatNumber(siteSearchSummary.no_answer_count)}</strong></summary>
                      <SearchKpiDrilldown title={"\u05d3\u05d9\u05e8\u05d5\u05ea \u05dc\u05dc\u05d0 \u05de\u05e2\u05e0\u05d4"} entries={siteEntriesByKpi.no_answer} />
                    </details>
                    <details className="search-kpi-click-card search-kpi-casualties">
                      <summary><span>{"\u05e0\u05e4\u05d2\u05e2\u05d9\u05dd"}</span><strong>{formatNumber(siteSearchSummary.casualties_count)}</strong></summary>
                      <SearchKpiDrilldown title={"\u05d3\u05d9\u05e8\u05d5\u05ea \u05e2\u05dd \u05d3\u05d9\u05d5\u05d5\u05d7 \u05e0\u05e4\u05d2\u05e2\u05d9\u05dd"} entries={siteEntriesByKpi.casualties} />
                    </details>
                  </div>
                  <Link className="button compact secondary" href={`/incidents/${summary.incident_id}/sites/${site.id}`}>
                    {"\u05e4\u05ea\u05d7 \u05d0\u05ea\u05e8"}
                  </Link>
                </article>
              );
            })}
          </div>
        </DashboardCollapsibleSection>
      ) : null}

      <DashboardCollapsibleSection
        title="הערות פתוחות"
        defaultOpen={openNotes.length > 0}
        className="open-notes-panel"
        action={(
          <Link className="button secondary" href={`/incidents/${summary.incident_id}/operational-log?eventType=general_notes`}>
            כל ההערות
          </Link>
        )}
      >
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
      </DashboardCollapsibleSection>
    </main>
  );
}
