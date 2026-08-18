"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useFormState } from "react-dom";
import { OperationalLoadingButton } from "@/app/(protected)/operational-loading-button";
import {
  addMultipleVehicleRosterParticipantsAction,
  cloneVehicleRosterForNextDestinationAction,
  cloneVehicleRosterForReturnAction,
  createExternalPersonAndAddToRosterAction,
  removeVehicleRosterParticipantAction,
  transitionVehicleRosterAction,
  updateVehicleRosterDraftAction,
  updateVehicleRosterParticipantRolesAction,
  type VehicleRosterActionState
} from "../../actions";
import {
  ATTENDANCE_LABELS,
  MOVEMENT_TYPE_LABELS,
  ROSTER_STATUS_LABELS,
  formatDateTimeLocal,
  rosterStatusClass,
  sourceLabel,
  type EligibleRosterPerson,
  type MovementType,
  type RosterStatus,
  type SiteOption,
  type VehicleRosterDetail,
  type VehicleRosterParticipant
} from "../roster-types";

const INITIAL_STATE: VehicleRosterActionState = { error: null, success: null, code: null };
const MOVEMENT_TYPES = Object.keys(MOVEMENT_TYPE_LABELS) as MovementType[];

type ReadinessItem = {
  key: string;
  label: string;
  doneLabel: string;
  done: boolean;
  missingReason: string;
  sectionId: string;
};

type WorkflowStep = {
  key: "draft" | "ready" | "en_route" | "arrived" | "next";
  title: string;
  description: string;
};

const WORKFLOW_STEPS: WorkflowStep[] = [
  { key: "draft", title: "טיוטה", description: "השלמת פרטי נסיעה, רכב וצוות" },
  { key: "ready", title: "מוכן ליציאה", description: "השבצ\"ק מאושר ליציאה" },
  { key: "en_route", title: "יצא לדרך", description: "הנסיעה יצאה בפועל" },
  { key: "arrived", title: "הגיע ליעד", description: "הגעה מאושרת עם זמן בפועל" },
  { key: "next", title: "המשך נסיעה", description: "שכפול לחזרה או ליעד הבא" }
];

function participantKey(participant: VehicleRosterParticipant) {
  if (participant.source_type === "unit_personnel") return `unit_personnel:${participant.unit_personnel_id}`;
  if (participant.source_type === "manual_personnel") return `manual_personnel:${participant.manual_personnel_id}`;
  if (participant.source_type === "external_person") return `external_person:${participant.external_person_id}`;
  return participant.id;
}

function personKey(person: EligibleRosterPerson) {
  return `${person.source_type}:${person.source_id}`;
}

function isSelectable(person: EligibleRosterPerson, currentRosterId: string) {
  const allocatedElsewhere = (person.is_allocated || Boolean(person.allocated_roster_id)) && person.allocated_roster_id !== currentRosterId;
  if (allocatedElsewhere) return false;
  if (person.source_type === "unit_personnel" && person.attendance_status !== "present") return false;
  return true;
}

function allocationNotice(person: EligibleRosterPerson, currentRosterId: string) {
  const allocatedElsewhere = (person.is_allocated || Boolean(person.allocated_roster_id)) && person.allocated_roster_id !== currentRosterId;
  if (!allocatedElsewhere) return null;

  const display = person.allocated_roster_display_number ?? "אחר";
  const status = person.allocated_roster_status ? ROSTER_STATUS_LABELS[person.allocated_roster_status] : null;

  return (
    <div className="vehicle-roster-allocation-notice">
      <strong>כבר משובץ לשבצ"ק {display}</strong>
      {status ? <span>סטטוס: {status}</span> : null}
      <small>ניתן לשבץ מחדש רק לאחר הסרה, ביטול השבצ"ק או הגעה ליעד.</small>
    </div>
  );
}

function readiness(roster: VehicleRosterDetail) {
  const hasDriver = roster.participants.some((participant) => participant.is_driver);
  const hasCommander = roster.participants.some((participant) => participant.is_movement_commander);
  const items: ReadinessItem[] = [
    { key: "movementType", label: "סוג תנועה", doneLabel: "סוג התנועה הוגדר", done: Boolean(roster.movement_type), missingReason: "חסר סוג תנועה", sectionId: "roster-draft-form" },
    { key: "origin", label: "נקודת מוצא", doneLabel: "נקודת המוצא הוגדרה", done: Boolean(roster.origin_text), missingReason: "חסרה נקודת מוצא", sectionId: "roster-draft-form" },
    { key: "destination", label: "יעד נסיעה", doneLabel: "יעד הנסיעה הוגדר", done: Boolean(roster.destination_text), missingReason: "חסר יעד נסיעה", sectionId: "roster-draft-form" },
    { key: "vehicleLicense", label: "מספר רכב / מספר רישוי", doneLabel: "מספר הרכב הושלם", done: Boolean(roster.vehicle_license_plate), missingReason: "חסר מספר רכב", sectionId: "roster-draft-form" },
    { key: "vehicleDescription", label: "זיהוי נוסף לרכב", doneLabel: "זיהוי נוסף לרכב הושלם", done: Boolean(roster.vehicle_description), missingReason: "חסר זיהוי נוסף לרכב", sectionId: "roster-draft-form" },
    { key: "driver", label: "נהג", doneLabel: "נהג שובץ", done: hasDriver, missingReason: "לא שובץ נהג", sectionId: "roster-participants" },
    { key: "commander", label: "מפקד נסיעה", doneLabel: "מפקד נסיעה שובץ", done: hasCommander, missingReason: "לא שובץ מפקד נסיעה", sectionId: "roster-participants" },
    { key: "participants", label: "אנשי צוות", doneLabel: "אנשי הצוות שובצו", done: roster.participants.length > 0, missingReason: "לא שובצו אנשי צוות", sectionId: "roster-participants" }
  ];
  return { items, complete: items.every((item) => item.done) };
}

function sourceBadgeClass(sourceType: string) {
  if (sourceType === "external_person") return "source-external";
  if (sourceType === "manual_personnel") return "source-manual";
  return "source-unit";
}

function localDateTimeValue() {
  const date = new Date();
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function stateFromActionData(state: VehicleRosterActionState) {
  return state.data && typeof state.data === "object" ? state.data as Record<string, unknown> : null;
}

function rosterIdFromData(state: VehicleRosterActionState) {
  const data = stateFromActionData(state);
  if (!data || typeof data.roster_id !== "string") return null;
  return data.roster_id;
}

function conflictMessage(state: VehicleRosterActionState, incidentId: string) {
  const data = stateFromActionData(state);
  if (!data || data.success !== false) return null;
  const code = typeof data.code === "string" ? data.code : state.code;

  if (code === "vehicle_conflict") {
    const plate = typeof data.vehicle_license_plate === "string" ? data.vehicle_license_plate : "הרכב";
    const display = typeof data.conflicting_roster_display_number === "string" ? data.conflicting_roster_display_number : "פעיל אחר";
    const id = typeof data.conflicting_roster_id === "string" ? data.conflicting_roster_id : null;
    return (
      <div className="vehicle-roster-conflict">
        <strong>לא ניתן לשבץ את {plate}.</strong>
        <span>הרכב משויך כעת לשבצ"ק {display}.</span>
        {id ? <Link href={`/incidents/${incidentId}/personnel/rosters/${id}`}>פתח שבצ"ק מתנגש</Link> : null}
      </div>
    );
  }

  if (code === "person_conflict") {
    const person = typeof data.person_name === "string" ? data.person_name : "איש צוות";
    const display = typeof data.conflicting_roster_display_number === "string" ? data.conflicting_roster_display_number : "פעיל אחר";
    const id = typeof data.conflicting_roster_id === "string" ? data.conflicting_roster_id : null;
    return (
      <div className="vehicle-roster-conflict">
        <strong>לא ניתן לשבץ את {person}.</strong>
        <span>האדם משויך כעת לשבצ"ק {display}.</span>
        {id ? <Link href={`/incidents/${incidentId}/personnel/rosters/${id}`}>פתח שבצ"ק מתנגש</Link> : null}
      </div>
    );
  }

  if (code === "missing_required_fields") {
    const labels: Record<string, string> = {
      vehicle_license_plate: "מספר רכב / מספר רישוי",
      vehicle_description: "זיהוי נוסף לרכב",
      origin: "נקודת מוצא",
      destination: "יעד נסיעה",
      participants: "משתתפים",
      driver: "נהג",
      movement_commander: "מפקד נסיעה"
    };
    const missing = Array.isArray(data.missing) ? data.missing.map(String) : [];
    return (
      <div className="vehicle-roster-conflict">
        <strong>השבצ"ק עדיין לא מוכן ליציאה.</strong>
        <span>חסרים: {missing.map((item) => labels[item] ?? item).join(", ")}</span>
      </div>
    );
  }

  if (code === "source_roster_not_arrived") {
    return <div className="vehicle-roster-conflict"><strong>ניתן ליצור נסיעת המשך רק לאחר שהשבצ"ק הגיע ליעד.</strong></div>;
  }

  if (code === "source_roster_missing_destination") {
    return <div className="vehicle-roster-conflict"><strong>לא ניתן ליצור נסיעת המשך ללא יעד בשבצ"ק המקור.</strong></div>;
  }

  return null;
}

export function VehicleRosterDetailClient({
  incidentId,
  roster,
  eligiblePeople,
  sites,
  canEditPersonnel
}: {
  incidentId: string;
  roster: VehicleRosterDetail;
  eligiblePeople: EligibleRosterPerson[];
  sites: SiteOption[];
  canEditPersonnel: boolean;
}) {
  const [draftState, draftAction] = useFormState(updateVehicleRosterDraftAction, INITIAL_STATE);
  const [addState, addAction] = useFormState(addMultipleVehicleRosterParticipantsAction, INITIAL_STATE);
  const [externalState, externalAction] = useFormState(createExternalPersonAndAddToRosterAction, INITIAL_STATE);
  const [transitionState, transitionAction] = useFormState(transitionVehicleRosterAction, INITIAL_STATE);
  const [cloneReturnState, cloneReturnAction] = useFormState(cloneVehicleRosterForReturnAction, INITIAL_STATE);
  const [cloneNextState, cloneNextAction] = useFormState(cloneVehicleRosterForNextDestinationAction, INITIAL_STATE);
  const [personQuery, setPersonQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [teamFilter, setTeamFilter] = useState("all");
  const [externalOpen, setExternalOpen] = useState(false);
  const [externalFormKey, setExternalFormKey] = useState(0);
  const [nowValue, setNowValue] = useState(localDateTimeValue);
  const isDraft = roster.status === "draft";
  const isReady = roster.status === "ready";
  const isCancelled = roster.status === "cancelled";
  const canMutateDraft = canEditPersonnel && isDraft;
  const readinessState = readiness(roster);
  const missingItems = readinessState.items.filter((item) => !item.done);

  useEffect(() => {
    const interval = window.setInterval(() => setNowValue(localDateTimeValue()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const nextRosterId = rosterIdFromData(cloneReturnState) ?? rosterIdFromData(cloneNextState);
    if (nextRosterId) {
      window.location.assign(`/incidents/${incidentId}/personnel/rosters/${nextRosterId}`);
    }
  }, [cloneReturnState.data, cloneNextState.data, incidentId]);

  useEffect(() => {
    if (externalState.success) {
      setExternalOpen(false);
      setExternalFormKey((key) => key + 1);
    }
  }, [externalState.success]);

  const existingParticipantKeys = useMemo(() => new Set(roster.participants.map(participantKey)), [roster.participants]);
  const teams = useMemo(() => {
    const values = new Set<string>();
    eligiblePeople.forEach((person) => {
      if (person.organic_team) values.add(person.organic_team);
      if (person.ad_hoc_teams) values.add(person.ad_hoc_teams);
    });
    return Array.from(values).sort((a, b) => a.localeCompare(b, "he"));
  }, [eligiblePeople]);

  const filteredPeople = useMemo(() => {
    const normalized = personQuery.trim().toLowerCase();
    return eligiblePeople.filter((person) => {
      if (sourceFilter !== "all" && person.source_type !== sourceFilter) return false;
      if (teamFilter !== "all" && person.organic_team !== teamFilter && person.ad_hoc_teams !== teamFilter) return false;
      if (!normalized) return true;
      return [person.display_name, person.mobile_phone, person.organic_team, person.ad_hoc_teams, person.allocated_roster_display_number]
        .join(" ")
        .toLowerCase()
        .includes(normalized);
    });
  }, [eligiblePeople, personQuery, sourceFilter, teamFilter]);

  return (
    <div className="vehicle-roster-page vehicle-roster-detail" dir="rtl">
      <nav className="personnel-module-tabs" aria-label="ניווט כוח אדם">
        <Link href={`/incidents/${incidentId}/personnel`}>מצבת כוח אדם</Link>
        <Link className="active" href={`/incidents/${incidentId}/personnel/rosters`}>שבצ"קים ותנועת רכבים</Link>
      </nav>

      <header className="vehicle-roster-detail-header">
        <div className="vehicle-roster-header-actions">
          <Link className="button secondary" href={"/incidents/" + incidentId + "/personnel/rosters"}>חזרה לרשימה</Link>
          <Link className="button secondary" href={"/incidents/" + incidentId + "/personnel/rosters/" + roster.id + "/print"}>הדפס שבצ"ק</Link>
        </div>
        <div>
          <p className="eyebrow">שבצ"ק</p>
          <h1>שבצ"ק {roster.display_number}</h1>
          <p>{MOVEMENT_TYPE_LABELS[roster.movement_type]} · {roster.vehicle_license_plate || "ללא רכב"} · {roster.vehicle_description || "ללא זיהוי נוסף"}</p>
        </div>
        <span className={`vehicle-roster-status ${rosterStatusClass(roster.status)}`}>{ROSTER_STATUS_LABELS[roster.status]}</span>
      </header>

      <section className={`vehicle-roster-workflow-panel ${isCancelled ? "is-cancelled" : ""}`} aria-labelledby="vehicle-roster-workflow-title">
        <div className="vehicle-roster-section-heading">
          <div>
            <p className="eyebrow">זרימת עבודה מבצעית</p>
            <h2 id="vehicle-roster-workflow-title">תהליך השבצ"ק</h2>
          </div>
          {isCancelled ? <span className="vehicle-roster-status status-cancelled">שבצ"ק בוטל</span> : null}
        </div>
        <div className="vehicle-roster-workflow" role="list" aria-label="שלבי שבצק">
          {WORKFLOW_STEPS.map((step, index) => (
            <WorkflowStage
              key={step.key}
              step={step}
              index={index}
              roster={roster}
              canEditPersonnel={canEditPersonnel}
              readinessComplete={readinessState.complete}
              transitionAction={transitionAction}
              cloneReturnAction={cloneReturnAction}
              cloneNextAction={cloneNextAction}
              nowValue={nowValue}
            />
          ))}
        </div>
        {canEditPersonnel && !isCancelled ? (
          <div className="vehicle-roster-secondary-actions">
            {isDraft ? <TransitionInlineForm incidentId={incidentId} rosterId={roster.id} targetStatus="cancelled" label={'בטל שבצ"ק'} loading="מבטל..." action={transitionAction} requiresReason tone="danger" /> : null}
            {isReady ? (
              <>
                <TransitionInlineForm incidentId={incidentId} rosterId={roster.id} targetStatus="draft" label="החזר לטיוטה" loading="מחזיר..." action={transitionAction} tone="secondary" />
                <TransitionInlineForm incidentId={incidentId} rosterId={roster.id} targetStatus="cancelled" label={'בטל שבצ"ק'} loading="מבטל..." action={transitionAction} requiresReason tone="danger" />
              </>
            ) : null}
          </div>
        ) : null}
        {conflictMessage(transitionState, incidentId)}
        {conflictMessage(cloneReturnState, incidentId)}
        {conflictMessage(cloneNextState, incidentId)}
        <ActionFeedback state={transitionState} />
        <ActionFeedback state={cloneReturnState} />
        <ActionFeedback state={cloneNextState} />
      </section>

      <section className="vehicle-roster-detail-grid">
        <article className="vehicle-roster-panel">
          <h2>פרטי הנסיעה והרכב</h2>
          <dl className="vehicle-roster-meta-grid">
            <div><dt>מוצא</dt><dd>{roster.origin_text || "-"}</dd></div>
            <div><dt>יעד</dt><dd>{roster.destination_text || "-"}</dd></div>
            <div><dt>מתוכנן</dt><dd>{formatDateTimeLocal(roster.planned_departure_at)}</dd></div>
            <div><dt>יציאה בפועל</dt><dd>{formatDateTimeLocal(roster.actual_departure_at)}</dd></div>
            <div><dt>הגעה בפועל</dt><dd>{formatDateTimeLocal(roster.actual_arrival_at)}</dd></div>
            <div><dt>סוג רכב</dt><dd>{roster.vehicle_type || "-"}</dd></div>
          </dl>
          {roster.source_roster_id ? <p className="vehicle-roster-clone-note">נסיעת חזור/המשך שנוצרה משבצ"ק מקור.</p> : null}
        </article>

        <article className={`vehicle-roster-panel readiness-panel ${readinessState.complete ? "ready" : "missing"}`}>
          <h2>מוכנות ליציאה</h2>
          <ul className="vehicle-roster-readiness-list">
            {readinessState.items.map((item) => (
              <li key={item.key} className={item.done ? "done" : "missing"}>
                <span aria-hidden="true">{item.done ? "✓" : "!"}</span>
                <div>
                  <strong>{item.done ? item.doneLabel : item.missingReason}</strong>
                  {!item.done ? <a href={`#${item.sectionId}`}>עבור להשלמה</a> : null}
                </div>
              </li>
            ))}
          </ul>
        </article>
      </section>

      {canMutateDraft ? (
        <details id="roster-draft-form" className="vehicle-roster-panel" open>
          <summary>עדכון פרטי טיוטה</summary>
          <p className="required-field-legend">שדות חובה מסומנים ברקע צהוב בהיר.</p>
          <form action={draftAction} className="vehicle-roster-form-grid">
            <input type="hidden" name="incidentId" value={incidentId} />
            <input type="hidden" name="rosterId" value={roster.id} />
            <label><RequiredLabel>סוג תנועה</RequiredLabel><select className="required-field" name="movementType" defaultValue={roster.movement_type}>{MOVEMENT_TYPES.map((type) => <option key={type} value={type}>{MOVEMENT_TYPE_LABELS[type]}</option>)}</select></label>
            <label><RequiredLabel>נקודת מוצא</RequiredLabel><input className="required-field" name="originText" defaultValue={roster.origin_text ?? "מחסן היחידה"} /></label>
            <label><RequiredLabel>יעד הנסיעה</RequiredLabel><input className="required-field" name="destinationText" defaultValue={roster.destination_text ?? ""} /></label>
            <label>אתר מוצא<select name="originSiteId" defaultValue={roster.origin_site_id ?? ""}><option value="">ללא</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
            <label>אתר יעד<select name="destinationSiteId" defaultValue={roster.destination_site_id ?? ""}><option value="">ללא</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
            <label>שעת יציאה מתוכננת<input type="datetime-local" name="plannedDepartureAt" /></label>
            <label><RequiredLabel>מספר רכב / מספר רישוי</RequiredLabel><input className="required-field" name="vehicleLicensePlate" defaultValue={roster.vehicle_license_plate ?? ""} /></label>
            <label>
              <RequiredLabel>זיהוי נוסף לרכב</RequiredLabel>
              <input className="required-field" name="vehicleDescription" defaultValue={roster.vehicle_description ?? ""} placeholder="לדוגמה: רכב חילוץ 2" />
              <small>לדוגמה: רכב חילוץ 2, טנדר לוגיסטיקה או רכב עירייה</small>
            </label>
            <label>סוג רכב (לא חובה)<input name="vehicleType" defaultValue={roster.vehicle_type ?? ""} /></label>
            <label>הערות לרכב<textarea name="vehicleNotes" defaultValue={roster.vehicle_notes ?? ""} /></label>
            <label className="wide">הערות לנסיעה<textarea name="operationalNotes" defaultValue={roster.operational_notes ?? ""} /></label>
            <OperationalLoadingButton className="button primary" loadingLabel="שומר...">שמור פרטי שבצ"ק</OperationalLoadingButton>
            <ActionFeedback state={draftState} />
          </form>
        </details>
      ) : null}

      <section id="roster-participants" className="vehicle-roster-panel">
        <div className="vehicle-roster-section-heading">
          <h2>נוסעים ואנשי צוות ({roster.participants.length})</h2>
          {!isDraft ? <span className="muted-text">רשימה לקריאה בלבד לאחר יציאה מטיוטה.</span> : null}
        </div>
        {canMutateDraft && missingItems.some((item) => item.sectionId === "roster-participants") ? (
          <div className="required-assignment-panel">
            {missingItems.filter((item) => item.sectionId === "roster-participants").map((item) => (
              <span key={item.key} className="assignment-warning">{item.missingReason}</span>
            ))}
          </div>
        ) : null}
        <div className="vehicle-roster-participant-list">
          {roster.participants.length === 0 ? <p className="muted-text">עדיין לא שובצו משתתפים.</p> : null}
          {roster.participants.map((participant) => (
            <ParticipantCard key={participant.id} participant={participant} incidentId={incidentId} rosterId={roster.id} canEdit={canMutateDraft} />
          ))}
        </div>
      </section>

      {canMutateDraft ? (
        <section className="vehicle-roster-detail-grid">
          <details className="vehicle-roster-panel" open>
            <summary>בחירת משתתפים</summary>
            <form action={addAction} className="vehicle-roster-person-selector">
              <input type="hidden" name="incidentId" value={incidentId} />
              <input type="hidden" name="rosterId" value={roster.id} />
              <div className="vehicle-roster-filters compact">
                <input type="search" value={personQuery} onChange={(event) => setPersonQuery(event.target.value)} placeholder="חיפוש לפי שם, טלפון או צוות" />
                <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)} aria-label="סינון מקור">
                  <option value="all">כל המקורות</option>
                  <option value="unit_personnel">צוות אורגני</option>
                  <option value="manual_personnel">נוסף ידנית</option>
                  <option value="external_person">גורם חיצוני</option>
                </select>
                <select value={teamFilter} onChange={(event) => setTeamFilter(event.target.value)} aria-label="סינון צוות">
                  <option value="all">כל הצוותים</option>
                  {teams.map((team) => <option key={team} value={team}>{team}</option>)}
                </select>
              </div>
              <div className="vehicle-roster-person-grid">
                {filteredPeople.map((person) => {
                  const key = personKey(person);
                  const alreadyInRoster = existingParticipantKeys.has(key);
                  const selectable = !alreadyInRoster && isSelectable(person, roster.id);
                  return (
                    <label key={key} className={`vehicle-roster-person-card ${selectable ? "" : "disabled"}`}>
                      <input type="checkbox" name="personKey" value={key} disabled={!selectable} />
                      <strong>{person.display_name}</strong>
                      <span>{person.mobile_phone || "ללא טלפון"}</span>
                      <span className={`source-badge ${sourceBadgeClass(person.source_type)}`}>{sourceLabel(person.source_type)}</span>
                      <small>{person.organic_team || "ללא צוות"}{person.ad_hoc_teams ? ` · ${person.ad_hoc_teams}` : ""}</small>
                      <small>{ATTENDANCE_LABELS[person.attendance_status || ""] ?? person.attendance_status ?? "ללא סטטוס"}</small>
                      {alreadyInRoster ? <em>כבר בשבצ"ק</em> : null}
                      {!alreadyInRoster ? allocationNotice(person, roster.id) : null}
                    </label>
                  );
                })}
              </div>
              <OperationalLoadingButton className="button primary" loadingLabel="משייך...">הוסף כנוסעים</OperationalLoadingButton>
              <ActionFeedback state={addState} />
            </form>
          </details>

          <details className="vehicle-roster-panel" open={externalOpen} onToggle={(event) => setExternalOpen(event.currentTarget.open)}>
            <summary>הוסף גורם חיצוני</summary>
            <form key={externalFormKey} action={externalAction} className="vehicle-roster-form-grid">
              <input type="hidden" name="incidentId" value={incidentId} />
              <input type="hidden" name="rosterId" value={roster.id} />
              <label><RequiredLabel>שם מלא</RequiredLabel><input className="required-field" name="fullName" required placeholder="לדוגמה: שרון כהן" /></label>
              <label>
                <RequiredLabel>טלפון נייד</RequiredLabel>
                <input className="required-field" type="tel" inputMode="tel" autoComplete="tel" dir="ltr" name="mobilePhone" required placeholder="לדוגמה: 050-1234567" />
                <small>נדרש מספר נייד ישראלי תקין כדי למנוע כפילויות.</small>
              </label>
              <label>תפקיד/תיאור<input name="externalRole" /></label>
              <label className="wide">הערות<textarea name="notes" /></label>
              <fieldset className="required-role-fieldset wide">
                <legend><RequiredLabel>תפקיד בשבצ"ק</RequiredLabel></legend>
                <label className="checkbox-label"><input type="checkbox" name="isDriver" /> נהג</label>
                <label className="checkbox-label"><input type="checkbox" name="isMovementCommander" /> מפקד נסיעה</label>
                <label className="checkbox-label"><input type="checkbox" name="isPassenger" defaultChecked /> נוסע</label>
              </fieldset>
              <OperationalLoadingButton className="button primary" loadingLabel="מוסיף...">הוסף ושייך לשבצ"ק</OperationalLoadingButton>
              <ActionFeedback state={externalState} />
            </form>
          </details>
        </section>
      ) : null}

      <section className="vehicle-roster-panel">
        <h2>היסטוריית זמנים</h2>
        <ol className="vehicle-roster-timeline">
          <TimelineItem label="נוצר" value={roster.created_at} />
          <TimelineItem label="מוכן ליציאה" value={roster.ready_at} />
          <TimelineItem label="יצא לדרך" value={roster.departed_at || roster.actual_departure_at} />
          <TimelineItem label="הגיע ליעד" value={roster.arrived_at || roster.actual_arrival_at} />
          <TimelineItem label="בוטל" value={roster.cancelled_at} />
        </ol>
      </section>
    </div>
  );
}

function workflowState(rosterStatus: RosterStatus, step: WorkflowStep): "completed" | "current" | "next" | "future" | "disabled" {
  if (rosterStatus === "cancelled") return "disabled";
  const statusIndex: Record<Exclude<RosterStatus, "cancelled">, number> = { draft: 0, ready: 1, en_route: 2, arrived: 3 };
  const currentIndex = statusIndex[rosterStatus];
  const stepIndex = WORKFLOW_STEPS.findIndex((item) => item.key === step.key);
  if (step.key === "next") return rosterStatus === "arrived" ? "next" : "future";
  if (stepIndex < currentIndex) return "completed";
  if (stepIndex === currentIndex) return "current";
  if (stepIndex === currentIndex + 1) return "next";
  return "future";
}

function WorkflowStage({
  step,
  index,
  roster,
  canEditPersonnel,
  readinessComplete,
  transitionAction,
  cloneReturnAction,
  cloneNextAction,
  nowValue
}: {
  step: WorkflowStep;
  index: number;
  roster: VehicleRosterDetail;
  canEditPersonnel: boolean;
  readinessComplete: boolean;
  transitionAction: (payload: FormData) => void;
  cloneReturnAction: (payload: FormData) => void;
  cloneNextAction: (payload: FormData) => void;
  nowValue: string;
}) {
  const state = workflowState(roster.status, step);
  const disabledByPermission = !canEditPersonnel || roster.status === "cancelled";

  return (
    <article className={`workflow-stage ${state}`} role="listitem" aria-current={state === "current" ? "step" : undefined}>
      <div className="workflow-stage-head">
        <span className="workflow-index" aria-hidden="true">{state === "completed" ? "✓" : index + 1}</span>
        <div>
          <h3>{step.title}</h3>
          <p>{stateLabel(state)}</p>
        </div>
      </div>
      <p>{step.description}</p>
      <div className="workflow-stage-action">
        {step.key === "ready" && roster.status === "draft" && canEditPersonnel ? (
          <>
            <TransitionInlineForm incidentId={roster.incident_id} rosterId={roster.id} targetStatus="ready" label="העבר למוכן ליציאה" loading="בודק..." action={transitionAction} disabled={!readinessComplete} />
            {!readinessComplete ? <span className="workflow-disabled-text">יש להשלים את כל דרישות המוכנות לפני יציאה.</span> : null}
          </>
        ) : null}
        {step.key === "en_route" && roster.status === "ready" && !disabledByPermission ? (
          <TimestampTransitionForm incidentId={roster.incident_id} rosterId={roster.id} targetStatus="en_route" label="אשר יציאה" loading="מעדכן..." action={transitionAction} defaultValue={nowValue} />
        ) : null}
        {step.key === "arrived" && roster.status === "en_route" && !disabledByPermission ? (
          <TimestampTransitionForm incidentId={roster.incident_id} rosterId={roster.id} targetStatus="arrived" label="אשר הגעה" loading="מעדכן..." action={transitionAction} defaultValue={nowValue} />
        ) : null}
        {step.key === "next" && roster.status === "arrived" && !disabledByPermission ? (
          <CloneChoiceForms incidentId={roster.incident_id} sourceRosterId={roster.id} cloneReturnAction={cloneReturnAction} cloneNextAction={cloneNextAction} />
        ) : null}
      </div>
    </article>
  );
}

function stateLabel(state: "completed" | "current" | "next" | "future" | "disabled") {
  if (state === "completed") return "הושלם";
  if (state === "current") return "השלב הנוכחי";
  if (state === "next") return "הפעולה הבאה";
  if (state === "disabled") return "קריאה בלבד";
  return "שלב עתידי";
}

function TransitionInlineForm({
  incidentId,
  rosterId,
  targetStatus,
  label,
  loading,
  action,
  disabled = false,
  requiresReason = false,
  tone = "primary"
}: {
  incidentId: string;
  rosterId: string;
  targetStatus: string;
  label: string;
  loading: string;
  action: (payload: FormData) => void;
  disabled?: boolean;
  requiresReason?: boolean;
  tone?: "primary" | "secondary" | "danger";
}) {
  const buttonClass = tone === "danger" ? "button danger compact" : tone === "secondary" ? "button secondary compact" : "button primary compact";
  return (
    <details className="workflow-confirmation">
      <summary>{label}</summary>
      <form action={action} className="inline-action-form">
        <input type="hidden" name="incidentId" value={incidentId} />
        <input type="hidden" name="rosterId" value={rosterId} />
        <input type="hidden" name="targetStatus" value={targetStatus} />
        {requiresReason ? <label>סיבת ביטול<textarea name="reason" /></label> : <p>אישור הפעולה יעדכן את סטטוס השבצ"ק.</p>}
        <OperationalLoadingButton className={buttonClass} loadingLabel={loading} disabled={disabled}>{label}</OperationalLoadingButton>
      </form>
    </details>
  );
}

function TimestampTransitionForm({ incidentId, rosterId, targetStatus, label, loading, action, defaultValue }: { incidentId: string; rosterId: string; targetStatus: string; label: string; loading: string; action: (payload: FormData) => void; defaultValue: string }) {
  return (
    <form action={action} className="inline-action-form timestamp-action-form">
      <input type="hidden" name="incidentId" value={incidentId} />
      <input type="hidden" name="rosterId" value={rosterId} />
      <input type="hidden" name="targetStatus" value={targetStatus} />
      <label>זמן פעולה בפועל<input type="datetime-local" name="operationalTimestamp" defaultValue={defaultValue} /></label>
      <OperationalLoadingButton className="button primary compact" loadingLabel={loading}>{label}</OperationalLoadingButton>
    </form>
  );
}

function CloneChoiceForms({ incidentId, sourceRosterId, cloneReturnAction, cloneNextAction }: { incidentId: string; sourceRosterId: string; cloneReturnAction: (payload: FormData) => void; cloneNextAction: (payload: FormData) => void }) {
  return (
    <div className="clone-choice-grid">
      <form action={cloneReturnAction} className="clone-choice-card">
        <input type="hidden" name="incidentId" value={incidentId} />
        <input type="hidden" name="sourceRosterId" value={sourceRosterId} />
        <strong>נסיעת חזרה</strong>
        <span>יווצר שבצ"ק חדש עם אותו רכב ואותם אנשים, כאשר המוצא והיעד יוחלפו.</span>
        <OperationalLoadingButton className="button primary compact" loadingLabel="משכפל...">שכפל לחזרה</OperationalLoadingButton>
      </form>
      <form action={cloneNextAction} className="clone-choice-card">
        <input type="hidden" name="incidentId" value={incidentId} />
        <input type="hidden" name="sourceRosterId" value={sourceRosterId} />
        <strong>יעד הבא</strong>
        <span>יווצר שבצ"ק המשך מאותה נקודת יעד, עם יעד חדש ושעת יציאה שימולאו בטיוטה.</span>
        <OperationalLoadingButton className="button secondary compact" loadingLabel="יוצר...">צור שבצ"ק המשך</OperationalLoadingButton>
      </form>
    </div>
  );
}

function ParticipantCard({ participant, incidentId, rosterId, canEdit }: { participant: VehicleRosterParticipant; incidentId: string; rosterId: string; canEdit: boolean }) {
  const [roleState, roleAction] = useFormState(updateVehicleRosterParticipantRolesAction, INITIAL_STATE);
  const [removeState, removeAction] = useFormState(removeVehicleRosterParticipantAction, INITIAL_STATE);
  return (
    <article className="vehicle-roster-participant-card">
      <div>
        <strong>{participant.display_name_snapshot}</strong>
        <span>{participant.normalized_mobile_phone || "ללא טלפון"}</span>
        <span className={`source-badge ${sourceBadgeClass(participant.source_type)}`}>{sourceLabel(participant.source_type)}</span>
      </div>
      <div className="role-badge-row">
        {participant.is_driver ? <span>נהג</span> : null}
        {participant.is_movement_commander ? <span>מפקד נסיעה</span> : null}
        {participant.is_passenger ? <span>נוסע</span> : null}
      </div>
      {participant.notes ? <p>{participant.notes}</p> : null}
      {canEdit ? (
        <div className="vehicle-roster-participant-actions">
          <form action={roleAction} className="role-edit-form">
            <input type="hidden" name="incidentId" value={incidentId} />
            <input type="hidden" name="rosterId" value={rosterId} />
            <input type="hidden" name="participantId" value={participant.id} />
            <label><input type="checkbox" name="isDriver" defaultChecked={participant.is_driver} /> נהג</label>
            <label><input type="checkbox" name="isMovementCommander" defaultChecked={participant.is_movement_commander} /> מפקד</label>
            <label><input type="checkbox" name="isPassenger" defaultChecked={participant.is_passenger} /> נוסע</label>
            <OperationalLoadingButton className="button secondary compact" loadingLabel="מעדכן...">עדכן תפקידים</OperationalLoadingButton>
            <ActionFeedback state={roleState} />
          </form>
          <form action={removeAction}>
            <input type="hidden" name="incidentId" value={incidentId} />
            <input type="hidden" name="rosterId" value={rosterId} />
            <input type="hidden" name="participantId" value={participant.id} />
            <OperationalLoadingButton className="button danger compact" loadingLabel="מסיר...">הסר</OperationalLoadingButton>
            <ActionFeedback state={removeState} />
          </form>
        </div>
      ) : null}
    </article>
  );
}

function RequiredLabel({ children }: { children: ReactNode }) {
  return <span className="required-label">{children}<span aria-hidden="true"> *</span></span>;
}

function TimelineItem({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return <li><strong>{label}</strong><span>{formatDateTimeLocal(value)}</span></li>;
}

function ActionFeedback({ state }: { state: VehicleRosterActionState }) {
  if (state.error) return <p className="form-error">{state.error}</p>;
  if (state.success) return <p className="success-message">{state.success}</p>;
  return null;
}
