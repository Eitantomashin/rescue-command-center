"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const text = {
  actions: "\u05e4\u05e2\u05d5\u05dc\u05d5\u05ea \u05d9\u05e6\u05d9\u05e8\u05d4",
  newIncident: "\u05e4\u05ea\u05d9\u05d7\u05ea \u05d0\u05d9\u05e8\u05d5\u05e2 \u05d7\u05d3\u05e9",
  personnel: "\u05e4\u05ea\u05d9\u05d7\u05d4/\u05e2\u05d3\u05db\u05d5\u05df \u05db\"\u05d0 \u05d9\u05d7\u05d9\u05d3\u05ea\u05d9",
  newSite: "\u05d4\u05e7\u05de\u05ea \u05d0\u05ea\u05e8"
};

function incidentIdFromPath(pathname: string) {
  const match = pathname.match(/^\/incidents\/([^/]+)/);
  const incidentId = match?.[1];
  if (!incidentId || incidentId === "new") return null;
  return incidentId;
}

export function CommandActionPanel({ systemRole }: { systemRole: string | null }) {
  const pathname = usePathname();
  const incidentId = incidentIdFromPath(pathname);
  const canManageIncidents = systemRole === "admin" || systemRole === "commander";

  if (!canManageIncidents) return null;

  return (
    <aside className="command-action-panel" aria-label={text.actions}>
      <Link className="command-action-button" href="/incidents/new">
        <span aria-hidden="true">+</span>
        {text.newIncident}
      </Link>
      <Link className="command-action-button" href="/personnel">
        <span aria-hidden="true">+</span>
        {text.personnel}
      </Link>
      {incidentId ? (
        <Link className="command-action-button" href={`/incidents/${incidentId}/sites/new`}>
          <span aria-hidden="true">+</span>
          {text.newSite}
        </Link>
      ) : null}
    </aside>
  );
}
