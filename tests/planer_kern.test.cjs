const assert = require('node:assert/strict');
const test = require('node:test');
const P = require('../planer.js');
const LadeTarife = require('../tarife.js');

const enyaq = { akku: 77, maxKw: 135, verbrauch: 20, start: 78, reserve: 10, ziel: 95 };

test('Ladekurve: plausibel zu den Angaben der Škoda-App', () => {
  // Škoda-App: Supercharger 250 kW, 11 → 94 % in 41 min; TotalEnergies 300 kW, 10 → 88 % in 35 min
  const tesla = P.ladeMinuten(0.11 * 77, 0.83 * 77, 250, enyaq);
  const total = P.ladeMinuten(0.10 * 77, 0.78 * 77, 300, enyaq);
  assert.ok(tesla > 34 && tesla < 48, `Supercharger: ${tesla.toFixed(1)} min`);
  assert.ok(total > 29 && total < 41, `TotalEnergies: ${total.toFixed(1)} min`);
  // Lidl 120 kW mit einem Auto, das mehr kann: die Säule begrenzt, 10 → 70 % in etwa 25 min
  const lidl = P.ladeMinuten(0.10 * 77, 0.60 * 77, 120, { ...enyaq, maxKw: 175 });
  assert.ok(lidl > 21 && lidl < 30, `Lidl: ${lidl.toFixed(1)} min`);
});

test('Ladekurve: oben langsamer, schwache Säule begrenzt, nichts laden kostet nichts', () => {
  const unten = P.ladeMinuten(0.1 * 77, 10, 150, enyaq);
  const oben = P.ladeMinuten(0.8 * 77, 10, 150, enyaq);
  assert.ok(oben > unten * 1.5, 'über 80 % dauert dieselbe Menge deutlich länger');
  const fuenfzig = P.ladeMinuten(0.2 * 77, 0.3 * 77, 50, enyaq);
  assert.ok(Math.abs(fuenfzig - (0.3 * 77) / (50 * P.PLAN.saeulenFaktor) * 60) < 0.01, '50-kW-Säule ist der Engpass');
  assert.equal(P.ladeMinuten(30, 0, 150, enyaq), 0);
  const gesamt = P.ladeMinuten(0.1 * 77, 0.7 * 77, 150, enyaq);
  const teile = P.ladeMinuten(0.1 * 77, 0.4 * 77, 150, enyaq) + P.ladeMinuten(0.5 * 77, 0.3 * 77, 150, enyaq);
  assert.ok(Math.abs(gesamt - teile) < 1e-9, 'Teilstücke ergeben die Gesamtzeit');
});

test('Fahrzeitprofil: aus Abschnitten und ersatzweise gleichmäßig', () => {
  const f = P.fahrzeitProfil([[50000, 1800], [50000, 3600]], 90);
  assert.equal(f(0), 0);
  assert.equal(f(0.5), 30);
  assert.equal(f(0.75), 60);
  assert.equal(f(1), 90);
  const g = P.fahrzeitProfil([], 120);
  assert.equal(g(0.25), 30);
});

test('Zeitplan: Ankunft, Weiterfahrt und Etappen passen zusammen', () => {
  const kandidaten = [{ s: 100, abstand: 1, kw: 150, ct: 50 }, { s: 250, abstand: 0, kw: 300, ct: 60 }];
  const auto = { akku: 60, maxKw: 150, verbrauch: 20, start: 80, reserve: 10, ziel: 80 };
  const plan = P.bewerten(400, kandidaten, auto, [0, 1]);
  const fahrzeit = P.fahrzeitProfil([], 240);
  const z = P.zeitplan(plan, kandidaten, 400, fahrzeit);
  assert.equal(z.etappen.length, 3);
  assert.equal(z.halte.length, 2);
  assert.ok(Math.abs(z.etappen[0].km - 101) < 1e-9);
  assert.ok(Math.abs(z.halte[0].an - (60 + 1.2)) < 1e-9, 'Fahrzeit bis km 100 plus Umweg 1 km');
  assert.ok(Math.abs(z.halte[0].ab - z.halte[0].an - plan.stopps[0].ladenMin - P.PLAN.ladeAufschlagMin) < 1e-9);
  assert.ok(Math.abs(z.ankunft - (240 + plan.minuten)) < 1e-9, 'Ankunft = Fahrzeit + alle Pausen');
  const summe = z.etappen.reduce((a, e) => a + e.minuten, 0) + z.halte.reduce((a, h) => a + h.ab - h.an, 0);
  assert.ok(Math.abs(summe - z.ankunft) < 1e-9);
});

test('Roaming-Tarife: eigener Eintrag vor "*", ausgenommene und gesperrte Betreiber', () => {
  const tarife = [
    { land: 'DE', betreiber: 'IONITY GmbH', name: 'Ad-hoc', typ: 'adhoc', dc: 69, sicherheit: 'gefunden' },
    { land: 'DE', betreiber: '*', name: 'Karte X', typ: 'abo', grund: 4.99, dc: 59, ac: 49, sicherheit: 'gefunden',
      ausserBetreiber: ['IONITY GmbH', 'Tesla Germany GmbH'], jeVorgang: 0.5 },
    { land: 'DE', betreiber: 'IONITY GmbH', name: 'Karte X', typ: 'abo', grund: 4.99, dc: 79, sicherheit: 'gefunden' },
    { land: 'DE', betreiber: 'Tesla Germany GmbH', name: 'Karte X', typ: 'abo', dc: null, nutzbar: false, sicherheit: 'gefunden' },
    { land: 'FR', betreiber: '*', name: 'Karte X', typ: 'abo', dc: 65, sicherheit: 'gefunden' },
  ];
  const st = (b, land = 'DE') => ({ betreiber: [b], land, dc: true, kwMax: 150 });
  const karte = new Set(['Karte X']);
  assert.equal(LadeTarife.bester(st('IONITY GmbH'), tarife, karte).v, 69, 'Ad-hoc ist hier günstiger als Karte X');
  assert.equal(LadeTarife.optionen(st('IONITY GmbH'), tarife).find((p) => p.name === 'Karte X').v, 79);
  assert.equal(LadeTarife.bester(st('EnBW mobility+ AG und Co.KG'), tarife, karte).v, 59);
  assert.equal(LadeTarife.bester(st('EnBW mobility+ AG und Co.KG'), tarife), null, 'ohne Karte kein Kartenpreis');
  const tesla = LadeTarife.optionen(st('Tesla Germany GmbH'), tarife);
  assert.equal(tesla.length, 1);
  assert.equal(tesla[0].nutzbar, false);
  assert.equal(LadeTarife.label(tesla[0]), 'nicht nutzbar');
  assert.equal(LadeTarife.bester(st('Tesla Germany GmbH'), tarife, karte), null);
  assert.equal(LadeTarife.bester(st('Electra', 'FR'), tarife, karte).v, 65);
  assert.equal(LadeTarife.bester({ ...st('Allego GmbH'), dc: false }, tarife, karte).v, 49);
  assert.equal(LadeTarife.kosten(LadeTarife.bester(st('Allego GmbH'), tarife, karte), 10), 6.4, 'Startgebühr eingerechnet');
});

test('Kartenvergleich: was dieselben Stopps mit anderen Karten kosten', () => {
  const tarife = [
    { land: 'DE', betreiber: 'A', name: 'Ad-hoc', typ: 'adhoc', dc: 80, sicherheit: 'gefunden' },
    { land: 'DE', betreiber: 'B', name: 'Ad-hoc', typ: 'adhoc', dc: 60, sicherheit: 'gefunden' },
    { land: 'DE', betreiber: '*', name: 'Roaming', typ: 'abo', grund: 5, dc: 50, sicherheit: 'gefunden' },
    { land: 'DE', betreiber: 'A', name: 'A-App', typ: 'karte', dc: 55, sicherheit: 'gefunden' },
  ];
  const kandidaten = [{ namen: ['A'] }, { namen: ['B'] }, { namen: ['Unbekannt GmbH'] }];
  const opt = (k) => LadeTarife.optionen({ betreiber: k.namen, land: 'DE', dc: true, kwMax: 150 }, tarife);
  const stopps = [{ index: 0, kWh: 20 }, { index: 1, kWh: 30 }];
  const kv = P.kartenVergleich(stopps, kandidaten, opt, new Set());
  assert.equal(kv.ohne.euro, 16 + 18);
  assert.equal(kv.mit.euro, kv.ohne.euro);
  assert.deepEqual(kv.vorschlaege.map((v) => v.name), ['Roaming', 'A-App']);
  assert.equal(kv.vorschlaege[0].euro, 10 + 15);
  assert.equal(kv.vorschlaege[0].grund, 5);
  assert.ok(Math.abs(kv.vorschlaege[1].ersparnis - 5) < 1e-9);
  const mitApp = P.kartenVergleich(stopps, kandidaten, opt, new Set(['A-App']));
  assert.equal(mitApp.mit.euro, 11 + 18);
  assert.ok(Math.abs(mitApp.vorschlaege[0].ersparnis - 4) < 1e-9, 'Roaming spart dann nur noch an B und am A-App-Preis');
  const ohnePreis = P.kartenVergleich([{ index: 2, kWh: 10 }], kandidaten, opt, new Set());
  assert.equal(ohnePreis.ohne.geschaetzt, true);
});

test('Nicht laden bei: Marken über alle Schreibweisen, gemischte Standorte bleiben', () => {
  const tesla = new Set(['Tesla']);
  assert.equal(P.meidet(['Tesla Germany GmbH'], tesla), true);
  assert.equal(P.meidet(['TESLA France SARL'], tesla), true);
  assert.equal(P.meidet(['Tesla'], tesla), true);
  assert.equal(P.meidet(['EnBW mobility+ AG und Co.KG'], tesla), false);
  assert.equal(P.meidet(['Tesla Germany GmbH', 'EnBW mobility+ AG und Co.KG'], tesla), false);
  assert.equal(P.meidet(['BP Europa SE'], new Set(['Aral pulse / bp'])), true);
  assert.equal(P.meidet(['Electrabel'], new Set(['Electra'])), false);
  assert.equal(P.meidet(['Tesla'], new Set()), false);
});

test('Polyline6 von Valhalla wird richtig gelesen', () => {
  const kodiere = (punkte) => {
    let alt = [0, 0], text = '';
    for (const [lon, lat] of punkte) {
      for (const [i, wert] of [[0, lat], [1, lon]]) {
        const n = Math.round(wert * 1e6);
        let d = n - alt[i];
        alt[i] = n;
        d = d < 0 ? ~(d << 1) : d << 1;
        while (d >= 0x20) { text += String.fromCharCode((0x20 | (d & 0x1f)) + 63); d >>= 5; }
        text += String.fromCharCode(d + 63);
      }
    }
    return text;
  };
  const route = [[10.233, 50.049], [8.6821, 50.1109], [2.3522, 48.8566], [-1.5536, 47.2184]];
  const zurueck = P.polyline6(kodiere(route));
  assert.equal(zurueck.length, route.length);
  zurueck.forEach(([lon, lat], i) => {
    assert.ok(Math.abs(lon - route[i][0]) < 1e-6 && Math.abs(lat - route[i][1]) < 1e-6);
  });
});

test('Deckung erkennt gleiche und andere Strecken', () => {
  const linie = (versatz) => P.zerlege([[10, 50 + versatz], [10.6, 50 + versatz]]);
  assert.equal(P.deckung(linie(0), linie(0)), 1);
  assert.equal(P.deckung(linie(0.002), linie(0)), 1, '200 m daneben ist dieselbe Straße');
  assert.equal(P.deckung(linie(0.1), linie(0)), 0, '11 km daneben ist eine andere Strecke');
});

test('Planen: Varianten mit Ladekurve und Startgebühr bleiben erreichbar', () => {
  const kandidaten = [];
  for (let s = 20; s < 700; s += 25) kandidaten.push({ s, abstand: 0.5, kw: s % 50 ? 150 : 300, ct: s % 75 ? 59 : 39, jeVorgang: 0 });
  const auto = { akku: 77, maxKw: 135, verbrauch: 20, start: 80, reserve: 10, ziel: 80 };
  const varianten = P.alleVarianten(720, kandidaten, auto);
  assert.ok(varianten.length >= 1);
  for (const v of varianten) {
    const b = P.bewerten(720, kandidaten, auto, v.stopps.map((s) => s.index));
    assert.deepEqual(b.warnungen, [], v.namen.join());
    assert.ok(Math.abs(b.minuten - v.minuten) < 1e-6 && Math.abs(b.euro - v.euro) < 1e-6, 'planen und bewerten rechnen gleich');
  }
  const guenstig = varianten.find((v) => v.namen.includes('Am günstigsten'));
  const schnell = varianten.find((v) => v.namen.includes('Am schnellsten'));
  assert.ok(guenstig.euro <= schnell.euro + 1e-9);
  assert.ok(schnell.minuten <= guenstig.minuten + 1e-9);
});
