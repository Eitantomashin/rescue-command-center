"use client";

import { useEffect, useRef, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import { useFormStatus } from "react-dom";

type OperationalLoadingButtonProps = {
  label?: string;
  loadingLabel?: string;
  className?: string;
  disabled?: boolean;
  type?: "submit" | "button" | "reset";
  name?: string;
  value?: string;
  showSpinner?: boolean;
  isLoading?: boolean;
  minLoadingMs?: number;
  children?: ReactNode;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void | Promise<void>;
};

export function OperationalLoadingButton({
  label,
  loadingLabel = "\u05d8\u05d5\u05e2\u05df...",
  className = "button",
  disabled = false,
  type = "submit",
  name,
  value,
  showSpinner = true,
  isLoading = false,
  minLoadingMs = 300,
  children,
  onClick
}: OperationalLoadingButtonProps) {
  const { pending } = useFormStatus();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const loadingStartedAt = useRef<number | null>(null);
  const [localPending, setLocalPending] = useState(false);
  const [visiblePending, setVisiblePending] = useState(false);
  const [lockedWidth, setLockedWidth] = useState<number | null>(null);
  const actualPending = pending || isLoading || localPending;
  const idleLabel = label ?? children;
  const isDisabled = disabled || actualPending;

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    if (actualPending) {
      loadingStartedAt.current = Date.now();
      setLockedWidth(buttonRef.current?.offsetWidth ?? null);
      setVisiblePending(true);
      return undefined;
    }

    const elapsed = loadingStartedAt.current ? Date.now() - loadingStartedAt.current : minLoadingMs;
    const remaining = Math.max(0, minLoadingMs - elapsed);
    timeoutId = setTimeout(() => {
      loadingStartedAt.current = null;
      setVisiblePending(false);
      setLockedWidth(null);
    }, remaining);

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [actualPending, minLoadingMs]);

  async function handleClick(event: React.MouseEvent<HTMLButtonElement>) {
    if (!onClick || isDisabled) return;

    const result = onClick(event);
    if (result && typeof (result as Promise<unknown>).then === "function") {
      setLocalPending(true);
      try {
        await result;
      } finally {
        setLocalPending(false);
      }
    }
  }

  return (
    <button
      ref={buttonRef}
      className={`operational-loading-button ${className}`}
      type={type}
      name={name}
      value={value}
      disabled={isDisabled}
      aria-busy={visiblePending}
      onClick={handleClick}
      style={lockedWidth ? { minWidth: `${lockedWidth}px` } : undefined}
    >
      {visiblePending && showSpinner ? <span className="operational-loading-spinner" aria-hidden="true" /> : null}
      <span>{visiblePending ? loadingLabel : idleLabel}</span>
    </button>
  );
}
