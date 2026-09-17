"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const REALTIME_TABLES = [
  "operational_reports",
  "event_logs",
  "event_personnel_status",
  "site_map_objects",
  "team_site_assignments",
  "sites",
  "unit_residents",
  "units"
] as const;

export function RealtimeRefresh({ incidentId }: { incidentId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const equipmentPage = useRef(false);
  equipmentPage.current = pathname === `/incidents/${incidentId}/equipment`;
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(`incident:${incidentId}:live-refresh`);

    function scheduleRefresh() {
      // Equipment has scoped state refreshes. Existing event_logs broadcasts must
      // not refresh its RSC tree while an assignment/edit form is open.
      if (equipmentPage.current) return;
      if (refreshTimer.current) {
        clearTimeout(refreshTimer.current);
      }

      refreshTimer.current = setTimeout(() => {
        if (equipmentPage.current) return;
        router.refresh();
        setVisible(true);

        if (noticeTimer.current) {
          clearTimeout(noticeTimer.current);
        }

        noticeTimer.current = setTimeout(() => setVisible(false), 2200);
      }, 600);
    }

    for (const table of REALTIME_TABLES) {
      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table,
          filter: `incident_id=eq.${incidentId}`
        },
        (payload) => {
          // Equipment has its own scoped state/alert updates in the persistent
          // layout. Its audit events must not remount unrelated event forms.
          if (table === "event_logs" && "log_type" in payload.new
            && typeof payload.new.log_type === "string" && payload.new.log_type.startsWith("equipment_")) return;
          scheduleRefresh();
        }
      );
    }

    channel.subscribe();

    return () => {
      if (refreshTimer.current) {
        clearTimeout(refreshTimer.current);
      }
      if (noticeTimer.current) {
        clearTimeout(noticeTimer.current);
      }
      supabase.removeChannel(channel);
    };
  }, [incidentId, router]);

  return (
    <div className={`realtime-refresh-toast ${visible ? "visible" : ""}`} aria-live="polite" aria-atomic="true">
      נתונים עודכנו בזמן אמת
    </div>
  );
}
