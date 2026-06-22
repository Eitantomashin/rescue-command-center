"use client";

export function SitrepPrintActions() {
  const print = () => window.print();

  return (
    <div className="actions sitrep-print-actions">
      <button className="button secondary" type="button" onClick={print}>הדפס</button>
      <button className="button" type="button" onClick={print}>PDF</button>
    </div>
  );
}
