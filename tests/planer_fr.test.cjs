const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const LadeTarife = require('../tarife.js');
const tarife = JSON.parse(fs.readFileSync(path.join(__dirname, '../daten/tarife.json'), 'utf8')).tarife;

test('Korsika: Datenfehler anzeigen, erneut laden und französische Stopps zuordnen', async () => {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, {
      value: '', innerHTML: '', textContent: '', handlers: {},
      addEventListener(type, callback) { this.handlers[type] = callback; },
      classList: { contains: () => true, add() {}, remove() {}, toggle: () => true },
      setAttribute() {}, focus() {},
    });
    return elements.get(id);
  };
  element('planer-von').value = '43.0,9.45';
  element('planer-nach').value = '41.5,9.45';
  element('planer-abfahrt').value = '08:00';   // feste Abfahrt, damit die Uhrzeiten gleich bleiben
  let valhallaRequests = 0;
  const layer = () => ({ addTo() { return this; }, clearLayers() {}, bindPopup() {}, getBounds() { return []; } });
  const errors = [];
  let franceRequests = 0;
  const fr = {
    betreiber: ['NW IECharge'], orte: ['Corse Nord', 'Corse Sud'],
    standorte: [[42.5, 9.45, 150, 1, 0, 2, 'FR1', 0], [42.0, 9.45, 150, 1, 0, 2, 'FR2', 1]],
  };
  const regionaleEntfernung = (a, b) => a.lat - b.lat;
  const context = {
    entfernungKm: regionaleEntfernung,
    datenBereit: Promise.resolve(),
    LadeTarife,
    document: {}, karte: { fitBounds() {} }, $: element,
    L: { layerGroup: layer, polyline: layer, marker: layer, divIcon: () => ({}) },
    localStorage: { getItem: () => JSON.stringify({ akku: 20 }), setItem() {} },
    ausgeblendet: new Set(), eigenerPreis: (st) => LadeTarife.bester(st, tarife), esc: String,
    alleTarife: () => tarife, karten: new Set(),
    ich: null, amRechner: { matches: false }, routeLink: () => '#',
    melde: (message) => errors.push(message),
    console: { warn() {}, error: (error) => errors.push(error.message) },
    setTimeout: (callback) => callback(),
    fetch: async (url) => {
      if (url === 'daten/fr.json') {
        franceRequests++;
        if (franceRequests === 1) return { ok: false, status: 503 };
        return { ok: true, json: async () => structuredClone(fr) };
      }
      if (url === 'daten/de.json') return { ok: true, json: async () => ({
        betreiber: ['Deutscher Betreiber'], orte: ['Deutscher Ort'], standorte: [],
      }) };
      if (url.startsWith('https://valhalla1.openstreetmap.de/route?json=')) {
        valhallaRequests++;
        return { ok: false, status: 503 };            // Zusatzstrecken dürfen ausfallen
      }
      assert.ok(url.startsWith('https://router.project-osrm.org/route/'));
      return { ok: true, json: async () => ({ routes: [{
        distance: 166800, duration: 10000,
        geometry: { coordinates: [[9.45, 43.0], [9.45, 41.5]] },
      }] }) };
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'planer.js'), 'utf8'), context);
  assert.equal(context.entfernungKm, regionaleEntfernung, 'Planer darf die Entfernungsfunktion der Hauptkarte nicht überschreiben');
  const plan = element('planer-form').handlers.submit;
  await plan();
  assert.match(element('planer-ergebnis').innerHTML, /Frankreich konnten nicht geladen/);
  assert.equal(element('planer-los').disabled, false);
  await plan();
  const result = element('planer-ergebnis').innerHTML;
  assert.doesNotMatch(result, /Frankreich konnten nicht geladen/);
  assert.match(result, /NW IECharge/);
  assert.match(result, /25 ct\/kWh/);
  assert.match(result, /https:\/\/iecharge.io\/fr\/prix\//);
  assert.match(result, /Geprüft am 2026-10-21/);
  assert.match(result, /Corse Nord/);
  assert.match(result, /Corse Sud/);
  assert.doesNotMatch(result, /Deutscher Betreiber/);
  await plan();
  assert.equal(franceRequests, 2, 'Nach Erfolg nicht erneut laden');
  assert.equal(element('planer-ergebnis').innerHTML, result);
  assert.deepEqual(errors, []);
});
