"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useFormState } from "react-dom";
import { OperationalLoadingButton } from "@/app/(protected)/operational-loading-button";
import { createVehicleRosterAction, type VehicleRosterActionState } from "../actions";
import {
  MOVEMENT_TYPE_LABELS,
  ROSTER_STATUS_LABELS,
  formatDateTimeLocal,
  numberValue,
  rosterStatusClass,
  type RosterStatus,
  type VehicleRosterListRow
} from "./roster-types";

const INITIAL_STATE: VehicleRosterActionState = { error: null, success: null, code: null };
const STATUS_FILTERS: Array<"all" | RosterStatus> = ["all", "draft", "ready", "en_route", "arrived", "cancelled"];

function statusFilterLabel(status: "all" | RosterStatus) {
  return status === "all" ? "הכל" : ROSTER_STATUS_LABELS[status];
}

function rosterText(row: VehicleRosterListRow) {
  return [
    row.display_number,
    row.vehicle_license_plate,
    row.vehicle_description,
    row.driver_names,
    row.movement_commander_names,
    row.origin_text,
    row.destination_text,
    ROSTER_STATUS_LABELS[row.status],
    MOVEMENT_TYPE_LABELS[row.movement_type]
  ].join(" ").toLowerCase();
}

export function VehicleRosterListClient({
  incidentId,
  rosters,
  canEditPersonnel
}: {
  incidentId: string;
  rosters: VehicleRosterListRow[];
  canEditPersonnel: boolean;
}) {
  const [createState, createAction] = useFormState(createVehicleRosterAction, INITIAL_STATE);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | RosterStatus>("all");

  useEffect(() => {
    const data = createState.data;
    if (data && typeof data === "object" && "roster_id" in data) {
      const rosterId = String((data as Record<string, unknown>).roster_id);
      window.location.assign(`/incidents/${incidentId}/personnel/rosters/${rosterId}`);
    }
  }, [createState.data, incidentId]);

  const summary = useMemo(() => {
    const active = rosters.filter((row) => row.status !== "cancelled");
    return {
      total: active.length,
      ready: active.filter((row) => row.status === "ready").length,
      enRoute: active.filter((row) => row.status === "en_route").length,
      arrived: active.filter((row) => row.status === "arrived").length,
      peopleInMovement: active
        .filter((row) => row.status === "en_route")
        .reduce((sum, row) => sum + numberValue(row.participant_count), 0)
    };
  }, [rosters]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return rosters.filter((row) => {
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      if (!normalized) return true;
      return rosterText(row).includes(normalized);
    });
  }, [query, rosters, statusFilter]);

  return (
    <div className="vehicle-roster-page" dir="rtl">
      <nav className="personnel-module-tabs" aria-label="ניווט כוח אדם">
        <Link href={`/incidents/${incidentId}/personnel`}>מצבת כוח אדם</Link>
        <Link className="active" href={`/incidents/${incidentId}/personnel/rosters`}>שבצ"קים ותנועת רכבים</Link>
      </nav>

      <section className="vehicle-roster-hero">
        <div>
          <p className="eyebrow">כוח אדם באירוע</p>
          <h1>שבצ"קים ותנועת רכבים</h1>
          <p>ניהול תנועת רכבים, נהגים, מפקדי נסיעה ונוסעים באירוע.</p>
        </div>
        {canEditPersonnel ? (
          <form action={createAction} className="vehicle-roster-create-form">
            <input type="hidden" name="incidentId" value={incidentId} />
            <input type="hidden" name="movementType" value="outbound_to_incident" />
            <OperationalLoadingButton className="button primary" loadingLabel="יוצר...">צור שבצ"ק חדש</OperationalLoadingButton>
            {createState.error ? <p className="form-error">{createState.error}</p> : null}
            {createState.success ? <p className="success-message">{createState.success}</p> : null}
          </form>
        ) : null}
      </section>

      <section className="vehicle-roster-summary-grid" aria-label="סיכום שבצקים">
        <SummaryCard label={"סה\"כ שבצ\"קים"} value={summary.total} />
        <SummaryCard label="מוכן ליציאה" value={summary.ready} tone="blue" />
        <SummaryCard label="בדרך" value={summary.enRoute} tone="orange" />
        <SummaryCard label="הגיעו ליעד" value={summary.arrived} tone="green" />
        <SummaryCard label="אנשים כעת בתנועה" value={summary.peopleInMovement} tone="purple" />
      </section>

      <section className="vehicle-roster-filters" aria-label="סינון שבצקים">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="חיפוש לפי מספר, רכב, נהג, יעד או מוצא"
          aria-label="חיפוש שבצקים"
        />
        <div className="segmented-control" role="group" aria-label="סטטוס שבצק">
          {STATUS_FILTERS.map((status) => (
            <button
              key={status}
              type="button"
              className={statusFilter === status ? "active" : ""}
              onClick={() => setStatusFilter(status)}
            >
              {statusFilterLabel(status)}
            </button>
          ))}
        </div>
      </section>

      {filtered.length === 0 ? (
        <section className="empty-state-card">
          <h2>אין שבצ"קים להצגה</h2>
          <p>{rosters.length === 0 ? "עדיין לא נפתחו שבצ\"קים באירוע." : "לא נמצאו שבצ\"קים שתואמים לסינון."}</p>
        </section>
      ) : (
        <section className="vehicle-roster-card-grid" aria-label="רשימת שבצקים">
          {filtered.map((row) => (
            <article key={row.id} className={`vehicle-roster-card ${rosterStatusClass(row.status)}`}>
              <div className="vehicle-roster-card-header">
                <div>
                  <p className="eyebrow">{MOVEMENT_TYPE_LABELS[row.movement_type]}</p>
                  <h2>שבצ"ק {row.display_number}</h2>
                </div>
                <span className={`vehicle-roster-status ${rosterStatusClass(row.status)}`}>{ROSTER_STATUS_LABELS[row.status]}</span>
              </div>
              <dl className="vehicle-roster-meta-grid">
                <div><dt>רכב</dt><dd>{row.vehicle_license_plate || "-"}</dd></div>
                <div><dt>זיהוי נוסף</dt><dd>{row.vehicle_description || "-"}</dd></div>
                <div><dt>מוצא</dt><dd>{row.origin_text || "-"}</dd></div>
                <div><dt>יעד</dt><dd>{row.destination_text || "-"}</dd></div>
                <div><dt>נהג</dt><dd>{row.driver_names || "-"}</dd></div>
                <div><dt>מפקד נסיעה</dt><dd>{row.movement_commander_names || "-"}</dd></div>
                <div><dt>משתתפים</dt><dd>{numberValue(row.participant_count)}</dd></div>
                <div><dt>מתוכנן</dt><dd>{formatDateTimeLocal(row.planned_departure_at)}</dd></div>
                <div><dt>יציאה בפועל</dt><dd>{formatDateTimeLocal(row.actual_departure_at)}</dd></div>
                <div><dt>הגעה בפועל</dt><dd>{formatDateTimeLocal(row.actual_arrival_at)}</dd></div>
              </dl>
              {row.source_roster_id ? <p className="vehicle-roster-clone-note">נסיעת המשך/חזור של שבצ"ק מקור.</p> : null}
              <Link className="button secondary" href={`/incidents/${incidentId}/personnel/rosters/${row.id}`}>פתח שבצ"ק</Link>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}

function SummaryCard({ label, value, tone = "neutral" }: { label: string; value: number; tone?: string }) {
  return (
    <article className={`vehicle-roster-summary-card tone-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}
