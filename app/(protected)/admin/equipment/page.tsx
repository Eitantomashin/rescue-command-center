import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { EquipmentCatalog } from "./equipment-catalog";
import type { EquipmentItem, EquipmentType } from "./catalog-model";

export default async function EquipmentPage() {
  const supabase = createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) notFound();
  const { data: allowed, error: permissionError } = await supabase.rpc("equipment_catalog_admin");
  if (permissionError) {
    return <main className="page" dir="rtl"><h1>ניהול ציוד</h1><p className="error" role="alert">לא ניתן לבדוק כרגע את הרשאות ניהול הציוד. יש לרענן ולנסות שוב.</p></main>;
  }
  if (allowed !== true) notFound();

  // Explicit pagination avoids silently truncating a catalog at the API row limit.
  async function readCatalog<T>(table: "equipment_types" | "equipment_items", columns: string): Promise<T[]> {
    const rows: T[] = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await supabase.from(table).select(columns).order("id").range(offset, offset + 499);
      if (error) throw error;
      rows.push(...(data as unknown as T[]));
      if (data.length < 500) return rows;
    }
  }
  try {
    const [types, items] = await Promise.all([
      readCatalog<EquipmentType>("equipment_types", "id,name,category,full_runtime_seconds,warning_before_seconds,instructions,is_active"),
      readCatalog<EquipmentItem>("equipment_items", "id,equipment_type_id,asset_identifier,serial_number,serviceability,notes,is_active")
    ]);
    types.sort((a, b) => a.name.localeCompare(b.name, "he"));
    items.sort((a, b) => a.asset_identifier.localeCompare(b.asset_identifier, "he", { numeric: true }));
    return <EquipmentCatalog types={types} items={items} />;
  } catch {
    return <main className="page" dir="rtl"><h1>ניהול ציוד</h1><section className="panel"><p className="error" role="alert">טעינת קטלוג הציוד נכשלה. יש לרענן את המסך ולנסות שוב.</p></section></main>;
  }
}
