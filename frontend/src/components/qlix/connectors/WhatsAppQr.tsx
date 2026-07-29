"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

/**
 * Renders the WhatsApp linking QR entirely client-side. The QR payload is session-linking material,
 * so it must never be sent to a third-party QR image service — it's drawn locally into a data URL.
 */
export function WhatsAppQr({ data, size = 180 }: { readonly data: string; readonly size?: number }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(data, { width: size, margin: 1 })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [data, size]);

  if (!dataUrl) {
    return (
      <div
        className="flex items-center justify-center text-[10px] text-black/40"
        style={{ width: size, height: size }}
      >
        Generating QR…
      </div>
    );
  }

  // eslint-disable-next-line @next/next/no-img-element
  return <img src={dataUrl} alt="WhatsApp QR code" width={size} height={size} />;
}
