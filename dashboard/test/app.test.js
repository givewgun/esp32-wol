import { once } from 'node:events';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../server/app.js';
import { createState } from '../server/state.js';

const JWT = { 'Cf-Access-Jwt-Assertion': 'good' };
let state, broker, app;

function timeout() {
  const e = new Error('no reply');
  e.name = 'TimeoutError';
  return e;
}

beforeEach(() => {
  state = createState();
  state.apply('wol/desktop/pc', 'online');
  state.apply('wol/desktop/pc/folders', '["horizon","blink"]');
  state.apply('wol/desktop/pc/sessions', '{"ts":1,"sessions":[{"pid":77,"folder":"blink"}]}');
  broker = {
    connected: () => true,
    publishPower: vi.fn(),
    sendCommand: vi.fn(async () => ({ id: 'x', ok: true, pid: 4242 })),
  };
  const verify = async (t) => {
    if (t !== 'good') throw new Error('bad token');
    return 'owner@example.com';
  };
  app = createApp({ state, broker, verify });
});

const post = (path, body) => request(app).post(path).set(JWT).send(body);

describe('app', () => {
  it('health needs no auth and leaks no config', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, mqtt: true });
  });

  it('api requires access jwt', async () => {
    for (const [method, path] of [
      ['get', '/api/events'],
      ['post', '/api/power'],
      ['post', '/api/sessions'],
      ['post', '/api/sessions/77/stop'],
      ['get', '/api/anything'],
    ]) {
      const res = await request(app)[method](path).set('Cf-Access-Jwt-Assertion', 'forged').send({});
      expect(res.status, path).toBe(401);
    }
    expect(broker.publishPower).not.toHaveBeenCalled();
    expect(broker.sendCommand).not.toHaveBeenCalled();
  });

  it('email header alone is not auth', async () => {
    const res = await request(app)
      .post('/api/power')
      .set('Cf-Access-Authenticated-User-Email', 'owner@example.com')
      .send({ action: 'wake' });
    expect(res.status).toBe(401);
  });

  it('rejects non-json post with 415', async () => {
    const res = await request(app).post('/api/power').set(JWT).type('form').send('action=shutdown');
    expect(res.status).toBe(415);
    expect(broker.publishPower).not.toHaveBeenCalled();
  });

  it('rejects malformed json with 400', async () => {
    const res = await request(app).post('/api/power').set(JWT).type('json').send('{bad');
    expect(res.status).toBe(400);
  });

  it('publishes valid power actions', async () => {
    expect((await post('/api/power', { action: 'shutdown' })).status).toBe(202);
    expect(broker.publishPower).toHaveBeenCalledWith('shutdown');
    expect((await post('/api/power', { action: 'reboot' })).status).toBe(400);
  });

  it('rejects session start when pc offline', async () => {
    state.apply('wol/desktop/pc', 'offline');
    const res = await post('/api/sessions', { folder: 'horizon', mode: 'plan' });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'PC is offline' });
    expect(broker.sendCommand).not.toHaveBeenCalled();
  });

  it('start passes validated fields to broker', async () => {
    const res = await post('/api/sessions', { folder: 'horizon', mode: 'bypassPermissions', extra: 'x' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, pid: 4242 });
    expect(broker.sendCommand).toHaveBeenCalledWith({ action: 'start', folder: 'horizon', mode: 'bypassPermissions' });
  });

  it('bad folder 400 and broker not called', async () => {
    const res = await post('/api/sessions', { folder: '..', mode: 'plan' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'unknown folder' });
    expect(broker.sendCommand).not.toHaveBeenCalled();
  });

  it('stop unknown pid 400', async () => {
    expect((await post('/api/sessions/4/stop', {})).status).toBe(400);
    expect((await post('/api/sessions/77/stop', {})).status).toBe(200);
    expect(broker.sendCommand).toHaveBeenCalledWith({ action: 'stop', pid: 77 });
  });

  it('refuses commands with 503 while the broker is disconnected', async () => {
    broker.connected = () => false;
    expect((await post('/api/sessions', { folder: 'horizon', mode: 'plan' })).status).toBe(503);
    expect((await post('/api/power', { action: 'wake' })).status).toBe(503);
    expect(broker.sendCommand).not.toHaveBeenCalled();
    expect(broker.publishPower).not.toHaveBeenCalled();
  });

  it('reply error maps to 502', async () => {
    broker.sendCommand.mockResolvedValueOnce({ id: 'x', ok: false, error: 'already running' });
    const res = await post('/api/sessions', { folder: 'horizon', mode: 'plan' });
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'already running' });
  });

  it('timeout maps to 504', async () => {
    broker.sendCommand.mockRejectedValueOnce(timeout());
    const res = await post('/api/sessions', { folder: 'horizon', mode: 'plan' });
    expect(res.status).toBe(504);
    expect(res.body).toEqual({ error: 'PC did not answer' });
  });

  it('new SSE client receives snapshot first', async () => {
    const server = app.listen(0);
    await once(server, 'listening');
    const ctrl = new AbortController();
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/events`, {
        headers: JWT,
        signal: ctrl.signal,
      });
      expect(res.headers.get('content-type')).toMatch(/^text\/event-stream/);
      const reader = res.body.getReader();
      const first = new TextDecoder().decode((await reader.read()).value);
      expect(first.startsWith('data: ')).toBe(true);
      expect(JSON.parse(first.slice(6))).toEqual(state.snapshot());
      state.apply('wol/desktop/status', 'online');
      const next = new TextDecoder().decode((await reader.read()).value);
      expect(JSON.parse(next.slice(6)).esp).toBe('online');
    } finally {
      ctrl.abort();
      server.close();
    }
  });

  it('security headers present', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['content-security-policy']).toBe(
      "default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
    );
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('errors do not leak internals', async () => {
    broker.sendCommand.mockRejectedValueOnce(new Error('secret stack detail'));
    const res = await post('/api/sessions', { folder: 'horizon', mode: 'plan' });
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });
});
