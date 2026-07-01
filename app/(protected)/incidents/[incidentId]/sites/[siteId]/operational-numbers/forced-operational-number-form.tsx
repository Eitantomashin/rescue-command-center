"use client";

import { useFormState, useFormStatus } from "react-dom";
import {
  createForcedOperationalNumberWithState,
  type ForcedOperationalNumberState
} from "./actions";

type TeamOption = {
  number: number;
  label: string;
};

type ForcedOperationalNumberFormProps = {
  incidentId: string;
  siteId: string;
  teams: TeamOption[];
  activeTeam: number | null;
};

const initialState: ForcedOperationalNumberState = {
  error: null,
  success: null
};

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button className="button secondary" type="submit" disabled={pending}>
      {pending ? "פותח..." : "פתח מספר מאולץ"}
    </button>
  );
}

export function ForcedOperationalNumberForm({
  incidentId,
  siteId,
  teams,
  activeTeam
}: ForcedOperationalNumberFormProps) {
  const [state, formAction] = useFormState(createForcedOperationalNumberWithState, initialState);
  const currentState = state ?? initialState;

  return (
    <details className="create-number-panel force-number-panel">
      <summary className="button secondary">פתיחה מאולצת</summary>
      <form action={formAction} className="action-form">
        <input type="hidden" name="incidentId" value={incidentId} />
        <input type="hidden" name="siteId" value={siteId} />
        <strong>פתיחה מאולצת של מספר מבצעי</strong>
        <p className="warning-text">
          המספר המבוקש אינו עוקב. המערכת תפתח את המספר המבוקש בלבד. מספרים חסרים לא ייכללו בחישובים או בדוחות עד שייפתחו בפועל.
        </p>
        {currentState?.error ? (
          <p className="error" role="alert">
            {currentState.error}
          </p>
        ) : null}
        <div className="form-grid">
          <label>
            צוות
            <select className="input" name="teamNumber" defaultValue={activeTeam ?? ""} required>
              <option value="">בחר צוות</option>
              {teams.map((team) => (
                <option key={team.number} value={team.number}>
                  {team.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            מספר מבצעי מבוקש
            <input className="input" name="operationalNumber" type="number" min="1" placeholder="לדוגמה 105" required />
          </label>
          <label className="wide">
            סיבה / הערה
            <input className="input" name="reason" placeholder="לדוגמה: דיווח שטח" required />
          </label>
        </div>
        <SubmitButton />
      </form>
    </details>
  );
}
