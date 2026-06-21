"use client";

import { useState } from "react";
import type { ReactNode } from "react";

export function DashboardCollapsibleSection({
  title,
  defaultOpen,
  className = "",
  action,
  children
}: {
  title: string;
  defaultOpen: boolean;
  className?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className={`panel section-spaced dashboard-collapsible-section ${className}`}>
      <button className="dashboard-collapsible-header" type="button" onClick={() => setOpen((value) => !value)}>
        <span>{title}</span>
        <strong>{open ? "\u05e1\u05d2\u05d5\u05e8" : "\u05e4\u05ea\u05d7"}</strong>
      </button>
      {open ? (
        <div className="dashboard-collapsible-body">
          {action ? <div className="dashboard-collapsible-action">{action}</div> : null}
          {children}
        </div>
      ) : null}
    </section>
  );
}
