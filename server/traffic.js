import { randomBytes, randomUUID } from 'node:crypto';

const COLORS = new Set(['red', 'yellow', 'green']);
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function roomCode() {
  const bytes = randomBytes(6);
  return Array.from(bytes, value => CODE_ALPHABET[value % CODE_ALPHABET.length]).join('');
}

function publicRoom(row) {
  return { id: row.id, name: row.name, createdAt: row.created_at };
}

function publicStudent(row) {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    joinedAt: row.joined_at,
    updatedAt: row.updated_at,
  };
}

export function installTraffic(app, db, { hashKey, hasValidKey, security, liveConnectionGate }) {
  const streams = new Map();
  const roomById = db.prepare('SELECT * FROM traffic_rooms WHERE id = ?');

  const broadcast = (roomId) => {
    const listeners = streams.get(roomId);
    if (!listeners) return;
    for (const response of listeners) response.write(`event: changed\ndata: ${JSON.stringify({ roomId })}\n\n`);
  };

  app.post('/api/traffic-rooms', security.trafficCreateLimiter, security.trafficRoomQuota, security.trafficRoomCapacity, (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name || name.length > 60) return res.status(400).json({ error: 'Bitte gib einen Klassennamen mit höchstens 60 Zeichen ein.' });

    let id;
    do id = roomCode(); while (roomById.get(id));
    const teacherKey = randomBytes(24).toString('base64url');
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO traffic_rooms (id, name, teacher_key_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, name, hashKey(teacherKey), now, now);
    res.status(201).json({ id, name, teacherKey, createdAt: now });
  });

  app.get('/api/traffic-rooms/:id/events', liveConnectionGate, (req, res) => {
    const room = roomById.get(req.params.id.toUpperCase());
    if (!room) return res.status(404).json({ error: 'Diese Klasse wurde nicht gefunden.' });
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    const listeners = streams.get(room.id) || new Set();
    listeners.add(res);
    streams.set(room.id, listeners);
    res.write(`retry: 1000\nevent: changed\ndata: ${JSON.stringify({ roomId: room.id })}\n\n`);
    const heartbeat = setInterval(() => res.write(': verbunden\n\n'), 20_000);
    heartbeat.unref();
    req.on('close', () => {
      clearInterval(heartbeat);
      listeners.delete(res);
      if (listeners.size === 0) streams.delete(room.id);
    });
  });

  app.get('/api/traffic-rooms/:id/status', (req, res) => {
    const room = roomById.get(req.params.id.toUpperCase());
    if (!room) return res.status(404).json({ error: 'Diese Klasse wurde nicht gefunden.' });
    if (!hasValidKey(room.teacher_key_hash, req.get('x-teacher-key'))) {
      return res.status(403).json({ error: 'Nur die Lehrkraft darf die Übersicht sehen.' });
    }
    const students = db.prepare(`
      SELECT * FROM traffic_students WHERE room_id = ? ORDER BY name COLLATE NOCASE
    `).all(room.id).map(publicStudent);
    res.json({ ...publicRoom(room), students });
  });

  app.get('/api/traffic-rooms/:id', (req, res) => {
    const room = roomById.get(req.params.id.toUpperCase());
    if (!room) return res.status(404).json({ error: 'Diese Klasse wurde nicht gefunden.' });
    res.json(publicRoom(room));
  });

  app.post('/api/traffic-rooms/:id/students', security.trafficJoinLimiter, security.trafficJoinQuota, (req, res) => {
    const room = roomById.get(req.params.id.toUpperCase());
    if (!room) return res.status(404).json({ error: 'Diese Klasse wurde nicht gefunden.' });
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name || name.length > 40) return res.status(400).json({ error: 'Bitte gib einen Namen mit höchstens 40 Zeichen ein.' });
    const count = db.prepare('SELECT count(*) AS count FROM traffic_students WHERE room_id = ?').get(room.id).count;
    if (count >= 80) return res.status(409).json({ error: 'Diese Klasse ist bereits voll.' });
    const studentKey = randomBytes(24).toString('base64url');
    const student = { id: randomUUID(), name, color: null, joinedAt: new Date().toISOString() };
    try {
      db.prepare(`
        INSERT INTO traffic_students (id, room_id, name, color, student_key_hash, joined_at, updated_at)
        VALUES (?, ?, ?, NULL, ?, ?, ?)
      `).run(student.id, room.id, name, hashKey(studentKey), student.joinedAt, student.joinedAt);
    } catch (error) {
      if (String(error.message).includes('UNIQUE constraint failed')) {
        return res.status(409).json({ error: 'Dieser Name ist in der Klasse schon vergeben.' });
      }
      throw error;
    }
    db.prepare('UPDATE traffic_rooms SET updated_at = ? WHERE id = ?').run(student.joinedAt, room.id);
    broadcast(room.id);
    res.status(201).json({ ...student, studentKey });
  });

  app.get('/api/traffic-rooms/:id/students/:studentId', (req, res) => {
    const student = db.prepare('SELECT * FROM traffic_students WHERE id = ? AND room_id = ?')
      .get(req.params.studentId, req.params.id.toUpperCase());
    if (!student) return res.status(404).json({ error: 'Deine Teilnahme wurde nicht gefunden.' });
    if (!hasValidKey(student.student_key_hash, req.get('x-student-key'))) {
      return res.status(403).json({ error: 'Die Teilnahme gehört zu einem anderen Gerät.' });
    }
    res.json(publicStudent(student));
  });

  app.put('/api/traffic-rooms/:id/students/:studentId', (req, res) => {
    const roomId = req.params.id.toUpperCase();
    const student = db.prepare('SELECT * FROM traffic_students WHERE id = ? AND room_id = ?')
      .get(req.params.studentId, roomId);
    if (!student) return res.status(404).json({ error: 'Deine Teilnahme wurde nicht gefunden.' });
    if (!hasValidKey(student.student_key_hash, req.get('x-student-key'))) {
      return res.status(403).json({ error: 'Die Teilnahme gehört zu einem anderen Gerät.' });
    }
    const color = typeof req.body?.color === 'string' ? req.body.color : '';
    if (!COLORS.has(color)) return res.status(400).json({ error: 'Bitte wähle Rot, Gelb oder Grün.' });
    const updatedAt = new Date().toISOString();
    db.prepare('UPDATE traffic_students SET color = ?, updated_at = ? WHERE id = ?').run(color, updatedAt, student.id);
    db.prepare('UPDATE traffic_rooms SET updated_at = ? WHERE id = ?').run(updatedAt, roomId);
    broadcast(roomId);
    res.json({ ...publicStudent(student), color, updatedAt });
  });
}
