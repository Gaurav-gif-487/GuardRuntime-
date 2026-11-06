import { describe, it } from "vitest";
import assert from "node:assert";
import { MCPGatewayProxy, type JSONRPCRequest, type JSONRPCResponse } from "../mcp-gateway.ts";
import { GuardRuntime } from "../runtime.ts";

describe("Pillar 1: MCP JSON-RPC Security Gateway", () => {
  // Each test gets its own GuardRuntime + tenant. Sharing one runtime/tenant
  // across the whole describe block makes cumulative budget and drift state
  // leak between tests, so a test's outcome can depend on execution order
  // rather than its own inputs.
  function makeGateway() {
    const rt = new GuardRuntime({
      allowUnmanifestedPrincipals: true,
      executeTool: (args) => ({ ok: true, executedWith: args }),
      compensatingActions: {
        issue_refund: () => ({ ok: true }),
        cancel_subscription: () => ({ ok: true }),
      },
      verifyOutcome: () => ({ ok: true, source: "env_state_check" }),
    });
    return new MCPGatewayProxy(
      rt,
      `mcp-tenant-${Math.random().toString(36).slice(2)}`,
      "agent:mcp-client",
    );
  }

  // Mock downstream MCP server handler
  const mockDownstream = async (req: JSONRPCRequest): Promise<JSONRPCResponse> => ({
    jsonrpc: "2.0",
    id: req.id,
    result: { content: [{ type: "text", text: `Executed ${req.params?.["name"]}` }] },
  });

  it("passes safe reversible reads directly to downstream MCP server", async () => {
    const gateway = makeGateway();
    const req: JSONRPCRequest = {
      jsonrpc: "2.0",
      id: "req_01",
      method: "tools/call",
      params: {
        name: "search_orders",
        arguments: { query: "orders for user" },
      },
    };

    const res = await gateway.handleMessage(req, mockDownstream);
    assert.strictEqual(res.error, undefined);
    assert.ok(res.result);
  });

  it("intercepts high-risk destructive actions and returns structured HITL pending confirmation error", async () => {
    const gateway = makeGateway();
    const req: JSONRPCRequest = {
      jsonrpc: "2.0",
      id: "req_02",
      method: "tools/call",
      params: {
        name: "wire_transfer",
        arguments: { amount_usd: 50000 },
      },
    };

    const res = await gateway.handleMessage(req, mockDownstream);
    assert.ok(res.error);
    assert.strictEqual(res.error!.code, -32001);
    assert.ok(res.error!.message.includes("Confirmation Required"));
    const data = res.error!.data as { status?: string };
    assert.strictEqual(data.status, "pending_confirmation");
  });

  it("blocks prototype pollution attacks at the MCP protocol level", async () => {
    const gateway = makeGateway();
    const req: JSONRPCRequest = {
      jsonrpc: "2.0",
      id: "req_03",
      method: "tools/call",
      params: {
        name: "search_orders",
        arguments: JSON.parse('{"__proto__": {"admin": true}, "query": "orders"}'),
      },
    };

    const res = await gateway.handleMessage(req, mockDownstream);
    assert.ok(res.error);
    assert.strictEqual(res.error!.code, -32000);
    assert.ok(res.error!.message.includes("Security Policy Blocked"));
  });
});
