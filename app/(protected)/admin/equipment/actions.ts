"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { equipmentId, equipmentItemPayload, equipmentTypePayload, equipmentErrorMessage } from "./catalog-validation";
import type { SaveResult } from "./catalog-model";

async function saveCatalog(form: FormData, kind: "type" | "item"): Promise<SaveResult> {
  try {
    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { ok: false, message: "יש להתחבר כמנהל מערכת פעיל כדי לנהל ציוד." };
    const { data: allowed, error: permissionError } = await supabase.rpc("equipment_catalog_admin");
    if (permissionError || allowed !== true) return { ok: false, message: "אין הרשאה לניהול ציוד. הפעולה מותרת למנהל מערכת פעיל בלבד." };

    let id: string | null;
    let payload: ReturnType<typeof equipmentTypePayload> | ReturnType<typeof equipmentItemPayload>;
    try {
      id = equipmentId(form);
      payload = kind === "type" ? equipmentTypePayload(form) : equipmentItemPayload(form);
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "יש לבדוק את פרטי הטופס." };
    }
    const rpc = kind === "type"
      ? (id ? "update_equipment_type" : "create_equipment_type")
      : (id ? "update_equipment_item" : "create_equipment_item");
    const { data, error } = await supabase.rpc(rpc, id ? { p_id: id, ...payload } : payload);
    if (error) {
      console.error("Equipment catalog RPC failed", { rpc, code: error.code, message: error.message });
      return { ok: false, message: equipmentErrorMessage(error) };
    }
    if (!data) return { ok: false, message: "לא התקבל אישור שמירה מהשרת. יש לרענן ולבדוק את הרשומה." };
    revalidatePath("/admin/equipment");
    return { ok: true, message: kind === "type" ? "סוג הציוד נשמר בהצלחה." : "פריט הציוד נשמר בהצלחה." };
  } catch {
    return { ok: false, message: equipmentErrorMessage({}) };
  }
}

export async function saveEquipmentType(form: FormData): Promise<SaveResult> {
  return saveCatalog(form, "type");
}

export async function saveEquipmentItem(form: FormData): Promise<SaveResult> {
  return saveCatalog(form, "item");
}
