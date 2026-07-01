import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatNumber } from "@/lib/format";
import { operationalTeamLabel, operationalTeamRange } from "@/lib/operational-teams";
import { CollaborativeLockSection } from "../../../collaborative-lock";
import { ScreenPresenceIndicator } from "../../../incident-presence";
import {
  cancelOperationalNumber,
  createOperationalNumber,
  createOperationalReport,
  mergeOperationalNumbers,
  openOperationalTeam
} from "./actions";
import { ForcedOperationalNumberForm } from "./forced-operational-number-form";

const defaultTeams = [
  { number: 1, label: operationalTeamLabel(1) },
  { number: 2, label: operationalTeamLabel(2) },
  { number: 3, label: operationalTeamLabel(3) },
  { number: 9, label: operationalTeamLabel(9) }
];

const sourceTypes = ["חפ\"ק", "אוכלוסיה", "משטרה", "מד\"א", "כב\"ה", "פיקוד העורף", "עירייה", "מחלצים", "אחר"];
const confidenceLevels = ["מאומת", "גבוהה", "בינונית", "נמוכה", "לא ידוע"];

type SearchParams = {
  team?: string;
  personId?: string;
};

type SiteSummaryRow = {
  incident_id: string;
  site_id: string;
  site_number: number;
  name: string | null;
  city: string | null;
  street: string;
  house_number: string;
  updated_potential: number;
  active_operational_numbers_count: number;
  unassigned_operational_numbers_count: number;
  operational_gap: number;
};

type OperationalNumberRow = {
  incident_id: string;
  site_id: string;
  person_id: string;
  operational_number: number;
  team_number: number;
  sequence_number: number;
  first_name: string | null;
  last_name: string | null;
  current_status_id: string;
  current_status_label: string | null;
  dashboard_status_label: string | null;
  dashboard_card_color: "blue" | "orange" | "green" | "red" | string | null;
  unit_number: string | null;
  floor_number: number | null;
  resident_id: string | null;
  resident_first_name: string | null;
  resident_last_name: string | null;
  latest_source_type: string | null;
  latest_source_name: string | null;
  latest_grid_cell: string | null;
  latest_confidence_level: string | null;
  latest_notes: string | null;
  latest_reported_at: string | null;
  is_merged: boolean;
  merged_into_person_id: string | null;
  merged_into_operational_number: number | null;
  merged_operational_numbers: number[] | null;
  merged_person_ids: string[] | null;
  latest_merge_at: string | null;
  latest_merge_reason: string | null;
};

type ReportRow = {
  report_id: string;
  person_id: string;
  operational_number: number;
  status_id: string | null;
  status_label: string;
  information_source_type: string;
  information_source_name: string | null;
  source_phone: string | null;
  grid_cell: string | null;
  confidence_level: string;
  notes: string | null;
  reported_at: string;
  created_at: string;
  history_kind?: string | null;
};

type StatusRow = {
  id: string;
  status_key: string;
  hebrew_label: string;
  display_order: number | null;
};

type TeamRow = {
  team_number: number;
  name: string | null;
};

function hiddenContext(incidentId: string, siteId: string) {
  return (
    <>
      <input type="hidden" name="incidentId" value={incidentId} />
      <input type="hidden" name="siteId" value={siteId} />
    </>
  );
}

function displayName(firstName: string | null, lastName: string | null) {
  return [firstName, lastName].filter(Boolean).join(" ") || "שם לא ידוע";
}

function residentName(row: OperationalNumberRow) {
  if (!row.resident_id) {
    return null;
  }

  return displayName(row.resident_first_name, row.resident_last_name);
}

function personName(row: OperationalNumberRow) {
  return [row.first_name, row.last_name].filter(Boolean).join(" ") || null;
}

function operationalNumberTitle(row: OperationalNumberRow) {
  return `#${formatNumber(row.operational_number)} - ${personName(row) ?? residentName(row) ?? "שם לא ידוע"}`;
}

function unitLabel(row: Pick<OperationalNumberRow, "floor_number" | "unit_number">) {
  if (!row.unit_number) {
    return null;
  }

  return row.floor_number === null
    ? `דירה ${row.unit_number}`
    : `קומה ${row.floor_number}, דירה ${row.unit_number}`;
}

function nextNumberForTeam(rows: OperationalNumberRow[], teamNumber: number) {
  const range = operationalTeamRange(teamNumber);
  const maxNumber = rows
    .filter((row) => row.team_number === teamNumber)
    .reduce((max, row) => Math.max(max, row.operational_number), range.min - 1);

  const next = maxNumber + 1;
  return next <= range.max ? next : null;
}

function parseActiveTeam(team: string | undefined) {
  if (!team || team === "all") {
    return null;
  }

  const parsed = Number.parseInt(team, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function teamNumberFromOperationalNumber(operationalNumber: number) {
  if (operationalNumber >= 1101 && operationalNumber <= 1199) return 11;
  if (operationalNumber >= 1201 && operationalNumber <= 1299) return 12;
  if (operationalNumber >= 1301 && operationalNumber <= 1399) return 13;
  return Math.floor(operationalNumber / 100);
}

function numberBelongsToTeam(operationalNumber: number, teamNumber: number) {
  return teamNumberFromOperationalNumber(operationalNumber) === teamNumber;
}

function mergedNumbers(row: Pick<OperationalNumberRow, "merged_operational_numbers">) {
  return row.merged_operational_numbers?.filter((number) => Number.isFinite(number)) ?? [];
}

function isMergedGroup(row: OperationalNumberRow) {
  return !row.is_merged && mergedNumbers(row).length > 0;
}

function teamOptions(rows: OperationalNumberRow[], activeTeam: number | null, teamRows: TeamRow[]) {
  const teamNumbers = new Set(defaultTeams.map((team) => team.number));
  const teamNames = new Map(teamRows.map((team) => [team.team_number, team.name]));

  rows.forEach((row) => teamNumbers.add(row.team_number));
  teamRows.forEach((team) => teamNumbers.add(team.team_number));

  if (activeTeam) {
    teamNumbers.add(activeTeam);
  }

  return Array.from(teamNumbers)
    .sort((a, b) => a - b)
    .map((number) => ({
      number,
      label: operationalTeamLabel(number, teamNames.get(number))
    }));
}

function statusOptions(statuses: StatusRow[]) {
  return [...statuses].sort(
    (a, b) =>
      (a.display_order ?? 9999) - (b.display_order ?? 9999) ||
      a.hebrew_label.localeCompare(b.hebrew_label, "he")
  );
}

export default async function OperationalNumbersPage({
  params,
  searchParams
}: {
  params: { incidentId: string; siteId: string };
  searchParams: SearchParams;
}) {
  const supabase = createClient();
  const activeTeam = parseActiveTeam(searchParams.team);

  const [
    { data: siteSummary, error: siteError },
    { data: numberRows, error: numbersError },
    { data: statusRows, error: statusesError },
    { data: teamRows, error: teamsError },
    { data: canEditOperational }
  ] = await Promise.all([
    supabase
      .from("site_dashboard_summary")
      .select(
        "incident_id,site_id,site_number,name,city,street,house_number,updated_potential,active_operational_numbers_count,unassigned_operational_numbers_count,operational_gap"
      )
      .eq("incident_id", params.incidentId)
      .eq("site_id", params.siteId)
      .maybeSingle(),
    supabase
      .from("operational_numbers_dashboard")
      .select(
        "incident_id,site_id,person_id,operational_number,team_number,sequence_number,first_name,last_name,current_status_id,current_status_label,dashboard_status_label,dashboard_card_color,unit_number,floor_number,resident_id,resident_first_name,resident_last_name,latest_source_type,latest_source_name,latest_grid_cell,latest_confidence_level,latest_notes,latest_reported_at,is_merged,merged_into_person_id,merged_into_operational_number,merged_operational_numbers,merged_person_ids,latest_merge_at,latest_merge_reason"
      )
      .eq("incident_id", params.incidentId)
      .eq("site_id", params.siteId)
      .order("operational_number", { ascending: true }),
    supabase
      .from("status_types")
      .select("id,status_key,hebrew_label,display_order:sort_order")
      .eq("category", "person")
      .eq("is_active", true)
      .or(`incident_id.is.null,incident_id.eq.${params.incidentId}`)
      .order("sort_order", { ascending: true }),
    supabase
      .from("teams")
      .select("team_number,name")
      .eq("incident_id", params.incidentId)
      .eq("is_active", true)
      .order("team_number", { ascending: true }),
    supabase.rpc("can_edit_operational_data", { p_incident_id: params.incidentId })
  ]);

  if (siteError || !siteSummary) {
    notFound();
  }

  const site = siteSummary as SiteSummaryRow;
  const numbers = (numberRows ?? []) as OperationalNumberRow[];
  const personStatuses = statusOptions((statusRows ?? []) as StatusRow[]);
  const teamNames = new Map(((teamRows ?? []) as TeamRow[]).map((team) => [team.team_number, team.name]));
  const teams = teamOptions(numbers, activeTeam, (teamRows ?? []) as TeamRow[]);
  const displayTeamLabel = (teamNumber: number) => operationalTeamLabel(teamNumber, teamNames.get(teamNumber));
  const selectedRow = searchParams.personId ? numbers.find((row) => row.person_id === searchParams.personId) ?? null : null;
  const selectedPerson =
    selectedRow?.is_merged && selectedRow.merged_into_person_id
      ? numbers.find((row) => row.person_id === selectedRow.merged_into_person_id) ?? selectedRow
      : selectedRow;
  const selectedPersonTeam = selectedPerson?.team_number ?? activeTeam;
  const visiblePrimaryNumbers = numbers.filter((row) => !row.is_merged);
  const filteredNumbers = activeTeam
    ? visiblePrimaryNumbers.filter(
        (row) =>
          row.team_number === activeTeam ||
          mergedNumbers(row).some((number) => numberBelongsToTeam(number, activeTeam))
      )
    : visiblePrimaryNumbers;
  const countForTeam = (teamNumber: number) =>
    visiblePrimaryNumbers.filter(
      (row) =>
        row.team_number === teamNumber ||
        (!row.is_merged && mergedNumbers(row).some((number) => numberBelongsToTeam(number, teamNumber)))
    ).length;

  const { data: reportRows, error: reportsError } = selectedPerson
    ? await supabase
        .from("operational_report_history")
        .select(
          "report_id,person_id,operational_number,status_id,status_label,information_source_type,information_source_name,source_phone,grid_cell,confidence_level,notes,reported_at,created_at,history_kind"
        )
        .in("person_id", [selectedPerson.person_id, ...(selectedPerson.merged_person_ids ?? [])])
        .order("reported_at", { ascending: false })
    : { data: [], error: null };

  const reports = (reportRows ?? []) as ReportRow[];
  const selectedHasLinkedOperationalData = selectedPerson
    ? reports.length > 0 ||
      Boolean(
        selectedPerson.resident_id ||
          selectedPerson.unit_number ||
          selectedPerson.latest_reported_at ||
          selectedPerson.latest_source_type ||
          selectedPerson.latest_grid_cell ||
          selectedPerson.latest_notes
      )
    : false;
  const nextNumber = activeTeam ? nextNumberForTeam(numbers, activeTeam) : null;
  const defaultStatusId = personStatuses.find((status) => status.status_key === "missing")?.id ?? "";

  return (
    <main className={`page operational-page${canEditOperational ? "" : " permission-readonly"}`}>
      <div className="header">
        <div>
          <h1>מספרים מבצעיים</h1>
          <p className="muted">
            אתר {site.site_number} · {site.street} {site.house_number}
            {site.city ? ` · ${site.city}` : ""}
          </p>
        </div>

        <div className="actions">
          <Link className="button secondary" href={`/incidents/${params.incidentId}/sites/${params.siteId}`}>
            תמונת מבנה
          </Link>
          <Link className="button secondary" href={`/incidents/${params.incidentId}`}>
            דשבורד אירוע
          </Link>
        </div>
      </div>
      <ScreenPresenceIndicator />

      <section className="grid" aria-label="מדדי מספרים מבצעיים">
        <div className="metric">
          פוטנציאל מעודכן
          <strong>{formatNumber(site.updated_potential)}</strong>
        </div>
        <div className="metric">
          מספרים מבצעיים פעילים
          <strong>{formatNumber(site.active_operational_numbers_count)}</strong>
        </div>
        <div className="metric metric-emphasis">
          פער מבצעי
          <strong>{formatNumber(site.operational_gap)}</strong>
        </div>
        <div className="metric">
          מספרים מבצעיים לא משויכים
          <strong>{formatNumber(site.unassigned_operational_numbers_count)}</strong>
        </div>
      </section>

      <section className="panel section-spaced">
        <div className="operational-toolbar">
          <nav className="team-tabs" aria-label="סינון לפי צוות">
            <Link
              className={activeTeam === null ? "team-tab active" : "team-tab"}
              href={`/incidents/${params.incidentId}/sites/${params.siteId}/operational-numbers?team=all`}
            >
              כל הצוותים
              <span>{formatNumber(visiblePrimaryNumbers.length)}</span>
            </Link>
            {teams.map((team) => (
              <Link
                key={team.number}
                className={team.number === activeTeam ? "team-tab active" : "team-tab"}
                href={`/incidents/${params.incidentId}/sites/${params.siteId}/operational-numbers?team=${team.number}`}
              >
                {team.label}
                <span>{formatNumber(countForTeam(team.number))}</span>
              </Link>
            ))}
          </nav>

          <div className="operational-toolbar-actions">
            <details className="create-number-panel">
              <summary className="button">+ מספר מבצעי חדש</summary>
              <form action={createOperationalNumber} className="action-form">
                {hiddenContext(params.incidentId, params.siteId)}
                <strong>פתיחת מספר מבצעי</strong>
                <div className="form-grid">
                  {activeTeam ? (
                    <>
                      <input type="hidden" name="teamNumber" value={activeTeam} />
                      <div className="readonly-value">צוות: {displayTeamLabel(activeTeam)}</div>
                    </>
                  ) : (
                    <select className="input" name="teamNumber" required>
                      <option value="">בחר צוות</option>
                      {teams.map((team) => (
                        <option key={team.number} value={team.number}>
                          {team.label}
                        </option>
                      ))}
                    </select>
                  )}
                  <div className="readonly-value">
                    {activeTeam
                      ? `המספר הבא: ${nextNumber ? `#${formatNumber(nextNumber)}` : "אין מספר פנוי"}`
                      : "המספר יחושב לפי הצוות"}
                  </div>
                </div>
                <button className="button" type="submit" disabled={(activeTeam !== null && !nextNumber) || !defaultStatusId}>
                  צור מספר מבצעי
                </button>
                {!defaultStatusId ? <p className="error">לא נמצא סטטוס ברירת מחדל נעדר.</p> : null}
              </form>
            </details>

            <ForcedOperationalNumberForm
              incidentId={params.incidentId}
              siteId={params.siteId}
              teams={teams}
              activeTeam={activeTeam}
            />

            <details className="create-number-panel add-team-panel">
              <summary className="button secondary">הוסף צוות</summary>
              <form action={openOperationalTeam} className="action-form">
                {hiddenContext(params.incidentId, params.siteId)}
                <strong>פתיחת צוות נוסף</strong>
                <label>
                  סוג צוות
                  <select className="input" name="teamChoice" defaultValue="11" required>
                    <option value="11">צוות 1ב'</option>
                    <option value="12">צוות 2ב'</option>
                    <option value="13">צוות 3ב'</option>
                    <option value="other">אחר</option>
                  </select>
                </label>
                <label>
                  צוות אחר
                  <input className="input" name="customTeam" placeholder="לדוגמה: צוות 4 או צוות חילוץ חיצוני" />
                </label>
                <p className="muted">צוותים נוספים נפתחים רק מבחירה מפורשת. צוותי ב׳ מקבלים טווחים 1101, 1201, 1301.</p>
                <button className="button secondary" type="submit">
                  פתח צוות
                </button>
              </form>
            </details>
          </div>
        </div>

        {numbersError ? <p className="error">{numbersError.message}</p> : null}
        {teamsError ? <p className="error">{teamsError.message}</p> : null}

        {filteredNumbers.length === 0 ? (
          <p className="muted">{activeTeam ? "אין עדיין מספרים מבצעיים לצוות זה." : "אין עדיין מספרים מבצעיים באתר זה."}</p>
        ) : (
          <div className="operational-card-grid">
            {filteredNumbers.map((row) => {
              const linkedResident = residentName(row);
              const unit = unitLabel(row);
              const cardColor = row.dashboard_card_color ?? "blue";
              const rowMergedNumbers = mergedNumbers(row);
              const mergedGroup = isMergedGroup(row);

              return (
                <Link
                  key={row.person_id}
                  className={`operational-card operational-card-${cardColor}${mergedGroup ? " operational-card-merged" : ""}`}
                  href={`/incidents/${params.incidentId}/sites/${params.siteId}/operational-numbers?team=${row.team_number}&personId=${row.person_id}`}
                >
                  <div className="operational-card-header">
                    <strong>
                      {mergedGroup
                        ? `🔗 מספרים מאוחדים #${formatNumber(row.operational_number)} + ${rowMergedNumbers.map((number) => `#${formatNumber(number)}`).join(" + ")}`
                        : operationalNumberTitle(row)}
                    </strong>
                    <span className="badge">{row.current_status_label ?? row.dashboard_status_label ?? "לא ידוע"}</span>
                  </div>
                  {mergedGroup ? (
                    <div className="merged-card-summary">
                      <span className="merged-burst-badge">✦ מאוחדים ✦</span>
                      <span>{personName(row) ?? residentName(row) ?? "שם לא ידוע"}</span>
                      <span>מספר ראשי: #{formatNumber(row.operational_number)}</span>
                      <span>מספר משני: {rowMergedNumbers.map((number) => `#${formatNumber(number)}`).join(", ")}</span>
                    </div>
                  ) : null}
                  <dl className="operational-card-details">
                    <div>
                      <dt>דייר</dt>
                      <dd>{linkedResident ?? "לא משויך"}</dd>
                    </div>
                    <div>
                      <dt>דירה</dt>
                      <dd>{unit ?? "לא משויך"}</dd>
                    </div>
                    <div>
                      <dt>מקור אחרון</dt>
                      <dd>
                        {[row.latest_source_type, row.latest_source_name].filter(Boolean).join(" · ") || "-"}
                      </dd>
                    </div>
                    <div>
                      <dt>זמן דיווח</dt>
                      <dd>{row.latest_reported_at ? formatDateTime(row.latest_reported_at) : "-"}</dd>
                    </div>
                  </dl>
                  {row.latest_notes ? <p className="operational-note">{row.latest_notes}</p> : null}
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {selectedPerson ? (
        <section className="panel section-spaced detail-panel" key={selectedPerson.person_id}>
          <div className="header compact">
            <div>
              <h2>{operationalNumberTitle(selectedPerson)}</h2>
              <p className="muted">
                {selectedPerson.current_status_label ?? "לא ידוע"}
                {unitLabel(selectedPerson) ? ` · ${unitLabel(selectedPerson)}` : " · ללא דירה משויכת"}
                {selectedPerson.is_merged && selectedPerson.merged_into_operational_number
                  ? ` · אוחד עם #${formatNumber(selectedPerson.merged_into_operational_number)}`
                  : ""}
                {selectedPerson.merged_operational_numbers?.length
                  ? ` · אוחדו: ${selectedPerson.merged_operational_numbers.map((number) => `#${formatNumber(number)}`).join(", ")}`
                  : ""}
              </p>
            </div>
            <Link
              className="button secondary"
              href={`/incidents/${params.incidentId}/sites/${params.siteId}/operational-numbers?team=${selectedPersonTeam ?? "all"}`}
            >
              סגור
            </Link>
          </div>

          <CollaborativeLockSection objectType="operational_number" objectId={selectedPerson.person_id}>
          <div className="detail-grid">
            <div className="detail-actions-stack">
              {selectedPerson.is_merged ? (
                <div className="action-form report-form">
                  <strong>מספר ממוזג</strong>
                  <p className="muted">
                    {selectedPerson.merged_into_operational_number
                      ? `מספר זה אוחד עם #${formatNumber(selectedPerson.merged_into_operational_number)}. דיווחים חדשים נרשמים במספר הראשי.`
                      : "מספר זה אוחד עם מספר מבצעי ראשי. דיווחים חדשים נרשמים במספר הראשי."}
                  </p>
                </div>
              ) : (
                <>
                  {isMergedGroup(selectedPerson) ? (
                    <details className="create-number-panel merged-history-panel" open>
                      <summary className="button secondary">הצג היסטוריה</summary>
                      <div className="merged-card-summary detail">
                        <span className="merged-burst-badge">✦ מאוחדים ✦</span>
                        <span>מספר ראשי: #{formatNumber(selectedPerson.operational_number)}</span>
                        <span>מספרים משניים: {mergedNumbers(selectedPerson).map((number) => `#${formatNumber(number)}`).join(", ")}</span>
                        {selectedPerson.latest_merge_at ? <span>אוחד לאחרונה: {formatDateTime(selectedPerson.latest_merge_at)}</span> : null}
                        {selectedPerson.latest_merge_reason ? <span>סיבה: {selectedPerson.latest_merge_reason}</span> : null}
                      </div>
                    </details>
                  ) : null}

                  <form
                    action={createOperationalReport}
                    className="action-form report-form"
                    key={`report-form-${selectedPerson.person_id}`}
                  >
                    {hiddenContext(params.incidentId, params.siteId)}
                    <input type="hidden" name="personId" value={selectedPerson.person_id} />
                    <input type="hidden" name="teamNumber" value={selectedPersonTeam ?? 1} />
                    <strong>דיווח חדש</strong>
                    {statusesError || personStatuses.length === 0 ? (
                      <p className="error">לא ניתן לטעון סטטוסים לאדם מבצעי.</p>
                    ) : null}
                    <div className="form-grid">
                      <input className="input" name="firstName" defaultValue={selectedPerson.first_name ?? ""} placeholder="שם פרטי" />
                      <input className="input" name="lastName" defaultValue={selectedPerson.last_name ?? ""} placeholder="שם משפחה" />
                      <select className="input" name="statusId" defaultValue={selectedPerson.current_status_id} required>
                        <option value="">בחר סטטוס</option>
                        {personStatuses.map((status) => (
                          <option key={status.id} value={status.id}>
                            {status.hebrew_label}
                          </option>
                        ))}
                      </select>
                      <select className="input" name="sourceType" defaultValue={selectedPerson.latest_source_type ?? DEFAULT_SOURCE_TYPE} required>
                        {sourceTypes.map((sourceType) => (
                          <option key={sourceType} value={sourceType}>
                            {sourceType}
                          </option>
                        ))}
                      </select>
                      <input className="input" name="sourceName" defaultValue={selectedPerson.latest_source_name ?? ""} placeholder="שם מוסר המידע" />
                      <input className="input" name="sourcePhone" placeholder="טלפון מקור" />
                      <input className="input" name="gridCell" defaultValue={selectedPerson.latest_grid_cell ?? ""} placeholder="תא שטח" />
                      <select className="input" name="confidenceLevel" defaultValue={selectedPerson.latest_confidence_level ?? DEFAULT_CONFIDENCE}>
                        {confidenceLevels.map((confidence) => (
                          <option key={confidence} value={confidence}>
                            {confidence}
                          </option>
                        ))}
                      </select>
                      <textarea className="input wide" name="notes" placeholder="הערות" rows={3} />
                    </div>
                    <button className="button" type="submit" disabled={personStatuses.length === 0}>
                      שמור דיווח
                    </button>
                  </form>
                </>
              )}

              {!selectedPerson.is_merged ? (
                <details className="create-number-panel merge-number-panel" key={`merge-${selectedPerson.person_id}`}>
                  <summary className="button secondary">אחד עם מספר מבצעי</summary>
                  <form action={mergeOperationalNumbers} className="action-form report-form">
                    {hiddenContext(params.incidentId, params.siteId)}
                    <input type="hidden" name="sourceOperationalNumber" value={selectedPerson.operational_number} />
                    <strong>מספר {formatNumber(selectedPerson.operational_number)} מתאחד עם מספר מבצעי:</strong>
                    <div className="form-grid">
                      <input
                        className="input"
                        name="targetOperationalNumber"
                        type="number"
                        min="1"
                        placeholder="לדוגמה 104"
                        required
                      />
                      <input className="input" name="reason" placeholder="סיבת איחוד / הערה" />
                    </div>
                    <button className="button secondary" type="submit">
                      אחד מספרים
                    </button>
                  </form>
                </details>
              ) : null}

              {canEditOperational && !selectedPerson.is_merged ? (
                <details className="create-number-panel cancel-number-panel" key={`cancel-${selectedPerson.person_id}`}>
                  <summary className="button danger">בטל מספר מבצעי</summary>
                  <form action={cancelOperationalNumber} className="action-form report-form">
                    {hiddenContext(params.incidentId, params.siteId)}
                    <input type="hidden" name="personId" value={selectedPerson.person_id} />
                    <input type="hidden" name="teamNumber" value={selectedPerson.team_number} />
                    <strong>כיצד תרצה לבטל את המספר המבצעי?</strong>
                    {selectedHasLinkedOperationalData ? (
                      <p className="error">
                        למספר המבצעי קיימים דיווחים ונתונים מקושרים. ביטול המספר יסיר אותו מהחישובים אך ישמור את ההיסטוריה.
                      </p>
                    ) : null}
                    <label>
                      סיבת ביטול
                      <select className="input" name="cancellationReason" defaultValue="created_by_mistake" required>
                        <option value="created_by_mistake">נוצר בטעות</option>
                        <option value="duplicate">כפילות</option>
                        <option value="opened_by_mistake">נפתח בטעות</option>
                        <option value="other">אחר</option>
                      </select>
                    </label>
                    <label>
                      פירוט נוסף אם נבחר אחר
                      <input className="input" name="cancellationReasonOther" placeholder="הזן סיבת ביטול" />
                    </label>
                    <p className="muted">המספר לא יימחק. ההיסטוריה, הדיווחים והלוגים יישמרו לתחקור ובקרה.</p>
                    <button className="button danger" type="submit">
                      אשר ביטול מספר מבצעי
                    </button>
                  </form>
                </details>
              ) : null}
            </div>

            <div>
              <h3>היסטוריית דיווחים</h3>
              {reportsError ? <p className="error">{reportsError.message}</p> : null}
              {reports.length === 0 ? (
                <p className="muted">אין דיווחים למספר זה.</p>
              ) : (
                <ul className="report-history">
                  {reports.map((report) => (
                    <li key={report.report_id}>
                      <strong>
                        #{formatNumber(report.operational_number)} · {personName(selectedPerson) ?? residentName(selectedPerson) ?? "שם לא ידוע"} · {report.information_source_type} · {report.status_label}
                      </strong>
                      <strong>
                        {formatDateTime(report.reported_at)} · {report.information_source_type}
                      </strong>
                      <span>
                        {[report.information_source_name, report.grid_cell ? `תא שטח ${report.grid_cell}` : null, report.status_label]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                      {report.notes ? <p>{report.notes}</p> : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          </CollaborativeLockSection>
        </section>
      ) : null}
    </main>
  );
}

const DEFAULT_SOURCE_TYPE = "חפ\"ק";
const DEFAULT_CONFIDENCE = "לא ידוע";
