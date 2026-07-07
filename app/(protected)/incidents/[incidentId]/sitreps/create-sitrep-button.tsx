"use client";

import { OperationalLoadingButton } from "@/app/(protected)/operational-loading-button";
import { createImmediateSituationReport } from "./actions";

export function CreateSitrepButton({ incidentId, className = "button" }: { incidentId: string; className?: string }) {
  const action = createImmediateSituationReport.bind(null, incidentId);
  return (
    <form action={action}>
      <OperationalLoadingButton
        className={className}
        label={"\u05e6\u05d5\u05e8 \u05d3\u05d5\u05d7 \u05d7\u05d9\u05ea\u05d5\u05da \u05de\u05e6\u05d1"}
        loadingLabel={"\u05d9\u05d5\u05e6\u05e8 \u05d3\u05d5\u05d7..."}
      />
    </form>
  );
}
