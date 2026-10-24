// LeLibrary entry point.
const app = require('./app.ts');
const PORT = process.env.PORT || 7860;

// Backstop: Express 4 does not catch rejected promises from async handlers,
// and on Node >= 15 an unhandled rejection terminates the process. Handlers
// are wrapped with asyncHandler(), but this keeps a transient bug or an
// un-wrapped path (middleware, timers, background jobs) from taking prod down.
process.on('unhandledRejection', (err: unknown) => {
  console.error('[Process] Unhandled rejection:', err instanceof Error ? err.stack ?? err.message : err);
});
process.on('uncaughtException', (err: unknown) => {
  // Log loudly; keep serving. Restarting on every uncaught exception turned
  // one bad request into a crash loop behind the health check.
  console.error('[Process] Uncaught exception (continuing):', err instanceof Error ? err.stack ?? err.message : err);
});

const server = app.listen(PORT, () => {
  console.log(`LeLibrary → http://localhost:${PORT}`);
  console.log(`Configure → http://localhost:${PORT}/configure`);
  // Cross-provider ID mapping (imdb <-> tmdb/tvdb) and scene-title mappings
  // are loaded in the background so they never delay readiness; matching falls
  // back to plain TMDB search until they are ready.
  require('./src/media/title-aliases.ts').loadOperatorAliases();
  require('./src/media/id-map.ts').start();
  require('./src/media/scene-mapping.ts').start();
  // Index-first library engine (sync worker + persistent local index). This is
  // the default core when DATABASE_URL is set; without a database, or with
  // LIBRARY_ENGINE=legacy, it is a no-op and the legacy path is used.
  require('./src/library/engine.ts').start().catch((err: Error) => {
    console.warn('[Library] engine start failed:', err.message);
  });
  // Hosted-only Releases sync (no-op without the shared TMDB key). Timer-driven,
  // overlap-guarded, SQL-only on the read path. Never starts on self-hosted.
  require('./src/releases/sync.ts').start().catch((err: Error) => {
    console.warn('[Releases] sync start failed:', err.message);
  });
  // Background jobs: work that cannot finish inside a request (today: finishing
  // a Nuvio push whose owned library was still building). The pending-push
  // module registers its handler on require, so it must load before startJobs().
  require('./src/setup/pending-push.ts');
  require('./src/setup/franchise-autopush.ts');
  require('./src/runtime/jobs.ts').startJobs();
  // Phase 0 perf probe: sampled event-loop lag, behind PERF_TIMING=1 only.
  if (process.env.PERF_TIMING === '1') {
    require('./src/runtime/event-loop-lag.ts').startLagProbe();
  }
});

// Drain in-flight requests on redeploy/restart instead of dropping them, then
// flush the debounced match-cache writes so nothing queued just before SIGTERM
// is lost. A hard timeout guarantees the process still exits.
let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Process] ${signal} received, shutting down`);
  const forceExit = setTimeout(() => process.exit(1), 10000);
  forceExit.unref?.();
  server.close(async (): Promise<void> => {
    try { await (require('./src/catalog/builder.ts') as { flushMatchCache: () => Promise<void> }).flushMatchCache(); } catch { /* best effort */ }
    try { (require('./src/library/engine.ts') as { stop: () => void }).stop(); } catch { /* best effort */ }
    try { (require('./src/releases/sync.ts') as { stop: () => void }).stop(); } catch { /* best effort */ }
    try { await (require('./src/library/db.ts') as { close: () => Promise<void> }).close(); } catch { /* best effort */ }
    try { (require('./src/runtime/event-loop-lag.ts') as { stopLagProbe: () => void }).stopLagProbe(); } catch { /* best effort */ }
    clearTimeout(forceExit);
    process.exit(0);
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
