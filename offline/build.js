'use strict';
// Baut die Offline-Version als eine einzige HTML-Datei (offline/verbandsbuch.html).
// Aufruf: npm run build:offline
const fs = require('node:fs');
const path = require('node:path');
const dir = __dirname;
const src = fs.readFileSync(path.join(dir, 'app.src.html'), 'utf8');
const css = fs.readFileSync(path.join(dir, '..', 'public', 'style.css'), 'utf8');
const qr = fs.readFileSync(path.join(dir, 'qrcode.min.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
const out = src.replace('/*STYLE*/', () => css).replace('/*QRCODE*/', () => qr);
fs.writeFileSync(path.join(dir, 'verbandsbuch.html'), out);
console.log(`offline/verbandsbuch.html geschrieben (${Math.round(out.length / 1024)} KB)`);
