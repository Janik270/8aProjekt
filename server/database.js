import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));

export function openDatabase(filename = process.env.DATABASE_PATH || './data/8a.sqlite') {
  const databasePath = filename === ':memory:' ? filename : resolve(projectRoot, filename);
  if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

  // Versioned schema: each tool can add its own migration here.
  const { user_version: version } = db.prepare('PRAGMA user_version').get();
  if (version < 1) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`
        CREATE TABLE site_settings (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          project_name TEXT NOT NULL,
          school_name TEXT NOT NULL,
          class_name TEXT NOT NULL,
          welcome_text TEXT NOT NULL
        ) STRICT;
      `);
      db.prepare('INSERT INTO site_settings VALUES (1, ?, ?, ?, ?)').run(
        'Scool Tools',
        'Realschule Zusmarshausen',
        '8a',
        'Ein Ort für unsere Klasse. Alles, was unseren Schulalltag einfacher macht – gemeinsam gedacht, von uns gestaltet.',
      );
      db.exec('PRAGMA user_version = 1; COMMIT;');
    } catch (error) {
      db.exec('ROLLBACK');
      db.close();
      throw error;
    }
  }
  if (version < 2) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`
        CREATE TABLE workspaces (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL CHECK (type IN ('whiteboard', 'writer')),
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          edit_key_hash TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;
        DROP TABLE IF EXISTS modules;
      `);
      db.prepare(`
        UPDATE site_settings
        SET project_name = ?, welcome_text = ?
        WHERE id = 1
      `).run(
        'Scool Tools',
        'Kreative Werkzeuge für Ideen, Gruppenarbeit und alles, was wir gemeinsam schaffen.',
      );
      db.exec('PRAGMA user_version = 2; COMMIT;');
    } catch (error) {
      db.exec('ROLLBACK');
      db.close();
      throw error;
    }
  }
  if (version < 3) {
    db.exec('ALTER TABLE workspaces ADD COLUMN y_state BLOB; PRAGMA user_version = 3;');
  }
  if (version < 4) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`
        CREATE TABLE users (
          id TEXT PRIMARY KEY,
          username TEXT NOT NULL COLLATE NOCASE UNIQUE,
          password_hash TEXT NOT NULL,
          created_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE sessions (
          token_hash TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL,
          expires_at TEXT NOT NULL
        ) STRICT;
        CREATE INDEX sessions_user_id ON sessions(user_id);
        CREATE TABLE account_workspaces (
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
          role TEXT NOT NULL CHECK (role IN ('owner', 'edit', 'view')),
          edit_key TEXT,
          added_at TEXT NOT NULL,
          PRIMARY KEY (user_id, workspace_id)
        ) STRICT;
        CREATE INDEX account_workspaces_workspace_id ON account_workspaces(workspace_id);
        PRAGMA user_version = 4;
        COMMIT;
      `);
    } catch (error) {
      db.exec('ROLLBACK');
      db.close();
      throw error;
    }
  }
  if (version < 5) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`
        CREATE TABLE traffic_rooms (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          teacher_key_hash TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE traffic_students (
          id TEXT PRIMARY KEY,
          room_id TEXT NOT NULL REFERENCES traffic_rooms(id) ON DELETE CASCADE,
          name TEXT NOT NULL COLLATE NOCASE,
          color TEXT CHECK (color IN ('red', 'yellow', 'green')),
          student_key_hash TEXT NOT NULL,
          joined_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (room_id, name)
        ) STRICT;
        CREATE INDEX traffic_students_room_id ON traffic_students(room_id);
        PRAGMA user_version = 5;
        COMMIT;
      `);
    } catch (error) {
      db.exec('ROLLBACK');
      db.close();
      throw error;
    }
  }
  if (version < 6) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`
        UPDATE site_settings SET project_name = 'Scool Tools' WHERE id = 1;
        PRAGMA user_version = 6;
        COMMIT;
      `);
    } catch (error) {
      db.exec('ROLLBACK');
      db.close();
      throw error;
    }
  }
  if (version < 7) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`
        CREATE TABLE security_usage (
          kind TEXT NOT NULL,
          subject_hash TEXT NOT NULL,
          window_start INTEGER NOT NULL,
          count INTEGER NOT NULL CHECK (count > 0),
          PRIMARY KEY (kind, subject_hash, window_start)
        ) STRICT;
        CREATE INDEX security_usage_window_start ON security_usage(window_start);
        PRAGMA user_version = 7;
        COMMIT;
      `);
    } catch (error) {
      db.exec('ROLLBACK');
      db.close();
      throw error;
    }
  }
  return db;
}
