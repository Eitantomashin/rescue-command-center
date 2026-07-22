"use client";

import { useEffect, useState } from "react";

type ResidentLinkSuccessNoticeProps = {
  cleanHref: string;
  residentId: string;
  message: string;
};

export function ResidentLinkSuccessNotice({
  cleanHref,
  residentId,
  message
}: ResidentLinkSuccessNoticeProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const target = document.querySelector<HTMLElement>(`[data-resident-id="${residentId}"]`);

    if (target) {
      target.classList.add("resident-link-success-flash");
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    window.history.replaceState(null, "", cleanHref);

    const hideTimer = window.setTimeout(() => setVisible(false), 5200);
    const cleanupTimer = window.setTimeout(() => {
      target?.classList.remove("resident-link-success-flash");
    }, 3000);

    return () => {
      window.clearTimeout(hideTimer);
      window.clearTimeout(cleanupTimer);
      target?.classList.remove("resident-link-success-flash");
    };
  }, [cleanHref, residentId]);

  if (!visible) {
    return null;
  }

  return (
    <div className="resident-link-success-notice" role="status" aria-live="polite">
      {message}
    </div>
  );
}
