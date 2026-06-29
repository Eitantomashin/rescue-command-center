"use client";

import { useFormStatus } from "react-dom";
import { createSearchSiteReport } from "./actions";

function SubmitButton({ className }: { className: string }) {
  const { pending } = useFormStatus();
  return (
    <button className={className} type="submit" disabled={pending}>
      {pending ? "מפיק דוח..." : "הפק דוח סריקה"}
    </button>
  );
}

export function CreateSearchSiteReportButton({
  incidentId,
  siteId,
  className = "button"
}: {
  incidentId: string;
  siteId: string;
  className?: string;
}) {
  const action = createSearchSiteReport.bind(null, incidentId, siteId);
  return (
    <form action={action}>
      <SubmitButton className={className} />
    </form>
  );
}
