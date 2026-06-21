import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatNumber } from "@/lib/format";
import { DashboardCollapsibleSection } from "./dashboard-collapsible-section";
import type { SiteAnalysisRow, SiteStatusSegments, SiteUnitAnalysisRow } from "./dashboard-site-analysis";
import { DashboardSiteScope, type DashboardScopeOperationalNumber } from "./dashboard-site-scope";
import type { KpiDrilldownItem, KpiDrilldownRow } from "./kpi-drilldown";
import type { PersonnelTeamItem } from "./personnel-team-drilldown";
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

function metadataText(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
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

function teamName(teamNumber: number, name?: string | null) {
  if (teamNumber === 9) {
    return name?.trim() || "\u05e6\u05d5\u05d5\u05ea \u05d0\u05d5\u05db\u05dc\u05d5\u05e1\u05d9\u05d9\u05d4";
  }

  return name?.trim() || `\u05e6\u05d5\u05d5\u05ea ${teamNumber}`;
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

function importanceLabel(importance: string) {
  if (importance === "critical") {
    return "\u05e7\u05e8\u05d9\u05d8\u05d9";
  }

  if (importance === "important") {
    return "\u05d7\u05e9\u05d5\u05d1";
  }

  return "\u05e8\u05d2\u05d9\u05dc";
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
    { data: openNoteRows },
    { data: floorRows },
    { data: unitRows },
    { data: residentRows },
    { data: statusRows },
    { data: personnelRows },
    { data: personnelAttendanceRows }
  ] = await Promise.all([
    supabase
      .from("site_dashboard_summary")
      .select("*")
      .eq("incident_id", params.incidentId)
      .order("site_number", { ascending: true }),
    supabase
      .from("operational_numbers_dashboard")
      .select(
        "person_id,site_id,operational_number,team_number,first_name,last_name,resident_first_name,resident_last_name,current_status_key,current_status_label,latest_report_status_label,latest_grid_cell,latest_reported_at,dashboard_status_group,is_merged"
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
      .in("importance", ["important", "critical"])
      .order("reported_at", { ascending: false })
      .limit(10),
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
      .eq("incident_id", params.incidentId)
  ]);

  const sites = (siteRows ?? []) as SiteSummaryRow[];
  const operationalNumbers = ((operationalRows ?? []) as OperationalNumberRow[]).filter((person) => !person.is_merged);
  const teams = (teamRows ?? []) as TeamRow[];
  const assignments = (assignmentRows ?? []) as TeamAssignmentRow[];
  const importantLogs = (importantLogRows ?? []) as EventLogRow[];
  const noteRows = (openNoteRows ?? []) as EventLogRow[];
  const floors = (floorRows ?? []) as FloorRow[];
  const units = (unitRows ?? []) as UnitRow[];
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
  const sitesById = new Map(sites.map((site) => [site.site_id, site]));
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

  const siteAnalysisRows: SiteAnalysisRow[] = sites.map((site) => {
    const activeForSite = site.active_operational_numbers_count ?? site.gap_resolved_count ?? 0;
    const level = site.operational_gap === 0 ? "low" : gapLevel(site.updated_potential, activeForSite);
    const assignedTeams = (assignedTeamIdsBySite.get(site.site_id) ?? [])
      .map((teamId) => teamsById.get(teamId))
      .filter(Boolean) as TeamRow[];
    const siteOperationalNumbers = operationalNumbersBySiteId.get(site.site_id) ?? [];
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
      statusSegments
    };
  });

  const personnelTeamItems: PersonnelTeamItem[] = PERSONNEL_DEPARTMENTS.map(([department, departmentLabel]) => {
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
      operationalRows:
        operationalTeamNumber === null
          ? []
          : operationalNumbers
              .filter((person) => person.team_number === operationalTeamNumber)
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
                } as SiteSummaryRow)) : "ללא אתר",
                statusLabel:
                  person.latest_report_status_label?.trim() ||
                  person.current_status_label?.trim() ||
                  person.current_status_key?.trim() ||
                  "לא ידוע",
                statusGroup: person.dashboard_status_group,
                gridCell: person.latest_grid_cell,
                latestReportedAt: person.latest_reported_at
              }))
    };
  });

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
    dashboardStatusGroup: person.dashboard_status_group
  }));
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

      <DashboardSiteScope
        kpiItems={kpiItems}
        sites={siteAnalysisRows}
        operationalNumbers={dashboardScopeOperationalNumbers}
        personnelTeams={personnelTeamItems}
      />

      <DashboardCollapsibleSection
        title="עדכונים אחרונים חשובים"
        defaultOpen={importantLogs.length > 0}
        action={(
          <Link className="button" href={`/incidents/${summary.incident_id}/operational-log`}>
            פתח יומן מבצעי מלא
          </Link>
        )}
      >
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
      </DashboardCollapsibleSection>

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
