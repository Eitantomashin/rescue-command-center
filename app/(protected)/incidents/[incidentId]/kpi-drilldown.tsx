"use client";

import Link from "next/link";
import { useState } from "react";
import { formatNumber } from "@/lib/format";

export type KpiDrilldownRow = {
  label: string;
  href?: string | null;
  value: number;
};

export type KpiDrilldownItem = {
  id: string;
  label: string;
  value: number;
  tone?: "default" | "gap";
  detailLabel: string;
  rows: KpiDrilldownRow[];
};

export function KpiDrilldown({ items }: { items: KpiDrilldownItem[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const openItem = items.find((item) => item.id === openId) ?? null;

  return (
    <section className="kpi-drilldown-section" aria-label="מדדי פיקוד">
      <div className="kpi-grid">
        {items.map((item) => {
          const isOpen = openId === item.id;

          return (
            <button
              aria-expanded={isOpen}
              className={`kpi-card kpi-clickable ${item.tone === "gap" ? "kpi-gap" : ""} ${isOpen ? "active" : ""}`}
              key={item.id}
              type="button"
              onClick={() => setOpenId(isOpen ? null : item.id)}
            >
              <span>{item.label}</span>
              <strong>{formatNumber(item.value)}</strong>
            </button>
          );
        })}
      </div>

      {openItem ? (
        <div className="panel kpi-drilldown-panel">
          <div className="command-section-heading">
            <div>
              <h2>{`פירוט ${openItem.label}`}</h2>
              <p className="muted">פירוק לפי אתר</p>
            </div>
          </div>
          <table className="table kpi-drilldown-table">
            <thead>
              <tr>
                <th>אתר</th>
                <th>{openItem.detailLabel}</th>
              </tr>
            </thead>
            <tbody>
              {openItem.rows.map((row) => (
                <tr key={row.label}>
                  <td>{row.href ? <Link href={row.href}>{row.label}</Link> : row.label}</td>
                  <td>{formatNumber(row.value)}</td>
                </tr>
              ))}
              <tr className="kpi-drilldown-total-row">
                <td>סה&quot;כ</td>
                <td>{formatNumber(openItem.value)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
