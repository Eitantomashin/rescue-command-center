import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatNumber } from "@/lib/format";
import { CollaborativeLockSection } from "../../collaborative-lock";
import {
  clearUnit,
  createGeneralAreaResident,
  createUnitResident,
  deleteEmptyPlaceholderResident,
  linkExistingPersonToResident,
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
};

type ResidentRow = {
  id: string;
  site_id: string;
  unit_id: string | null;
  first_name: string | null;
  last_name: string | null;
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

function residentEditVersion(resident: ResidentRow) {
  return [
    resident.id,
    resident.first_name ?? "",
    resident.last_name ?? "",
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
    return `דירה ${unit.zone_sequence ?? unit.unit_number}`;
  }

  if (unit.zone_type === "other" && unit.zone_name) {
    const sequence = unit.zone_sequence ?? unit.unit_number;
    return `${unit.zone_name} ${sequence}`;
  }

  return `${zoneTypeLabel(unit.zone_type)} ${unit.zone_sequence ?? unit.unit_number}`;
}

function isEmptyPlaceholderResident(statuses: Map<string, StatusRow>, resident: ResidentRow) {
  const residentStatusKey = statusKey(statuses, resident.status_id);
  const notes = resident.notes?.trim() ?? "";

  return (
    resident.unit_id !== null &&
    resident.linked_person_id === null &&
    /^דייר [0-9]+$/.test(resident.first_name ?? "") &&
    !resident.last_name &&
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

export default async function SiteDetailsPage({
  params
}: {
  params: { incidentId: string; siteId: string };
}) {
  const supabase = createClient();

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
        "id,floor_id,unit_number,zone_name,zone_type,zone_sequence,expected_occupants,family_name,known_people_count,status_id,is_fully_cleared,is_active,inactive_reason,notes"
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
    supabase.rpc("can_edit_operational_data", { p_incident_id: params.incidentId })
  ]);

  const floors = (floorRows ?? []) as FloorRow[];
  const units = (unitRows ?? []) as UnitRow[];
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
            .select("id,site_id,unit_id,first_name,last_name,age,phone,status_id,linked_person_id,is_active,notes")
            .eq("incident_id", params.incidentId)
            .in("unit_id", unitIds)
            .order("last_name", { ascending: true })
        : Promise.resolve({ data: [] }),
      supabase
        .from("unit_residents")
        .select("id,site_id,unit_id,first_name,last_name,age,phone,status_id,linked_person_id,is_active,notes")
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
        .select("id,site_id,unit_id,first_name,last_name,age,phone,status_id,linked_person_id,is_active,notes")
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

  return (
    <main className={`page site-detail-page${canEditOperational ? "" : " permission-readonly"}`}>
      <div className="header">
        <div>
          <h1>תמונת מבנה - אתר {site.site_number}</h1>
          <p className="muted">
            {site.name ? `${site.name} · ` : ""}
            {site.street} {site.house_number}
            {site.city ? ` · ${site.city}` : ""}
          </p>
          <p className="muted">סטטוס אתר: {site.site_status_label ?? "-"}</p>
        </div>

        <div className="actions">
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
              const floorSummary = floorUnits.reduce(
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
                      <span className="muted">{formatNumber(floorUnits.length)} יחידות</span>
                    </div>
                    <div className="floor-summary-metrics">
                      <span>דיירים <strong>{formatNumber(floorSummary.totalResidents)}</strong></span>
                      <span>ידועים/בטיפול <strong>{formatNumber(floorSummary.knownHandled)}</strong></span>
                      <span>פער <strong>{formatNumber(floorSummary.gap)}</strong></span>
                      <span className="badge">{statusLabel(statuses, floor.status_id) ?? "-"}</span>
                      {!floor.is_active ? <span className="badge inactive">לא פעילה</span> : null}
                    </div>
                  </summary>

                  {floorUnits.length === 0 ? (
                    <p className="muted">אין דירות רשומות בקומה זו.</p>
                  ) : (
                    <div className="apartment-grid">
                      {floorUnits.map((unit) => {
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
                          unknownResidents === 0
                            ? "cleared"
                            : knownHandledResidents > 0
                              ? "partial"
                              : "high-gap";

                        return (
                          <article
                            className={[
                              "apartment-card",
                              unitTone,
                              !unit.is_active ? "inactive" : ""
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            key={unit.id}
                          >
                            <div className="apartment-card-header">
                              <h4>{unitDisplayLabel(unit)}</h4>
                              <div className="apartment-badges">
                                <span className={unit.is_active ? "badge active" : "badge inactive"}>
                                  {unit.is_active ? "פעילה" : "לא פעילה"}
                                </span>
                                <span className={`unit-gap-badge ${unitTone}`}>
                                  פער {formatNumber(unknownResidents)}
                                </span>
                              </div>
                            </div>

                            <dl className="apartment-details">
                              <div>
                                <dt>שם משפחה</dt>
                                <dd>{unit.family_name ?? "-"}</dd>
                              </div>
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
                                              טיפול: {treatmentLabel(state)}
                                            </small>
                                          </div>
                                          <div className="resident-row-actions">
                                            {canDeletePlaceholder ? (
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
                                      </li>
                                    );
                                  })}
                                </ul>
                              )}
                            </div>

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

                              <form action={clearUnit} className="action-form">
                                {hiddenContext(params.incidentId, params.siteId, unit.id)}
                                <strong>סימון זיכוי</strong>
                                <input className="input" name="overrideReason" placeholder="נימוק חובה אם יש אנשים פתוחים ביחידה" />
                                <button className="button" type="submit" disabled={unit.is_fully_cleared || !unit.is_active}>
                                  סמן יחידה כזוכתה
                                </button>
                              </form>
                            </details>

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

      <section className="panel section-spaced general-area-panel">
        <div className="building-heading">
          <div>
            <h2>אזור כללי / שטחים משותפים</h2>
            <p className="muted">לובי, מדרגות, חניה, אורחים או כל אדם שאינו משויך לדירה מסוימת.</p>
          </div>
          <span className="badge">{formatNumber(activeGeneralResidents.length)} רשומות פעילות</span>
        </div>

        {activeGeneralResidents.length === 0 ? (
          <p className="muted">אין עדיין דיירים או אנשים באזור הכללי.</p>
        ) : (
          <ul className="resident-list general-resident-list">
            {activeGeneralResidents.map((resident) => {
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
                      טיפול: {treatmentLabel(state)}
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
      </section>

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
