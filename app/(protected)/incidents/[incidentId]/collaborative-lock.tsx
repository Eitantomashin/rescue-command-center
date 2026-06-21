"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { PresenceLock } from "./incident-presence";
import { useIncidentPresence } from "./incident-presence";

const text = {
  editedBy: "\u05e0\u05e2\u05e8\u05da \u05e2\"\u05d9",
  lockedWarning: "\u05d4\u05e8\u05e9\u05d5\u05de\u05d4 \u05e0\u05e2\u05e8\u05db\u05ea \u05db\u05e8\u05d2\u05e2 \u05e2\"\u05d9 \u05de\u05e9\u05ea\u05de\u05e9 \u05d0\u05d7\u05e8. \u05d4\u05d8\u05d5\u05e4\u05e1 \u05d6\u05de\u05d9\u05df \u05dc\u05e6\u05e4\u05d9\u05d9\u05d4 \u05d1\u05dc\u05d1\u05d3.",
  activeNow: "\u05e4\u05e2\u05d9\u05dc \u05db\u05e2\u05ea",
  secondsAgo: "\u05dc\u05e4\u05e0\u05d9",
  seconds: "\u05e9\u05e0\u05d9\u05d5\u05ea",
  minutes: "\u05d3\u05e7\u05d5\u05ea"
};

function lockAge(value: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));

  if (seconds < 10) {
    return text.activeNow;
  }

  if (seconds < 60) {
    return `${text.secondsAgo} ${seconds} ${text.seconds}`;
  }

  return `${text.secondsAgo} ${Math.floor(seconds / 60)} ${text.minutes}`;
}

export function useCollaborativeLock(objectType: PresenceLock["objectType"], objectId: string | null, enabled = true) {
  const { locks, acquireLock, releaseLock } = useIncidentPresence();
  const [tick, setTick] = useState(0);
  const lock = useMemo(
    () => locks.find((item) => item.objectType === objectType && item.objectId === objectId) ?? null,
    [locks, objectId, objectType]
  );

  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 15000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!objectId || !enabled) {
      return;
    }

    if (lock) {
      return;
    }

    acquireLock(objectType, objectId);

    return () => {
      releaseLock(objectType, objectId);
    };
  }, [acquireLock, enabled, lock, objectId, objectType, releaseLock]);

  void tick;

  return lock;
}

export function CollaborativeLockBanner({ lock, label }: { lock: PresenceLock | null; label?: string }) {
  if (!lock) {
    return null;
  }

  return (
    <div className="collaboration-lock-banner" role="status">
      <strong>{label ?? text.lockedWarning}</strong>
      <span>
        {text.editedBy} {lock.displayName}{" \u00b7 "}{lockAge(lock.lockedAt)}
      </span>
    </div>
  );
}

export function CollaborativeLockSection({
  objectType,
  objectId,
  children,
  label
}: {
  objectType: PresenceLock["objectType"];
  objectId: string;
  children: ReactNode;
  label?: string;
}) {
  const [active, setActive] = useState(false);
  const lock = useCollaborativeLock(objectType, objectId, active);

  return (
    <div
      className={lock ? "collaboration-locked" : ""}
      onFocusCapture={() => setActive(true)}
      onBlurCapture={(event) => {
        const nextTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null;
        if (!nextTarget || !event.currentTarget.contains(nextTarget)) {
          setActive(false);
        }
      }}
    >
      <CollaborativeLockBanner lock={lock} label={label} />
      <fieldset disabled={Boolean(lock)} className="collaboration-lock-fieldset">
        {children}
      </fieldset>
    </div>
  );
}
