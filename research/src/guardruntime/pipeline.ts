/**
 * Composable Middleware Pipeline Engine (The Onion / Interceptor Pattern).
 *
 * Provides a modular, extensible execution stack where each security and governance
 * layer is an independent middleware function rather than a monolithic loop.
 */

import type { Outcome, RiskDecision, ToolCall } from "./types";
import { TelemetryTracer, type Span, type SpanAttributes } from "./telemetry";

export interface ExecutionContext {
  call: ToolCall;
  tenantId: string;
  principal: string;
  risk?: RiskDecision;
  planId?: string;
  viaCache?: boolean;
  span?:
    | {
        setAttribute: (key: keyof SpanAttributes, value: unknown) => void;
        addEvent: (name: string, attributes?: Record<string, unknown>) => void;
      }
    | undefined;
  metadata: Record<string, unknown>;
  startTime: number;
}

export type Middleware = (ctx: ExecutionContext, next: () => Promise<Outcome>) => Promise<Outcome>;

export class GuardPipeline {
  private middlewares: Middleware[] = [];

  /**
   * Register a middleware interceptor into the execution chain.
   */
  use(middleware: Middleware): this {
    this.middlewares.push(middleware);
    return this;
  }

  /**
   * Execute the full middleware pipeline over an execution context.
   */
  async execute(
    call: ToolCall,
    terminalHandler: (ctx: ExecutionContext) => Promise<Outcome>,
    tracer?: TelemetryTracer,
    traceparent?: string,
  ): Promise<Outcome> {
    const spanHandle = tracer?.startSpan(
      `guardruntime.pipeline.${call.tool}`,
      {
        "guardruntime.tool": call.tool,
        "guardruntime.tenant_id": call.tenantId,
        "guardruntime.principal": call.principal,
        "guardruntime.environment": call.environment,
      },
      traceparent,
    );

    const ctx: ExecutionContext = {
      call,
      tenantId: call.tenantId,
      principal: call.principal,
      metadata: {},
      startTime: Date.now(),
      span: spanHandle,
    };

    let index = 0;
    const runner = async (): Promise<Outcome> => {
      if (index < this.middlewares.length) {
        const mw = this.middlewares[index++]!;
        return mw(ctx, runner);
      }
      return terminalHandler(ctx);
    };

    try {
      const outcome = await runner();
      spanHandle?.setAttribute("guardruntime.status", outcome.status);
      spanHandle?.end("OK");
      return outcome;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      spanHandle?.end("ERROR", msg);
      throw err;
    }
  }
}
