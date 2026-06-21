"use server";

import { revalidatePath } from "next/cache";
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
