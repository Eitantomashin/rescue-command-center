"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/server";
import { PERSONNEL_DEPARTMENTS, PERSONNEL_ROLES } from "./personnel-options";

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

export async function createUnitPersonnel(formData: FormData) {
  const supabase = createClient();
  const firstName = requiredValue(formData, "firstName", "שם פרטי");
  const lastName = requiredValue(formData, "lastName", "שם משפחה");
  const mobilePhone = value(formData, "mobilePhone") || null;
  const { data: existingData, error: existingError } = await supabase
    .from("unit_personnel")
    .select("id,first_name,last_name,mobile_phone");

  if (existingError) {
    throw new Error(existingError.message);
  }

  const phone = normalizePhone(mobilePhone);
  const nameKey = normalizeName(firstName, lastName);
  const duplicate = ((existingData ?? []) as ExistingPersonnel[]).some((person) => {
    const existingPhone = normalizePhone(person.mobile_phone);
    return phone ? existingPhone === phone : normalizeName(person.first_name, person.last_name) === nameKey;
  });

  if (duplicate) {
    redirect("/personnel?duplicate=1");
  }

  const { error } = await supabase.rpc("create_unit_personnel", {
    p_first_name: firstName,
    p_last_name: lastName,
    p_role: requiredValue(formData, "role", "תפקיד"),
    p_department: requiredValue(formData, "department", "מחלקה"),
    p_mobile_phone: mobilePhone,
    p_role_other: value(formData, "roleOther") || null,
    p_department_other: value(formData, "departmentOther") || null
  });

  if (error) {
    if (duplicateMessage(error.message)) {
      redirect("/personnel?duplicate=1");
    }
    throw new Error(error.message);
  }

  revalidatePath("/personnel", "page");
  redirect("/personnel?created=1");
}

export async function updateUnitPersonnel(formData: FormData) {
  const supabase = createClient();
  const { error } = await supabase.rpc("update_unit_personnel", {
    p_personnel_id: requiredValue(formData, "personnelId", "איש צוות"),
    p_first_name: requiredValue(formData, "firstName", "שם פרטי"),
    p_last_name: requiredValue(formData, "lastName", "שם משפחה"),
    p_role: requiredValue(formData, "role", "תפקיד"),
    p_department: requiredValue(formData, "department", "מחלקה"),
    p_mobile_phone: value(formData, "mobilePhone") || null,
    p_is_active: value(formData, "isActive") !== "false",
    p_role_other: value(formData, "roleOther") || null,
    p_department_other: value(formData, "departmentOther") || null
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/personnel", "page");
}

type ImportRow = {
  firstName: string;
  lastName: string;
  role: string;
  roleOther: string | null;
  department: string;
  departmentOther: string | null;
  mobilePhone: string | null;
};

type ParsedPersonnelRows = {
  rows: ImportRow[];
  headerRowNumber: number;
};

type ExistingPersonnel = {
  id: string;
  first_name: string;
  last_name: string;
  mobile_phone: string | null;
};

function duplicateMessage(message: string) {
  return message.includes("האדם כבר קיים ברשימת כ");
}

function normalizePhone(value: string | null | undefined) {
  return String(value ?? "").replace(/[^\d+]/g, "");
}

function normalizeName(firstName: string, lastName: string) {
  return `${firstName} ${lastName}`.replace(/\s+/g, " ").trim().toLowerCase();
}

function optionKey(options: readonly (readonly [string, string])[], rawValue: string, fallback: string) {
  const raw = rawValue.trim();
  if (!raw) {
    return { key: fallback, other: null };
  }

  const normalizedValue = normalizeHeaderValue(raw);
  const byKey = options.find(([key]) => key === raw);
  if (byKey) {
    return { key: byKey[0], other: null };
  }

  const byLabel = options.find(([, label]) => normalizeHeaderValue(label) === normalizedValue);
  if (byLabel) {
    return { key: byLabel[0], other: null };
  }

  return { key: "other", other: raw };
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(cell.trim());
      if (row.some(Boolean)) {
        rows.push(row);
      }
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell.trim());
  if (row.some(Boolean)) {
    rows.push(row);
  }

  return rows;
}

function parseXlsx(buffer: Buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error("לא נמצא גיליון ראשון בקובץ Excel");
  }

  return XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], {
    header: 1,
    defval: "",
    blankrows: false
  }) as unknown[][];
}

function normalizeHeaderValue(cell: unknown) {
  return String(cell ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/[\u200E\u200F\u202A-\u202E]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isNonEmptyRow(row: unknown[]) {
  return row.some((cell) => normalizeHeaderValue(cell));
}

function headerIndex(header: unknown[], aliases: string[]) {
  const normalizedAliases = aliases.map(normalizeHeaderValue);
  return header.findIndex((cell) => normalizedAliases.includes(normalizeHeaderValue(cell)));
}

function formatRowsForError(rows: unknown[][]) {
  return JSON.stringify(rows.map((row) => row.map(normalizeHeaderValue)));
}

function detectHeaderRow(rows: unknown[][]) {
  const inspectedHeaders: string[][] = [];
  const maxScanRows = rows.slice(0, 10);

  for (let rowIndex = 0; rowIndex < maxScanRows.length; rowIndex += 1) {
    const row = maxScanRows[rowIndex];
    if (!isNonEmptyRow(row)) {
      continue;
    }

    const header = row.map(normalizeHeaderValue);
    inspectedHeaders.push(header);
    const firstNameIndex = headerIndex(header, ["שם פרטי", "פרטי"]);
    const lastNameIndex = headerIndex(header, ["שם משפחה", "משפחה"]);

    if (firstNameIndex >= 0 && lastNameIndex >= 0) {
      return { rowIndex, header, inspectedHeaders };
    }
  }

  return { rowIndex: -1, header: [], inspectedHeaders };
}

function cellValue(row: unknown[], index: number) {
  if (index < 0) {
    return "";
  }

  return String(row[index] ?? "").trim();
}

function rowsToPersonnel(rows: unknown[][]): ParsedPersonnelRows {
  const detected = detectHeaderRow(rows);
  if (detected.rowIndex < 0) {
    throw new Error(
      `קובץ הייבוא חייב לכלול עמודות: שם פרטי, שם משפחה. שורות ראשונות: ${formatRowsForError(
        rows.filter(isNonEmptyRow).slice(0, 5)
      )}. כותרות שנבדקו: ${JSON.stringify(detected.inspectedHeaders)}`
    );
  }

  const { rowIndex, header } = detected;
  const firstNameIndex = headerIndex(header, ["שם פרטי", "פרטי"]);
  const lastNameIndex = headerIndex(header, ["שם משפחה", "משפחה"]);
  const roleIndex = headerIndex(header, ["תפקיד"]);
  const departmentIndex = headerIndex(header, ["מחלקה", "צוות"]);
  const phoneIndex = headerIndex(header, ["טלפון נייד", "טלפון", "נייד"]);

  return {
    headerRowNumber: rowIndex + 1,
    rows: rows.slice(rowIndex + 1).map((row) => {
      const role = optionKey(PERSONNEL_ROLES, cellValue(row, roleIndex), "rescuer");
      const department = optionKey(PERSONNEL_DEPARTMENTS, cellValue(row, departmentIndex), "other");
      return {
        firstName: cellValue(row, firstNameIndex),
        lastName: cellValue(row, lastNameIndex),
        role: role.key,
        roleOther: role.other,
        department: department.key,
        departmentOther: department.other,
        mobilePhone: cellValue(row, phoneIndex) || null
      };
    })
  };
}

export async function importUnitPersonnel(formData: FormData) {
  const file = formData.get("personnelFile");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("יש לבחור קובץ ייבוא");
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const name = file.name.toLowerCase();
  if (!name.endsWith(".xlsx") && !name.endsWith(".csv")) {
    throw new Error("ניתן לייבא קובץ xlsx או csv בלבד");
  }

  const rows = name.endsWith(".xlsx") ? parseXlsx(bytes) : parseCsv(bytes.toString("utf8").replace(/^\uFEFF/, ""));
  const parsed = rowsToPersonnel(rows);
  const incoming = parsed.rows;
  const supabase = createClient();
  const { data: existingData, error: existingError } = await supabase
    .from("unit_personnel")
    .select("id,first_name,last_name,mobile_phone");

  if (existingError) {
    throw new Error(existingError.message);
  }

  const byPhone = new Map<string, ExistingPersonnel>();
  const byName = new Map<string, ExistingPersonnel>();
  for (const person of (existingData ?? []) as ExistingPersonnel[]) {
    const phone = normalizePhone(person.mobile_phone);
    if (phone) byPhone.set(phone, person);
    byName.set(normalizeName(person.first_name, person.last_name), person);
  }

  const seenPhones = new Set<string>();
  const seenNames = new Set<string>();
  let added = 0;
  let updated = 0;
  let skipped = 0;
  let invalid = 0;

  for (const row of incoming) {
    if (!row.firstName || !row.lastName) {
      invalid += 1;
      continue;
    }

    const phone = normalizePhone(row.mobilePhone);
    const nameKey = normalizeName(row.firstName, row.lastName);
    if ((phone && seenPhones.has(phone)) || seenNames.has(nameKey)) {
      skipped += 1;
      continue;
    }
    if (phone) seenPhones.add(phone);
    seenNames.add(nameKey);

    const existing = (phone ? byPhone.get(phone) : null) ?? byName.get(nameKey);
    if (existing) {
      const { error } = await supabase.rpc("update_unit_personnel", {
        p_personnel_id: existing.id,
        p_first_name: row.firstName,
        p_last_name: row.lastName,
        p_role: row.role,
        p_department: row.department,
        p_mobile_phone: row.mobilePhone,
        p_is_active: true,
        p_role_other: row.roleOther,
        p_department_other: row.departmentOther
      });
      if (error) invalid += 1;
      else updated += 1;
    } else {
      const { data: createdId, error } = await supabase.rpc("create_unit_personnel", {
        p_first_name: row.firstName,
        p_last_name: row.lastName,
        p_role: row.role,
        p_department: row.department,
        p_mobile_phone: row.mobilePhone,
        p_role_other: row.roleOther,
        p_department_other: row.departmentOther
      });
      if (error) {
        if (duplicateMessage(error.message)) {
          skipped += 1;
        } else {
          invalid += 1;
        }
      } else {
        added += 1;
        const created = {
          id: String(createdId),
          first_name: row.firstName,
          last_name: row.lastName,
          mobile_phone: row.mobilePhone
        };
        if (phone) byPhone.set(phone, created);
        byName.set(nameKey, created);
      }
    }
  }

  revalidatePath("/personnel", "page");
  redirect(`/personnel?imported=1&added=${added}&updated=${updated}&skipped=${skipped}&invalid=${invalid}&headerRow=${parsed.headerRowNumber}`);
}
