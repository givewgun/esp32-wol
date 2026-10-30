import { useEffect, useState } from 'react';

const STALE_S = 30;

export function isStale(stats, pcStatus, nowMs) {
  return pcStatus !== 'online' || !stats || nowMs / 1000 - stats.ts > STALE_S;
}

// Live snapshot over SSE. EventSource retries plain network drops itself, but closes for good on an HTTP error
// (a 502 during a deploy, or 401 once the Access session expires). Then `lost` turns true, the page offers a reload
// (to sign in again), and we reopen the stream ourselves with backoff (2 s doubling to 30 s).
export function useSnapshot() {
  const [snap, setSnap] = useState(null);
  const [lost, setLost] = useState(false);
  useEffect(() => {
    let es;
    let timer;
    let delay = 2000;
    const open = () => {
      es = new EventSource('/api/events');
      es.onmessage = (e) => {
        setSnap(JSON.parse(e.data));
        setLost(false);
        delay = 2000;
      };
      es.onerror = () => {
        if (es.readyState !== EventSource.CLOSED) return;
        setLost(true);
        timer = setTimeout(open, delay);
        delay = Math.min(delay * 2, 30_000);
      };
    };
    open();
    return () => {
      clearTimeout(timer);
      es.close();
    };
  }, []);
  return { snap, lost };
}

export function useNow(everyMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

export async function post(path, body = {}) {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return res.ok ? { ok: true, ...data } : { ok: false, error: data.error ?? `HTTP ${res.status}` };
  } catch {
    return { ok: false, error: 'network error' };
  }
}
