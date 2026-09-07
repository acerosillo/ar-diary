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
  // Added after the entries table already existed in some databases —
  // SQLite/libSQL has no "ADD COLUMN IF NOT EXISTS", so add it and ignore
  // the error if it's already there.
  try {
    await db.execute('ALTER TABLE entries ADD COLUMN shared INTEGER DEFAULT 0');
  } catch (err) {
    if (!/duplicate column/i.test(err.message || '')) throw err;
  }
}

function checkPasscode(req) {
  const expected = process.env.SHARED_PASSCODE;
  if (!expected) return { ok: false, status: 500, error: 'The shared page has not been set up yet — SHARED_PASSCODE is not configured.' };
  const given = req.headers['x-passcode'] || req.query.passcode || '';
  if (given !== expected) return { ok: false, status: 401, error: 'Incorrect passcode.' };
  return { ok: true };
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
          shared: !!row.shared,
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

  // Read-only, for the separate page someone else can be given a link (and
  // passcode) to. Only ever returns entries explicitly marked shared:true —
  // never the full journal — and refuses to answer at all without the
  // correct passcode (see checkPasscode above).
  app.get('/shared', async (req, res) => {
    const check = checkPasscode(req);
    if (!check.ok) return res.status(check.status).json({ error: check.error });
    try {
      const result = await db.execute('SELECT * FROM entries WHERE shared = 1 ORDER BY date DESC');
      const entries = result.rows.map((row) => ({
        date: row.date,
        mood: row.mood,
        emotions: row.emotions ? JSON.parse(row.emotions) : [],
        text: row.text || '',
        helped: row.helped || '',
      }));
      res.json({ entries });
    } catch (err) {
      console.error('GET /shared failed:', err);
      res.status(500).json({ error: 'Could not load shared entries.' });
    }
  });

  app.put('/entries/:date', async (req, res) => {
    const { date } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid date.' });
    }
    const { mood, emotions, text, helped, updatedDisplay, shared } = req.body || {};
    try {
      await db.execute({
        sql: `
          INSERT INTO entries (date, mood, emotions, text, helped, updated_at, shared)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(date) DO UPDATE SET
            mood = excluded.mood,
            emotions = excluded.emotions,
            text = excluded.text,
            helped = excluded.helped,
            updated_at = excluded.updated_at,
            shared = excluded.shared
        `,
        args: [
          date,
          mood ?? null,
          JSON.stringify(emotions || []),
          text || '',
          helped || '',
          updatedDisplay || '',
          shared ? 1 : 0,
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
