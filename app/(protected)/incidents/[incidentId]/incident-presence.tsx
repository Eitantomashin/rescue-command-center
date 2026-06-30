"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

type PresenceSite = {
  site_id: string;
  site_number: number;
  name: string | null;
  city: string | null;
  street: string | null;
  house_number: string | null;
};

type PresenceUser = {
  userId: string;
  displayName: string;
  email: string | null;
  initials: string;
  incidentId: string;
  pathname: string;
  screenKey: string;
  siteId: string | null;
  siteName: string | null;
  locationLabel: string;
  onlineAt: string;
  lastSeenAt: string;
  locks?: PresenceLock[];
};

export type PresenceLock = {
  objectType: "operational_number" | "resident" | "site_map_object" | "event_personnel";
  objectId: string;
  userId: string;
  displayName: string;
  lockedAt: string;
};

type PresenceContextValue = {
  users: PresenceUser[];
  currentScreenUsers: PresenceUser[];
  currentUserId: string;
  locks: PresenceLock[];
  acquireLock: (objectType: PresenceLock["objectType"], objectId: string) => void;
  releaseLock: (objectType: PresenceLock["objectType"], objectId: string) => void;
  currentLocation: {
    screenKey: string;
    siteId: string | null;
    label: string;
  };
};

const HEARTBEAT_MS = 20000;
const STALE_PRESENCE_MS = 90000;

const text = {
  site: "\u05d0\u05ea\u05e8",
  user: "\u05de\u05e9\u05ea\u05de\u05e9",
  watchingDashboard: "\u05e6\u05d5\u05e4\u05d4 \u05d1\u05d3\u05e9\u05d1\u05d5\u05e8\u05d3",
  personnel: "\u05db\"\u05d0",
  operationalLog: "\u05dc\u05d5\u05d2 \u05de\u05d1\u05e6\u05e2\u05d9",
  allSites: "\u05db\u05dc \u05d4\u05d0\u05ea\u05e8\u05d9\u05dd",
  siteSetup: "\u05d4\u05e7\u05de\u05ea \u05d0\u05ea\u05e8",
  operationalNumbers: "\u05de\u05e1\u05e4\u05e8\u05d9\u05dd \u05de\u05d1\u05e6\u05e2\u05d9\u05d9\u05dd",
  grid: "\u05d2\u05e8\u05d9\u05d3",
  inIncident: "\u05d1\u05d0\u05d9\u05e8\u05d5\u05e2",
  connectedUsers: "\u05de\u05e9\u05ea\u05de\u05e9\u05d9\u05dd \u05de\u05d7\u05d5\u05d1\u05e8\u05d9\u05dd",
  noConnectedUsers: "\u05d0\u05d9\u05df \u05de\u05e9\u05ea\u05de\u05e9\u05d9\u05dd \u05de\u05d7\u05d5\u05d1\u05e8\u05d9\u05dd \u05db\u05e8\u05d2\u05e2.",
  activeNow: "\u05e4\u05e2\u05d9\u05dc \u05db\u05e2\u05ea",
  minuteAgo: "\u05dc\u05e4\u05e0\u05d9 \u05d3\u05e7\u05d4",
  minutesAgo: "\u05dc\u05e4\u05e0\u05d9",
  hoursAgo: "\u05dc\u05e4\u05e0\u05d9",
  minutes: "\u05d3\u05e7\u05d5\u05ea",
  hours: "\u05e9\u05e2\u05d5\u05ea",
  activeOnScreen: "\u05de\u05e9\u05ea\u05de\u05e9\u05d9\u05dd \u05e4\u05e2\u05d9\u05dc\u05d9\u05dd \u05d1\u05de\u05e1\u05da \u05d6\u05d4",
  noOtherUsersOnScreen: "\u05d0\u05d9\u05df \u05de\u05e9\u05ea\u05de\u05e9\u05d9\u05dd \u05e0\u05d5\u05e1\u05e4\u05d9\u05dd \u05d1\u05de\u05e1\u05da \u05d6\u05d4."
};

const PresenceContext = createContext<PresenceContextValue | null>(null);

function siteLabel(site: PresenceSite) {
  if (site.name?.trim()) {
    return site.name.trim();
  }

  const address = [site.street, site.house_number].filter(Boolean).join(" ").trim();
  return address || `${text.site} ${site.site_number}`;
}

function initialsFor(name: string, email: string | null) {
  const source = name.trim() || email?.split("@")[0] || "?";
  const words = source.split(/\s+/).filter(Boolean);

  if (words.length >= 2) {
    return `${words[0][0] ?? ""}${words[1][0] ?? ""}`.toUpperCase();
  }

  return source.slice(0, 2).toUpperCase();
}

function displayNameFromUser(user: {
  email: string | null;
  user_metadata?: Record<string, unknown>;
}) {
  const metadata = user.user_metadata ?? {};
  const candidate =
    typeof metadata.display_name === "string"
      ? metadata.display_name
      : typeof metadata.full_name === "string"
        ? metadata.full_name
        : typeof metadata.name === "string"
          ? metadata.name
          : "";

  return candidate.trim() || user.email?.split("@")[0] || text.user;
}

function locationForPath(incidentId: string, pathname: string, sites: PresenceSite[]) {
  const base = `/incidents/${incidentId}`;
  const currentSite = sites.find((site) => pathname.includes(`/sites/${site.site_id}`)) ?? null;
  const currentSiteLabel = currentSite ? siteLabel(currentSite) : null;

  if (pathname === base) {
    return { screenKey: "dashboard", siteId: null, siteName: null, label: text.watchingDashboard };
  }

  if (pathname === `${base}/personnel`) {
    return { screenKey: "personnel", siteId: null, siteName: null, label: text.personnel };
  }

  if (pathname === `${base}/operational-log`) {
    return { screenKey: "incident-log", siteId: null, siteName: null, label: text.operationalLog };
  }

  if (pathname === `${base}/sites`) {
    return { screenKey: "sites", siteId: null, siteName: null, label: text.allSites };
  }

  if (pathname === `${base}/sites/new`) {
    return { screenKey: "site-new", siteId: null, siteName: null, label: text.siteSetup };
  }

  if (currentSite && currentSiteLabel) {
    const siteBase = `${base}/sites/${currentSite.site_id}`;

    if (pathname === `${siteBase}/operational-numbers`) {
      return {
        screenKey: "operational-numbers",
        siteId: currentSite.site_id,
        siteName: currentSiteLabel,
        label: `${text.operationalNumbers} - ${currentSiteLabel}`
      };
    }

    if (pathname === `${siteBase}/grid-map`) {
      return {
        screenKey: "grid",
        siteId: currentSite.site_id,
        siteName: currentSiteLabel,
        label: `${text.grid} - ${currentSiteLabel}`
      };
    }

    if (pathname === `${siteBase}/operational-log`) {
      return {
        screenKey: "site-log",
        siteId: currentSite.site_id,
        siteName: currentSiteLabel,
        label: `${text.operationalLog} - ${currentSiteLabel}`
      };
    }

    return {
      screenKey: "site",
      siteId: currentSite.site_id,
      siteName: currentSiteLabel,
      label: `${text.site} - ${currentSiteLabel}`
    };
  }

  return { screenKey: "incident", siteId: null, siteName: null, label: text.inIncident };
}

function compactPresenceState(rawState: Record<string, PresenceUser[]>) {
  const byUser = new Map<string, PresenceUser>();

  Object.values(rawState)
    .flat()
    .forEach((presence) => {
      const previous = byUser.get(presence.userId);
      if (!previous || new Date(presence.lastSeenAt).getTime() > new Date(previous.lastSeenAt).getTime()) {
        byUser.set(presence.userId, presence);
      }
    });

  return Array.from(byUser.values()).sort((a, b) =>
    a.displayName.localeCompare(b.displayName, "he")
  );
}

function activePresenceUsers(users: PresenceUser[], now: number) {
  return users.filter((presence) => now - new Date(presence.lastSeenAt).getTime() <= STALE_PRESENCE_MS);
}

function activePresenceLocks(users: PresenceUser[], currentUserId: string, now: number) {
  return users
    .filter((presence) => presence.userId !== currentUserId)
    .flatMap((presence) => presence.locks ?? [])
    .filter((lock) => now - new Date(lock.lockedAt).getTime() <= STALE_PRESENCE_MS);
}

export function IncidentPresenceProvider({
  incidentId,
  user,
  sites,
  children
}: {
  incidentId: string;
  user: {
    id: string;
    email: string | null;
    user_metadata?: Record<string, unknown>;
  };
  sites: PresenceSite[];
  children: ReactNode;
}) {
  const pathname = usePathname();
  const channelRef = useRef<RealtimeChannel | null>(null);
  const locksRef = useRef<PresenceLock[]>([]);
  const [users, setUsers] = useState<PresenceUser[]>([]);
  const [, setLocalLocksVersion] = useState(0);
  const [now, setNow] = useState(Date.now());
  const displayName = displayNameFromUser(user);
  const currentLocation = useMemo(() => locationForPath(incidentId, pathname, sites), [incidentId, pathname, sites]);

  const currentUser = useMemo(
    () => ({
      userId: user.id,
      displayName,
      email: user.email,
      initials: initialsFor(displayName, user.email),
      incidentId,
      onlineAt: new Date().toISOString()
    }),
    [displayName, incidentId, user.email, user.id]
  );

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(`incident:${incidentId}:presence`, {
      config: {
        presence: {
          key: user.id
        }
      }
    });
    channelRef.current = channel;

    function trackCurrentPresence() {
      return channel.track({
        ...currentUser,
        pathname,
        screenKey: currentLocation.screenKey,
        siteId: currentLocation.siteId,
        siteName: currentLocation.siteName,
        locationLabel: currentLocation.label,
        locks: locksRef.current,
        lastSeenAt: new Date().toISOString()
      });
    }

    function cleanupPresence() {
      void channel.untrack();
    }

    channel.on("presence", { event: "sync" }, () => {
      setUsers(compactPresenceState(channel.presenceState() as Record<string, PresenceUser[]>));
    });

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        void trackCurrentPresence();
      }
    });

    const heartbeat = setInterval(() => {
      void trackCurrentPresence();
    }, HEARTBEAT_MS);

    const { data: authListener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        cleanupPresence();
      }
    });

    window.addEventListener("pagehide", cleanupPresence);
    window.addEventListener("beforeunload", cleanupPresence);

    return () => {
      clearInterval(heartbeat);
      window.removeEventListener("pagehide", cleanupPresence);
      window.removeEventListener("beforeunload", cleanupPresence);
      authListener.subscription.unsubscribe();
      cleanupPresence();
      void supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [currentLocation.label, currentLocation.screenKey, currentLocation.siteId, currentLocation.siteName, currentUser, incidentId, pathname, user.id]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const channel = channelRef.current;
    if (!channel) {
      return;
    }

    void channel.track({
      ...currentUser,
      pathname,
      screenKey: currentLocation.screenKey,
      siteId: currentLocation.siteId,
      siteName: currentLocation.siteName,
      locationLabel: currentLocation.label,
      locks: locksRef.current,
      lastSeenAt: new Date().toISOString()
    });
  }, [currentLocation, currentUser, pathname]);

  const activeUsers = activePresenceUsers(users, now);
  const locks = activePresenceLocks(activeUsers, user.id, now);
  const currentScreenUsers = activeUsers.filter(
    (presence) => presence.screenKey === currentLocation.screenKey && presence.siteId === currentLocation.siteId
  );

  const retrackWithLocks = useCallback((nextLocks: PresenceLock[]) => {
    locksRef.current = nextLocks;
    setLocalLocksVersion((value) => value + 1);

    const channel = channelRef.current;
    if (!channel) {
      return;
    }

    void channel.track({
      ...currentUser,
      pathname,
      screenKey: currentLocation.screenKey,
      siteId: currentLocation.siteId,
      siteName: currentLocation.siteName,
      locationLabel: currentLocation.label,
      locks: locksRef.current,
      lastSeenAt: new Date().toISOString()
    });
  }, [currentLocation.label, currentLocation.screenKey, currentLocation.siteId, currentLocation.siteName, currentUser, pathname]);

  const acquireLock = useCallback((objectType: PresenceLock["objectType"], objectId: string) => {
    const key = `${objectType}:${objectId}`;
    const remaining = locksRef.current.filter((lock) => `${lock.objectType}:${lock.objectId}` !== key);
    retrackWithLocks([
      ...remaining,
      {
        objectType,
        objectId,
        userId: user.id,
        displayName,
        lockedAt: new Date().toISOString()
      }
    ]);
  }, [displayName, retrackWithLocks, user.id]);

  const releaseLock = useCallback((objectType: PresenceLock["objectType"], objectId: string) => {
    const key = `${objectType}:${objectId}`;
    retrackWithLocks(locksRef.current.filter((lock) => `${lock.objectType}:${lock.objectId}` !== key));
  }, [retrackWithLocks]);

  return (
    <PresenceContext.Provider value={{ users: activeUsers, currentScreenUsers, currentUserId: user.id, locks, acquireLock, releaseLock, currentLocation }}>
      {children}
    </PresenceContext.Provider>
  );
}

export function useIncidentPresence() {
  const context = useContext(PresenceContext);

  if (!context) {
    return {
      users: [],
      currentScreenUsers: [],
      currentUserId: "",
      locks: [],
      acquireLock: () => undefined,
      releaseLock: () => undefined,
      currentLocation: { screenKey: "unknown", siteId: null, label: "" }
    };
  }

  return context;
}

function relativeActivity(value: string) {
  const diff = Math.max(0, Date.now() - new Date(value).getTime());
  const seconds = Math.floor(diff / 1000);

  if (seconds < 45) {
    return text.activeNow;
  }

  if (seconds < 120) {
    return text.minuteAgo;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${text.minutesAgo} ${minutes} ${text.minutes}`;
  }

  const hours = Math.floor(minutes / 60);
  return `${text.hoursAgo} ${hours} ${text.hours}`;
}

export function ConnectedUsersWidget() {
  const { users } = useIncidentPresence();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 15000);
    return () => clearInterval(timer);
  }, []);

  void tick;

  return (
    <aside className="presence-widget" aria-label={text.connectedUsers}>
      <div className="presence-widget-header">
        <span>{text.connectedUsers}</span>
        <strong>{users.length}</strong>
      </div>
      {users.length === 0 ? (
        <p className="muted">{text.noConnectedUsers}</p>
      ) : (
        <ul className="presence-user-list">
          {users.map((presence) => (
            <li key={presence.userId}>
              <span className="presence-avatar" aria-hidden="true">{presence.initials}</span>
              <div>
                <strong><span className="presence-dot online" aria-hidden="true" />{presence.displayName}</strong>
                <span>{presence.locationLabel}</span>
                <small>{relativeActivity(presence.lastSeenAt)}</small>
              </div>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

export function ScreenPresenceIndicator() {
  const { currentScreenUsers } = useIncidentPresence();
  const [open, setOpen] = useState(false);

  return (
    <div className="screen-presence">
      <button className="screen-presence-button" type="button" onClick={() => setOpen((value) => !value)}>
        {text.activeOnScreen}: {currentScreenUsers.length}
      </button>
      {open ? (
        <div className="screen-presence-popover">
          {currentScreenUsers.length === 0 ? (
            <p className="muted">{text.noOtherUsersOnScreen}</p>
          ) : (
            <ul className="presence-user-list compact">
              {currentScreenUsers.map((presence) => (
                <li key={presence.userId}>
                  <span className="presence-avatar" aria-hidden="true">{presence.initials}</span>
                  <div>
                    <strong><span className="presence-dot online" aria-hidden="true" />{presence.displayName}</strong>
                    <small>{relativeActivity(presence.lastSeenAt)}</small>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
