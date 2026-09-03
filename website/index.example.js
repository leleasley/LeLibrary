// Public wrapper (self-hosters cloning the repo): no landing.html, so / just
// redirects to the configure page. All functional routes live in the shared
// git-tracked website/web-routes.js (copy this file to index.js if you want a
// local private version).
const createWebRoutes = require('./web-routes');

module.exports = (decodeConfig, options = {}) => createWebRoutes(decodeConfig, { ...options, landing: false });
