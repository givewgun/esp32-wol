import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isStale } from '../web/src/api.js';
import NewSession from '../web/src/components/NewSession.jsx';
import SessionsCard from '../web/src/components/SessionsCard.jsx';
import StatsCard from '../web/src/components/StatsCard.jsx';

afterEach(cleanup);

const f = (name, trusted = true, git = false) => ({ name, trusted, git });

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
    render(<NewSession folders={[f('horizon')]} sessions={[]} online onStart={vi.fn()} />);
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
    render(<NewSession folders={[f('blink'), f('horizon')]} sessions={[]} online onStart={onStart} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'horizon' } });
    fireEvent.click(screen.getByRole('radio', { name: /plan/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(onStart).toHaveBeenCalledWith('horizon', 'plan');
  });

  it('start disabled when pc offline', () => {
    render(<NewSession folders={[f('horizon')]} sessions={[]} online={false} onStart={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Start' }).disabled).toBe(true);
  });

  it('folders with a running server are not selectable', () => {
    render(<NewSession folders={[f('blink'), f('horizon')]} sessions={[{ pid: 1, folder: 'blink' }]} online onStart={vi.fn()} />);
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
        <NewSession folders={[f(evil)]} sessions={[]} online onStart={vi.fn()} />
        <SessionsCard sessions={[{ pid: 5, folder: evil, name: evil, mode: null, started: 1 }]} onStop={vi.fn()} />
      </>,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getAllByText(evil, { exact: false }).length).toBeGreaterThan(0);
  });
});

describe('trust and new folder', () => {
  it('untrusted folder: start disabled, trust needs two taps', () => {
    const onTrust = vi.fn();
    render(<NewSession folders={[f('fresh', false, true)]} sessions={[]} online onStart={vi.fn()} onTrust={onTrust} />);
    expect(screen.getByRole('option', { name: /fresh.*untrusted/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start' }).disabled).toBe(true);
    expect(screen.getByText(/hooks, MCP servers/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Trust folder' }));
    expect(onTrust).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Tap again to confirm' }));
    expect(onTrust).toHaveBeenCalledWith('fresh');
  });

  it('trusted folder shows no trust button', () => {
    render(<NewSession folders={[f('horizon')]} sessions={[]} online onStart={vi.fn()} onTrust={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Trust folder' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Start' }).disabled).toBe(false);
  });

  it('create sends name and git flag, then selects the new folder', async () => {
    const onCreate = vi.fn(async () => ({ ok: true }));
    const props = { sessions: [], online: true, onStart: vi.fn(), onTrust: vi.fn(), onCreate };
    const { rerender } = render(<NewSession folders={[f('horizon')]} {...props} />);
    fireEvent.change(screen.getByLabelText('New folder name'), { target: { value: 'new-app' } });
    expect(screen.getByRole('checkbox', { name: /git init/ }).checked).toBe(true);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Create' })));
    expect(onCreate).toHaveBeenCalledWith('new-app', true);
    rerender(<NewSession folders={[f('horizon'), f('new-app', true, true)]} {...props} />);
    expect(screen.getByRole('combobox').value).toBe('new-app');
  });

  it('create without git', async () => {
    const onCreate = vi.fn(async () => ({ ok: true }));
    render(<NewSession folders={[]} sessions={[]} online onStart={vi.fn()} onTrust={vi.fn()} onCreate={onCreate} />);
    fireEvent.change(screen.getByLabelText('New folder name'), { target: { value: 'plain' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /git init/ }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Create' })));
    expect(onCreate).toHaveBeenCalledWith('plain', false);
  });

  it('create disabled for bad or existing names', () => {
    render(<NewSession folders={[f('horizon')]} sessions={[]} online onStart={vi.fn()} onTrust={vi.fn()} onCreate={vi.fn()} />);
    const input = screen.getByLabelText('New folder name');
    for (const name of ['', 'a b', '-x', 'con', 'HORIZON', 'a/b', 'café']) {
      fireEvent.change(input, { target: { value: name } });
      expect(screen.getByRole('button', { name: 'Create' }).disabled, name).toBe(true);
    }
    fireEvent.change(input, { target: { value: 'ok-name' } });
    expect(screen.getByRole('button', { name: 'Create' }).disabled).toBe(false);
  });
});

describe('useSnapshot', () => {
  it('reopens the stream with backoff after it closes', async () => {
    vi.useFakeTimers();
    const instances = [];
    class FakeES {
      static CLOSED = 2;
      constructor() {
        this.readyState = 0;
        instances.push(this);
      }
      close() {
        this.readyState = 2;
      }
    }
    vi.stubGlobal('EventSource', FakeES);
    const { renderHook, act } = await import('@testing-library/react');
    const { useSnapshot } = await import('../web/src/api.js');
    const { result } = renderHook(() => useSnapshot());
    act(() => {
      instances[0].readyState = 2;
      instances[0].onerror();
    });
    expect(result.current.lost).toBe(true);
    act(() => vi.advanceTimersByTime(2000));
    expect(instances.length).toBe(2);
    act(() => instances[1].onmessage({ data: '{"pc":"online"}' }));
    expect(result.current).toEqual({ snap: { pc: 'online' }, lost: false });
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
});
