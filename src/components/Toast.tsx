"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

export type ToastVariant = "success" | "error" | "info";
interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  show: (message: string, variant?: ToastVariant) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const show = useCallback((message: string, variant: ToastVariant = "info") => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, message, variant }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`rounded-md px-4 py-2 text-body shadow-lg ${
              t.variant === "success"
                ? "bg-approved-900 text-white"
                : t.variant === "error"
                  ? "bg-danger-900 text-white"
                  : "bg-blocked-900 text-white"
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Fall back to a no-op so components can be used/tested without the provider.
    return { show: () => {} };
  }
  return ctx;
}
