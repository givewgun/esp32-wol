import { describe, expect, it } from 'vitest';
import { loadConfig } from '../server/config.js';

const env = {
  MQTT_URI: 'mqtts://broker.example:8883',
  MQTT_USER: 'u',
  MQTT_PASS: 'p',
  CF_ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com',
  CF_ACCESS_AUD: 'aud',
  ALLOWED_EMAIL: 'Owner@Example.com ',
  PC_CMD_SECRET: 'k',
};

describe('config', () => {
  it('loads env with defaults', () => {
    expect(loadConfig(env)).toEqual({
      port: 8080,
      mqtt: { uri: env.MQTT_URI, user: 'u', pass: 'p' },
      access: { teamDomain: env.CF_ACCESS_TEAM_DOMAIN, aud: 'aud', allowedEmail: 'owner@example.com' },
      cmdSecret: 'k',
    });
    expect(loadConfig({ ...env, PORT: '9000' }).port).toBe(9000);
  });

  it('fails closed on any missing value', () => {
    for (const key of Object.keys(env)) {
      expect(() => loadConfig({ ...env, [key]: '' })).toThrow(`missing env: ${key}`);
    }
  });
});
