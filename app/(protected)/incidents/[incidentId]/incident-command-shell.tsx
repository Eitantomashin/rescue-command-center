"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { formatNumber } from "@/lib/format";

export type IncidentShellIncident = {
  id: string;
  name: string;
};

export type IncidentShellSite = {
  site_id: string;
  site_number: number;
  name: string | null;
  city: string | null;
  street: string | null;
  house_number: string | null;
};

export type IncidentShellSummary = {
  updated_potential: number;
  active_operational_numbers_count?: number | null;
  gap_resolved_count?: number | null;
  operational_gap: number;
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

  if (pathname === `${base}/sites/new`) {
    items.push({ label: "הקמת אתר", href: pathname });
    return items;
  }

  if (currentSite) {
    const currentSiteHref = siteHref(incident.id, currentSite.site_id);
    items.push({ label: siteLabel(currentSite), href: currentSiteHref });

    if (pathname === `${currentSiteHref}/operational-numbers`) {
      items.push({ label: "מספרים מבצעיים", href: pathname });
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
  const coverage =
    summary.updated_potential > 0 ? Math.round((activeOperationalNumbers / summary.updated_potential) * 100) : 0;
  const breadcrumbs = breadcrumbItems(incident, sites, pathname);

  return (
    <div className="incident-command-layout">
      <aside className="incident-nav-tree" aria-label="ניווט אירוע">
        <div className="incident-nav-header">
          <span aria-hidden="true">🚨</span>
          <strong>{incident.name}</strong>
        </div>

        <nav>
          <Link className={`incident-nav-item${activeClass(pathname, base)}`} href={base}>
            <span aria-hidden="true">📊</span>
            דשבורד מפקד
          </Link>
          <Link className={`incident-nav-item${activeClass(pathname, `${base}/operational-log`)}`} href={`${base}/operational-log`}>
            <span aria-hidden="true">📖</span>
            יומן מבצעי כללי
          </Link>
          <Link className={`incident-nav-item${activeClass(pathname, `${base}/sites`)}`} href={`${base}/sites`}>
            <span aria-hidden="true">🏢</span>
            כל האתרים
          </Link>

          <div className="incident-site-tree">
            {sites.map((site) => {
              const rootHref = siteHref(incident.id, site.site_id);
              const isCurrentSite = pathname.startsWith(rootHref);

              return (
                <details className="incident-site-node" key={site.site_id} open={isCurrentSite}>
                  <summary className={isCurrentSite ? "active" : ""}>
                    <span aria-hidden="true">🏢</span>
                    {siteLabel(site)}
                  </summary>
                  <div className="incident-site-links">
                    <Link className={`incident-nav-item${activeClass(pathname, rootHref)}`} href={rootHref}>
                      <span aria-hidden="true">📊</span>
                      תמונת מבנה
                    </Link>
                    <Link
                      className={`incident-nav-item${activeClass(pathname, `${rootHref}/operational-numbers`)}`}
                      href={`${rootHref}/operational-numbers`}
                    >
                      <span aria-hidden="true">👤</span>
                      מספרים מבצעיים
                    </Link>
                    <Link
                      className={`incident-nav-item${activeClass(pathname, `${rootHref}/operational-log`)}`}
                      href={`${rootHref}/operational-log`}
                    >
                      <span aria-hidden="true">📖</span>
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
        <nav className="breadcrumb-bar" aria-label="מיקום נוכחי">
          {breadcrumbs.map((item, index) => (
            <span key={`${item.href}-${item.label}`}>
              {index > 0 ? <span className="breadcrumb-separator">›</span> : null}
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
