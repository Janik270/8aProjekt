import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import helmet from 'helmet';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeIp(value = '') {
  const ip = String(value).trim().replace(/^::ffff:/, '');
  return isIP(ip) ? ip : 'unknown';
}

function requestIp(req) {
  return normalizeIp(req.ip || req.socket?.remoteAddress);
}

function rejectRateLimit(_req, res, _next, options) {
  res.status(options.statusCode).json({ error: 'Zu viele Anfragen. Bitte warte kurz und versuche es dann erneut.' });
}

function createRateLimiter({ windowMs, limit, keyGenerator, skipSuccessfulRequests = false }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: rejectRateLimit,
    keyGenerator: keyGenerator || (req => ipKeyGenerator(requestIp(req))),
    skipSuccessfulRequests,
  });
}

function sameOrigin(req, res, next) {
  const origin = req.get('origin');
  if (!origin) return next();
  const expected = `${req.protocol}://${req.get('host')}`;
  if (origin !== expected) return res.status(403).json({ error: 'Anfragen von einer fremden Website sind nicht erlaubt.' });
  next();
}

function subjectHash(req) {
  return createHash('sha256').update(`scool-tools:${requestIp(req)}`).digest('hex');
}

function quotaMiddleware(db, { kind, limit, windowMs }) {
  return (req, res, next) => {
    const windowStart = Math.floor(Date.now() / windowMs) * windowMs;
    const hash = subjectHash(req);
    const row = db.prepare(`
      INSERT INTO security_usage (kind, subject_hash, window_start, count)
      VALUES (?, ?, ?, 1)
      ON CONFLICT(kind, subject_hash, window_start) DO UPDATE SET count = count + 1
      RETURNING count
    `).get(kind, hash, windowStart);
    if (row.count > limit) {
      db.prepare('UPDATE security_usage SET count = count - 1 WHERE kind = ? AND subject_hash = ? AND window_start = ?').run(kind, hash, windowStart);
      return res.status(429).json({ error: 'Das Tageskontingent für diese Aktion ist erreicht. Bitte versuche es später erneut.' });
    }
    res.once('finish', () => {
      if (res.statusCode < 400) return;
      db.prepare('UPDATE security_usage SET count = count - 1 WHERE kind = ? AND subject_hash = ? AND window_start = ?').run(kind, hash, windowStart);
      db.prepare('DELETE FROM security_usage WHERE kind = ? AND subject_hash = ? AND window_start = ? AND count <= 0').run(kind, hash, windowStart);
    });
    next();
  };
}

function tableCapacity(db, table, limit, message) {
  const statements = {
    users: db.prepare('SELECT count(*) AS count FROM users'),
    workspaces: db.prepare('SELECT count(*) AS count FROM workspaces'),
    traffic_rooms: db.prepare('SELECT count(*) AS count FROM traffic_rooms'),
  };
  const statement = statements[table];
  return (_req, res, next) => {
    if (statement.get().count >= limit) return res.status(503).json({ error: message });
    next();
  };
}

export function securityHeaders({ production = process.env.NODE_ENV === 'production' } = {}) {
  const middleware = helmet({
    crossOriginEmbedderPolicy: false,
    strictTransportSecurity: production ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        fontSrc: ["'self'", 'data:'],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        workerSrc: ["'self'", 'blob:'],
        upgradeInsecureRequests: production ? [] : null,
      },
    },
  });
  return (req, res, next) => {
    middleware(req, res, error => {
      if (error) return next(error);
      res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
      next();
    });
  };
}

export function createSecurity(db, overrides = {}) {
  const config = {
    apiLimit: positiveInteger(process.env.API_RATE_LIMIT, 1_500),
    writeLimit: positiveInteger(process.env.WRITE_RATE_LIMIT, 360),
    loginIpLimit: positiveInteger(process.env.LOGIN_IP_RATE_LIMIT, 120),
    loginAccountLimit: positiveInteger(process.env.LOGIN_ACCOUNT_RATE_LIMIT, 10),
    registerLimit: positiveInteger(process.env.REGISTER_RATE_LIMIT, 60),
    workspaceCreateLimit: positiveInteger(process.env.WORKSPACE_CREATE_RATE_LIMIT, 120),
    trafficCreateLimit: positiveInteger(process.env.TRAFFIC_CREATE_RATE_LIMIT, 60),
    trafficJoinLimit: positiveInteger(process.env.TRAFFIC_JOIN_RATE_LIMIT, 240),
    ideaLimit: positiveInteger(process.env.IDEA_RATE_LIMIT, 20),
    maxUsers: positiveInteger(process.env.MAX_USERS, 5_000),
    maxWorkspaces: positiveInteger(process.env.MAX_WORKSPACES, 5_000),
    maxWorkspacesPerAccount: positiveInteger(process.env.MAX_WORKSPACES_PER_ACCOUNT, 100),
    maxTrafficRooms: positiveInteger(process.env.MAX_TRAFFIC_ROOMS, 500),
    ...overrides,
  };

  const usernameKey = req => {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim().toLocaleLowerCase('de-DE').slice(0, 64) : 'leer';
    return `${ipKeyGenerator(requestIp(req))}:${createHash('sha256').update(username).digest('hex')}`;
  };

  return {
    sameOrigin,
    apiLimiter: createRateLimiter({ windowMs: 5 * MINUTE, limit: config.apiLimit }),
    writeLimiter: createRateLimiter({ windowMs: MINUTE, limit: config.writeLimit }),
    loginIpLimiter: createRateLimiter({ windowMs: 15 * MINUTE, limit: config.loginIpLimit }),
    loginAccountLimiter: createRateLimiter({ windowMs: 15 * MINUTE, limit: config.loginAccountLimit, keyGenerator: usernameKey, skipSuccessfulRequests: true }),
    registerLimiter: createRateLimiter({ windowMs: HOUR, limit: config.registerLimit }),
    workspaceCreateLimiter: createRateLimiter({ windowMs: HOUR, limit: config.workspaceCreateLimit }),
    trafficCreateLimiter: createRateLimiter({ windowMs: HOUR, limit: config.trafficCreateLimit }),
    trafficJoinLimiter: createRateLimiter({ windowMs: 15 * MINUTE, limit: config.trafficJoinLimit }),
    ideaLimiter: createRateLimiter({ windowMs: HOUR, limit: config.ideaLimit }),
    registerQuota: quotaMiddleware(db, { kind: 'register', limit: 80, windowMs: DAY }),
    workspaceQuota: quotaMiddleware(db, { kind: 'workspace', limit: 160, windowMs: DAY }),
    trafficRoomQuota: quotaMiddleware(db, { kind: 'traffic-room', limit: 80, windowMs: DAY }),
    trafficJoinQuota: quotaMiddleware(db, { kind: 'traffic-join', limit: 500, windowMs: DAY }),
    ideaQuota: quotaMiddleware(db, { kind: 'idea', limit: 30, windowMs: DAY }),
    userCapacity: tableCapacity(db, 'users', config.maxUsers, 'Die maximale Anzahl an Konten ist erreicht.'),
    workspaceCapacity: tableCapacity(db, 'workspaces', config.maxWorkspaces, 'Die maximale Anzahl an Projekten ist erreicht.'),
    accountWorkspaceCapacity: (req, res, next) => {
      if (!req.user) return next();
      const count = db.prepare("SELECT count(*) AS count FROM account_workspaces WHERE user_id = ? AND role = 'owner'").get(req.user.id).count;
      if (count >= config.maxWorkspacesPerAccount) return res.status(409).json({ error: 'Du hast die maximale Anzahl eigener Projekte erreicht.' });
      next();
    },
    trafficRoomCapacity: tableCapacity(db, 'traffic_rooms', config.maxTrafficRooms, 'Die maximale Anzahl aktiver Ampelräume ist erreicht.'),
  };
}

export function createActiveConnectionGate({ maxPerIp = 60, maxTotal = 600 } = {}) {
  const counts = new Map();
  let total = 0;
  return (req, res, next) => {
    const key = requestIp(req);
    if (total >= maxTotal || (counts.get(key) || 0) >= maxPerIp) {
      return res.status(429).json({ error: 'Zu viele gleichzeitige Live-Verbindungen.' });
    }
    total += 1;
    counts.set(key, (counts.get(key) || 0) + 1);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      total -= 1;
      const nextCount = (counts.get(key) || 1) - 1;
      if (nextCount > 0) counts.set(key, nextCount);
      else counts.delete(key);
    };
    res.once('close', release);
    next();
  };
}

function isLoopback(address = '') {
  const normalized = normalizeIp(address);
  return normalized === '127.0.0.1' || normalized === '::1';
}

export function upgradeClientIp(request) {
  const remote = request.socket.remoteAddress || '';
  const forwarded = request.headers['x-forwarded-for'];
  if (isLoopback(remote) && forwarded) return normalizeIp(String(forwarded).split(',')[0]);
  return normalizeIp(remote);
}

export function createSocketGate({ maxPerIp = 60, maxTotal = 600, attemptsPerMinute = 180 } = {}) {
  const active = new Map();
  const attempts = new Map();
  let total = 0;

  const pruneAttempts = now => {
    for (const [key, value] of attempts) if (value.resetAt <= now) attempts.delete(key);
  };

  return {
    acquire(ip) {
      const key = normalizeIp(ip);
      const now = Date.now();
      if (attempts.size > 2_000) pruneAttempts(now);
      const attempt = attempts.get(key);
      if (!attempt || attempt.resetAt <= now) attempts.set(key, { count: 1, resetAt: now + MINUTE });
      else {
        attempt.count += 1;
        if (attempt.count > attemptsPerMinute) return null;
      }
      if (total >= maxTotal || (active.get(key) || 0) >= maxPerIp) return null;
      total += 1;
      active.set(key, (active.get(key) || 0) + 1);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        total -= 1;
        const nextCount = (active.get(key) || 1) - 1;
        if (nextCount > 0) active.set(key, nextCount);
        else active.delete(key);
      };
    },
  };
}

export function hasAllowedWebSocketOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  let parsedOrigin;
  try { parsedOrigin = new URL(String(origin)); }
  catch { return false; }
  if (!['http:', 'https:'].includes(parsedOrigin.protocol)) return false;

  const remote = request.socket?.remoteAddress || '';
  const forwardedHost = isLoopback(remote) ? request.headers['x-forwarded-host'] : '';
  const publicHost = String(forwardedHost || request.headers.host || '').split(',')[0].trim().toLowerCase();
  if (!publicHost || parsedOrigin.host.toLowerCase() !== publicHost) return false;

  // Some reverse proxies preserve the public Host but omit X-Forwarded-Proto
  // specifically on WebSocket upgrades. A matching host is still same-origin;
  // when the trusted proxy does provide a scheme, verify it as well.
  const forwardedProto = isLoopback(remote) ? request.headers['x-forwarded-proto'] : '';
  if (!forwardedProto) return true;
  const protocol = String(forwardedProto).split(',')[0].trim().toLowerCase();
  return parsedOrigin.protocol === `${protocol}:`;
}
