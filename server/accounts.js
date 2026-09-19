import { promisify } from 'node:util';
import { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } from 'node:crypto';

const deriveKey = promisify(scrypt);
const COOKIE = '8a_session';
const SESSION_DAYS = 30;

const tokenHash = token => createHash('sha256').update(token).digest('hex');

function cookies(header = '') {
  const result = {};
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    try { result[part.slice(0, separator).trim()] = decodeURIComponent(part.slice(separator + 1).trim()); }
    catch { /* Ignore malformed cookies. */ }
  }
  return result;
}

async function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  const key = await deriveKey(password, salt, 64);
  return `${salt}:${Buffer.from(key).toString('hex')}`;
}

async function passwordMatches(password, stored) {
  const [salt, hex] = String(stored).split(':');
  if (!salt || !hex) return false;
  const actual = Buffer.from((await passwordHash(password, salt)).split(':')[1], 'hex');
  const expected = Buffer.from(hex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function setSessionCookie(req, res, token, maxAge = SESSION_DAYS * 24 * 60 * 60) {
  const secure = req.secure || req.get('x-forwarded-proto') === 'https';
  res.append('Set-Cookie', `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`);
}

function createSession(db, req, res, userId) {
  const token = randomBytes(32).toString('base64url');
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + SESSION_DAYS * 86_400_000);
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(tokenHash(token), userId, createdAt.toISOString(), expiresAt.toISOString());
  setSessionCookie(req, res, token);
}

function validCredentials(body) {
  const username = typeof body?.username === 'string' ? body.username.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!/^[\p{L}\p{N}_. -]{3,30}$/u.test(username)) return { error: 'Der Name muss 3 bis 30 Zeichen lang sein.' };
  if (password.length < 8 || password.length > 128) return { error: 'Das Passwort muss mindestens 8 Zeichen lang sein.' };
  return { username, password };
}

export function installAccounts(app, db, hasValidKey) {
  app.use((req, _res, next) => {
    const token = cookies(req.get('cookie'))[COOKIE];
    if (token) {
      const now = new Date().toISOString();
      req.sessionTokenHash = tokenHash(token);
      req.user = db.prepare(`
        SELECT users.id, users.username
        FROM sessions JOIN users ON users.id = sessions.user_id
        WHERE sessions.token_hash = ? AND sessions.expires_at > ?
      `).get(req.sessionTokenHash, now) || null;
    } else req.user = null;
    next();
  });

  app.post('/api/auth/register', async (req, res) => {
    const credentials = validCredentials(req.body);
    if (credentials.error) return res.status(400).json({ error: credentials.error });
    const id = randomUUID();
    const now = new Date().toISOString();
    try {
      const hash = await passwordHash(credentials.password);
      db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)')
        .run(id, credentials.username, hash, now);
      createSession(db, req, res, id);
      res.status(201).json({ user: { id, username: credentials.username } });
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) return res.status(409).json({ error: 'Dieser Name ist bereits vergeben.' });
      throw error;
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const user = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username);
    if (!user || !(await passwordMatches(password, user.password_hash))) {
      return res.status(401).json({ error: 'Name oder Passwort ist falsch.' });
    }
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString());
    createSession(db, req, res, user.id);
    res.json({ user: { id: user.id, username: user.username } });
  });

  app.post('/api/auth/logout', (req, res) => {
    if (req.sessionTokenHash) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(req.sessionTokenHash);
    setSessionCookie(req, res, '', 0);
    res.status(204).end();
  });

  app.get('/api/account', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Bitte melde dich an.' });
    const projects = db.prepare(`
      SELECT workspaces.id, workspaces.type, workspaces.title,
        workspaces.created_at AS createdAt, workspaces.updated_at AS updatedAt,
        account_workspaces.role, account_workspaces.edit_key AS editKey,
        account_workspaces.added_at AS addedAt
      FROM account_workspaces
      JOIN workspaces ON workspaces.id = account_workspaces.workspace_id
      WHERE account_workspaces.user_id = ?
      ORDER BY workspaces.updated_at DESC
    `).all(req.user.id);
    res.json({ user: req.user, projects });
  });

  app.post('/api/account/projects/:id', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Bitte melde dich zuerst an.' });
    const workspace = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(req.params.id);
    if (!workspace) return res.status(404).json({ error: 'Dieses Projekt wurde nicht gefunden.' });
    const editKey = typeof req.body?.editKey === 'string' ? req.body.editKey : '';
    const canEdit = hasValidKey(workspace.edit_key_hash, editKey);
    const previous = db.prepare('SELECT * FROM account_workspaces WHERE user_id = ? AND workspace_id = ?').get(req.user.id, workspace.id);
    const role = previous?.role === 'owner' ? 'owner' : previous?.role === 'edit' || canEdit ? 'edit' : 'view';
    const storedKey = role === 'view' ? previous?.edit_key || null : editKey || previous?.edit_key || null;
    db.prepare(`
      INSERT INTO account_workspaces (user_id, workspace_id, role, edit_key, added_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id, workspace_id) DO UPDATE SET
        role = CASE WHEN account_workspaces.role = 'owner' THEN 'owner' ELSE excluded.role END,
        edit_key = COALESCE(excluded.edit_key, account_workspaces.edit_key)
    `).run(req.user.id, workspace.id, role, storedKey, new Date().toISOString());
    res.status(previous ? 200 : 201).json({ id: workspace.id, role, editKey: storedKey });
  });

  app.delete('/api/account/projects/:id', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Bitte melde dich zuerst an.' });
    db.prepare('DELETE FROM account_workspaces WHERE user_id = ? AND workspace_id = ?').run(req.user.id, req.params.id);
    res.status(204).end();
  });
}

export function saveOwnedWorkspace(db, user, workspaceId, editKey, now) {
  if (!user) return;
  db.prepare(`
    INSERT INTO account_workspaces (user_id, workspace_id, role, edit_key, added_at)
    VALUES (?, ?, 'owner', ?, ?)
  `).run(user.id, workspaceId, editKey, now);
}
