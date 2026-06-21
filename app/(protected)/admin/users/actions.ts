"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const allowedRoles = new Set(["admin", "commander", "editor", "viewer"]);

export async function updateUserRole(formData: FormData) {
  const userId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "");

  if (!userId) {
    throw new Error("Missing user id");
  }

  if (!allowedRoles.has(role)) {
    throw new Error("Invalid role");
  }

  const supabase = createClient();
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

  const supabase = createClient();
  const { data: role, error: roleError } = await supabase.rpc("current_user_role");

  if (roleError || role !== "admin") {
    throw new Error("Admin permission is required");
  }

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
