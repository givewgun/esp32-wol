// HMAC-SHA256 command signing; must stay byte-identical to pc/pcagent/signing.py
// (test/fixtures/cmd-vector.json pins both). Values are flat strings/integers only.
import { createHmac, randomBytes } from 'node:crypto';

export function canonical(cmd) {
  const sorted = {};
  for (const key of Object.keys(cmd).sort()) {
    if (key !== 'sig') sorted[key] = cmd[key];
  }
  return JSON.stringify(sorted);
}

export function signCommand(fields, secret, now = Date.now()) {
  const cmd = { ...fields, id: randomBytes(16).toString('hex'), ts: Math.floor(now / 1000) };
  return { ...cmd, sig: createHmac('sha256', secret).update(canonical(cmd), 'utf8').digest('hex') };
}
