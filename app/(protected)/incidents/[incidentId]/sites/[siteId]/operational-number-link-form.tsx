"use client";

import { useState } from "react";

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
      <button className="button secondary" type="submit" disabled={!selectedPersonId || !hasOptions}>
        עדכן מספר מבצעי
      </button>
    </form>
  );
}
