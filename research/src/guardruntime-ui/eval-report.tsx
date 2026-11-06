import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { runPhase0Eval, type EvalReport } from "../guardruntime";
import { OutcomeBadge } from "./badges";

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "verified" | "danger";
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p
          className={cn(
            "text-2xl font-display",
            tone === "verified" && "text-verified",
            tone === "danger" && "text-danger",
          )}
        >
          {value}
        </p>
        <p className="text-xs text-muted-foreground">{label}</p>
        {sub && <p className="mt-0.5 text-[11px] text-muted-foreground/70">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function PassFail({ pass, detail }: { pass: boolean; detail: string }) {
  return (
    <div
      className={cn(
        "rounded-md border p-3",
        pass ? "border-verified/30 bg-verified/10" : "border-danger/30 bg-danger/10",
      )}
    >
      <p className={cn("text-sm font-medium", pass ? "text-verified" : "text-danger")}>
        {pass ? "PASS" : "FAIL"}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

export function EvalReportPanel() {
  const [report, setReport] = useState<EvalReport | null>(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    try {
      setReport(await runPhase0Eval());
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="font-display text-lg">Phase 0 acceptance report</CardTitle>
            <CardDescription>
              A synthetic τ-bench-style task set (§7) run baseline-vs-guarded, with chaos and
              audit-integrity checks.
            </CardDescription>
          </div>
          <Button onClick={run} disabled={running}>
            {running ? "Running…" : report ? "Re-run" : "Run Phase 0 eval"}
          </Button>
        </CardHeader>
      </Card>

      {report && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat
              label="Task success — baseline"
              value={`${(report.taskSuccess.baselineRate * 100).toFixed(0)}%`}
              sub="no GuardRuntime"
            />
            <Stat
              label="Task success — guarded"
              value={`${(report.taskSuccess.guardedRate * 100).toFixed(0)}%`}
              tone="verified"
              sub={`${report.taskSuccess.guardedSuccesses}/${report.taskSuccess.total}`}
            />
            <Stat
              label="Potentially unnecessary confirmations"
              value={`${(report.confirmations.potentiallyUnnecessaryRate * 100).toFixed(0)}%`}
              sub={`${report.confirmations.approved}/${report.confirmations.total} approved on review`}
            />
            <Stat
              label="Execution-plan cache hit rate"
              value={`${report.caching.cacheHitRate.toFixed(0)}%`}
              sub={`hit rate ${(report.caching.cacheHitRate * 100).toFixed(0)}%`}
              tone="verified"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Latency (p99, pass-through)</CardTitle>
              </CardHeader>
              <CardContent>
                <p
                  className={cn(
                    "text-xl font-display",
                    report.latency.withinTarget ? "text-verified" : "text-danger",
                  )}
                >
                  {report.latency.p99Ms.toFixed(1)}ms
                </p>
                <p className="text-xs text-muted-foreground">
                  target &lt;{report.latency.targetMs}ms · p50 {report.latency.p50Ms.toFixed(1)}ms ·
                  n={report.latency.sampleSize}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Chaos test — outage fail-safe</CardTitle>
              </CardHeader>
              <CardContent>
                <PassFail pass={report.chaos.pass} detail={report.chaos.detail} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Audit log tamper-evidence</CardTitle>
              </CardHeader>
              <CardContent>
                <PassFail pass={report.auditIntegrity.pass} detail={report.auditIntegrity.detail} />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="font-display text-lg">
                Reversibility×blast-radius vs. a flat risk label
              </CardTitle>
              <CardDescription>
                {report.flatBaselineComparison.agree} of {report.meta.taskCount} tasks agreed with a
                naive low/medium/high label; {report.flatBaselineComparison.divergences.length}{" "}
                diverged.
              </CardDescription>
            </CardHeader>
            {report.flatBaselineComparison.divergences.length > 0 && (
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Task</TableHead>
                      <TableHead>Flat label</TableHead>
                      <TableHead>ARC</TableHead>
                      <TableHead>Why</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.flatBaselineComparison.divergences.map((d) => (
                      <TableRow key={d.taskId}>
                        <TableCell className="font-mono text-xs">{d.taskId}</TableCell>
                        <TableCell className="text-xs">
                          {d.flatWouldConfirm ? "would confirm" : "would skip"}
                        </TableCell>
                        <TableCell className="text-xs">
                          {d.arcReversibility} · blast {d.arcBlastRadius} ·{" "}
                          {d.arcDidConfirm ? "confirmed" : "skipped"}
                        </TableCell>
                        <TableCell className="max-w-[360px] text-xs text-muted-foreground">
                          {d.note}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            )}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="font-display text-lg">Findings</CardTitle>
              <CardDescription>
                Including negative/ambiguous results, not just the numbers that look good.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
                {report.findings.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="font-display text-lg">Per-task detail</CardTitle>
            </CardHeader>
            <CardContent className="max-h-[420px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Task</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Baseline</TableHead>
                    <TableHead>Guarded outcome</TableHead>
                    <TableHead>Confirmed?</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.perTask.map((p, i) => (
                    <TableRow key={`${p.id}-${p.instance}-${i}`}>
                      <TableCell className="font-mono text-xs">
                        {p.id}
                        {p.instance > 0 ? ` #${p.instance + 1}` : ""}
                      </TableCell>
                      <TableCell className="text-xs">{p.category.replace("_", " ")}</TableCell>
                      <TableCell className="text-xs">{p.baselineSuccess ? "ok" : "harm"}</TableCell>
                      <TableCell>
                        <OutcomeBadge value={p.guardedOutcome} />
                      </TableCell>
                      <TableCell className="text-xs">
                        {p.requiredConfirmation ? (p.approverAction ?? "pending") : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
