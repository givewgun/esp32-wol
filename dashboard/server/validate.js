// Same lists the PC agent enforces (pc/pcagent/commands.py); checked here too so bad input never reaches MQTT.
export const MODES = ['bypassPermissions', 'acceptEdits', 'auto', 'default', 'dontAsk', 'plan'];
export const POWER = ['wake', 'sleep', 'hibernate', 'shutdown'];

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

export function validatePid(raw, sessions) {
  if (!/^[1-9][0-9]{0,9}$/.test(raw)) throw new ValidationError('bad pid');
  const pid = Number(raw);
  if (!sessions.some((s) => s.pid === pid)) throw new ValidationError('not a claude session');
  return pid;
}
