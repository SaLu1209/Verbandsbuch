'use strict';
// HTML-Vorlagen (serverseitig gerendert, ohne Template-Engine).

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtDateTime(iso) {
  if (!iso) return '';
  const [d, t] = String(iso).split('T');
  const [y, m, day] = d.split('-');
  return `${day}.${m}.${y}${t ? ', ' + t.slice(0, 5) + ' Uhr' : ''}`;
}

const CROSS = `<svg class="cross" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="4" fill="currentColor"/><path d="M10 6h4v4h4v4h-4v4h-4v-4H6v-4h4z" fill="#fff"/></svg>`;

function layout({ title, body, admin = false, org = '' }) {
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)} · Verbandsbuch</title>
<link rel="stylesheet" href="/static/style.css">
</head>
<body>
<header class="topbar">
  <a class="brand" href="${admin ? '/admin' : '/'}">${CROSS}<span>Verbandsbuch${org ? ` <small>${esc(org)}</small>` : ''}</span></a>
  ${admin ? `<nav class="adminnav">
    <a href="/admin">Einträge</a>
    <a href="/admin/standorte">Standorte &amp; QR-Codes</a>
    <form method="post" action="/admin/logout"><button class="linkbtn">Abmelden</button></form>
  </nav>` : ''}
</header>
<main class="${admin ? 'wide' : ''}">
${body}
</main>
</body>
</html>`;
}

function flash(msg, kind = 'info') {
  return msg ? `<div class="flash ${kind}" role="status">${esc(msg)}</div>` : '';
}

// ---------- Öffentlicher Bereich ----------

function codePage({ error, org }) {
  return layout({
    title: 'Code eingeben',
    org,
    body: `
<section class="card narrow center">
  <h1>Erste-Hilfe-Leistung dokumentieren</h1>
  <p class="muted">Scannen Sie den QR-Code am Verbandkasten oder geben Sie den dort aufgedruckten Zugangscode ein.</p>
  ${flash(error, 'error')}
  <form method="post" action="/code" class="codeform" autocomplete="off">
    <label for="code">Zugangscode</label>
    <input id="code" name="code" class="codeinput" inputmode="text" autocapitalize="characters"
           spellcheck="false" maxlength="12" placeholder="z. B. K7M2Q9XA" required autofocus>
    <button class="btn primary">Formular öffnen</button>
  </form>
</section>`,
  });
}

function nowLocal() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function field(name, label, { type = 'text', required = true, value = '', hint = '', rows, attrs = '' } = {}) {
  const req = required ? ' required' : '';
  const star = required ? ' <span class="req" aria-hidden="true">*</span>' : ' <span class="opt">(optional)</span>';
  const input = rows
    ? `<textarea id="${name}" name="${name}" rows="${rows}"${req} ${attrs}>${esc(value)}</textarea>`
    : `<input id="${name}" name="${name}" type="${type}" value="${esc(value)}"${req} ${attrs}>`;
  return `<div class="field">
    <label for="${name}">${label}${star}</label>
    ${hint ? `<p class="hint">${hint}</p>` : ''}
    ${input}
  </div>`;
}

function check(name, label, checked) {
  return `<label class="check"><input type="checkbox" name="${name}" value="1"${checked ? ' checked' : ''}> ${label}</label>`;
}

function formPage({ location, values = {}, errors = [], org }) {
  const v = (k) => values[k] ?? '';
  const now = nowLocal();
  return layout({
    title: 'Neuer Eintrag',
    org,
    body: `
<section class="card">
  <p class="eyebrow">Standort: <strong>${esc(location.name)}</strong></p>
  <h1>Eintrag ins Verbandsbuch</h1>
  <p class="muted">Dokumentation von Erste-Hilfe-Leistungen nach § 24 Abs. 6 DGUV Vorschrift 1.
  Ihre Angaben sind nach dem Absenden nur für berechtigte Personen (z.&nbsp;B. Arbeitsschutz) einsehbar.</p>
  ${errors.length ? `<div class="flash error" role="alert"><strong>Bitte prüfen:</strong><ul>${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
  <form method="post" action="/e/${esc(location.code)}" class="entryform" novalidate>
    <fieldset>
      <legend><span class="num">1</span> Verletzte Person</legend>
      <div class="grid2">
        ${field('injured_name', 'Name, Vorname', { value: v('injured_name'), attrs: 'autocomplete="name" maxlength="120"' })}
        ${field('injured_department', 'Abteilung / Bereich', { required: false, value: v('injured_department'), attrs: 'maxlength="120"' })}
      </div>
    </fieldset>

    <fieldset>
      <legend><span class="num">2</span> Unfall bzw. Erkrankung</legend>
      <div class="grid2">
        ${field('incident_at', 'Datum und Uhrzeit', { type: 'datetime-local', value: v('incident_at') || now, attrs: `max="${now}"` })}
        ${field('incident_place', 'Ort (Unternehmensteil)', { value: v('incident_place') || location.name, attrs: 'maxlength="160"' })}
      </div>
      ${field('incident_course', 'Hergang', { rows: 3, value: v('incident_course'), hint: 'Was ist passiert? Kurz und sachlich beschreiben.', attrs: 'maxlength="2000"' })}
      ${field('injury_type', 'Art und Umfang der Verletzung / Erkrankung', { rows: 2, value: v('injury_type'), hint: 'z. B. Schnittwunde am linken Zeigefinger, ca. 1 cm', attrs: 'maxlength="1000"' })}
      ${field('witnesses', 'Zeugen', { required: false, value: v('witnesses'), attrs: 'maxlength="300"' })}
    </fieldset>

    <fieldset>
      <legend><span class="num">3</span> Erste-Hilfe-Leistung</legend>
      <div class="grid2">
        ${field('aid_at', 'Datum und Uhrzeit', { type: 'datetime-local', value: v('aid_at') || now, attrs: `max="${now}"` })}
        ${field('aider_name', 'Name der/des Erste-Hilfe-Leistenden', { value: v('aider_name'), attrs: 'maxlength="120"' })}
      </div>
      ${field('aid_measures', 'Art und Weise der Erste-Hilfe-Maßnahmen', { rows: 3, value: v('aid_measures'), hint: 'z. B. Wunde gereinigt, Pflaster angelegt, Kühlung', attrs: 'maxlength="2000"' })}
      <div class="checks">
        ${check('doctor_visit', 'Arztbesuch / Weiterbehandlung erforderlich', values.doctor_visit)}
        ${check('work_stopped', 'Arbeit wurde unterbrochen bzw. beendet', values.work_stopped)}
      </div>
    </fieldset>

    <label class="check consent"><input type="checkbox" name="consent" value="1" required${values.consent ? ' checked' : ''}>
      Ich bestätige, dass die Angaben wahrheitsgemäß sind. Die Daten werden ausschließlich zur Dokumentation
      gemäß DGUV Vorschrift 1 verarbeitet und mindestens 5 Jahre vertraulich aufbewahrt.</label>

    <button class="btn primary big">Eintrag speichern</button>
  </form>
</section>`,
  });
}

function thanksPage({ location, id, org }) {
  return layout({
    title: 'Gespeichert',
    org,
    body: `
<section class="card narrow center">
  <div class="okmark" aria-hidden="true">✓</div>
  <h1>Vielen Dank!</h1>
  <p>Der Eintrag wurde unter der Nummer <strong>#${id}</strong> im Verbandsbuch gespeichert.</p>
  <p class="muted">Bei Arbeitsunfällen mit mehr als 3 Tagen Arbeitsunfähigkeit ist zusätzlich eine
  Unfallanzeige an die Berufsgenossenschaft erforderlich. Bitte informieren Sie Ihre Führungskraft.</p>
  <a class="btn" href="/e/${esc(location.code)}">Weiteren Eintrag erfassen</a>
</section>`,
  });
}

function messagePage({ title, text, org }) {
  return layout({ title, org, body: `<section class="card narrow center"><h1>${esc(title)}</h1><p>${esc(text)}</p><a class="btn" href="/">Zur Startseite</a></section>` });
}

// ---------- Verwaltung ----------

function loginPage({ error, org }) {
  return layout({
    title: 'Anmeldung',
    org,
    body: `
<section class="card narrow">
  <h1>Verwaltung</h1>
  <p class="muted">Zugang nur für berechtigte Personen.</p>
  ${flash(error, 'error')}
  <form method="post" action="/admin/login">
    <div class="field"><label for="password">Passwort</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required autofocus></div>
    <button class="btn primary">Anmelden</button>
  </form>
</section>`,
  });
}

function entriesPage({ entries, locations, filter, msg, org }) {
  const qs = new URLSearchParams(Object.entries(filter).filter(([, v]) => v)).toString();
  const rows = entries.map((e) => `
    <tr>
      <td data-label="Nr."><a href="/admin/eintrag/${e.id}">#${e.id}</a></td>
      <td data-label="Unfall">${esc(fmtDateTime(e.incident_at))}</td>
      <td data-label="Verletzte Person">${esc(e.injured_name)}</td>
      <td data-label="Verletzung">${esc(e.injury_type)}</td>
      <td data-label="Ersthelfer/in">${esc(e.aider_name)}</td>
      <td data-label="Standort">${esc(e.location_name)}</td>
      <td data-label="Hinweise">${e.doctor_visit ? '<span class="tag warn">Arzt</span>' : ''}${e.work_stopped ? '<span class="tag">Arbeit unterbr.</span>' : ''}</td>
    </tr>`).join('');
  return layout({
    title: 'Einträge',
    admin: true,
    org,
    body: `
${flash(msg)}
<div class="headrow">
  <h1>Einträge <span class="count">${entries.length}</span></h1>
  <div class="actions">
    <a class="btn" href="/admin/export.csv${qs ? '?' + qs : ''}">CSV-Export</a>
    <a class="btn" href="/admin/druck${qs ? '?' + qs : ''}" target="_blank">Drucken / PDF</a>
  </div>
</div>
<form class="filters" method="get" action="/admin">
  <input name="q" type="search" placeholder="Suche (Name, Verletzung, Hergang …)" value="${esc(filter.q)}">
  <select name="standort">
    <option value="">Alle Standorte</option>
    ${locations.map((l) => `<option value="${l.id}"${String(l.id) === String(filter.standort) ? ' selected' : ''}>${esc(l.name)}</option>`).join('')}
  </select>
  <label>von <input name="von" type="date" value="${esc(filter.von)}"></label>
  <label>bis <input name="bis" type="date" value="${esc(filter.bis)}"></label>
  <button class="btn">Filtern</button>
  ${qs ? '<a href="/admin" class="linkbtn">Zurücksetzen</a>' : ''}
</form>
${entries.length ? `<div class="tablewrap"><table class="entries">
  <thead><tr><th>Nr.</th><th>Unfall</th><th>Verletzte Person</th><th>Verletzung</th><th>Ersthelfer/in</th><th>Standort</th><th>Hinweise</th></tr></thead>
  <tbody>${rows}</tbody></table></div>`
    : `<div class="card center muted">${locations.length ? 'Keine Einträge gefunden.' : 'Noch keine Standorte angelegt. <a href="/admin/standorte">Jetzt ersten Standort mit QR-Code anlegen →</a>'}</div>`}
`,
  });
}

function entryDetail(e) {
  const row = (label, value) => `<div class="kv"><dt>${label}</dt><dd>${esc(value) || '<span class="muted">–</span>'}</dd></div>`;
  return `
  <dl class="detail">
    <h3>Verletzte Person</h3>
    ${row('Name', e.injured_name)}
    ${row('Abteilung / Bereich', e.injured_department)}
    <h3>Unfall / Erkrankung</h3>
    ${row('Datum, Uhrzeit', fmtDateTime(e.incident_at))}
    ${row('Ort', e.incident_place)}
    ${row('Hergang', e.incident_course)}
    ${row('Art und Umfang der Verletzung', e.injury_type)}
    ${row('Zeugen', e.witnesses)}
    <h3>Erste-Hilfe-Leistung</h3>
    ${row('Datum, Uhrzeit', fmtDateTime(e.aid_at))}
    ${row('Maßnahmen', e.aid_measures)}
    ${row('Erste-Hilfe-Leistende/r', e.aider_name)}
    ${row('Arztbesuch erforderlich', e.doctor_visit ? 'Ja' : 'Nein')}
    ${row('Arbeit unterbrochen', e.work_stopped ? 'Ja' : 'Nein')}
    <h3>Erfassung</h3>
    ${row('Standort (Verbandkasten)', e.location_name)}
    ${row('Erfasst am (UTC)', fmtDateTime(e.created_at.replace(' ', 'T')))}
  </dl>`;
}

function entryPage({ entry, org }) {
  return layout({
    title: `Eintrag #${entry.id}`,
    admin: true,
    org,
    body: `
<p><a href="/admin">← Alle Einträge</a></p>
<section class="card">
  <div class="headrow">
    <h1>Eintrag #${entry.id}</h1>
    <div class="actions">
      <a class="btn" href="/admin/druck?id=${entry.id}" target="_blank">Drucken</a>
      <form method="post" action="/admin/eintrag/${entry.id}/loeschen" onsubmit="return confirm('Eintrag #${entry.id} endgültig löschen? Einträge sind mindestens 5 Jahre aufzubewahren.')">
        <button class="btn danger">Löschen</button>
      </form>
    </div>
  </div>
  ${entryDetail(entry)}
</section>`,
  });
}

function printPage({ entries, org }) {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Verbandsbuch – Ausdruck</title>
<link rel="stylesheet" href="/static/style.css"></head>
<body class="print">
<header class="printhead"><h1>Verbandsbuch${org ? ' – ' + esc(org) : ''}</h1>
<p>Ausdruck vom ${esc(fmtDateTime(nowLocal()))} · ${entries.length} Eintr${entries.length === 1 ? 'ag' : 'äge'} · Vertraulich – personenbezogene Daten</p>
<button class="btn noprint" onclick="window.print()">Drucken</button></header>
${entries.map((e) => `<article class="printentry"><h2>Eintrag #${e.id}</h2>${entryDetail(e)}</article>`).join('')}
</body></html>`;
}

function locationsPage({ locations, baseUrl, msg, org, retention }) {
  const cards = locations.map((l) => `
  <div class="loc card${l.active ? '' : ' inactive'}">
    <img class="qr" src="/admin/qr/${l.id}.svg" alt="QR-Code für ${esc(l.name)}" width="140" height="140">
    <div class="locinfo">
      <form method="post" action="/admin/standorte/${l.id}/umbenennen" class="rename">
        <input name="name" value="${esc(l.name)}" maxlength="120" aria-label="Name des Standorts" required>
        <button class="btn small">Speichern</button>
      </form>
      <p>Code: <code class="bigcode">${esc(l.code)}</code> ${l.active ? '<span class="tag ok">aktiv</span>' : '<span class="tag">deaktiviert</span>'}</p>
      <p class="url"><a href="${esc(baseUrl)}/e/${esc(l.code)}" target="_blank">${esc(baseUrl)}/e/${esc(l.code)}</a></p>
      <div class="actions">
        <a class="btn small primary" href="/admin/standorte/${l.id}/aushang" target="_blank">Aushang drucken</a>
        <form method="post" action="/admin/standorte/${l.id}/neuer-code" onsubmit="return confirm('Neuen Code erzeugen? Der alte QR-Code funktioniert danach nicht mehr.')"><button class="btn small">Neuer Code</button></form>
        <form method="post" action="/admin/standorte/${l.id}/${l.active ? 'deaktivieren' : 'aktivieren'}"><button class="btn small">${l.active ? 'Deaktivieren' : 'Aktivieren'}</button></form>
      </div>
    </div>
  </div>`).join('');
  return layout({
    title: 'Standorte',
    admin: true,
    org,
    body: `
${flash(msg)}
<h1>Standorte &amp; QR-Codes</h1>
<p class="muted">Jeder Verbandkasten bzw. Standort erhält einen eigenen Zugangscode. Drucken Sie den Aushang aus und
bringen Sie ihn am Verbandkasten an. Wer den QR-Code scannt oder den Code eingibt, gelangt direkt zum Formular.</p>
<form method="post" action="/admin/standorte" class="card inline">
  <input name="name" placeholder="z. B. Werkstatt Halle 2 – Verbandkasten links" maxlength="120" required>
  <button class="btn primary">Standort anlegen</button>
</form>
<div class="locs">${cards || '<p class="muted">Noch keine Standorte vorhanden.</p>'}</div>
<section class="card">
  <h2>Aufbewahrung</h2>
  <p class="muted">Aufzeichnungen sind mindestens 5 Jahre aufzubewahren (§ 24 Abs. 6 DGUV Vorschrift 1).
  Es gibt ${retention.count} Eintr${retention.count === 1 ? 'ag' : 'äge'} mit Unfalldatum vor dem ${esc(fmtDateTime(retention.cutoff))}.</p>
  ${retention.count ? `<form method="post" action="/admin/aufbewahrung" onsubmit="return confirm('${retention.count} Einträge älter als 5 Jahre endgültig löschen?')"><button class="btn danger">Einträge älter als 5 Jahre löschen</button></form>` : ''}
</section>`,
  });
}

function posterPage({ location, url, svg, org }) {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Aushang – ${esc(location.name)}</title>
<link rel="stylesheet" href="/static/style.css"></head>
<body class="poster">
<button class="btn noprint" onclick="window.print()">Drucken</button>
<div class="sheet">
  <div class="posterhead">${CROSS}<div><h1>Verbandsbuch</h1>${org ? `<p>${esc(org)}</p>` : ''}</div></div>
  <p class="lead">Erste Hilfe geleistet? Bitte <strong>jede</strong> Erste-Hilfe-Leistung dokumentieren – auch kleine Verletzungen.</p>
  <div class="qrbig">${svg}</div>
  <ol class="steps">
    <li>QR-Code mit dem Smartphone scannen</li>
    <li>Formular ausfüllen</li>
    <li>Absenden – fertig</li>
  </ol>
  <p class="alt">Ohne QR-Scanner: <strong>${esc(url.replace(/\/e\/.*$/, ''))}</strong> öffnen und Code eingeben:</p>
  <p class="postercode">${esc(location.code)}</p>
  <p class="foot">Standort: ${esc(location.name)}</p>
</div>
</body></html>`;
}

module.exports = {
  esc, fmtDateTime, codePage, formPage, thanksPage, messagePage,
  loginPage, entriesPage, entryPage, printPage, locationsPage, posterPage,
};
