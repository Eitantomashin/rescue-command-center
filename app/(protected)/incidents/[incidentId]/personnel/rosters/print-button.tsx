"use client";

export function VehicleRosterPrintButton({ label = "הדפס" }: { label?: string }) {
  return (
    <button className="button primary" type="button" onClick={() => window.print()}>
      {label}
    </button>
  );
}