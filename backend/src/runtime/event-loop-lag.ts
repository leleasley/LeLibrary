// Sampled event-loop lag probe (Phase 0, behaviour-neutral).
// Measures the delay between a scheduled timer and its actual firing, which
// approximates how long the event loop was blocked (e.g. by the sync engine's
// write passes). Sampled on a 1s cadence with unref'd timers: zero per-request
// work. Logs a one-line summary every 30 samples, only when PERF_TIMING=1.
export interface LagStats {
  samples: number;
  p50: number;
  p95: number;
  max: number;
}

export interface LagProbeOptions {
  intervalMs?: number;
  onSample?: (lagMs: number) => void;
}

export interface EventLoopLagApi {
  startLagProbe: (options?: LagProbeOptions) => void;
  stopLagProbe: () => void;
  getLagStats: () => LagStats;
}

const samples: number[] = [];
const MAX_SAMPLES = 300;
let timer: ReturnType<typeof setInterval> | null = null;
let loggedAt = 0;

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function getLagStats(): LagStats {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    samples: samples.length,
    p50: Math.round(percentile(sorted, 50) * 10) / 10,
    p95: Math.round(percentile(sorted, 95) * 10) / 10,
    max: sorted.length ? Math.round(sorted[sorted.length - 1] * 10) / 10 : 0,
  };
}

function startLagProbe(options: LagProbeOptions = {}): void {
  if (timer) return;
  const intervalMs = Math.max(10, options.intervalMs || 1000);
  let expected = Date.now() + intervalMs;
  timer = setInterval(() => {
    const now = Date.now();
    const lagMs = Math.max(0, now - expected);
    expected = now + intervalMs;
    samples.push(Math.round(lagMs * 10) / 10);
    if (samples.length > MAX_SAMPLES) samples.shift();
    try { options.onSample?.(lagMs); } catch { /* sampling must never throw */ }
    if (process.env.PERF_TIMING === '1' && samples.length - loggedAt >= 30) {
      loggedAt = samples.length;
      const s = getLagStats();
      console.log(`[Perf] event-loop-lag p50=${s.p50} p95=${s.p95} max=${s.max} samples=${s.samples}`);
    }
  }, intervalMs);
  timer.unref?.();
}

function stopLagProbe(): void {
  if (timer) { clearInterval(timer); timer = null; }
}

module.exports = { startLagProbe, stopLagProbe, getLagStats } satisfies EventLoopLagApi;
