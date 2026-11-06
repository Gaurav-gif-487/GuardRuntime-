import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Environment, ToolDescriptor } from "../guardruntime";
import { OutcomeBadge, ReversibilityBadge, StateBadge } from "./badges";
import type { useGuardRuntime } from "./use-guardruntime";

function ArgFields({
  tool,
  args,
  onChange,
}: {
  tool: ToolDescriptor;
  args: Record<string, unknown>;
  onChange: (args: Record<string, unknown>) => void;
}) {
  const numericField = tool.magnitudeField ?? tool.affectedCountField;
  if (!numericField) return null;
  const label = tool.magnitudeField ? "Amount (USD)" : "Affected count";
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        type="number"
        value={(args[numericField] as number) ?? ""}
        onChange={(e) => onChange({ ...args, [numericField]: Number(e.target.value) })}
        placeholder={tool.magnitudeField ? "e.g. 8200" : "e.g. 34"}
      />
    </div>
  );
}

export function Playground({ rt }: { rt: ReturnType<typeof useGuardRuntime> }) {
  const [toolName, setToolName] = useState(rt.tools[0]?.name ?? "search_orders");
  const [goal, setGoal] = useState("find the customer's latest order");
  const [permissionScope, setPermissionScope] = useState("support:write");
  const [environment, setEnvironment] = useState<Environment>("prod");
  const [args, setArgs] = useState<Record<string, unknown>>({});
  const [approverId, setApproverId] = useState("reviewer@acme-retail.com");
  const [submitting, setSubmitting] = useState(false);

  const tool = rt.tools.find((t) => t.name === toolName) ?? rt.tools[0]!;

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await rt.submit({ tool: tool.name, args, goal, permissionScope, environment });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
      <Card>
        <CardHeader>
          <CardTitle className="font-display text-lg">Compose a tool call</CardTitle>
          <CardDescription>
            Runs through the real GuardRuntime pipeline — idempotency → cache → ARC → fail-safe →
            CM.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Tool</Label>
            <Select
              value={toolName}
              onValueChange={(v) => {
                setToolName(v);
                setArgs({});
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {rt.tools.map((t) => (
                  <SelectItem key={t.name} value={t.name}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="pt-0.5">
              <ReversibilityBadge value={tool.reversibility} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              Goal (what the agent is trying to do)
            </Label>
            <Input value={goal} onChange={(e) => setGoal(e.target.value)} />
          </div>

          <ArgFields tool={tool} args={args} onChange={setArgs} />

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Permission scope</Label>
              <Input value={permissionScope} onChange={(e) => setPermissionScope(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Environment</Label>
              <Select value={environment} onValueChange={(v) => setEnvironment(v as Environment)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="prod">prod</SelectItem>
                  <SelectItem value="staging">staging</SelectItem>
                  <SelectItem value="dev">dev</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button className="w-full" onClick={handleSubmit} disabled={submitting}>
            Submit tool call
          </Button>

          <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2.5">
            <div>
              <p className="text-sm font-medium">GuardRuntime health</p>
              <p className="text-xs text-muted-foreground">
                Flip off to test fail-safe blocking mid-flight.
              </p>
            </div>
            <Switch checked={rt.isHealthy} onCheckedChange={rt.toggleHealth} />
          </div>
          {!rt.isHealthy && (
            <p className="text-xs text-danger">
              Unhealthy — anything above genuinely reversible/low-risk will now block closed, not
              fail open.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="font-display text-lg">Pending confirmations</CardTitle>
              <CardDescription>
                Durable pause/resume state machine — restart durability requires the runtime's
                explicit serialize/hydrate persistence path; the browser demo itself uses in-memory
                state.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={approverId}
                onChange={(e) => setApproverId(e.target.value)}
                className="h-8 w-56 text-xs"
                placeholder="approver email (authenticated identity)"
              />
              <Button size="sm" variant="outline" onClick={rt.sweepTimeouts}>
                Sweep timeouts
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {rt.pending.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No calls awaiting approval.
              </p>
            ) : (
              <div className="space-y-3">
                {rt.pending.map((rec) => (
                  <div key={rec.id} className="rounded-md border border-border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{rec.tool}</span>
                        <StateBadge value={rec.state} />
                        <ReversibilityBadge value={rec.risk.reversibility} />
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => rt.resolveConfirmation(rec.id, "denied", approverId)}
                        >
                          Deny
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => rt.resolveConfirmation(rec.id, "approved", approverId)}
                        >
                          Approve
                        </Button>
                      </div>
                    </div>
                    <pre className="mt-2 whitespace-pre-wrap rounded bg-muted/50 p-2 font-mono text-[11px] text-muted-foreground">
                      {rec.question}
                    </pre>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-display text-lg">Recent calls</CardTitle>
          </CardHeader>
          <CardContent>
            {rt.log.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Nothing submitted yet.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tool</TableHead>
                    <TableHead>Goal</TableHead>
                    <TableHead>Outcome</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rt.log.slice(0, 8).map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="font-mono text-xs">{entry.tool}</TableCell>
                      <TableCell className="max-w-[220px] truncate text-xs text-muted-foreground">
                        {entry.goal}
                      </TableCell>
                      <TableCell>
                        <OutcomeBadge value={entry.outcome.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-display text-lg">Cached plans</CardTitle>
            <CardDescription>
              Hard-scoped by tenant/permission/resource/environment before any similarity match.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {rt.plans.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No plans cached yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Scope</TableHead>
                    <TableHead>Executions</TableHead>
                    <TableHead>Reliability</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rt.plans.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono text-xs">
                        {p.permissionScope} / {p.resourceType} / {p.environment}
                      </TableCell>
                      <TableCell>{p.executions}</TableCell>
                      <TableCell>{(p.reliability * 100).toFixed(0)}%</TableCell>
                      <TableCell>
                        {p.evictedReason ? (
                          <span className="text-xs text-danger">evicted: {p.evictedReason}</span>
                        ) : (
                          <span className="text-xs text-verified">active</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["cache_hits_total", "Cache hits"],
            ["cache_misses_total", "Cache misses"],
            ["fail_safe_activations_total", "Fail-safe activations"],
            ["tool_blocked_total", "Blocked calls"],
          ].map(([key, label]) => (
            <Card key={key}>
              <CardContent className="p-4">
                <p className="text-2xl font-display">
                  {Object.entries(rt.metricsSnapshot)
                    .filter(([k]) => k.startsWith(key!))
                    .reduce((sum, [, v]) => sum + v, 0)}
                </p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
