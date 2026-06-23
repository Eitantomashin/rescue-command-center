export type OperationalTeamRange = {
  min: number;
  max: number;
};

const SECONDARY_TEAM_LABELS = new Map<number, string>([
  [11, "צוות 1ב'"],
  [12, "צוות 2ב'"],
  [13, "צוות 3ב'"]
]);

export function operationalTeamLabel(teamNumber: number | null | undefined, customName?: string | null) {
  if (!teamNumber) return "ללא צוות";
  if (customName?.trim()) return customName.trim();
  if (SECONDARY_TEAM_LABELS.has(teamNumber)) return SECONDARY_TEAM_LABELS.get(teamNumber)!;
  if (teamNumber === 9) return "צוות 9 אוכלוסייה";
  return `צוות ${teamNumber}`;
}

export function operationalTeamRange(teamNumber: number): OperationalTeamRange {
  if (teamNumber === 11) return { min: 1101, max: 1199 };
  if (teamNumber === 12) return { min: 1201, max: 1299 };
  if (teamNumber === 13) return { min: 1301, max: 1399 };
  return { min: teamNumber * 100 + 1, max: teamNumber * 100 + 99 };
}

export function parseOperationalTeamNumber(input: string) {
  const normalized = input.trim();
  if (!normalized) return null;

  const secondaryMatch = normalized.match(/^([123])\s*ב'?$/);
  if (secondaryMatch) return 10 + Number(secondaryMatch[1]);

  const numberMatch = normalized.match(/\d+/);
  return numberMatch ? Number(numberMatch[0]) : null;
}
