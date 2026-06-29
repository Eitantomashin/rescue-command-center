"use client";

export function SearchSiteReportPrintButton() {
  return (
    <button className="button secondary no-print" type="button" onClick={() => window.print()}>
      הדפס / PDF
    </button>
  );
}
