import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const wf = readFileSync(new URL('../../.github/workflows/dashboard.yml', import.meta.url), 'utf8');

describe('deploy workflow', () => {
  it('single-quotes .env values so compose does not interpolate $ or strip " #"', () => {
    const env = wf.slice(wf.indexOf("tee dashboard/.env"), wf.indexOf('chmod 600 dashboard/.env'));
    const lines = env.split('\n').map((l) => l.trim()).filter((l) => /^[A-Z_]+=/.test(l));
    expect(lines.length).toBeGreaterThan(8);
    for (const line of lines) expect(line, line).toMatch(/^[A-Z_]+='.*'$/);
  });

  it('only cancels superseded runs for pull requests, never a main deploy mid-flight', () => {
    const top = wf.slice(wf.indexOf('\nconcurrency:'), wf.indexOf('\njobs:'));
    expect(top).toContain("cancel-in-progress: ${{ github.event_name == 'pull_request' }}");
  });
});
