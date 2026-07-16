"use server";

import * as XLSX from "xlsx";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function nullableValue(formData: FormData, key: string) {
  const raw = value(formData, key);
  return raw.length > 0 ? raw : null;
}

function requiredValue(formData: FormData, key: string, label: string) {
  const raw = value(formData, key);
  if (!raw) {
    throw new Error(`${label} הוא שדה חובה`);
  }
  return raw;
}

const requiredResidentHeaders = ["קומה", "דירה", "שם", "שם משפחה", "מין", "גיל", "טלפון", "הערות"];

function normalizeHeader(value: unknown) {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/[\u200E\u200F\u202A-\u202E]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeGender(value: string) {
  const normalized = value.trim();
  if (normalized === "זכר" || normalized.toLowerCase() === "male") return "male";
  if (normalized === "נקבה" || normalized.toLowerCase() === "female") return "female";
  return "unknown";
}

function parseAge(value: string) {
  if (!value.trim()) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? String(parsed) : "";
}

function parseResidentRows(buffer: Buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error("קובץ הייבוא ריק");
  }

  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[firstSheetName], {
    header: 1,
    defval: "",
    blankrows: false
  });
  const header = (rows[0] ?? []).map(normalizeHeader);
  const missing = requiredResidentHeaders.filter((name) => !header.includes(name));
  if (missing.length > 0) {
    throw new Error(`קובץ הייבוא חייב לכלול עמודות: ${missing.join(", ")}`);
  }

  const indexOf = (name: string) => header.indexOf(name);
  return rows.slice(1).map((row) => {
    const cell = (name: string) => String((row as unknown[])[indexOf(name)] ?? "").trim();
    return {
      floor: cell("קומה"),
      apartment: cell("דירה"),
      first_name: cell("שם"),
      last_name: cell("שם משפחה"),
      gender: normalizeGender(cell("מין")),
      age: parseAge(cell("גיל")),
      phone: cell("טלפון"),
      notes: cell("הערות")
    };
  }).filter((row) => row.first_name || row.last_name);
}

export async function cancelSiteFromListAction(formData: FormData) {
  const incidentId = requiredValue(formData, "incidentId", "אירוע");
  const siteId = requiredValue(formData, "siteId", "אתר");
  const supabase = createClient();
  const { error } = await supabase.rpc("cancel_site", {
    p_site_id: siteId,
    p_reason: requiredValue(formData, "reason", "סיבת ביטול"),
    p_reason_other: nullableValue(formData, "reasonOther")
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/incidents/${incidentId}`);
  revalidatePath(`/incidents/${incidentId}/sites`);
  revalidatePath(`/incidents/${incidentId}/sites/${siteId}`);
  revalidatePath(`/incidents/${incidentId}/war-room`);
  revalidatePath(`/incidents/${incidentId}/operational-log`);
  redirect(`/incidents/${incidentId}/sites`);
}

export async function updateSiteFromListAction(formData: FormData) {
  const incidentId = requiredValue(formData, "incidentId", "אירוע");
  const siteId = requiredValue(formData, "siteId", "אתר");
  const supabase = createClient();
  const { error } = await supabase.rpc("update_site_safe_details", {
    p_site_id: siteId,
    p_name: nullableValue(formData, "siteName"),
    p_site_type: requiredValue(formData, "siteType", "סוג אתר"),
    p_city: nullableValue(formData, "city"),
    p_street: requiredValue(formData, "street", "רחוב"),
    p_house_number: requiredValue(formData, "houseNumber", "מספר בית"),
    p_search_reason: nullableValue(formData, "siteDetails"),
    p_search_priority: nullableValue(formData, "searchPriority")
  });

  if (error) {
    console.error("Site details update failed", {
      incidentId,
      siteId,
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint
    });
    redirect(`/incidents/${incidentId}/sites?siteUpdate=error&siteId=${siteId}`);
  }

  revalidatePath(`/incidents/${incidentId}`);
  revalidatePath(`/incidents/${incidentId}/sites`);
  revalidatePath(`/incidents/${incidentId}/sites/${siteId}`);
  revalidatePath(`/incidents/${incidentId}/war-room`);
  revalidatePath(`/incidents/${incidentId}/operational-log`);
  redirect(`/incidents/${incidentId}/sites?siteUpdate=success&siteId=${siteId}`);
}

export async function importSiteResidentListAction(formData: FormData) {
  const incidentId = requiredValue(formData, "incidentId", "אירוע");
  const siteId = requiredValue(formData, "siteId", "אתר");
  const file = formData.get("residentFile");

  if (!(file instanceof File) || file.size === 0) {
    throw new Error("יש לבחור קובץ Excel לייבוא");
  }

  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    throw new Error("ניתן לייבא קובץ xlsx בלבד");
  }

  const rows = parseResidentRows(Buffer.from(await file.arrayBuffer()));
  if (rows.length === 0) {
    throw new Error("לא נמצאו דיירים לייבוא בקובץ");
  }

  const supabase = createClient();
  const { data: importedCount, error } = await supabase.rpc("import_site_residents", {
    p_site_id: siteId,
    p_rows: rows
  });

  if (error) {
    console.error("Site resident list import failed", {
      incidentId,
      siteId,
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint
    });
    redirect(`/incidents/${incidentId}/sites?residentImport=error&siteId=${siteId}`);
  }

  revalidatePath(`/incidents/${incidentId}`);
  revalidatePath(`/incidents/${incidentId}/sites`);
  revalidatePath(`/incidents/${incidentId}/sites/${siteId}`);
  redirect(`/incidents/${incidentId}/sites?residentImport=success&siteId=${siteId}&count=${importedCount ?? rows.length}`);
}
