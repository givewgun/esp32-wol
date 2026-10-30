import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonical, signCommand } from '../server/sign.js';

const vector = JSON.parse(readFileSync(new URL('./fixtures/cmd-vector.json', import.meta.url), 'utf8'));

describe('sign', () => {
  it('matches python vector', () => {
    expect(canonical(vector.cmd)).toBe(vector.canonical);
    const sig = createHmac('sha256', vector.secret).update(canonical(vector.cmd), 'utf8').digest('hex');
    expect(sig).toBe(vector.sig);
  });

  it('signCommand adds id ts sig', () => {
    const fields = { action: 'start', folder: vector.cmd.folder, mode: vector.cmd.mode };
    const cmd = signCommand(fields, vector.secret, vector.cmd.ts * 1000 + 999);
    expect(cmd.id).toMatch(/^[0-9a-f]{32}$/);
    expect(cmd.ts).toBe(vector.cmd.ts);
    const { sig, ...rest } = cmd;
    expect(sig).toBe(createHmac('sha256', vector.secret).update(canonical(rest)).digest('hex'));
  });

  it('ignores sig and key order in canonical form', () => {
    const shuffled = { mode: vector.cmd.mode, ts: vector.cmd.ts, sig: 'x', ...vector.cmd };
    expect(canonical(shuffled)).toBe(vector.canonical);
  });
});
