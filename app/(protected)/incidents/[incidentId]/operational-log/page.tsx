import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatNumber } from "@/lib/format";
import { createGeneralOperationalNote, updateGeneralOperationalNoteStatus } from "./actions";

export type SearchParams = {
  q?: string;
  eventType?: string;
  siteId?: string;
  importance?: string;
  eventId?: string;
  limit?: string;
};

type EventLogRow = {
  id: string;
  incident_id: string;
  site_id: string | null;
  floor_id: string | null;
  unit_id: string | null;
  person_id: string | null;
  team_id: string | null;
  log_type: string;
  title: string;
  description: string | null;
  importance: "normal" | "important" | "critical" | string;
  reported_at: string;
  source_type: string | null;
  source_name: string | null;
  metadata: Record<string, unknown>;
};

type SiteRow = {
  id: string;
  site_number: number;
  name: string | null;
  city: string | null;
  street: string;
  house_number: string;
};

type FloorRow = {
  id: string;
  floor_number: number;
};

type UnitRow = {
  id: string;
  unit_number: string;
  zone_type: string | null;
  zone_name: string | null;
  zone_sequence: number | null;
};

type PersonRow = {
  id: string;
  operational_number: number;
  first_name: string | null;
  last_name: string | null;
};

type ResidentRow = {
  linked_person_id: string | null;
  first_name: string | null;
  last_name: string | null;
};

type TeamRow = {
  id: string;
  team_number: number;
  name: string | null;
};

const residentLogTypes = new Set([
  "resident_created",
  "resident_updated",
  "resident_deleted",
  "placeholder_resident_deleted",
  "resident_status_changed",
  "person_linked_to_resident"
]);

const operationalNumberLogTypes = new Set([
  "operational_number_created",
  "operational_report_created",
  "operational_numbers_merged",
  "operational_person_name_updated",
  "person_status_changed"
]);

const siteLogTypes = new Set(["site_created", "site_updated", "site_created_from_wizard", "site_structure_generated"]);
const teamLogTypes = new Set(["team_assigned", "team_updated"]);

const eventTypeOptions = [
  ["all", "כל העדכונים"],
  ["residents", "דיירים"],
  ["operational_numbers", "מספרים מבצעיים"],
  ["sites", "אתרים"],
  ["teams", "צוותים"],
  ["system", "מערכת"]
] as const;

const importanceOptions = [
  ["all", "הכל"],
  ["normal", "רגיל"],
  ["important", "חשוב"],
  ["critical", "קריטי"]
] as const;

const phase6gEventTypeOptions = [
  ["all", "הכל"],
  ["general_notes", "הערות כלליות"],
  ["residents", "עדכוני דיירים"],
  ["operational_numbers", "עדכונים מבצעיים"]
] as const;

const phase6gImportanceOptions = [
  ["all", "הכל"],
  ["normal", "רגיל"],
  ["important", "חשוב"],
  ["critical", "קריטי"]
] as const;

const noteSourceOptions = ["חברת חשמל", "משטרה", 'מד"א', "כבאות", "פיקוד העורף", "עירייה", "מפקד אירוע", "מנהל אתר", "צוות חילוץ", "אזרח", "אחר"];

const noteTreatmentStatusOptions = [
  ["open", "פתוח"],
  ["in_progress", "בטיפול"],
  ["closed", "נסגר"]
] as const;

function eventGroup(logType: string) {
  if (logType === "general_operational_note" || logType === "general_operational_note_status_changed") {
    return "general_notes";
  }

  if (residentLogTypes.has(logType)) {
    return "residents";
  }

  if (operationalNumberLogTypes.has(logType)) {
    return "operational_numbers";
  }

  if (siteLogTypes.has(logType) || logType.startsWith("site_")) {
    return "sites";
  }

  if (teamLogTypes.has(logType) || logType.startsWith("team_")) {
    return "teams";
  }

  return "system";
}

function importanceLabel(importance: string) {
  if (importance === "critical") {
    return "קריטי";
  }

  if (importance === "important") {
    return "חשוב";
  }

  return "רגיל";
}

function metadataText(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function metadataNumber(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "number" ? value : null;
}

function displayName(person: Pick<PersonRow | ResidentRow, "first_name" | "last_name">) {
  return [person.first_name, person.last_name].filter(Boolean).join(" ");
}

function zoneTypeLabel(zoneType: string | null | undefined) {
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

function unitLabel(unit?: UnitRow | null, metadata?: Record<string, unknown>) {
  const zoneType = unit?.zone_type ?? metadataText(metadata ?? {}, "zone_type");
  const zoneName = unit?.zone_name ?? metadataText(metadata ?? {}, "zone_name");
  const zoneSequence = unit?.zone_sequence ?? metadataNumber(metadata ?? {}, "zone_sequence");
  const unitNumber = unit?.unit_number ?? metadataText(metadata ?? {}, "unit_number");
  const sequence = zoneSequence ?? unitNumber;

  if (zoneType === "apartment" || (!zoneType && unitNumber)) {
    return `דירה ${sequence ?? unitNumber}`;
  }

  if (zoneType === "other" && zoneName) {
    return `${zoneName} ${sequence ?? ""}`.trim();
  }

  if (zoneType) {
    return `${zoneTypeLabel(zoneType)} ${sequence ?? unitNumber ?? ""}`.trim();
  }

  return unitNumber ? `יחידה ${unitNumber}` : null;
}

function locationLabel(log: EventLogRow, floors: Map<string, FloorRow>, units: Map<string, UnitRow>) {
  const floor = log.floor_id ? floors.get(log.floor_id) : null;
  const unit = log.unit_id ? units.get(log.unit_id) : null;
  const floorNumber = floor?.floor_number ?? metadataNumber(log.metadata, "floor_number");
  const label = unitLabel(unit, log.metadata);

  if (floorNumber !== null && label) {
    return `קומה ${floorNumber}, ${label}`;
  }

  if (floorNumber !== null) {
    return `קומה ${floorNumber}`;
  }

  return label;
}

function operationalNumberLabel(log: EventLogRow, persons: Map<string, PersonRow>) {
  const person = log.person_id ? persons.get(log.person_id) : null;
  const number =
    person?.operational_number ??
    metadataNumber(log.metadata, "operational_number") ??
    metadataNumber(log.metadata, "primary_operational_number") ??
    metadataNumber(log.metadata, "merged_operational_number");

  return number ? `#${number}` : null;
}

function residentName(log: EventLogRow, linkedResidents: Map<string, ResidentRow>, persons: Map<string, PersonRow>) {
  const metadataResident = metadataText(log.metadata, "resident_name");

  if (metadataResident) {
    return metadataResident;
  }

  const linkedResident = log.person_id ? linkedResidents.get(log.person_id) : null;
  const linkedName = linkedResident ? displayName(linkedResident) : "";

  if (linkedName) {
    return linkedName;
  }

  const person = log.person_id ? persons.get(log.person_id) : null;
  const personName = person ? displayName(person) : "";
  return personName || null;
}

function statusChangeLabel(metadata: Record<string, unknown>) {
  const oldStatus =
    metadataText(metadata, "old_status_label") ??
    metadataText(metadata, "old_status") ??
    metadataText(metadata, "status_old");
  const newStatus =
    metadataText(metadata, "new_status_label") ??
    metadataText(metadata, "new_status") ??
    metadataText(metadata, "status_new");

  return oldStatus && newStatus ? `${oldStatus} → ${newStatus}` : null;
}

function mergeLabel(metadata: Record<string, unknown>) {
  const merged = metadataNumber(metadata, "merged_operational_number");
  const primary = metadataNumber(metadata, "primary_operational_number");
  return merged && primary ? `#${merged} אוחד עם #${primary}` : null;
}

function siteLabel(site?: SiteRow | null, metadata?: Record<string, unknown>) {
  const metadataSite = metadataText(metadata ?? {}, "site_name");

  if (metadataSite) {
    return metadataSite;
  }

  if (!site) {
    return null;
  }

  const name = site.name ? `${site.name}, ` : "";
  const city = site.city ? `, ${site.city}` : "";
  return `${name}${site.street} ${site.house_number}${city}`;
}

function detailFields(
  log: EventLogRow,
  sites: Map<string, SiteRow>,
  floors: Map<string, FloorRow>,
  units: Map<string, UnitRow>,
  persons: Map<string, PersonRow>,
  linkedResidents: Map<string, ResidentRow>,
  teams: Map<string, TeamRow>
) {
  const fields: Array<[string, string]> = [];
  const noteTitle = metadataText(log.metadata, "note_title");
  const noteContent = metadataText(log.metadata, "note_content");
  const sourcePhone = metadataText(log.metadata, "source_phone");
  const receivedAt = metadataText(log.metadata, "received_at");
  const treatmentStatus = metadataText(log.metadata, "treatment_status");
  const oldTreatmentStatus = metadataText(log.metadata, "old_treatment_status_label") ?? metadataText(log.metadata, "old_treatment_status");
  const newTreatmentStatus = metadataText(log.metadata, "new_treatment_status_label") ?? metadataText(log.metadata, "new_treatment_status");
  const operationalNumber = operationalNumberLabel(log, persons);
  const resident = residentName(log, linkedResidents, persons);
  const location = locationLabel(log, floors, units);
  const statusChange = statusChangeLabel(log.metadata);
  const merge = mergeLabel(log.metadata);
  const source = metadataText(log.metadata, "information_source_type") ?? log.source_type;
  const sourceName = metadataText(log.metadata, "source_name") ?? log.source_name;
  const gridCell = metadataText(log.metadata, "grid_cell");
  const site = log.site_id ? sites.get(log.site_id) : null;
  const team = log.team_id ? teams.get(log.team_id) : null;
  const siteDisplay = siteLabel(site, log.metadata);
  const operationalNumberDisplay =
    operationalNumber && siteDisplay ? `${operationalNumber} · ${siteDisplay}` : operationalNumber;

  if (operationalNumberDisplay) fields.push(["מספר מבצעי", operationalNumberDisplay]);
  if (resident) fields.push(["דייר / אדם", resident]);
  if (location) fields.push(["מיקום", location]);
  if (statusChange) fields.push(["שינוי סטטוס", statusChange]);
  if (merge) fields.push(["איחוד", merge]);
  if (source) fields.push(["מקור מידע", source]);
  if (sourceName) fields.push(["שם מוסר המידע", sourceName]);
  if (gridCell) fields.push(["תא שטח", gridCell]);
  if (siteDisplay) fields.push(["אתר", siteDisplay]);
  if (team) fields.push(["צוות", team.name ?? `צוות ${team.team_number}`]);

  if (log.log_type === "general_operational_note" || log.log_type === "general_operational_note_status_changed") {
    if (noteTitle) fields.unshift(["כותרת", noteTitle]);
    if (noteContent) fields.push(["תוכן", noteContent]);
    if (oldTreatmentStatus && newTreatmentStatus) fields.push(["שינוי מצב טיפול", `${oldTreatmentStatus} → ${newTreatmentStatus}`]);
    if (sourcePhone) fields.push(["טלפון", sourcePhone]);
    if (receivedAt) fields.push(["זמן קבלת ההודעה", formatDateTime(receivedAt)]);
    if (treatmentStatus) {
      const treatmentLabel =
        noteTreatmentStatusOptions.find(([optionValue]) => optionValue === treatmentStatus)?.[1] ?? treatmentStatus;
      fields.push(["מצב טיפול", treatmentLabel]);
    }
  }

  return fields;
}

function eventSearchText(
  log: EventLogRow,
  sites: Map<string, SiteRow>,
  floors: Map<string, FloorRow>,
  units: Map<string, UnitRow>,
  persons: Map<string, PersonRow>,
  linkedResidents: Map<string, ResidentRow>
) {
  return [
    log.title,
    log.description,
    log.log_type,
    JSON.stringify(log.metadata),
    operationalNumberLabel(log, persons),
    residentName(log, linkedResidents, persons),
    locationLabel(log, floors, units),
    log.site_id ? siteLabel(sites.get(log.site_id), log.metadata) : null
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function queryWith(params: SearchParams, patch: Record<string, string | null | undefined>) {
  const next = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value) {
      next.set(key, value);
    }
  }

  for (const [key, value] of Object.entries(patch)) {
    if (value) {
      next.set(key, value);
    } else {
      next.delete(key);
    }
  }

  const query = next.toString();
  return query ? `?${query}` : "";
}

function datetimeLocalValue(date = new Date()) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 16);
}

function noteGroupId(log: EventLogRow) {
  return metadataText(log.metadata, "note_group_id") ?? metadataText(log.metadata, "original_note_event_log_id") ?? log.id;
}

function noteTreatmentStatus(log: EventLogRow, logs: EventLogRow[]) {
  const groupId = noteGroupId(log);
  const latestStatusUpdate = logs.find((candidate) => {
    if (candidate.log_type !== "general_operational_note_status_changed") {
      return false;
    }

    return (
      metadataText(candidate.metadata, "note_group_id") === groupId ||
      metadataText(candidate.metadata, "original_note_event_log_id") === log.id
    );
  });

  return (
    metadataText(latestStatusUpdate?.metadata ?? {}, "new_treatment_status") ??
    metadataText(log.metadata, "treatment_status") ??
    "open"
  );
}

export default async function OperationalLogPage({
  params,
  searchParams
}: {
  params: { incidentId: string };
  searchParams: SearchParams;
}) {
  return OperationalLogView({
    incidentId: params.incidentId,
    searchParams,
    pageTitle: "יומן מבצעי כללי",
    backHref: `/incidents/${params.incidentId}`,
    backLabel: "חזרה לדשבורד"
  });
}

export async function OperationalLogView({
  incidentId,
  searchParams,
  fixedSiteId,
  pageTitle,
  backHref,
  backLabel
}: {
  incidentId: string;
  searchParams: SearchParams;
  fixedSiteId?: string;
  pageTitle: string;
  backHref: string;
  backLabel: string;
}) {
  const supabase = createClient();
  const limit = Math.min(Math.max(Number.parseInt(searchParams.limit ?? "200", 10) || 200, 50), 1000);
  const eventType = searchParams.eventType ?? "all";
  const importance = searchParams.importance ?? "all";
  const siteId = fixedSiteId ?? searchParams.siteId ?? "all";
  const search = (searchParams.q ?? "").trim().toLowerCase();

  const { data: incident, error: incidentError } = await supabase
    .from("incidents")
    .select("id,name")
    .eq("id", incidentId)
    .maybeSingle();

  if (incidentError || !incident) {
    notFound();
  }

  const { data: siteRows } = await supabase
    .from("sites")
    .select("id,site_number,name,city,street,house_number")
    .eq("incident_id", incidentId)
    .order("site_number", { ascending: true });

  let logQuery = supabase
    .from("event_logs")
    .select(
      "id,incident_id,site_id,floor_id,unit_id,person_id,team_id,log_type,title,description,importance,reported_at,source_type,source_name,metadata",
      { count: "exact" }
    )
    .eq("incident_id", incidentId)
    .order("reported_at", { ascending: false })
    .limit(limit);

  if (importance !== "all") {
    logQuery = logQuery.eq("importance", importance);
  }

  if (siteId !== "all") {
    logQuery = logQuery.eq("site_id", siteId);
  }

  const { data: rawLogs, count: totalMatchingCount } = await logQuery;
  const logs = (rawLogs ?? []) as EventLogRow[];
  const displayLogs = fixedSiteId
    ? logs
    : logs.filter((log, index, allLogs) => {
        if (log.log_type === "general_operational_note_status_changed") {
          const statusUpdateGroupId = metadataText(log.metadata, "status_update_group_id");
          return (
            !statusUpdateGroupId ||
            allLogs.findIndex((candidate) => metadataText(candidate.metadata, "status_update_group_id") === statusUpdateGroupId) === index
          );
        }

        if (log.log_type !== "general_operational_note") {
          return true;
        }

        const noteGroupId = metadataText(log.metadata, "note_group_id");
        return !noteGroupId || allLogs.findIndex((candidate) => metadataText(candidate.metadata, "note_group_id") === noteGroupId) === index;
      });
  const siteMap = new Map(((siteRows ?? []) as SiteRow[]).map((site) => [site.id, site]));
  const floorIds = Array.from(new Set(displayLogs.map((log) => log.floor_id).filter(Boolean) as string[]));
  const unitIds = Array.from(new Set(displayLogs.map((log) => log.unit_id).filter(Boolean) as string[]));
  const personIds = Array.from(new Set(displayLogs.map((log) => log.person_id).filter(Boolean) as string[]));
  const teamIds = Array.from(new Set(displayLogs.map((log) => log.team_id).filter(Boolean) as string[]));
  const todayStart = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  let totalEventsQuery = supabase.from("event_logs").select("id", { count: "exact", head: true }).eq("incident_id", incidentId);
  let todayEventsQuery = supabase
    .from("event_logs")
    .select("id", { count: "exact", head: true })
    .eq("incident_id", incidentId)
    .gte("reported_at", todayStart);
  let residentEventsQuery = supabase
    .from("event_logs")
    .select("id", { count: "exact", head: true })
    .eq("incident_id", incidentId)
    .in("log_type", Array.from(residentLogTypes));
  let operationalEventsQuery = supabase
    .from("event_logs")
    .select("id", { count: "exact", head: true })
    .eq("incident_id", incidentId)
    .in("log_type", Array.from(operationalNumberLogTypes));

  if (fixedSiteId) {
    totalEventsQuery = totalEventsQuery.eq("site_id", fixedSiteId);
    todayEventsQuery = todayEventsQuery.eq("site_id", fixedSiteId);
    residentEventsQuery = residentEventsQuery.eq("site_id", fixedSiteId);
    operationalEventsQuery = operationalEventsQuery.eq("site_id", fixedSiteId);
  }

  const [
    { data: floorRows },
    { data: unitRows },
    { data: personRows },
    { data: linkedResidentRows },
    { data: teamRows },
    { count: totalEvents },
    { count: todayEvents },
    { count: residentEvents },
    { count: operationalEvents }
  ] = await Promise.all([
    floorIds.length
      ? supabase.from("floors").select("id,floor_number").in("id", floorIds)
      : Promise.resolve({ data: [] }),
    unitIds.length
      ? supabase.from("units").select("id,unit_number,zone_type,zone_name,zone_sequence").in("id", unitIds)
      : Promise.resolve({ data: [] }),
    personIds.length
      ? supabase.from("persons").select("id,operational_number,first_name,last_name").in("id", personIds)
      : Promise.resolve({ data: [] }),
    personIds.length
      ? supabase
          .from("unit_residents")
          .select("linked_person_id,first_name,last_name")
          .in("linked_person_id", personIds)
      : Promise.resolve({ data: [] }),
    teamIds.length
      ? supabase.from("teams").select("id,team_number,name").in("id", teamIds)
      : Promise.resolve({ data: [] }),
    totalEventsQuery,
    todayEventsQuery,
    residentEventsQuery,
    operationalEventsQuery
  ]);

  const floorMap = new Map(((floorRows ?? []) as FloorRow[]).map((floor) => [floor.id, floor]));
  const unitMap = new Map(((unitRows ?? []) as UnitRow[]).map((unit) => [unit.id, unit]));
  const personMap = new Map(((personRows ?? []) as PersonRow[]).map((person) => [person.id, person]));
  const teamMap = new Map(((teamRows ?? []) as TeamRow[]).map((team) => [team.id, team]));
  const linkedResidentMap = new Map(
    ((linkedResidentRows ?? []) as ResidentRow[])
      .filter((resident) => resident.linked_person_id)
      .map((resident) => [resident.linked_person_id as string, resident])
  );

  const filteredLogs = displayLogs.filter((log) => {
    if (eventType !== "all" && eventGroup(log.log_type) !== eventType) {
      return false;
    }

    if (search) {
      return eventSearchText(log, siteMap, floorMap, unitMap, personMap, linkedResidentMap).includes(search);
    }

    return true;
  });
  const selectedLog = filteredLogs.find((log) => log.id === searchParams.eventId) ?? filteredLogs[0] ?? null;
  const canLoadMore = (totalMatchingCount ?? 0) > limit;
  const defaultReceivedAt = datetimeLocalValue();

  return (
    <main className="page operational-log-page">
      <div className="header">
        <div>
          <h1>{pageTitle}</h1>
          <p className="muted">{incident.name}</p>
        </div>
        <div className="actions">
          <Link className="button secondary" href={backHref}>
            {backLabel}
          </Link>
          <Link className="button secondary" href={`/incidents/${incidentId}/sites`}>
            אתרים
          </Link>
        </div>
      </div>

      <section className="grid" aria-label="מדדי יומן">
        <div className="metric">
          סך עדכונים
          <strong>{formatNumber(totalEvents ?? 0)}</strong>
        </div>
        <div className="metric">
          עדכוני היום
          <strong>{formatNumber(todayEvents ?? 0)}</strong>
        </div>
        <div className="metric">
          עדכונים מבצעיים
          <strong>{formatNumber(operationalEvents ?? 0)}</strong>
        </div>
        <div className="metric">
          עדכוני דיירים
          <strong>{formatNumber(residentEvents ?? 0)}</strong>
        </div>
      </section>

      <details className="panel general-note-panel section-spaced">
        <summary className="button">➕ הערה כללית</summary>
        <form action={createGeneralOperationalNote} className="general-note-form">
          <input type="hidden" name="incidentId" value={incidentId} />
          {fixedSiteId ? <input type="hidden" name="fixedSiteId" value={fixedSiteId} /> : null}

          <label className="field">
            <span>כותרת *</span>
            <input className="input" name="noteTitle" required />
          </label>

          <label className="field wide">
            <span>תוכן *</span>
            <textarea className="input wide" name="noteContent" rows={4} required />
          </label>

          <label className="field">
            <span>מקור ההודעה *</span>
            <select className="input" name="sourceType" required defaultValue="מפקד אירוע">
              {noteSourceOptions.map((source) => (
                <option key={source} value={source}>
                  {source}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>מוסר ההודעה</span>
            <input className="input" name="sourceName" />
          </label>

          <label className="field">
            <span>טלפון</span>
            <input className="input" name="sourcePhone" />
          </label>

          <label className="field">
            <span>זמן קבלת ההודעה</span>
            <input className="input" type="datetime-local" name="receivedAt" defaultValue={defaultReceivedAt} />
          </label>

          <label className="field">
            <span>חשיבות</span>
            <select className="input" name="importance" defaultValue="normal">
              <option value="normal">רגיל</option>
              <option value="important">חשוב</option>
              <option value="critical">קריטי</option>
            </select>
          </label>

          <label className="field">
            <span>מצב טיפול</span>
            <select className="input" name="treatmentStatus" defaultValue="open">
              {noteTreatmentStatusOptions.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          {fixedSiteId ? (
            <div className="general-note-site-box">ההערה תשויך לאתר הנוכחי בלבד.</div>
          ) : (
            <fieldset className="general-note-site-box">
              <legend>שיוך לאתרים</legend>
              <label className="checkbox-row">
                <input type="checkbox" name="allSites" defaultChecked />
                <span>כל האתרים</span>
              </label>
              <div className="site-checkbox-grid">
                {((siteRows ?? []) as SiteRow[]).map((site) => (
                  <label className="checkbox-row" key={site.id}>
                    <input type="checkbox" name="siteIds" value={site.id} />
                    <span>
                      אתר {site.site_number} - {site.name ?? `${site.street} ${site.house_number}`}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <button className="button" type="submit">
            שמור הערה
          </button>
        </form>
      </details>

      <form className="panel operational-log-filters section-spaced">
        <label className="field">
          <span>חיפוש</span>
          <input className="input" name="q" defaultValue={searchParams.q ?? ""} placeholder="כותרת, תיאור, מספר מבצעי או שם" />
        </label>
        <label className="field">
          <span>סוג עדכון</span>
          <select className="input" name="eventType" defaultValue={eventType}>
            {phase6gEventTypeOptions.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {fixedSiteId ? (
          <label className="field">
            <span>אתר</span>
            <input
              className="input"
              value={siteLabel(siteMap.get(fixedSiteId)) ?? "אתר נבחר"}
              readOnly
            />
          </label>
        ) : (
          <label className="field">
            <span>אתר</span>
            <select className="input" name="siteId" defaultValue={siteId}>
              <option value="all">כל האתרים</option>
              {((siteRows ?? []) as SiteRow[]).map((site) => (
                <option key={site.id} value={site.id}>
                  אתר {site.site_number} - {site.name ?? `${site.street} ${site.house_number}`}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          <span>חשיבות</span>
          <select className="input" name="importance" defaultValue={importance}>
            {phase6gImportanceOptions.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <input type="hidden" name="limit" value={limit} />
        <button className="button" type="submit">
          סנן
        </button>
      </form>

      <section className="operational-log-layout section-spaced">
        <div className="panel operational-log-timeline">
          <div className="header compact">
            <div>
              <h2>ציר זמן</h2>
              <p className="muted">מוצגים {formatNumber(filteredLogs.length)} מתוך {formatNumber(totalMatchingCount ?? logs.length)} עדכונים</p>
            </div>
          </div>

          {filteredLogs.length === 0 ? (
            <p className="muted">לא נמצאו עדכונים לפי הסינון הנוכחי.</p>
          ) : (
            <ol className="timeline-list">
              {filteredLogs.map((log) => {
                const selected = selectedLog?.id === log.id;
                const operationalNumber = operationalNumberLabel(log, personMap);
                const location = locationLabel(log, floorMap, unitMap);
                const site = log.site_id ? siteMap.get(log.site_id) : null;
                const noteSource = metadataText(log.metadata, "information_source_type") ?? log.source_type;
                const noteSourceName = metadataText(log.metadata, "source_name") ?? log.source_name;
                const noteTreatmentStatus = metadataText(log.metadata, "treatment_status");
                const noteTreatmentLabel = noteTreatmentStatus
                  ? noteTreatmentStatusOptions.find(([value]) => value === noteTreatmentStatus)?.[1] ?? noteTreatmentStatus
                  : null;
                const operationalContext =
                  operationalNumber && site && !fixedSiteId
                    ? `${operationalNumber} · אתר ${site.site_number}`
                    : operationalNumber;

                return (
                  <li className={`timeline-row importance-${log.importance} ${selected ? "selected" : ""}`} key={log.id}>
                    <Link href={queryWith(searchParams, { eventId: log.id })}>
                      <time>{formatDateTime(log.reported_at)}</time>
                      <strong>{log.title || log.log_type}</strong>
                      {log.description ? <p>{log.description}</p> : null}
                      <div className="timeline-meta">
                        <span>{importanceLabel(log.importance)}</span>
                        {site ? <span>אתר {site.site_number}</span> : null}
                        {location ? <span>{location}</span> : null}
                        {operationalContext ? <span>{operationalContext}</span> : null}
                        {log.log_type === "general_operational_note" && noteSource ? <span>{noteSource}</span> : null}
                        {log.log_type === "general_operational_note" && noteSourceName ? <span>{noteSourceName}</span> : null}
                        {log.log_type === "general_operational_note" && noteTreatmentLabel ? <span>{noteTreatmentLabel}</span> : null}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ol>
          )}

          {canLoadMore ? (
            <Link className="button secondary load-more-button" href={queryWith(searchParams, { limit: String(limit + 200), eventId: null })}>
              טען עוד
            </Link>
          ) : null}
        </div>

        <aside className={`panel event-detail-panel importance-${selectedLog?.importance ?? "normal"}`}>
          {selectedLog ? (
            <>
              <div className="event-detail-heading">
                <span className={`badge importance-badge importance-${selectedLog.importance}`}>
                  {importanceLabel(selectedLog.importance)}
                </span>
                <h2>{selectedLog.title || selectedLog.log_type}</h2>
                {selectedLog.description ? <p>{selectedLog.description}</p> : null}
                <time>{formatDateTime(selectedLog.reported_at)}</time>
              </div>

              <dl className="event-detail-fields">
                {detailFields(selectedLog, siteMap, floorMap, unitMap, personMap, linkedResidentMap, teamMap).map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>

              {selectedLog.log_type === "general_operational_note" ? (
                <form action={updateGeneralOperationalNoteStatus} className="note-status-form">
                  <input type="hidden" name="incidentId" value={incidentId} />
                  <input type="hidden" name="originalNoteEventLogId" value={selectedLog.id} />
                  {fixedSiteId ? <input type="hidden" name="fixedSiteId" value={fixedSiteId} /> : null}
                  <label className="field">
                    <span>מצב טיפול</span>
                    <select className="input" name="newTreatmentStatus" defaultValue={noteTreatmentStatus(selectedLog, logs)}>
                      {noteTreatmentStatusOptions.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className="button" type="submit">
                    עדכן מצב טיפול
                  </button>
                </form>
              ) : null}

              <details className="technical-metadata">
                <summary>מידע טכני</summary>
                <pre>{JSON.stringify(selectedLog.metadata ?? {}, null, 2)}</pre>
              </details>
            </>
          ) : (
            <p className="muted">בחר עדכון כדי לראות פרטים.</p>
          )}
        </aside>
      </section>
    </main>
  );
}
