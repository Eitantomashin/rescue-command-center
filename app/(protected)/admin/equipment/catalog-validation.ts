import { serviceabilityLabels } from "./catalog-model";

function value(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

function required(form: FormData, key: string, label: string) {
  const result = value(form, key);
  if (!result) throw new Error(`יש להזין ${label}.`);
  return result;
}

function number(form: FormData, key: string, label: string) {
  const raw = required(form, key, label);
  if (!/^\d+(?:\.\d+)?$/.test(raw)) throw new Error(`${label} חייב להיות מספר חיובי או אפס.`);
  const result = Number(raw);
  if (!Number.isFinite(result)) throw new Error(`${label} אינו תקין.`);
  return result;
}

function active(form: FormData) {
  const raw = value(form, "isActive");
  if (raw !== "true" && raw !== "false") throw new Error("יש לבחור מצב פעיל או מושבת.");
  return raw === "true";
}

export function equipmentId(form: FormData, key = "id", optional = true) {
  const id = value(form, key);
  if (!id && optional) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error("מזהה הרשומה אינו תקין. יש לרענן את המסך ולנסות שוב.");
  }
  return id;
}

export function equipmentTypePayload(form: FormData) {
  const hours = number(form, "runtimeHours", "שעות עבודה");
  const minutes = number(form, "runtimeMinutes", "דקות עבודה");
  const warning = number(form, "warningMinutes", "דקות התרעה");
  if (!Number.isInteger(hours) || minutes >= 60) throw new Error("יש להזין שעות שלמות ודקות בטווח 0 עד פחות מ־60.");
  const fullSeconds = Math.round(hours * 3600 + minutes * 60);
  const warningSeconds = Math.round(warning * 60);
  if (fullSeconds <= 0 || fullSeconds > 2147483647) throw new Error("זמן העבודה חייב להיות חיובי ובטווח תקין.");
  if (warningSeconds <= 0 || warningSeconds > 2147483647) throw new Error("זמן ההתרעה חייב להיות חיובי ובטווח תקין.");
  if (warningSeconds > fullSeconds) throw new Error("זמן ההתרעה לפני תדלוק אינו יכול להיות גדול מזמן העבודה המלא.");
  return {
    p_name: required(form, "name", "שם סוג ציוד"),
    p_category: required(form, "category", "קטגוריה"),
    p_full_runtime_seconds: fullSeconds,
    p_warning_before_seconds: warningSeconds,
    p_instructions: value(form, "instructions") || null,
    p_is_active: active(form)
  };
}

export function equipmentItemPayload(form: FormData) {
  const serviceability = value(form, "serviceability");
  if (!Object.prototype.hasOwnProperty.call(serviceabilityLabels, serviceability)) throw new Error("יש לבחור מצב כשירות תקין.");
  return {
    p_equipment_type_id: equipmentId(form, "equipmentTypeId", false),
    p_asset_identifier: required(form, "assetIdentifier", "מספר או כינוי ציוד"),
    p_serial_number: value(form, "serialNumber") || null,
    p_serviceability: serviceability,
    p_notes: value(form, "notes") || null,
    p_is_active: active(form)
  };
}

export function equipmentErrorMessage(error: { code?: string; message?: string }) {
  if (error.code === "23505") return "כבר קיים פריט עם המספר או הכינוי הזה, גם לאחר איחוד רווחים וללא הבדל בין אותיות גדולות לקטנות. יש לבחור מזהה אחר.";
  if (error.code === "42501" || error.code === "PGRST301") return "אין הרשאה לניהול ציוד. נדרש מנהל מערכת פעיל; ייתכן שיש להתחבר מחדש.";
  if (error.code === "23503") return "סוג הציוד שנבחר אינו קיים עוד. יש לרענן את המסך ולבחור סוג ציוד קיים.";
  if (error.code === "P0002") return "הרשומה לא נמצאה. יש לרענן את המסך ולנסות שוב.";
  if (error.code === "23502") return "חסר שדה חובה. יש להשלים את פרטי הציוד ולנסות שוב.";
  if (error.code === "23514") {
    if (error.message?.includes("warning_before")) return "זמן ההתרעה חייב להיות חיובי ולא לעלות על זמן העבודה המלא.";
    if (error.message?.includes("full_runtime")) return "זמן העבודה המלא חייב להיות חיובי.";
    if (error.message?.includes("serviceability")) return "מצב הכשירות שנבחר אינו תקין.";
    return "אחד מפרטי הציוד אינו עומד בכללי הקטלוג. יש לבדוק את שדות החובה והזמנים.";
  }
  if (error.code === "PGRST202" || error.code === "42P01") return "תשתית קטלוג הציוד אינה זמינה במסד הנתונים. יש לבדוק שהתקנתה הושלמה.";
  return "השמירה לא הושלמה עקב שגיאה בשרת או בחיבור. יש לרענן ולבדוק אם השינוי נשמר לפני ניסיון נוסף.";
}
