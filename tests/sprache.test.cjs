// Prüft die französische Sprachfassung: vollständiges Wörterbuch, passende Platzhalter
// und dass jeder Text der Oberfläche einen Eintrag hat.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const Sprache = require('../sprache.js');

const wurzel = path.join(__dirname, '..');
const lies = (datei) => fs.readFileSync(path.join(wurzel, datei), 'utf8');
const platzhalter = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const normal = (s) => String(s).replace(/\s+/g, ' ').trim();
const entities = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
const jsText = (roh) => JSON.parse(`"${roh}"`);

test('Jeder Eintrag hat einen französischen Text mit denselben Platzhaltern', () => {
  const fehler = [];
  for (const [de, fr] of Object.entries(Sprache.FR)) {
    const werte = Array.isArray(fr) ? fr : [fr];
    if (Array.isArray(fr) && fr.length !== 2) fehler.push(`${de}: Ein-/Mehrzahl braucht genau zwei Texte`);
    for (const w of werte) {
      if (typeof w !== 'string' || !w.trim()) fehler.push(`${de}: leer`);
      else if (platzhalter(w).join() !== platzhalter(de).join()) fehler.push(`${de}: Platzhalter ${platzhalter(de)} ≠ ${platzhalter(w)}`);
    }
  }
  assert.deepEqual(fehler, []);
});

test('Alle t(…)- und tn(…)-Aufrufe in index.html, planer.js und tarife.js haben einen Eintrag', () => {
  const fehlt = [];
  for (const datei of ['index.html', 'planer.js', 'tarife.js']) {
    const text = lies(datei);
    for (const m of text.matchAll(/\b(?:t|tr)\(\s*"((?:[^"\\]|\\.)*)"/g)) {
      const key = jsText(m[1]);
      if (typeof Sprache.FR[key] !== 'string') fehlt.push(`${datei}: t("${key}")`);
    }
    for (const m of text.matchAll(/\btn\([^,]+,\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"/g)) {
      const key = jsText(m[2]);
      if (!Array.isArray(Sprache.FR[key])) fehlt.push(`${datei}: tn(…, "${key}") ohne [Einzahl, Mehrzahl]`);
    }
  }
  assert.deepEqual(fehlt, []);
});

test('Warnungen des Rechenkerns haben einen Eintrag (werden bei der Anzeige übersetzt)', () => {
  const kern = lies('planer.js').split('// ===================== Oberfläche')[0];
  const texte = [...kern.matchAll(/warn(?:ungen)?\.push\("((?:[^"\\]|\\.)*)"\)/g)].map((m) => jsText(m[1]));
  assert.ok(texte.length >= 5);
  assert.deepEqual(texte.filter((w) => typeof Sprache.FR[w] !== 'string'), []);
});

test('Festes HTML: alle sichtbaren Texte und Attribute haben einen Eintrag', () => {
  const html = lies('index.html');
  const kopf = html.slice(0, html.indexOf('<body>'));
  const titel = normal(/<title>([\s\S]*?)<\/title>/.exec(kopf)[1]);
  const beschreibung = /<meta name="description" content="([^"]*)"/.exec(kopf)[1];
  const fehlt = [titel, beschreibung].filter((k) => typeof Sprache.FR[k] !== 'string');

  let body = html.slice(html.indexOf('<body>'), html.indexOf('<script'));
  body = body.replace(/<svg[\s\S]*?<\/svg>/g, '');
  for (const m of body.matchAll(/<(\w+)[^>]*\sdata-t-html[^>]*>([\s\S]*?)<\/\1>/g)) {
    const key = normal(m[2]);
    if (typeof Sprache.FR[key] !== 'string') fehlt.push(`data-t-html: ${key}`);
  }
  body = body.replace(/<(\w+)[^>]*\sdata-t-html[^>]*>[\s\S]*?<\/\1>/g, '');
  const ohneText = new Set(['×']);
  for (const m of body.matchAll(/>([^<>]+)</g)) {
    const key = normal(entities(m[1]));
    if (key && !ohneText.has(key) && typeof Sprache.FR[key] !== 'string') fehlt.push(`Text: ${key}`);
  }
  for (const m of body.matchAll(/\s(?:placeholder|aria-label|title|alt)="([^"]+)"/g)) {
    const key = normal(entities(m[1]));
    if (typeof Sprache.FR[key] !== 'string') fehlt.push(`Attribut: ${key}`);
  }
  assert.deepEqual(fehlt, []);
});

test('Sprachwahl: Adresse vor gespeicherter Wahl vor Gerätesprache', () => {
  assert.equal(Sprache.bestimme({ suche: '?lang=fr', gespeichert: 'de', sprachen: ['de-DE'] }), 'fr');
  assert.equal(Sprache.bestimme({ suche: '?lang=de', gespeichert: 'fr', sprachen: ['fr-FR'] }), 'de');
  assert.equal(Sprache.bestimme({ suche: '?lang=xx', gespeichert: 'fr', sprachen: ['de-DE'] }), 'fr');
  assert.equal(Sprache.bestimme({ suche: '', gespeichert: null, sprachen: ['fr-BE', 'de'] }), 'fr');
  assert.equal(Sprache.bestimme({ suche: '', gespeichert: null, sprachen: ['en-US', 'fr'] }), 'fr');
  assert.equal(Sprache.bestimme({ suche: '', gespeichert: null, sprachen: ['en-US'] }), 'de');
  assert.equal(Sprache.bestimme({ suche: '', gespeichert: 'xx', sprachen: [] }), 'de');
});

test('Übersetzen mit Platzhaltern, Ein-/Mehrzahl und französischer Typografie', () => {
  try {
    Sprache.setze('de');
    assert.equal(Sprache.t('Säule {n}', { n: 2 }), 'Säule 2');
    assert.equal(Sprache.tn(1, '{n} Standort', '{n} Standorte'), '1 Standort');
    assert.equal(Sprache.tn(0, '{n} Standort', '{n} Standorte'), '0 Standorte');
    assert.equal(Sprache.t('Gibt es nicht {x}', { x: 1 }), 'Gibt es nicht 1');
    assert.equal(Sprache.locale, 'de-DE');

    Sprache.setze('fr');
    assert.equal(Sprache.t('Säule {n}', { n: 2 }), 'Borne 2');
    assert.equal(Sprache.tn(0, '{n} Standort', '{n} Standorte'), '0 station');
    assert.equal(Sprache.tn(1, '{n} Ladepunkt', '{n} Ladepunkte'), '1 point de charge');
    assert.equal(Sprache.tn(2, '{n} Ladepunkt', '{n} Ladepunkte'), '2 points de charge');
    assert.equal(Sprache.t('Für mich: {preis}', { preis: '39 ct' }), 'Pour moi : 39 ct');
    assert.equal(Sprache.t('„{text}“', { text: 'Lyon' }), '« Lyon »');
    assert.equal(Sprache.t('Gibt es nicht'), 'Gibt es nicht', 'fehlender Eintrag bleibt deutsch');
    assert.equal(Sprache.locale, 'fr-FR');
    assert.equal(Sprache.stecker('Typ 2'), 'Type 2');
    assert.equal(Sprache.stecker('Typ 2 Kabel'), 'Type 2 (câble)');
    assert.equal(Sprache.stecker('CCS'), 'CCS');
    assert.equal(Sprache.daten('Kreditkarte (Lesegerät, kontaktlos)'), 'Carte bancaire (terminal, sans contact)');
    assert.equal(Sprache.daten('Plug & Charge'), 'Plug & Charge');
    assert.equal(Sprache.zeiten('Mo–Fr 08:00–16:00, Sa 09:00–12:00'), 'lun.–ven. 08:00–16:00, sam. 09:00–12:00');
    assert.equal(Sprache.zeiten('Rund um die Uhr'), '24 h/24, 7 j/7');
    assert.equal(Sprache.monat('Oktober 2026'), 'octobre 2026');
  } finally {
    Sprache.setze('de');
  }
});

test('Preistexte aus tarife.js: deutsch ohne sprache.js, französisch mit', () => {
  const LT = require('../tarife.js');
  assert.equal(LT.label({ nutzbar: false }), 'nicht nutzbar');
  assert.equal(LT.label({ v: 39, ab: true }), 'ab 39 ct/kWh');
  try {
    globalThis.t = Sprache.t;
    globalThis.Sprache = Sprache;
    Sprache.setze('fr');
    assert.equal(LT.label({ nutzbar: false }), 'non utilisable');
    assert.equal(LT.label(null), 'Prix à vérifier sur place');
    assert.equal(LT.label({ v: 39.5, ab: true }), 'dès 39,5 ct/kWh');
  } finally {
    Sprache.setze('de');
    delete globalThis.t;
    delete globalThis.Sprache;
  }
});
