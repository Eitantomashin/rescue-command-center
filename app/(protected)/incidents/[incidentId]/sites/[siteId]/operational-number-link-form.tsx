"use client";

import { useState } from "react";
import { OperationalLoadingButton } from "@/app/(protected)/operational-loading-button";

export type OperationalNumberLinkOption = {
  id: string;
  label: string;
};

export function OperationalNumberLinkForm({
  action,
  incidentId,
  siteId,
  residentId,
  defaultPersonId,
  options
}: {
  action: (formData: FormData) => void | Promise<void>;
  incidentId: string;
  siteId: string;
  residentId: string;
  defaultPersonId: string | null;
  options: OperationalNumberLinkOption[];
}) {
  const [selectedPersonId, setSelectedPersonId] = useState(defaultPersonId ?? "");
  const hasOptions = options.length > 0;

  return (
    <form action={action} className="resident-link-form wide-link-form">
      <input type="hidden" name="incidentId" value={incidentId} />
      <input type="hidden" name="siteId" value={siteId} />
      <input type="hidden" name="residentId" value={residentId} />
      <select
        className="input"
        name="personId"
        required
        value={selectedPersonId}
        onChange={(event) => setSelectedPersonId(event.target.value)}
        disabled={!hasOptions}
      >
        <option value="">קישור למספר מבצעי</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      <OperationalLoadingButton className="button secondary" label={"\u05e2\u05d3\u05db\u05df \u05de\u05e1\u05e4\u05e8 \u05de\u05d1\u05e6\u05e2\u05d9"} loadingLabel={"\u05de\u05e2\u05d3\u05db\u05df..."} disabled={!selectedPersonId || !hasOptions} />
    </form>
  );
}
