"use client";

export function ClosureReportPrintButton() {
  return (
    <button className="button secondary no-print" type="button" onClick={() => window.print()}>
      הדפס / PDF
    </button>
  );
}
