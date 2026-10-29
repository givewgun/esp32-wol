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
    s.apply('wol/desktop/pc/stats', '{"ts":1}');
    s.apply('wol/desktop/pc/folders', '["a"]');
    s.apply('wol/desktop/pc/sessions', '{"ts":1,"sessions":[]}');
    expect(s.snapshot()).toEqual({
      esp: 'online',
      pc: 'offline',
      stats: { ts: 1 },
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
    s.apply('wol/desktop/pc/sessions', '{"ts":1,"sessions":[{"pid":5}]}');
    expect(s.sessionList()).toEqual([{ pid: 5 }]);
  });
});
