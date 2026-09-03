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

app.listen(PORT, () => {
  console.log(`LeLibrary → http://localhost:${PORT}`);
  console.log(`Configure → http://localhost:${PORT}/configure`);
});
