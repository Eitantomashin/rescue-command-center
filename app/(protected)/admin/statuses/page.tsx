import { notFound } from "next/navigation";
import { OperationalLoadingButton } from "@/app/(protected)/operational-loading-button";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import { addOperationalStatus, toggleOperationalStatus, updateOperationalStatus } from "./actions";

type StatusRow = {
  id: string;
  status_key: string;
  hebrew_label: string;
  color: string | null;
  is_active: boolean;
  sort_order: number | null;
  created_at: string;
  updated_at: string;
};

const text = {
  title: "\u05e0\u05d9\u05d4\u05d5\u05dc \u05e1\u05d8\u05d8\u05d5\u05e1\u05d9\u05dd \u05de\u05d1\u05e6\u05e2\u05d9\u05d9\u05dd",
  subtitle: "\u05e0\u05d9\u05d4\u05d5\u05dc \u05de\u05d9\u05dc\u05d5\u05df \u05d4\u05e1\u05d8\u05d8\u05d5\u05e1\u05d9\u05dd \u05dc\u05d1\u05d7\u05d9\u05e8\u05d5\u05ea \u05e2\u05ea\u05d9\u05d3\u05d9\u05d5\u05ea \u05d1\u05dc\u05d1\u05d3. \u05e2\u05e8\u05db\u05d9\u05dd \u05e9\u05db\u05d1\u05e8 \u05e0\u05e9\u05de\u05e8\u05d5 \u05d1\u05d3\u05d9\u05d5\u05d5\u05d7\u05d9\u05dd, \u05d4\u05d9\u05e1\u05d8\u05d5\u05e8\u05d9\u05d4 \u05d5\u05d9\u05d5\u05de\u05e0\u05d9\u05dd \u05dc\u05d0 \u05de\u05e9\u05ea\u05e0\u05d9\u05dd.",
  add: "\u05d4\u05d5\u05e1\u05e3 \u05e1\u05d8\u05d8\u05d5\u05e1",
  label: "\u05e9\u05dd \u05e1\u05d8\u05d8\u05d5\u05e1",
  order: "\u05e1\u05d3\u05e8 \u05d4\u05d5\u05e4\u05e2\u05d4",
  color: "\u05e6\u05d1\u05e2",
  key: "\u05de\u05e4\u05ea\u05d7 \u05e4\u05e0\u05d9\u05de\u05d9 \u05d0\u05d5\u05e4\u05e6\u05d9\u05d5\u05e0\u05dc\u05d9",
  save: "\u05e9\u05de\u05d5\u05e8",
  deactivate: "\u05d4\u05e9\u05d1\u05ea",
  reactivate: "\u05d4\u05e4\u05e2\u05dc \u05de\u05d7\u05d3\u05e9",
  active: "\u05e4\u05e2\u05d9\u05dc",
  inactive: "\u05dc\u05d0 \u05e4\u05e2\u05d9\u05dc",
  created: "\u05e0\u05d5\u05e6\u05e8",
  updated: "\u05e2\u05d5\u05d3\u05db\u05df",
  actions: "\u05e4\u05e2\u05d5\u05dc\u05d5\u05ea",
  empty: "\u05dc\u05d0 \u05e0\u05de\u05e6\u05d0\u05d5 \u05e1\u05d8\u05d8\u05d5\u05e1\u05d9\u05dd \u05de\u05d1\u05e6\u05e2\u05d9\u05d9\u05dd.",
  historicalNote: "\u05e9\u05d9\u05e0\u05d5\u05d9 \u05e9\u05dd \u05d9\u05d5\u05e6\u05e8 \u05e1\u05d8\u05d8\u05d5\u05e1 \u05d7\u05d3\u05e9 \u05dc\u05d1\u05d7\u05d9\u05e8\u05d5\u05ea \u05e2\u05ea\u05d9\u05d3\u05d9\u05d5\u05ea \u05d5\u05de\u05e9\u05d1\u05d9\u05ea \u05d0\u05ea \u05d4\u05d9\u05e9\u05df, \u05db\u05d3\u05d9 \u05e9\u05e8\u05e9\u05d5\u05de\u05d5\u05ea \u05e2\u05d1\u05e8 \u05d9\u05d9\u05e9\u05d0\u05e8\u05d5 \u05e7\u05e8\u05d9\u05d0\u05d5\u05ea \u05db\u05e4\u05d9 \u05e9\u05e0\u05e9\u05de\u05e8\u05d5.",
  added: "\u05d4\u05e1\u05d8\u05d8\u05d5\u05e1 \u05e0\u05d5\u05e1\u05e3 \u05d1\u05d4\u05e6\u05dc\u05d7\u05d4.",
  statusUpdated: "\u05d4\u05e1\u05d8\u05d8\u05d5\u05e1 \u05e2\u05d5\u05d3\u05db\u05df \u05d1\u05d4\u05e6\u05dc\u05d7\u05d4.",
  deactivated: "\u05d4\u05e1\u05d8\u05d8\u05d5\u05e1 \u05d4\u05d5\u05e9\u05d1\u05ea \u05dc\u05d1\u05d7\u05d9\u05e8\u05d5\u05ea \u05e2\u05ea\u05d9\u05d3\u05d9\u05d5\u05ea.",
  reactivated: "\u05d4\u05e1\u05d8\u05d8\u05d5\u05e1 \u05d4\u05d5\u05e4\u05e2\u05dc \u05de\u05d7\u05d3\u05e9."
};

function statusMessage(status: string | undefined) {
  if (status === "added") return text.added;
  if (status === "updated") return text.statusUpdated;
  if (status === "deactivated") return text.deactivated;
  if (status === "reactivated") return text.reactivated;
  return null;
}

function colorValue(color: string | null) {
  if (!color) return "";
  return color;
}

export default async function AdminOperationalStatusesPage({
  searchParams
}: {
  searchParams?: { status?: string };
}) {
  const supabase = createClient();
  const { data: role } = await supabase.rpc("current_user_role");

  if (role !== "admin") {
    notFound();
  }

  const { data, error } = await supabase
    .from("status_types")
    .select("id,status_key,hebrew_label,color,is_active,sort_order,created_at,updated_at")
    .eq("category", "person")
    .is("incident_id", null)
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  const statuses = (data ?? []) as StatusRow[];
  const message = statusMessage(searchParams?.status);

  return (
    <main className="page admin-statuses-page" dir="rtl">
      <div className="header">
        <div>
          <h1>{text.title}</h1>
          <p className="muted">{text.subtitle}</p>
        </div>
      </div>

      {message ? (
        <section className="panel success-panel">
          <p className="muted">{message}</p>
        </section>
      ) : null}

      {error ? (
        <section className="panel">
          <p className="error">{error.message}</p>
        </section>
      ) : null}

      <section className="panel">
        <h2>{text.add}</h2>
        <p className="muted">{text.historicalNote}</p>
        <form action={addOperationalStatus} className="admin-status-form admin-status-add-form">
          <label>
            <span>{text.label}</span>
            <input className="input" name="label" required />
          </label>
          <label>
            <span>{text.order}</span>
            <input className="input" name="sortOrder" type="number" min={1} defaultValue={statuses.length + 1} required />
          </label>
          <label>
            <span>{text.color}</span>
            <input className="input" name="color" placeholder="blue / orange / green / red" />
          </label>
          <label>
            <span>{text.key}</span>
            <input className="input" name="statusKey" placeholder="optional_internal_key" />
          </label>
          <OperationalLoadingButton className="button" label={text.add} loadingLabel="יוצר..." />
        </form>
      </section>

      <section className="panel">
        <table className="table admin-statuses-table">
          <thead>
            <tr>
              <th>{text.order}</th>
              <th>{text.label}</th>
              <th>{text.active}</th>
              <th>{text.color}</th>
              <th>{text.created}</th>
              <th>{text.updated}</th>
              <th>{text.actions}</th>
            </tr>
          </thead>
          <tbody>
            {statuses.length === 0 ? (
              <tr>
                <td colSpan={7}>{text.empty}</td>
              </tr>
            ) : null}
            {statuses.map((status) => (
              <tr key={status.id} className={status.is_active ? undefined : "muted-row"}>
                <td>{status.sort_order ?? "-"}</td>
                <td>
                  <strong>{status.hebrew_label}</strong>
                  <span className="muted">{status.status_key}</span>
                </td>
                <td>
                  <span className={status.is_active ? "command-badge success" : "command-badge neutral"}>
                    {status.is_active ? text.active : text.inactive}
                  </span>
                </td>
                <td>{status.color ?? "-"}</td>
                <td>{formatDateTime(status.created_at)}</td>
                <td>{formatDateTime(status.updated_at)}</td>
                <td>
                  <div className="admin-status-actions">
                    <form action={updateOperationalStatus} className="admin-status-row-form">
                      <input type="hidden" name="statusId" value={status.id} />
                      <input className="input" name="label" defaultValue={status.hebrew_label} required />
                      <input className="input" name="sortOrder" type="number" min={1} defaultValue={status.sort_order ?? 999} required />
                      <input className="input" name="color" defaultValue={colorValue(status.color)} placeholder={text.color} />
                      <OperationalLoadingButton className="button secondary" label={text.save} loadingLabel="שומר..." />
                    </form>
                    <form action={toggleOperationalStatus}>
                      <input type="hidden" name="statusId" value={status.id} />
                      <input type="hidden" name="nextActive" value={status.is_active ? "false" : "true"} />
                      <OperationalLoadingButton
                        className={status.is_active ? "button danger" : "button secondary"}
                        label={status.is_active ? text.deactivate : text.reactivate}
                        loadingLabel="מעדכן..."
                      />
                    </form>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
