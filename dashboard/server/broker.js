import { randomBytes } from 'node:crypto';
import mqtt from 'mqtt';
import { signCommand } from './sign.js';

const SUBSCRIBE = [
  'wol/desktop/status',
  'wol/desktop/pc',
  'wol/desktop/pc/stats',
  'wol/desktop/pc/folders',
  'wol/desktop/pc/sessions',
  'wol/desktop/pc/reply',
];
const REPLY_TIMEOUT_MS = 10_000;

function defaultConnect({ uri, user, pass }) {
  return mqtt.connect(uri, {
    username: user,
    password: pass,
    clientId: `pc-dash-${randomBytes(4).toString('hex')}`,
    clean: true,
    reconnectPeriod: 5000,
  });
}

// The dashboard's single MQTT connection: mirrors retained state into `state`, publishes power payloads, and sends
// signed commands to the PC agent, matching replies by id.
export function connectBroker(config, state, { connect = defaultConnect } = {}) {
  const client = connect(config.mqtt);
  const pending = new Map();

  client.on('connect', () => client.subscribe(SUBSCRIBE, { qos: 1 }));
  client.on('error', (err) => console.error('mqtt error:', err.message));
  client.on('message', (topic, payload) => {
    const text = payload.toString('utf8');
    if (topic !== 'wol/desktop/pc/reply') return state.apply(topic, text);
    let reply;
    try {
      reply = JSON.parse(text);
    } catch {
      return;
    }
    const waiter = pending.get(reply?.id);
    if (waiter) waiter(reply);
  });

  return {
    connected: () => Boolean(client.connected),
    publishPower(action) {
      client.publish('wol/desktop', action, { qos: 1, retain: false });
    },
    sendCommand(fields) {
      const cmd = signCommand(fields, config.cmdSecret);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(cmd.id);
          const err = new Error('no reply from PC');
          err.name = 'TimeoutError';
          reject(err);
        }, REPLY_TIMEOUT_MS);
        pending.set(cmd.id, (reply) => {
          clearTimeout(timer);
          pending.delete(cmd.id);
          resolve(reply);
        });
        client.publish('wol/desktop/pc/cmd', JSON.stringify(cmd), { qos: 1, retain: false });
      });
    },
  };
}
