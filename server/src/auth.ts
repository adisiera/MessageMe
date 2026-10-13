const { randomBytes, scrypt, timingSafeEqual, createHash } = require('node:crypto');
const cookie = require('cookie');
import type { DatabaseSync } from 'node:sqlite';
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  token_hash: string;
  expires_at: number;
}

interface PublicUser {
  id: string;
  name: string;
  email: string;
}

const deriveKey = (password: string, salt: string): Promise<Buffer> => new Promise((resolve, reject) => {
  scrypt(password, salt, 64, (error: Error | null, key: Buffer) => {
    if (error) reject(error);
    else resolve(key);
  });
});
const SESSION_AGE = 7 * 24 * 60 * 60;
const COOKIE_NAME = 'messageme_session';

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const key = await deriveKey(password, salt);
  return `${salt}:${key.toString('hex')}`;
}

async function verifyPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(':');
  const key = await deriveKey(password, salt);
  return timingSafeEqual(key, Buffer.from(hash, 'hex'));
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

function getSession(db: DatabaseSync, request: IncomingMessage): SessionUser | null {
  const token = cookie.parse(request.headers.cookie || '')[COOKIE_NAME];
  if (!token) return null;
  return db.prepare(`
    SELECT users.id, users.name, users.email, sessions.token_hash, sessions.expires_at
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE token_hash = ? AND expires_at > ?
  `).get(hashToken(token), Date.now()) as unknown as SessionUser | undefined || null;
}

function sessionCookie(token: string, secure: boolean, maxAge = SESSION_AGE) {
  return cookie.serialize(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure,
    path: '/',
    maxAge,
  });
}

function createSession(db: DatabaseSync, userId: string, response: ServerResponse, secure: boolean) {
  const token = randomBytes(32).toString('hex');
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
  db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(
    hashToken(token), userId, Date.now() + SESSION_AGE * 1000,
  );
  response.setHeader('Set-Cookie', sessionCookie(token, secure));
}

const publicUser = ({ id, name, email }: PublicUser) => ({ id, name, email });

export {
  hashPassword, verifyPassword, getSession, sessionCookie, createSession, publicUser,
};
