import { useEffect, useState } from 'react';

const STALE_S = 30;

export function isStale(stats, pcStatus, nowMs) {
  return pcStatus !== 'online' || !stats || nowMs / 1000 - stats.ts > STALE_S;
}

// Live snapshot over SSE. EventSource reconnects by itself after network drops; if the stream is closed for good
// (e.g. the Cloudflare Access session expired) `lost` turns true and the page offers a reload to sign in again.
export function useSnapshot() {
  const [snap, setSnap] = useState(null);
  const [lost, setLost] = useState(false);
  useEffect(() => {
    const es = new EventSource('/api/events');
    es.onmessage = (e) => {
      setSnap(JSON.parse(e.data));
      setLost(false);
    };
    es.onerror = () => setLost(es.readyState === EventSource.CLOSED);
    return () => es.close();
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
