import { describe, it } from "vitest";
import assert from "node:assert";
import { ComplianceEvidenceReporter } from "../compliance-evidence.ts";
import { GuardRuntime } from "../runtime.ts";

describe("Internal implementation evidence reporter", () => {
  it("generates an internal implementation evidence report with cryptographic audit references", async () => {
    const rt = new GuardRuntime({
      allowUnmanifestedPrincipals: true,
      executeTool: (args) => ({ ok: true, executedWith: args }),
      compensatingActions: {
        issue_refund: () => ({ ok: true }),
        cancel_subscription: () => ({ ok: true }),
      },
      verifyOutcome: () => ({ ok: true, source: "env_state_check" }),
    });

    // Populate audit log with verified actions
    await rt.call({
      tenantId: "eu-fintech",
      idempotencyKey: "cert_call_1",
      tool: "search_orders",
      args: { query: "orders" },
      goal: "search",
      principal: "agent:support",
      permissionScope: "all",
      environment: "prod",
    });

    const certifier = new ComplianceEvidenceReporter(rt);
    const cert = certifier.generateReport("eu-fintech");

    assert.strictEqual(cert.overallStatus, "EVIDENCE_COMPLETE");
    assert.strictEqual(cert.tamperEvidenceVerified, true);
    assert.strictEqual(cert.articles["Article 9"]?.status, "EVIDENCE_PRESENT");
    assert.strictEqual(cert.articles["Article 12"]?.status, "EVIDENCE_PRESENT");
    assert.strictEqual(cert.articles["Article 13"]?.status, "EVIDENCE_PRESENT");
    assert.strictEqual(cert.articles["Article 14"]?.status, "EVIDENCE_PRESENT");
    assert.ok(cert.digitalSignature.length === 64);

    const md = certifier.exportMarkdownReport(cert);
    assert.ok(md.includes("EU AI Act Implementation Evidence Report"));
    assert.ok(md.includes("EVIDENCE_COMPLETE"));
  });
});
