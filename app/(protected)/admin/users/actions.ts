"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const allowedRoles = new Set(["admin", "commander", "editor", "viewer"]);

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
  const { error } = await supabase.rpc("update_profile_role", {
    p_user_id: userId,
    p_role: role
  });

  if (error) {
    throw new Error(error.message);
  }

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

  await assertServerAdmin();

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, {
    password
  });

  if (error) {
    redirect(`/admin/users?passwordReset=error&message=${encodeURIComponent(error.message)}`);
  }

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

  revalidatePath("/admin/users");
  redirect("/admin/users?userCreate=success");
}
