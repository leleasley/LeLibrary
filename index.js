// LeLibrary entry point.
const app = require('./app');
const PORT = process.env.PORT || 7860;
app.listen(PORT, () => {
  console.log(`LeLibrary → http://localhost:${PORT}`);
  console.log(`Configure → http://localhost:${PORT}/configure`);
});
