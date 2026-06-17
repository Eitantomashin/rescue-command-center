"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const BUCKET = "site-grid-images";
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function requiredValue(formData: FormData, key: string, label: string) {
  const raw = value(formData, key);
  if (!raw) {
    throw new Error(`${label} הוא שדה חובה`);
  }
  return raw;
}

function safeFileName(name: string) {
  const extension = name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  return `active.${extension}`;
}

export async function uploadSiteGridImage(formData: FormData) {
  const incidentId = requiredValue(formData, "incidentId", "אירוע");
  const siteId = requiredValue(formData, "siteId", "אתר");
  const file = formData.get("siteImage");
  const path = `/incidents/${incidentId}/sites/${siteId}/grid-map`;

  if (!(file instanceof File) || file.size === 0) {
    throw new Error("יש לבחור תמונת אתר");
  }

  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new Error("ניתן להעלות תמונת JPG, PNG או WebP בלבד");
  }

  if (file.size > MAX_IMAGE_SIZE) {
    throw new Error("גודל התמונה המקסימלי הוא 10MB");
  }

  const supabase = createClient();
  const storagePath = `${incidentId}/${siteId}/${safeFileName(file.name)}`;
  const bytes = await file.arrayBuffer();
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, bytes, {
      contentType: file.type,
      upsert: true
    });

  if (uploadError) {
    throw new Error(uploadError.message);
  }

  const { error: updateError } = await supabase.rpc("update_site_grid_image", {
    p_site_id: siteId,
    p_image_path: `storage:${BUCKET}/${storagePath}`,
    p_image_name: file.name
  });

  if (updateError) {
    throw new Error(updateError.message);
  }

  revalidatePath(path, "page");
  redirect(path);
}

function optionalInteger(formData: FormData, key: string) {
  const raw = value(formData, key);
  if (!raw) {
    return null;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function parseGeometry(formData: FormData) {
  const raw = requiredValue(formData, "geometry", "גיאומטריה");
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("גיאומטריית מפה אינה תקינה");
  }
}

export async function createSiteMapObject(formData: FormData) {
  const incidentId = requiredValue(formData, "incidentId", "אירוע");
  const siteId = requiredValue(formData, "siteId", "אתר");
  const path = `/incidents/${incidentId}/sites/${siteId}/grid-map`;
  const supabase = createClient();

  const { error } = await supabase.rpc("create_site_map_object", {
    p_site_id: siteId,
    p_object_type: requiredValue(formData, "objectType", "סוג אובייקט"),
    p_name: requiredValue(formData, "name", "שם"),
    p_geometry: parseGeometry(formData),
    p_assigned_team_number: optionalInteger(formData, "assignedTeamNumber"),
    p_color: value(formData, "color") || null,
    p_operational_status: value(formData, "operationalStatus") || null,
    p_notes: value(formData, "notes") || null
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(path, "page");
  redirect(path);
}

export async function updateSiteMapObject(formData: FormData) {
  const incidentId = requiredValue(formData, "incidentId", "אירוע");
  const siteId = requiredValue(formData, "siteId", "אתר");
  const path = `/incidents/${incidentId}/sites/${siteId}/grid-map`;
  const supabase = createClient();

  const { error } = await supabase.rpc("update_site_map_object", {
    p_map_object_id: requiredValue(formData, "mapObjectId", "אובייקט מפה"),
    p_name: requiredValue(formData, "name", "שם"),
    p_geometry: parseGeometry(formData),
    p_assigned_team_number: optionalInteger(formData, "assignedTeamNumber"),
    p_color: value(formData, "color") || null,
    p_operational_status: value(formData, "operationalStatus") || null,
    p_notes: value(formData, "notes") || null,
    p_is_active: value(formData, "isActive") !== "false"
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(path, "page");
  redirect(path);
}
