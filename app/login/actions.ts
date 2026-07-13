"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const supabase = createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    redirect("/login?error=1");
  }

  const { data: role } = await supabase.rpc("current_user_role");
  if (!role) {
    await supabase.auth.signOut();
    redirect("/login?error=inactive");
  }

  if (role === "search_user") {
    redirect("/mobile/search");
  }

  redirect("/incidents");
}

export async function signOut() {
  const supabase = createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
