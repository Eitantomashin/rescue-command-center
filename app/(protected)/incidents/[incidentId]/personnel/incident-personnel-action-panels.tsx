"use client";

import { useMemo, useState } from "react";
import { useFormState } from "react-dom";
import { OperationalLoadingButton } from "@/app/(protected)/operational-loading-button";
import {
  addExistingAdHocMemberAction,
  addManualAdHocMemberAction,
  addManualIncidentPersonnelAction,
  archiveAdHocTeamAction,
  createAdHocTeamAction,
  removeAdHocTeamMemberAction,
  updateAdHocTeamAction,
  type PersonnelActionState
} from "./actions";

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
};

const initialState: PersonnelActionState = {
  error: null,
  success: null
};

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

export function IncidentPersonnelActionPanels({
  incidentId,
  canEdit,
  teams,
  sites,
  personnelOptions,
  adHocTeams
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
          <CreateAdHocTeamForm incidentId={incidentId} sites={sites} disabled={!canEdit} />
        </div>
      )}

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
                {canEdit && team.status === "active" ? (
                  <form action={archiveAdHocTeamAction}>
                    <input type="hidden" name="incidentId" value={incidentId} />
                    <input type="hidden" name="adHocTeamId" value={team.id} />
                    <OperationalLoadingButton className="button ghost" label="העבר לארכיון" loadingLabel="מעדכן..." />
                  </form>
                ) : null}
              </div>
              {team.purpose || team.commanderName || team.notes ? (
                <p className="muted">
                  {[team.purpose, team.commanderName ? `מפקד/ת: ${team.commanderName}` : null, team.notes]
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
                        <span>{member.phone ?? "אין טלפון"} · {member.sourceLabel}</span>
                      </div>
                      {member.notes ? <span className="muted">{member.notes}</span> : <span />}
                      {canEdit && team.status === "active" ? (
                        <form action={removeAdHocTeamMemberAction}>
                          <input type="hidden" name="incidentId" value={incidentId} />
                          <input type="hidden" name="memberId" value={member.id} />
                          <OperationalLoadingButton className="button ghost" label="הסר שיוך" loadingLabel="מסיר..." />
                        </form>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
              {canEdit && team.status === "active" ? (
                <div className="ad-hoc-team-forms">
                  <details>
                    <summary>עריכת צוות</summary>
                    <EditAdHocTeamForm incidentId={incidentId} team={team} sites={sites} disabled={!canEdit} />
                  </details>
                  <details>
                    <summary>הוסף איש צוות קיים</summary>
                    <ExistingMemberForm
                      incidentId={incidentId}
                      adHocTeamId={team.id}
                      personnelOptions={personnelOptions}
                      disabled={!canEdit}
                    />
                  </details>
                  <details>
                    <summary>צור איש צוות ושייך</summary>
                    <ManualAdHocMemberForm incidentId={incidentId} adHocTeamId={team.id} disabled={!canEdit} />
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
