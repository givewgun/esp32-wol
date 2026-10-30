import { describe, expect, it, vi } from 'vitest';
import { createState } from '../server/state.js';

describe('state', () => {
  it('starts empty', () => {
    expect(createState().snapshot()).toEqual({ esp: null, pc: null, stats: null, folders: [], sessions: null });
  });

  it('applies each topic', () => {
    const s = createState();
    s.apply('wol/desktop/status', 'online');
    s.apply('wol/desktop/pc', 'offline');
    s.apply('wol/desktop/pc/stats', '{"ts":1,"cpu_pct":1,"uptime_s":1,"host":"h","ram":{"used":1,"total":2},"gpu":null,"disks":[]}');
    s.apply('wol/desktop/pc/folders', '["a"]');
    s.apply('wol/desktop/pc/sessions', '{"ts":1,"sessions":[]}');
    expect(s.snapshot()).toEqual({
      esp: 'online',
      pc: 'offline',
      stats: JSON.parse('{"ts":1,"cpu_pct":1,"uptime_s":1,"host":"h","ram":{"used":1,"total":2},"gpu":null,"disks":[]}'),
      folders: ['a'],
      sessions: { ts: 1, sessions: [] },
    });
  });

  it('ignores bad json and keeps the previous value', () => {
    const s = createState();
    s.apply('wol/desktop/pc/folders', '["a"]');
    s.apply('wol/desktop/pc/folders', 'not json');
    s.apply('wol/desktop/pc/folders', '{"not":"an array"}');
    expect(s.snapshot().folders).toEqual(['a']);
  });

  it('rejects hostile shapes from the shared broker login and keeps the last good value', () => {
    const s = createState();
    const stats = { ts: 1, cpu_pct: 1, uptime_s: 1, host: 'h', ram: { used: 1, total: 2 }, gpu: null, disks: [] };
    s.apply('wol/desktop/pc/stats', JSON.stringify(stats));
    s.apply('wol/desktop/pc/folders', '["a"]');
    s.apply('wol/desktop/pc/sessions', '{"ts":1,"sessions":[{"pid":5,"folder":"a","name":null,"mode":null,"started":1}]}');
    const good = s.snapshot();
    for (const [topic, payload] of [
      ['wol/desktop/pc/stats', '{}'],
      ['wol/desktop/pc/stats', JSON.stringify({ ...stats, ram: null })],
      ['wol/desktop/pc/stats', JSON.stringify({ ...stats, disks: 'x' })],
      ['wol/desktop/pc/stats', JSON.stringify({ ...stats, disks: [{ mount: {}, free: 1, total: 1 }] })],
      ['wol/desktop/pc/stats', JSON.stringify({ ...stats, gpu: { name: 'x' } })],
      ['wol/desktop/pc/folders', '[{}]'],
      ['wol/desktop/pc/folders', '[1]'],
      ['wol/desktop/pc/sessions', '{"sessions":"x"}'],
      ['wol/desktop/pc/sessions', '{"ts":1,"sessions":[{"folder":"a"}]}'],
      ['wol/desktop/pc/sessions', '{"ts":1,"sessions":[{"pid":5,"folder":{}}]}'],
      ['wol/desktop/pc', '{"x":1}'],
    ]) {
      s.apply(topic, payload);
      expect(s.snapshot(), `${topic} ${payload}`).toEqual(good);
    }
  });

  it('accepts stats with a gpu', () => {
    const s = createState();
    const gpu = { name: 'RTX', util_pct: 1, vram_used_mb: 1, vram_total_mb: 2, temp_c: 30 };
    const stats = { ts: 1, cpu_pct: 1, uptime_s: 1, host: 'h', ram: { used: 1, total: 2 }, gpu, disks: [] };
    s.apply('wol/desktop/pc/stats', JSON.stringify(stats));
    expect(s.snapshot().stats).toEqual(stats);
  });

  it('ignores unknown topics', () => {
    const s = createState();
    const fn = vi.fn();
    s.on('change', fn);
    s.apply('wol/desktop/pc/cmd', '{}');
    expect(fn).not.toHaveBeenCalled();
  });

  it('emits change with the snapshot', () => {
    const s = createState();
    const fn = vi.fn();
    s.on('change', fn);
    s.apply('wol/desktop/pc', 'online');
    expect(fn).toHaveBeenCalledWith(expect.objectContaining({ pc: 'online' }));
  });

  it('exposes session list and folder list helpers', () => {
    const s = createState();
    expect(s.sessionList()).toEqual([]);
    s.apply('wol/desktop/pc/sessions', '{"ts":1,"sessions":[{"pid":5,"folder":"a"}]}');
    expect(s.sessionList()).toEqual([{ pid: 5, folder: 'a' }]);
  });
});
