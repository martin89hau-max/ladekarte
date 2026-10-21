const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { bester, label } = require('../tarife.js');
const tarife = JSON.parse(fs.readFileSync(path.join(__dirname, '../daten/tarife.json'), 'utf8')).tarife;
const preis = (betreiber, karten = [], extra = {}) => bester(
  { betreiber: [betreiber], land: 'FR', dc: true, kwMax: 150, ...extra }, tarife, new Set(karten));

test('Land verhindert deutsche Preise in Frankreich und umgekehrt', () => {
  assert.equal(preis('IONITY GmbH'), null);
  assert.equal(preis('NW IECharge', [], { land: 'DE' }), null);
  assert.equal(preis('IONITY GmbH', [], { land: 'DE' }).v, 72);
  assert.equal(preis('IONITY GmbH', ['IONITY Go'], { land: 'DE' }).v, 68);
});

test('Betreiberschreibweisen und direkte Bruttopreise', () => {
  assert.equal(preis('NW IECharge').v, 25);
  assert.equal(preis('Ionity').v, 55);
  assert.equal(preis('Fastned France').v, 61);
  assert.equal(preis('LIDL France').v, 39);
  assert.equal(preis('Power Dot France'), null);
});

test('App-Rabatte nur nach Auswahl und passend zum Land', () => {
  assert.equal(preis('LIDL France', ['Lidl Plus App']).v, 29);
  assert.equal(preis('Lidl France', ['Lidl Plus App'], { dc: false }).v, 18);
  assert.equal(preis('Lidl Dienstleistung GmbH & Co. KG', ['Lidl Plus App'], { land: 'DE' }).v, 44);
  assert.equal(preis('Fastned France', ['Fastned App (Direktzahlung)']).v, 54.9);
  assert.equal(preis('Ionity', ['IONITY Go']).v, 52);
});

test('Variable Preise verwenden den oberen Wert und zeigen den Bereich', () => {
  const app = preis('ELECTRA', ['Electra App']);
  assert.equal(app.v, 61);
  assert.equal(app.min, 39);
  assert.equal(app.unsicher, true);
  assert.equal(label(app), '39–61 ct/kWh');
  assert.equal(label(preis('IONITY')), 'ab 55 ct/kWh');
});

test('Abos sind ausdrücklich gewählt und enthalten Grundgebühr und Bedingungen', () => {
  assert.equal(preis('Electra').v, 64);
  const smart = preis('Electra', ['Electra+ Smart']);
  assert.equal(smart.v, 41);
  assert.equal(smart.min, 19);
  assert.equal(smart.grund, 4.99);
  assert.equal(preis('IONITY', ['Electra+ Smart']).v, 49);
  assert.equal(preis('Fastned France', ['Electra+ Smart']).v, 49);
  assert.equal(preis('Atlante France', ['Electra+ Smart']).v, 49);
  assert.equal(preis('NW IECharge', ['Electra+ Smart']).v, 25);
});

test('TotalEnergies: Tankstellen, Leistungsklasse und Sonderstandorte', () => {
  const station = 'RELAIS REIMS CHAMPAGNE NORD';
  assert.equal(preis('TotalEnergies Marketing France', [], { station }).v, 65);
  assert.equal(preis('TotalEnergies Marketing France', [], { station, kwMax: 50 }).v, 55);
  assert.equal(preis('TotalEnergies Marketing France', [], { station: 'Relais Marsannay la Côte' }).v, 59);
  assert.equal(preis('TotalEnergies Marketing France', [], { station: 'Parking municipal' }), null);
  assert.equal(preis('TotalEnergies Charging Services', [], { station }), null);
});

test('IZIVIA-Happy-Hour ist nur ein Hinweis, niemals ein allgemeiner 30-ct-Preis', () => {
  const info = preis('IZIVIA', [], { station: "IZIVIA FAST - McDonald's - FREYMING MERLEBACH" });
  assert.equal(info.v, null);
  assert.match(info.hinweis, /Happy-Hour/);
  assert.equal(label(info), 'Preis vor Ort prüfen');
  assert.equal(preis('IZIVIA', [], { station: 'Anderes Netz' }), null);
});

test('Alle französischen Einträge haben prüfbare Primärquellen und Prüfdatum', () => {
  const fr = tarife.filter(t => t.land === 'FR');
  assert.ok(fr.length >= 10);
  for (const t of fr) {
    assert.match(t.quelle, /^https:\/\//);
    assert.equal(t.geprueft, '2026-10-21');
    assert.ok(t.hinweis.length > 20);
    if (t.dcMin != null) assert.ok(t.dcMin <= t.dc);
  }
});
