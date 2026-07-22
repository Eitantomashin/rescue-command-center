"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type PostActionDetailsProps = {
  children: ReactNode;
  className?: string;
  defaultOpen?: boolean;
  successParam: string;
  successMessage?: string;
  cleanParams?: string[];
};

export function PostActionDetails({
  children,
  className,
  defaultOpen = false,
  successParam,
  successMessage,
  cleanParams = [successParam]
}: PostActionDetailsProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [showSuccess, setShowSuccess] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (searchParams.get(successParam) !== "1") {
      return;
    }

    setIsOpen(false);
    setShowSuccess(true);

    const nextParams = new URLSearchParams(searchParams.toString());
    (cleanParams ?? [successParam]).forEach((param) => nextParams.delete(param));
    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
  }, [cleanParams, pathname, router, searchParams, successParam]);

  return (
    <>
      {showSuccess && successMessage ? <p className="success-panel">{successMessage}</p> : null}
      <details className={className} open={isOpen} onToggle={(event) => setIsOpen(event.currentTarget.open)}>
        {children}
      </details>
    </>
  );
}
