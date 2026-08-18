"use client";

export function PersonnelReportPrintButton({ label = "הדפס דוח" }: { label?: string }) {
  return (
    <button className="button primary" type="button" onClick={() => window.print()}>
      {label}
    </button>
  );
}
