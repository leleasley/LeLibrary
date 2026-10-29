// Worker thread for Live covers: the pixel maths in live-art.ts takes up to a
// few seconds per cover, which must never block the request loop.
const { parentPort } = require('node:worker_threads') as typeof import('node:worker_threads');
const art = require('./live-art.ts');

interface Job { id: number; spec: Record<string, unknown>; posters: Uint8Array[]; backdrop: Uint8Array | null; layers: { over: string; under?: string }; seed: number }

parentPort?.on('message', async (job: Job) => {
  try {
    const buf: Buffer | null = await art.drawLive(job.spec, {
      posters: job.posters.map((p) => Buffer.from(p)),
      backdrop: job.backdrop ? Buffer.from(job.backdrop) : null,
    }, job.layers, job.seed);
    parentPort?.postMessage({ id: job.id, buf: buf ? new Uint8Array(buf) : null });
  } catch {
    parentPort?.postMessage({ id: job.id, buf: null });
  }
});
