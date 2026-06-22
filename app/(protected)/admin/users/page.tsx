import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import { createAdminUser, resetUserPassword, updateUserIncidentAssignments, updateUserRole } from "./actions";

type UserProfileRow = {
  id: string;
  display_name: string | null;
  email: string | null;
  role: "admin" | "commander" | "editor" | "viewer";
  created_at: string;
  last_sign_in_at: string | null;
};

type ActiveIncidentRow = {
  id: string;
  name: string;
  city: string | null;
};

type IncidentMembershipRow = {
  incident_id: string;
  user_id: string;
  role: string;
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
  userCreateError: "\u05d9\u05e6\u05d9\u05e8\u05ea \u05d4\u05de\u05e9\u05ea\u05de\u05e9 \u05e0\u05db\u05e9\u05dc\u05d4.",
  incidentAssignment: "\u05e9\u05d9\u05d5\u05da \u05d0\u05d9\u05e8\u05d5\u05e2\u05d9\u05dd",
  assignedTo: "\u05de\u05e9\u05d5\u05d9\u05da \u05dc-",
  incidents: "\u05d0\u05d9\u05e8\u05d5\u05e2\u05d9\u05dd",
  saveAssignments: "\u05e9\u05de\u05d5\u05e8 \u05e9\u05d9\u05d5\u05db\u05d9\u05dd",
  assignmentSaved: "\u05e9\u05d9\u05d5\u05db\u05d9 \u05d4\u05d0\u05d9\u05e8\u05d5\u05e2\u05d9\u05dd \u05e2\u05d5\u05d3\u05db\u05e0\u05d5 \u05d1\u05d4\u05e6\u05dc\u05d7\u05d4.",
  assignmentError: "\u05e2\u05d3\u05db\u05d5\u05df \u05e9\u05d9\u05d5\u05db\u05d9 \u05d4\u05d0\u05d9\u05e8\u05d5\u05e2\u05d9\u05dd \u05e0\u05db\u05e9\u05dc.",
  commanderAccessNote: "\u05de\u05e4\u05e7\u05d3 \u05e8\u05d5\u05d0\u05d4 \u05db\u05dc \u05d0\u05d9\u05e8\u05d5\u05e2 \u05e4\u05e2\u05d9\u05dc \u05d2\u05dd \u05dc\u05dc\u05d0 \u05e9\u05d9\u05d5\u05da. \u05d4\u05e9\u05d9\u05d5\u05da \u05de\u05d2\u05d3\u05d9\u05e8 \u05d0\u05ea \u05ea\u05e4\u05e7\u05d9\u05d3\u05d5 \u05d1\u05d0\u05d9\u05e8\u05d5\u05e2.",
  noActiveIncidents: "\u05d0\u05d9\u05df \u05d0\u05d9\u05e8\u05d5\u05e2\u05d9\u05dd \u05e4\u05e2\u05d9\u05dc\u05d9\u05dd \u05dc\u05e9\u05d9\u05d5\u05da."
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

function assignmentMessage(code: string | undefined, message: string | undefined) {
  if (code === "success") return { className: "success-panel", text: pageText.assignmentSaved };
  if (code === "error") return { className: "", text: message || pageText.assignmentError };
  return null;
}

function membershipRoleLabel(role: string) {
  if (role === "incident_commander") return roleLabels.commander;
  if (role === "command_post_operator") return roleLabels.editor;
  return roleLabels.viewer;
}

export default async function AdminUsersPage({
  searchParams
}: {
  searchParams?: { passwordReset?: string; userCreate?: string; assignment?: string; message?: string };
}) {
  const supabase = createClient();
  const { data: role } = await supabase.rpc("current_user_role");

  if (role !== "admin") {
    notFound();
  }

  const [
    { data, error },
    { data: activeIncidentRows },
    { data: membershipRows }
  ] = await Promise.all([
    supabase.rpc("list_user_profiles"),
    supabase
      .from("incidents")
      .select("id,name,city")
      .is("archived_at", null)
      .order("opened_at", { ascending: false }),
    supabase
      .from("incident_memberships")
      .select("incident_id,user_id,role")
  ]);
  const users = (data ?? []) as UserProfileRow[];
  const activeIncidents = (activeIncidentRows ?? []) as ActiveIncidentRow[];
  const memberships = (membershipRows ?? []) as IncidentMembershipRow[];
  const message = resetMessage(searchParams?.passwordReset, searchParams?.message);
  const userCreateMessage = createUserMessage(searchParams?.userCreate, searchParams?.message);
  const assignmentStatusMessage = assignmentMessage(searchParams?.assignment, searchParams?.message);
  const activeIncidentIds = new Set(activeIncidents.map((incident) => incident.id));
  const membershipsByUser = memberships.reduce<Map<string, IncidentMembershipRow[]>>((grouped, membership) => {
    if (!activeIncidentIds.has(membership.incident_id)) {
      return grouped;
    }

    const rows = grouped.get(membership.user_id) ?? [];
    rows.push(membership);
    grouped.set(membership.user_id, rows);
    return grouped;
  }, new Map());

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

      {assignmentStatusMessage ? (
        <section className={`panel ${assignmentStatusMessage.className}`}>
          <p className={assignmentStatusMessage.className ? "muted" : "error"}>{assignmentStatusMessage.text}</p>
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
            {users.map((user) => {
              const userMemberships = membershipsByUser.get(user.id) ?? [];
              const membershipsByIncident = new Map(userMemberships.map((membership) => [membership.incident_id, membership]));
              const canAssignIncidents = user.role === "editor" || user.role === "viewer" || user.role === "commander";

              return (
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
                  {canAssignIncidents ? (
                    <details className="admin-incident-assignment">
                      <summary className="button secondary">{pageText.incidentAssignment}</summary>
                      <div className="assignment-count-badge">
                        {pageText.assignedTo}{userMemberships.length} {pageText.incidents}
                      </div>
                      {user.role === "commander" ? <p className="muted">{pageText.commanderAccessNote}</p> : null}
                      <form action={updateUserIncidentAssignments} className="admin-assignment-form">
                        <input type="hidden" name="userId" value={user.id} />
                        {activeIncidents.length === 0 ? (
                          <p className="muted">{pageText.noActiveIncidents}</p>
                        ) : (
                          <div className="admin-assignment-list">
                            {activeIncidents.map((incident) => {
                              const membership = membershipsByIncident.get(incident.id);
                              return (
                                <label className="admin-assignment-row" key={incident.id}>
                                  <input
                                    type="checkbox"
                                    name="incidentIds"
                                    value={incident.id}
                                    defaultChecked={Boolean(membership)}
                                  />
                                  <span>
                                    <strong>{incident.name}</strong>
                                    <small>
                                      {[incident.city, membership ? membershipRoleLabel(membership.role) : roleLabels[user.role]].filter(Boolean).join(" · ")}
                                    </small>
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        )}
                        <button className="button" type="submit">{pageText.saveAssignments}</button>
                      </form>
                    </details>
                  ) : null}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </main>
  );
}
