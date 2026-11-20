const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const routes = require('./routes');
const storage = require('./storage');
const { setupSockets, setupCron } = require('./realtime');
const { q, pool } = require('./db');

const app = express();
const server = http.createServer(app);
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost,http://localhost:80')
  .split(',').map(value => value.trim().replace(/\/$/, '')).filter(Boolean);
const corsOptions = {
  origin(origin, callback) {
    // Requests without an Origin header (health checks, CLI tools) are allowed.
    if (!origin || allowedOrigins.includes(origin.replace(/\/$/, ''))) return callback(null, true);
    return callback(new Error('Origin is not allowed by CORS.'));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};
const io = new Server(server, {
  maxHttpBufferSize: 1e6,
  cors: corsOptions,
});

app.disable('x-powered-by');
app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));
app.get(['/health', '/api/health'], async (_req, res) => {
  try {
    await q('SELECT 1');
    res.json({ ok: true, service: 'teamup-api', database: 'connected' });
  } catch {
    res.status(503).json({ ok: false, service: 'teamup-api', database: 'unavailable' });
  }
});
app.use('/api', routes(io));
setupSockets(io);
setupCron(io);

const PORT = Number(process.env.PORT || 3000);

async function start() {
  // Safe to run on every start: db/init.sql uses CREATE ... IF NOT EXISTS.
  const schemaPath = process.env.DB_SCHEMA_PATH || path.resolve(__dirname, '../../db/init.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  await pool.query(schema);
  console.log('Database schema is ready.');

  // Storage is optional during initial deployment; file features activate when configured.
  storage.init();
  server.listen(PORT, '0.0.0.0', () => console.log(`Teamup API listening on :${PORT}`));
}

start().catch(error => {
  console.error('Teamup startup failed:', error);
  process.exit(1);
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
