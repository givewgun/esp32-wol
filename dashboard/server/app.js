import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import { ValidationError, validatePid, validatePower, validateStart } from './validate.js';

const PING_MS = 25_000; // under Cloudflare's 100 s idle cutoff

function securityHeaders(req, res, next) {
  res.set({
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  next();
}

export function createApp({ state, broker, verify, staticDir }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(securityHeaders);

  app.get('/api/health', (req, res) => res.json({ ok: true, mqtt: broker.connected() }));

  app.use('/api', async (req, res, next) => {
    try {
      req.email = await verify(req.get('Cf-Access-Jwt-Assertion'));
      next();
    } catch {
      res.status(401).json({ error: 'unauthorized' });
    }
  });

  // JSON only: a cross-site form cannot send application/json without a CORS preflight, which we never answer
  app.post('/api/*', (req, res, next) => (req.is('application/json') ? next() : res.status(415).json({ error: 'json only' })));
  app.use(express.json({ limit: '4kb' }));

  app.get('/api/events', (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    const send = (snap) => res.write(`data: ${JSON.stringify(snap)}\n\n`);
    send(state.snapshot());
    state.on('change', send);
    const ping = setInterval(() => res.write(': ping\n\n'), PING_MS);
    req.on('close', () => {
      clearInterval(ping);
      state.off('change', send);
    });
  });

  app.post('/api/power', (req, res) => {
    broker.publishPower(validatePower(req.body));
    res.status(202).json({ ok: true });
  });

  const requireOnline = (req, res, next) =>
    state.snapshot().pc === 'online' ? next() : res.status(409).json({ error: 'PC is offline' });

  const command = (build) => async (req, res, next) => {
    try {
      const reply = await broker.sendCommand(build(req));
      if (!reply.ok) return res.status(502).json({ error: String(reply.error ?? 'failed') });
      res.json({ ok: true, ...(Number.isInteger(reply.pid) ? { pid: reply.pid } : {}) });
    } catch (err) {
      if (err.name === 'TimeoutError') return res.status(504).json({ error: 'PC did not answer' });
      next(err);
    }
  };

  app.post(
    '/api/sessions',
    requireOnline,
    command((req) => ({ action: 'start', ...validateStart(req.body, state.folderList()) })),
  );
  app.post(
    '/api/sessions/:pid/stop',
    requireOnline,
    command((req) => ({ action: 'stop', pid: validatePid(req.params.pid, state.sessionList()) })),
  );

  app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }));

  if (staticDir && existsSync(staticDir)) {
    app.use(express.static(staticDir, { index: 'index.html' }));
    app.get('*', (req, res) => res.sendFile(join(staticDir, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad json' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'too large' });
    console.error(err);
    res.status(500).json({ error: 'internal error' });
  });

  return app;
}
