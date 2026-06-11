export function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("he-IL", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

export function formatNumber(value: number | null | undefined) {
  return new Intl.NumberFormat("he-IL").format(value ?? 0);
}
