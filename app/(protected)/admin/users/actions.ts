"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const allowedRoles = new Set(["admin", "commander", "editor", "viewer", "search_user"]);

async function assertServerAdmin() {
  const supabase = createClient();
  const { data: role, error } = await supabase.rpc("current_user_role");

  if (error || role !== "admin") {
    throw new Error("Admin permission is required");
  }

  return supabase;
}

export async function updateUserRole(formData: FormData) {
  const userId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "");

  if (!userId) {
    throw new Error("Missing user id");
  }

  if (!allowedRoles.has(role)) {
    throw new Error("Invalid role");
  }

  const supabase = await assertServerAdmin();
  const { data: existingProfile } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
  const { error } = await supabase.rpc("update_profile_role", {
    p_user_id: userId,
    p_role: role
  });

  if (error) {
    throw new Error(error.message);
  }

  await supabase.rpc("create_system_audit_event", {
    p_log_type: "user_role_changed",
    p_title: "שינוי תפקיד משתמש",
    p_description: `תפקיד המשתמש עודכן ל-${role}`,
    p_entity_type: "user",
    p_entity_id: userId,
    p_before_state: { role: existingProfile?.role ?? null },
    p_after_state: { role },
    p_metadata: { target_user_id: userId }
  });

  revalidatePath("/admin/users");
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

  const supabase = await assertServerAdmin();

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

  const supabase = await assertServerAdmin();
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

  const supabase = await assertServerAdmin();
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
