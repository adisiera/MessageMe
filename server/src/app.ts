import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { openDatabase } from './database';
import {
  hashPassword, verifyPassword, getSession, sessionCookie, createSession, publicUser,
  type SessionUser,
} from './auth';
import type { Request, Response, NextFunction } from 'express';
import type { WebSocket as WebSocketType, RawData } from 'ws';

declare global {
  namespace Express {
    interface Request {
      session: SessionUser;
    }
  }
}

interface ChatSocket extends WebSocketType {
  sessionHash: string;
  isAlive: boolean;
}

interface Logger {
  error(message: string, error: unknown): void;
}

interface ChatServerOptions {
  databasePath?: string;
  allowedOrigins?: string[];
  staticDirectory?: string;
  secureCookies?: boolean;
  logger?: Logger;
}

interface ConversationRow {
  id: string;
  name: string | null;
  createdAt: string;
}

interface MessageRow {
  id: number;
  conversationId: string;
  senderId: string;
  clientId: string;
  text: string;
  createdAt: string;
}

class RequestError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function requireText(value: unknown, label: string, min: number, max: number) {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max) {
    throw new RequestError(400, `${label} must contain ${min}-${max} characters.`);
  }
  return value.trim();
}

function createChatServer({
  databasePath = ':memory:',
  allowedOrigins = ['http://localhost:5173', 'http://localhost:3001'],
  staticDirectory,
  secureCookies = false,
  logger = console,
}: ChatServerOptions = {}) {
  const db = openDatabase(databasePath);
  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  const clients = new Map<string, Set<ChatSocket>>();
  const origins = new Set(allowedOrigins);
  const allowedOrigin = (origin: string | undefined) => typeof origin === 'string' && origins.has(origin);
  const memberIds = (id: string) => (db.prepare('SELECT user_id FROM members WHERE conversation_id = ?')
    .all(id) as unknown as { user_id: string }[]).map((row) => row.user_id);
  const isMember = (id: string, userId: string) => !!db.prepare(
    'SELECT 1 FROM members WHERE conversation_id = ? AND user_id = ?',
  ).get(id, userId);

  function assertMember(id: unknown, userId: string): asserts id is string {
    if (typeof id !== 'string' || !isMember(id, userId)) {
      throw new RequestError(404, 'Conversation not found.');
    }
  }

  function send(socket: WebSocketType, data: object) {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data));
  }

  function publish(userIds: string[], data: object) {
    for (const userId of userIds) {
      for (const socket of clients.get(userId) || []) send(socket, data);
    }
  }

  function onlineIds(userId: string) {
    const peers = (db.prepare(`
      SELECT DISTINCT b.user_id FROM members a JOIN members b
      ON a.conversation_id = b.conversation_id WHERE a.user_id = ?
    `).all(userId) as unknown as { user_id: string }[]).map((row) => row.user_id);
    return peers.filter((id) => clients.has(id));
  }

  function publishPresence(userId: string, online: boolean) {
    const peers = (db.prepare(`
      SELECT DISTINCT b.user_id FROM members a JOIN members b
      ON a.conversation_id = b.conversation_id WHERE a.user_id = ?
    `).all(userId) as unknown as { user_id: string }[]).map((row) => row.user_id);
    publish(peers, { type: 'presence', userId, online });
  }

  function conversation(id: string, userId: string) {
    const row = db.prepare('SELECT id, name, created_at AS createdAt FROM conversations WHERE id = ?')
      .get(id) as unknown as ConversationRow;
    const members = db.prepare(`
      SELECT users.id, users.name, members.last_read_id AS lastReadId
      FROM members JOIN users ON users.id = members.user_id WHERE conversation_id = ?
      ORDER BY users.name
    `).all(id) as unknown as { id: string; name: string; lastReadId: number }[];
    const lastMessage = (db.prepare(`
      SELECT id, sender_id AS senderId, text, created_at AS createdAt
      FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1
    `).get(id) as unknown as Omit<MessageRow, 'conversationId' | 'clientId'> | undefined) || null;
    const unreadCount = (db.prepare(`
      SELECT COUNT(*) AS count FROM messages
      WHERE conversation_id = ? AND sender_id != ? AND id >
      (SELECT last_read_id FROM members WHERE conversation_id = ? AND user_id = ?)
    `).get(id, userId, id, userId) as unknown as { count: number }).count;
    return { ...row, members, lastMessage, unreadCount };
  }

  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: {
    directives: {
      'script-src': ["'self'"],
      'connect-src': ["'self'", 'ws://localhost:3001', 'ws://localhost:5173'],
      'style-src': ["'self'", "'unsafe-inline'"],
      'img-src': ["'self'", 'data:'],
    },
  } }));
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Too many requests. Please try again shortly.' } }));
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !allowedOrigin(req.headers.origin)) {
      return res.status(403).json({ error: 'Request origin is not allowed.' });
    }
    next();
  });
  app.use(express.json({ limit: '16kb' }));
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  const authLimiter = rateLimit({
    windowMs: 15 * 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Too many sign-in attempts. Try again in 15 minutes.' },
  });

  function credentials(body: unknown) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new RequestError(400, 'Provide account credentials.');
    const values = body as Record<string, unknown>;
    const email = requireText(values.email, 'Email', 3, 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new RequestError(400, 'Enter a valid email address.');
    const password = requireText(values.password, 'Password', 12, 128);
    // Passwords are validated but never normalized.
    return { email, password };
  }

  app.post('/api/auth/register', authLimiter, async (req, res) => {
    const { email, password } = credentials(req.body);
    const name = requireText(req.body.name, 'Display name', 1, 50);
    const passwordHash = await hashPassword(password);
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
      throw new RequestError(409, 'An account with this email already exists.');
    }
    const user = { id: randomUUID(), name, email };
    db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?)').run(
      user.id, email, name, passwordHash, new Date().toISOString(),
    );
    createSession(db, user.id, res, secureCookies);
    res.status(201).json({ user });
  });

  app.post('/api/auth/login', authLimiter, async (req, res) => {
    const { email, password } = credentials(req.body);
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    const valid = await verifyPassword(password, user?.password_hash || dummyPasswordHash);
    if (!user || !valid) throw new RequestError(401, 'Email or password is incorrect.');
    createSession(db, user.id, res, secureCookies);
    res.json({ user: publicUser(user) });
  });

  const dummyPasswordHash = `${'0'.repeat(32)}:${'0'.repeat(128)}`;
  app.use('/api', (req, res, next) => {
    const session = getSession(db, req);
    if (!session) return res.status(401).json({ error: 'Please sign in to continue.' });
    req.session = session;
    next();
  });
  app.get('/api/auth/me', (req, res) => res.json({ user: publicUser(req.session) }));
  app.post('/api/auth/logout', (req, res) => {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(req.session.token_hash);
    for (const socket of clients.get(req.session.id) || []) {
      if (socket.sessionHash === req.session.token_hash) socket.close(4001, 'Signed out');
    }
    res.setHeader('Set-Cookie', sessionCookie('', secureCookies, 0));
    res.status(204).end();
  });
  app.get('/api/users', (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 50) : '';
    const users = db.prepare(`
      SELECT id, name FROM users WHERE id != ? AND instr(lower(name), lower(?)) > 0
      ORDER BY name LIMIT 50
    `).all(req.session.id, query);
    res.json({ users });
  });
  app.get('/api/conversations', (req, res) => {
    const ids = db.prepare('SELECT conversation_id FROM members WHERE user_id = ?')
      .all(req.session.id) as unknown as { conversation_id: string }[];
    res.json({
      conversations: ids.map(({ conversation_id: id }) => conversation(id, req.session.id))
        .sort((a, b) => (b.lastMessage?.id || 0) - (a.lastMessage?.id || 0)),
      onlineUserIds: onlineIds(req.session.id),
    });
  });
  app.post('/api/conversations', (req, res) => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      throw new RequestError(400, 'Provide conversation members.');
    }
    const { memberIds: requested, name } = req.body;
    if (!Array.isArray(requested) || requested.length < 1 || requested.length > 49 ||
      requested.some((id) => typeof id !== 'string' || id === req.session.id) ||
      new Set(requested).size !== requested.length) {
      throw new RequestError(400, 'Choose 1-49 distinct other members.');
    }
    for (const id of requested) {
      if (!db.prepare('SELECT id FROM users WHERE id = ?').get(id)) {
        throw new RequestError(400, 'One or more members do not exist.');
      }
    }
    const groupName = requested.length > 1 ? requireText(name, 'Group name', 1, 60) : null;
    const ids = [req.session.id, ...requested].sort();
    const directKey = ids.length === 2 ? JSON.stringify(ids) : null;
    const existing = directKey && db.prepare('SELECT id FROM conversations WHERE direct_key = ?').get(directKey);
    if (existing) return res.json({ conversation: conversation(existing.id, req.session.id) });
    const id = randomUUID();
    db.exec('BEGIN');
    try {
      db.prepare('INSERT INTO conversations VALUES (?, ?, ?, ?)').run(id, groupName, directKey, new Date().toISOString());
      const insertMember = db.prepare('INSERT INTO members (conversation_id, user_id) VALUES (?, ?)');
      ids.forEach((userId) => insertMember.run(id, userId));
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    for (const userId of ids) {
      publish([userId], { type: 'conversation', conversation: conversation(id, userId), onlineUserIds: onlineIds(userId) });
    }
    res.status(201).json({ conversation: conversation(id, req.session.id) });
  });
  app.get('/api/conversations/:id/messages', (req, res) => {
    assertMember(req.params.id, req.session.id);
    const before = req.query.before === undefined ? Number.MAX_SAFE_INTEGER : Number(req.query.before);
    if (!Number.isSafeInteger(before) || before < 1) throw new RequestError(400, 'Invalid message cursor.');
    const rows = db.prepare(`
      SELECT id, conversation_id AS conversationId, sender_id AS senderId,
             client_id AS clientId, text, created_at AS createdAt
      FROM messages WHERE conversation_id = ? AND id < ? ORDER BY id DESC LIMIT 51
    `).all(req.params.id, before);
    const hasMore = rows.length > 50;
    res.json({ messages: rows.slice(0, 50).reverse(), hasMore });
  });

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
  if (staticDirectory && existsSync(join(staticDirectory, 'index.html'))) {
    app.use(express.static(staticDirectory, { index: false }));
    app.get('/{*path}', (_req, res) => res.sendFile(join(staticDirectory, 'index.html')));
  } else {
    app.get('/', (_req, res) => res.status(503).send('Frontend not built. Run npm run build, or use npm run dev.'));
  }
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof RequestError) return res.status(error.status).json({ error: error.message });
    if (error instanceof Error && 'type' in error && error.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Invalid JSON body.' });
    }
    if (error instanceof Error && 'type' in error && error.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Request body is too large.' });
    }
    logger.error('HTTP request failed', error);
    res.status(500).json({ error: 'An unexpected server error occurred.' });
  });

  server.on('upgrade', (req, socket, head) => {
    const session = getSession(db, req);
    if (req.url !== '/ws' || !allowedOrigin(req.headers.origin) || !session) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws as ChatSocket, session));
  });

  wss.on('connection', (socket: ChatSocket, session: SessionUser) => {
    socket.sessionHash = session.token_hash;
    socket.isAlive = true;
    const first = !clients.has(session.id);
    if (first) clients.set(session.id, new Set());
    clients.get(session.id)!.add(socket);
    send(socket, { type: 'ready', onlineUserIds: onlineIds(session.id) });
    if (first) publishPresence(session.id, true);
    let windowStart = Date.now();
    let eventCount = 0;
    socket.on('pong', () => { socket.isAlive = true; });
    socket.on('error', (error) => logger.error('WebSocket error', error));
    socket.on('message', (raw: RawData, isBinary: boolean) => {
      let event: Record<string, unknown> | undefined;
      try {
        if (!db.prepare('SELECT 1 FROM sessions WHERE token_hash = ? AND expires_at > ?')
          .get(session.token_hash, Date.now())) return socket.close(4001, 'Session expired');
        if (Date.now() - windowStart > 10_000) { windowStart = Date.now(); eventCount = 0; }
        if (++eventCount > 60) throw new RequestError(429, 'Too many events. Slow down and try again.');
        if (isBinary) throw new RequestError(400, 'Only JSON text events are supported.');
        try { event = JSON.parse(raw.toString()) as Record<string, unknown>; }
        catch { throw new RequestError(400, 'Invalid JSON event.'); }
        if (!event || typeof event !== 'object' || Array.isArray(event)) throw new RequestError(400, 'Invalid event.');
        assertMember(event.conversationId, session.id);
        if (event.type === 'message') {
          const text = requireText(event.text, 'Message', 1, 4000);
          const clientId = requireText(event.clientId, 'Client message ID', 1, 100);
          const existing = db.prepare('SELECT conversation_id FROM messages WHERE sender_id = ? AND client_id = ?')
            .get(session.id, clientId);
          if (existing && existing.conversation_id !== event.conversationId) {
            throw new RequestError(409, 'Client message ID is already in use.');
          }
          if (!existing) db.prepare(`
            INSERT INTO messages (conversation_id, sender_id, client_id, text, created_at) VALUES (?, ?, ?, ?, ?)
          `).run(event.conversationId, session.id, clientId, text, new Date().toISOString());
          const message = db.prepare(`
            SELECT id, conversation_id AS conversationId, sender_id AS senderId,
                   client_id AS clientId, text, created_at AS createdAt
            FROM messages WHERE sender_id = ? AND client_id = ?
          `).get(session.id, clientId);
          publish(memberIds(event.conversationId), { type: 'message', message });
        } else if (event.type === 'typing') {
          if (typeof event.typing !== 'boolean') throw new RequestError(400, 'Typing must be a boolean.');
          publish(memberIds(event.conversationId).filter((id) => id !== session.id), {
            type: 'typing', conversationId: event.conversationId, userId: session.id, typing: event.typing,
          });
        } else if (event.type === 'read') {
          const requestedMessageId = event.messageId;
          if (typeof requestedMessageId !== 'number' || !Number.isSafeInteger(requestedMessageId) || requestedMessageId < 1 ||
              !db.prepare('SELECT 1 FROM messages WHERE id = ? AND conversation_id = ?')
                .get(requestedMessageId, event.conversationId)) throw new RequestError(400, 'Invalid read receipt.');
          db.prepare(`
            UPDATE members SET last_read_id = MAX(last_read_id, ?)
            WHERE conversation_id = ? AND user_id = ?
          `).run(requestedMessageId, event.conversationId, session.id);
          const { last_read_id: messageId } = db.prepare(
            'SELECT last_read_id FROM members WHERE conversation_id = ? AND user_id = ?',
          ).get(event.conversationId, session.id);
          publish(memberIds(event.conversationId), {
            type: 'read', conversationId: event.conversationId, userId: session.id, messageId,
          });
        } else throw new RequestError(400, 'Unsupported event type.');
      } catch (error) {
        if (!(error instanceof RequestError)) logger.error('WebSocket event failed', error);
        send(socket, {
          type: 'error', clientId: typeof event?.clientId === 'string' ? event.clientId : undefined,
          error: error instanceof RequestError ? error.message : 'Unable to process this event.',
        });
      }
    });
    socket.on('close', () => {
      const sockets = clients.get(session.id);
      sockets?.delete(socket);
      if (sockets?.size === 0) { clients.delete(session.id); publishPresence(session.id, false); }
    });
  });
  const heartbeat = setInterval(() => {
    for (const connection of wss.clients) {
      const socket = connection as ChatSocket;
      if (!db.prepare('SELECT 1 FROM sessions WHERE token_hash = ? AND expires_at > ?')
        .get(socket.sessionHash, Date.now())) { socket.close(4001, 'Session expired'); continue; }
      if (!socket.isAlive) { socket.terminate(); continue; }
      socket.isAlive = false;
      socket.ping();
    }
  }, 30_000);
  heartbeat.unref();

  async function close() {
    clearInterval(heartbeat);
    for (const socket of wss.clients) socket.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    if (server.listening) await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeIdleConnections();
    });
    db.close();
  }
  return { app, server, db, close };
}

export { createChatServer };
