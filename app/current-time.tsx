"use client";

import { useEffect, useState } from "react";

export function CurrentTime() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const interval = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  if (!now) {
    return <time aria-label="השעה הנוכחית">--:--:--</time>;
  }

  return (
    <time dateTime={now.toISOString()}>
      {new Intl.DateTimeFormat("he-IL", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      }).format(now)}
    </time>
  );
}
