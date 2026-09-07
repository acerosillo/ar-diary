require('dotenv').config();
const path = require('path');
const express = require('express');
const { createClient } = require('@libsql/client');

const PORT = process.env.PORT || 3000;

// Same client works against a local file (no env vars set, good for trying
// the app out) or a real Turso database (set both env vars) — only the URL
// and token change. See .env.example for how to point this at Turso.
const db = createClient({
  url: process.env.TURSO_DATABASE_URL || 'file:local.db',
  authToken: process.env.TURSO_AUTH_TOKEN || undefined,
});

async function initDb() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS entries (
      date TEXT PRIMARY KEY,
      mood INTEGER,
      emotions TEXT,
      text TEXT,
      helped TEXT,
      updated_at TEXT
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);
}

const app = express();
app.use(express.json());

// GET /api/state -> everything the app needs on load: all entries + settings
app.get('/api/state', async (req, res) => {
  try {
    const [entriesResult, settingsResult] = await Promise.all([
      db.execute('SELECT * FROM entries'),
      db.execute('SELECT * FROM settings'),
    ]);

    const entries = {};
    for (const row of entriesResult.rows) {
      entries[row.date] = {
        mood: row.mood,
        emotions: row.emotions ? JSON.parse(row.emotions) : [],
        text: row.text || '',
        helped: row.helped || '',
        updatedDisplay: row.updated_at || '',
      };
    }

    const settings = {};
    for (const row of settingsResult.rows) {
      settings[row.key] = row.value;
    }

    res.json({ entries, settings });
  } catch (err) {
    console.error('GET /api/state failed:', err);
    res.status(500).json({ error: 'Could not load journal data.' });
  }
});

// PUT /api/entries/:date -> create or update one day's entry
app.put('/api/entries/:date', async (req, res) => {
  const { date } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Invalid date.' });
  }
  const { mood, emotions, text, helped, updatedDisplay } = req.body || {};
  try {
    await db.execute({
      sql: `
        INSERT INTO entries (date, mood, emotions, text, helped, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(date) DO UPDATE SET
          mood = excluded.mood,
          emotions = excluded.emotions,
          text = excluded.text,
          helped = excluded.helped,
          updated_at = excluded.updated_at
      `,
      args: [
        date,
        mood ?? null,
        JSON.stringify(emotions || []),
        text || '',
        helped || '',
        updatedDisplay || '',
      ],
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('PUT /api/entries/:date failed:', err);
    res.status(500).json({ error: 'Could not save that entry.' });
  }
});

// PUT /api/settings -> relationship / separation dates
app.put('/api/settings', async (req, res) => {
  const { relationshipStart, separationDate } = req.body || {};
  try {
    await Promise.all([
      db.execute({
        sql: `INSERT INTO settings (key, value) VALUES ('relationshipStart', ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        args: [relationshipStart || ''],
      }),
      db.execute({
        sql: `INSERT INTO settings (key, value) VALUES ('separationDate', ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        args: [separationDate || ''],
      }),
    ]);
    res.json({ ok: true });
  } catch (err) {
    console.error('PUT /api/settings failed:', err);
    res.status(500).json({ error: 'Could not save settings.' });
  }
});

// Only the public/ folder is ever served as static files — server.js,
// package.json and .env stay outside the web root.
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.redirect('/steady-ground.html'));

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Steady Ground running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to set up the database:', err);
    process.exit(1);
  });
