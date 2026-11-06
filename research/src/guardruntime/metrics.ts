/** Prometheus-compatible counters/gauges for the observability layer. */
export class Metrics {
  private counters = new Map<string, number>();
  private latencies: number[] = [];

  inc(name: string, labels: Record<string, string> = {}, by = 1): void {
    const key = this.key(name, labels);
    this.counters.set(key, (this.counters.get(key) ?? 0) + by);
  }

  observeLatency(ms: number): void {
    this.latencies.push(ms);
  }

  /**
   * Look up a counter's value. With no labels, sums every series for `name`
   * (any label combination). With labels, sums every series whose labels are
   * a *superset* of the ones given — i.e. a subset/partial-match query, not
   * an exact one. Every call site tags extra context (e.g. `tenant`) that
   * callers querying by a narrower label set (e.g. just `reason`) still need
   * to find; an exact-match lookup would silently return 0 for those.
   */
  get(name: string, labels: Record<string, string> = {}): number {
    if (Object.keys(labels).length === 0) {
      let sum = 0;
      for (const [key, val] of this.counters) {
        if (key === name || key.startsWith(`${name}{`)) {
          sum += val;
        }
      }
      return sum;
    }
    let sum = 0;
    for (const [key, val] of this.counters) {
      if (key !== name && !key.startsWith(`${name}{`)) continue;
      const matches = Object.entries(labels).every(([label, value]) =>
        key.includes(`${label}="${value}"`),
      );
      if (matches) sum += val;
    }
    return sum;
  }

  quantile(q: number): number {
    if (!this.latencies.length) return 0;
    const s = [...this.latencies].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
  }

  snapshot(labelsFilter: Record<string, string> = {}): Record<string, number> {
    const entries = [...this.counters].filter(([key]) => {
      return Object.entries(labelsFilter).every(([label, value]) =>
        key.includes(`${label}="${value}"`),
      );
    });
    return Object.fromEntries(entries);
  }

  /** Prometheus text exposition format. */
  export(): string {
    const lines = [...this.counters].map(([k, v]) => `guardruntime_${k} ${v}`);
    lines.push(`guardruntime_added_latency_ms{quantile="0.99"} ${this.quantile(0.99)}`);
    lines.push(`guardruntime_added_latency_ms{quantile="0.5"} ${this.quantile(0.5)}`);
    return lines.join("\n");
  }

  private key(name: string, labels: Record<string, string>): string {
    const l = Object.keys(labels)
      .sort()
      .map((k) => `${k}="${labels[k]}"`)
      .join(",");
    return l ? `${name}{${l}}` : name;
  }
}
