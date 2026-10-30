import { EventEmitter } from 'node:events';

// Latest value of every topic the dashboard shows. Anyone with the shared broker login can publish these, so each
// payload must have the exact shape the UI renders; anything else is dropped and the last good value kept.
const TOPICS = {
  'wol/desktop/status': { key: 'esp', parse: status },
  'wol/desktop/pc': { key: 'pc', parse: status },
  'wol/desktop/pc/stats': { key: 'stats', parse: (s) => check(JSON.parse(s), isStats) },
  'wol/desktop/pc/folders': { key: 'folders', parse: (s) => check(JSON.parse(s), isFolders) },
  'wol/desktop/pc/sessions': { key: 'sessions', parse: (s) => check(JSON.parse(s), isSessions) },
};

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const str = (v) => typeof v === 'string';
const obj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const strOrNull = (v) => v === null || str(v);

function status(s) {
  if (s !== 'online' && s !== 'offline') throw new TypeError('bad status');
  return s;
}

function check(v, valid) {
  if (!valid(v)) throw new TypeError('bad shape');
  return v;
}

function isStats(v) {
  const gpuOk =
    v?.gpu === null ||
    (obj(v?.gpu) && str(v.gpu.name) && ['util_pct', 'vram_used_mb', 'vram_total_mb', 'temp_c'].every((k) => num(v.gpu[k])));
  return (
    obj(v) && num(v.ts) && num(v.cpu_pct) && num(v.uptime_s) && str(v.host) &&
    obj(v.ram) && num(v.ram.used) && num(v.ram.total) && gpuOk &&
    Array.isArray(v.disks) && v.disks.every((d) => obj(d) && str(d.mount) && num(d.free) && num(d.total))
  );
}

function isFolders(v) {
  return Array.isArray(v) && v.every((f) => obj(f) && str(f.name) && typeof f.trusted === 'boolean' && typeof f.git === 'boolean');
}

function isSessions(v) {
  return (
    obj(v) && num(v.ts) && Array.isArray(v.sessions) &&
    v.sessions.every((s) => obj(s) && Number.isInteger(s.pid) && str(s.folder) && strOrNull(s.name ?? null) &&
      strOrNull(s.mode ?? null) && num(s.started ?? 0))
  );
}

export function createState() {
  const emitter = new EventEmitter();
  const data = { esp: null, pc: null, stats: null, folders: [], sessions: null };

  return {
    apply(topic, payload) {
      const t = TOPICS[topic];
      if (!t) return;
      try {
        data[t.key] = t.parse(payload);
      } catch {
        return; // keep the last good value
      }
      emitter.emit('change', this.snapshot());
    },
    snapshot: () => structuredClone(data),
    sessionList: () => (Array.isArray(data.sessions?.sessions) ? data.sessions.sessions : []),
    folderList: () => data.folders.map((f) => f.name),
    isTrusted: (name) => data.folders.some((f) => f.name === name && f.trusted),
    on: (event, fn) => emitter.on(event, fn),
    off: (event, fn) => emitter.off(event, fn),
  };
}
