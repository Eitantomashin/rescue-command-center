"use client";

import { useFormStatus } from "react-dom";
import { createImmediateSituationReport } from "./actions";

function SubmitButton({ className }: { className: string }) {
  const { pending } = useFormStatus();
  return <button className={className} type="submit" disabled={pending}>{pending ? "\u05d9\u05d5\u05e6\u05e8 \u05d3\u05d5\u05d7..." : "\u05e6\u05d5\u05e8 \u05d3\u05d5\u05d7 \u05d7\u05d9\u05ea\u05d5\u05da \u05de\u05e6\u05d1"}</button>;
}

export function CreateSitrepButton({ incidentId, className = "button" }: { incidentId: string; className?: string }) {
  const action = createImmediateSituationReport.bind(null, incidentId);
  return <form action={action}><SubmitButton className={className} /></form>;
}
