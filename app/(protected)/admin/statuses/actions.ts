"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const statusPath = "/admin/statuses";
const statusKeyPattern = /^[a-z][a-z0-9_]*$/;

type StatusSnapshot = {
  id: string;
  status_key: string;
  name: string | null;
  hebrew_label: string;
  color: string | null;
  sort_order: number | null;
  is_active: boolean;
};

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function positiveSortOrder(formData: FormData) {
  const raw = value(formData, "sortOrder");
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("\u05e1\u05d3\u05e8 \u05d4\u05d5\u05e4\u05e2\u05d4 \u05d7\u05d9\u05d9\u05d1 \u05dc\u05d4\u05d9\u05d5\u05ea \u05de\u05e1\u05e4\u05e8 \u05d7\u05d9\u05d5\u05d1\u05d9");
  }
  return parsed;
}

function normalizeStatusKey(label: string) {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);

  return base && statusKeyPattern.test(base) ? base : `custom_status_${Date.now()}`;
}

async function assertAdminClient() {
  const supabase = createClient();
  const [{ data: role, error }, { data: userResult }] = await Promise.all([
    supabase.rpc("current_user_role"),
    supabase.auth.getUser()
  ]);

  if (error || role !== "admin" || !userResult.user) {
    throw new Error("Admin permission is required");
  }

  return { supabase, userId: userResult.user.id };
}

async function auditStatusChange(
  logType: string,
  title: string,
  description: string,
  entityId: string | null,
  beforeState: Record<string, unknown> | null,
  afterState: Record<string, unknown> | null,
  metadata: Record<string, unknown> = {}
) {
  const supabase = createClient();
  await supabase.rpc("create_system_audit_event", {
    p_log_type: logType,
    p_title: title,
    p_description: description,
    p_entity_type: "operational_person_status",
    p_entity_id: entityId,
    p_before_state: beforeState,
    p_after_state: afterState,
    p_metadata: metadata
  });
}

function redirectWithStatus(status: string) {
  revalidatePath(statusPath);
  redirect(`${statusPath}?status=${status}`);
}

export async function addOperationalStatus(formData: FormData) {
  const label = value(formData, "label");
  const color = value(formData, "color") || null;
  const sortOrder = positiveSortOrder(formData);

  if (!label) {
    throw new Error("\u05e9\u05dd \u05e1\u05d8\u05d8\u05d5\u05e1 \u05d4\u05d5\u05d0 \u05e9\u05d3\u05d4 \u05d7\u05d5\u05d1\u05d4");
  }

  const { supabase, userId } = await assertAdminClient();
  const statusKey = normalizeStatusKey(value(formData, "statusKey") || label);
  const { data, error } = await supabase
    .from("status_types")
    .insert({
      incident_id: null,
      category: "person",
      status_key: statusKey,
      name: label,
      hebrew_label: label,
      color,
      is_open: true,
      is_dashboard_counted: true,
      is_default: true,
      is_active: true,
      counts_as_gap_resolved: false,
      sort_order: sortOrder,
      created_by: userId,
      updated_by: userId
    })
    .select("id,status_key,name,hebrew_label,color,sort_order,is_active")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  await auditStatusChange(
    "operational_status_added",
    "\u05e0\u05d5\u05e1\u05e3 \u05e1\u05d8\u05d8\u05d5\u05e1 \u05de\u05d1\u05e6\u05e2\u05d9",
    `\u05e0\u05d5\u05e1\u05e3 \u05e1\u05d8\u05d8\u05d5\u05e1 \u05de\u05d1\u05e6\u05e2\u05d9: ${label}`,
    data.id,
    null,
    data,
    { importance: "normal", status_key: statusKey }
  );

  redirectWithStatus("added");
}

export async function updateOperationalStatus(formData: FormData) {
  const statusId = value(formData, "statusId");
  const label = value(formData, "label");
  const color = value(formData, "color") || null;
  const sortOrder = positiveSortOrder(formData);

  if (!statusId || !label) {
    throw new Error("\u05d7\u05e1\u05e8 \u05de\u05d6\u05d4\u05d4 \u05e1\u05d8\u05d8\u05d5\u05e1 \u05d0\u05d5 \u05e9\u05dd \u05e1\u05d8\u05d8\u05d5\u05e1");
  }

  const { supabase, userId } = await assertAdminClient();
  const { data: existing, error: existingError } = await supabase
    .from("status_types")
    .select("id,status_key,name,hebrew_label,color,sort_order,is_active")
    .eq("id", statusId)
    .eq("category", "person")
    .maybeSingle<StatusSnapshot>();

  if (existingError || !existing) {
    throw new Error(existingError?.message ?? "\u05e1\u05d8\u05d8\u05d5\u05e1 \u05dc\u05d0 \u05e0\u05de\u05e6\u05d0");
  }

  if (existing.hebrew_label !== label) {
    const replacementKey = normalizeStatusKey(label);
    const { data: replacement, error: replacementError } = await supabase
      .from("status_types")
      .insert({
        incident_id: null,
        category: "person",
        status_key: replacementKey,
        name: label,
        hebrew_label: label,
        color,
        is_open: true,
        is_dashboard_counted: true,
        is_default: true,
        is_active: true,
        counts_as_gap_resolved: false,
        sort_order: sortOrder,
        created_by: userId,
        updated_by: userId
      })
      .select("id,status_key,name,hebrew_label,color,sort_order,is_active")
      .single();

    if (replacementError) {
      throw new Error(replacementError.message);
    }

    const { error: deactivateError } = await supabase
      .from("status_types")
      .update({
        is_active: false,
        disabled_at: new Date().toISOString(),
        disabled_by: userId,
        updated_by: userId
      })
      .eq("id", statusId);

    if (deactivateError) {
      throw new Error(deactivateError.message);
    }

    await auditStatusChange(
      "operational_status_edited",
      "\u05e1\u05d8\u05d8\u05d5\u05e1 \u05de\u05d1\u05e6\u05e2\u05d9 \u05e0\u05e2\u05e8\u05da",
      `\u05e1\u05d8\u05d8\u05d5\u05e1 \u05de\u05d1\u05e6\u05e2\u05d9 ${existing.hebrew_label} \u05d4\u05d5\u05d7\u05dc\u05e3 \u05e2\u05d1\u05d5\u05e8 \u05d1\u05d7\u05d9\u05e8\u05d5\u05ea \u05e2\u05ea\u05d9\u05d3\u05d9\u05d5\u05ea \u05dc-${label}`,
      replacement.id,
      existing,
      replacement,
      { importance: "normal", replaced_status_id: statusId }
    );
  } else {
    const { data: updated, error } = await supabase
      .from("status_types")
      .update({ name: label, hebrew_label: label, color, sort_order: sortOrder, updated_by: userId })
      .eq("id", statusId)
      .select("id,status_key,name,hebrew_label,color,sort_order,is_active")
      .single();

    if (error) {
      throw new Error(error.message);
    }

    await auditStatusChange(
      "operational_status_edited",
      "\u05e1\u05d8\u05d8\u05d5\u05e1 \u05de\u05d1\u05e6\u05e2\u05d9 \u05e0\u05e2\u05e8\u05da",
      `\u05e1\u05d8\u05d8\u05d5\u05e1 \u05de\u05d1\u05e6\u05e2\u05d9 \u05e0\u05e2\u05e8\u05da: ${label}`,
      statusId,
      existing,
      updated,
      { importance: "normal" }
    );
  }

  redirectWithStatus("updated");
}

export async function toggleOperationalStatus(formData: FormData) {
  const statusId = value(formData, "statusId");
  const nextActive = value(formData, "nextActive") === "true";

  if (!statusId) {
    throw new Error("\u05d7\u05e1\u05e8 \u05de\u05d6\u05d4\u05d4 \u05e1\u05d8\u05d8\u05d5\u05e1");
  }

  const { supabase, userId } = await assertAdminClient();
  const { data: existing, error: existingError } = await supabase
    .from("status_types")
    .select("id,status_key,name,hebrew_label,color,sort_order,is_active")
    .eq("id", statusId)
    .eq("category", "person")
    .maybeSingle<StatusSnapshot>();

  if (existingError || !existing) {
    throw new Error(existingError?.message ?? "\u05e1\u05d8\u05d8\u05d5\u05e1 \u05dc\u05d0 \u05e0\u05de\u05e6\u05d0");
  }

  const { data: updated, error } = await supabase
    .from("status_types")
    .update({
      is_active: nextActive,
      disabled_at: nextActive ? null : new Date().toISOString(),
      disabled_by: nextActive ? null : userId,
      updated_by: userId
    })
    .eq("id", statusId)
    .select("id,status_key,name,hebrew_label,color,sort_order,is_active")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  await auditStatusChange(
    nextActive ? "operational_status_reactivated" : "operational_status_deactivated",
    nextActive ? "\u05e1\u05d8\u05d8\u05d5\u05e1 \u05de\u05d1\u05e6\u05e2\u05d9 \u05d4\u05d5\u05e4\u05e2\u05dc \u05de\u05d7\u05d3\u05e9" : "\u05e1\u05d8\u05d8\u05d5\u05e1 \u05de\u05d1\u05e6\u05e2\u05d9 \u05d4\u05d5\u05e9\u05d1\u05ea",
    nextActive
      ? `\u05e1\u05d8\u05d8\u05d5\u05e1 \u05de\u05d1\u05e6\u05e2\u05d9 \u05d4\u05d5\u05e4\u05e2\u05dc \u05de\u05d7\u05d3\u05e9: ${existing.hebrew_label}`
      : `\u05e1\u05d8\u05d8\u05d5\u05e1 \u05de\u05d1\u05e6\u05e2\u05d9 \u05d4\u05d5\u05e9\u05d1\u05ea: ${existing.hebrew_label}`,
    statusId,
    existing,
    updated,
    { importance: "important" }
  );

  redirectWithStatus(nextActive ? "reactivated" : "deactivated");
}
