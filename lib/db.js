'use strict';
// Datenhaltung mit dem in Node.js (>= 22.5) eingebauten SQLite-Modul.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

// Gut lesbare Zeichen (ohne 0/O, 1/I/L) für Zugangscodes.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateCode(length = 8) {
  const bytes = crypto.randomBytes(length);
  let code = '';
  for (let i = 0; i < length; i++) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return code;
}

function normalizeCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function open(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'verbandsbuch.sqlite'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS locations (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      code        TEXT NOT NULL UNIQUE,
      active      INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS entries (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id        INTEGER REFERENCES locations(id) ON DELETE SET NULL,
      location_name      TEXT NOT NULL,
      injured_name       TEXT NOT NULL,
      injured_department TEXT,
      incident_at        TEXT NOT NULL,
      incident_place     TEXT NOT NULL,
      incident_course    TEXT NOT NULL,
      injury_type        TEXT NOT NULL,
      witnesses          TEXT,
      aid_at             TEXT NOT NULL,
      aid_measures       TEXT NOT NULL,
      aider_name         TEXT NOT NULL,
      doctor_visit       INTEGER NOT NULL DEFAULT 0,
      work_stopped       INTEGER NOT NULL DEFAULT 0,
      created_at         TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const stmts = {
    listLocations: db.prepare('SELECT * FROM locations ORDER BY active DESC, name COLLATE NOCASE'),
    getLocation: db.prepare('SELECT * FROM locations WHERE id = ?'),
    getLocationByCode: db.prepare('SELECT * FROM locations WHERE code = ? AND active = 1'),
    insertLocation: db.prepare('INSERT INTO locations (name, code) VALUES (?, ?)'),
    setLocationActive: db.prepare('UPDATE locations SET active = ? WHERE id = ?'),
    setLocationCode: db.prepare('UPDATE locations SET code = ? WHERE id = ?'),
    renameLocation: db.prepare('UPDATE locations SET name = ? WHERE id = ?'),
    countLocations: db.prepare('SELECT COUNT(*) AS n FROM locations'),
    insertEntry: db.prepare(`
      INSERT INTO entries (location_id, location_name, injured_name, injured_department,
        incident_at, incident_place, incident_course, injury_type, witnesses,
        aid_at, aid_measures, aider_name, doctor_visit, work_stopped)
      VALUES (:location_id, :location_name, :injured_name, :injured_department,
        :incident_at, :incident_place, :incident_course, :injury_type, :witnesses,
        :aid_at, :aid_measures, :aider_name, :doctor_visit, :work_stopped)`),
    getEntry: db.prepare('SELECT * FROM entries WHERE id = ?'),
    deleteEntry: db.prepare('DELETE FROM entries WHERE id = ?'),
    deleteOlderThan: db.prepare("DELETE FROM entries WHERE incident_at < ?"),
    countOlderThan: db.prepare("SELECT COUNT(*) AS n FROM entries WHERE incident_at < ?"),
  };

  return {
    raw: db,
    listLocations: () => stmts.listLocations.all(),
    getLocation: (id) => stmts.getLocation.get(id),
    getLocationByCode: (code) => stmts.getLocationByCode.get(normalizeCode(code)),
    createLocation(name) {
      const code = generateCode();
      const r = stmts.insertLocation.run(name, code);
      return stmts.getLocation.get(r.lastInsertRowid);
    },
    renameLocation: (id, name) => stmts.renameLocation.run(name, id),
    setLocationActive: (id, active) => stmts.setLocationActive.run(active ? 1 : 0, id),
    regenerateCode: (id) => stmts.setLocationCode.run(generateCode(), id),
    countLocations: () => stmts.countLocations.get().n,
    insertEntry(entry) {
      const r = stmts.insertEntry.run(entry);
      return Number(r.lastInsertRowid);
    },
    getEntry: (id) => stmts.getEntry.get(id),
    deleteEntry: (id) => stmts.deleteEntry.run(id),
    countOlderThan: (iso) => stmts.countOlderThan.get(iso).n,
    deleteOlderThan: (iso) => stmts.deleteOlderThan.run(iso).changes,
    listEntries({ q, locationId, from, to } = {}) {
      const where = [];
      const params = {};
      if (q) {
        where.push(`(injured_name LIKE :q OR aider_name LIKE :q OR injury_type LIKE :q
                     OR incident_course LIKE :q OR incident_place LIKE :q)`);
        params.q = `%${q}%`;
      }
      if (locationId) { where.push('location_id = :loc'); params.loc = Number(locationId); }
      if (from) { where.push('incident_at >= :from'); params.from = from; }
      if (to) { where.push('incident_at <= :to'); params.to = `${to}T23:59`; }
      const sql = `SELECT * FROM entries ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                   ORDER BY incident_at DESC, id DESC`;
      return db.prepare(sql).all(params);
    },
  };
}

module.exports = { open, generateCode, normalizeCode };
