"use client";

import { useMemo, useState } from "react";
import { useFormState } from "react-dom";
import { OperationalLoadingButton } from "@/app/(protected)/operational-loading-button";
import type { OperationalTeamRosterModel } from "@/lib/organic-team-reinforcements";
import {
  addExistingAdHocMemberAction,
  addManualAdHocMemberAction,
  addManualIncidentPersonnelAction,
  assignOrganicTeamReinforcementAction,
  archiveAdHocTeamAction,
  createAdHocTeamAction,
  returnAdHocTeamMemberAction,
  returnOrganicTeamReinforcementAction,
  setAdHocTeamMemberRoleAction,
  transferAdHocTeamMemberAction,
  transferOrganicTeamReinforcementAction,
  updateAdHocTeamAction,
  type PersonnelActionState
} from "./actions";

type OrganicTeamReference = {
  id: string;
  number: number;
  name: string;
  isActive: boolean;
};

type OrganicTeamReinforcementCandidate = {
  key: string;
  name: string;
  sourceKind: "roster" | "manual";
  organicTeam: OrganicTeamReference;
};

type ActiveOrganicTeamReinforcement = {
  id: string;
  name: string;
  sourceKind: "roster" | "manual";
  organicTeam: OrganicTeamReference;
  operationalTeam: OrganicTeamReference;
  assignedAtLabel: string | null;
  notes: string | null;
};

type TeamOption = {
  id: string;
  label: string;
};

type SiteOption = {
  id: string;
  name: string;
};

type PersonnelOption = {
  key: string;
  name: string;
  phone: string | null;
  teamLabel: string;
  attendanceLabel: string;
  sourceLabel: string;
};

type AdHocMember = {
  id: string;
  name: string;
  phone: string | null;
  sourceLabel: string;
  sourceKind: "roster" | "manual";
  operationalRole: "member" | "commander" | "deputy";
  notes: string | null;
};

type AdHocTeam = {
  id: string;
  name: string;
  purpose: string | null;
  commanderName: string | null;
  notes: string | null;
  status: string;
  relatedSiteId: string | null;
  relatedSiteName: string | null;
  members: AdHocMember[];
};

type IncidentPersonnelActionPanelsProps = {
  incidentId: string;
  canEdit: boolean;
  teams: TeamOption[];
  sites: SiteOption[];
  personnelOptions: PersonnelOption[];
  adHocTeams: AdHocTeam[];
  canManageAdHocTeams: boolean;
  organicTeamReinforcementAvailable: boolean;
  organicTeamReinforcementUnavailableMessage: string | null;
  organicTeamReinforcementCandidates: OrganicTeamReinforcementCandidate[];
  organicTeamReinforcementTargetTeams: OrganicTeamReference[];
  canManageOrganicTeamReinforcements: boolean;
  activeOrganicTeamReinforcements: ActiveOrganicTeamReinforcement[];
  incidentIsActive: boolean;
  operationalTeamRoster: OperationalTeamRosterModel;
  operationalTeamRosterUnavailableMessage: string | null;
};

const initialState: PersonnelActionState = {
  error: null,
  success: null
};

const OPERATIONAL_ROLE_OPTIONS = [
  ["member", "חבר/ת צוות"],
  ["commander", "מפקד/ת"],
  ["deputy", "סגן/ית מפקד"]
] as const;

function operationalRoleLabel(role: AdHocMember["operationalRole"]) {
  return OPERATIONAL_ROLE_OPTIONS.find(([key]) => key === role)?.[1] ?? "חבר/ת צוות";
}

function ActionMessage({ state }: { state: PersonnelActionState | undefined }) {
  const currentState = state ?? initialState;
  if (currentState.error) {
    return (
      <p className="error" role="alert">
        {currentState.error}
      </p>
    );
  }
  if (currentState.success) {
    return (
      <p className="success-message" role="status">
        {currentState.success}
      </p>
    );
  }
  return null;
}

function ManualPersonnelForm({
  incidentId,
  teams,
  disabled
}: {
  incidentId: string;
  teams: TeamOption[];
  disabled: boolean;
}) {
  const [state, formAction] = useFormState(addManualIncidentPersonnelAction, initialState);

  return (
    <details className="personnel-action-card" open={false}>
      <summary>הוסף איש צוות ידנית</summary>
      <form action={formAction} className="action-form">
        <input type="hidden" name="incidentId" value={incidentId} />
        <ActionMessage state={state} />
        <div className="form-grid">
          <label>
            שם פרטי
            <input className="input" name="firstName" required disabled={disabled} />
          </label>
          <label>
            שם משפחה
            <input className="input" name="lastName" required disabled={disabled} />
          </label>
          <label>
            טלפון נייד
            <input className="input" name="mobilePhone" inputMode="tel" required disabled={disabled} />
          </label>
          <label>
            צוות
            <select className="input" name="organicTeamId" required disabled={disabled}>
              <option value="">בחר צוות</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            תפקיד
            <input className="input" name="role" disabled={disabled} />
          </label>
          <label className="wide">
            הערות
            <textarea className="input" name="notes" rows={2} disabled={disabled} />
          </label>
        </div>
        <OperationalLoadingButton className="button primary" label="הוסף לאירוע" loadingLabel="מוסיף..." disabled={disabled} />
      </form>
    </details>
  );
}

function CreateAdHocTeamForm({
  incidentId,
  sites,
  disabled
}: {
  incidentId: string;
  sites: SiteOption[];
  disabled: boolean;
}) {
  const [state, formAction] = useFormState(createAdHocTeamAction, initialState);

  return (
    <details className="personnel-action-card" open={false}>
      <summary>צור צוות אד־הוק</summary>
      <form action={formAction} className="action-form">
        <input type="hidden" name="incidentId" value={incidentId} />
        <ActionMessage state={state} />
        <div className="form-grid">
          <label>
            שם צוות
            <input className="input" name="teamName" required disabled={disabled} />
          </label>
          <label>
            מפקד/ת
            <input className="input" name="commanderName" disabled={disabled} />
          </label>
          <label>
            אתר קשור
            <select className="input" name="relatedSiteId" disabled={disabled}>
              <option value="">ללא אתר</option>
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            ייעוד
            <input className="input" name="purpose" disabled={disabled} />
          </label>
          <label className="wide">
            הערות
            <textarea className="input" name="notes" rows={2} disabled={disabled} />
          </label>
        </div>
        <OperationalLoadingButton className="button primary" label="צור צוות אד־הוק" loadingLabel="יוצר..." disabled={disabled} />
      </form>
    </details>
  );
}

function ExistingMemberForm({
  incidentId,
  adHocTeamId,
  personnelOptions,
  disabled
}: {
  incidentId: string;
  adHocTeamId: string;
  personnelOptions: PersonnelOption[];
  disabled: boolean;
}) {
  const [state, formAction] = useFormState(addExistingAdHocMemberAction, initialState);
  const [query, setQuery] = useState("");
  const filteredOptions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return personnelOptions;
    return personnelOptions.filter((person) =>
      [person.name, person.phone, person.teamLabel, person.attendanceLabel, person.sourceLabel]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalized)
    );
  }, [personnelOptions, query]);

  return (
    <form action={formAction} className="ad-hoc-member-form">
      <input type="hidden" name="incidentId" value={incidentId} />
      <input type="hidden" name="adHocTeamId" value={adHocTeamId} />
      <ActionMessage state={state} />
      <label>
        חיפוש איש צוות קיים
        <input
          className="input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="חפש לפי שם, טלפון או צוות"
          disabled={disabled}
        />
      </label>
      <label>
        איש צוות
        <select className="input" name="memberKey" required disabled={disabled}>
          <option value="">בחר איש צוות</option>
          {filteredOptions.map((person) => (
            <option key={person.key} value={person.key}>
              {person.name} · {person.teamLabel} · {person.attendanceLabel} · {person.sourceLabel}
            </option>
          ))}
        </select>
      </label>
      <OperationalLoadingButton className="button secondary" label="הוסף לצוות" loadingLabel="משייך..." disabled={disabled} />
    </form>
  );
}

function EditAdHocTeamForm({
  incidentId,
  team,
  sites,
  disabled
}: {
  incidentId: string;
  team: AdHocTeam;
  sites: SiteOption[];
  disabled: boolean;
}) {
  const [state, formAction] = useFormState(updateAdHocTeamAction, initialState);

  return (
    <form action={formAction} className="ad-hoc-member-form">
      <input type="hidden" name="incidentId" value={incidentId} />
      <input type="hidden" name="adHocTeamId" value={team.id} />
      <ActionMessage state={state} />
      <div className="form-grid">
        <label>
          שם צוות
          <input className="input" name="teamName" defaultValue={team.name} required disabled={disabled} />
        </label>
        <label>
          מפקד/ת
          <input className="input" name="commanderName" defaultValue={team.commanderName ?? ""} disabled={disabled} />
        </label>
        <label>
          אתר קשור
          <select className="input" name="relatedSiteId" defaultValue={team.relatedSiteId ?? ""} disabled={disabled}>
            <option value="">ללא אתר</option>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          ייעוד
          <input className="input" name="purpose" defaultValue={team.purpose ?? ""} disabled={disabled} />
        </label>
        <label className="wide">
          הערות
          <textarea className="input" name="notes" rows={2} defaultValue={team.notes ?? ""} disabled={disabled} />
        </label>
      </div>
      <OperationalLoadingButton className="button secondary" label="שמור צוות" loadingLabel="שומר..." disabled={disabled} />
    </form>
  );
}

function ManualAdHocMemberForm({
  incidentId,
  adHocTeamId,
  disabled
}: {
  incidentId: string;
  adHocTeamId: string;
  disabled: boolean;
}) {
  const [state, formAction] = useFormState(addManualAdHocMemberAction, initialState);

  return (
    <form action={formAction} className="ad-hoc-member-form">
      <input type="hidden" name="incidentId" value={incidentId} />
      <input type="hidden" name="adHocTeamId" value={adHocTeamId} />
      <ActionMessage state={state} />
      <div className="form-grid">
        <label>
          שם פרטי
          <input className="input" name="firstName" required disabled={disabled} />
        </label>
        <label>
          שם משפחה
          <input className="input" name="lastName" required disabled={disabled} />
        </label>
        <label>
          טלפון נייד
          <input className="input" name="mobilePhone" inputMode="tel" required disabled={disabled} />
        </label>
        <label>
          תפקיד
          <input className="input" name="role" disabled={disabled} />
        </label>
        <label className="wide">
          הערות
          <textarea className="input" name="notes" rows={2} disabled={disabled} />
        </label>
      </div>
      <OperationalLoadingButton className="button secondary" label="צור ושייך לצוות" loadingLabel="יוצר..." disabled={disabled} />
    </form>
  );
}

function OperationalRoleForm({
  incidentId,
  member,
  disabled
}: {
  incidentId: string;
  member: AdHocMember;
  disabled: boolean;
}) {
  const [state, formAction] = useFormState(setAdHocTeamMemberRoleAction, initialState);
  return (
    <form action={formAction} className="ad-hoc-member-form">
      <input type="hidden" name="incidentId" value={incidentId} />
      <input type="hidden" name="memberId" value={member.id} />
      <ActionMessage state={state} />
      <label>
        תפקיד מבצעי
        <select className="input" name="operationalRole" defaultValue={member.operationalRole} disabled={disabled}>
          {OPERATIONAL_ROLE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <OperationalLoadingButton className="button secondary" label="עדכן תפקיד" loadingLabel="מעדכן..." disabled={disabled} />
    </form>
  );
}

function TransferAdHocMemberForm({
  incidentId,
  member,
  sourceTeamId,
  teams,
  disabled
}: {
  incidentId: string;
  member: AdHocMember;
  sourceTeamId: string;
  teams: AdHocTeam[];
  disabled: boolean;
}) {
  const [state, formAction] = useFormState(transferAdHocTeamMemberAction, initialState);
  const targetTeams = teams.filter((team) => team.status === "active" && team.id !== sourceTeamId);
  return (
    <form action={formAction} className="ad-hoc-member-form">
      <input type="hidden" name="incidentId" value={incidentId} />
      <input type="hidden" name="memberId" value={member.id} />
      <ActionMessage state={state} />
      <label>
        צוות יעד
        <select className="input" name="targetAdHocTeamId" required disabled={disabled || targetTeams.length === 0}>
          <option value="">בחר צוות יעד</option>
          {targetTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
        </select>
      </label>
      <label>
        תפקיד ביעד
        <select className="input" name="targetOperationalRole" defaultValue="member" disabled={disabled || targetTeams.length === 0}>
          {OPERATIONAL_ROLE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label className="wide">
        הערת העברה
        <input className="input" name="notes" disabled={disabled || targetTeams.length === 0} />
      </label>
      {targetTeams.length === 0 ? <p className="muted">אין צוות אד־הוק פעיל אחר להעברה.</p> : null}
      <OperationalLoadingButton className="button secondary" label="העבר לצוות" loadingLabel="מעביר..." disabled={disabled || targetTeams.length === 0} />
    </form>
  );
}

function ReleaseAdHocMemberForm({
  incidentId,
  member,
  disabled
}: {
  incidentId: string;
  member: AdHocMember;
  disabled: boolean;
}) {
  const [state, formAction] = useFormState(returnAdHocTeamMemberAction, initialState);
  const destination = member.sourceKind === "roster" ? "לצוות האורגני" : "למאגר כוח האדם הכלל־אירועי";
  return (
    <form action={formAction} className="ad-hoc-member-form">
      <input type="hidden" name="incidentId" value={incidentId} />
      <input type="hidden" name="memberId" value={member.id} />
      <ActionMessage state={state} />
      <p className="muted">השחרור מחזיר {destination}; הנוכחות והשיוך האורגני אינם משתנים.</p>
      <OperationalLoadingButton className="button ghost" label="שחרר מצוות אד־הוק" loadingLabel="משחרר..." disabled={disabled} />
    </form>
  );
}

function OrganicTeamReinforcementForm({
  incidentId,
  available,
  incidentIsActive,
  unavailableMessage,
  candidates,
  targetTeams,
  canManage
}: {
  incidentId: string;
  available: boolean;
  incidentIsActive: boolean;
  unavailableMessage: string | null;
  candidates: OrganicTeamReinforcementCandidate[];
  targetTeams: OrganicTeamReference[];
  canManage: boolean;
}) {
  const [state, formAction] = useFormState(assignOrganicTeamReinforcementAction, initialState);
  const [personnelKey, setPersonnelKey] = useState("");
  const selectedPerson = candidates.find((candidate) => candidate.key === personnelKey) ?? null;
  const eligibleTargetTeams = selectedPerson
    ? targetTeams.filter((team) => team.id !== selectedPerson.organicTeam.id)
    : [];
  const disabled = !canManage || !available || !incidentIsActive || candidates.length === 0;

  return (
    <details className="personnel-action-card" open={false}>
      <summary>תגבור זמני בין צוותים אורגניים</summary>
      {!available ? (
        <p className="muted">{unavailableMessage ?? "לא ניתן לטעון כרגע את נתוני התגבור האורגני."}</p>
      ) : !incidentIsActive ? (
        <p className="muted">האירוע אינו פעיל, ולכן לא ניתן להקצות תגבור אורגני.</p>
      ) : !canManage ? (
        <p className="muted">ניהול תגבור אורגני זמין למנהל מערכת או מפקד בלבד.</p>
      ) : (
        <form action={formAction} className="action-form">
          <input type="hidden" name="incidentId" value={incidentId} />
          <ActionMessage state={state} />
          <div className="form-grid">
            <label>
              מחלץ נוכח
              <select
                className="input"
                name="personnelKey"
                required
                value={personnelKey}
                onChange={(event) => setPersonnelKey(event.target.value)}
                disabled={disabled}
              >
                <option value="">בחר מחלץ</option>
                {candidates.map((candidate) => (
                  <option key={candidate.key} value={candidate.key}>
                    {candidate.name} · {candidate.organicTeam.name} · {candidate.sourceKind === "roster" ? "סגל קבוע" : "נוסף ידנית"}
                  </option>
                ))}
              </select>
            </label>
            <label>
              צוות אורגני מקורי
              <input className="input" value={selectedPerson?.organicTeam.name ?? "בחר מחלץ"} readOnly />
            </label>
            <label>
              צוות יעד
              <select className="input" name="targetTeamId" required disabled={disabled || !selectedPerson}>
                <option value="">בחר צוות יעד</option>
                {eligibleTargetTeams.map((team) => (
                  <option key={team.id} value={team.id}>{team.name}</option>
                ))}
              </select>
            </label>
            <label className="wide">
              הערה
              <textarea className="input" name="notes" rows={2} disabled={disabled} />
            </label>
          </div>
          {candidates.length === 0 ? <p className="muted">אין מחלצים נוכחים וזכאים לתגבור כרגע.</p> : null}
          {selectedPerson && eligibleTargetTeams.length === 0 ? <p className="muted">אין צוות יעד אורגני פעיל אחר עבור המחלץ שנבחר.</p> : null}
          <OperationalLoadingButton
            className="button primary"
            label="תגבר לצוות"
            loadingLabel="מתגבר..."
            disabled={disabled || !selectedPerson || eligibleTargetTeams.length === 0}
          />
        </form>
      )}
    </details>
  );
}

function TransferOrganicTeamReinforcementForm({
  incidentId,
  reinforcement,
  targetTeams,
  disabled
}: {
  incidentId: string;
  reinforcement: ActiveOrganicTeamReinforcement;
  targetTeams: OrganicTeamReference[];
  disabled: boolean;
}) {
  const [state, formAction] = useFormState(transferOrganicTeamReinforcementAction, initialState);
  const eligibleTargetTeams = targetTeams.filter((team) => (
    team.id !== reinforcement.operationalTeam.id && team.id !== reinforcement.organicTeam.id
  ));

  return (
    <form action={formAction} className="ad-hoc-member-form">
      <input type="hidden" name="incidentId" value={incidentId} />
      <input type="hidden" name="reinforcementId" value={reinforcement.id} />
      <ActionMessage state={state} />
      <label>
        צוות יעד
        <select className="input" name="targetTeamId" required disabled={disabled || eligibleTargetTeams.length === 0}>
          <option value="">בחר צוות יעד</option>
          {eligibleTargetTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
        </select>
      </label>
      <label className="wide">
        הערת העברה
        <input className="input" name="notes" disabled={disabled || eligibleTargetTeams.length === 0} />
      </label>
      {eligibleTargetTeams.length === 0 ? <p className="muted">אין צוות יעד אורגני פעיל אחר להעברה.</p> : null}
      <OperationalLoadingButton
        className="button secondary"
        label="העבר לצוות אחר"
        loadingLabel="מעביר..."
        disabled={disabled || eligibleTargetTeams.length === 0}
      />
    </form>
  );
}

function ReturnOrganicTeamReinforcementForm({
  incidentId,
  reinforcement,
  disabled
}: {
  incidentId: string;
  reinforcement: ActiveOrganicTeamReinforcement;
  disabled: boolean;
}) {
  const [state, formAction] = useFormState(returnOrganicTeamReinforcementAction, initialState);
  const confirmation = `האם להחזיר את ${reinforcement.name} לצוות האורגני ${reinforcement.organicTeam.name}?`;

  return (
    <form
      action={formAction}
      className="ad-hoc-member-form"
      onSubmit={(event) => {
        if (!window.confirm(confirmation)) event.preventDefault();
      }}
    >
      <input type="hidden" name="incidentId" value={incidentId} />
      <input type="hidden" name="reinforcementId" value={reinforcement.id} />
      <ActionMessage state={state} />
      <p className="muted">ההחזרה תשיב את המחלץ לצוות המקורי: {reinforcement.organicTeam.name}.</p>
      <OperationalLoadingButton className="button ghost" label="החזר לצוות המקורי" loadingLabel="מחזיר..." disabled={disabled} />
    </form>
  );
}

function ActiveOrganicTeamReinforcements({
  incidentId,
  available,
  incidentIsActive,
  canManage,
  reinforcements,
  targetTeams
}: {
  incidentId: string;
  available: boolean;
  incidentIsActive: boolean;
  canManage: boolean;
  reinforcements: ActiveOrganicTeamReinforcement[];
  targetTeams: OrganicTeamReference[];
}) {
  const actionsDisabled = !available || !incidentIsActive || !canManage;

  return (
    <div className="ad-hoc-team-list">
      <div className="section-title-row">
        <div>
          <h3>תגבורים אורגניים פעילים</h3>
          <p className="muted">השיוך האורגני המקורי נשמר; הצוות המבצעי מציג את יעד התגבור הנוכחי.</p>
        </div>
      </div>
      {!available ? <p className="muted">נתוני התגבור האורגני אינם זמינים כרגע.</p> : null}
      {available && reinforcements.length === 0 ? <p className="muted">אין תגבורי צוותים אורגניים פעילים.</p> : null}
      {available && !incidentIsActive ? <p className="muted">האירוע אינו פעיל, ולכן לא ניתן לנהל תגבור פעיל.</p> : null}
      {available && reinforcements.map((reinforcement) => (
        <article className="ad-hoc-team-card" key={reinforcement.id}>
          <div className="section-title-row">
            <div>
              <h4>{reinforcement.name}</h4>
              <div className="badge-row">
                <span className="status-pill neutral">{reinforcement.sourceKind === "roster" ? "סגל קבוע" : "נוסף ידנית"}</span>
                <span className="status-pill neutral">מקור: {reinforcement.organicTeam.name}</span>
                <span className="status-pill success">פעיל כעת: {reinforcement.operationalTeam.name}</span>
              </div>
            </div>
          </div>
          <p className="muted">
            {reinforcement.assignedAtLabel ? `תחילת תגבור: ${reinforcement.assignedAtLabel}` : "מועד תחילת התגבור אינו זמין"}
            {reinforcement.notes ? ` · הערה: ${reinforcement.notes}` : ""}
          </p>
          {canManage && available && incidentIsActive ? (
            <div className="ad-hoc-team-forms">
              <details>
                <summary>העבר לצוות אחר</summary>
                <TransferOrganicTeamReinforcementForm
                  incidentId={incidentId}
                  reinforcement={reinforcement}
                  targetTeams={targetTeams}
                  disabled={actionsDisabled}
                />
              </details>
              <ReturnOrganicTeamReinforcementForm
                incidentId={incidentId}
                reinforcement={reinforcement}
                disabled={actionsDisabled}
              />
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function OperationalTeamRoster({
  available,
  unavailableMessage,
  roster
}: {
  available: boolean;
  unavailableMessage: string | null;
  roster: OperationalTeamRosterModel;
}) {
  return (
    <section className="personnel-action-card" aria-labelledby="operational-team-roster-title">
      <div className="section-title-row">
        <div>
          <h3 id="operational-team-roster-title">מצבת כוח אדם מבצעית לפי צוות</h3>
          <p className="muted">אנשי צוותי אד־הוק אינם נכללים בסך הצוותים האורגניים.</p>
        </div>
        {available ? <span className="status-pill success">סה״כ מבצעי: {roster.totalOperationalPersonnel}</span> : null}
      </div>
      {!available ? (
        <p className="muted">{unavailableMessage ?? "מצבת כוח האדם המבצעית אינה זמינה כעת – לא ניתן לטעון את כל הנתונים הנדרשים."}</p>
      ) : roster.teams.length === 0 ? (
        <p className="muted">אין צוותים אורגניים פעילים 1–4 באירוע.</p>
      ) : (
        <div className="event-personnel-list compact">
          {roster.teams.map((team) => (
            <div className="event-personnel-row" key={team.team.id}>
              <div>
                <strong>{team.team.name}</strong>
                <span>נוכחים אורגניים: {team.organicPresent} · יצאו לתגבור: {team.outgoingReinforcements} · נכנסו בתגבור: {team.incomingReinforcements}</span>
              </div>
              <div className="badge-row">
                <span className="status-pill neutral">אד־הוק: {team.adHocMembers}</span>
                <span className="status-pill success">מבצעי: {team.operationalPersonnel}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function IncidentPersonnelActionPanels({
  incidentId,
  canEdit,
  teams,
  sites,
  personnelOptions,
  adHocTeams,
  canManageAdHocTeams,
  organicTeamReinforcementAvailable,
  organicTeamReinforcementUnavailableMessage,
  organicTeamReinforcementCandidates,
  organicTeamReinforcementTargetTeams,
  canManageOrganicTeamReinforcements,
  activeOrganicTeamReinforcements,
  incidentIsActive,
  operationalTeamRoster,
  operationalTeamRosterUnavailableMessage
}: IncidentPersonnelActionPanelsProps) {
  return (
    <section className="panel incident-personnel-actions">
      <div className="section-title-row">
        <div>
          <h2>ניהול כוח אדם וצוותים לאירוע</h2>
          <p className="muted">הוספה ידנית ושיוך לצוותי אד־הוק נשמרים רק בהקשר האירוע הנוכחי.</p>
        </div>
      </div>

      {!canEdit ? (
        <p className="muted">אין לך הרשאה לערוך כוח אדם באירוע זה.</p>
      ) : (
        <div className="personnel-action-grid">
          <ManualPersonnelForm incidentId={incidentId} teams={teams} disabled={!canEdit} />
          {canManageAdHocTeams ? <CreateAdHocTeamForm incidentId={incidentId} sites={sites} disabled={!canManageAdHocTeams} /> : null}
        </div>
      )}

      <div className="personnel-action-grid">
        <OrganicTeamReinforcementForm
          incidentId={incidentId}
          available={organicTeamReinforcementAvailable}
          incidentIsActive={incidentIsActive}
          unavailableMessage={organicTeamReinforcementUnavailableMessage}
          candidates={organicTeamReinforcementCandidates}
          targetTeams={organicTeamReinforcementTargetTeams}
          canManage={canManageOrganicTeamReinforcements}
        />
      </div>

      <ActiveOrganicTeamReinforcements
        incidentId={incidentId}
        available={organicTeamReinforcementAvailable}
        incidentIsActive={incidentIsActive}
        canManage={canManageOrganicTeamReinforcements}
        reinforcements={activeOrganicTeamReinforcements}
        targetTeams={organicTeamReinforcementTargetTeams}
      />

      <OperationalTeamRoster
        available={organicTeamReinforcementAvailable}
        unavailableMessage={operationalTeamRosterUnavailableMessage}
        roster={operationalTeamRoster}
      />

      {!canManageAdHocTeams ? <p className="muted">ניהול צוותי אד־הוק זמין למנהל מערכת או מפקד בלבד.</p> : null}

      <div className="ad-hoc-team-list">
        {adHocTeams.length === 0 ? (
          <p className="muted">עדיין לא נוצרו צוותי אד־הוק באירוע.</p>
        ) : (
          adHocTeams.map((team) => (
            <article className={`ad-hoc-team-card ${team.status === "archived" ? "is-archived" : ""}`} key={team.id}>
              <div className="section-title-row">
                <div>
                  <h3>{team.name}</h3>
                  <div className="badge-row">
                    <span className="status-pill warning">צוות אד־הוק</span>
                    <span className={`status-pill ${team.status === "active" ? "success" : "neutral"}`}>
                      {team.status === "active" ? "פעיל" : "בארכיון"}
                    </span>
                    {team.relatedSiteName ? <span className="status-pill neutral">{team.relatedSiteName}</span> : null}
                  </div>
                </div>
                {canManageAdHocTeams && team.status === "active" ? (
                  <form action={archiveAdHocTeamAction}>
                    <input type="hidden" name="incidentId" value={incidentId} />
                    <input type="hidden" name="adHocTeamId" value={team.id} />
                    <OperationalLoadingButton className="button ghost" label="העבר לארכיון" loadingLabel="מעדכן..." />
                  </form>
                ) : null}
              </div>
              {team.purpose || team.commanderName || team.notes ? (
                <p className="muted">
                  {[team.purpose, team.commanderName ? `מפקד/ת (תיאור צוות): ${team.commanderName}` : null, team.notes]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              ) : null}
              <div className="event-personnel-list compact">
                {team.members.length === 0 ? (
                  <p className="muted">אין חברים בצוות.</p>
                ) : (
                  team.members.map((member) => (
                    <div className="event-personnel-row" key={member.id}>
                      <div>
                        <strong>{member.name}</strong>
                        <span>{member.phone ?? "אין טלפון"} · {member.sourceLabel} · {operationalRoleLabel(member.operationalRole)}</span>
                      </div>
                      <div className="badge-row">
                        <span className="status-pill neutral">{operationalRoleLabel(member.operationalRole)}</span>
                        {member.notes ? <span className="muted">{member.notes}</span> : null}
                      </div>
                      {canManageAdHocTeams && team.status === "active" ? (
                        <div className="ad-hoc-team-forms">
                          <OperationalRoleForm incidentId={incidentId} member={member} disabled={!canManageAdHocTeams} />
                          <details>
                            <summary>העבר לצוות אד־הוק אחר</summary>
                            <TransferAdHocMemberForm
                              incidentId={incidentId}
                              member={member}
                              sourceTeamId={team.id}
                              teams={adHocTeams}
                              disabled={!canManageAdHocTeams}
                            />
                          </details>
                          <ReleaseAdHocMemberForm incidentId={incidentId} member={member} disabled={!canManageAdHocTeams} />
                        </div>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
              {canManageAdHocTeams && team.status === "active" ? (
                <div className="ad-hoc-team-forms">
                  <details>
                    <summary>עריכת צוות</summary>
                    <EditAdHocTeamForm incidentId={incidentId} team={team} sites={sites} disabled={!canManageAdHocTeams} />
                  </details>
                  <details>
                    <summary>הוסף איש צוות קיים</summary>
                    <ExistingMemberForm
                      incidentId={incidentId}
                      adHocTeamId={team.id}
                      personnelOptions={personnelOptions}
                      disabled={!canManageAdHocTeams}
                    />
                  </details>
                  <details>
                    <summary>צור איש צוות ושייך</summary>
                    <ManualAdHocMemberForm incidentId={incidentId} adHocTeamId={team.id} disabled={!canManageAdHocTeams} />
                  </details>
                </div>
              ) : null}
            </article>
          ))
        )}
      </div>
    </section>
  );
}
