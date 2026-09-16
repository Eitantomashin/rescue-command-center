"use client";

import { useFormState } from "react-dom";
import { closeIncident, type CloseIncidentState } from "./lifecycle-actions";
import { OperationalLoadingButton } from "../../operational-loading-button";

const initialState: CloseIncidentState = { error: null, blockers: [] };

export function CloseIncidentForm({ incidentId, incidentName, className = "action-form" }: {
  incidentId: string;
  incidentName?: string;
  className?: string;
}) {
  const [state, action] = useFormState(closeIncident, initialState);
  return (
    <form action={action} className={className} dir="rtl">
      <input type="hidden" name="incidentId" value={incidentId} />
      {incidentName ? <strong>{incidentName}</strong> : null}
      <p className="muted">סגירת האירוע תסגור את האתרים ותיצור דוח סגירה. ציוד שאינו פועל ישוחרר מהאירוע. יש להשהות ציוד פועל לפני הסגירה.</p>
      {state.error ? (
        <div role="alert" className="error" style={{ overflowWrap: "anywhere" }}>
          <p>{state.error}</p>
          {state.blockers.length ? (
            <ul>
              {state.blockers.map((item) => (
                <li key={item.assignment_id}>
                  <strong>{item.asset_identifier} — {item.equipment_type_name}</strong>
                  {item.team_name ? <div>צוות: {item.team_name}</div> : null}
                  {item.location ? <div>מיקום: {item.location}</div> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <OperationalLoadingButton className="button danger" label="אשר סגירת אירוע" loadingLabel="סוגר..." />
    </form>
  );
}
