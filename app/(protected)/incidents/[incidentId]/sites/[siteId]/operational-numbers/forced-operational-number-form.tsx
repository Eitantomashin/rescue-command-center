"use client";

import { useFormState } from "react-dom";
import {
  createForcedOperationalNumberWithState,
  type ForcedOperationalNumberState
} from "./actions";
import { OperationalLoadingButton } from "@/app/(protected)/operational-loading-button";

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
  return <OperationalLoadingButton className="button secondary" label={"\u05e4\u05ea\u05d7 \u05de\u05e1\u05e4\u05e8 \u05de\u05d0\u05d5\u05dc\u05e5"} loadingLabel={"\u05e4\u05d5\u05ea\u05d7..."} />;
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
