import type { ReactNode } from "react";

export function EmptyState({
  icon,
  message,
  action,
}: {
  icon?: ReactNode;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-border-default p-10 text-center">
      {icon}
      <p className="text-body text-text-secondary">{message}</p>
      {action}
    </div>
  );
}
