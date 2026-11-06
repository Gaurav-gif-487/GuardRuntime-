import { createFileRoute } from "@tanstack/react-router";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AuditChain } from "@/guardruntime-ui/audit-chain";
import { EvalReportPanel } from "@/guardruntime-ui/eval-report";
import { Playground } from "@/guardruntime-ui/playground";
import { useGuardRuntime } from "@/guardruntime-ui/use-guardruntime";

export const Route = createFileRoute("/")({
  component: Index,
});

function Header({ policyVersion }: { policyVersion: string }) {
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-6">
        <div>
          <div className="flex items-baseline gap-3">
            <h1 className="font-display text-2xl font-semibold tracking-tight">GuardRuntime</h1>
            <span className="rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 font-mono text-[11px] text-primary">
              {policyVersion}
            </span>
          </div>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            A durable oversight layer for agent tool calls — risk classified by reversibility ×
            blast radius, confirmations that survive a restart, and an audit log built to prove it
            wasn't tampered with.
          </p>
        </div>
      </div>
    </header>
  );
}

function Index() {
  const rt = useGuardRuntime();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header policyVersion={rt.policyVersion} />

      <main className="mx-auto max-w-6xl px-6 py-6">
        <Tabs defaultValue="playground">
          <TabsList>
            <TabsTrigger value="playground">Playground</TabsTrigger>
            <TabsTrigger value="audit">Audit chain</TabsTrigger>
            <TabsTrigger value="eval">Eval report</TabsTrigger>
          </TabsList>

          <TabsContent value="playground" className="mt-4">
            <Playground rt={rt} />
          </TabsContent>

          <TabsContent value="audit" className="mt-4">
            <AuditChain
              entries={rt.auditEntries}
              verified={rt.auditStatus.ok}
              brokenAt={rt.auditStatus.brokenAt}
              onTamper={rt.tamperOneEntry}
            />
          </TabsContent>

          <TabsContent value="eval" className="mt-4">
            <EvalReportPanel />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
