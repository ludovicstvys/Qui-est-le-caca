"use client";

import { useEffect } from "react";

export type Toast = { id: string; type: "ok" | "err" | "info"; msg: string };

export function ToastHost({
  toasts,
  remove,
}: {
  toasts: Toast[];
  remove: (id: string) => void;
}) {
  // Auto-dismiss
  useEffect(() => {
    const timers = toasts.map((t) =>
      setTimeout(() => remove(t.id), t.type === "err" ? 6000 : 3500)
    );
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toasts.length]);

  if (toasts.length === 0) return null;

  return (
    <div className="toastWrap" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.type}`}>
          <div className="toastDot" />
          <div className="toastMsg">{t.msg}</div>
          <button className="toastX" onClick={() => remove(t.id)} aria-label="Close">
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
