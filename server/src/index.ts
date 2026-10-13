import { resolve } from 'node:path';
import { createChatServer } from './app';

const port = Number(process.env.PORT || 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
const host = process.env.HOST || '127.0.0.1';
const chat = createChatServer({
  databasePath: process.env.DATABASE_PATH || resolve(__dirname, '..', 'data', 'messageme.sqlite'),
  staticDirectory: resolve(__dirname, '..', '..', 'client', 'dist'),
  allowedOrigins: (process.env.APP_ORIGINS || 'http://localhost:5173,http://localhost:3001').split(',').map((s) => s.trim()),
  secureCookies: process.env.COOKIE_SECURE === 'true',
});
chat.server.listen(port, host, () => console.log(`MessageMe server: http://${host}:${port}`));
chat.server.on('error', (error: Error) => {
  console.error('Unable to start MessageMe server:', error);
  process.exitCode = 1;
  chat.close().catch((closeError: unknown) => console.error('Shutdown failed:', closeError));
});
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    try { await chat.close(); }
    catch (error) { console.error('Shutdown failed:', error); process.exitCode = 1; }
  });
}
