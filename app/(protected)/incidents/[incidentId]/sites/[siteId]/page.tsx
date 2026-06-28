import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatNumber } from "@/lib/format";
import {
  searchLiveStatus as sharedSearchLiveStatus,
  searchScannedCount,
  searchSummaryFromStatuses
} from "@/lib/search-site-status";
import { isSearchSite, searchStatusLabel, siteTypeLabel } from "@/lib/site-display";
import { CollaborativeLockSection } from "../../collaborative-lock";
import { closeSite, reopenSite } from "../../lifecycle-actions";
import {
  addApartmentToFloor,
  clearUnit,
  completeSearchUnitAction,
  createGeneralAreaResident,
  createUnitResident,
  deleteEmptyPlaceholderResident,
  linkExistingPersonToResident,
  removeApartmentUnit,
  reopenClearedUnit,
  saveSearchUnit,
  splitApartmentUnit,
  updateUnitResident,
  updateUnitStatus
} from "./actions";

type SiteSummaryRow = {
  incident_id: string;
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
  fully_cleared_units: number;
  open_units: number;
  total_persons: number;
  open_persons: number;
  resolved_persons: number;
  gap_resolved_count: number;
  operational_gap: number;
  site_type?: string | null;
  search_status?: string | null;
};

type SiteLifecycleRow = {
  lifecycle_status: "open" | "paused" | "closed";
  site_type: string | null;
  search_status: string | null;
};

type SiteRecordRow = {
  id: string;
  incident_id: string;
  name: string | null;
  city: string | null;
  street: string | null;
  house_number: string | null;
  lifecycle_status: "open" | "paused" | "closed";
  site_type: string | null;
  search_status: string | null;
};

type FloorRow = {
  id: string;
  floor_number: number;
  units_count: number;
  status_id: string | null;
  is_active: boolean;
};

type UnitRow = {
  id: string;
  floor_id: string;
  unit_number: string;
  zone_name: string | null;
  zone_type: string | null;
  zone_sequence: number | null;
  expected_occupants: number | null;
  family_name: string | null;
  known_people_count: number | null;
  status_id: string | null;
  is_fully_cleared: boolean;
  is_active: boolean;
  inactive_reason: string | null;
  notes: string | null;
  cleared_at: string | null;
  cleared_by: string | null;
  cleared_reason: string | null;
  cleared_potential_delta: number;
  cleared_method: "manual" | "automatic" | null;
  reopened_at: string | null;
  reopened_by: string | null;
  previous_unit_label: string | null;
  original_unit_label: string | null;
  structure_change_type: string | null;
};

type ResidentRow = {
  id: string;
  site_id: string;
  unit_id: string | null;
  first_name: string | null;
  last_name: string | null;
  gender: "male" | "female" | "unknown";
  age: number | null;
  phone: string | null;
  status_id: string | null;
  linked_person_id: string | null;
  is_active: boolean;
  notes: string | null;
};

type PersonRow = {
  id: string;
  site_id: string | null;
  unit_id: string | null;
  resident_id: string | null;
  operational_number: number;
  first_name: string | null;
  last_name: string | null;
  current_status_id: string;
  current_status_key: string | null;
  current_status_label: string | null;
  latest_report_status_key: string | null;
  latest_report_status_label: string | null;
  is_merged: boolean;
};

type StatusRow = {
  id: string;
  category: string;
  status_key: string;
  hebrew_label: string;
  name: string;
  counts_as_gap_resolved: boolean;
  display_order: number | null;
};

type SearchUnitStatus = "not_visited" | "no_answer" | "clear" | "casualties" | "completed";

type SearchUnitRow = {
  unit_id: string;
  family_name: string | null;
  occupants_count: number | null;
  contact_phone: string | null;
  search_status: SearchUnitStatus | null;
  casualty_psych: boolean | null;
  casualty_body: boolean | null;
  medical_evacuation: boolean | null;
  notes: string | null;
  searched_at: string | null;
  completed_at: string | null;
};

type SearchSiteSummaryRow = {
  total_units: number;
  not_visited_count: number;
  clear_count: number;
  no_answer_count: number;
  casualties_count: number;
  completed_count: number;
};

type SearchKpiKind = "scanned" | "completed" | "no_answer" | "casualties";

type SearchKpiDrilldownEntry = {
  unitId: string;
  floorNumber: number | null;
  unitLabel: string;
  familyName: string | null;
  status: SearchUnitStatus;
};

const MANUAL_SEARCH_UNIT_ZONE_NAME = "הוספה ידנית";

const SEARCH_UNIT_STATUS_OPTIONS: Array<{ value: SearchUnitStatus; label: string }> = [
  { value: "not_visited", label: "טרם נסרקה" },
  { value: "no_answer", label: "אין מענה" },
  { value: "clear", label: "תקין" },
  { value: "casualties", label: "דווחו נפגעים" },
  { value: "completed", label: "סיום טיפול / מזוכה" }
];

const SEARCH_UNIT_STATUS_LABELS: Record<SearchUnitStatus, string> = {
  not_visited: "טרם נסרקה",
  no_answer: "אין מענה",
  clear: "תקין",
  casualties: "דווחו נפגעים",
  completed: "סיום טיפול / מזוכה"
};

function searchUnitStatusLabel(status: SearchUnitStatus | null | undefined) {
  return SEARCH_UNIT_STATUS_LABELS[status ?? "not_visited"];
}

function searchUnitTone(status: SearchUnitStatus | null | undefined) {
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
            <li key={entry.unitId}>
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

function siteNameFromRecord(site: Pick<SiteRecordRow, "name" | "street" | "house_number">) {
  return site.name?.trim() || [site.street, site.house_number].filter(Boolean).join(" ").trim() || "אתר סריקה";
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

function liveSearchSummaryFromRows(units: UnitRow[], resultsByUnit: Map<string, SearchUnitRow>) {
  const summary = normalizeSearchSiteSummary(null);
  summary.total_units = units.filter((unit) => unit.is_active).length;

  for (const unit of units) {
    if (!unit.is_active) continue;
    const status = resultsByUnit.get(unit.id)?.search_status ?? "not_visited";

    if (status === "clear") summary.clear_count += 1;
    else if (status === "no_answer") summary.no_answer_count += 1;
    else if (status === "casualties") summary.casualties_count += 1;
    else if (status === "completed") summary.completed_count += 1;
    else summary.not_visited_count += 1;
  }

  return summary;
}

function liveSearchSiteStatus(summary: SearchSiteSummaryRow) {
  const scanned = summary.clear_count + summary.no_answer_count + summary.casualties_count + summary.completed_count;

  if (scanned === 0) {
    return { label: "טרם התחיל", tone: "not-started" };
  }

  if (summary.no_answer_count > 0 || summary.casualties_count > 0) {
    return { label: "ממצאים פתוחים", tone: "open-items" };
  }

  if (summary.total_units > 0 && scanned >= summary.total_units) {
    return { label: "אתר מזוכה", tone: "cleared" };
  }

  return { label: "בסריקה", tone: "in-progress" };
}
type TreatmentState = "completed" | "in_progress" | "missing" | "unknown";

const LINKED_PERSON_COMPLETED_STATUS_KEYS = new Set([
  "rescued",
  "evacuated",
  "evacuated_from_site",
  "evacuated_to_napal",
  "injured_evacuated_from_site",
  "injured_evacuated_to_ccp",
  "located_outside_site",
  "deceased_evacuated",
  "fatality_evacuated",
  "resolved"
]);

function statusLabel(statuses: Map<string, StatusRow>, statusId: string | null) {
  if (!statusId) {
    return null;
  }

  return statuses.get(statusId)?.hebrew_label ?? null;
}

function statusKey(statuses: Map<string, StatusRow>, statusId: string | null) {
  return statusId ? statuses.get(statusId)?.status_key ?? null : null;
}

function linkedPersonStatusKey(statuses: Map<string, StatusRow>, linkedPerson: PersonRow | null | undefined) {
  if (!linkedPerson) {
    return null;
  }

  return linkedPerson.latest_report_status_key ?? linkedPerson.current_status_key ?? statusKey(statuses, linkedPerson.current_status_id);
}

function linkedPersonStatusLabel(statuses: Map<string, StatusRow>, linkedPerson: PersonRow | null | undefined) {
  if (!linkedPerson) {
    return null;
  }

  return linkedPerson.latest_report_status_label ?? linkedPerson.current_status_label ?? statusLabel(statuses, linkedPerson.current_status_id);
}

function displayName(person: Pick<PersonRow | ResidentRow, "first_name" | "last_name">) {
  return [person.first_name, person.last_name].filter(Boolean).join(" ") || "שם לא ידוע";
}

function personLabel(person: PersonRow, linkedResident?: ResidentRow | null) {
  return `#${person.operational_number} - ${linkedResident ? displayName(linkedResident) : displayName(person)}`;
}

function treatmentState(
  statuses: Map<string, StatusRow>,
  resident: ResidentRow,
  linkedPerson?: PersonRow | null
): TreatmentState {
  const residentKey = statusKey(statuses, resident.status_id);
  const residentStatus = resident.status_id ? statuses.get(resident.status_id) : null;
  const personStatusKey = linkedPersonStatusKey(statuses, linkedPerson);

  if (linkedPerson) {
    return personStatusKey && LINKED_PERSON_COMPLETED_STATUS_KEYS.has(personStatusKey)
      ? "completed"
      : "in_progress";
  }

  if (residentStatus?.counts_as_gap_resolved) {
    return "completed";
  }

  if (residentKey === "in_progress") {
    return "in_progress";
  }

  if (residentKey === "missing") {
    return "missing";
  }

  return "unknown";
}

function countsAsKnownHandledForUnitGap(
  statuses: Map<string, StatusRow>,
  resident: ResidentRow,
  linkedPerson?: PersonRow | null
) {
  if (linkedPerson) {
    return true;
  }

  const residentStatus = resident.status_id ? statuses.get(resident.status_id) : null;
  return Boolean(residentStatus?.counts_as_gap_resolved);
}

function treatmentLabel(state: TreatmentState) {
  if (state === "completed") {
    return "ידוע / טופל";
  }

  if (state === "in_progress") {
    return "בטיפול";
  }

  if (state === "missing") {
    return "נעדר";
  }

  return "לא ידוע";
}

function residentLine(
  statuses: Map<string, StatusRow>,
  resident: ResidentRow,
  linkedPerson?: PersonRow | null
) {
  const number = linkedPerson ? `#${linkedPerson.operational_number}` : "ללא מספר מבצעי";
  const knownStatus =
    linkedPersonStatusLabel(statuses, linkedPerson) ??
    statusLabel(statuses, resident.status_id);

  return `${displayName(resident)} · ${number} · ${knownStatus ?? "מצב לא ידוע"}`;
}

function editableResidentNotes(notes: string | null) {
  return notes?.trim() === "placeholder" ? "" : notes ?? "";
}

function genderLabel(gender: ResidentRow["gender"] | null | undefined) {
  if (gender === "male") {
    return "זכר";
  }

  if (gender === "female") {
    return "נקבה";
  }

  return "לא ידוע";
}

function residentEditVersion(resident: ResidentRow) {
  return [
    resident.id,
    resident.first_name ?? "",
    resident.last_name ?? "",
    resident.gender ?? "unknown",
    resident.linked_person_id ?? "",
    resident.status_id ?? "",
    resident.age ?? "",
    resident.phone ?? "",
    resident.notes ?? ""
  ].join("|");
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
    return `דירה ${unit.unit_number}`;
  }

  if (unit.zone_type === "other" && unit.zone_name) {
    const sequence = unit.zone_sequence ?? unit.unit_number;
    return `${unit.zone_name} ${sequence}`;
  }

  return `${zoneTypeLabel(unit.zone_type)} ${unit.zone_sequence ?? unit.unit_number}`;
}

function isManualSearchUnit(unit: UnitRow) {
  return unit.zone_type === "other" && unit.zone_name === MANUAL_SEARCH_UNIT_ZONE_NAME;
}

function unitPreviousLabel(unit: UnitRow) {
  if (unit.original_unit_label && unit.structure_change_type === "apartment_split") {
    return `פוצלה מדירה ${unit.original_unit_label}`;
  }

  if (unit.previous_unit_label) {
    return `היתה דירה ${unit.previous_unit_label}`;
  }

  return null;
}

function isEmptyPlaceholderResident(statuses: Map<string, StatusRow>, resident: ResidentRow) {
  const residentStatusKey = statusKey(statuses, resident.status_id);
  const notes = resident.notes?.trim() ?? "";

  return (
    resident.unit_id !== null &&
    resident.linked_person_id === null &&
    /^דייר [0-9]+$/.test(resident.first_name ?? "") &&
    !resident.last_name &&
    (resident.gender ?? "unknown") === "unknown" &&
    resident.age === null &&
    !resident.phone &&
    (notes === "" || notes === "placeholder") &&
    residentStatusKey === "missing"
  );
}

function sortUnits(units: UnitRow[]) {
  return [...units].sort((a, b) =>
    a.unit_number.localeCompare(b.unit_number, "he", {
      numeric: true,
      sensitivity: "base"
    })
  );
}

function groupByUnit<T extends { unit_id: string | null }>(rows: T[]) {
  return rows.reduce<Map<string, T[]>>((grouped, row) => {
    if (!row.unit_id) {
      return grouped;
    }

    const unitRows = grouped.get(row.unit_id) ?? [];
    unitRows.push(row);
    grouped.set(row.unit_id, unitRows);
    return grouped;
  }, new Map());
}

function statusOptions(statuses: StatusRow[], category: string) {
  return statuses
    .filter((status) => status.category === category)
    .sort(
      (a, b) =>
        (a.display_order ?? 9999) - (b.display_order ?? 9999) ||
        a.hebrew_label.localeCompare(b.hebrew_label, "he")
    );
}

function hiddenContext(incidentId: string, siteId: string, unitId?: string) {
  return (
    <>
      <input type="hidden" name="incidentId" value={incidentId} />
      <input type="hidden" name="siteId" value={siteId} />
      {unitId ? <input type="hidden" name="unitId" value={unitId} /> : null}
    </>
  );
}

function SearchSiteMobileWorkflow({
  incidentId,
  site,
  floors,
  unitsByFloor,
  searchResultsByUnit,
  summary,
  canEdit
}: {
  incidentId: string;
  site: SiteRecordRow;
  floors: FloorRow[];
  unitsByFloor: Map<string, UnitRow[]>;
  searchResultsByUnit: Map<string, SearchUnitRow>;
  summary: SearchSiteSummaryRow;
  canEdit: boolean;
}) {
  const siteName = siteNameFromRecord(site);
  const sortedFloors = [...floors].sort((a, b) => (b.floor_number ?? 0) - (a.floor_number ?? 0));
  const scannedUnits = summary.clear_count + summary.no_answer_count + summary.casualties_count + summary.completed_count;
  const progressPercent = summary.total_units > 0 ? Math.round((scannedUnits / summary.total_units) * 100) : 0;
  const siteLiveStatus = sharedSearchLiveStatus(summary);
  const floorsById = new Map(floors.map((floor) => [floor.id, floor]));
  const searchEntries = Array.from(unitsByFloor.values()).flatMap((floorUnits) =>
    sortUnits(floorUnits.filter((unit) => unit.is_active)).map((unit) => {
      const result = searchResultsByUnit.get(unit.id);
      const status = result?.search_status ?? "not_visited";
      return {
        unitId: unit.id,
        floorNumber: floorsById.get(unit.floor_id)?.floor_number ?? null,
        unitLabel: unitDisplayLabel(unit),
        familyName: result?.family_name ?? null,
        status
      } satisfies SearchKpiDrilldownEntry;
    })
  );
  const searchEntriesByKpi = {
    scanned: searchEntries.filter((entry) => matchesSearchKpi(entry.status, "scanned")),
    completed: searchEntries.filter((entry) => matchesSearchKpi(entry.status, "completed")),
    no_answer: searchEntries.filter((entry) => matchesSearchKpi(entry.status, "no_answer")),
    casualties: searchEntries.filter((entry) => matchesSearchKpi(entry.status, "casualties"))
  };

  return (
    <main className="page search-site-mobile-page">
      <section className="search-site-hero">
        <div>
          <span className="site-type-badge search-site">אתר סריקה</span>
          <h1>{siteName}</h1>
          <p>{[site.street, site.house_number, site.city].filter(Boolean).join(" ")}</p>
        </div>
        <div className="search-site-hero-status">
          <span className={`search-status-badge search-site-live-${siteLiveStatus.tone}`}>{siteLiveStatus.label}</span>
          <strong>{formatNumber(progressPercent)}%</strong>
          <span>התקדמות סריקה</span>
        </div>
      </section>

      <section className="search-progress-header" aria-label="התקדמות סריקה">
        <div className="search-progress-bar" aria-hidden="true">
          <span style={{ inlineSize: `${progressPercent}%` }} />
        </div>
        <div className="search-progress-metrics">
          <div><span>סה״כ</span><strong>{formatNumber(summary.total_units)}</strong></div>
          <div><span>נסרקו</span><strong>{formatNumber(scannedUnits)}</strong></div>
          <div><span>זוכו</span><strong>{formatNumber(summary.completed_count)}</strong></div>
          <div><span>אין מענה</span><strong>{formatNumber(summary.no_answer_count)}</strong></div>
          <div><span>נפגעים</span><strong>{formatNumber(summary.casualties_count)}</strong></div>
        </div>
      </section>

      <section className="search-site-summary-grid search-clickable-kpis" aria-label="סיכום סריקה">
        <div><span>סה״כ דירות</span><strong>{formatNumber(summary.total_units)}</strong></div>
        <details className="search-kpi-click-card search-kpi-scanned">
          <summary><span>דירות שנסרקו</span><strong>{formatNumber(scannedUnits)}</strong></summary>
          <SearchKpiDrilldown title="דירות שנסרקו" entries={searchEntriesByKpi.scanned} />
        </details>
        <details className="search-kpi-click-card search-kpi-completed">
          <summary><span>דירות זוכו</span><strong>{formatNumber(summary.completed_count)}</strong></summary>
          <SearchKpiDrilldown title="דירות זוכו" entries={searchEntriesByKpi.completed} />
        </details>
        <div><span>טרם נסרקו</span><strong>{formatNumber(summary.not_visited_count)}</strong></div>
        <details className="search-kpi-click-card search-kpi-no-answer">
          <summary><span>אין מענה</span><strong>{formatNumber(summary.no_answer_count)}</strong></summary>
          <SearchKpiDrilldown title="דירות ללא מענה" entries={searchEntriesByKpi.no_answer} />
        </details>
        <details className="search-kpi-click-card search-kpi-casualties">
          <summary><span>דווחו נפגעים</span><strong>{formatNumber(summary.casualties_count)}</strong></summary>
          <SearchKpiDrilldown title="דירות עם דיווח נפגעים" entries={searchEntriesByKpi.casualties} />
        </details>
      </section>
      {!canEdit ? (
        <section className="panel readonly-search-notice">
          <strong>תצוגה בלבד</strong>
          <p>אין הרשאה לעדכן תוצאות סריקה באתר זה או שהאתר סגור.</p>
        </section>
      ) : null}

      <section className="search-floor-list" aria-label="קומות ודירות לסריקה">
        {sortedFloors.length === 0 ? (
          <div className="empty-state">
            <h2>אין קומות להצגה</h2>
            <p className="muted">אתר הסריקה משתמש במבנה הקיים של קומות ודירות.</p>
          </div>
        ) : null}

        {sortedFloors.map((floor, index) => {
          const floorUnits = sortUnits((unitsByFloor.get(floor.id) ?? []).filter((unit) => unit.is_active));
          const floorStatuses = floorUnits.map((unit) => searchResultsByUnit.get(unit.id)?.search_status ?? "not_visited");
          const floorSummary = searchSummaryFromStatuses(floorStatuses);
          const floorStatus = sharedSearchLiveStatus(floorSummary);
          const scanned = searchScannedCount(floorSummary);
          const completed = floorSummary.completed_count;
          const openIssues = floorSummary.casualties_count + floorSummary.no_answer_count;

          return (
            <details className={`search-floor-card search-site-live-${floorStatus.tone}`} key={floor.id} name="search-floor-accordion" open={index === 0}>
              <summary className="search-floor-summary">
                <div>
                  <h2>קומה {floor.floor_number}</h2>
                  <p>{formatNumber(floorUnits.length)} דירות • {formatNumber(scanned)} נסרקו • {formatNumber(completed)} הושלמו • {formatNumber(openIssues)} פתוחות</p>
                </div>
                <span className={`search-status-badge search-site-live-${floorStatus.tone}`}>{floorStatus.label}</span>
                {floorSummary.casualties_count > 0 ? <span className="search-alert-badge">{formatNumber(floorSummary.casualties_count)} עם נפגעים</span> : null}
              </summary>

              <div className="search-unit-list">
                {floorUnits.map((unit) => {
                  const result = searchResultsByUnit.get(unit.id);
                  const status = result?.search_status ?? "not_visited";
                  const tone = searchUnitTone(status);

                  return (
                    <article className={`search-unit-card ${tone}`} key={unit.id}>
                      <div className="search-unit-card-header">
                        <div>
                          <h3>{unitDisplayLabel(unit)}</h3>
                          {isManualSearchUnit(unit) ? <span className="search-manual-unit-badge">נוספה בשטח</span> : null}
                          {result?.family_name ? <p>משפחה: {result.family_name}</p> : <p>משפחה לא צוינה</p>}
                        </div>
                        <span className={`search-unit-status ${tone}`}>{searchUnitStatusLabel(status)}</span>
                      </div>

                      <div className="search-quick-actions" aria-label="פעולות מהירות">
                        {[
                          { value: "clear", label: "תקין" },
                          { value: "no_answer", label: "אין מענה" },
                          { value: "casualties", label: "דווחו נפגעים" }
                        ].map((action) => (
                          <form action={saveSearchUnit} key={action.value}>
                            {hiddenContext(incidentId, site.id, unit.id)}
                            <input type="hidden" name="familyName" value={result?.family_name ?? ""} />
                            <input type="hidden" name="occupantsCount" value={result?.occupants_count ?? ""} />
                            <input type="hidden" name="contactPhone" value={result?.contact_phone ?? ""} />
                            <input type="hidden" name="searchStatus" value={action.value} />
                            {action.value === "casualties" ? <input type="hidden" name="casualtyBody" value="on" /> : null}
                            <input type="hidden" name="notes" value={result?.notes ?? ""} />
                            <button className={`button compact search-quick-button ${searchUnitTone(action.value as SearchUnitStatus)}`} type="submit" disabled={!canEdit}>
                              {action.label}
                            </button>
                          </form>
                        ))}
                        <form action={completeSearchUnitAction}>
                          {hiddenContext(incidentId, site.id, unit.id)}
                          <button className="button compact search-quick-button complete" type="submit" disabled={!canEdit || status === "completed"}>
                            סיום טיפול / מזוכה
                          </button>
                        </form>
                      </div>

                      <div className="search-unit-indicators">
                        {result?.occupants_count !== null && result?.occupants_count !== undefined ? <span>דיירים: {formatNumber(result.occupants_count)}</span> : null}
                        {result?.contact_phone ? <span>טלפון: {result.contact_phone}</span> : null}
                        {result?.casualty_psych ? <span className="warning">נפגע חרדה</span> : null}
                        {result?.casualty_body ? <span className="danger">נפגע גוף</span> : null}
                        {result?.medical_evacuation ? <span className="danger">נדרש פינוי</span> : null}
                        {result?.searched_at ? <span>נסרק: {formatDateTime(result.searched_at)}</span> : null}
                        {result?.completed_at ? <span>הושלם: {formatDateTime(result.completed_at)}</span> : null}
                        {result?.notes ? <span className="search-unit-note-chip">הערות: {result.notes}</span> : null}
                      </div>

                      <details className="search-unit-detail-panel">
                        <summary>פתח טופס מלא</summary>
                        <form action={saveSearchUnit} className="search-unit-form">
                        {hiddenContext(incidentId, site.id, unit.id)}
                        <label>
                          שם משפחה
                          <input className="input" name="familyName" defaultValue={result?.family_name ?? ""} disabled={!canEdit} />
                        </label>
                        <label>
                          מספר דיירים
                          <input className="input" name="occupantsCount" type="number" min="0" inputMode="numeric" defaultValue={result?.occupants_count ?? ""} disabled={!canEdit} />
                        </label>
                        <label>
                          טלפון קשר
                          <input className="input" name="contactPhone" type="tel" defaultValue={result?.contact_phone ?? ""} disabled={!canEdit} />
                        </label>
                        <label>
                          סטטוס סריקה
                          <select className="input" name="searchStatus" defaultValue={status} disabled={!canEdit}>
                            {SEARCH_UNIT_STATUS_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        </label>

                        <div className="search-unit-checks">
                          <label><input type="checkbox" name="casualtyPsych" defaultChecked={Boolean(result?.casualty_psych)} disabled={!canEdit} /> נפגע חרדה</label>
                          <label><input type="checkbox" name="casualtyBody" defaultChecked={Boolean(result?.casualty_body)} disabled={!canEdit} /> נפגע גוף</label>
                          <label><input type="checkbox" name="medicalEvacuation" defaultChecked={Boolean(result?.medical_evacuation)} disabled={!canEdit} /> פינוי רפואי</label>
                        </div>

                        <label className="search-unit-notes">
                          הערות
                          <textarea className="input" name="notes" rows={3} defaultValue={result?.notes ?? ""} disabled={!canEdit} />
                        </label>

                        <div className="search-unit-actions">
                          <button className="button" type="submit" disabled={!canEdit}>שמור סריקה</button>
                        </div>
                      </form>

                      </details>

                      <form action={completeSearchUnitAction} className="search-complete-form">
                        {hiddenContext(incidentId, site.id, unit.id)}
                        <button className="button secondary" type="submit" disabled={!canEdit || status === "completed"}>
                          סיום טיפול / מזוכה
                        </button>
                      </form>
                    </article>
                  );
                })}
              </div>
            </details>
          );
        })}
      </section>
    </main>
  );
}
export default async function SiteDetailsPage({
  params,
  searchParams
}: {
  params: { incidentId: string; siteId: string };
  searchParams?: { q?: string; structureError?: string };
}) {
  const supabase = createClient();
  const residentSearchQuery = String(searchParams?.q ?? "").trim().toLowerCase();

  const { data: siteRecord, error: siteRecordError } = await supabase
    .from("sites")
    .select("id,incident_id,name,city,street,house_number,lifecycle_status,site_type,search_status")
    .eq("incident_id", params.incidentId)
    .eq("id", params.siteId)
    .maybeSingle();

  if (siteRecordError || !siteRecord) {
    notFound();
  }

  const initialSiteRecord = siteRecord as SiteRecordRow;
  const initialSearchSite = isSearchSite({ site_type: initialSiteRecord.site_type });

  if (initialSearchSite) {
    const [
      { data: floorRows, error: floorsError },
      { data: unitRows, error: unitsError },
      { data: searchRows },
      { data: canEditSearch }
    ] = await Promise.all([
      supabase
        .from("floors")
        .select("id,floor_number,units_count,status_id,is_active")
        .eq("incident_id", params.incidentId)
        .eq("site_id", params.siteId)
        .eq("is_active", true)
        .order("floor_number", { ascending: false }),
      supabase
        .from("units")
        .select(
          "id,floor_id,unit_number,zone_name,zone_type,zone_sequence,expected_occupants,family_name,known_people_count,status_id,is_fully_cleared,is_active,inactive_reason,notes,cleared_at,cleared_by,cleared_reason,cleared_potential_delta,cleared_method,reopened_at,reopened_by,previous_unit_label,original_unit_label,structure_change_type"
        )
        .eq("incident_id", params.incidentId)
        .eq("site_id", params.siteId)
        .eq("is_active", true)
        .order("unit_number", { ascending: true }),
      supabase
        .from("site_search_units")
        .select("unit_id,family_name,occupants_count,contact_phone,search_status,casualty_psych,casualty_body,medical_evacuation,notes,searched_at,completed_at")
        .eq("incident_id", params.incidentId)
        .eq("site_id", params.siteId),
      supabase.rpc("can_edit_search_site_data", { p_incident_id: params.incidentId })
    ]);

    if (floorsError || unitsError) {
      throw new Error(floorsError?.message ?? unitsError?.message ?? "לא ניתן לטעון אתר סריקה");
    }

    const searchResultsByUnit = new Map(
      ((searchRows ?? []) as SearchUnitRow[]).map((result) => [result.unit_id, result])
    );
    const searchUnits = (unitRows ?? []) as UnitRow[];
    const liveSearchSummary = liveSearchSummaryFromRows(searchUnits, searchResultsByUnit);
    const searchUnitsByFloor = searchUnits.reduce<Map<string, UnitRow[]>>((grouped, unit) => {
      const floorUnits = grouped.get(unit.floor_id) ?? [];
      floorUnits.push(unit);
      grouped.set(unit.floor_id, floorUnits);
      return grouped;
    }, new Map());

    return (
      <SearchSiteMobileWorkflow
        incidentId={params.incidentId}
        site={initialSiteRecord}
        floors={(floorRows ?? []) as FloorRow[]}
        unitsByFloor={searchUnitsByFloor}
        searchResultsByUnit={searchResultsByUnit}
        summary={liveSearchSummary}
        canEdit={Boolean(canEditSearch && initialSiteRecord.lifecycle_status !== "closed")}
      />
    );
  }

  const { data: summary, error: summaryError } = await supabase
    .from("site_dashboard_summary")
    .select("*")
    .eq("incident_id", params.incidentId)
    .eq("site_id", params.siteId)
    .maybeSingle();

  if (summaryError || !summary) {
    notFound();
  }

  const site = summary as SiteSummaryRow;

  const [
    { data: floorRows, error: floorsError },
    { data: unitRows, error: unitsError },
    { data: allStatusRows, error: statusesError },
    { data: siteLifecycle },
    { data: canControlLifecycle },
    { data: canEditOperational }
  ] = await Promise.all([
    supabase
      .from("floors")
      .select("id,floor_number,units_count,status_id,is_active")
      .eq("incident_id", params.incidentId)
      .eq("site_id", params.siteId)
      .order("floor_number", { ascending: false }),
    supabase
      .from("units")
      .select(
        "id,floor_id,unit_number,zone_name,zone_type,zone_sequence,expected_occupants,family_name,known_people_count,status_id,is_fully_cleared,is_active,inactive_reason,notes,cleared_at,cleared_by,cleared_reason,cleared_potential_delta,cleared_method,reopened_at,reopened_by,previous_unit_label,original_unit_label,structure_change_type"
      )
      .eq("incident_id", params.incidentId)
      .eq("site_id", params.siteId)
      .order("unit_number", { ascending: true }),
    supabase
      .from("status_types")
      .select("id,category,status_key,hebrew_label,name,counts_as_gap_resolved,display_order:sort_order")
      .in("category", ["unit", "resident", "person"])
      .eq("is_active", true)
      .or(`incident_id.is.null,incident_id.eq.${params.incidentId}`)
      .order("sort_order", { ascending: true }),
    supabase
      .from("sites")
      .select("lifecycle_status,site_type,search_status")
      .eq("id", params.siteId)
      .maybeSingle(),
    supabase.rpc("can_control_incident_lifecycle", { p_incident_id: params.incidentId }),
    supabase.rpc("can_edit_operational_data", { p_incident_id: params.incidentId })
  ]);

  const floors = (floorRows ?? []) as FloorRow[];
  const units = (unitRows ?? []) as UnitRow[];
  const siteMetadata = siteLifecycle as SiteLifecycleRow | null;
  const siteLifecycleStatus = siteMetadata?.lifecycle_status ?? "open";
  const siteType = siteMetadata?.site_type ?? site.site_type ?? "rescue_site";
  const searchStatus = siteMetadata?.search_status ?? site.search_status ?? null;
  const searchSite = isSearchSite({ site_type: siteType });
  const canEditThisSite = Boolean(canEditOperational && siteLifecycleStatus !== "closed");
  const unitIds = units.map((unit) => unit.id);

  const [
    { data: residentRows },
    { data: generalResidentRows },
    { data: personRows },
    { data: linkedResidentRows }
  ] =
    await Promise.all([
      unitIds.length > 0
        ? supabase
            .from("unit_residents")
            .select("id,site_id,unit_id,first_name,last_name,gender,age,phone,status_id,linked_person_id,is_active,notes")
            .eq("incident_id", params.incidentId)
            .in("unit_id", unitIds)
            .order("last_name", { ascending: true })
        : Promise.resolve({ data: [] }),
      supabase
        .from("unit_residents")
        .select("id,site_id,unit_id,first_name,last_name,gender,age,phone,status_id,linked_person_id,is_active,notes")
        .eq("incident_id", params.incidentId)
        .eq("site_id", params.siteId)
        .is("unit_id", null)
        .order("last_name", { ascending: true }),
      supabase
        .from("operational_numbers_dashboard")
        .select("id:person_id,site_id,unit_id,resident_id,operational_number,first_name,last_name,current_status_id,current_status_key,current_status_label,latest_report_status_key,latest_report_status_label,is_merged")
        .eq("incident_id", params.incidentId)
        .or(`site_id.eq.${params.siteId},site_id.is.null`)
        .eq("is_merged", false)
        .order("operational_number", { ascending: true }),
      supabase
        .from("unit_residents")
        .select("id,site_id,unit_id,first_name,last_name,gender,age,phone,status_id,linked_person_id,is_active,notes")
        .eq("incident_id", params.incidentId)
        .not("linked_person_id", "is", null)
        .order("last_name", { ascending: true })
    ]);

  const residents = (residentRows ?? []) as ResidentRow[];
  const generalResidents = (generalResidentRows ?? []) as ResidentRow[];
  const dashboardPersons = (personRows ?? []) as PersonRow[];
  const linkedResidents = (linkedResidentRows ?? []) as ResidentRow[];
  const allStatuses = (allStatusRows ?? []) as StatusRow[];
  const statuses = new Map(allStatuses.map((status) => [status.id, status]));
  const unitStatuses = statusOptions(allStatuses, "unit");
  const editableUnitStatuses = unitStatuses.filter((status) => status.status_key !== "fully_cleared");
  const residentStatuses = statusOptions(allStatuses, "resident");

  const unitsByFloor = units.reduce<Map<string, UnitRow[]>>((grouped, unit) => {
    const floorUnits = grouped.get(unit.floor_id) ?? [];
    floorUnits.push(unit);
    grouped.set(unit.floor_id, floorUnits);
    return grouped;
  }, new Map());

  const residentsByUnit = groupByUnit(residents);
  const linkedResidentIds = new Set(
    [...residents, ...generalResidents]
      .filter((resident) => resident.linked_person_id)
      .map((resident) => resident.linked_person_id as string)
  );
  const persons = dashboardPersons.filter(
    (person) =>
      person.site_id === params.siteId ||
      (person.resident_id !== null && linkedResidentIds.has(person.id)) ||
      linkedResidentIds.has(person.id)
  );
  const personsById = new Map(persons.map((person) => [person.id, person]));
  const matchedLinkedResidentsCount = [...linkedResidentIds].filter((personId) => personsById.has(personId)).length;
  const linkedResidentsByPerson = new Map(
    linkedResidents
      .filter((resident) => resident.linked_person_id)
      .map((resident) => [resident.linked_person_id as string, resident])
  );
  const unlinkedPersons = persons.filter(
    (person) => !person.unit_id && !linkedResidentsByPerson.has(person.id)
  );
  const activeGeneralResidents = generalResidents.filter((resident) => resident.is_active);
  const residentMatchesSearch = (resident: ResidentRow) => {
    if (!residentSearchQuery) {
      return true;
    }

    return [
      resident.first_name,
      resident.last_name,
      displayName(resident),
      editableResidentNotes(resident.notes)
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(residentSearchQuery);
  };
  const visibleGeneralResidents = residentSearchQuery
    ? activeGeneralResidents.filter(residentMatchesSearch)
    : activeGeneralResidents;
  const visibleGeneralHandledCount = visibleGeneralResidents.filter((resident) =>
    countsAsKnownHandledForUnitGap(
      statuses,
      resident,
      resident.linked_person_id ? personsById.get(resident.linked_person_id) : null
    )
  ).length;
  const visibleGeneralOpenCount = visibleGeneralResidents.length - visibleGeneralHandledCount;

  return (
    <main className={`page site-detail-page${canEditThisSite ? "" : " permission-readonly"}`}>
      <div className="header">
        <div>
          <h1>תמונת מבנה - אתר {site.site_number}</h1>
          <p className="muted">
            {site.name ? `${site.name} · ` : ""}
            {site.street} {site.house_number}
            {site.city ? ` · ${site.city}` : ""}
          </p>
          <p className="muted">סטטוס אתר: {site.site_status_label ?? "-"}</p>
          <div className="site-header-badges">
            <span className={`site-type-badge ${searchSite ? "search-site" : "rescue-site"}`}>{siteTypeLabel(siteType)}</span>
            {searchSite ? <span className="search-status-badge">{searchStatusLabel(searchStatus)}</span> : null}
          </div>
          {searchParams?.structureError ? (
            <p className="error structure-error-message">{searchParams.structureError}</p>
          ) : null}
        </div>

        <div className="actions">
          {canControlLifecycle ? (
            siteLifecycleStatus === "closed" ? (
              <form action={reopenSite}>
                <input type="hidden" name="incidentId" value={params.incidentId} />
                <input type="hidden" name="siteId" value={params.siteId} />
                <button className="button secondary" type="submit">פתח אתר מחדש</button>
              </form>
            ) : (
              <form action={closeSite}>
                <input type="hidden" name="incidentId" value={params.incidentId} />
                <input type="hidden" name="siteId" value={params.siteId} />
                <button className="button danger" type="submit">סגור אתר</button>
              </form>
            )
          ) : null}
          <Link className="button" href={`/incidents/${params.incidentId}/sites/${params.siteId}/operational-numbers`}>
            מספרים מבצעיים
          </Link>
          <Link className="button secondary" href={`/incidents/${params.incidentId}/sites/${params.siteId}/operational-log`}>
            יומן מבצעי אתר
          </Link>
          <Link className="button secondary" href={`/incidents/${params.incidentId}`}>
            דשבורד אירוע
          </Link>
          <Link className="button secondary" href={`/incidents/${params.incidentId}/sites`}>
            כל האתרים
          </Link>
        </div>
      </div>

      <section className="grid" aria-label="מדדי אתר">
        <div className="metric">
          פוטנציאל ראשוני
          <strong>{formatNumber(site.initial_potential)}</strong>
        </div>
        <div className="metric">
          פוטנציאל מעודכן
          <strong>{formatNumber(site.updated_potential)}</strong>
        </div>
        <div className="metric">
          טופלו / ידועים
          <strong>{formatNumber(site.gap_resolved_count)}</strong>
        </div>
        <div className="metric metric-emphasis">
          פער מבצעי
          <strong>{formatNumber(site.operational_gap)}</strong>
        </div>
        <div className="metric">
          יחידות פעילות
          <strong>{formatNumber(site.total_active_units)}</strong>
        </div>
        <div className="metric">
          דירות פתוחות
          <strong>{formatNumber(site.open_units)}</strong>
        </div>
      </section>

      <section className="building-panel section-spaced" aria-label="תמונת מבנה">
        <div className="building-heading">
          <div>
            <h2>תמונת מבנה</h2>
            <p className="muted">תצוגת פיקוד ידידותית: הדירות מציגות דיירים רשומים בלבד.</p>
            <form className="resident-search-form" action={`/incidents/${params.incidentId}/sites/${params.siteId}`}>
              <input
                className="input"
                name="q"
                defaultValue={searchParams?.q ?? ""}
                placeholder="חיפוש דייר לפי שם פרטי או שם משפחה"
              />
              <button className="button secondary compact" type="submit">חיפוש</button>
              {residentSearchQuery ? (
                <Link className="button neutral compact" href={`/incidents/${params.incidentId}/sites/${params.siteId}`}>
                  נקה
                </Link>
              ) : null}
            </form>
          </div>
          <div className="building-legend" aria-label="מקרא">
            <span className="legend-item">
              <span className="legend-swatch cleared" />
              ידוע / טופל
            </span>
            <span className="legend-item">
              <span className="legend-swatch in-progress" />
              בטיפול
            </span>
            <span className="legend-item">
              <span className="legend-swatch missing" />
              נעדר
            </span>
            <span className="legend-item">
              <span className="legend-swatch unknown" />
              לא ידוע
            </span>
          </div>
        </div>

        {floorsError || unitsError ? (
          <p className="error">
            לא ניתן לטעון את תמונת המבנה: {floorsError?.message ?? unitsError?.message}
          </p>
        ) : null}

        {statusesError || residentStatuses.length === 0 ? (
          <p className="error">
            לא ניתן לטעון סטטוסי דיירים. יש לוודא שהמיגרציות האחרונות הופעלו ושקיימים סטטוסים פעילים מסוג resident.
          </p>
        ) : null}

        {floors.length === 0 ? (
          <p className="muted">לא נמצאו קומות לאתר זה.</p>
        ) : (
          <div className="building-stack">
            {floors.map((floor) => {
              const floorUnits = sortUnits(unitsByFloor.get(floor.id) ?? []);
              const activeFloorUnits = floorUnits.filter((unit) => unit.is_active);
              const visibleFloorUnits = residentSearchQuery
                ? activeFloorUnits.filter((unit) =>
                    (residentsByUnit.get(unit.id) ?? [])
                      .filter((resident) => resident.is_active)
                      .some(residentMatchesSearch)
                  )
                : activeFloorUnits;
              const floorSummary = visibleFloorUnits.reduce(
                (summary, unit) => {
                  const activeResidents = (residentsByUnit.get(unit.id) ?? []).filter(
                    (resident) => resident.is_active
                  );
                  const knownHandledResidents = activeResidents.filter((resident) =>
                    countsAsKnownHandledForUnitGap(
                      statuses,
                      resident,
                      resident.linked_person_id ? personsById.get(resident.linked_person_id) : null
                    )
                  ).length;

                  summary.totalResidents += activeResidents.length;
                  summary.knownHandled += knownHandledResidents;
                  summary.gap += activeResidents.length - knownHandledResidents;
                  return summary;
                },
                { totalResidents: 0, knownHandled: 0, gap: 0 }
              );
              const floorTone =
                floorSummary.gap === 0
                  ? "complete"
                  : floorSummary.knownHandled > 0
                    ? "progress"
                    : "high-gap";
              const apartmentUnits = activeFloorUnits.filter(
                (unit) => unit.zone_type === "apartment" || !unit.zone_type
              );

              return (
                <details
                  className={["floor-card", `floor-${floorTone}`, !floor.is_active ? "inactive" : ""]
                    .filter(Boolean)
                    .join(" ")}
                  key={floor.id}
                  aria-label={`קומה ${floor.floor_number}`}
                  open
                >
                  <summary className="floor-summary-bar">
                    <div className="floor-summary-title">
                      <span className="floor-tone-dot" />
                      <h3>קומה {floor.floor_number}</h3>
                      <span className="muted">{formatNumber(visibleFloorUnits.length)} יחידות</span>
                    </div>
                    <div className="floor-summary-metrics">
                      <span>דיירים <strong>{formatNumber(floorSummary.totalResidents)}</strong></span>
                      <span>ידועים/בטיפול <strong>{formatNumber(floorSummary.knownHandled)}</strong></span>
                      <span>פער <strong>{formatNumber(floorSummary.gap)}</strong></span>
                      <span className="badge">{statusLabel(statuses, floor.status_id) ?? "-"}</span>
                      {!floor.is_active ? <span className="badge inactive">לא פעילה</span> : null}
                    </div>
                  </summary>

                  {canEditThisSite ? (
                    <div className="floor-structure-actions">
                      <details className="structure-action-card">
                        <summary>הוסף דירה</summary>
                        <form action={addApartmentToFloor} className="form-grid">
                          {hiddenContext(params.incidentId, params.siteId)}
                          <input type="hidden" name="floorId" value={floor.id} />
                          <input className="input" name="position" type="number" min="1" placeholder="הוסף אחרי דירה, ריק = סוף קומה" />
                          <input className="input wide" name="reason" placeholder="סיבה / הערה" />
                          <button className="button secondary" type="submit">הוסף דירה</button>
                        </form>
                      </details>

                      <details className="structure-action-card">
                        <summary>פצל דירה</summary>
                        <form action={splitApartmentUnit} className="form-grid">
                          {hiddenContext(params.incidentId, params.siteId)}
                          <select className="input" name="unitId" required>
                            <option value="">בחר דירה לפיצול</option>
                            {apartmentUnits.map((unit) => (
                              <option key={`split-${unit.id}`} value={unit.id}>
                                {unitDisplayLabel(unit)}
                              </option>
                            ))}
                          </select>
                          <input className="input" name="suffixes" defaultValue="א׳,ב׳" placeholder="סיומות, לדוגמה: א׳,ב׳" />
                          <input className="input wide" name="reason" placeholder="סיבה / הערה" />
                          <p className="muted wide">אם קיימים דיירים או מספרים מבצעיים, הם נשארים בדירת הפיצול הראשונה.</p>
                          <button className="button secondary" type="submit" disabled={apartmentUnits.length === 0}>פצל דירה</button>
                        </form>
                      </details>

                      <details className="structure-action-card">
                        <summary>הסר דירה</summary>
                        <form action={removeApartmentUnit} className="form-grid">
                          {hiddenContext(params.incidentId, params.siteId)}
                          <select className="input" name="unitId" required>
                            <option value="">בחר דירה להסרה</option>
                            {apartmentUnits.map((unit) => (
                              <option key={`remove-${unit.id}`} value={unit.id}>
                                {unitDisplayLabel(unit)}
                              </option>
                            ))}
                          </select>
                          <input className="input wide" name="reason" placeholder="סיבה להסרה" required />
                          <p className="muted wide">הסרה תיחסם אם קיימים מספרים מבצעיים או פרטי דייר חשובים.</p>
                          <button className="button secondary danger" type="submit" disabled={apartmentUnits.length === 0}>הסר דירה</button>
                        </form>
                      </details>
                    </div>
                  ) : null}

                  {visibleFloorUnits.length === 0 ? (
                    <p className="muted">אין דירות רשומות בקומה זו.</p>
                  ) : (
                    <div className="apartment-grid">
                      {visibleFloorUnits.map((unit) => {
                        const activeResidents = (residentsByUnit.get(unit.id) ?? []).filter(
                          (resident) => resident.is_active
                        );
                        const knownHandledResidents = activeResidents.filter((resident) =>
                          countsAsKnownHandledForUnitGap(
                            statuses,
                            resident,
                            resident.linked_person_id ? personsById.get(resident.linked_person_id) : null
                          )
                        ).length;
                        const unknownResidents = activeResidents.length - knownHandledResidents;
                        const linkedOperationalNumbers = activeResidents
                          .map((resident) =>
                            resident.linked_person_id ? personsById.get(resident.linked_person_id) : null
                          )
                          .filter(Boolean) as PersonRow[];
                        const unitTone =
                          unit.is_fully_cleared
                            ? "cleared"
                            : unknownResidents === 0
                            ? "cleared"
                            : knownHandledResidents > 0
                              ? "partial"
                              : "high-gap";

                        return (
                          <article
                            className={[
                              "apartment-card",
                              unitTone,
                              unit.is_fully_cleared ? "manually-cleared" : "",
                              !unit.is_active ? "inactive" : ""
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            key={unit.id}
                          >
                            <div className="apartment-card-header">
                              <div>
                                <h4>{unitDisplayLabel(unit)}</h4>
                                {unitPreviousLabel(unit) ? (
                                  <small className="unit-previous-label">{unitPreviousLabel(unit)}</small>
                                ) : null}
                              </div>
                              <div className="apartment-badges">
                                <span className={unit.is_active ? "badge active" : "badge inactive"}>
                                  {unit.is_active ? "פעילה" : "לא פעילה"}
                                </span>
                                {unit.is_fully_cleared ? (
                                  <span className="badge cleared">✓ דירה מזוכת</span>
                                ) : null}
                                <span className={`unit-gap-badge ${unitTone}`}>
                                  פער {formatNumber(unknownResidents)}
                                </span>
                              </div>
                            </div>

                            <dl className="apartment-details">
                              <div>
                                <dt>סה"כ דיירים</dt>
                                <dd>{formatNumber(activeResidents.length)}</dd>
                              </div>
                              <div>
                                <dt>פוטנציאל צפוי</dt>
                                <dd>{formatNumber(unit.expected_occupants ?? unit.known_people_count ?? activeResidents.length)}</dd>
                              </div>
                              <div>
                                <dt>טופלו / ידועים</dt>
                                <dd>{formatNumber(knownHandledResidents)}</dd>
                              </div>
                              <div>
                                <dt>פער</dt>
                                <dd>{formatNumber(unknownResidents)}</dd>
                              </div>
                            </dl>

                            {unit.is_fully_cleared ? (
                              <div className="unit-clearance-banner">
                                <strong>✓ דירה מזוכת</strong>
                                <span>סיבה: {unit.cleared_reason ?? "לא צוינה"}</span>
                                <span>הפחתת פוטנציאל: {formatNumber(unit.cleared_potential_delta ?? 0)}</span>
                              </div>
                            ) : null}

                            <div className="apartment-resident-summary">
                              {activeResidents.length === 0 ? (
                                <span className="muted">אין דיירים רשומים</span>
                              ) : (
                                activeResidents.slice(0, 5).map((resident) => (
                                  <div className="apartment-resident-summary-row" key={`summary-${resident.id}`}>
                                    <strong>{resident.first_name || "שם פרטי לא ידוע"}</strong>
                                    <span>{resident.last_name || "שם משפחה לא ידוע"}</span>
                                    <span>{genderLabel(resident.gender)}</span>
                                    <span>{resident.age === null ? "גיל לא ידוע" : `גיל ${resident.age}`}</span>
                                    {editableResidentNotes(resident.notes) ? (
                                      <em>{editableResidentNotes(resident.notes)}</em>
                                    ) : null}
                                  </div>
                                ))
                              )}
                              {activeResidents.length > 5 ? (
                                <span className="muted">ועוד {formatNumber(activeResidents.length - 5)} דיירים</span>
                              ) : null}
                            </div>

                            <div className="unit-operational-links">
                              <span>מספרים מבצעיים</span>
                              {linkedOperationalNumbers.length === 0 ? (
                                <strong>אין קישורים</strong>
                              ) : (
                                <div>
                                  {linkedOperationalNumbers.map((person) => (
                                    <span className="operational-number-badge" key={person.id}>
                                      #{person.operational_number}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>

                            <div className="resident-section">
                              <h5>דיירים רשומים</h5>
                              {activeResidents.length === 0 ? (
                                <p className="muted">אין דיירים רשומים ליחידה זו.</p>
                              ) : (
                                <ul className="resident-list">
                                  {activeResidents.map((resident) => {
                                    const linkedPerson = resident.linked_person_id
                                      ? personsById.get(resident.linked_person_id)
                                      : null;
                                    const state = treatmentState(statuses, resident, linkedPerson);
                                    const canDeletePlaceholder = isEmptyPlaceholderResident(statuses, resident);
                                    const availablePeople = persons.filter(
                                      (person) =>
                                        !person.is_merged &&
                                        (person.id === resident.linked_person_id ||
                                          !linkedResidentsByPerson.has(person.id))
                                    );
                                    const residentEditKey = residentEditVersion(resident);

                                    return (
                                      <li className={`resident-item treatment-${state}`} key={resident.id}>
                                        <div className="resident-display-row">
                                          <div>
                                            <strong>{residentLine(statuses, resident, linkedPerson)}</strong>
                                            <div className="resident-meta-badges">
                                              {linkedPerson ? (
                                                <span className="operational-number-badge prominent">
                                                  #{linkedPerson.operational_number}
                                                </span>
                                              ) : (
                                                <span className="resident-muted-badge">ללא מספר מבצעי</span>
                                              )}
                                              <span className={`resident-treatment ${state}`}>
                                                {treatmentLabel(state)}
                                              </span>
                                            </div>
                                            <small>
                                              {resident.age === null ? "" : `גיל ${resident.age} · `}
                                              {genderLabel(resident.gender)} ·{" "}
                                              טיפול: {treatmentLabel(state)}
                                              {editableResidentNotes(resident.notes) ? ` · ${editableResidentNotes(resident.notes)}` : ""}
                                            </small>
                                          </div>
                                          <div className="resident-row-actions">
                                            {canDeletePlaceholder && !unit.is_fully_cleared ? (
                                              <CollaborativeLockSection objectType="resident" objectId={resident.id}>
                                              <form action={deleteEmptyPlaceholderResident} className="placeholder-delete-form inline">
                                                {hiddenContext(params.incidentId, params.siteId)}
                                                <input type="hidden" name="residentId" value={resident.id} />
                                                <button className="button compact secondary danger" type="submit">
                                                  מחק דייר ריק
                                                </button>
                                              </form>
                                              </CollaborativeLockSection>
                                            ) : null}
                                          </div>
                                        </div>

                                        {!unit.is_fully_cleared ? (
                                        <details className="resident-edit" key={residentEditKey}>
                                          <summary>עדכון דייר</summary>
                                          <CollaborativeLockSection objectType="resident" objectId={resident.id}>
                                          <form
                                            action={updateUnitResident}
                                            className="form-grid resident-update-form"
                                            key={`edit-form-${residentEditKey}`}
                                          >
                                            {hiddenContext(params.incidentId, params.siteId)}
                                            <input type="hidden" name="residentId" value={resident.id} />
                                            <input className="input" name="firstName" defaultValue={resident.first_name ?? ""} placeholder="שם פרטי" />
                                            <input className="input" name="lastName" defaultValue={resident.last_name ?? ""} placeholder="שם משפחה" />
                                            <select className="input" name="gender" defaultValue={resident.gender ?? "unknown"} aria-label="מין">
                                              <option value="unknown">מין: לא ידוע</option>
                                              <option value="male">מין: זכר</option>
                                              <option value="female">מין: נקבה</option>
                                            </select>
                                            <input className="input" name="age" type="number" min="0" defaultValue={resident.age ?? ""} placeholder="גיל" />
                                            <input className="input" name="phone" defaultValue={resident.phone ?? ""} placeholder="טלפון" />
                                            <input type="hidden" name="statusId" value={resident.status_id ?? ""} />
                                            <input className="input wide" name="notes" defaultValue={editableResidentNotes(resident.notes)} placeholder="הערות" />
                                            <button className="button secondary" type="submit">
                                              שמור דייר
                                            </button>
                                          </form>

                                          <form action={linkExistingPersonToResident} className="resident-link-form wide-link-form">
                                            {hiddenContext(params.incidentId, params.siteId)}
                                            <input type="hidden" name="residentId" value={resident.id} />
                                            <select
                                              className="input"
                                              name="personId"
                                              required
                                              defaultValue={resident.linked_person_id ?? ""}
                                              disabled={availablePeople.length === 0}
                                            >
                                              <option value="">קישור למספר מבצעי</option>
                                              {availablePeople.map((person) => (
                                                <option key={person.id} value={person.id}>
                                                  {personLabel(person, linkedResidentsByPerson.get(person.id))}
                                                </option>
                                              ))}
                                            </select>
                                            <button
                                              className="button secondary"
                                              type="submit"
                                              disabled={availablePeople.length === 0}
                                            >
                                              עדכן מספר מבצעי
                                            </button>
                                          </form>

                                                            </CollaborativeLockSection>
                  </details>
                                        ) : null}
                                      </li>
                                    );
                                  })}
                                </ul>
                              )}
                            </div>

                            {!unit.is_fully_cleared ? (
                            <details className="unit-actions">
                              <summary>פעולות יחידה / אזור</summary>

                              <form action={createUnitResident} className="action-form">
                                {hiddenContext(params.incidentId, params.siteId, unit.id)}
                                <strong>הוסף דייר</strong>
                                <div className="form-grid">
                                  <input className="input" name="firstName" placeholder="שם פרטי" />
                                  <input className="input" name="lastName" placeholder="שם משפחה" />
                                  <input className="input" name="age" type="number" min="0" placeholder="גיל" />
                                  <input className="input" name="phone" placeholder="טלפון" />
                                  <input className="input" name="notes" placeholder="הערה" />
                                </div>
                                <button className="button" type="submit">
                                  הוסף דייר
                                </button>
                              </form>

                              <form action={updateUnitStatus} className="action-form">
                                {hiddenContext(params.incidentId, params.siteId, unit.id)}
                                <strong>עדכן סטטוס יחידה</strong>
                                <div className="form-grid">
                                  <select className="input wide" name="statusId" defaultValue={unit.status_id ?? ""} required>
                                    <option value="">בחר סטטוס יחידה</option>
                                    {editableUnitStatuses.map((status) => (
                                      <option key={status.id} value={status.id}>
                                        {status.hebrew_label}
                                      </option>
                                    ))}
                                  </select>
                                  <input className="input wide" name="notes" placeholder="הערה" />
                                </div>
                                <button className="button secondary" type="submit">
                                  עדכן סטטוס יחידה
                                </button>
                              </form>

                              {canEditThisSite ? (
                                <details className="action-form clearance-dialog">
                                  <summary className="button">סמן דירה כמזוכת</summary>
                                  <form action={clearUnit} className="form-grid">
                                    {hiddenContext(params.incidentId, params.siteId, unit.id)}
                                    <strong className="wide">זיכוי דירה</strong>
                                    <label className="wide">
                                      סיבת זיכוי
                                      <textarea
                                        className="input"
                                        name="clearanceReason"
                                        required
                                        rows={3}
                                        placeholder="לדוגמה: הדירה ריקה / כל המשפחה בחו״ל / נבדקה ונמצאה ריקה"
                                      />
                                    </label>
                                    <button className="button" type="submit" disabled={!unit.is_active}>
                                      אישור
                                    </button>
                                  </form>
                                </details>
                              ) : null}
                            </details>
                            ) : canEditThisSite ? (
                              <form action={reopenClearedUnit} className="action-form unit-reopen-form">
                                {hiddenContext(params.incidentId, params.siteId, unit.id)}
                                <button className="button secondary" type="submit">
                                  החזר דירה לפעילות
                                </button>
                              </form>
                            ) : null}

                            {!unit.is_active && unit.inactive_reason ? (
                              <p className="apartment-note">סיבת השבתה: {unit.inactive_reason}</p>
                            ) : null}
                          </article>
                        );
                      })}
                    </div>
                  )}
                </details>
              );
            })}
          </div>
        )}
      </section>

      <details className="panel section-spaced general-area-panel" open>
        <summary className="floor-summary-bar general-area-summary">
          <div className="floor-summary-title">
            <span className="floor-tone-dot" />
            <div>
              <h2>אזור כללי / שטחים משותפים</h2>
              <p className="muted">לובי, מדרגות, חניה, אורחים או כל אדם שאינו משויך לדירה מסוימת.</p>
            </div>
          </div>
          <div className="floor-summary-metrics">
            <span><strong>{formatNumber(visibleGeneralResidents.length)}</strong> רשומות</span>
            <span><strong>{formatNumber(visibleGeneralOpenCount)}</strong> פתוחה</span>
            <span><strong>{formatNumber(visibleGeneralHandledCount)}</strong> טופלה</span>
          </div>
        </summary>

        {visibleGeneralResidents.length === 0 ? (
          <p className="muted">אין עדיין דיירים או אנשים באזור הכללי.</p>
        ) : (
          <ul className="resident-list general-resident-list">
            {visibleGeneralResidents.map((resident) => {
              const linkedPerson = resident.linked_person_id
                ? personsById.get(resident.linked_person_id)
                : null;
              const state = treatmentState(statuses, resident, linkedPerson);
              const availablePeople = persons.filter(
                (person) =>
                  !person.is_merged &&
                  (person.id === resident.linked_person_id || !linkedResidentsByPerson.has(person.id))
              );
              const residentEditKey = residentEditVersion(resident);

              return (
                <li className={`resident-item treatment-${state}`} key={resident.id}>
                  <div className="resident-display-row">
                  <div>
                    <strong>{residentLine(statuses, resident, linkedPerson)}</strong>
                    <div className="resident-meta-badges">
                      {linkedPerson ? (
                        <span className="operational-number-badge prominent">
                          #{linkedPerson.operational_number}
                        </span>
                      ) : (
                        <span className="resident-muted-badge">ללא מספר מבצעי</span>
                      )}
                      <span className={`resident-treatment ${state}`}>{treatmentLabel(state)}</span>
                    </div>
                    <small>
                      {resident.age === null ? "" : `גיל ${resident.age} · `}
                      {genderLabel(resident.gender)} ·{" "}
                      טיפול: {treatmentLabel(state)}
                      {editableResidentNotes(resident.notes) ? ` · ${editableResidentNotes(resident.notes)}` : ""}
                    </small>
                  </div>
                  <div className="resident-row-actions">
                  </div>
                  </div>

                  <details className="resident-edit" key={residentEditKey}>
                    <summary>עדכון דייר</summary>
                    <CollaborativeLockSection objectType="resident" objectId={resident.id}>
                    <form
                      action={updateUnitResident}
                      className="form-grid resident-update-form"
                      key={`edit-form-${residentEditKey}`}
                    >
                      {hiddenContext(params.incidentId, params.siteId)}
                      <input type="hidden" name="residentId" value={resident.id} />
                      <input className="input" name="firstName" defaultValue={resident.first_name ?? ""} placeholder="שם פרטי" />
                      <input className="input" name="lastName" defaultValue={resident.last_name ?? ""} placeholder="שם משפחה" />
                      <select className="input" name="gender" defaultValue={resident.gender ?? "unknown"} aria-label="מין">
                        <option value="unknown">מין: לא ידוע</option>
                        <option value="male">מין: זכר</option>
                        <option value="female">מין: נקבה</option>
                      </select>
                      <input className="input" name="age" type="number" min="0" defaultValue={resident.age ?? ""} placeholder="גיל" />
                      <input className="input" name="phone" defaultValue={resident.phone ?? ""} placeholder="טלפון" />
                      <input type="hidden" name="statusId" value={resident.status_id ?? ""} />
                      <input className="input wide" name="notes" defaultValue={editableResidentNotes(resident.notes)} placeholder="הערות" />
                      <button className="button secondary" type="submit">
                        שמור דייר
                      </button>
                    </form>

                    <form action={linkExistingPersonToResident} className="resident-link-form wide-link-form">
                      {hiddenContext(params.incidentId, params.siteId)}
                      <input type="hidden" name="residentId" value={resident.id} />
                      <select
                        className="input"
                        name="personId"
                        required
                        defaultValue={resident.linked_person_id ?? ""}
                        disabled={availablePeople.length === 0}
                      >
                        <option value="">קישור למספר מבצעי</option>
                        {availablePeople.map((person) => (
                          <option key={person.id} value={person.id}>
                            {personLabel(person, linkedResidentsByPerson.get(person.id))}
                          </option>
                        ))}
                      </select>
                      <button className="button secondary" type="submit" disabled={availablePeople.length === 0}>
                        עדכן מספר מבצעי
                      </button>
                    </form>

                                      </CollaborativeLockSection>
                  </details>
                </li>
              );
            })}
          </ul>
        )}

        <details className="unit-actions">
          <summary>הוסף אדם לאזור הכללי</summary>
          <form action={createGeneralAreaResident} className="action-form">
            {hiddenContext(params.incidentId, params.siteId)}
            <strong>הוסף דייר / אדם באזור כללי</strong>
            <div className="form-grid">
              <input className="input" name="firstName" placeholder="שם פרטי" />
              <input className="input" name="lastName" placeholder="שם משפחה" />
              <input className="input" name="age" type="number" min="0" placeholder="גיל" />
              <input className="input" name="phone" placeholder="טלפון" />
              <input className="input" name="notes" placeholder="הערה" />
            </div>
            <button className="button" type="submit">
              הוסף לאזור הכללי
            </button>
          </form>
        </details>
      </details>

      <section className="panel section-spaced">
        <h2>אנשים מבצעיים ללא שיוך ברור</h2>
        {unlinkedPersons.length === 0 ? (
          <p className="muted">אין כרטיסי אדם ללא שיוך לדייר או ליחידה.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>מספר מבצעי</th>
                <th>שם</th>
                <th>סטטוס</th>
                <th>פעולה</th>
              </tr>
            </thead>
            <tbody>
              {unlinkedPersons.map((person) => (
                <tr key={person.id}>
                  <td>#{formatNumber(person.operational_number)}</td>
                  <td>{displayName(person)}</td>
                  <td>{statusLabel(statuses, person.current_status_id) ?? "מצב לא ידוע"}</td>
                  <td>
                    <Link
                      className="button compact secondary"
                      href={`/incidents/${params.incidentId}/sites/${params.siteId}/operational-numbers?personId=${person.id}`}
                    >
                      פתח במספרים מבצעיים
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
