import { notFound } from "next/navigation";
import { OperationalLoadingButton } from "@/app/(protected)/operational-loading-button";
import { createClient } from "@/lib/supabase/server";
import { createAdminUser } from "./actions";
import {
  AdminUsersManagement,
  type ActiveIncidentRow,
  type AdminUserRole,
  type AdminUserRow,
  type IncidentMembershipRow
} from "./admin-users-management";

const roleLabels: Record<AdminUserRole, string> = {
  admin: "מנהל מערכת",
  commander: "מפקד",
  editor: "עורך",
  viewer: "צופה",
  search_user: "משתמש סריקה"
};

const pageText = {
  title: "ניהול משתמשים",
  subtitle: "הקצאת תפקידי מערכת למשתמשי YANSHUF.",
  displayName: "שם לתצוגה",
  email: "אימייל",
  role: "תפקיד מערכת",
  createdAt: "נוצר",
  action: "פעולה",
  save: "שמור",
  passwordReset: "איפוס סיסמה",
  newPassword: "סיסמה חדשה",
  confirmPassword: "אישור סיסמה",
  passwordSuccess: "הסיסמה אופסה בהצלחה.",
  passwordMismatch: "הסיסמאות אינן זהות.",
  passwordTooShort: "הסיסמה חייבת להכיל לפחות 8 תווים.",
  passwordError: "איפוס הסיסמה נכשל.",
  createUser: "צור משתמש חדש",
  emailPlaceholder: "אימייל",
  displayNamePlaceholder: "שם לתצוגה",
  temporaryPassword: "סיסמה זמנית",
  lastSignIn: "התחברות אחרונה",
  neverSignedIn: "טרם התחבר",
  userCreated: "המשתמש נוצר בהצלחה.",
  invalidEmail: "יש להזין כתובת אימייל תקינה.",
  missingName: "יש להזין שם לתצוגה.",
  userCreateError: "יצירת המשתמש נכשלה.",
  incidentAssignment: "שיוך אירועים",
  assignedTo: "משויך ל-",
  incidents: "אירועים",
  saveAssignments: "שמור שיוכים",
  assignmentSaved: "שיוכי האירועים עודכנו בהצלחה.",
  assignmentError: "עדכון שיוכי האירועים נכשל.",
  commanderAccessNote: "מפקד רואה כל אירוע פעיל גם ללא שיוך. השיוך מגדיר את תפקידו באירוע.",
  noActiveIncidents: "אין אירועים פעילים לשיוך.",
  userUpdated: "פרטי המשתמש עודכנו בהצלחה.",
  userDeactivated: "המשתמש הועבר למצב לא פעיל.",
  userRestored: "המשתמש שוחזר למצב פעיל.",
  userDeleted: "המשתמש נמחק במחיקה רכה. ההיסטוריה נשמרה."
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

function userActionMessage(code: string | undefined, message: string | undefined) {
  if (code === "updated") return { className: "success-panel", text: pageText.userUpdated };
  if (code === "deactivated") return { className: "success-panel", text: pageText.userDeactivated };
  if (code === "restored") return { className: "success-panel", text: pageText.userRestored };
  if (code === "deleted") return { className: "success-panel", text: pageText.userDeleted };
  if (code === "missing-name") return { className: "", text: pageText.missingName };
  if (code === "error") return { className: "", text: message || "הפעולה נכשלה." };
  return null;
}

export default async function AdminUsersPage({
  searchParams
}: {
  searchParams?: { passwordReset?: string; userCreate?: string; assignment?: string; userAction?: string; message?: string };
}) {
  const supabase = createClient();
  const [{ data: role }, { data: userResult }] = await Promise.all([
    supabase.rpc("current_user_role"),
    supabase.auth.getUser()
  ]);

  if (role !== "admin" || !userResult.user) {
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

  const users = (data ?? []) as AdminUserRow[];
  const activeIncidents = (activeIncidentRows ?? []) as ActiveIncidentRow[];
  const memberships = (membershipRows ?? []) as IncidentMembershipRow[];
  const message = resetMessage(searchParams?.passwordReset, searchParams?.message);
  const userCreateMessage = createUserMessage(searchParams?.userCreate, searchParams?.message);
  const assignmentStatusMessage = assignmentMessage(searchParams?.assignment, searchParams?.message);
  const actionStatusMessage = userActionMessage(searchParams?.userAction, searchParams?.message);

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

      {[message, userCreateMessage, assignmentStatusMessage, actionStatusMessage].filter(Boolean).map((item, index) => (
        <section className={`panel ${item?.className ?? ""}`} key={index}>
          <p className={item?.className ? "muted" : "error"}>{item?.text}</p>
        </section>
      ))}

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
          <OperationalLoadingButton className="button" label={pageText.createUser} loadingLabel="יוצר..." />
        </form>
      </details>

      <AdminUsersManagement
        users={users}
        activeIncidents={activeIncidents}
        memberships={memberships}
        currentUserId={userResult.user.id}
        roleLabels={roleLabels}
        text={pageText}
      />
    </main>
  );
}
