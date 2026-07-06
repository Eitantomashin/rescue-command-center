"use client";

import Link from "next/link";

const text = {
  actions: "\u05e4\u05e2\u05d5\u05dc\u05d5\u05ea \u05d9\u05e6\u05d9\u05e8\u05d4",
  newIncident: "\u05e4\u05ea\u05d9\u05d7\u05ea \u05d0\u05d9\u05e8\u05d5\u05e2 \u05d7\u05d3\u05e9",
  personnel: "\u05e4\u05ea\u05d9\u05d7\u05d4/\u05e2\u05d3\u05db\u05d5\u05df \u05db\"\u05d0 \u05d9\u05d7\u05d9\u05d3\u05ea\u05d9",
  newSite: "\u05d4\u05e7\u05de\u05ea \u05d0\u05ea\u05e8"
};

export function CommandActionPanel({
  incidentId,
  isExpanded,
  onToggle,
  systemRole
}: {
  incidentId: string;
  isExpanded: boolean;
  onToggle: () => void;
  systemRole: string | null;
}) {
  const canManageIncidents = systemRole === "admin" || systemRole === "commander";

  if (!canManageIncidents) return null;

  return (
    <aside className={`command-action-panel${isExpanded ? "" : " collapsed"}`} aria-label={text.actions}>
      <button
        className="command-action-toggle"
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        aria-label={isExpanded ? "\u05e6\u05de\u05e6\u05dd \u05e4\u05e2\u05d5\u05dc\u05d5\u05ea \u05de\u05d4\u05d9\u05e8\u05d5\u05ea" : "\u05d4\u05e8\u05d7\u05d1 \u05e4\u05e2\u05d5\u05dc\u05d5\u05ea \u05de\u05d4\u05d9\u05e8\u05d5\u05ea"}
      >
        <span aria-hidden="true">{isExpanded ? "\u203a" : "\u2039"}</span>
      </button>
      <div className="command-action-panel-body" aria-hidden={!isExpanded}>
        <strong>{text.actions}</strong>
        <Link className="command-action-button" href="/incidents/new">
          <span aria-hidden="true">+</span>
          {text.newIncident}
        </Link>
        <Link className="command-action-button" href="/personnel">
          <span aria-hidden="true">+</span>
          {text.personnel}
        </Link>
        <Link className="command-action-button" href={`/incidents/${incidentId}/sites/new`}>
          <span aria-hidden="true">+</span>
          {text.newSite}
        </Link>
      </div>
    </aside>
  );
}
