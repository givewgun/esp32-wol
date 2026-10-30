import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const wf = readFileSync(new URL('../../.github/workflows/dashboard.yml', import.meta.url), 'utf8');

describe('deploy workflow', () => {
  it('only cancels superseded runs for pull requests, never a main deploy mid-flight', () => {
    const top = wf.slice(wf.indexOf('\nconcurrency:'), wf.indexOf('\njobs:'));
    expect(top).toContain("cancel-in-progress: ${{ github.event_name == 'pull_request' }}");
  });
});
