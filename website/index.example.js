const path = require('path');
const fs = require('fs');
const express = require('express');

const WEBSITE_DIR = path.resolve(__dirname);
const PUBLIC_DIR = path.join(WEBSITE_DIR, 'public');

function createWebRoutes(decodeConfig) {
  const router = express.Router();
  router.use(express.json());
  router.use(express.urlencoded({ extended: true }));

  router.get('/', (req, res) => {
    res.redirect('/configure');
  });

  router.get('/configure', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(WEBSITE_DIR, 'configure.html'));
  });

  router.get('/:token/configure', (req, res) => {
    const config = decodeConfig(req.params.token);
    if (!config) return res.status(400).send('Invalid token');

    const html = fs.readFileSync(path.join(WEBSITE_DIR, 'configure.html'), 'utf8');
    const injected = html.replace(
      '</head>',
      `<script>window.__INITIAL_CONFIG__ = ${JSON.stringify(config)}</script></head>`
    );
    res.setHeader('Cache-Control', 'no-cache');
    res.send(injected);
  });

  router.get('/my-library', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(PUBLIC_DIR, 'my-library', 'index.html'));
  });

  router.use(express.static(PUBLIC_DIR, {
    maxAge: '30d',
    etag: true,
    immutable: true,
  }));

  return router;
}

module.exports = createWebRoutes;
