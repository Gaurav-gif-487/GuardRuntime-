/**
 * OpenTelemetry (OTel) Compatible Tracing & W3C TraceContext Propagation.
 *
 * Implements native distributed tracing for agent tool executions:
 * 1. W3C Traceparent parser and generator (4-part format: version-traceId-spanId-flags)
 * 2. Standardized OTel Span structure with guardruntime attributes
 * 3. Distributed cross-agent context propagation
 */

export interface SpanAttributes {
  "guardruntime.tool": string;
  "guardruntime.tenant_id": string;
  "guardruntime.principal": string;
  "guardruntime.environment": string;
  "guardruntime.reversibility"?: string;
  "guardruntime.blast_radius"?: number;
  "guardruntime.severity"?: number;
  "guardruntime.gated"?: boolean;
  "guardruntime.cached"?: boolean;
  "guardruntime.status"?: string;
  [key: string]: unknown;
}

export interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string | undefined;
  name: string;
  startTime: number;
  endTime?: number;
  attributes: SpanAttributes;
  events: Array<{
    name: string;
    timestamp: number;
    attributes?: Record<string, unknown> | undefined;
  }>;
  status: "OK" | "ERROR" | "UNSET";
  errorMessage?: string;
}

export class TelemetryTracer {
  private spans: Span[] = [];

  constructor(private readonly clock: () => number = () => Date.now()) {}

  /**
   * Parse a W3C traceparent header: `00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01`
   */
  parseTraceparent(traceparent?: string): { traceId: string; parentSpanId?: string | undefined } {
    if (!traceparent) {
      return { traceId: this.randomHex(32) };
    }
    const parts = traceparent.split("-");
    if (parts.length >= 4 && parts[1]!.length === 32) {
      return { traceId: parts[1]!, parentSpanId: parts[2] };
    }
    return { traceId: this.randomHex(32) };
  }

  /**
   * Format a W3C traceparent header string.
   */
  formatTraceparent(traceId: string, spanId: string): string {
    return `00-${traceId}-${spanId}-01`;
  }

  /**
   * Start a new distributed tracing span for a tool execution.
   */
  startSpan(
    name: string,
    initialAttributes: Partial<SpanAttributes> = {},
    traceparent?: string,
  ): {
    span: Span;
    end: (status?: Span["status"], errorMessage?: string) => Span;
    addEvent: (eventName: string, attributes?: Record<string, unknown>) => void;
    setAttribute: (key: keyof SpanAttributes, value: unknown) => void;
  } {
    const { traceId, parentSpanId } = this.parseTraceparent(traceparent);
    const spanId = this.randomHex(16);

    const span: Span = {
      traceId,
      spanId,
      parentSpanId,
      name,
      startTime: this.clock(),
      attributes: initialAttributes as SpanAttributes,
      events: [],
      status: "UNSET",
    };

    this.spans.push(span);

    return {
      span,
      end: (status = "OK", errorMessage?: string) => {
        span.endTime = this.clock();
        span.status = status;
        if (errorMessage) span.errorMessage = errorMessage;
        return span;
      },
      addEvent: (eventName: string, attributes?: Record<string, unknown>) => {
        span.events.push({ name: eventName, timestamp: this.clock(), attributes });
      },
      setAttribute: (key: keyof SpanAttributes, value: unknown) => {
        span.attributes[key] = value;
      },
    };
  }

  getCompletedSpans(): readonly Span[] {
    return this.spans.filter((s) => s.endTime !== undefined);
  }

  clear(): void {
    this.spans = [];
  }

  private randomHex(length: number): string {
    let result = "";
    while (result.length < length) {
      result += Math.random().toString(16).substring(2);
    }
    return result.substring(0, length);
  }
}
