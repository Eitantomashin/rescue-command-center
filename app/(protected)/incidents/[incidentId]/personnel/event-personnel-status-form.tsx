"use client";

import { useFormState } from "react-dom";
import { OperationalLoadingButton } from "@/app/(protected)/operational-loading-button";
import { ATTENDANCE_STATUSES, type AttendanceStatus } from "../../../personnel/personnel-options";
import { setEventPersonnelStatus, type PersonnelActionState } from "./actions";

const initialState: PersonnelActionState = {
  error: null,
  success: null
};

type EventPersonnelStatusFormProps = {
  incidentId: string;
  personnelId: string;
  attendanceStatus: AttendanceStatus;
};

export function EventPersonnelStatusForm({
  incidentId,
  personnelId,
  attendanceStatus
}: EventPersonnelStatusFormProps) {
  const [state, formAction] = useFormState(setEventPersonnelStatus, initialState);

  return (
    <form action={formAction} className="inline-status-form">
      <input type="hidden" name="incidentId" value={incidentId} />
      <input type="hidden" name="personnelId" value={personnelId} />
      <select className="input" name="attendanceStatus" defaultValue={attendanceStatus}>
        {ATTENDANCE_STATUSES.map(([value, label]) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </select>
      <OperationalLoadingButton className="button secondary" label="עדכן" loadingLabel="מעדכן..." />
      {state.error ? <p className="error" role="alert">{state.error}</p> : null}
      {state.success ? <p className="success-message" role="status">{state.success}</p> : null}
    </form>
  );
}
