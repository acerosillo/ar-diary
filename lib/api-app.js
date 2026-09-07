// The API routes, shared between the local dev server (server.js) and the
// Netlify Function (netlify/functions/api.js). Neither of those files knows
// how the routes are implemented — they just get a db client + an Express
// app back and mount it wherever makes sense for that environment.

const express = require('express');
const { createClient } = require('@libsql/client');

function makeDb() {
  // Same client either way — only the URL/token differ. No env vars set ->
  // a local SQLite file (fine for local dev, NOT usable on Netlify, whose
  // functions don't keep a persistent disk between invocations).
  return createClient({
    url: process.env.TURSO_DATABASE_URL || 'file:local.db',
    authToken: process.env.TURSO_AUTH_TOKEN || undefined,
  });
}

async function initDb(db) {
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

// Routes are defined WITHOUT an /api prefix — each caller mounts this app
// at whatever path makes /api/* reach it (server.js mounts it at "/api";
// the Netlify function rewrites the path itself, see that file).
function createApiApp(db) {
  const app = express();
  app.use(express.json());

  app.get('/state', async (req, res) => {
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
      console.error('GET /state failed:', err);
      res.status(500).json({ error: 'Could not load journal data.' });
    }
  });

  app.put('/entries/:date', async (req, res) => {
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
      console.error('PUT /entries/:date failed:', err);
      res.status(500).json({ error: 'Could not save that entry.' });
    }
  });

  app.put('/settings', async (req, res) => {
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
      console.error('PUT /settings failed:', err);
      res.status(500).json({ error: 'Could not save settings.' });
    }
  });

  return app;
}

module.exports = { makeDb, initDb, createApiApp };
