"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { formatNumber } from "@/lib/format";

export type IncidentShellIncident = {
  id: string;
  name: string;
  is_closed: boolean;
};

export type IncidentShellSite = {
  site_id: string;
  site_number: number;
  name: string | null;
  city: string | null;
  street: string | null;
  house_number: string | null;
  updated_potential: number;
  active_operational_numbers_count?: number | null;
  gap_resolved_count?: number | null;
  operational_gap: number;
};

export type IncidentShellSummary = {
  updated_potential: number;
  active_operational_numbers_count?: number | null;
  gap_resolved_count?: number | null;
  operational_gap: number;
  total_sites?: number | null;
  active_teams?: number | null;
  operational_numbers_rescued_count?: number | null;
  operational_numbers_evacuated_count?: number | null;
  operational_numbers_located_outside_site_count?: number | null;
  operational_numbers_deceased_count?: number | null;
};

function siteLabel(site: IncidentShellSite) {
  if (site.name?.trim()) {
    return site.name.trim();
  }

  const address = [site.street, site.house_number].filter(Boolean).join(" ").trim();
  return address || `אתר ${site.site_number}`;
}

function siteHref(incidentId: string, siteId: string) {
  return `/incidents/${incidentId}/sites/${siteId}`;
}

function activeClass(pathname: string, href: string, exact = true) {
  const isActive = exact ? pathname === href : pathname.startsWith(href);
  return isActive ? " active" : "";
}

function currentSiteFromPath(pathname: string, sites: IncidentShellSite[]) {
  return sites.find((site) => pathname.includes(`/sites/${site.site_id}`)) ?? null;
}

function gapLevel(updatedPotential: number, activeOperationalNumbers: number) {
  if (updatedPotential <= 0) {
    return "low";
  }

  const coverage = Math.round((activeOperationalNumbers / updatedPotential) * 100);
  const gapPercent = 100 - Math.max(0, Math.min(100, coverage));

  if (gapPercent >= 35) {
    return "high";
  }

  if (gapPercent >= 10) {
    return "medium";
  }

  return "low";
}

function siteGapLevel(site: IncidentShellSite) {
  if (site.operational_gap <= 0) {
    return "low";
  }

  return gapLevel(site.updated_potential, site.active_operational_numbers_count ?? site.gap_resolved_count ?? 0);
}

function breadcrumbItems(incident: IncidentShellIncident, sites: IncidentShellSite[], pathname: string) {
  const base = `/incidents/${incident.id}`;
  const currentSite = currentSiteFromPath(pathname, sites);
  const items = [
    { label: "אירועים", href: "/incidents" },
    { label: incident.name, href: base }
  ];

  if (pathname === `${base}/operational-log`) {
    items.push({ label: "יומן מבצעי כללי", href: pathname });
    return items;
  }

  if (pathname === `${base}/sites`) {
    items.push({ label: "כל האתרים", href: pathname });
    return items;
  }

  if (pathname === `${base}/personnel`) {
    items.push({ label: "כח אדם באירוע", href: pathname });
    return items;
  }

  if (pathname.startsWith(`${base}/sitreps`)) {
    items.push({ label: "חיתוכי מצב", href: `${base}/sitreps` });
    return items;
  }

  if (pathname === `${base}/sites/new`) {
    items.push({ label: "הקמת אתר", href: pathname });
    return items;
  }

  if (currentSite) {
    const currentSiteHref = siteHref(incident.id, currentSite.site_id);
    items.push({ label: siteLabel(currentSite), href: currentSiteHref });

    if (pathname === `${currentSiteHref}/operational-numbers`) {
      items.push({ label: "מספרים מבצעיים", href: pathname });
    } else if (pathname === `${currentSiteHref}/grid-map`) {
      items.push({ label: "ריכוז פעילות מול תא שטח", href: pathname });
    } else if (pathname === `${currentSiteHref}/operational-log`) {
      items.push({ label: "יומן מבצעי אתר", href: pathname });
    }
  }

  return items;
}

export function IncidentCommandShell({
  incident,
  sites,
  summary,
  children
}: {
  incident: IncidentShellIncident;
  sites: IncidentShellSite[];
  summary: IncidentShellSummary;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const base = `/incidents/${incident.id}`;
  const activeOperationalNumbers = summary.active_operational_numbers_count ?? summary.gap_resolved_count ?? 0;
  const completedOperationalNumbers =
    (summary.operational_numbers_rescued_count ?? 0) +
    (summary.operational_numbers_evacuated_count ?? 0) +
    (summary.operational_numbers_located_outside_site_count ?? 0) +
    (summary.operational_numbers_deceased_count ?? 0);
  const knownInTreatment = Math.max(0, activeOperationalNumbers - completedOperationalNumbers);
  const coverage =
    summary.updated_potential > 0 ? Math.round((activeOperationalNumbers / summary.updated_potential) * 100) : 0;
  const breadcrumbs = breadcrumbItems(incident, sites, pathname);

  return (
    <div className="incident-command-layout">
      <aside className="incident-nav-tree" aria-label="ניווט אירוע">
        <div className="incident-nav-header">
          <span className="nav-icon nav-icon-incident" aria-hidden="true">!</span>
          <strong>{incident.name}</strong>
        </div>

        <nav>
          <Link className={`incident-nav-item${activeClass(pathname, base)}`} href={base}>
            <span className="nav-icon" aria-hidden="true">ד</span>
            דשבורד מפקד
          </Link>
          <Link className={`incident-nav-item${activeClass(pathname, `${base}/operational-log`)}`} href={`${base}/operational-log`}>
            <span className="nav-icon" aria-hidden="true">י</span>
            יומן מבצעי כללי
          </Link>
          <Link className={`incident-nav-item${activeClass(pathname, `${base}/sites`)}`} href={`${base}/sites`}>
            <span className="nav-icon" aria-hidden="true">א</span>
            כל האתרים
          </Link>
          <Link className={`incident-nav-item${activeClass(pathname, `${base}/personnel`)}`} href={`${base}/personnel`}>
            <span className="nav-icon" aria-hidden="true">כ</span>
            כח אדם באירוע
          </Link>
          <Link className={`incident-nav-item${activeClass(pathname, `${base}/sitreps`, false)}`} href={`${base}/sitreps`}>
            <span className="nav-icon" aria-hidden="true">ח</span>
            חיתוכי מצב
          </Link>

          <div className="incident-site-tree">
            {sites.map((site) => {
              const rootHref = siteHref(incident.id, site.site_id);
              const isCurrentSite = pathname.startsWith(rootHref);
              const level = siteGapLevel(site);

              return (
                <details className="incident-site-node" key={site.site_id} open={isCurrentSite}>
                  <summary className={isCurrentSite ? "active" : ""}>
                    <span className={`site-status-dot coverage-${level}`} aria-label={`פער ${level}`} />
                    {siteLabel(site)}
                  </summary>
                  <div className="incident-site-links">
                    <Link className={`incident-nav-item${activeClass(pathname, rootHref)}`} href={rootHref}>
                      <span className="nav-icon" aria-hidden="true">מ</span>
                      תמונת מבנה
                    </Link>
                    <Link
                      className={`incident-nav-item${activeClass(pathname, `${rootHref}/operational-numbers`)}`}
                      href={`${rootHref}/operational-numbers`}
                    >
                      <span className="nav-icon" aria-hidden="true">#</span>
                      מספרים מבצעיים
                    </Link>
                    <Link
                      className={`incident-nav-item${activeClass(pathname, `${rootHref}/grid-map`)}`}
                      href={`${rootHref}/grid-map`}
                    >
                      <span className="nav-icon" aria-hidden="true">▦</span>
                      ריכוז פעילות מול תא שטח
                    </Link>
                    <Link
                      className={`incident-nav-item${activeClass(pathname, `${rootHref}/operational-log`)}`}
                      href={`${rootHref}/operational-log`}
                    >
                      <span className="nav-icon" aria-hidden="true">י</span>
                      יומן מבצעי אתר
                    </Link>
                  </div>
                </details>
              );
            })}
          </div>
        </nav>

        <div className="incident-mini-panel">
          <strong>תמונת מצב</strong>
          <dl>
            <div>
              <dt>פוטנציאל</dt>
              <dd>{formatNumber(summary.updated_potential)}</dd>
            </div>
            <div>
              <dt>פעילים</dt>
              <dd>{formatNumber(activeOperationalNumbers)}</dd>
            </div>
            <div>
              <dt>פער</dt>
              <dd>{formatNumber(summary.operational_gap)}</dd>
            </div>
            <div>
              <dt>כיסוי</dt>
              <dd>{formatNumber(coverage)}%</dd>
            </div>
          </dl>
        </div>
      </aside>

      <div className="incident-command-content">
        <section className="incident-ops-strip operational-status-strip" aria-label="סיכום מבצעי">
          <div className="status-strip-item status-strip-critical">
            <span>🔴 פער מבצעי</span>
            <strong>{formatNumber(summary.operational_gap)}</strong>
          </div>
          <div className="status-strip-item status-strip-warning">
            <span>🟠 ידועים / בטיפול</span>
            <strong>{formatNumber(knownInTreatment)}</strong>
          </div>
          <div className="status-strip-item status-strip-success">
            <span>🟢 טופלו</span>
            <strong>{formatNumber(completedOperationalNumbers)}</strong>
          </div>
          <div className="status-strip-item status-strip-neutral">
            <span>🏢 אתרים</span>
            <strong>{formatNumber(summary.total_sites ?? sites.length)}</strong>
          </div>
        </section>

        <nav className="breadcrumb-bar" aria-label="מיקום נוכחי">
          {breadcrumbs.map((item, index) => (
            <span key={`${item.href}-${item.label}`}>
              {index > 0 ? <span className="breadcrumb-separator">/</span> : null}
              {index === breadcrumbs.length - 1 ? (
                <strong>{item.label}</strong>
              ) : (
                <Link href={item.href}>{item.label}</Link>
              )}
            </span>
          ))}
        </nav>
        {children}
      </div>
    </div>
  );
}
