// Local dev server: runs the same API code as the Netlify function
// (lib/api-app.js), plus serves public/ directly, on one port.
// This is NOT what runs when you deploy to Netlify — see netlify.toml
// and netlify/functions/api.js for that path.
require('dotenv').config();
const path = require('path');
const express = require('express');
const { makeDb, initDb, createApiApp } = require('./lib/api-app');

const PORT = process.env.PORT || 3000;

const db = makeDb();
const app = express();

app.use('/api', createApiApp(db));

// Only the public/ folder is ever served as static files — server.js,
// package.json and .env stay outside the web root.
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.redirect('/steady-ground.html'));

initDb(db)
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Steady Ground running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to set up the database:', err);
    process.exit(1);
  });
