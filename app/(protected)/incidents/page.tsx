import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";

type IncidentRow = {
  id: string;
  name: string;
  city: string | null;
  address: string;
  opened_at: string;
  ended_at: string | null;
  status_id: string;
  is_closed: boolean;
};

export default async function IncidentsPage() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("incidents")
    .select("id,name,city,address,opened_at,ended_at,status_id,is_closed")
    .order("opened_at", { ascending: false });

  const incidents = (data ?? []) as IncidentRow[];

  return (
    <main className="page">
      <div className="header">
        <div>
          <h1>אירועים</h1>
          <p className="muted">רשימת אירועי חילוץ שהמשתמש מורשה לראות</p>
        </div>
        <Link className="button" href="/incidents/new">
          פתיחת אירוע חדש
        </Link>
      </div>

      {error ? (
        <section className="panel">
          <p className="error">לא ניתן לטעון אירועים: {error.message}</p>
        </section>
      ) : null}

      <section className="panel">
        {incidents.length === 0 ? (
          <p className="muted">לא נמצאו אירועים זמינים.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>שם אירוע</th>
                <th>עיר</th>
                <th>כתובת</th>
                <th>סטטוס</th>
                <th>נפתח</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {incidents.map((incident) => (
                <tr key={incident.id}>
                  <td>{incident.name}</td>
                  <td>{incident.city ?? "-"}</td>
                  <td>{incident.address}</td>
                  <td>
                    {incident.is_closed ? "סגור" : "פעיל"}
                    <div className="muted">{incident.status_id}</div>
                  </td>
                  <td>{formatDateTime(incident.opened_at)}</td>
                  <td>
                    <Link className="button secondary" href={`/incidents/${incident.id}`}>
                      פתיחה
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
