"use client";

import { useFormStatus } from "react-dom";

type OperationalLoadingButtonProps = {
  label: string;
  loadingLabel?: string;
  className?: string;
  disabled?: boolean;
  type?: "submit" | "button" | "reset";
  name?: string;
  value?: string;
  showSpinner?: boolean;
};

export function OperationalLoadingButton({
  label,
  loadingLabel = "\u05d8\u05d5\u05e2\u05df...",
  className = "button",
  disabled = false,
  type = "submit",
  name,
  value,
  showSpinner = true
}: OperationalLoadingButtonProps) {
  const { pending } = useFormStatus();
  const isDisabled = disabled || pending;

  return (
    <button
      className={`operational-loading-button ${className}`}
      type={type}
      name={name}
      value={value}
      disabled={isDisabled}
      aria-busy={pending}
    >
      {pending && showSpinner ? <span className="operational-loading-spinner" aria-hidden="true" /> : null}
      <span>{pending ? loadingLabel : label}</span>
    </button>
  );
}
