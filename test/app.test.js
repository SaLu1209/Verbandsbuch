'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../server');

let server, base, db, dir;
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-'));
  ({ db } = (({ app, db }) => { server = app.listen(0); return { db }; })(createApp({ dataDir: dir, adminPassword: 'geheim' })));
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const form = (o) => new URLSearchParams(o).toString();
const post = (url, body, headers = {}) => fetch(base + url, {
  method: 'POST', redirect: 'manual', body: form(body),
  headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
});
const valid = {
  injured_name: 'Muster, Max', incident_at: '2026-11-17T09:30', incident_place: 'Halle 2',
  incident_course: 'An Blechkante geschnitten', injury_type: 'Schnitt Finger', aid_at: '2026-11-17T09:35',
  aid_measures: 'Pflaster', aider_name: 'Erika Helfer', consent: '1',
};

test('Formular nur mit gültigem Code', async () => {
  const loc = db.createLocation('Werkstatt');
  assert.equal((await fetch(`${base}/e/FALSCH12`)).status, 404);
  const ok = await fetch(`${base}/e/${loc.code}`);
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), /Werkstatt/);
  const r = await post('/code', { code: loc.code.toLowerCase() });
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), `/e/${loc.code}`);
});

test('Eintrag speichern und Validierung', async () => {
  const loc = db.createLocation('Lager');
  const bad = await post(`/e/${loc.code}`, { ...valid, injured_name: '', consent: '' });
  assert.equal(bad.status, 422);
  const r = await post(`/e/${loc.code}`, valid);
  assert.equal(r.status, 303);
  const entries = db.listEntries({ locationId: loc.id });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].injured_name, 'Muster, Max');
});

test('Deaktivierter Standort sperrt Formular', async () => {
  const loc = db.createLocation('Büro');
  db.setLocationActive(loc.id, false);
  assert.equal((await fetch(`${base}/e/${loc.code}`)).status, 404);
  assert.equal((await post(`/e/${loc.code}`, valid)).status, 404);
});

test('Verwaltung erfordert Anmeldung', async () => {
  const r = await fetch(`${base}/admin`, { redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.equal((await post('/admin/login', { password: 'falsch' })).status, 401);
  const login = await post('/admin/login', { password: 'geheim' });
  assert.equal(login.status, 303);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const list = await fetch(`${base}/admin`, { headers: { cookie } });
  assert.equal(list.status, 200);
  assert.match(await list.text(), /Muster, Max/);
  const csv = await fetch(`${base}/admin/export.csv`, { headers: { cookie } });
  assert.match(await csv.text(), /Muster, Max/);
  const qr = await fetch(`${base}/admin/qr/1.svg`, { headers: { cookie } });
  assert.match(await qr.text(), /<svg/);
});
