"use client";

import { OperationalLoadingButton } from "@/app/(protected)/operational-loading-button";
import { createSearchSiteReport } from "./actions";

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
      <OperationalLoadingButton className={className} label="הפק דוח סריקה" loadingLabel="מפיק דוח..." />
    </form>
  );
}
