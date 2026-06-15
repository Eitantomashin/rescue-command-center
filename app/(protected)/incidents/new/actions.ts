"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const labels = {
  incidentName: "\u05e9\u05dd \u05d4\u05d0\u05d9\u05e8\u05d5\u05e2",
  incidentType: "\u05e1\u05d5\u05d2 \u05d4\u05d0\u05d9\u05e8\u05d5\u05e2",
  primaryCity: "\u05e2\u05d9\u05e8 \u05e8\u05d0\u05e9\u05d9\u05ea",
  teams: "\u05e6\u05d5\u05d5\u05ea\u05d9\u05dd"
};

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function valueFromAny(formData: FormData, keys: string[]) {
  for (const key of keys) {
    const raw = value(formData, key);

    if (raw) {
      return raw;
    }
  }

  return "";
}

function nullableValue(formData: FormData, key: string) {
  const raw = value(formData, key);
  return raw.length > 0 ? raw : null;
}

function nullableValueFromAny(formData: FormData, keys: string[]) {
  const raw = valueFromAny(formData, keys);
  return raw.length > 0 ? raw : null;
}

function requiredValue(formData: FormData, key: string, label: string) {
  const raw = value(formData, key);

  if (!raw) {
    throw new Error(`${label} \u05d4\u05d5\u05d0 \u05e9\u05d3\u05d4 \u05d7\u05d5\u05d1\u05d4`);
  }

  return raw;
}

function requiredValueFromAny(formData: FormData, keys: string[], label: string) {
  const raw = valueFromAny(formData, keys);

  if (!raw) {
    throw new Error(`${label} \u05d4\u05d5\u05d0 \u05e9\u05d3\u05d4 \u05d7\u05d5\u05d1\u05d4`);
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
    throw new Error(`${label} \u05dc\u05d0 \u05e0\u05e9\u05dc\u05d7\u05d5 \u05d1\u05e6\u05d5\u05e8\u05d4 \u05ea\u05e7\u05d9\u05e0\u05d4`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`${label} \u05d7\u05d9\u05d9\u05d1\u05d9\u05dd \u05dc\u05d4\u05d9\u05d5\u05ea \u05e8\u05e9\u05d9\u05de\u05d4 \u05ea\u05e7\u05d9\u05e0\u05d4`);
  }

  return parsed;
}

function selectedTeamsValue(formData: FormData) {
  return jsonArrayValue(formData, "teamsPayload", labels.teams).filter(
    (team) =>
      team &&
      typeof team === "object" &&
      "selected" in team &&
      (team as { selected?: unknown }).selected === true
  );
}

export async function createIncidentFromWizard(formData: FormData) {
  const incidentName = requiredValue(formData, "incidentName", labels.incidentName);
  const incidentType = requiredValue(formData, "incidentType", labels.incidentType);
  const city = requiredValueFromAny(formData, ["primaryCity", "city"], labels.primaryCity);
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
    p_address: nullableValueFromAny(formData, ["primaryAddress", "address"]),
    p_initial_description: nullableValue(formData, "initialDescription"),
    p_command_structure: commandStructure,
    p_teams: teams
  });

  if (error) {
    throw new Error(error.message);
  }

  redirect(`/incidents/${incidentId}?created=1`);
}
