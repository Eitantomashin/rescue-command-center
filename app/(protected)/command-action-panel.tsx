"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

function incidentIdFromPath(pathname: string) {
  const match = pathname.match(/^\/incidents\/([^/]+)/);
  const incidentId = match?.[1];

  if (!incidentId || incidentId === "new") {
    return null;
  }

  return incidentId;
}

export function CommandActionPanel() {
  const pathname = usePathname();
  const incidentId = incidentIdFromPath(pathname);

  return (
    <aside className="command-action-panel" aria-label="פעולות יצירה">
      <Link className="command-action-button" href="/incidents/new">
        <span aria-hidden="true">+</span>
        פתיחת אירוע חדש
      </Link>
      {incidentId ? (
        <Link className="command-action-button" href={`/incidents/${incidentId}/sites/new`}>
          <span aria-hidden="true">+</span>
          הקמת אתר
        </Link>
      ) : null}
    </aside>
  );
}
