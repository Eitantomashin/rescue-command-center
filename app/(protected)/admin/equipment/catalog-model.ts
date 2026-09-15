export const serviceabilityLabels = {
  serviceable: "כשיר",
  restricted: "כשירות מוגבלת",
  unserviceable: "לא כשיר"
} as const;

export type EquipmentType = {
  id: string;
  name: string;
  category: string;
  full_runtime_seconds: number;
  warning_before_seconds: number;
  instructions: string | null;
  is_active: boolean;
};

export type EquipmentItem = {
  id: string;
  equipment_type_id: string;
  asset_identifier: string;
  serial_number: string | null;
  serviceability: keyof typeof serviceabilityLabels;
  notes: string | null;
  is_active: boolean;
};

export type SaveResult = { ok: boolean; message: string };
export type ItemFilters = { query: string; typeId: string; serviceability: string; active: string };

export function filterEquipmentItems(items: EquipmentItem[], filters: ItemFilters) {
  const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase("he-IL");
  const query = normalize(filters.query);
  return items.filter((item) =>
    (!filters.typeId || item.equipment_type_id === filters.typeId) &&
    (!filters.serviceability || item.serviceability === filters.serviceability) &&
    (!filters.active || item.is_active === (filters.active === "active")) &&
    (!query || [item.asset_identifier, item.serial_number ?? ""].some((value) => normalize(value).includes(query)))
  );
}

export function catalogSummary(types: EquipmentType[], items: EquipmentItem[]) {
  return {
    activeTypes: types.filter((type) => type.is_active).length,
    activeItems: items.filter((item) => item.is_active).length,
    unserviceable: items.filter((item) => item.serviceability === "unserviceable").length,
    inactiveItems: items.filter((item) => !item.is_active).length
  };
}

export function runtimeLabel(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Number(((seconds % 3600) / 60).toFixed(2));
  return `${hours} שעות ו־${minutes} דקות`;
}
