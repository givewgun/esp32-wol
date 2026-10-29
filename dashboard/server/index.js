import { fileURLToPath } from 'node:url';
import { createAccessVerifier } from './access.js';
import { createApp } from './app.js';
import { connectBroker } from './broker.js';
import { loadConfig } from './config.js';
import { createState } from './state.js';

const config = loadConfig(process.env);
const state = createState();
const broker = connectBroker(config, state);
const app = createApp({
  state,
  broker,
  verify: createAccessVerifier(config.access),
  staticDir: fileURLToPath(new URL('../dist', import.meta.url)),
});

app.listen(config.port, () => console.log(`pc-dash listening on ${config.port}`));
