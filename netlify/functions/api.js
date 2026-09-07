// Runs on Netlify as a serverless function. Netlify has no persistent Node
// server to run server.js on — this is the API for the deployed site.
// netlify.toml redirects /api/* here, so set TURSO_DATABASE_URL and
// TURSO_AUTH_TOKEN in the Netlify site's environment variables (Site
// settings -> Environment variables), not in a .env file — that file never
// gets deployed. The local-file database fallback in lib/api-app.js only
// works for `npm start` on your own machine; Netlify functions don't keep
// a disk between calls, so without those two variables set, entries would
// silently fail to persist.
const serverless = require('serverless-http');
const { makeDb, initDb, createApiApp } = require('../../lib/api-app');

const db = makeDb();
const app = createApiApp(db);
const asServerless = serverless(app);

// Table creation is idempotent (CREATE TABLE IF NOT EXISTS) — safe to
// re-run it; memoized so a warm function instance only does it once.
let dbReady = null;
function ensureDb() {
  if (!dbReady) dbReady = initDb(db);
  return dbReady;
}

exports.handler = async (event, context) => {
  await ensureDb();
  // netlify.toml sends requests here as /.netlify/functions/api/<rest>;
  // the routes in lib/api-app.js expect just /<rest> (e.g. "/state"),
  // so strip the function's own path prefix before handing off.
  event.path = event.path.replace(/^\/\.netlify\/functions\/api/, '') || '/';
  return asServerless(event, context);
};
