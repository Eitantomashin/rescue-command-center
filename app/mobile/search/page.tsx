import Link from "next/link";
import { redirect } from "next/navigation";
import { signOut } from "@/app/login/actions";
import { createClient } from "@/lib/supabase/server";

type SearchSiteRow = {
  id: string;
  incident_id: string;
  name: string | null;
  city: string | null;
  street: string | null;
  house_number: string | null;
  search_status: string | null;
  incidents: {
    id: string;
    name: string;
    city: string | null;
    address: string | null;
    lifecycle_status: string | null;
    archived_at: string | null;
  } | null;
};

function incidentAddress(row: SearchSiteRow["incidents"]) {
  return [row?.city, row?.address].filter(Boolean).join(" · ");
}

function userDisplayName(user: { email?: string | null; user_metadata?: Record<string, unknown> | null }) {
  const metadata = user.user_metadata ?? {};
  const displayName = String(metadata.display_name ?? metadata.full_name ?? metadata.name ?? "").trim();
  return displayName || user.email || "משתמש סריקה";
}

export default async function MobileSearchIncidentsPage() {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data, error } = await supabase
    .from("sites")
    .select("id,incident_id,name,city,street,house_number,search_status,incidents!inner(id,name,city,address,lifecycle_status,archived_at)")
    .eq("site_type", "search_site")
    .eq("is_active", true)
    .is("incidents.archived_at", null)
    .order("created_at", { ascending: false });

  const rows = ((data ?? []) as unknown as SearchSiteRow[]).filter((row) => row.incidents?.lifecycle_status !== "closed");
  const incidents = new Map<string, { incident: NonNullable<SearchSiteRow["incidents"]>; siteCount: number }>();

  for (const row of rows) {
    if (!row.incidents) continue;
    const existing = incidents.get(row.incident_id);
    incidents.set(row.incident_id, {
      incident: row.incidents,
      siteCount: (existing?.siteCount ?? 0) + 1
    });
  }

  return (
    <main className="mobile-search-app" dir="rtl">
      <header className="mobile-search-topbar">
        <div>
          <span>ינשו״פ סריקה</span>
          <strong>אירועים פעילים</strong>
        </div>
        <div className="mobile-search-user">
          <span>מדווח:</span>
          <strong>{userDisplayName(user)}</strong>
        </div>
        <form action={signOut}>
          <button className="button compact secondary" type="submit">יציאה</button>
        </form>
      </header>

      {error ? <p className="error">{error.message}</p> : null}

      <section className="mobile-search-card-list" aria-label="אירועים עם אתרי סריקה">
        {incidents.size === 0 ? (
          <div className="empty-state">
            <h1>אין אירועי סריקה פעילים</h1>
            <p className="muted">כאשר יוגדר אתר סריקה פעיל, הוא יופיע כאן.</p>
          </div>
        ) : null}

        {Array.from(incidents.values()).map(({ incident, siteCount }) => (
          <Link className="mobile-search-selection-card" href={`/mobile/search/${incident.id}`} key={incident.id}>
            <span className="mobile-search-eyebrow">אירוע</span>
            <strong>{incident.name}</strong>
            {incidentAddress(incident) ? <small>{incidentAddress(incident)}</small> : null}
            <em>{siteCount} אתרי סריקה</em>
          </Link>
        ))}
      </section>
    </main>
  );
}
