"use client";

import { useFormStatus } from "react-dom";
import { createImmediateSituationReport } from "./actions";

function SubmitButton({ className }: { className: string }) {
  const { pending } = useFormStatus();
  return <button className={className} type="submit" disabled={pending}>{pending ? "יוצר דוח..." : "צור דוח חיתוך מצב"}</button>;
}

export function CreateSitrepButton({ incidentId, className = "button" }: { incidentId: string; className?: string }) {
  const action = createImmediateSituationReport.bind(null, incidentId);
  return <form action={action}><SubmitButton className={className} /></form>;
}
