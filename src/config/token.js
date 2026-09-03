// Shared token boundary for public configure and hosted account code.
// This module intentionally has no dependency on src/accounts.
const tokenMap = require('../../website/public/token-map.js');

function decodeConfig(str) {
  if (!str || typeof str !== 'string' || str.length > 2048) return null;
  try {
    const padded = str + '=='.slice(0, (4 - (str.length % 4)) % 4);
    const standard = padded.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(Buffer.from(standard, 'base64').toString('utf8'));
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) return null;
    return tokenMap.normalizeConfig(decoded);
  } catch { return null; }
}

module.exports = { decodeConfig, isLegacyToken: token => !!decodeConfig(token) };
