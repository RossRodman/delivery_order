import { AlertTriangle, CheckCircle2, Lock, ShieldCheck, XCircle } from "lucide-react";
import type { LineStateView } from "@/contracts/api";

export type BadgeState = LineStateView | "rejected";

const STATE_CONFIG: Record<
  BadgeState,
  { label: string; bg: string; text: string; Icon: typeof CheckCircle2 }
> = {
  sand: { label: "OK", bg: "bg-sand-100", text: "text-sand-900", Icon: CheckCircle2 },
  red: { label: "Warning", bg: "bg-danger-100", text: "text-danger-900", Icon: AlertTriangle },
  blocked: { label: "Blocked", bg: "bg-blocked-100", text: "text-blocked-900", Icon: Lock },
  approved: { label: "Approved", bg: "bg-approved-100", text: "text-approved-900", Icon: ShieldCheck },
  rejected: { label: "Rejected", bg: "bg-danger-100", text: "text-danger-900", Icon: XCircle },
};

/**
 * A pill: icon + text label, never colour alone (design.md §1.1). `blocked` uses a grey
 * badge + `Lock` icon + "Blocked" label; the dashed red row border is applied by the caller
 * (OrderLinesTable) on the row itself, not here.
 */
export function DiscountStateBadge({ state }: { state: BadgeState }) {
  const { label, bg, text, Icon } = STATE_CONFIG[state];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-small font-medium ${bg} ${text}`}
    >
      <Icon size={14} aria-hidden="true" />
      {label}
    </span>
  );
}
