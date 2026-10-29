import { EventEmitter } from 'node:events';

// Latest value of every topic the dashboard shows. JSON payloads are stored as the PC sent them.
const TOPICS = {
  'wol/desktop/status': { key: 'esp', parse: (s) => s },
  'wol/desktop/pc': { key: 'pc', parse: (s) => s },
  'wol/desktop/pc/stats': { key: 'stats', parse: (s) => object(JSON.parse(s)) },
  'wol/desktop/pc/folders': { key: 'folders', parse: (s) => array(JSON.parse(s)) },
  'wol/desktop/pc/sessions': { key: 'sessions', parse: (s) => object(JSON.parse(s)) },
};

function object(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new TypeError('not an object');
  return v;
}

function array(v) {
  if (!Array.isArray(v)) throw new TypeError('not an array');
  return v;
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
    folderList: () => data.folders,
    on: (event, fn) => emitter.on(event, fn),
    off: (event, fn) => emitter.off(event, fn),
  };
}
