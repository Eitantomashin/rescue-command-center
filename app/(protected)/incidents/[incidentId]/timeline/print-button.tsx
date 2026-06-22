"use client";

export function TimelinePrintButton() {
  return <button className="button secondary timeline-print-button" type="button" onClick={() => window.print()}>הדפס ציר זמן</button>;
}
