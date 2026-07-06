"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { formatNumber } from "@/lib/format";
import { isSearchSite, searchStatusLabel, siteTypeLabel } from "@/lib/site-display";

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
  site_type?: string | null;
  search_status?: string | null;
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

  if (pathname === `${base}/war-room`) {
    items.push({ label: "\u05de\u05e1\u05da \u05d7\u05de\u05f4\u05dc", href: pathname });
    return items;
  }

  if (pathname === `${base}/casualties-dashboard`) {
    items.push({ label: "\u05d3\u05e9\u05d1\u05d5\u05e8\u05d3 \u05e0\u05e4\u05d2\u05e2\u05d9\u05dd", href: pathname });
    return items;
  }

  if (pathname === `${base}/operational-log`) {
    items.push({ label: "יומן מבצעי כללי", href: pathname });
    return items;
  }

  if (pathname === `${base}/sites`) {
    items.push({ label: "כל האתרים", href: pathname });
    return items;
  }

  if (pathname === `${base}/cancelled-sites`) {
    items.push({ label: "אתרים שבוטלו", href: pathname });
    return items;
  }

  if (pathname === `${base}/personnel`) {
    items.push({ label: "כח אדם באירוע", href: pathname });
    return items;
  }

  if (pathname.startsWith(`${base}/sitreps`)) {
    items.push({ label: "דוחות", href: `${base}/sitreps` });
    items.push({ label: "חיתוכי מצב", href: `${base}/sitreps` });
    return items;
  }

  if (pathname.startsWith(`${base}/reports/closure`)) {
    items.push({ label: "דוחות", href: `${base}/sitreps` });
    items.push({ label: "דוח סגירת אירוע", href: `${base}/reports/closure` });
    return items;
  }

  if (pathname.startsWith(`${base}/reports/search-sites`)) {
    items.push({ label: "דוחות", href: `${base}/sitreps` });
    items.push({ label: "דוחות אתרי סריקה", href: `${base}/reports/search-sites` });
    return items;
  }

  if (pathname === `${base}/timeline`) {
    items.push({ label: "ציר זמן מבצעי", href: pathname });
    return items;
  }

  if (pathname === `${base}/investigation-assistant`) {
    items.push({ label: "עוזר תחקור", href: pathname });
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
  const isCommanderDashboard = pathname === base;
  const isWarRoom = pathname === `${base}/war-room`;
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
  const reportsActive =
    pathname.startsWith(`${base}/sitreps`) ||
    pathname.startsWith(`${base}/reports/closure`) ||
    pathname.startsWith(`${base}/reports/search-sites`);

  return (
    <div className="incident-command-layout">
      <aside className="incident-nav-tree" aria-label="ניווט אירוע">
        <div className="incident-nav-header">
          <span className="nav-icon nav-icon-incident" aria-hidden="true">!</span>
          <strong>{incident.name}</strong>
        </div>

        <nav>
          <Link className={`incident-nav-item${activeClass(pathname, base)}`} href={base}>
            <span className="nav-icon" aria-hidden="true">📊</span>
            <span className="nav-label">דשבורד מפקד</span>
          </Link>
          <Link className={`incident-nav-item${activeClass(pathname, `${base}/war-room`)}`} href={`${base}/war-room`}>
            <span className="nav-icon" aria-hidden="true">{"\uD83D\uDDA5\uFE0F"}</span>
            <span className="nav-label">{"\u05de\u05e1\u05da \u05d7\u05de\u05f4\u05dc"}</span>
          </Link>
          <Link className={`incident-nav-item${activeClass(pathname, `${base}/casualties-dashboard`)}`} href={`${base}/casualties-dashboard`}>
            <span className="nav-icon" aria-hidden="true">{"\u26d1"}</span>
            <span className="nav-label">{"\u05d3\u05e9\u05d1\u05d5\u05e8\u05d3 \u05e0\u05e4\u05d2\u05e2\u05d9\u05dd"}</span>
          </Link>
          <Link className={`incident-nav-item${activeClass(pathname, `${base}/operational-log`)}`} href={`${base}/operational-log`}>
            <span className="nav-icon" aria-hidden="true">📝</span>
            <span className="nav-label">יומן מבצעי כללי</span>
          </Link>
          <Link className={`incident-nav-item${activeClass(pathname, `${base}/sites`)}`} href={`${base}/sites`}>
            <span className="nav-icon" aria-hidden="true">🏢</span>
            <span className="nav-label">כל האתרים</span>
            <span className="nav-badge">{formatNumber(summary.total_sites ?? sites.length)}</span>
          </Link>
          <Link className={`incident-nav-item${activeClass(pathname, `${base}/personnel`)}`} href={`${base}/personnel`}>
            <span className="nav-icon" aria-hidden="true">👥</span>
            <span className="nav-label">כח אדם באירוע</span>
          </Link>
          <details className="incident-site-node incident-report-node incident-nav-collapsible-section">
            <summary className={reportsActive ? "active" : ""}>
              <span className="nav-icon" aria-hidden="true">{"\uD83D\uDCCB"}</span>
              <span className="nav-label">{"\u05d3\u05d5\u05d7\u05d5\u05ea"}</span>
            </summary>
            <div className="incident-site-links">
              <Link className={`incident-nav-item${activeClass(pathname, `${base}/sitreps`, false)}`} href={`${base}/sitreps`}>
                <span className="nav-icon" aria-hidden="true">{"\uD83D\uDCCB"}</span>
                <span className="nav-label">{"\u05d3\u05d5\u05d7 \u05d9\u05d5\u05de\u05d9 \u05de\u05e6\u05d1"}</span>
              </Link>
              <Link className={`incident-nav-item${activeClass(pathname, `${base}/reports/closure`, false)}`} href={`${base}/reports/closure`}>
                <span className="nav-icon" aria-hidden="true">{"\uD83C\uDFC1"}</span>
                <span className="nav-label">{"\u05d3\u05d5\u05d7 \u05e1\u05d2\u05d9\u05e8\u05ea \u05d0\u05d9\u05e8\u05d5\u05e2"}</span>
              </Link>
              <Link className={`incident-nav-item${activeClass(pathname, `${base}/reports/search-sites`, false)}`} href={`${base}/reports/search-sites`}>
                <span className="nav-icon" aria-hidden="true">{"\uD83D\uDD0E"}</span>
                <span className="nav-label">דוחות אתרי סריקה</span>
              </Link>
            </div>
          </details>
          <details className="incident-site-node incident-tools-node incident-nav-collapsible-section">
            <summary className={pathname === `${base}/timeline` || pathname === `${base}/investigation-assistant` ? "active" : ""}>
              <span className="nav-icon" aria-hidden="true">{"\uD83E\uDDED"}</span>
              <span className="nav-label">{"\u05db\u05dc\u05d9 \u05e2\u05d6\u05e8"}</span>
            </summary>
            <div className="incident-site-links">
              <Link className={`incident-nav-item${activeClass(pathname, `${base}/timeline`)}`} href={`${base}/timeline`}>
                <span className="nav-icon" aria-hidden="true">{"\uD83D\uDD52"}</span>
                <span className="nav-label">{"\u05e6\u05d9\u05e8 \u05d6\u05de\u05df \u05de\u05d1\u05e6\u05e2\u05d9"}</span>
              </Link>
              <Link className={`incident-nav-item${activeClass(pathname, `${base}/investigation-assistant`)}`} href={`${base}/investigation-assistant`}>
                <span className="nav-icon" aria-hidden="true">{"\uD83E\uDD89"}</span>
                <span className="nav-label">{"\u05e2\u05d5\u05d6\u05e8 \u05d4\u05ea\u05d7\u05e7\u05d5\u05e8"}</span>
              </Link>
            </div>
          </details>

          <div className="incident-site-tree">
            {sites.map((site) => {
              const rootHref = siteHref(incident.id, site.site_id);
              const isCurrentSite = pathname.startsWith(rootHref);
              const level = siteGapLevel(site);
              const searchSite = isSearchSite(site);

              return (
                <details className={`incident-site-node${searchSite ? " search-site-node" : ""}`} key={site.site_id} open={isCurrentSite}>
                  <summary className={isCurrentSite ? "active" : ""}>
                    <span className={`site-status-dot coverage-${level}`} aria-label={`\u05e4\u05e2\u05e8 ${level}`} />
                    <span className="site-nav-main">
                      <span className="nav-label site-nav-name">{siteLabel(site)}</span>
                      <span className="nav-badge-stack">
                        <span className={`nav-badge site-type-badge ${searchSite ? "search-site" : "rescue-site"}`}>{siteTypeLabel(site.site_type)}</span>
                        {searchSite ? <span className="nav-badge search-status-badge">{searchStatusLabel(site.search_status)}</span> : null}
                        {site.operational_gap > 0 ? <span className="nav-badge danger">{"\u05e4\u05e2\u05e8"} {formatNumber(site.operational_gap)}</span> : null}
                      </span>
                    </span>
                  </summary>
                  <div className="incident-site-links">
                    <Link className={`incident-nav-item${activeClass(pathname, rootHref)}`} href={rootHref}>
                      <span className="nav-icon" aria-hidden="true">📊</span>
                      <span className="nav-label">תמונת מבנה</span>
                    </Link>
                    <Link
                      className={`incident-nav-item${activeClass(pathname, `${rootHref}/operational-numbers`)}`}
                      href={`${rootHref}/operational-numbers`}
                    >
                      <span className="nav-icon" aria-hidden="true">👤</span>
                      <span className="nav-label">מספרים מבצעיים</span>
                    </Link>
                    <Link
                      className={`incident-nav-item${activeClass(pathname, `${rootHref}/grid-map`)}`}
                      href={`${rootHref}/grid-map`}
                    >
                      <span className="nav-icon" aria-hidden="true">🗺️</span>
                      <span className="nav-label">ריכוז פעילות מול תא שטח</span>
                    </Link>
                    <Link
                      className={`incident-nav-item${activeClass(pathname, `${rootHref}/operational-log`)}`}
                      href={`${rootHref}/operational-log`}
                    >
                      <span className="nav-icon" aria-hidden="true">📝</span>
                      <span className="nav-label">יומן מבצעי אתר</span>
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

      <div className={`incident-command-content${isCommanderDashboard ? " commander-dashboard-content" : ""}`}>
        {isCommanderDashboard ? (
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
        ) : null}

        {!isWarRoom ? (
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
        ) : null}
        {children}
      </div>
    </div>
  );
}
