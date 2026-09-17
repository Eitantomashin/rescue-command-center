"use client";
import { createClient } from "@/lib/supabase/client";
export type EquipmentSignal = { kind: "change" | "connected" | "disconnected"; presentationOnly?: boolean };
type Listener = (signal: EquipmentSignal) => void;
type Entry = { listeners: Set<Listener>; stop: () => void };
const subscriptions = new Map<string, Entry>();

// One authenticated channel per event/user per browser context, ref-counted.
export function watchEquipment(incidentId: string, userId: string, listener: Listener) {
  const key = `${userId}:${incidentId}`;
  let entry = subscriptions.get(key);
  if (!entry) {
    const client = createClient();
    const listeners = new Set<Listener>();
    let stopped = false;
    let authInvalidated = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let presentationOnly = true;
    let channel: ReturnType<typeof client.channel> | null = null;
    const emit = (signal: EquipmentSignal) => listeners.forEach((callback) => callback(signal));
    const auth = client.auth.onAuthStateChange((_event, session) => {
      if (!session || session.user.id !== userId) {
        authInvalidated = true;
        if (retryTimer) clearTimeout(retryTimer);
        if (channel) void client.removeChannel(channel);
        channel = null; emit({ kind: "disconnected" });
      }
    });
    entry = { listeners, stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (retryTimer) clearTimeout(retryTimer);
      auth.data.subscription.unsubscribe();
      if (channel) void client.removeChannel(channel);
    } };
    subscriptions.set(key, entry);
    const retry = () => {
      if (stopped || authInvalidated) return;
      emit({ kind: "disconnected" });
      retryTimer = setTimeout(() => { retryTimer = null; void connect(); }, 25000);
    };
    const connect = async () => {
      try {
        const { data: { user }, error } = await client.auth.getUser();
        if (error) { retry(); return; }
        if (!user || user.id !== userId) { if (!stopped) emit({ kind: "disconnected" }); return; }
        const permission = await client.rpc("can_read_equipment_incident", { p_incident_id: incidentId });
        if (stopped || authInvalidated) return;
        if (permission.error) { retry(); return; }
        if (permission.data !== true) { emit({ kind: "disconnected" }); return; }
        channel = client.channel(`equipment:${key}`).on("postgres_changes", {
          event: "INSERT", schema: "public", table: "equipment_incident_signals", filter: `incident_id=eq.${incidentId}`
        }, (payload) => {
          if (stopped || payload.new.incident_id !== incidentId) return;
          presentationOnly = presentationOnly && payload.new.event_type === "presentation";
          if (timer) return;
          timer = setTimeout(() => { timer = null; emit({ kind: "change", presentationOnly }); presentationOnly = true; }, 150);
        }).subscribe((status) => {
          if (stopped) return;
          if (status === "SUBSCRIBED") emit({ kind: "connected" });
          else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) emit({ kind: "disconnected" });
        });
      } catch { retry(); }
    };
    void connect();
  }
  entry.listeners.add(listener);
  const current = entry;
  return () => {
    current.listeners.delete(listener);
    if (!current.listeners.size) { current.stop(); if (subscriptions.get(key) === current) subscriptions.delete(key); }
  };
}
