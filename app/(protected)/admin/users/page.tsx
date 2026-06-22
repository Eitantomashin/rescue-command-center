import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import { createAdminUser, resetUserPassword, updateUserRole } from "./actions";

type UserProfileRow = {
  id: string;
  display_name: string | null;
  email: string | null;
  role: "admin" | "commander" | "editor" | "viewer";
  created_at: string;
  last_sign_in_at: string | null;
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
  save: "\u05e9\u05de\u05d5\u05e8",
  passwordReset: "\u05d0\u05d9\u05e4\u05d5\u05e1 \u05e1\u05d9\u05e1\u05de\u05d4",
  newPassword: "\u05e1\u05d9\u05e1\u05de\u05d4 \u05d7\u05d3\u05e9\u05d4",
  confirmPassword: "\u05d0\u05d9\u05e9\u05d5\u05e8 \u05e1\u05d9\u05e1\u05de\u05d4",
  passwordSuccess: "\u05d4\u05e1\u05d9\u05e1\u05de\u05d4 \u05d0\u05d5\u05e4\u05e1\u05d4 \u05d1\u05d4\u05e6\u05dc\u05d7\u05d4.",
  passwordMismatch: "\u05d4\u05e1\u05d9\u05e1\u05de\u05d0\u05d5\u05ea \u05d0\u05d9\u05e0\u05df \u05d6\u05d4\u05d5\u05ea.",
  passwordTooShort: "\u05d4\u05e1\u05d9\u05e1\u05de\u05d4 \u05d7\u05d9\u05d9\u05d1\u05ea \u05dc\u05d4\u05db\u05d9\u05dc \u05dc\u05e4\u05d7\u05d5\u05ea 8 \u05ea\u05d5\u05d5\u05d9\u05dd.",
  passwordError: "\u05d0\u05d9\u05e4\u05d5\u05e1 \u05d4\u05e1\u05d9\u05e1\u05de\u05d4 \u05e0\u05db\u05e9\u05dc.",
  createUser: "\u05e6\u05d5\u05e8 \u05de\u05e9\u05ea\u05de\u05e9 \u05d7\u05d3\u05e9",
  emailPlaceholder: "\u05d0\u05d9\u05de\u05d9\u05d9\u05dc",
  displayNamePlaceholder: "\u05e9\u05dd \u05dc\u05ea\u05e6\u05d5\u05d2\u05d4",
  temporaryPassword: "\u05e1\u05d9\u05e1\u05de\u05d4 \u05d6\u05de\u05e0\u05d9\u05ea",
  lastSignIn: "\u05d4\u05ea\u05d7\u05d1\u05e8\u05d5\u05ea \u05d0\u05d7\u05e8\u05d5\u05e0\u05d4",
  neverSignedIn: "\u05d8\u05e8\u05dd \u05d4\u05ea\u05d7\u05d1\u05e8",
  userCreated: "\u05d4\u05de\u05e9\u05ea\u05de\u05e9 \u05e0\u05d5\u05e6\u05e8 \u05d1\u05d4\u05e6\u05dc\u05d7\u05d4.",
  invalidEmail: "\u05d9\u05e9 \u05dc\u05d4\u05d6\u05d9\u05df \u05db\u05ea\u05d5\u05d1\u05ea \u05d0\u05d9\u05de\u05d9\u05d9\u05dc \u05ea\u05e7\u05d9\u05e0\u05d4.",
  missingName: "\u05d9\u05e9 \u05dc\u05d4\u05d6\u05d9\u05df \u05e9\u05dd \u05dc\u05ea\u05e6\u05d5\u05d2\u05d4.",
  userCreateError: "\u05d9\u05e6\u05d9\u05e8\u05ea \u05d4\u05de\u05e9\u05ea\u05de\u05e9 \u05e0\u05db\u05e9\u05dc\u05d4."
};

function resetMessage(code: string | undefined, message: string | undefined) {
  if (code === "success") return { className: "success-panel", text: pageText.passwordSuccess };
  if (code === "mismatch") return { className: "", text: pageText.passwordMismatch };
  if (code === "too-short") return { className: "", text: pageText.passwordTooShort };
  if (code === "error") return { className: "", text: message || pageText.passwordError };
  return null;
}

function createUserMessage(code: string | undefined, message: string | undefined) {
  if (code === "success") return { className: "success-panel", text: pageText.userCreated };
  if (code === "invalid-email") return { className: "", text: pageText.invalidEmail };
  if (code === "missing-name") return { className: "", text: pageText.missingName };
  if (code === "too-short") return { className: "", text: pageText.passwordTooShort };
  if (code === "mismatch") return { className: "", text: pageText.passwordMismatch };
  if (code === "error" || code === "profile-error") return { className: "", text: message || pageText.userCreateError };
  return null;
}

export default async function AdminUsersPage({
  searchParams
}: {
  searchParams?: { passwordReset?: string; userCreate?: string; message?: string };
}) {
  const supabase = createClient();
  const { data: role } = await supabase.rpc("current_user_role");

  if (role !== "admin") {
    notFound();
  }

  const { data, error } = await supabase.rpc("list_user_profiles");
  const users = (data ?? []) as UserProfileRow[];
  const message = resetMessage(searchParams?.passwordReset, searchParams?.message);
  const userCreateMessage = createUserMessage(searchParams?.userCreate, searchParams?.message);

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

      {message ? (
        <section className={`panel ${message.className}`}>
          <p className={message.className ? "muted" : "error"}>{message.text}</p>
        </section>
      ) : null}

      {userCreateMessage ? (
        <section className={`panel ${userCreateMessage.className}`}>
          <p className={userCreateMessage.className ? "muted" : "error"}>{userCreateMessage.text}</p>
        </section>
      ) : null}

      <details className="panel admin-create-user-panel">
        <summary className="button">{pageText.createUser}</summary>
        <form action={createAdminUser} className="admin-create-user-form">
          <input className="input" name="email" type="email" placeholder={pageText.emailPlaceholder} required />
          <input className="input" name="displayName" placeholder={pageText.displayNamePlaceholder} required />
          <select className="input" name="role" defaultValue="viewer">
            {Object.entries(roleLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <input className="input" name="temporaryPassword" type="password" minLength={8} placeholder={pageText.temporaryPassword} required />
          <input className="input" name="confirmPassword" type="password" minLength={8} placeholder={pageText.confirmPassword} required />
          <button className="button" type="submit">{pageText.createUser}</button>
        </form>
      </details>

      <section className="panel">
        <table className="table">
          <thead>
            <tr>
              <th>{pageText.displayName}</th>
              <th>{pageText.email}</th>
              <th>{pageText.role}</th>
              <th>{pageText.createdAt}</th>
              <th>{pageText.lastSignIn}</th>
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
                <td>{user.last_sign_in_at ? formatDateTime(user.last_sign_in_at) : pageText.neverSignedIn}</td>
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
                  <details className="admin-password-reset">
                    <summary className="button secondary">{pageText.passwordReset}</summary>
                    <form action={resetUserPassword} className="admin-password-form">
                      <input type="hidden" name="userId" value={user.id} />
                      <input className="input" name="password" type="password" minLength={8} placeholder={pageText.newPassword} required />
                      <input className="input" name="confirmPassword" type="password" minLength={8} placeholder={pageText.confirmPassword} required />
                      <button className="button danger" type="submit">
                        {pageText.passwordReset}
                      </button>
                    </form>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
