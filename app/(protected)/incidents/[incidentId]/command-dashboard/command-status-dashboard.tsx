"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useMemo, useState, useTransition } from "react";
import { formatDateTime, formatNumber } from "@/lib/format";
import type { CommandTimelineEvent } from "./actions";

export type CommandStatusDefinition = { id: string; label: string; tone: string; icon?: string };
export type CommandStatusRow = {
  personId: string;
  statusId: string;
  statusLabel: string;
  operationalNumber: number;
  name: string | null;
  siteName: string | null;
  floorApartment: string | null;
  assignedTeam: string | null;
  lastUpdatedAt: string | null;
  phone?: string | null;
  notes?: string | null;
  siteHref?: string | null;
  teamHref?: string | null;
  operationalNumberHref?: string | null;
};

type SortKey = "number" | "name" | "site" | "team" | "updated";

type Props = {
  statuses: CommandStatusDefinition[];
  rows: CommandStatusRow[];
  initialStatusId?: string | null;
  loadTimeline: (personId: string) => Promise<CommandTimelineEvent[]>;
};

function text(value: string | null | undefined) {
  return value?.trim() || "\u2014";
}

function compareNullableDate(a: string | null, b: string | null) {
  return new Date(b ?? 0).getTime() - new Date(a ?? 0).getTime();
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="command-empty-state">{children}</div>;
}

export function StatusBadge({ children, tone = "gray" }: { children: ReactNode; tone?: string }) {
  return <span className={`command-status-badge tone-${tone}`}>{children}</span>;
}

export function CommandDashboardHeader({ eyebrow, title, description, totalLabel, totalValue }: { eyebrow: string; title: string; description?: string; totalLabel?: string; totalValue?: number }) {
  return (
    <section className="casualties-dashboard-hero command-dashboard-header">
      <div>
        <span>{eyebrow}</span>
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {typeof totalValue === "number" ? (
        <div className="casualty-hero-total">
          <span>{totalLabel}</span>
          <strong>{formatNumber(totalValue)}</strong>
        </div>
      ) : null}
    </section>
  );
}

export function StatusOverviewCards({ statuses, rows, selectedStatusId, onSelect }: { statuses: CommandStatusDefinition[]; rows: CommandStatusRow[]; selectedStatusId: string | null; onSelect: (id: string) => void }) {
  return (
    <section className="casualty-status-overview command-status-overview" aria-label="\u05ea\u05de\u05d5\u05e0\u05ea \u05de\u05e6\u05d1">
      {statuses.map((status) => {
        const count = rows.filter((row) => row.statusId === status.id).length;
        const active = selectedStatusId === status.id;
        return (
          <button key={status.id} className={`casualty-status-card tone-${status.tone}${active ? " active" : ""}`} type="button" onClick={() => onSelect(status.id)} aria-pressed={active}>
            <span className="casualty-status-icon">{status.icon ?? "\u25cf"}</span>
            <span>{status.label}</span>
            <strong>{formatNumber(count)}</strong>
            <small>{active ? "\u05e4\u05d9\u05e8\u05d5\u05d8 \u05e4\u05ea\u05d5\u05d7" : "\u05dc\u05d7\u05e5 \u05dc\u05e4\u05d9\u05e8\u05d5\u05d8"}</small>
          </button>
        );
      })}
    </section>
  );
}

export function StatusDrilldownTable({ title, rows, selectedPersonId, onClose, onDetails }: { title: string; rows: CommandStatusRow[]; selectedPersonId: string | null; onClose: () => void; onDetails: (row: CommandStatusRow) => void }) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("number");
  const normalizedQuery = query.trim().toLocaleLowerCase("he");
  const filteredRows = useMemo(() => {
    const next = normalizedQuery
      ? rows.filter((row) => [row.operationalNumber, row.name, row.siteName, row.floorApartment, row.assignedTeam, row.statusLabel].join(" ").toLocaleLowerCase("he").includes(normalizedQuery))
      : rows;
    return Array.from(next).sort((a, b) => {
      if (sortKey === "number") return a.operationalNumber - b.operationalNumber;
      if (sortKey === "updated") return compareNullableDate(a.lastUpdatedAt, b.lastUpdatedAt);
      const av = sortKey === "name" ? text(a.name) : sortKey === "site" ? text(a.siteName) : text(a.assignedTeam);
      const bv = sortKey === "name" ? text(b.name) : sortKey === "site" ? text(b.siteName) : text(b.assignedTeam);
      return av.localeCompare(bv, "he");
    });
  }, [normalizedQuery, rows, sortKey]);

  return (
    <section className="panel casualty-drilldown-panel command-drilldown-panel">
      <div className="section-heading-row command-drilldown-heading">
        <div>
          <p className="section-eyebrow">{"\u05e9\u05dc\u05d1 2 \u00b7 \u05d3\u05e8\u05d9\u05dc \u05d3\u05d0\u05d5\u05df \u05dc\u05e4\u05d9 \u05e1\u05d8\u05d8\u05d5\u05e1"}</p>
          <h2>{title}</h2>
        </div>
        <button className="button compact secondary command-close-detail" type="button" onClick={onClose}>{"\u05e1\u05d2\u05d5\u05e8 \u05e4\u05d9\u05e8\u05d5\u05d8"}</button>
      </div>
      <div className="command-table-tools">
        <label><span>{"\u05d7\u05d9\u05e4\u05d5\u05e9"}</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={"\u05d7\u05e4\u05e9 \u05de\u05e1\u05e4\u05e8, \u05e9\u05dd, \u05d0\u05ea\u05e8..."} /></label>
        <label><span>{"\u05de\u05d9\u05d5\u05df"}</span><select value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}><option value="number">{"\u05de\u05e1\u05e4\u05e8 \u05de\u05d1\u05e6\u05e2\u05d9"}</option><option value="name">{"\u05e9\u05dd"}</option><option value="site">{"\u05d0\u05ea\u05e8"}</option><option value="team">{"\u05e6\u05d5\u05d5\u05ea"}</option><option value="updated">{"\u05e2\u05d3\u05db\u05d5\u05df \u05d0\u05d7\u05e8\u05d5\u05df"}</option></select></label>
      </div>
      <div className="responsive-table casualty-drilldown-table command-drilldown-table">
        <table>
          <thead><tr><th>{"\u05de\u05e1\u05e4\u05e8 \u05de\u05d1\u05e6\u05e2\u05d9"}</th><th>{"\u05e9\u05dd"}</th><th>{"\u05d0\u05ea\u05e8"}</th><th>{"\u05e7\u05d5\u05de\u05d4 / \u05d3\u05d9\u05e8\u05d4"}</th><th>{"\u05e9\u05d9\u05d5\u05da"}</th><th>{"\u05d6\u05de\u05df \u05e2\u05d3\u05db\u05d5\u05df \u05d0\u05d7\u05e8\u05d5\u05df"}</th><th className="command-action-col">{"\u05e4\u05e2\u05d5\u05dc\u05d4"}</th></tr></thead>
          <tbody>
            {filteredRows.length ? filteredRows.map((row) => (
              <tr key={row.personId} className={selectedPersonId === row.personId ? "selected-row" : ""}>
                <td data-label="\u05de\u05e1\u05e4\u05e8 \u05de\u05d1\u05e6\u05e2\u05d9"><strong>#{formatNumber(row.operationalNumber)}</strong></td>
                <td data-label="\u05e9\u05dd">{text(row.name)}</td>
                <td data-label="\u05d0\u05ea\u05e8">{text(row.siteName)}</td>
                <td data-label="\u05e7\u05d5\u05de\u05d4 / \u05d3\u05d9\u05e8\u05d4">{text(row.floorApartment)}</td>
                <td data-label="\u05e9\u05d9\u05d5\u05da">{text(row.assignedTeam)}</td>
                <td data-label="\u05e2\u05d3\u05db\u05d5\u05df \u05d0\u05d7\u05e8\u05d5\u05df">{row.lastUpdatedAt ? formatDateTime(row.lastUpdatedAt) : "\u2014"}</td>
                <td className="command-action-cell"><button className="small-action-button command-details-button" type="button" onClick={() => onDetails(row)}>{"\u05e6\u05e4\u05d4 \u05d1\u05e4\u05e8\u05d8\u05d9\u05dd"}</button></td>
              </tr>
            )) : <tr><td colSpan={7}>No casualties in this status.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function OperationalTimeline({ events, loading }: { events: CommandTimelineEvent[]; loading: boolean }) {
  if (loading) return <div className="command-loading-state">{"\u05d8\u05d5\u05e2\u05df \u05e6\u05d9\u05e8 \u05d6\u05de\u05df..."}</div>;
  return <ol className="casualty-timeline-list command-timeline-list">{events.length ? events.map((item) => <li key={item.id}><time>{item.timeLabel ?? (item.time ? formatDateTime(item.time) : "\u2014")}</time><strong>{item.title}</strong>{item.source ? <span>{item.source}</span> : null}{item.actor ? <span>{item.actor}</span> : null}{item.description ? <p>{item.description}</p> : null}{item.remarks ? <p>{item.remarks}</p> : null}</li>) : <li><strong>{"\u05d0\u05d9\u05df \u05d4\u05d9\u05e1\u05d8\u05d5\u05e8\u05d9\u05d4 \u05d6\u05de\u05d9\u05e0\u05d4"}</strong></li>}</ol>;
}

export function CasualtyDetailsDrawer({ row, timeline, loading, onClose }: { row: CommandStatusRow | null; timeline: CommandTimelineEvent[]; loading: boolean; onClose: () => void }) {
  if (!row) return null;
  const originalReportHref = timeline.find((item) => item.href)?.href ?? null;
  return (
    <aside className="command-details-drawer" role="dialog" aria-modal="true" aria-label="\u05e4\u05e8\u05d8\u05d9 \u05e0\u05e4\u05d2\u05e2">
      <div className="command-details-drawer-header">
        <div><span>{"\u05e9\u05dc\u05d1 3 \u00b7 \u05e4\u05e8\u05d8\u05d9 \u05de\u05e1\u05e4\u05e8 \u05de\u05d1\u05e6\u05e2\u05d9"}</span><h2>{"\u05de\u05e1\u05e4\u05e8 \u05de\u05d1\u05e6\u05e2\u05d9"} #{formatNumber(row.operationalNumber)}</h2></div>
        <button type="button" onClick={onClose} aria-label="\u05e1\u05d2\u05d5\u05e8">{"\u00d7"}</button>
      </div>
      <StatusBadge tone="red">{row.statusLabel}</StatusBadge>
      <section className="command-details-section"><h3>{"\u05e4\u05e8\u05d8\u05d9\u05dd \u05de\u05e8\u05db\u05d6\u05d9\u05d9\u05dd"}</h3><dl className="command-detail-grid"><div><dt>{"\u05e9\u05dd"}</dt><dd>{text(row.name)}</dd></div><div><dt>{"\u05e1\u05d8\u05d8\u05d5\u05e1 \u05e0\u05d5\u05db\u05d7\u05d9"}</dt><dd>{row.statusLabel}</dd></div><div><dt>{"\u05d0\u05ea\u05e8"}</dt><dd>{text(row.siteName)}</dd></div><div><dt>{"\u05e7\u05d5\u05de\u05d4 / \u05d3\u05d9\u05e8\u05d4"}</dt><dd>{text(row.floorApartment)}</dd></div><div><dt>{"\u05e9\u05d9\u05d5\u05da / \u05e6\u05d5\u05d5\u05ea"}</dt><dd>{text(row.assignedTeam)}</dd></div><div><dt>{"\u05d8\u05dc\u05e4\u05d5\u05df"}</dt><dd>{text(row.phone)}</dd></div><div><dt>{"\u05e2\u05d3\u05db\u05d5\u05df \u05d0\u05d7\u05e8\u05d5\u05df"}</dt><dd>{row.lastUpdatedAt ? formatDateTime(row.lastUpdatedAt) : "\u2014"}</dd></div><div className="wide"><dt>{"\u05d4\u05e2\u05e8\u05d5\u05ea"}</dt><dd>{text(row.notes)}</dd></div></dl></section>
      <section className="command-details-section"><h3>{"\u05e0\u05d9\u05d5\u05d5\u05d8 \u05de\u05d4\u05d9\u05e8"}</h3><div className="command-quick-nav">{row.siteHref ? <Link href={row.siteHref}>{"\u05d0\u05ea\u05e8"}</Link> : null}{row.teamHref ? <Link href={row.teamHref}>{"\u05e6\u05d5\u05d5\u05ea / \u05db\u05d5\u05d7"}</Link> : null}{row.operationalNumberHref ? <Link href={row.operationalNumberHref}>{"\u05de\u05e1\u05e4\u05e8 \u05de\u05d1\u05e6\u05e2\u05d9"}</Link> : null}{originalReportHref ? <Link href={originalReportHref}>{"\u05d3\u05d9\u05d5\u05d5\u05d7 \u05de\u05e7\u05d5\u05e8"}</Link> : null}</div></section>
      <section className="command-details-section command-timeline-section"><h3>{"\u05e6\u05d9\u05e8 \u05d6\u05de\u05df \u05de\u05d1\u05e6\u05e2\u05d9"}</h3><OperationalTimeline events={timeline} loading={loading} /></section>
    </aside>
  );
}

export function CommandStatusDashboard({ statuses, rows, initialStatusId = null, loadTimeline }: Props) {
  const [selectedStatusId, setSelectedStatusId] = useState<string | null>(initialStatusId);
  const [selectedRow, setSelectedRow] = useState<CommandStatusRow | null>(null);
  const [timeline, setTimeline] = useState<CommandTimelineEvent[]>([]);
  const [isPending, startTransition] = useTransition();
  const selectedStatus = statuses.find((status) => status.id === selectedStatusId) ?? null;
  const selectedRows = selectedStatus ? rows.filter((row) => row.statusId === selectedStatus.id) : [];

  function closeDrilldown() {
    setSelectedStatusId(null);
    setSelectedRow(null);
    setTimeline([]);
  }

  function openDetails(row: CommandStatusRow) {
    setSelectedRow(row);
    setTimeline([]);
    startTransition(async () => {
      try { setTimeline(await loadTimeline(row.personId)); } catch { setTimeline([]); }
    });
  }

  return (
    <div className="command-dashboard-workflow">
      <StatusOverviewCards statuses={statuses} rows={rows} selectedStatusId={selectedStatusId} onSelect={(id) => { setSelectedStatusId(id); setSelectedRow(null); setTimeline([]); }} />
      {selectedStatus ? (
        <div className="command-dashboard-main">
          <CasualtyDetailsDrawer row={selectedRow} timeline={timeline} loading={isPending} onClose={() => setSelectedRow(null)} />
          <StatusDrilldownTable title={`${selectedStatus.label} (${formatNumber(selectedRows.length)})`} rows={selectedRows} selectedPersonId={selectedRow?.personId ?? null} onClose={closeDrilldown} onDetails={openDetails} />
        </div>
      ) : null}
    </div>
  );
}
