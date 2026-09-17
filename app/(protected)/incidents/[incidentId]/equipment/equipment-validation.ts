import type { EquipmentAction } from "./equipment-model";
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function uuid(value: unknown): string {
  if (typeof value !== "string" || !uuidPattern.test(value)) throw new Error("מזהה לא תקין. יש לרענן את המסך.");
  return value;
}
export function teamPayload(form: FormData) {
  const team = form.get("team");
  if (typeof team !== "string") throw new Error("יש לבחור צוות אחד בדיוק.");
  const [kind, id, extra] = team.split(":");
  if (extra !== undefined || !["regular", "ad_hoc"].includes(kind) || !uuidPattern.test(id ?? "")
    || form.getAll("team").length !== 1) throw new Error("יש לבחור צוות אחד בדיוק.");
  return { p_team_id: kind === "regular" ? id : null, p_ad_hoc_team_id: kind === "ad_hoc" ? id : null };
}
function optionalText(form: FormData, key: string, max: number) {
  const value = form.get(key);
  if (value === null) return null;
  if (typeof value !== "string" || value.length > max) throw new Error("הטקסט ארוך מדי או אינו תקין.");
  return value.trim() || null;
}
export const actionRpcs: Record<EquipmentAction, string> = {
  assign: "assign_equipment", update: "update_equipment_assignment", transfer: "transfer_equipment",
  release: "release_equipment", start: "start_equipment", pause: "pause_equipment", resume: "resume_equipment", refuel: "confirm_equipment_refuel"
};
export function actionPayload(action: EquipmentAction, form: FormData): Record<string, unknown> {
  if (!Object.hasOwn(actionRpcs, action)) throw new Error("פעולת ציוד לא תקינה.");
  const common = { p_incident_id: uuid(form.get("incidentId")), p_request_id: uuid(form.get("requestId")) };
  if (action === "assign") return { ...common, p_equipment_item_id: uuid(form.get("equipmentItemId")), ...teamPayload(form),
    p_location: optionalText(form, "location", 500), p_notes: optionalText(form, "notes", 5000) };
  const version = Number(form.get("version"));
  if (!Number.isSafeInteger(version) || version < 1) throw new Error("גרסת הציוד אינה תקינה. יש לרענן.");
  const existing = { ...common, p_assignment_id: uuid(form.get("assignmentId")), p_expected_version: version };
  if (action === "transfer") return { ...existing, ...teamPayload(form) };
  if (action === "update") return { ...existing, p_location: optionalText(form, "location", 500), p_notes: optionalText(form, "notes", 5000) };
  if (action === "release") return { ...existing, p_release_reason: optionalText(form, "reason", 500) ?? "החזרת ציוד למחסני היחידה" };
  return existing;
}
export function rpcError(error: { code?: string; message?: string }) {
  // Only known business messages may pass through; never expose arbitrary SQL.
  const businessMessages = [
    "פריט הציוד אינו פנוי להקצאה", "פריט הציוד או סוגו אינם פעילים וכשירים להקצאה",
    "הקצאת ציוד חדש מותרת רק באירוע פעיל", "הצוות אינו פעיל או אינו שייך לאירוע",
    "לא ניתן לשחרר ציוד פועל. נדרשת עצירה מפורשת", "הציוד כבר שוחרר מהאירוע",
    "מצב הציוד אינו מאפשר את הפעולה המבוקשת", "ניתן לאשר תדלוק רק למחזור שהופעל לפחות פעם אחת"
  ];
  if (["55000", "22023"].includes(error.code ?? "") && businessMessages.includes(error.message ?? "")) return `${error.message}.`;
  if (error.code === "22023" && error.message === "מזהה הבקשה כבר שימש לתוכן אחר") {
    return "הבקשה כבר שימשה לפעולה אחרת. יש לרענן ולשלוח ניסיון חדש.";
  }
  if (error.code === "40001") return "מצב הציוד השתנה בחלון או במכשיר אחר. הנתונים ירועננו; יש לבדוק ולנסות שוב.";
  if (error.code === "42501") return "אין הרשאה לפעולה באירוע זה. יש לבדוק שהמשתמש פעיל ומורשה.";
  if (error.code === "23505") return "הציוד כבר הוקצה או שהבקשה כבר טופלה. יש לרענן ולבדוק את המצב.";
  if (error.code === "22023") return "פרטי הבקשה אינם תקינים: יש לבחור צוות פעיל מהאירוע ולשלוח בקשה חדשה.";
  if (error.code === "55000") return "מצב האירוע או הציוד אינו מאפשר את הפעולה. להקצאה נדרש אירוע פעיל וציוד פנוי, פעיל וכשיר; לשחרור נדרשת עצירה.";
  if (error.code === "P0002") return "הקצאת הציוד אינה זמינה באירוע. יש לרענן את הנתונים.";
  return "הפעולה לא אושרה על ידי השרת. יש לרענן ולבדוק את המצב לפני ניסיון נוסף.";
}
