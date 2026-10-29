import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isStale } from '../web/src/api.js';
import NewSession from '../web/src/components/NewSession.jsx';
import SessionsCard from '../web/src/components/SessionsCard.jsx';
import StatsCard from '../web/src/components/StatsCard.jsx';

afterEach(cleanup);

const NOW = 1_767_000_000_000;
const stats = (ts) => ({
  ts,
  host: 'Gunizuka',
  uptime_s: 3600,
  cpu_pct: 12.5,
  ram: { used: 8e9, total: 32e9 },
  gpu: { name: 'RTX', util_pct: 3, vram_used_mb: 1000, vram_total_mb: 16000, temp_c: 36 },
  disks: [{ mount: 'C:\\', free: 3e10, total: 1e12 }],
});

describe('web', () => {
  it('new session preselects bypassPermissions', () => {
    render(<NewSession folders={['horizon']} sessions={[]} online onStart={vi.fn()} />);
    expect(screen.getByRole('radio', { name: /bypassPermissions/ }).checked).toBe(true);
    expect(screen.getAllByRole('radio').map((r) => r.value)).toEqual([
      'bypassPermissions',
      'acceptEdits',
      'auto',
      'default',
      'dontAsk',
      'plan',
    ]);
  });

  it('start sends chosen folder and mode', () => {
    const onStart = vi.fn();
    render(<NewSession folders={['blink', 'horizon']} sessions={[]} online onStart={onStart} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'horizon' } });
    fireEvent.click(screen.getByRole('radio', { name: /plan/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(onStart).toHaveBeenCalledWith('horizon', 'plan');
  });

  it('start disabled when pc offline', () => {
    render(<NewSession folders={['horizon']} sessions={[]} online={false} onStart={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Start' }).disabled).toBe(true);
  });

  it('folders with a running server are not selectable', () => {
    render(<NewSession folders={['blink', 'horizon']} sessions={[{ pid: 1, folder: 'blink' }]} online onStart={vi.fn()} />);
    expect(screen.getByRole('option', { name: /blink/ }).disabled).toBe(true);
  });

  it('stop needs two taps', () => {
    const onStop = vi.fn();
    render(<SessionsCard sessions={[{ pid: 77, folder: 'blink', name: 'blink', mode: 'plan', started: 1 }]} onStop={onStop} />);
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(onStop).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Tap again to confirm' }));
    expect(onStop).toHaveBeenCalledWith(77);
  });

  it('marks stats stale when ts older than 30s', () => {
    expect(isStale(stats(NOW / 1000 - 31), 'online', NOW)).toBe(true);
    expect(isStale(stats(NOW / 1000 - 5), 'online', NOW)).toBe(false);
    expect(isStale(stats(NOW / 1000 - 5), 'offline', NOW)).toBe(true);
    expect(isStale(null, 'online', NOW)).toBe(true);
    render(<StatsCard stats={stats(NOW / 1000 - 31)} pc="online" now={NOW} />);
    expect(screen.getByText(/last seen/i)).toBeTruthy();
  });

  it('renders folder names as text', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const { container } = render(
      <>
        <NewSession folders={[evil]} sessions={[]} online onStart={vi.fn()} />
        <SessionsCard sessions={[{ pid: 5, folder: evil, name: evil, mode: null, started: 1 }]} onStop={vi.fn()} />
      </>,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getAllByText(evil, { exact: false }).length).toBeGreaterThan(0);
  });
});
