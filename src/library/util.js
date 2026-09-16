// Small shared helpers for the library engine.
function chunk(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
  return out;
}

async function pLimit(tasks, limit, worker) {
  const list = Array.isArray(tasks) ? tasks : [];
  const results = new Array(list.length);
  let cursor = 0;
  const run = async () => {
    while (cursor < list.length) {
      const index = cursor++;
      try { results[index] = await worker(list[index], index); }
      catch (err) { results[index] = { error: err }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), list.length) }, run));
  return results;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms).unref?.());
}

module.exports = { chunk, pLimit, sleep };
