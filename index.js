// LeLibrary entry point.
const app = require('./app');
const PORT = process.env.PORT || 7860;

// Backstop: Express 4 does not catch rejected promises from async handlers,
// and on Node >= 15 an unhandled rejection terminates the process. Handlers
// are wrapped with asyncHandler(), but this keeps a transient bug or an
// un-wrapped path (middleware, timers, background jobs) from taking prod down.
process.on('unhandledRejection', (err) => {
  console.error('[Process] Unhandled rejection:', err && err.stack ? err.stack : err);
});
process.on('uncaughtException', (err) => {
  // Log loudly; keep serving. Restarting on every uncaught exception turned
  // one bad request into a crash loop behind the health check.
  console.error('[Process] Uncaught exception (continuing):', err && err.stack ? err.stack : err);
});

const server = app.listen(PORT, () => {
  console.log(`LeLibrary → http://localhost:${PORT}`);
  console.log(`Configure → http://localhost:${PORT}/configure`);
  // Cross-provider ID mapping (imdb <-> tmdb/tvdb) and scene-title mappings
  // are loaded in the background so they never delay readiness; matching falls
  // back to plain TMDB search until they are ready.
  require('./src/title-aliases').loadOperatorAliases();
  require('./src/id-map').start();
  require('./src/scene-mapping').start();
  // Index-first library engine (sync worker + persistent local index). This is
  // the default core when DATABASE_URL is set; without a database, or with
  // LIBRARY_ENGINE=legacy, it is a no-op and the legacy path is used.
  require('./src/library/engine').start().catch((err) => {
    console.warn('[Library] engine start failed:', err.message);
  });
});

// Drain in-flight requests on redeploy/restart instead of dropping them, then
// flush the debounced match-cache writes so nothing queued just before SIGTERM
// is lost. A hard timeout guarantees the process still exits.
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Process] ${signal} received, shutting down`);
  const forceExit = setTimeout(() => process.exit(1), 10000);
  forceExit.unref?.();
  server.close(async () => {
    try { await require('./src/builder').flushMatchCache(); } catch (_) { /* best effort */ }
    try { require('./src/library/engine').stop(); } catch (_) { /* best effort */ }
    try { await require('./src/library/db').close(); } catch (_) { /* best effort */ }
    clearTimeout(forceExit);
    process.exit(0);
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
