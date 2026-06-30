"use client";

import { useEffect, useState } from "react";

const BODY_CLASS = "war-room-presentation-mode";

export function WarRoomPresentationToggle() {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    document.body.classList.toggle(BODY_CLASS, expanded);

    return () => {
      document.body.classList.remove(BODY_CLASS);
    };
  }, [expanded]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setExpanded((current) => !current);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <button
      type="button"
      className="war-room-presentation-toggle"
      onClick={() => setExpanded((current) => !current)}
      aria-pressed={expanded}
    >
      <span aria-hidden="true">{expanded ? "\u2922" : "\u26f6"}</span>
      {expanded ? "\u05e6\u05de\u05e6\u05dd \u05de\u05e1\u05da" : "\u05d4\u05e8\u05d7\u05d1 \u05de\u05e1\u05da"}
    </button>
  );
}
