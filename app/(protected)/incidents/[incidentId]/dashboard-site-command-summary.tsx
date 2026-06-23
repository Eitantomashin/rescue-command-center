"use client";

import { formatNumber } from "@/lib/format";

export type SiteUnitAnalysisRow = {
  id: string;
  floorNumber: number | null;
  unitLabel: string;
  totalResidents: number;
  expectedPotential: number;
  knownHandled: number;
  gap: number;
};

export type SiteStatusSegments = {
  missingUnknown: number;
  inProgress: number;
  completed: number;
  deceased: number;
  other: number;
};

export type SiteStatusCard = {
  label: string;
  count: number;
  delta: number | null;
};

export type SiteAnalysisRow = {
  siteId: string;
  name: string;
  address: string;
  statusLabel: string | null;
  initialPotential: number;
  updatedPotential: number;
  activeOperationalNumbers: number;
  knownHandled: number;
  operationalGap: number;
  level: "high" | "medium" | "low";
  teams: string[];
  structureHref: string;
  operationalNumbersHref: string;
  operationalLogHref: string;
  units: SiteUnitAnalysisRow[];
  statusSegments: SiteStatusSegments;
  statusCards: SiteStatusCard[];
};

function gapStatusLabel(site: SiteAnalysisRow) {
  if (site.operationalGap === 0) return "ללא פער";
  if (site.level === "high") return "פער גבוה";
  if (site.level === "medium") return "פער בינוני";
  return "פער נמוך";
}

function DeltaBadge({ value }: { value: number | null }) {
  if (value === null || value === 0) {
    return <span className="site-status-delta neutral">0</span>;
  }

  return (
    <span className={`site-status-delta ${value > 0 ? "up" : "down"}`} dir="ltr">
      {value > 0 ? `+${value}` : value}
    </span>
  );
}

export function DashboardSiteCommandSummary({ sites }: { sites: SiteAnalysisRow[] }) {
  return (
    <section className="panel section-spaced site-decision-panel">
      <div className="command-section-heading">
        <div>
          <h2>פירוט לפי אתר</h2>
          <p className="muted">תמונת מצב תפעולית מלאה לפי אתר, כולל דלתא מול חיתוך המצב האחרון.</p>
        </div>
      </div>

      {sites.length === 0 ? (
        <p className="muted">לא נמצאו אתרים להצגה.</p>
      ) : (
        <div className="site-command-summary-list">
          {sites.map((site) => (
            <article className={`site-command-summary-card coverage-${site.level}`} key={site.siteId}>
              <header className="site-command-summary-top">
                <div>
                  <h3>{site.name}</h3>
                  <p>{site.address || "ללא כתובת"}</p>
                </div>
                <span className={`command-badge coverage-${site.level}`}>{gapStatusLabel(site)}</span>
              </header>

              <div className="site-command-facts" aria-label={`תמונת אתר ${site.name}`}>
                <div>
                  <span>סטטוס</span>
                  <strong>{site.statusLabel ?? "נפתח"}</strong>
                </div>
                <div>
                  <span>פוטנציאל מעודכן</span>
                  <strong>{formatNumber(site.updatedPotential)}</strong>
                </div>
                <div>
                  <span>פער מבצעי</span>
                  <strong>{formatNumber(site.operationalGap)}</strong>
                </div>
                <div>
                  <span>צוותים פעילים</span>
                  <strong>{site.teams.length ? site.teams.join(", ") : "ללא צוות"}</strong>
                </div>
              </div>

              <div className="site-anchor-status-grid">
                {site.statusCards.length === 0 ? (
                  <p className="muted">אין מספרים מבצעיים פעילים באתר.</p>
                ) : (
                  site.statusCards.map((status) => (
                    <div className="site-anchor-status-card" key={status.label}>
                      <span>{status.label}</span>
                      <strong>{formatNumber(status.count)}</strong>
                      <DeltaBadge value={status.delta} />
                    </div>
                  ))
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
