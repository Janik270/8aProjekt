import { openDatabase, projectRoot } from './database.js';
import { createApp } from './app.js';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnvFile } from 'node:process';

const envFile = join(projectRoot, '.env');
if (existsSync(envFile)) loadEnvFile(envFile);

const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || '127.0.0.1';
const db = openDatabase();
const app = createApp(db);
const server = createServer(app);
const closeCollaboration = app.locals.collaboration.attach(server);
server.listen(port, host, () => {
  console.log(`8a Projekt läuft unter http://${host}:${port}`);
});
server.on('error', (error) => {
  console.error(`Server konnte nicht starten: ${error.message}`);
  db.close();
  process.exitCode = 1;
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    closeCollaboration();
    server.close(() => {
      db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000).unref();
  });
}
