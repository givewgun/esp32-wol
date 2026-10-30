const REQUIRED = [
  'MQTT_URI',
  'MQTT_USER',
  'MQTT_PASS',
  'CF_ACCESS_TEAM_DOMAIN',
  'CF_ACCESS_AUD',
  'ALLOWED_EMAIL',
  'PC_CMD_SECRET',
];

// Every value is required: a dashboard that can start Claude sessions must not boot half-configured.
export function loadConfig(env) {
  for (const name of REQUIRED) {
    if (!env[name]?.trim()) throw new Error(`missing env: ${name}`);
  }
  return {
    port: Number(env.PORT || 8080),
    mqtt: { uri: env.MQTT_URI, user: env.MQTT_USER, pass: env.MQTT_PASS },
    access: {
      teamDomain: env.CF_ACCESS_TEAM_DOMAIN,
      aud: env.CF_ACCESS_AUD,
      allowedEmail: env.ALLOWED_EMAIL.trim().toLowerCase(),
    },
    cmdSecret: env.PC_CMD_SECRET,
  };
}
