"use client";

import { useEffect, useMemo, useState } from "react";
import { OperationalLoadingButton } from "@/app/(protected)/operational-loading-button";
import { formatDateTime, formatNumber } from "@/lib/format";
import {
  deactivateUser,
  deleteUser,
  resetUserPassword,
  restoreUser,
  updateUserDetails,
  updateUserIncidentAssignments
} from "./actions";

export type AdminUserRole = "admin" | "commander" | "editor" | "viewer" | "search_user";
type StatusFilter = "all" | "active" | "inactive";
type RoleFilter = "all" | AdminUserRole;

export type AdminUserRow = {
  id: string;
  display_name: string | null;
  email: string | null;
  role: AdminUserRole;
  is_active: boolean;
  deactivated_at: string | null;
  deleted_at: string | null;
  created_at: string;
  last_sign_in_at: string | null;
};

export type ActiveIncidentRow = {
  id: string;
  name: string;
  city: string | null;
};

export type IncidentMembershipRow = {
  incident_id: string;
  user_id: string;
  role: string;
};

type Props = {
  users: AdminUserRow[];
  activeIncidents: ActiveIncidentRow[];
  memberships: IncidentMembershipRow[];
  currentUserId: string;
  roleLabels: Record<AdminUserRole, string>;
  text: Record<string, string>;
};

const roleOrder: AdminUserRole[] = ["commander", "admin", "search_user", "viewer", "editor"];

function roleGroupLabel(role: AdminUserRole, roleLabels: Record<AdminUserRole, string>) {
  return roleLabels[role] ?? role;
}

function relativeTime(value: string | null) {
  if (!value) return "טרם התחבר";
  const diffMs = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.floor(diffMs / 60000));
  if (minutes < 1) return "עכשיו";
  if (minutes < 60) return `לפני ${minutes} דקות`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `לפני ${hours} שעות`;
  const days = Math.floor(hours / 24);
  return `לפני ${days} ימים`;
}

function membershipRoleLabel(role: string, roleLabels: Record<AdminUserRole, string>) {
  if (role === "incident_commander") return roleLabels.commander;
  if (role === "command_post_operator") return roleLabels.editor;
  return roleLabels.viewer;
}

function statusLabel(user: AdminUserRow) {
  return user.is_active ? "פעיל" : "לא פעיל";
}

function userSearchText(user: AdminUserRow, roleLabels: Record<AdminUserRole, string>) {
  return [user.display_name, user.email, user.role, roleLabels[user.role], statusLabel(user)]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function AdminUsersManagement({
  users,
  activeIncidents,
  memberships,
  currentUserId,
  roleLabels,
  text
}: Props) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [collapsedRoles, setCollapsedRoles] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const saved = window.sessionStorage.getItem("admin-users-collapsed-roles");
    if (saved) {
      try {
        setCollapsedRoles(JSON.parse(saved) as Record<string, boolean>);
      } catch {
        setCollapsedRoles({});
      }
    }
  }, []);

  useEffect(() => {
    window.sessionStorage.setItem("admin-users-collapsed-roles", JSON.stringify(collapsedRoles));
  }, [collapsedRoles]);

  const activeIncidentIds = useMemo(() => new Set(activeIncidents.map((incident) => incident.id)), [activeIncidents]);
  const membershipsByUser = useMemo(() => {
    return memberships.reduce<Map<string, IncidentMembershipRow[]>>((grouped, membership) => {
      if (!activeIncidentIds.has(membership.incident_id)) return grouped;
      const rows = grouped.get(membership.user_id) ?? [];
      rows.push(membership);
      grouped.set(membership.user_id, rows);
      return grouped;
    }, new Map());
  }, [activeIncidentIds, memberships]);

  const summary = useMemo(() => ({
    total: users.length,
    active: users.filter((user) => user.is_active).length,
    inactive: users.filter((user) => !user.is_active).length,
    admins: users.filter((user) => user.role === "admin").length,
    commanders: users.filter((user) => user.role === "commander").length
  }), [users]);

  const filteredUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return users.filter((user) => {
      if (statusFilter === "active" && !user.is_active) return false;
      if (statusFilter === "inactive" && user.is_active) return false;
      if (roleFilter !== "all" && user.role !== roleFilter) return false;
      if (normalizedQuery && !userSearchText(user, roleLabels).includes(normalizedQuery)) return false;
      return true;
    });
  }, [query, roleFilter, roleLabels, statusFilter, users]);

  const groupedUsers = useMemo(() => {
    const roles = Array.from(new Set(roleOrder.concat(filteredUsers.map((user) => user.role))));
    return roles
      .map((role) => ({ role, users: filteredUsers.filter((user) => user.role === role) }))
      .filter((group) => group.users.length > 0);
  }, [filteredUsers]);

  function clearFilters() {
    setQuery("");
    setStatusFilter("all");
    setRoleFilter("all");
  }

  return (
    <>
      <section className="admin-user-summary-grid" aria-label="סיכום משתמשים">
        <div className="metric"><span>סה"כ משתמשים</span><strong>{formatNumber(summary.total)}</strong></div>
        <div className="metric"><span>משתמשים פעילים</span><strong>{formatNumber(summary.active)}</strong></div>
        <div className="metric"><span>משתמשים לא פעילים</span><strong>{formatNumber(summary.inactive)}</strong></div>
        <div className="metric"><span>מנהלי מערכת</span><strong>{formatNumber(summary.admins)}</strong></div>
        <div className="metric"><span>מפקדים</span><strong>{formatNumber(summary.commanders)}</strong></div>
      </section>

      <section className="panel admin-user-filter-panel">
        <label className="field">
          <span>חיפוש</span>
          <input
            className="input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="שם, אימייל או תפקיד"
          />
        </label>
        <label className="field">
          <span>סטטוס</span>
          <select className="input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
            <option value="all">כל המשתמשים</option>
            <option value="active">פעילים</option>
            <option value="inactive">לא פעילים</option>
          </select>
        </label>
        <label className="field">
          <span>תפקיד</span>
          <select className="input" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as RoleFilter)}>
            <option value="all">כל התפקידים</option>
            {roleOrder.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}
          </select>
        </label>
        <button className="button secondary" type="button" onClick={clearFilters}>נקה סינון</button>
      </section>

      {filteredUsers.length === 0 ? (
        <section className="panel empty-state">
          <h2>No users found.</h2>
        </section>
      ) : null}

      {groupedUsers.map((group) => {
        const collapsed = Boolean(collapsedRoles[group.role]);
        return (
          <section className="panel admin-user-role-section" key={group.role}>
            <button
              className="admin-user-role-header"
              type="button"
              onClick={() => setCollapsedRoles((current) => ({ ...current, [group.role]: !current[group.role] }))}
              aria-expanded={!collapsed}
            >
              <span>{roleGroupLabel(group.role, roleLabels)} ({formatNumber(group.users.length)})</span>
              <span aria-hidden="true">{collapsed ? "+" : "-"}</span>
            </button>
            {!collapsed ? (
              <div className="admin-user-card-list">
                {group.users.map((user) => (
                  <AdminUserCard
                    key={user.id}
                    user={user}
                    currentUserId={currentUserId}
                    activeIncidents={activeIncidents}
                    memberships={membershipsByUser.get(user.id) ?? []}
                    roleLabels={roleLabels}
                    text={text}
                  />
                ))}
              </div>
            ) : null}
          </section>
        );
      })}
    </>
  );
}

function AdminUserCard({
  user,
  currentUserId,
  activeIncidents,
  memberships,
  roleLabels,
  text
}: {
  user: AdminUserRow;
  currentUserId: string;
  activeIncidents: ActiveIncidentRow[];
  memberships: IncidentMembershipRow[];
  roleLabels: Record<AdminUserRole, string>;
  text: Record<string, string>;
}) {
  const membershipsByIncident = new Map(memberships.map((membership) => [membership.incident_id, membership]));
  const canAssignIncidents = ["editor", "viewer", "commander", "search_user"].includes(user.role);
  const canDeactivate = user.is_active && user.role !== "admin" && user.id !== currentUserId;
  const canRestore = !user.is_active;
  const canDelete = !user.is_active && user.role !== "admin" && user.id !== currentUserId;

  return (
    <article className={`admin-user-card${user.is_active ? "" : " inactive"}`}>
      <div className="admin-user-main">
        <div>
          <strong>{user.display_name || user.email || user.id}</strong>
          <span>{user.email ?? "-"}</span>
        </div>
        <span className={`command-badge role-badge role-${user.role}`}>{roleLabels[user.role]}</span>
        <span className={`command-badge user-status-badge ${user.is_active ? "active" : "inactive"}`}>
          {statusLabel(user)}
        </span>
      </div>

      <dl className="admin-user-meta">
        <div><dt>{text.createdAt}</dt><dd>{formatDateTime(user.created_at)}</dd></div>
        <div>
          <dt>{text.lastSignIn}</dt>
          <dd title={user.last_sign_in_at ? formatDateTime(user.last_sign_in_at) : undefined}>
            {relativeTime(user.last_sign_in_at)}
          </dd>
        </div>
        <div><dt>{text.incidentAssignment}</dt><dd>{formatNumber(memberships.length)} {text.incidents}</dd></div>
      </dl>

      <details className="admin-user-actions-menu">
        <summary className="button secondary">פעולות</summary>
        <div className="admin-user-actions-panel">
          <details>
            <summary className="button secondary">עריכת משתמש</summary>
            <form action={updateUserDetails} className="admin-user-edit-form">
              <input type="hidden" name="userId" value={user.id} />
              <label className="field">
                <span>{text.displayName}</span>
                <input className="input" name="displayName" defaultValue={user.display_name ?? ""} required />
              </label>
              <label className="field">
                <span>{text.role}</span>
                <select className="input" name="role" defaultValue={user.role}>
                  {Object.entries(roleLabels).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>סטטוס</span>
                <select className="input" name="status" defaultValue={user.is_active ? "active" : "inactive"}>
                  <option value="active">פעיל</option>
                  {user.role !== "admin" && user.id !== currentUserId ? <option value="inactive">לא פעיל</option> : null}
                </select>
              </label>
              <OperationalLoadingButton className="button" label={text.save} loadingLabel="שומר..." />
            </form>
          </details>

          {canDeactivate ? (
            <details>
              <summary className="button danger">השבת משתמש</summary>
              <form action={deactivateUser} className="admin-user-confirm-form">
                <input type="hidden" name="userId" value={user.id} />
                <p className="muted">המשתמש לא יוכל להיכנס למערכת. הרשאות והיסטוריה יישמרו.</p>
                <OperationalLoadingButton className="button danger" label="אשר השבתה" loadingLabel="מעדכן..." />
              </form>
            </details>
          ) : null}

          {canRestore ? (
            <details>
              <summary className="button secondary">שחזר משתמש</summary>
              <form action={restoreUser} className="admin-user-confirm-form">
                <input type="hidden" name="userId" value={user.id} />
                <p className="muted">המשתמש יוחזר למצב פעיל עם ההרשאות הקיימות.</p>
                <OperationalLoadingButton className="button" label="שחזר משתמש" loadingLabel="משחזר..." />
              </form>
            </details>
          ) : null}

          {canDelete ? (
            <details>
              <summary className="button danger">מחיקת משתמש</summary>
              <form action={deleteUser} className="admin-user-confirm-form">
                <input type="hidden" name="userId" value={user.id} />
                <p className="error">מחיקה זו היא מחיקה רכה. ההיסטוריה המבצעית וה-Audit נשמרים.</p>
                <OperationalLoadingButton className="button danger" label="אשר מחיקה" loadingLabel="מוחק..." />
              </form>
            </details>
          ) : null}

          <details className="admin-password-reset">
            <summary className="button secondary">{text.passwordReset}</summary>
            <form action={resetUserPassword} className="admin-password-form">
              <input type="hidden" name="userId" value={user.id} />
              <input className="input" name="password" type="password" minLength={8} placeholder={text.newPassword} required />
              <input className="input" name="confirmPassword" type="password" minLength={8} placeholder={text.confirmPassword} required />
              <OperationalLoadingButton className="button danger" label={text.passwordReset} loadingLabel="מעדכן..." />
            </form>
          </details>

          {canAssignIncidents ? (
            <details className="admin-incident-assignment">
              <summary className="button secondary">{text.incidentAssignment}</summary>
              <div className="assignment-count-badge">{text.assignedTo}{memberships.length} {text.incidents}</div>
              {user.role === "commander" ? <p className="muted">{text.commanderAccessNote}</p> : null}
              <form action={updateUserIncidentAssignments} className="admin-assignment-form">
                <input type="hidden" name="userId" value={user.id} />
                {activeIncidents.length === 0 ? (
                  <p className="muted">{text.noActiveIncidents}</p>
                ) : (
                  <div className="admin-assignment-list">
                    {activeIncidents.map((incident) => {
                      const membership = membershipsByIncident.get(incident.id);
                      return (
                        <label className="admin-assignment-row" key={incident.id}>
                          <input type="checkbox" name="incidentIds" value={incident.id} defaultChecked={Boolean(membership)} />
                          <span>
                            <strong>{incident.name}</strong>
                            <small>{[incident.city, membership ? membershipRoleLabel(membership.role, roleLabels) : roleLabels[user.role]].filter(Boolean).join(" · ")}</small>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
                <OperationalLoadingButton className="button" label={text.saveAssignments} loadingLabel="משייך..." />
              </form>
            </details>
          ) : null}
        </div>
      </details>
    </article>
  );
}
