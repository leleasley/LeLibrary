'use strict';

const RESOURCE_NAMES = new Set(['catalog', 'meta', 'stream', 'subtitles']);

function freezeAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') throw new TypeError('Client adapter must be an object');
  const id = String(adapter.id || '').trim().toLowerCase();
  if (!/^[a-z0-9-]+$/.test(id)) throw new TypeError('Client adapter id is invalid');
  if (!adapter.label || typeof adapter.label !== 'string') throw new TypeError(`Client adapter ${id} needs a label`);
  if (typeof adapter.manifest !== 'function') throw new TypeError(`Client adapter ${id} needs a manifest projector`);
  const resources = Array.isArray(adapter.capabilities?.resources) ? adapter.capabilities.resources : [];
  if (resources.some(resource => !RESOURCE_NAMES.has(resource))) throw new TypeError(`Client adapter ${id} has an unknown resource`);
  return Object.freeze({
    ...adapter,
    id,
    capabilities: Object.freeze({ ...(adapter.capabilities || {}), resources: Object.freeze(resources.slice()) }),
    requestPolicy: Object.freeze({ ...(adapter.requestPolicy || {}) }),
  });
}

module.exports = { freezeAdapter };
