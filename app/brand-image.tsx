"use client";

import { useState } from "react";

type BrandImageProps = {
  src: string;
  alt: string;
  className: string;
};

export function BrandImage({ src, alt, className }: BrandImageProps) {
  const [isAvailable, setIsAvailable] = useState(true);

  if (!isAvailable) {
    return null;
  }

  return <img className={className} src={src} alt={alt} onError={() => setIsAvailable(false)} />;
}
