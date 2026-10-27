/**
 * Best-effort fixed-window rate limiter kept in the Worker isolate's memory.
 * Cloudflare runs many isolates, so this only slows down obvious floods; for
 * stronger limits add a Cloudflare rate-limiting rule in the dashboard.
 */
export class RateLimiter {
  private hits = new Map<string, { count: number; start: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  take(key: string): boolean {
    const now = Date.now();
    if (this.hits.size > 10_000) this.prune(now);
    const h = this.hits.get(key);
    if (!h || now - h.start >= this.windowMs) {
      this.hits.set(key, { count: 1, start: now });
      return true;
    }
    h.count += 1;
    return h.count <= this.max;
  }

  private prune(now: number): void {
    for (const [k, h] of this.hits) if (now - h.start >= this.windowMs) this.hits.delete(k);
  }
}
