import { cn } from "@/lib/utils";
import type { ConfirmationState, Outcome, Reversibility } from "../guardruntime";

export function ReversibilityBadge({ value }: { value: Reversibility }) {
  const styles: Record<Reversibility, string> = {
    reversible: "bg-verified/15 text-verified border-verified/30",
    recoverable: "bg-primary/15 text-primary border-primary/30",
    destructive: "bg-danger/15 text-danger border-danger/30",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-mono uppercase tracking-wide",
        styles[value],
      )}
    >
      {value}
    </span>
  );
}

export function StateBadge({ value }: { value: ConfirmationState }) {
  const styles: Record<ConfirmationState, string> = {
    pending: "bg-primary/15 text-primary border-primary/30",
    approved: "bg-verified/15 text-verified border-verified/30",
    modified: "bg-verified/15 text-verified border-verified/30",
    denied: "bg-danger/15 text-danger border-danger/30",
    timed_out: "bg-muted text-muted-foreground border-border",
    escalated: "bg-primary/15 text-primary border-primary/30",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-mono uppercase tracking-wide",
        styles[value],
      )}
    >
      {value.replace("_", " ")}
    </span>
  );
}

export function OutcomeBadge({ value }: { value: Outcome["status"] }) {
  const styles: Record<Outcome["status"], string> = {
    executed: "bg-verified/15 text-verified border-verified/30",
    failed: "bg-danger/15 text-danger border-danger/30",
    blocked: "bg-danger/15 text-danger border-danger/30",
    pending_confirmation: "bg-primary/15 text-primary border-primary/30",
    replayed: "bg-muted text-muted-foreground border-border",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-mono uppercase tracking-wide",
        styles[value],
      )}
    >
      {value.replace("_", " ")}
    </span>
  );
}

export function Hash({ value, className }: { value: string; className?: string | undefined }) {
  return (
    <span className={cn("font-mono text-xs text-muted-foreground", className)} title={value}>
      {value.slice(0, 10)}…
    </span>
  );
}
