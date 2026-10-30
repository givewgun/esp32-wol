import { EventEmitter } from 'node:events';
import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectBroker } from '../server/broker.js';
import { canonical } from '../server/sign.js';
import { createState } from '../server/state.js';

const config = { mqtt: { uri: 'mqtts://broker:8883', user: 'u', pass: 'p' }, cmdSecret: 'k' };

function fakeClient() {
  const c = new EventEmitter();
  c.connected = true;
  c.published = [];
  c.subscribe = vi.fn();
  c.publish = (topic, payload, opts) => c.published.push({ topic, payload, opts });
  return c;
}

afterEach(() => vi.useRealTimers());

describe('broker', () => {
  it('subscribes to the dashboard topics on connect', () => {
    const client = fakeClient();
    connectBroker(config, createState(), { connect: () => client });
    client.emit('connect');
    expect(client.subscribe.mock.calls[0][0]).toEqual([
      'wol/desktop/status',
      'wol/desktop/pc',
      'wol/desktop/pc/stats',
      'wol/desktop/pc/folders',
      'wol/desktop/pc/sessions',
      'wol/desktop/pc/reply',
    ]);
  });

  it('feeds messages into state', () => {
    const client = fakeClient();
    const state = createState();
    connectBroker(config, state, { connect: () => client });
    client.emit('message', 'wol/desktop/pc', Buffer.from('online'));
    expect(state.snapshot().pc).toBe('online');
  });

  it('publishes power commands unsigned and not retained', () => {
    const client = fakeClient();
    connectBroker(config, createState(), { connect: () => client }).publishPower('wake');
    expect(client.published).toEqual([{ topic: 'wol/desktop', payload: 'wake', opts: { qos: 1, retain: false } }]);
  });

  it('sends signed commands and resolves on the matching reply', async () => {
    const client = fakeClient();
    const broker = connectBroker(config, createState(), { connect: () => client });
    const pending = broker.sendCommand({ action: 'stop', pid: 7 });
    const sent = JSON.parse(client.published[0].payload);
    expect(client.published[0].topic).toBe('wol/desktop/pc/cmd');
    expect(client.published[0].opts).toEqual({ qos: 1, retain: false });
    const { sig, ...rest } = sent;
    expect(sig).toBe(createHmac('sha256', 'k').update(canonical(rest)).digest('hex'));
    client.emit('message', 'wol/desktop/pc/reply', Buffer.from(JSON.stringify({ id: 'other', ok: false })));
    client.emit('message', 'wol/desktop/pc/reply', Buffer.from(JSON.stringify({ id: sent.id, ok: true })));
    await expect(pending).resolves.toEqual({ id: sent.id, ok: true });
  });

  it('times out after 10 s without a reply', async () => {
    vi.useFakeTimers();
    const client = fakeClient();
    const pending = connectBroker(config, createState(), { connect: () => client }).sendCommand({ action: 'refresh' });
    vi.advanceTimersByTime(10_000);
    await expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
  });

  it('ignores malformed replies', () => {
    const client = fakeClient();
    connectBroker(config, createState(), { connect: () => client });
    expect(() => client.emit('message', 'wol/desktop/pc/reply', Buffer.from('nope'))).not.toThrow();
  });
});
