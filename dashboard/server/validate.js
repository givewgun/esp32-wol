// Same lists the PC agent enforces (pc/pcagent/commands.py); checked here too so bad input never reaches MQTT.
export const MODES = ['bypassPermissions', 'acceptEdits', 'auto', 'default', 'dontAsk', 'plan'];
export const POWER = ['wake', 'sleep', 'hibernate', 'shutdown'];
// Same rule as pc/pcagent/folders.py valid_new_name
const NEW_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const RESERVED = new Set(['con', 'prn', 'aux', 'nul', ...[1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap((i) => [`com${i}`, `lpt${i}`])]);

export class ValidationError extends Error {
  status = 400;
}

export function validatePower(body) {
  if (!POWER.includes(body?.action)) throw new ValidationError('unknown power action');
  return body.action;
}

export function validateStart(body, folders) {
  const { folder, mode } = body ?? {};
  if (typeof folder !== 'string' || !folders.includes(folder)) throw new ValidationError('unknown folder');
  if (!MODES.includes(mode)) throw new ValidationError('bad mode');
  return { folder, mode };
}

export function validateTrust(body, folders) {
  const folder = body?.folder;
  if (typeof folder !== 'string' || !folders.includes(folder)) throw new ValidationError('unknown folder');
  return { folder };
}

// Also used by the web UI (no Node APIs in this file)
export function isValidNewName(name) {
  return (
    typeof name === 'string' &&
    NEW_NAME.test(name) &&
    !name.endsWith('.') &&
    !RESERVED.has(name.split('.')[0].toLowerCase())
  );
}

export function validateCreate(body, folders) {
  const { folder, git } = body ?? {};
  if (!isValidNewName(folder)) throw new ValidationError('bad folder name');
  if (folders.some((f) => f.toLowerCase() === folder.toLowerCase())) throw new ValidationError('folder exists');
  if (typeof git !== 'boolean') throw new ValidationError('bad git flag');
  return { folder, init: git ? 'git' : 'none' };
}

export function validatePid(raw, sessions) {
  if (!/^[1-9][0-9]{0,9}$/.test(raw)) throw new ValidationError('bad pid');
  const pid = Number(raw);
  if (!sessions.some((s) => s.pid === pid)) throw new ValidationError('not a claude session');
  return pid;
}
