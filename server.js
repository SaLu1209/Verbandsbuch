'use strict';
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');
const QRCode = require('qrcode');
const store = require('./lib/db');
const views = require('./lib/views');

function createApp(options = {}) {
  const config = {
    dataDir: options.dataDir || process.env.DATA_DIR || path.join(__dirname, 'data'),
    adminPassword: options.adminPassword ?? process.env.ADMIN_PASSWORD,
    baseUrl: (options.baseUrl ?? process.env.BASE_URL ?? '').replace(/\/+$/, ''),
    org: options.org ?? process.env.ORG_NAME ?? '',
    secureCookies: options.secureCookies ?? process.env.SECURE_COOKIES === '1',
  };

  const db = store.open(config.dataDir);

  // Admin-Passwort: aus Umgebungsvariable oder beim ersten Start erzeugt und gespeichert.
  if (!config.adminPassword) {
    const pwFile = path.join(config.dataDir, 'admin-passwort.txt');
    if (!fs.existsSync(pwFile)) {
      fs.writeFileSync(pwFile, store.generateCode(12) + '\n', { mode: 0o600 });
      console.log(`[verbandsbuch] Admin-Passwort erzeugt: ${pwFile}`);
    }
    config.adminPassword = fs.readFileSync(pwFile, 'utf8').trim();
  }

  // Schlüssel zum Signieren der Sitzungs-Cookies.
  const secretFile = path.join(config.dataDir, 'session-secret');
  if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  const sessionSecret = fs.readFileSync(secretFile, 'utf8').trim();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(express.urlencoded({ extended: false, limit: '50kb' }));
  app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
    });
    next();
  });

  const baseUrl = (req) => config.baseUrl || `${req.protocol}://${req.get('host')}`;
  const render = (res, html, status = 200) => res.status(status).type('html').send(html);

  // ---------- Einfache Begrenzung von Fehlversuchen (Code-Raten, Passwort-Raten) ----------
  const attempts = new Map();
  function tooManyAttempts(key, max = 10, windowMs = 15 * 60 * 1000) {
    const now = Date.now();
    const a = attempts.get(key);
    if (!a || now - a.start > windowMs) return false;
    return a.count >= max;
  }
  function recordFailure(key) {
    const now = Date.now();
    const a = attempts.get(key);
    if (!a || now - a.start > 15 * 60 * 1000) attempts.set(key, { start: now, count: 1 });
    else a.count++;
  }

  // ---------- Sitzung (signiertes Cookie) ----------
  const COOKIE = 'vb_admin';
  const SESSION_HOURS = 8;
  const sign = (value) => crypto.createHmac('sha256', sessionSecret).update(value).digest('hex');
  function readCookie(req, name) {
    const header = req.headers.cookie || '';
    for (const part of header.split(';')) {
      const [k, ...v] = part.trim().split('=');
      if (k === name) return decodeURIComponent(v.join('='));
    }
    return null;
  }
  function isAdmin(req) {
    const c = readCookie(req, COOKIE);
    if (!c) return false;
    const [expires, sig] = c.split('.');
    if (!expires || !sig || Number(expires) < Date.now()) return false;
    const expected = sign(expires);
    return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  }
  function setSession(res) {
    const expires = String(Date.now() + SESSION_HOURS * 3600 * 1000);
    res.cookie(COOKIE, `${expires}.${sign(expires)}`, {
      httpOnly: true, sameSite: 'strict', secure: config.secureCookies, maxAge: SESSION_HOURS * 3600 * 1000, path: '/',
    });
  }
  function requireAdmin(req, res, next) {
    if (isAdmin(req)) {
      res.set('Cache-Control', 'no-store');
      return next();
    }
    if (req.method === 'GET') return res.redirect('/admin/login');
    return res.status(401).send('Nicht angemeldet');
  }

  // ---------- Öffentlicher Bereich ----------
  app.get('/', (req, res) => render(res, views.codePage({ org: config.org })));

  app.post('/code', (req, res) => {
    const ip = req.ip;
    if (tooManyAttempts('code:' + ip, 20)) {
      return render(res, views.codePage({ org: config.org, error: 'Zu viele Fehlversuche. Bitte später erneut versuchen.' }), 429);
    }
    const location = db.getLocationByCode(req.body.code);
    if (!location) {
      recordFailure('code:' + ip);
      return render(res, views.codePage({ org: config.org, error: 'Unbekannter oder deaktivierter Code.' }), 404);
    }
    res.redirect(303, `/e/${location.code}`);
  });

  function findLocation(req, res) {
    const location = db.getLocationByCode(req.params.code);
    if (!location) {
      render(res, views.messagePage({ org: config.org, title: 'Code ungültig', text: 'Dieser QR-Code bzw. Zugangscode ist unbekannt oder wurde deaktiviert. Bitte wenden Sie sich an die Arbeitssicherheit.' }), 404);
      return null;
    }
    return location;
  }

  app.get('/e/:code', (req, res) => {
    const location = findLocation(req, res);
    if (location) render(res, views.formPage({ location, org: config.org }));
  });

  const DT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
  const LIMITS = {
    injured_name: 120, injured_department: 120, incident_place: 160, incident_course: 2000,
    injury_type: 1000, witnesses: 300, aid_measures: 2000, aider_name: 120,
  };

  function validate(body) {
    const v = {};
    for (const [k, max] of Object.entries(LIMITS)) v[k] = String(body[k] ?? '').trim().slice(0, max);
    v.incident_at = String(body.incident_at ?? '').trim();
    v.aid_at = String(body.aid_at ?? '').trim();
    v.doctor_visit = body.doctor_visit === '1' ? 1 : 0;
    v.work_stopped = body.work_stopped === '1' ? 1 : 0;
    v.consent = body.consent === '1';

    const errors = [];
    if (!v.injured_name) errors.push('Name der verletzten Person fehlt.');
    if (!DT.test(v.incident_at)) errors.push('Datum/Uhrzeit des Unfalls fehlt oder ist ungültig.');
    if (!v.incident_place) errors.push('Ort des Unfalls fehlt.');
    if (!v.incident_course) errors.push('Hergang fehlt.');
    if (!v.injury_type) errors.push('Art und Umfang der Verletzung fehlen.');
    if (!DT.test(v.aid_at)) errors.push('Datum/Uhrzeit der Erste-Hilfe-Leistung fehlt oder ist ungültig.');
    if (!v.aid_measures) errors.push('Erste-Hilfe-Maßnahmen fehlen.');
    if (!v.aider_name) errors.push('Name der/des Erste-Hilfe-Leistenden fehlt.');
    if (DT.test(v.incident_at) && DT.test(v.aid_at) && v.aid_at < v.incident_at) {
      errors.push('Die Erste Hilfe kann nicht vor dem Unfall geleistet worden sein.');
    }
    if (!v.consent) errors.push('Bitte bestätigen Sie die Angaben (Häkchen unten).');
    return { values: v, errors };
  }

  app.post('/e/:code', (req, res) => {
    const location = findLocation(req, res);
    if (!location) return;
    const { values, errors } = validate(req.body);
    if (errors.length) return render(res, views.formPage({ location, values, errors, org: config.org }), 422);
    const { consent, ...entry } = values;
    const id = db.insertEntry({ ...entry, injured_department: entry.injured_department || null, witnesses: entry.witnesses || null, location_id: location.id, location_name: location.name });
    res.redirect(303, `/e/${location.code}/danke/${id}`);
  });

  app.get('/e/:code/danke/:id', (req, res) => {
    const location = findLocation(req, res);
    if (location) render(res, views.thanksPage({ location, id: Number(req.params.id) || '', org: config.org }));
  });

  // ---------- Verwaltung ----------
  app.get('/admin/login', (req, res) => {
    if (isAdmin(req)) return res.redirect('/admin');
    render(res, views.loginPage({ org: config.org }));
  });

  app.post('/admin/login', (req, res) => {
    const key = 'login:' + req.ip;
    if (tooManyAttempts(key, 5)) {
      return render(res, views.loginPage({ org: config.org, error: 'Zu viele Fehlversuche. Bitte 15 Minuten warten.' }), 429);
    }
    const given = crypto.createHash('sha256').update(String(req.body.password || '')).digest();
    const expected = crypto.createHash('sha256').update(config.adminPassword).digest();
    if (!crypto.timingSafeEqual(given, expected)) {
      recordFailure(key);
      return render(res, views.loginPage({ org: config.org, error: 'Passwort falsch.' }), 401);
    }
    attempts.delete(key);
    setSession(res);
    res.redirect(303, '/admin');
  });

  app.post('/admin/logout', (req, res) => {
    res.clearCookie(COOKIE, { path: '/' });
    res.redirect(303, '/admin/login');
  });

  app.use('/admin', requireAdmin);

  function readFilter(q) {
    return {
      q: String(q.q || '').trim(),
      standort: String(q.standort || ''),
      von: /^\d{4}-\d{2}-\d{2}$/.test(q.von) ? q.von : '',
      bis: /^\d{4}-\d{2}-\d{2}$/.test(q.bis) ? q.bis : '',
    };
  }
  const queryEntries = (f) => db.listEntries({ q: f.q, locationId: f.standort, from: f.von, to: f.bis });

  app.get('/admin', (req, res) => {
    const filter = readFilter(req.query);
    render(res, views.entriesPage({ entries: queryEntries(filter), locations: db.listLocations(), filter, msg: req.query.msg, org: config.org }));
  });

  app.get('/admin/eintrag/:id', (req, res) => {
    const entry = db.getEntry(Number(req.params.id));
    if (!entry) return res.redirect('/admin');
    render(res, views.entryPage({ entry, org: config.org }));
  });

  app.post('/admin/eintrag/:id/loeschen', (req, res) => {
    db.deleteEntry(Number(req.params.id));
    res.redirect(303, '/admin?msg=' + encodeURIComponent(`Eintrag #${Number(req.params.id)} gelöscht.`));
  });

  app.get('/admin/druck', (req, res) => {
    let entries;
    if (req.query.id) {
      const e = db.getEntry(Number(req.query.id));
      entries = e ? [e] : [];
    } else {
      entries = queryEntries(readFilter(req.query));
    }
    render(res, views.printPage({ entries, org: config.org }));
  });

  app.get('/admin/export.csv', (req, res) => {
    const entries = queryEntries(readFilter(req.query));
    const cols = [
      ['id', 'Nr.'], ['incident_at', 'Unfall Datum/Uhrzeit'], ['incident_place', 'Ort'], ['injured_name', 'Verletzte Person'],
      ['injured_department', 'Abteilung'], ['incident_course', 'Hergang'], ['injury_type', 'Art/Umfang der Verletzung'],
      ['witnesses', 'Zeugen'], ['aid_at', 'Erste Hilfe Datum/Uhrzeit'], ['aid_measures', 'Maßnahmen'],
      ['aider_name', 'Erste-Hilfe-Leistende/r'], ['doctor_visit', 'Arztbesuch'], ['work_stopped', 'Arbeit unterbrochen'],
      ['location_name', 'Standort'], ['created_at', 'Erfasst am (UTC)'],
    ];
    const cell = (v) => {
      let s = String(v ?? '');
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // Schutz vor Formel-Injection in Excel
      return `"${s.replace(/"/g, '""')}"`;
    };
    const lines = [cols.map(([, h]) => cell(h)).join(';')];
    for (const e of entries) {
      lines.push(cols.map(([k]) => cell(k === 'doctor_visit' || k === 'work_stopped' ? (e[k] ? 'ja' : 'nein') : e[k])).join(';'));
    }
    const date = new Date().toISOString().slice(0, 10);
    res.set('Content-Disposition', `attachment; filename="verbandsbuch-${date}.csv"`);
    res.type('text/csv; charset=utf-8').send('﻿' + lines.join('\r\n'));
  });

  // Standorte & QR-Codes
  app.get('/admin/standorte', (req, res) => {
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 5);
    const cutoffIso = cutoff.toISOString().slice(0, 10) + 'T00:00';
    render(res, views.locationsPage({
      locations: db.listLocations(), baseUrl: baseUrl(req), msg: req.query.msg, org: config.org,
      retention: { cutoff: cutoffIso, count: db.countOlderThan(cutoffIso) },
    }));
  });

  const back = (res, msg) => res.redirect(303, '/admin/standorte?msg=' + encodeURIComponent(msg));

  app.post('/admin/standorte', (req, res) => {
    const name = String(req.body.name || '').trim().slice(0, 120);
    if (!name) return back(res, 'Bitte einen Namen angeben.');
    const l = db.createLocation(name);
    back(res, `Standort „${l.name}“ angelegt (Code ${l.code}).`);
  });

  app.post('/admin/standorte/:id/umbenennen', (req, res) => {
    const name = String(req.body.name || '').trim().slice(0, 120);
    if (name) db.renameLocation(Number(req.params.id), name);
    back(res, 'Name gespeichert.');
  });
  app.post('/admin/standorte/:id/neuer-code', (req, res) => {
    db.regenerateCode(Number(req.params.id));
    back(res, 'Neuer Code erzeugt – bitte Aushang neu drucken.');
  });
  app.post('/admin/standorte/:id/deaktivieren', (req, res) => {
    db.setLocationActive(Number(req.params.id), false);
    back(res, 'Standort deaktiviert – der QR-Code ist gesperrt.');
  });
  app.post('/admin/standorte/:id/aktivieren', (req, res) => {
    db.setLocationActive(Number(req.params.id), true);
    back(res, 'Standort aktiviert.');
  });

  app.post('/admin/aufbewahrung', (req, res) => {
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 5);
    const n = db.deleteOlderThan(cutoff.toISOString().slice(0, 10) + 'T00:00');
    back(res, `${n} Einträge gelöscht.`);
  });

  const qrSvg = (text) => QRCode.toString(text, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, color: { dark: '#000000', light: '#ffffff' } });

  app.get('/admin/qr/:id.svg', async (req, res, next) => {
    try {
      const l = db.getLocation(Number(req.params.id));
      if (!l) return res.sendStatus(404);
      res.type('image/svg+xml').send(await qrSvg(`${baseUrl(req)}/e/${l.code}`));
    } catch (err) { next(err); }
  });

  app.get('/admin/standorte/:id/aushang', async (req, res, next) => {
    try {
      const location = db.getLocation(Number(req.params.id));
      if (!location) return res.redirect('/admin/standorte');
      const url = `${baseUrl(req)}/e/${location.code}`;
      render(res, views.posterPage({ location, url, svg: await qrSvg(url), org: config.org }));
    } catch (err) { next(err); }
  });

  app.use((req, res) => render(res, views.messagePage({ org: config.org, title: 'Seite nicht gefunden', text: 'Die angeforderte Seite existiert nicht.' }), 404));

  return { app, db, config };
}

if (require.main === module) {
  const { app, config } = createApp();
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => {
    console.log(`[verbandsbuch] läuft auf http://localhost:${port}`);
    console.log(`[verbandsbuch] Verwaltung: http://localhost:${port}/admin  (Daten in ${config.dataDir})`);
  });
}

module.exports = { createApp };
