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
        '8a Projekt',
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
        '8a Tools',
        'Kreative Werkzeuge für Ideen, Gruppenarbeit und alles, was wir gemeinsam schaffen.',
      );
      db.exec('PRAGMA user_version = 2; COMMIT;');
    } catch (error) {
      db.exec('ROLLBACK');
      db.close();
      throw error;
    }
  }
  return db;
}
