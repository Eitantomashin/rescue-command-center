"use client";

import { useEffect, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { addMobileSearchUnit, type AddManualSearchUnitState } from "./actions";

const initialState: AddManualSearchUnitState = { success: false, error: null, refreshVersion: 0 };

function AddManualSearchUnitButton({ locked }: { locked: boolean }) {
  const { pending } = useFormStatus();
  const isPending = locked || pending;

  return <button className="button" type="submit" disabled={isPending} aria-busy={isPending}>{isPending ? "מוסיף..." : "הוסף דירה"}</button>;
}

export function ManualSearchUnitForm({
  incidentId,
  siteId,
  floorId,
  className = "mobile-search-add-unit-form"
}: {
  incidentId: string;
  siteId: string;
  floorId: string;
  className?: string;
}) {
  const [state, formAction] = useFormState(addMobileSearchUnit, initialState);
  const [submitting, setSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const submissionLocked = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const lastHandledVersion = useRef(0);
  const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();

  useEffect(() => () => {
    if (successTimer.current) clearTimeout(successTimer.current);
  }, []);

  useEffect(() => {
    if (state.refreshVersion <= lastHandledVersion.current) return;
    lastHandledVersion.current = state.refreshVersion;

    if (!state.success) {
      submissionLocked.current = false;
      setSubmitting(false);
      return;
    }

    formRef.current?.reset();
    setShowSuccess(true);
    if (successTimer.current) clearTimeout(successTimer.current);
    successTimer.current = setTimeout(() => {
      setShowSuccess(false);
      successTimer.current = null;
    }, 3000);
    router.refresh();
    submissionLocked.current = false;
    setSubmitting(false);
  }, [router, state]);

  function guardSubmission(event: React.FormEvent<HTMLFormElement>) {
    if (submissionLocked.current) {
      event.preventDefault();
      return;
    }
    submissionLocked.current = true;
    setSubmitting(true);
  }

  return (
    <form ref={formRef} action={formAction} className={className} dir="rtl" onSubmit={guardSubmission}>
      <input type="hidden" name="incidentId" value={incidentId} />
      <input type="hidden" name="siteId" value={siteId} />
      <input type="hidden" name="floorId" value={floorId} />
      <label>
        שם או מספר הדירה שדווח בשטח
        <input className="input" name="reportedUnitNumber" inputMode="text" placeholder="לדוגמה: דירה 2 מפוצלת" />
      </label>
      <label>
        הערות
        <textarea className="input" name="manualUnitNotes" rows={2} placeholder="אופציונלי" />
      </label>
      <p className="mobile-search-add-unit-help">השם שהוזן יוצג בכל מסכי הסריקה, ולא ישנה מספרי דירות קיימים.</p>
      {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}
      {showSuccess ? <p className="search-unit-save-success" role="status">הדירה נוספה בהצלחה</p> : null}
      <AddManualSearchUnitButton locked={submitting} />
    </form>
  );
}
