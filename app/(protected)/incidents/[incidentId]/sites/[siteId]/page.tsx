import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatNumber } from "@/lib/format";

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
  unit_id: string;
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
  unit_id: string | null;
  operational_number: number;
  first_name: string | null;
  last_name: string | null;
  current_status_id: string;
  is_merged: boolean;
};

type StatusRow = {
  id: string;
  status_key: string;
  hebrew_label: string;
  name: string;
};

type PersonStatusKind = "missing" | "trapped" | "rescued" | "evacuated" | "duplicate" | "other";

function statusLabel(statuses: Map<string, StatusRow>, statusId: string | null) {
  if (!statusId) {
    return "-";
  }

  return statuses.get(statusId)?.hebrew_label ?? statusId;
}

function statusKind(statuses: Map<string, StatusRow>, statusId: string | null, isMerged = false): PersonStatusKind {
  const key = statusId ? statuses.get(statusId)?.status_key : null;

  if (isMerged || key === "duplicate_cancelled") {
    return "duplicate";
  }

  if (key === "missing") {
    return "missing";
  }

  if (key === "trapped_located_not_yet_rescued") {
    return "trapped";
  }

  if (key === "located_outside_site") {
    return "rescued";
  }

  if (
    key === "injured_evacuated_to_ccp" ||
    key === "injured_evacuated_from_site" ||
    key === "fatality_evacuated"
  ) {
    return "evacuated";
  }

  return "other";
}

function personDisplayName(person: Pick<PersonRow | ResidentRow, "first_name" | "last_name">) {
  const name = [person.first_name, person.last_name].filter(Boolean).join(" ");
  return name || "ללא שם";
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

  const [{ data: floorRows, error: floorsError }, { data: unitRows, error: unitsError }] =
    await Promise.all([
      supabase
        .from("floors")
        .select("id,floor_number,units_count,status_id,is_active")
        .eq("incident_id", params.incidentId)
        .eq("site_id", params.siteId)
        .order("floor_number", { ascending: false }),
      supabase
        .from("units")
        .select(
          "id,floor_id,unit_number,family_name,known_people_count,status_id,is_fully_cleared,is_active,inactive_reason,notes"
        )
        .eq("incident_id", params.incidentId)
        .eq("site_id", params.siteId)
        .order("unit_number", { ascending: true })
    ]);

  const floors = (floorRows ?? []) as FloorRow[];
  const units = (unitRows ?? []) as UnitRow[];
  const unitIds = units.map((unit) => unit.id);

  const [{ data: residentRows }, { data: personRows }] =
    unitIds.length > 0
      ? await Promise.all([
          supabase
            .from("unit_residents")
            .select("id,unit_id,first_name,last_name,age,phone,status_id,linked_person_id,is_active,notes")
            .eq("incident_id", params.incidentId)
            .in("unit_id", unitIds)
            .order("last_name", { ascending: true }),
          supabase
            .from("persons")
            .select("id,unit_id,operational_number,first_name,last_name,current_status_id,is_merged")
            .eq("incident_id", params.incidentId)
            .eq("site_id", params.siteId)
            .order("operational_number", { ascending: true })
        ])
      : [{ data: [] }, { data: [] }];

  const residents = (residentRows ?? []) as ResidentRow[];
  const persons = (personRows ?? []) as PersonRow[];
  const statusIds = Array.from(
    new Set(
      [
        ...floors.map((floor) => floor.status_id),
        ...units.map((unit) => unit.status_id),
        ...residents.map((resident) => resident.status_id),
        ...persons.map((person) => person.current_status_id)
      ].filter(Boolean) as string[]
    )
  );

  const { data: statusRows } =
    statusIds.length > 0
      ? await supabase
          .from("status_types")
          .select("id,status_key,hebrew_label,name")
          .in("id", statusIds)
      : { data: [] };

  const statuses = new Map(
    ((statusRows ?? []) as StatusRow[]).map((status) => [status.id, status])
  );

  const activePersons = persons.filter((person) => !person.is_merged);
  const personStatusCounts = activePersons.reduce(
    (counts, person) => {
      const kind = statusKind(statuses, person.current_status_id, person.is_merged);
      if (kind === "missing" || kind === "trapped" || kind === "rescued" || kind === "evacuated") {
        counts[kind] += 1;
      }
      return counts;
    },
    { missing: 0, trapped: 0, rescued: 0, evacuated: 0 }
  );

  const unitsByFloor = units.reduce<Map<string, UnitRow[]>>((grouped, unit) => {
    const floorUnits = grouped.get(unit.floor_id) ?? [];
    floorUnits.push(unit);
    grouped.set(unit.floor_id, floorUnits);
    return grouped;
  }, new Map());

  const residentsByUnit = groupByUnit(residents);
  const personsByUnit = groupByUnit(persons);

  return (
    <main className="page">
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
          פער מבצעי
          <strong>{formatNumber(site.operational_gap)}</strong>
        </div>
        <div className="metric">
          יחידות פעילות
          <strong>{formatNumber(site.total_active_units)}</strong>
        </div>
        <div className="metric">
          זיכוי מלא
          <strong>
            {formatNumber(site.fully_cleared_units)} / {formatNumber(site.total_active_units)}
          </strong>
        </div>
        <div className="metric">
          אנשים פתוחים
          <strong>{formatNumber(site.open_persons)}</strong>
        </div>
      </section>

      <section className="grid section-spaced" aria-label="סיכום אנשים באתר">
        <div className="metric">
          סך אנשים
          <strong>{formatNumber(site.total_persons ?? activePersons.length)}</strong>
        </div>
        <div className="metric">
          נעדרים
          <strong>{formatNumber(personStatusCounts.missing)}</strong>
        </div>
        <div className="metric">
          לכודים
          <strong>{formatNumber(personStatusCounts.trapped)}</strong>
        </div>
        <div className="metric">
          חולצו
          <strong>{formatNumber(personStatusCounts.rescued)}</strong>
        </div>
        <div className="metric">
          פונו
          <strong>{formatNumber(personStatusCounts.evacuated)}</strong>
        </div>
      </section>

      <section className="building-panel section-spaced" aria-label="תמונת מבנה">
        <div className="building-heading">
          <div>
            <h2>תמונת מבנה</h2>
            <p className="muted">קומות, דירות ורשימת דיירים/אנשים מבצעיים לפי הנתונים הקיימים במערכת</p>
          </div>
          <div className="building-legend" aria-label="מקרא">
            <span className="legend-item">
              <span className="legend-swatch open" />
              פתוחה
            </span>
            <span className="legend-item">
              <span className="legend-swatch cleared" />
              זוכתה
            </span>
            <span className="legend-item">
              <span className="legend-swatch inactive" />
              לא פעילה
            </span>
          </div>
        </div>

        {floorsError || unitsError ? (
          <p className="error">
            לא ניתן לטעון את תמונת המבנה: {floorsError?.message ?? unitsError?.message}
          </p>
        ) : null}

        {floors.length === 0 ? (
          <p className="muted">לא נמצאו קומות לאתר זה.</p>
        ) : (
          <div className="building-stack">
            {floors.map((floor) => {
              const floorUnits = sortUnits(unitsByFloor.get(floor.id) ?? []);
              const activeUnits = floorUnits.filter((unit) => unit.is_active).length;
              const clearedUnits = floorUnits.filter((unit) => unit.is_fully_cleared).length;

              return (
                <section
                  className={["floor-card", !floor.is_active ? "inactive" : ""]
                    .filter(Boolean)
                    .join(" ")}
                  key={floor.id}
                  aria-label={`קומה ${floor.floor_number}`}
                >
                  <div className="floor-card-header">
                    <div>
                      <h3>קומה {floor.floor_number}</h3>
                      <p className="muted">
                        {formatNumber(activeUnits)} פעילות מתוך {formatNumber(floorUnits.length)}{" "}
                        דירות · {formatNumber(clearedUnits)} זוכו
                      </p>
                    </div>
                    <div className="floor-status">
                      <span className="badge">{statusLabel(statuses, floor.status_id)}</span>
                      {!floor.is_active ? <span className="badge inactive">לא פעילה</span> : null}
                    </div>
                  </div>

                  {floorUnits.length === 0 ? (
                    <p className="muted">אין דירות רשומות בקומה זו.</p>
                  ) : (
                    <div className="apartment-grid">
                      {floorUnits.map((unit) => {
                        const unitResidents = residentsByUnit.get(unit.id) ?? [];
                        const unitPersons = personsByUnit.get(unit.id) ?? [];
                        const activeResidents = unitResidents.filter((resident) => resident.is_active);
                        const expectedCount = unit.known_people_count;

                        return (
                          <article
                            className={[
                              "apartment-card",
                              unit.is_fully_cleared ? "cleared" : "open",
                              !unit.is_active ? "inactive" : ""
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            key={unit.id}
                          >
                            <div className="apartment-card-header">
                              <h4>דירה {unit.unit_number}</h4>
                              <div className="apartment-badges">
                                <span className={unit.is_fully_cleared ? "badge cleared" : "badge open"}>
                                  {unit.is_fully_cleared ? "זוכתה" : "פתוחה"}
                                </span>
                                <span className={unit.is_active ? "badge active" : "badge inactive"}>
                                  {unit.is_active ? "פעילה" : "לא פעילה"}
                                </span>
                              </div>
                            </div>

                            <dl className="apartment-details">
                              <div>
                                <dt>סטטוס</dt>
                                <dd>{statusLabel(statuses, unit.status_id)}</dd>
                              </div>
                              <div>
                                <dt>שם משפחה</dt>
                                <dd>{unit.family_name ?? "-"}</dd>
                              </div>
                              <div>
                                <dt>רשומים / צפוי</dt>
                                <dd>
                                  {formatNumber(activeResidents.length)} /{" "}
                                  {expectedCount === null ? "-" : formatNumber(expectedCount)}
                                </dd>
                              </div>
                              <div>
                                <dt>כרטיסי אנשים</dt>
                                <dd>{formatNumber(unitPersons.length)}</dd>
                              </div>
                            </dl>

                            <div className="resident-section">
                              <h5>דיירים</h5>
                              {activeResidents.length === 0 ? (
                                <p className="muted">אין דיירים רשומים לדירה זו.</p>
                              ) : (
                                <ul className="resident-list">
                                  {activeResidents.map((resident) => (
                                    <li className="resident-item" key={resident.id}>
                                      <span>{personDisplayName(resident)}</span>
                                      <small>
                                        {resident.age === null ? null : `גיל ${resident.age}`}
                                        {resident.status_id ? ` · ${statusLabel(statuses, resident.status_id)}` : ""}
                                      </small>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>

                            <div className="resident-section">
                              <h5>אנשים מבצעיים</h5>
                              {unitPersons.length === 0 ? (
                                <p className="muted">אין כרטיסי אדם משויכים לדירה זו.</p>
                              ) : (
                                <ul className="resident-list">
                                  {unitPersons.map((person) => {
                                    const kind = statusKind(statuses, person.current_status_id, person.is_merged);

                                    return (
                                      <li className="resident-item person-row" key={person.id}>
                                        <span>
                                          #{formatNumber(person.operational_number)} · {personDisplayName(person)}
                                        </span>
                                        <span className={`person-status ${kind}`}>
                                          {statusLabel(statuses, person.current_status_id)}
                                        </span>
                                      </li>
                                    );
                                  })}
                                </ul>
                              )}
                            </div>

                            {!unit.is_active && unit.inactive_reason ? (
                              <p className="apartment-note">סיבת השבתה: {unit.inactive_reason}</p>
                            ) : null}

                            {unit.notes ? <p className="apartment-note">הערות: {unit.notes}</p> : null}
                          </article>
                        );
                      })}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
