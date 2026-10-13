const request = require('supertest');
const { WebSocket } = require('ws');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { once } = require('node:events');
const { createChatServer } = require('../src/app');

const origin = 'http://localhost:5173';
const password = 'a-strong-password-123';
let chat;
let alice;
let bob;

async function register(name, email = `${name.toLowerCase()}@example.test`) {
  const response = await request(chat.app).post('/api/auth/register')
    .set('Origin', origin).send({ name, email, password }).expect(201);
  return { ...response.body.user, cookie: response.headers['set-cookie'][0].split(';')[0] };
}

async function direct(first, second) {
  const response = await request(chat.app).post('/api/conversations')
    .set('Origin', origin).set('Cookie', first.cookie).send({ memberIds: [second.id] }).expect(201);
  return response.body.conversation;
}

function waitEvent(socket, predicate) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { cleanup(); reject(new Error('Timed out waiting for socket event')); }, 3000);
    function cleanup() { clearTimeout(timeout); socket.off('message', listener); }
    function listener(raw) {
      const event = JSON.parse(raw.toString());
      if (predicate(event)) { cleanup(); resolve(event); }
    }
    socket.on('message', listener);
  });
}

async function connect(user) {
  const socket = new WebSocket(`ws://127.0.0.1:${chat.server.address().port}/ws`, {
    origin, headers: { Cookie: user.cookie },
  });
  await waitEvent(socket, (event) => event.type === 'ready');
  return socket;
}

beforeEach(async () => {
  chat = createChatServer();
  chat.server.listen(0, '127.0.0.1');
  await once(chat.server, 'listening');
  alice = await register('Alice');
  bob = await register('Bob');
});
afterEach(async () => { await chat.close(); });

test('stores salted password hashes, authenticates, and invalidates sessions on logout', async () => {
  const stored = chat.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(alice.id);
  expect(stored.password_hash).not.toContain(password);
  await request(chat.app).get('/api/auth/me').set('Cookie', alice.cookie).expect(200);
  await request(chat.app).post('/api/auth/login').set('Origin', origin)
    .send({ email: alice.email, password: 'incorrect-password' }).expect(401);
  const response = await request(chat.app).post('/api/auth/login').set('Origin', origin)
    .send({ email: alice.email.toUpperCase(), password }).expect(200);
  expect(response.body.user.id).toBe(alice.id);
  const socket = await connect(alice);
  const closed = once(socket, 'close');
  await request(chat.app).post('/api/auth/logout').set('Origin', origin).set('Cookie', alice.cookie).expect(204);
  expect((await closed)[0]).toBe(4001);
  await request(chat.app).get('/api/auth/me').set('Cookie', alice.cookie).expect(401);
});

test('validates registration, rejects duplicate emails and cross-origin writes', async () => {
  await request(chat.app).post('/api/auth/register').set('Origin', origin)
    .send({ name: 'Weak', email: 'bad', password: 'short' }).expect(400);
  await request(chat.app).post('/api/auth/register').set('Origin', origin)
    .send({ name: 'Duplicate', email: alice.email, password }).expect(409);
  await request(chat.app).post('/api/auth/logout').set('Origin', 'https://attacker.test')
    .set('Cookie', alice.cookie).expect(403);
  await request(chat.app).get('/api/conversations').expect(401);
  await request(chat.app).post('/api/auth/login').set('Origin', origin)
    .set('Content-Type', 'application/json').send('{').expect(400);
});

test('deduplicates direct chats, creates groups and protects membership/history', async () => {
  const conversation = await direct(alice, bob);
  const duplicate = await request(chat.app).post('/api/conversations').set('Origin', origin)
    .set('Cookie', bob.cookie).send({ memberIds: [alice.id] }).expect(200);
  expect(duplicate.body.conversation.id).toBe(conversation.id);
  const charlie = await register('Charlie');
  await request(chat.app).get(`/api/conversations/${conversation.id}/messages`).set('Cookie', charlie.cookie).expect(404);
  const group = await request(chat.app).post('/api/conversations').set('Origin', origin).set('Cookie', alice.cookie)
    .send({ memberIds: [bob.id, charlie.id], name: 'Friends' }).expect(201);
  expect(group.body.conversation.members).toHaveLength(3);
  await request(chat.app).post('/api/conversations').set('Origin', origin).set('Cookie', alice.cookie)
    .send({ memberIds: [bob.id, bob.id] }).expect(400);
});

test('delivers messages, typing, monotonic read receipts, presence, and idempotent retries', async () => {
  const conversation = await direct(alice, bob);
  const a = await connect(alice);
  const b = await connect(bob);
  const typed = waitEvent(b, (event) => event.type === 'typing');
  a.send(JSON.stringify({ type: 'typing', conversationId: conversation.id, typing: true }));
  expect((await typed).userId).toBe(alice.id);
  const delivered = waitEvent(b, (event) => event.type === 'message');
  const payload = { type: 'message', conversationId: conversation.id, clientId: 'test-message', text: 'Hello Bob' };
  a.send(JSON.stringify(payload));
  const { message } = await delivered;
  expect(message.text).toBe('Hello Bob');
  const retry = waitEvent(b, (event) => event.type === 'message');
  a.send(JSON.stringify(payload));
  expect((await retry).message.id).toBe(message.id);
  const receipt = waitEvent(a, (event) => event.type === 'read');
  b.send(JSON.stringify({ type: 'read', conversationId: conversation.id, messageId: message.id }));
  expect((await receipt).messageId).toBe(message.id);
  const response = await request(chat.app).get(`/api/conversations/${conversation.id}/messages`)
    .set('Cookie', bob.cookie).expect(200);
  expect(response.body.messages).toHaveLength(1);
  const offline = waitEvent(a, (event) => event.type === 'presence' && !event.online);
  b.close();
  expect((await offline).userId).toBe(bob.id);
});

test('rejects unauthorized socket events, malformed events, and upgrades from untrusted origins', async () => {
  const conversation = await direct(alice, bob);
  const charlie = await register('Charlie');
  const socket = await connect(charlie);
  const denied = waitEvent(socket, (event) => event.type === 'error');
  socket.send(JSON.stringify({ type: 'message', conversationId: conversation.id, clientId: 'x', text: 'Intrusion' }));
  expect((await denied).error).toBe('Conversation not found.');
  const malformed = waitEvent(socket, (event) => event.type === 'error');
  socket.send('{');
  expect((await malformed).error).toBe('Invalid JSON event.');
  const attacker = new WebSocket(`ws://127.0.0.1:${chat.server.address().port}/ws`, {
    origin: 'https://attacker.test', headers: { Cookie: alice.cookie },
  });
  await new Promise((resolve, reject) => {
    attacker.on('unexpected-response', (_req, response) => {
      expect(response.statusCode).toBe(401);
      response.resume();
      attacker.terminate();
      resolve();
    });
    attacker.on('error', () => {});
    attacker.on('open', () => reject(new Error('Unauthorized connection accepted')));
  });
});

test('paginates history without duplicates and preserves data across database reopen', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'messageme-test-'));
  await chat.close();
  chat = createChatServer({ databasePath: join(directory, 'chat.sqlite') });
  try {
    alice = await register('Alice');
    bob = await register('Bob');
    const conversation = await direct(alice, bob);
    const insert = chat.db.prepare(`
      INSERT INTO messages (conversation_id, sender_id, client_id, text, created_at) VALUES (?, ?, ?, ?, ?)
    `);
    for (let i = 0; i < 55; i++) insert.run(conversation.id, alice.id, `m-${i}`, `Message ${i}`, new Date().toISOString());
    const latest = await request(chat.app).get(`/api/conversations/${conversation.id}/messages`).set('Cookie', alice.cookie);
    expect(latest.body.messages).toHaveLength(50);
    expect(latest.body.hasMore).toBe(true);
    const older = await request(chat.app)
      .get(`/api/conversations/${conversation.id}/messages?before=${latest.body.messages[0].id}`).set('Cookie', alice.cookie);
    expect(older.body.messages).toHaveLength(5);
    expect(older.body.hasMore).toBe(false);
    await chat.close();
    chat = createChatServer({ databasePath: join(directory, 'chat.sqlite') });
    const persisted = await request(chat.app).get('/api/conversations').set('Cookie', bob.cookie).expect(200);
    expect(persisted.body.conversations[0].unreadCount).toBe(55);
  } finally {
    await chat.close();
    chat = createChatServer();
    rmSync(directory, { recursive: true, force: true });
  }
});
