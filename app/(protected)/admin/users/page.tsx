import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import { updateUserRole } from "./actions";

type UserProfileRow = {
  id: string;
  display_name: string | null;
  email: string | null;
  role: "admin" | "commander" | "editor" | "viewer";
  created_at: string;
};

const roleLabels = {
  admin: "\u05de\u05e0\u05d4\u05dc \u05de\u05e2\u05e8\u05db\u05ea",
  commander: "\u05de\u05e4\u05e7\u05d3",
  editor: "\u05e2\u05d5\u05e8\u05da",
  viewer: "\u05e6\u05d5\u05e4\u05d4"
};

const pageText = {
  title: "\u05e0\u05d9\u05d4\u05d5\u05dc \u05de\u05e9\u05ea\u05de\u05e9\u05d9\u05dd",
  subtitle: "\u05d4\u05e7\u05e6\u05d0\u05ea \u05ea\u05e4\u05e7\u05d9\u05d3\u05d9 \u05de\u05e2\u05e8\u05db\u05ea \u05dc\u05de\u05e9\u05ea\u05de\u05e9\u05d9 YANSHOF.",
  displayName: "\u05e9\u05dd \u05dc\u05ea\u05e6\u05d5\u05d2\u05d4",
  email: "\u05d0\u05d9\u05de\u05d9\u05d9\u05dc",
  role: "\u05ea\u05e4\u05e7\u05d9\u05d3 \u05de\u05e2\u05e8\u05db\u05ea",
  createdAt: "\u05e0\u05d5\u05e6\u05e8",
  action: "\u05e4\u05e2\u05d5\u05dc\u05d4",
  save: "\u05e9\u05de\u05d5\u05e8"
};

export default async function AdminUsersPage() {
  const supabase = createClient();
  const { data: role } = await supabase.rpc("current_user_role");

  if (role !== "admin") {
    notFound();
  }

  const { data, error } = await supabase.rpc("list_user_profiles");
  const users = (data ?? []) as UserProfileRow[];

  return (
    <main className="page admin-users-page">
      <div className="header">
        <div>
          <h1>{pageText.title}</h1>
          <p className="muted">{pageText.subtitle}</p>
        </div>
      </div>

      {error ? (
        <section className="panel">
          <p className="error">{error.message}</p>
        </section>
      ) : null}

      <section className="panel">
        <table className="table">
          <thead>
            <tr>
              <th>{pageText.displayName}</th>
              <th>{pageText.email}</th>
              <th>{pageText.role}</th>
              <th>{pageText.createdAt}</th>
              <th>{pageText.action}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>
                  <strong>{user.display_name || user.email || user.id}</strong>
                </td>
                <td>{user.email ?? "-"}</td>
                <td>
                  <span className={`command-badge role-badge role-${user.role}`}>{roleLabels[user.role]}</span>
                </td>
                <td>{formatDateTime(user.created_at)}</td>
                <td>
                  <form action={updateUserRole} className="admin-role-form">
                    <input type="hidden" name="userId" value={user.id} />
                    <select className="input" name="role" defaultValue={user.role}>
                      {Object.entries(roleLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <button className="button secondary" type="submit">
                      {pageText.save}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
