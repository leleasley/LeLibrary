// Local development entry point
const app = require('./app');
const PORT = process.env.PORT || 7860;
app.listen(PORT, () => {
  console.log(`TorBox Addon → http://localhost:${PORT}`);
  console.log(`Configure   → http://localhost:${PORT}/configure`);
});
