// Settings surface: the server-side config store and the catalogue metadata
// endpoints the Configure pickers read. v5.5 setup tokens save and load
// without a session; the install token is the capability.
import type { Express } from 'express';

const { decodeConfig } = require('../config/token.ts') as { decodeConfig: (token: unknown) => Record<string, unknown> | null };
const providers = require('../providers/index.ts') as { getUserKey: (config: any) => string };
const { validateCustomStreamsConfig } = require('../media/custom-streams.ts') as {
  validateCustomStreamsConfig: (config: any) => any;
};
const { rateLimit } = require('../middleware/rate-limit.ts') as {
  rateLimit: (options?: { windowMs?: number; max?: number }) => (req: any, res: any, next: () => void) => void;
};

export interface SettingsDeps {
  resolveConfig: (token: string) => Promise<Record<string, any> | null>;
}

export interface SettingsApi {
  mountSettingsRoutes: (app: Express, deps: SettingsDeps) => void;
}

function mountSettingsRoutes(app: Express, deps: SettingsDeps): void {
  const { resolveConfig } = deps;
// ── Server-side config store (stream settings) ──
// Lives HERE (git-tracked, auto-deployed) rather than in the private
// website/index.js so the addon never depends on a manually-synced file for
// the custom formatter / stream addon settings to work. The configure page
// saves the heavy stream settings keyed by the user's stable hash; the addon
// merges them back on every stream/meta request.
app.post('/api/save-config', rateLimit({ windowMs: 60000, max: 30 }), async (req, res) => {
  try {
    let config = req.body && req.body.config;
    if (!config || typeof config !== 'object') return res.status(400).json({ error: 'Missing config' });
    config = validateCustomStreamsConfig(config);
    if (config.posterProvider === 'custom') {
      const checked = require('../media/poster-template.ts').validate(config.customPosterTemplate);
      if (!checked.ok) return res.status(400).json({ error: checked.error });
      config.customPosterTemplate = checked.value;
    }
    // For an opaque account token, persist the full (key-stripped) config so the
    // saved install URL picks up edits without re-pushing. Legacy base64 tokens
    // carry the config themselves: nothing to store.
    const tokenId = req.body && req.body.token;
    let configForStore = config;
    let ownershipVerified = false;
    if (typeof tokenId === 'string' && tokenId && !decodeConfig(tokenId)) {
      // A v5.5 install token is its own capability, so a save carrying one
      // needs no session and no bot gate. An unknown token is rejected.
      const scoped = await resolveConfig(tokenId);
      if (!scoped) return res.status(403).json({ error: 'Unknown or expired install token' });
      configForStore = scoped;
      // Ownership just passed a session check: the account area's push and
      // install flows skip the bot gate below untouched.
      ownershipVerified = true;
    }
    // Turnstile bot gate (managed, invisible): mirrors the website router's
    // /api/save-config handler so both stay in agreement. Anonymous/legacy
    // saves require a fresh token once TURNSTILE_SECRET + TURNSTILE_HOSTNAMES
    // are set; unconfigured instances proceed exactly as before.
    if (!ownershipVerified) {
      const turnstile = require('../platform/turnstile.ts');
      if (turnstile.turnstileConfigured()) {
        const verdict = await turnstile.verifyTurnstile(req.body && req.body['cf-turnstile-response'], {
          action: 'save-config',
          remoteip: req.ip,
        });
        if (!verdict.ok) return res.status(403).json({ error: 'Bot check failed. Reload the page and try again.' });
      }
    }
    const userKey = await require('../runtime/configstore.ts').saveStreamSettings(configForStore);
    if (!userKey && Array.isArray(configForStore.customStreams) && configForStore.customStreams.length > 0) {
      return res.json({ ok: true, selfContained: true });
    }
    if (!userKey) return res.status(400).json({ error: 'Config has no usable API keys' });
    // Keep Configure and account Configure on the one catalogue cache path.
    // An install explicitly waits for this work so its new Nuvio folders are
    // ready on first open. Ordinary background saves remain responsive.
    const warmer = require('../catalog/collection-cache-warm.ts');
    const waitForWarm = req.body?.warmCollections === true;
    const warm = warmer.warmConfiguredLibraryCatalogs(configForStore);
    const warmResult = waitForWarm
      ? await warm
      : (warm.catch((err: any) => console.warn('[Collection cache] Background warm failed:', err.message)), null);
    res.json({ ok: true, userKey, ...(warmResult ? { collectionCache: warmResult } : {}) });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
  }
});

// Return the server-side stream settings for a token's user so the configure
// form can pre-fill them even when the token itself is missing them.
app.get('/api/config/:token', rateLimit({ windowMs: 60000, max: 60 }), async (req, res) => {
  const config = await resolveConfig(req.params.token);
  if (!config) return res.status(400).json({ error: 'Invalid token' });
  try {
    const userKey = providers.getUserKey(config);
    const stored = (userKey || ['account', 'config'].includes(config.__configScope?.type))
      ? await require('../runtime/configstore.ts').loadStreamSettings(config)
      : null;
    res.json(stored || null);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Catalog library metadata (for the configure page picker) ──
// Exposes the 451 catalog definitions (id, name, type, group, icon) so the
// configure page can render the picker without shipping the whole table. No
// params (ids/keys) are exposed: just the display metadata.
app.get('/api/catalog-library', async (req, res) => {
  try {
    const { listPickerSources, validateSourceDefinitions } = require('../catalog/catalog-source-registry.ts');
    const validation = validateSourceDefinitions();
    if (!validation.ok) throw new Error(`Invalid catalog source registry: ${validation.errors.join('; ')}`);
    res.json({ catalogs: listPickerSources(), total: validation.total });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Curated one-click packs for the Collections Wizard. The source ids within
// each pack are validated by the server before being exposed to the UI.
app.get('/api/catalog-quick-picks', (req, res) => {
  const { listQuickPicks, validateQuickPicks } = require('../catalog/catalog-quick-picks.ts');
  const validation = validateQuickPicks();
  if (!validation.ok) return res.status(500).json({ error: 'Invalid quick picks', details: validation.errors });
  res.json({ quickPicks: listQuickPicks(), total: validation.total });
});

// Shared Nuvio collection packs. Public because /configure is available to
// self-hosters; the private Account area consumes the same registry.
app.get('/api/curated-collections', (req, res) => {
  const curated = require('../catalog/curated-collections.ts');
  const validation = curated.validateCuratedCollections();
  if (!validation.ok) return res.status(500).json({ error: 'Invalid curated collections', details: validation.errors });
  res.json({ ...curated.curatedCollectionsPayload({ hideAnime: req.query.hideAnime === 'true' }), ...validation });
});
}

module.exports = { mountSettingsRoutes } satisfies SettingsApi;
