"use client";

import { useEffect, useState } from "react";

const T = {
  activityClock: "\u05e9\u05e2\u05d5\u05df \u05e4\u05e2\u05d9\u05dc\u05d5\u05ea",
  days: "\u05d9\u05de\u05d9\u05dd",
  hours: "\u05e9\u05e2\u05d5\u05ea",
  minutes: "\u05d3\u05e7\u05d5\u05ea",
  start: "\u05d4\u05ea\u05d7\u05dc\u05d4",
  now: "\u05db\u05e2\u05ea",
  missingStart: "\u05dc\u05d0 \u05d4\u05d5\u05d2\u05d3\u05e8\u05d4 \u05e9\u05e2\u05ea \u05d4\u05ea\u05d7\u05dc\u05d4",
  lastRefresh: "\u05e2\u05d5\u05d3\u05db\u05df \u05dc\u05d0\u05d7\u05e8\u05d5\u05e0\u05d4",
  connected: "\u05de\u05d7\u05d5\u05d1\u05e8",
  dataStatus: "\u05e0\u05ea\u05d5\u05e0\u05d9\u05dd \u05de\u05e2\u05d5\u05d3\u05db\u05e0\u05d9\u05dd"
};

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function dateParts(value: Date) {
  const date = new Intl.DateTimeFormat("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" }).format(value);
  const time = new Intl.DateTimeFormat("he-IL", { hour: "2-digit", minute: "2-digit" }).format(value);
  return { date, time };
}

function elapsedParts(start: Date | null, now: Date) {
  if (!start || Number.isNaN(start.getTime())) {
    return null;
  }

  const diffMinutes = Math.max(0, Math.floor((now.getTime() - start.getTime()) / 60000));
  const days = Math.floor(diffMinutes / (60 * 24));
  const hours = Math.floor((diffMinutes % (60 * 24)) / 60);
  const minutes = diffMinutes % 60;
  return { days, hours, minutes };
}

export function WarRoomLiveClock({ openedAt }: { openedAt: string | null; lastRefreshAt: string }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 60000);
    return () => window.clearInterval(interval);
  }, []);

  const start = openedAt ? new Date(openedAt) : null;
  const elapsed = elapsedParts(start, now);
  const startDisplay = start && !Number.isNaN(start.getTime()) ? dateParts(start) : null;
  const nowDisplay = dateParts(now);

  return (
    <section className="war-room-clock-panel" aria-label={T.activityClock}>
      <div className="war-room-panel-title">
        <span>{T.activityClock}</span>
        <span className="war-room-title-icon" aria-hidden="true">{"\u25F7"}</span>
      </div>

      {elapsed ? (
        <div className="war-room-clock-grid" dir="ltr">
          <div><strong>{pad(elapsed.days)}</strong><span>{T.days}</span></div>
          <i>:</i>
          <div><strong>{pad(elapsed.hours)}</strong><span>{T.hours}</span></div>
          <i>:</i>
          <div><strong>{pad(elapsed.minutes)}</strong><span>{T.minutes}</span></div>
        </div>
      ) : (
        <div className="war-room-clock-missing">{T.missingStart}</div>
      )}

      <div className="war-room-clock-meta">
        <div><span>{T.start}</span><strong>{startDisplay ? startDisplay.date + " | " + startDisplay.time : "-"}</strong></div>
        <div><span>{T.now}</span><strong>{nowDisplay.date} | {nowDisplay.time}</strong></div>
      </div>
    </section>
  );
}

export function WarRoomFooterStatus({ lastRefreshAt }: { lastRefreshAt: string }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 60000);
    return () => window.clearInterval(interval);
  }, []);

  const nowDisplay = dateParts(now);
  const refreshDisplay = dateParts(new Date(lastRefreshAt));

  return (
    <div className="war-room-footer-status">
      <span>{nowDisplay.date} | {nowDisplay.time}</span>
      <span>{T.lastRefresh}: {refreshDisplay.time}</span>
      <span className="war-room-status-good">{"\u25CF"} {T.connected}</span>
      <span>{T.dataStatus}</span>
    </div>
  );
}
