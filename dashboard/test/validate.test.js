import { describe, expect, it } from 'vitest';
import { MODES, ValidationError, validatePid, validatePower, validateStart } from '../server/validate.js';

const folders = ['blink', 'horizon', 'local-llm-server;C'];
const sessions = [{ pid: 77, folder: 'blink' }];

describe('validate', () => {
  it('lists modes with bypassPermissions first', () => {
    expect(MODES).toEqual(['bypassPermissions', 'acceptEdits', 'auto', 'default', 'dontAsk', 'plan']);
  });

  it('accepts power actions only', () => {
    expect(validatePower({ action: 'sleep' })).toBe('sleep');
    for (const action of ['reboot', '', undefined, ['wake']]) {
      expect(() => validatePower({ action })).toThrow(ValidationError);
    }
  });

  it('accepts listed folders and known modes', () => {
    expect(validateStart({ folder: 'local-llm-server;C', mode: 'plan' }, folders)).toEqual({
      folder: 'local-llm-server;C',
      mode: 'plan',
    });
  });

  it('rejects folders not in the list', () => {
    for (const folder of ['..', 'C:\\Windows', 'horizon\\..', 'Horizon', 42, null, ['horizon']]) {
      expect(() => validateStart({ folder, mode: 'plan' }, folders)).toThrow(ValidationError);
    }
  });

  it('rejects unknown modes', () => {
    expect(() => validateStart({ folder: 'blink', mode: 'rm' }, folders)).toThrow(ValidationError);
    expect(() => validateStart({ folder: 'blink', mode: 'toString' }, folders)).toThrow(ValidationError);
  });

  it('accepts pids of listed sessions only', () => {
    expect(validatePid('77', sessions)).toBe(77);
    for (const raw of ['12abc', '-1', '4', '', '77.0', '0x4d']) {
      expect(() => validatePid(raw, sessions)).toThrow(ValidationError);
    }
  });

  it('validation errors carry status 400', () => {
    expect(new ValidationError('x').status).toBe(400);
  });
});
