"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const allowedRoles = new Set(["admin", "commander", "editor", "viewer", "search_user"]);

async function assertServerAdmin() {
  const supabase = createClient();
  const [{ data: role, error }, { data: userResult }] = await Promise.all([
    supabase.rpc("current_user_role"),
    supabase.auth.getUser()
  ]);

  if (error || role !== "admin" || !userResult.user) {
    throw new Error("Admin permission is required");
  }

  return { supabase, actorId: userResult.user.id };
}

function userActionRedirect(code: string, message?: string): never {
  redirect(`/admin/users?userAction=${code}${message ? `&message=${encodeURIComponent(message)}` : ""}`);
}

async function countActiveAdmins(supabase: ReturnType<typeof createClient>) {
  const { count, error } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .in("role", ["admin", "system_administrator"])
    .eq("is_active", true)
    .is("deleted_at", null);

  if (error) {
    throw new Error(error.message);
  }

  return count ?? 0;
}

function isAdminRole(role: string | null | undefined) {
  return role === "admin" || role === "system_administrator";
}

export async function updateUserDetails(formData: FormData) {
  const userId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "");
  const displayName = String(formData.get("displayName") ?? "").trim();
  const status = String(formData.get("status") ?? "");

  if (!userId) {
    throw new Error("Missing user id");
  }

  if (!displayName) {
    userActionRedirect("missing-name");
  }

  if (!allowedRoles.has(role)) {
    throw new Error("Invalid role");
  }

  if (status !== "active" && status !== "inactive") {
    throw new Error("Invalid status");
  }

  const { supabase, actorId } = await assertServerAdmin();
  const { data: existingProfile, error: existingError } = await supabase
    .from("profiles")
    .select("display_name,role,is_active,deleted_at")
    .eq("id", userId)
    .maybeSingle();

  if (existingError) {
    throw new Error(existingError.message);
  }

  if (!existingProfile || existingProfile.deleted_at) {
    userActionRedirect("error", "המשתמש לא נמצא.");
  }

  const wasAdmin = isAdminRole(existingProfile.role);
  if (wasAdmin && role !== "admin" && existingProfile.is_active && (await countActiveAdmins(supabase)) <= 1) {
    userActionRedirect("error", "לא ניתן להסיר את המנהל הפעיל האחרון במערכת.");
  }

  const shouldBeActive = status === "active";
  if (existingProfile.is_active && !shouldBeActive) {
    if (userId === actorId) {
      userActionRedirect("error", "לא ניתן להשבית את המשתמש הנוכחי.");
    }
    if (wasAdmin) {
      userActionRedirect("error", "לא ניתן להשבית מנהל מערכת.");
    }
  }

  const { error: roleError } = await supabase.rpc("update_profile_role", {
    p_user_id: userId,
    p_role: role
  });

  if (roleError) {
    throw new Error(roleError.message);
  }

  const { error: nameError } = await supabase
    .from("profiles")
    .update({ display_name: displayName, updated_at: new Date().toISOString() })
    .eq("id", userId);

  if (nameError) {
    throw new Error(nameError.message);
  }

  if (existingProfile.is_active !== shouldBeActive) {
    const now = new Date().toISOString();
    const statusPatch = shouldBeActive
      ? { is_active: true, restored_at: now, restored_by: actorId, updated_at: now }
      : { is_active: false, deactivated_at: now, deactivated_by: actorId, updated_at: now };
    const { error: statusError } = await supabase.from("profiles").update(statusPatch).eq("id", userId);
    if (statusError) throw new Error(statusError.message);

    await supabase.rpc("create_system_audit_event", {
      p_log_type: shouldBeActive ? "user_restored" : "user_deactivated",
      p_title: shouldBeActive ? "שחזור משתמש" : "השבתת משתמש",
      p_description: shouldBeActive
        ? `המשתמש ${displayName} הוחזר למצב פעיל.`
        : `המשתמש ${displayName} הועבר למצב לא פעיל.`,
      p_entity_type: "user",
      p_entity_id: userId,
      p_before_state: { is_active: existingProfile.is_active },
      p_after_state: { is_active: shouldBeActive },
      p_metadata: { target_user_id: userId, performed_by: actorId }
    });
  }

  await supabase.rpc("create_system_audit_event", {
    p_log_type: "user_edited",
    p_title: "עדכון משתמש",
    p_description: `פרטי המשתמש ${displayName} עודכנו.`,
    p_entity_type: "user",
    p_entity_id: userId,
    p_before_state: { display_name: existingProfile.display_name ?? null, role: existingProfile.role ?? null },
    p_after_state: { display_name: displayName, role, is_active: shouldBeActive },
    p_metadata: { target_user_id: userId, performed_by: actorId }
  });

  revalidatePath("/admin/users");
  userActionRedirect("updated");
}

export async function updateUserRole(formData: FormData) {
  return updateUserDetails(formData);
}

export async function deactivateUser(formData: FormData) {
  const userId = String(formData.get("userId") ?? "");
  if (!userId) throw new Error("Missing user id");

  const { supabase, actorId } = await assertServerAdmin();
  if (userId === actorId) {
    userActionRedirect("error", "לא ניתן להשבית את המשתמש הנוכחי.");
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("display_name,role,is_active,deleted_at")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!profile || profile.deleted_at) userActionRedirect("error", "המשתמש לא נמצא.");
  if (isAdminRole(profile.role)) {
    userActionRedirect("error", "לא ניתן להשבית מנהל מערכת.");
  }
  if (!profile.is_active) {
    userActionRedirect("error", "המשתמש כבר לא פעיל.");
  }

  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("profiles")
    .update({ is_active: false, deactivated_at: now, deactivated_by: actorId, updated_at: now })
    .eq("id", userId);

  if (updateError) throw new Error(updateError.message);

  await supabase.rpc("create_system_audit_event", {
    p_log_type: "user_deactivated",
    p_title: "השבתת משתמש",
    p_description: `המשתמש ${profile.display_name ?? userId} הועבר למצב לא פעיל.`,
    p_entity_type: "user",
    p_entity_id: userId,
    p_before_state: { is_active: true },
    p_after_state: { is_active: false },
    p_metadata: { target_user_id: userId, performed_by: actorId }
  });

  revalidatePath("/admin/users");
  userActionRedirect("deactivated");
}

export async function restoreUser(formData: FormData) {
  const userId = String(formData.get("userId") ?? "");
  if (!userId) throw new Error("Missing user id");

  const { supabase, actorId } = await assertServerAdmin();
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("display_name,is_active,deleted_at")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!profile || profile.deleted_at) userActionRedirect("error", "המשתמש לא נמצא.");
  if (profile.is_active) userActionRedirect("error", "המשתמש כבר פעיל.");

  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("profiles")
    .update({ is_active: true, restored_at: now, restored_by: actorId, updated_at: now })
    .eq("id", userId);

  if (updateError) throw new Error(updateError.message);

  await supabase.rpc("create_system_audit_event", {
    p_log_type: "user_restored",
    p_title: "שחזור משתמש",
    p_description: `המשתמש ${profile.display_name ?? userId} הוחזר למצב פעיל.`,
    p_entity_type: "user",
    p_entity_id: userId,
    p_before_state: { is_active: false },
    p_after_state: { is_active: true },
    p_metadata: { target_user_id: userId, performed_by: actorId }
  });

  revalidatePath("/admin/users");
  userActionRedirect("restored");
}

export async function deleteUser(formData: FormData) {
  const userId = String(formData.get("userId") ?? "");
  if (!userId) throw new Error("Missing user id");

  const { supabase, actorId } = await assertServerAdmin();
  if (userId === actorId) {
    userActionRedirect("error", "לא ניתן למחוק את המשתמש הנוכחי.");
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("display_name,role,is_active,deleted_at")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!profile || profile.deleted_at) userActionRedirect("error", "המשתמש לא נמצא.");
  if (isAdminRole(profile.role)) {
    userActionRedirect("error", "לא ניתן למחוק מנהל מערכת.");
  }
  if (profile.is_active) userActionRedirect("error", "ניתן למחוק רק משתמש לא פעיל.");

  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("profiles")
    .update({ deleted_at: now, deleted_by: actorId, is_active: false, updated_at: now })
    .eq("id", userId);

  if (updateError) throw new Error(updateError.message);

  await supabase.rpc("create_system_audit_event", {
    p_log_type: "user_deleted",
    p_title: "מחיקת משתמש",
    p_description: `המשתמש ${profile.display_name ?? userId} נמחק במחיקה רכה. ההיסטוריה המבצעית נשמרה.`,
    p_entity_type: "user",
    p_entity_id: userId,
    p_before_state: { is_active: false, deleted_at: null },
    p_after_state: { is_active: false, deleted_at: now },
    p_metadata: { target_user_id: userId, performed_by: actorId, deletion_type: "soft" }
  });

  revalidatePath("/admin/users");
  userActionRedirect("deleted");
}

export async function resetUserPassword(formData: FormData) {
  const userId = String(formData.get("userId") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (!userId) {
    throw new Error("Missing user id");
  }

  if (password.length < 8) {
    redirect("/admin/users?passwordReset=too-short");
  }

  if (password !== confirmPassword) {
    redirect("/admin/users?passwordReset=mismatch");
  }

  const { supabase } = await assertServerAdmin();
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, {
    password
  });

  if (error) {
    redirect(`/admin/users?passwordReset=error&message=${encodeURIComponent(error.message)}`);
  }

  await supabase.rpc("create_system_audit_event", {
    p_log_type: "user_password_reset",
    p_title: "איפוס סיסמת משתמש",
    p_description: "סיסמת משתמש אופסה על ידי מנהל מערכת",
    p_entity_type: "user",
    p_entity_id: userId,
    p_before_state: null,
    p_after_state: null,
    p_metadata: { target_user_id: userId }
  });

  revalidatePath("/admin/users");
  redirect("/admin/users?passwordReset=success");
}

export async function createAdminUser(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const displayName = String(formData.get("displayName") ?? "").trim();
  const password = String(formData.get("temporaryPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  const role = String(formData.get("role") ?? "viewer");

  if (!email || !email.includes("@")) {
    redirect("/admin/users?userCreate=invalid-email");
  }

  if (!displayName) {
    redirect("/admin/users?userCreate=missing-name");
  }

  if (password.length < 8) {
    redirect("/admin/users?userCreate=too-short");
  }

  if (password !== confirmPassword) {
    redirect("/admin/users?userCreate=mismatch");
  }

  if (!allowedRoles.has(role)) {
    throw new Error("Invalid role");
  }

  const { supabase } = await assertServerAdmin();
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      display_name: displayName
    }
  });

  if (error || !data.user) {
    redirect(`/admin/users?userCreate=error&message=${encodeURIComponent(error?.message ?? "User creation failed")}`);
  }

  const { error: profileError } = await supabase.rpc("set_created_user_profile", {
    p_user_id: data.user.id,
    p_display_name: displayName,
    p_role: role
  });

  if (profileError) {
    redirect(`/admin/users?userCreate=profile-error&message=${encodeURIComponent(profileError.message)}`);
  }

  await supabase.rpc("create_system_audit_event", {
    p_log_type: "user_created",
    p_title: "יצירת משתמש",
    p_description: `נוצר משתמש ${displayName}`,
    p_entity_type: "user",
    p_entity_id: data.user.id,
    p_before_state: null,
    p_after_state: { display_name: displayName, email, role },
    p_metadata: { target_user_id: data.user.id, email }
  });

  revalidatePath("/admin/users");
  redirect("/admin/users?userCreate=success");
}

export async function updateUserIncidentAssignments(formData: FormData) {
  const userId = String(formData.get("userId") ?? "");
  const incidentIds = formData
    .getAll("incidentIds")
    .map((value) => String(value))
    .filter(Boolean);

  if (!userId) {
    throw new Error("Missing user id");
  }

  const { supabase } = await assertServerAdmin();
  const { error } = await supabase.rpc("set_user_incident_assignments", {
    p_user_id: userId,
    p_incident_ids: incidentIds
  });

  if (error) {
    redirect(`/admin/users?assignment=error&message=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/admin/users");
  redirect("/admin/users?assignment=success");
}
