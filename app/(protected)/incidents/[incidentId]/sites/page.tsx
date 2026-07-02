import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatNumber } from "@/lib/format";
import { isSearchSite, searchStatusLabel, siteTypeLabel } from "@/lib/site-display";
import { cancelSiteFromListAction, importSiteResidentListAction, updateSiteFromListAction } from "./actions";
import {
  ImportedSiteResidentsTable,
  SiteResidentImportForm,
  type ImportedSiteResidentListRow
} from "./imported-site-residents-table";
import { OperationalLoadingButton } from "@/app/(protected)/operational-loading-button";

type SiteRow = {
  incident_id: string;
  site_id: string;
  site_number: number;
  name: string | null;
  city: string | null;
  street: string;
  house_number: string;
  site_status_label: string | null;
  initial_potential: number;
  updated_potential: number;
  total_active_units: number;
  fully_cleared_units: number;
  open_units: number;
  open_persons: number;
  gap_resolved_count: number;
  resolved_persons: number;
  operational_gap: number;
  site_type?: string | null;
  search_status?: string | null;
  search_reason?: string | null;
  search_priority?: string | null;
};

export default async function SitesPage({
  params,
  searchParams
}: {
  params: { incidentId: string };
  searchParams?: { residentImport?: string; count?: string; siteId?: string };
}) {
  const supabase = createClient();

  const [
    { data: incident },
    { data, error },
    { data: siteMetadataRows },
    { data: importedResidentRows },
    { data: canManageSites },
    { data: canCancelSites },
    { data: currentRole }
  ] = await Promise.all([
    supabase.from("incidents").select("id,name").eq("id", params.incidentId).maybeSingle(),
    supabase.from("site_dashboard_summary").select("*").eq("incident_id", params.incidentId).order("site_number", { ascending: true }),
    supabase
      .from("sites")
      .select("id,site_type,search_status,search_reason,search_priority")
      .eq("incident_id", params.incidentId)
      .eq("is_active", true),
    supabase
      .from("imported_site_residents")
      .select("id,site_id,floor,apartment,first_name,last_name,gender,age,phone,notes,linked_resident_id")
      .eq("incident_id", params.incidentId)
      .eq("is_active", true)
      .order("created_at", { ascending: false }),
    supabase.rpc("can_manage_sites", { p_incident_id: params.incidentId }),
    supabase.rpc("can_edit_operational_data", { p_incident_id: params.incidentId }),
    supabase.rpc("current_user_role")
  ]);

  const siteMetadata = new Map(
    (
      (siteMetadataRows ?? []) as Array<{
        id: string;
        site_type: string | null;
        search_status: string | null;
        search_reason: string | null;
        search_priority: string | null;
      }>
    ).map((site) => [site.id, site])
  );
  const sites = ((data ?? []) as SiteRow[]).map((site) => ({
    ...site,
    site_type: siteMetadata.get(site.site_id)?.site_type ?? "rescue_site",
    search_status: siteMetadata.get(site.site_id)?.search_status ?? null,
    search_reason: siteMetadata.get(site.site_id)?.search_reason ?? null,
    search_priority: siteMetadata.get(site.site_id)?.search_priority ?? null
  }));
  const siteLabelById = new Map(
    sites.map((site) => [
      site.site_id,
      site.name ?? `אתר ${site.site_number} - ${site.street} ${site.house_number}`
    ])
  );
  const importedResidents: ImportedSiteResidentListRow[] = ((importedResidentRows ?? []) as Array<
    Omit<ImportedSiteResidentListRow, "site_label"> & { site_id: string }
  >).map((row) => ({
    ...row,
    site_label: siteLabelById.get(row.site_id) ?? "אתר לא ידוע"
  }));

  return (
    <main className="page">
      <div className="header">
        <div>
          <h1>אתרים</h1>
          <p className="muted">{incident?.name ?? "אירוע"}</p>
        </div>

        <div className="actions">
          {currentRole === "admin" ? (
            <Link className="button secondary" href={`/incidents/${params.incidentId}/cancelled-sites`}>
              אתרים שבוטלו
            </Link>
          ) : null}
          {canManageSites ? (
          <Link className="button" href={`/incidents/${params.incidentId}/sites/new`}>
            הקמת אתר חדש
          </Link>
          ) : null}
          <Link className="button secondary" href={`/incidents/${params.incidentId}`}>
            חזרה לדשבורד
          </Link>
        </div>
      </div>

      {error ? (
        <section className="panel">
          <p className="error">לא ניתן לטעון אתרים: {error.message}</p>
        </section>
      ) : null}

      {searchParams?.residentImport === "success" ? (
        <section className="panel success-panel">
          <p>רשימת הדיירים נטענה בהצלחה. נוספו {formatNumber(Number(searchParams.count ?? 0))} רשומות.</p>
        </section>
      ) : null}

      <section className="panel">
        {sites.length === 0 ? (
          <p className="muted">לא נמצאו אתרים לאירוע זה.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>אתר</th>
                <th>כתובת</th>
                <th className="site-type-header">{"\u05e1\u05d5\u05d2 \u05d0\u05ea\u05e8"}</th>
                <th>סטטוס</th>
                <th>פוטנציאל</th>
                <th>יחידות פתוחות</th>
                <th>זיכוי מלא</th>
                <th>טופלו / ידועים</th>
                <th>פער</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sites.map((site) => (
                <tr key={site.site_id}>
                  <td>
                    אתר {site.site_number}
                    {site.name ? <div className="muted">{site.name}</div> : null}
                  </td>
                  <td>
                    {site.street} {site.house_number}
                    {site.city ? <div className="muted">{site.city}</div> : null}
                  </td>
                  <td className="site-type-column">
                    <span className={`site-type-badge ${isSearchSite(site) ? "search-site" : "rescue-site"}`}>
                      {siteTypeLabel(site.site_type)}
                    </span>
                    {isSearchSite(site) ? <div className="muted search-status-inline">{searchStatusLabel(site.search_status)}</div> : null}
                  </td>
                  <td>{site.site_status_label ?? "-"}</td>
                  <td>
                    {formatNumber(site.initial_potential)} /{" "}
                    {formatNumber(site.updated_potential)}
                  </td>
                  <td>{formatNumber(site.open_units)}</td>
                  <td>
                    {formatNumber(site.fully_cleared_units)} /{" "}
                    {formatNumber(site.total_active_units)}
                  </td>
                  <td>{formatNumber(site.gap_resolved_count)}</td>
                  <td className="table-emphasis">{formatNumber(site.operational_gap)}</td>
                  <td>
                    <div className="site-list-actions">
                    <Link
                      className="button secondary"
                      href={`/incidents/${params.incidentId}/sites/${site.site_id}`}
                    >
                      פתיחת תמונת מבנה
                    </Link>
                    {canCancelSites ? (
                      <details className="inline-confirm-panel site-list-edit-panel">
                        <summary className="button secondary">עריכת אתר</summary>
                        <form action={updateSiteFromListAction} className="action-form">
                          <input type="hidden" name="incidentId" value={params.incidentId} />
                          <input type="hidden" name="siteId" value={site.site_id} />
                          <strong>עריכת פרטי אתר</strong>
                          <div className="form-grid">
                            <label>
                              שם האתר
                              <input className="input" name="siteName" defaultValue={site.name ?? ""} />
                            </label>
                            <label>
                              סוג האתר
                              <select className="input" name="siteType" defaultValue={site.site_type ?? "rescue_site"} required>
                                <option value="rescue_site">אתר חילוץ</option>
                                <option value="search_site">אתר סריקה</option>
                              </select>
                            </label>
                            <label>
                              עיר / מיקום
                              <input className="input" name="city" defaultValue={site.city ?? ""} />
                            </label>
                            <label>
                              רחוב / כתובת
                              <input className="input" name="street" defaultValue={site.street ?? ""} required />
                            </label>
                            <label>
                              מספר / סימון
                              <input className="input" name="houseNumber" defaultValue={site.house_number ?? ""} required />
                            </label>
                            <label>
                              עדיפות סריקה
                              <input className="input" name="searchPriority" defaultValue={site.search_priority ?? ""} />
                            </label>
                            <label className="wide">
                              הערות / פרטים
                              <textarea className="input" name="siteDetails" defaultValue={site.search_reason ?? ""} rows={3} />
                            </label>
                          </div>
                          <OperationalLoadingButton className="button" label={"\u05e9\u05de\u05d5\u05e8 \u05d0\u05ea\u05e8"} loadingLabel={"\u05e9\u05d5\u05de\u05e8..."} />
                        </form>
                      </details>
                    ) : null}
                    {canCancelSites ? (
                      <SiteResidentImportForm
                        action={importSiteResidentListAction}
                        incidentId={params.incidentId}
                        siteId={site.site_id}
                        siteLabel={site.name ?? `אתר ${site.site_number}`}
                      />
                    ) : null}
                    {canCancelSites ? (
                      <details className="inline-confirm-panel site-list-cancel-panel">
                        <summary className="button danger">בטל אתר</summary>
                        <form action={cancelSiteFromListAction} className="action-form">
                          <input type="hidden" name="incidentId" value={params.incidentId} />
                          <input type="hidden" name="siteId" value={site.site_id} />
                          <strong>ביטול אתר</strong>
                          <p className="warning-text">
                            האם לבטל את האתר? פעולה זו תסתיר את האתר מהדשבורדים והחישובים, אך תשמור את ההיסטוריה והנתונים המקושרים.
                          </p>
                          <p className="warning-text">
                            לאתר קיימים נתונים מקושרים. הביטול יסיר אותו מהתצוגות הפעילות אך לא ימחק את הנתונים.
                          </p>
                          <label>
                            סיבת ביטול
                            <select className="input" name="reason" required>
                              <option value="">בחר סיבה</option>
                              <option value="created_by_mistake">נוצר בטעות</option>
                              <option value="duplicate">כפילות</option>
                              <option value="wrong_site">אתר שגוי</option>
                              <option value="other">אחר</option>
                            </select>
                          </label>
                          <label>
                            פירוט אחר
                            <input className="input" name="reasonOther" placeholder="נדרש אם נבחר אחר" />
                          </label>
                          <OperationalLoadingButton className="button danger" label={"\u05d0\u05e9\u05e8 \u05d1\u05d9\u05d8\u05d5\u05dc \u05d0\u05ea\u05e8"} loadingLabel={"\u05de\u05d1\u05d8\u05dc..."} />
                        </form>
                      </details>
                    ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <ImportedSiteResidentsTable rows={importedResidents} />
    </main>
  );
}
