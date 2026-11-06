import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AuditEntry } from "../guardruntime";
import { Hash } from "./badges";

const TYPE_LABEL: Record<AuditEntry["type"], string> = {
  authorization_decision: "authorization decision",
  arc_decision: "ARC decision",
  cm_transition: "CM transition",
  cache_hit: "cache hit",
  cache_miss: "cache miss",
  cache_evicted: "cache evicted",
  tool_executed: "tool executed",
  tool_failed: "tool failed",
  tool_blocked: "tool blocked",
  fail_safe_activated: "fail-safe activated",
  idempotent_replay: "idempotent replay",
  outcome_verified: "outcome verified",
  outcome_verification_failed: "outcome verification failed",
  policy_updated: "policy updated",
};

export function AuditChain({
  entries,
  verified,
  brokenAt,
  onTamper,
}: {
  entries: readonly AuditEntry[];
  verified: boolean;
  brokenAt: number | undefined;
  onTamper: () => void;
}) {
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-block h-2.5 w-2.5 rounded-full",
              verified
                ? "bg-verified shadow-[0_0_8px_var(--verified)]"
                : "bg-danger shadow-[0_0_8px_var(--danger)]",
            )}
          />
          <p className="text-sm">
            {verified ? (
              <span className="text-verified">
                Chain intact — every entry commits to the previous entry's hash.
              </span>
            ) : (
              <span className="text-danger">
                Tamper detected at entry #{brokenAt} — hash chain broken from here forward.
              </span>
            )}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={onTamper} disabled={entries.length < 2}>
          Simulate a rewritten entry
        </Button>
      </div>

      {entries.length === 0 ? (
        <p className="rounded-md border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
          No entries yet — submit a tool call in the Playground tab to start the ledger.
        </p>
      ) : (
        <ol className="space-y-0">
          {entries
            .slice()
            .reverse()
            .map((e, i, arr) => {
              const broken = !verified && brokenAt !== undefined && e.seq >= brokenAt;
              const isLast = i === arr.length - 1;
              return (
                <li key={e.seq} className="relative pl-8">
                  {!isLast && (
                    <span
                      className={cn(
                        "absolute left-[13px] top-6 h-full w-px",
                        broken ? "bg-danger/60" : "bg-border",
                      )}
                    />
                  )}
                  <span
                    className={cn(
                      "absolute left-2 top-2 h-3 w-3 rounded-full border-2",
                      broken ? "border-danger bg-danger/30" : "border-primary bg-primary/30",
                    )}
                  />
                  <div
                    className={cn(
                      "mb-3 rounded-md border bg-card px-3 py-2.5",
                      broken ? "border-danger/40" : "border-border",
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">#{e.seq}</span>
                        <span className="text-sm font-medium">{TYPE_LABEL[e.type]}</span>
                        <span className="text-xs text-muted-foreground">· {e.principal}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {new Date(e.ts).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      <span className="text-muted-foreground">prev</span>
                      <Hash value={e.prevHash} />
                      <span className="text-muted-foreground">hash</span>
                      <Hash value={e.hash} className={broken ? "text-danger" : undefined} />
                    </div>
                  </div>
                </li>
              );
            })}
        </ol>
      )}
    </div>
  );
}
