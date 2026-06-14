"use server";

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

function jsonArrayValue(formData: FormData, key: string, label: string) {
  const raw = value(formData, key);

  if (!raw) {
    return [];
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${label} לא נשלחו בצורה תקינה`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`${label} חייבים להיות רשימה תקינה`);
  }

  return parsed;
}

function selectedTeamsValue(formData: FormData) {
  return jsonArrayValue(formData, "teamsPayload", "צוותים").filter(
    (team) =>
      team &&
      typeof team === "object" &&
      "selected" in team &&
      (team as { selected?: unknown }).selected === true
  );
}

export async function createIncidentFromWizard(formData: FormData) {
  const incidentName = requiredValue(formData, "incidentName", "שם האירוע");
  const incidentType = requiredValue(formData, "incidentType", "סוג האירוע");
  const city = requiredValue(formData, "city", "עיר ראשית");
  const teams = selectedTeamsValue(formData);

  const commandStructure = {
    incident_commander: nullableValue(formData, "incidentCommander"),
    commander_phone: nullableValue(formData, "commanderPhone"),
    deputy_commander: nullableValue(formData, "deputyCommander"),
    operations_officer: nullableValue(formData, "operationsOfficer"),
    population_officer: nullableValue(formData, "populationOfficer"),
    notes: nullableValue(formData, "commandNotes")
  };

  const supabase = createClient();
  const { data: incidentId, error } = await supabase.rpc("create_incident_from_wizard", {
    p_incident_name: incidentName,
    p_incident_type: incidentType,
    p_city: city,
    p_address: nullableValue(formData, "address"),
    p_initial_description: nullableValue(formData, "initialDescription"),
    p_command_structure: commandStructure,
    p_teams: teams
  });

  if (error) {
    throw new Error(error.message);
  }

  redirect(`/incidents/${incidentId}?created=1`);
}
