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

type StatusRow = {
  id: string;
  status_key: string;
  hebrew_label: string;
  name: string;
};

function statusLabel(statuses: Map<string, StatusRow>, statusId: string | null) {
  if (!statusId) {
    return "-";
  }

  return statuses.get(statusId)?.hebrew_label ?? statusId;
}

function sortUnits(units: UnitRow[]) {
  return [...units].sort((a, b) =>
    a.unit_number.localeCompare(b.unit_number, "he", {
      numeric: true,
      sensitivity: "base"
    })
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
  const statusIds = Array.from(
    new Set(
      [...floors.map((floor) => floor.status_id), ...units.map((unit) => unit.status_id)].filter(
        Boolean
      ) as string[]
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

  const unitsByFloor = units.reduce<Map<string, UnitRow[]>>((grouped, unit) => {
    const floorUnits = grouped.get(unit.floor_id) ?? [];
    floorUnits.push(unit);
    grouped.set(unit.floor_id, floorUnits);
    return grouped;
  }, new Map());

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

      <section className="building-panel section-spaced" aria-label="תמונת מבנה">
        <div className="building-heading">
          <div>
            <h2>תמונת מבנה</h2>
            <p className="muted">קומות ודירות באתר, לפי נתוני המבנה הקיימים במערכת</p>
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
                      {floorUnits.map((unit) => (
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
                              <dt>מספר ידועים</dt>
                              <dd>
                                {unit.known_people_count === null
                                  ? "-"
                                  : formatNumber(unit.known_people_count)}
                              </dd>
                            </div>
                          </dl>

                          {!unit.is_active && unit.inactive_reason ? (
                            <p className="apartment-note">סיבת השבתה: {unit.inactive_reason}</p>
                          ) : null}

                          {unit.notes ? <p className="apartment-note">הערות: {unit.notes}</p> : null}
                        </article>
                      ))}
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
