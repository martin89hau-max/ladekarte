"use strict";
// Streckenplaner: Route von A nach B mit Ladestopps.
//
// Aufbau:
//  - Der Rechenkern (planen, entlangDerRoute, ...) ist reine Mathematik und läuft auch in Node.
//  - Der Teil unten (Oberfläche) läuft nur im Browser und braucht die Karte aus index.html.
//
// Die Zahlen sind Näherungen: gleichbleibender Verbrauch, Ladezeit aus einer einfachen
// Ladekurve (volle Leistung bis 50 %, danach abnehmend). Preise fehlen an manchen Säulen.

// ===================== Rechenkern =====================

const LT = typeof LadeTarife !== "undefined" ? LadeTarife : require("./tarife.js");

const PLAN = {
  schrittKm: 1,          // so fein wird die Route für die Suche zerlegt
  zelle: 0.06,           // Rastergröße in Grad (ca. 5 km) für die schnelle Suche
  mittleresTempo: 50,    // km/h für Umwege zur Säule
  ladeAufschlagMin: 4,   // Anschließen, Bezahlen, Weiterfahren
  saeulenFaktor: 0.92,   // so viel der Säulenleistung kommt im Mittel an
  basisFaktor: 0.9,      // mittlere Ladeleistung des Autos im Verhältnis zu seiner Höchstleistung
  abfallAb: 0.5,         // ab diesem Ladestand sinkt die Ladeleistung ...
  abfallSteigung: 1.2,   // ... linear, bei 100 % auf 40 %
  mindestAnteil: 0.2,    // weniger als diesen Anteil der Leistung gibt es nie
  ersatzPreisCt: 69,     // Annahme, wenn für den Betreiber kein Preis bekannt ist
};

function planerEntfernungKm(lat1, lon1, lat2, lon2) {
  const dy = (lat1 - lat2) * 111.2;
  const dx = (lon1 - lon2) * 111.2 * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180);
  return Math.hypot(dx, dy);
}

// Linienzug [[lon, lat], ...] in Punkte im Abstand von etwa schrittKm zerlegen.
// Ergebnis: [{lat, lon, s}] mit s = Kilometer ab Start.
function zerlege(koordinaten, schrittKm = PLAN.schrittKm) {
  const punkte = [];
  let s = 0, naechster = 0;
  let [lon0, lat0] = koordinaten[0];
  punkte.push({ lat: lat0, lon: lon0, s: 0 });
  for (let i = 1; i < koordinaten.length; i++) {
    const [lon1, lat1] = koordinaten[i];
    const seg = planerEntfernungKm(lat0, lon0, lat1, lon1);
    while (seg > 0 && s + seg >= naechster + schrittKm) {
      naechster += schrittKm;
      const t = (naechster - s) / seg;
      punkte.push({ lat: lat0 + (lat1 - lat0) * t, lon: lon0 + (lon1 - lon0) * t, s: naechster });
    }
    s += seg;
    lat0 = lat1; lon0 = lon1;
  }
  const letzter = punkte[punkte.length - 1];
  if (s - letzter.s > 0.05) punkte.push({ lat: lat0, lon: lon0, s });
  return punkte;
}

function rasterVon(punkte) {
  const z = PLAN.zelle, raster = new Map();
  punkte.forEach((p, i) => {
    const k = Math.floor(p.lat / z) + "," + Math.floor(p.lon / z);
    (raster.get(k) || raster.set(k, []).get(k)).push(i);
  });
  return raster;
}

// Nächster Routenpunkt zu (lat, lon): {abstand, s}
function naechsterPunkt(punkte, raster, lat, lon) {
  const z = PLAN.zelle;
  const cy = Math.floor(lat / z), cx = Math.floor(lon / z);
  let bester = Infinity, bestS = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const liste = raster.get((cy + dy) + "," + (cx + dx));
      if (!liste) continue;
      for (const i of liste) {
        const p = punkte[i];
        const d = planerEntfernungKm(lat, lon, p.lat, p.lon);
        if (d < bester) { bester = d; bestS = p.s; }
      }
    }
  }
  return { abstand: bester, s: bestS };
}

// Alle Standorte finden, die höchstens maxAbstandKm von der Route entfernt sind.
// standorte: Zeilen [lat, lon, kwMax, dc, betreiber, ladepunkte, id, ort]
// Ergebnis: [{zeile, s, abstand}] nach s sortiert; s = Kilometer entlang der Route.
function entlangDerRoute(punkte, standorte, maxAbstandKm, filter) {
  const raster = rasterVon(punkte);
  const treffer = [];
  for (const zeile of standorte) {
    if (filter && !filter(zeile)) continue;
    const n = naechsterPunkt(punkte, raster, zeile[0], zeile[1]);
    if (n.abstand <= maxAbstandKm) treffer.push({ zeile, s: n.s, abstand: n.abstand });
  }
  treffer.sort((a, b) => a.s - b.s);
  return treffer;
}

// Anteil der Punkte von a, die höchstens maxKm neben Strecke b liegen (1 = gleiche Strecke)
function deckung(a, b, maxKm = 1.5) {
  if (!a.length || !b.length) return 0;
  const raster = rasterVon(b);
  return a.filter((p) => naechsterPunkt(b, raster, p.lat, p.lon).abstand <= maxKm).length / a.length;
}

// Ladekurve: Säule und Auto begrenzen, ab abfallAb sinkt die Leistung des Autos linear.
// Ergebnis: Funktion Ladestand (0..1) -> Stunden je kWh Akkugröße vom leeren Akku bis dahin.
const kurven = new Map();
function ladeKurve(kw, maxKw) {
  const schluessel = kw + "|" + maxKw;
  if (kurven.has(schluessel)) return kurven.get(schluessel);
  const S = Math.max(1, kw * PLAN.saeulenFaktor);
  const A = Math.max(1, maxKw * PLAN.basisFaktor);
  const a = PLAN.abfallAb, c = PLAN.abfallSteigung, m = PLAN.mindestAnteil;
  let g;
  if (S <= A * m) {
    g = (x) => x / S;                                  // die Säule ist immer der Engpass
  } else {
    const xb = a + (1 - m) / c;                       // ab hier nur noch die Mindestleistung
    const xs = S >= A ? a : a + (1 - S / A) / c;      // bis hier begrenzt die Säule (oder volle Leistung)
    const p0 = Math.min(S, A);
    const ln = (x) => Math.log(1 - c * (x - a));
    g = (x) => {
      if (x <= xs) return x / p0;
      let h = xs / p0 + (ln(xs) - ln(Math.min(x, xb))) / (A * c);
      if (x > xb) h += (x - xb) / (A * m);
      return h;
    };
  }
  kurven.set(schluessel, g);
  return g;
}

// Minuten, um von vonKWh aus kWh nachzuladen
function ladeMinuten(vonKWh, kWh, kw, auto) {
  if (!(kWh > 0)) return 0;
  const g = ladeKurve(kw, auto.maxKw);
  const von = Math.max(0, vonKWh / auto.akku), bis = (vonKWh + kWh) / auto.akku;
  return (g(bis) - g(von)) * auto.akku * 60;
}

// Zeit und Kosten für einen Ladestopp: ab vonKWh werden laden kWh geladen
function ladeStopp(k, vonKWh, laden, auto) {
  const ladenMin = ladeMinuten(vonKWh, laden, k.kw, auto);
  const umwegMin = 2 * k.abstand / PLAN.mittleresTempo * 60;
  return {
    minuten: ladenMin + PLAN.ladeAufschlagMin + umwegMin, ladenMin, umwegMin,
    euro: laden * (k.ct ?? PLAN.ersatzPreisCt) / 100 + (k.jeVorgang || 0),
  };
}

// Eine vorgegebene Folge von Stopps (Nummern in kandidaten) durchrechnen, z. B. nach Änderungen
// von Hand. Geladen wird an jedem Stopp nur so viel, wie bis zum nächsten Halt (mit Reserve)
// nötig ist, höchstens bis zum Ladeziel. Probleme stehen als Texte in warnungen.
function bewerten(gesamtKm, kandidaten, auto, indices) {
  const kwhJeKm = auto.verbrauch / 100;
  const reserve = auto.akku * auto.reserve / 100;
  const deckel = auto.akku * auto.ziel / 100;
  const reihe = [...new Set(indices)].sort((a, b) => kandidaten[a].s - kandidaten[b].s);
  const stopps = [], warnungen = [];
  let akku = auto.akku * auto.start / 100, lastS = 0, minuten = 0, euro = 0;
  for (let n = 0; n < reihe.length; n++) {
    const k = kandidaten[reihe[n]];
    akku -= ((k.s - lastS) + 2 * k.abstand) * kwhJeKm;           // Ankunft am Stopp
    const warn = [];
    if (akku < 0) { warn.push("Bis hierher reicht der Akku nicht."); akku = 0; }
    else if (akku < reserve * 0.999) warn.push("Ankunft unter der Reserve.");
    const kj = n + 1 < reihe.length ? kandidaten[reihe[n + 1]] : null;
    const naechster = kj ? (kj.s - k.s) + 2 * kj.abstand : gesamtKm - k.s;
    const ziel = Math.min(naechster * kwhJeKm + reserve, deckel);
    const laden = Math.max(0, ziel - akku);
    if (ziel < naechster * kwhJeKm + reserve - 1e-6) warn.push("Bis zum nächsten Halt ist es zu weit für das Ladeziel.");
    const e = ladeStopp(k, akku, laden, auto);
    stopps.push({ index: reihe[n], kWh: laden, von: akku / auto.akku * 100, bis: (akku + laden) / auto.akku * 100,
      minuten: e.minuten, ladenMin: e.ladenMin, euro: e.euro, warnungen: warn });
    minuten += e.minuten; euro += e.euro;
    akku += laden; lastS = k.s;
  }
  const rest = gesamtKm - lastS;
  const ankunft = akku - rest * kwhJeKm;
  if (ankunft < 0) warnungen.push("Das Ziel ist mit diesen Stopps nicht erreichbar.");
  else if (ankunft < reserve * 0.999) warnungen.push("Ankunft am Ziel unter der Reserve.");
  return { stopps, minuten, euro, zielProzent: ankunft / auto.akku * 100, warnungen };
}

// Beste Ladestopps für eine Wertung finden.
//  gesamtKm: Länge der Route; kandidaten: [{s, abstand, kw, ct}] nach s sortiert
//  auto: {akku, verbrauch, maxKw, start, reserve, ziel}  (akku in kWh, verbrauch kWh/100 km, Rest in %)
//  wertung: (minuten, euro) => Zahl, kleiner ist besser
// Idee: An jedem Stopp wird nur so viel geladen, wie bis zum nächsten Halt (mit Reserve)
// nötig ist. Dann kommt man dort immer mit der Reserve an, und der Rest ist eine
// einfache Suche über alle möglichen Folgen von Stopps.
function planen(gesamtKm, kandidaten, auto, wertung) {
  const kwhJeKm = auto.verbrauch / 100;
  const reserve = auto.akku * auto.reserve / 100;
  const deckel = auto.akku * auto.ziel / 100;
  const start = auto.akku * auto.start / 100;
  const n = kandidaten.length;
  const maxHop = (deckel - reserve) / kwhJeKm;           // weiteste Strecke zwischen zwei Halten
  const ersteReichweite = (start - reserve) / kwhJeKm;   // weiteste Strecke ab dem Start
  if (maxHop <= 0) return null;

  const umweg = (k) => 2 * k.abstand;                    // Hin und zurück zur Säule
  const stopp = (k, ankunft, laden) => ladeStopp(k, ankunft, laden, auto);

  // Direkt ohne Stopp?
  if (gesamtKm <= ersteReichweite) return { stopps: [], minuten: 0, euro: 0 };

  // Zustand (art, i): art 0 = Stopp i direkt vom Start erreicht, art 1 = von einem anderen Stopp (dann mit Reserve)
  const kosten = [new Array(n).fill(Infinity), new Array(n).fill(Infinity)];
  const bis = [new Array(n).fill(null), new Array(n).fill(null)];     // {minuten, euro} bis zur Ankunft
  const kante = [new Array(n).fill(null), new Array(n).fill(null)];   // {i, art, kWh, ankunft}: wie man hierher kam
  for (let i = 0; i < n; i++) {
    if (kandidaten[i].s + umweg(kandidaten[i]) <= ersteReichweite) {
      kosten[0][i] = 0;
      bis[0][i] = { minuten: 0, euro: 0 };
    }
  }

  let ende = null;
  for (let i = 0; i < n; i++) {
    const k = kandidaten[i];
    for (let art = 0; art < 2; art++) {
      if (!isFinite(kosten[art][i])) continue;
      const ankunft = art === 0 ? start - (k.s + umweg(k)) * kwhJeKm : reserve;
      const davor = bis[art][i];
      for (let j = i + 1; j < n; j++) {
        const kj = kandidaten[j];
        if (kj.s - k.s > maxHop) break;
        const hop = (kj.s - k.s) + umweg(kj);
        if (hop > maxHop) continue;
        const laden = hop * kwhJeKm + reserve - ankunft;
        if (laden <= 0) continue;                        // dann wäre dieser Halt unnötig
        const e = stopp(k, ankunft, laden);
        const m = davor.minuten + e.minuten, eur = davor.euro + e.euro;
        const w = wertung(m, eur);
        if (w < kosten[1][j]) {
          kosten[1][j] = w; bis[1][j] = { minuten: m, euro: eur };
          kante[1][j] = { i, art, kWh: laden, ankunft };
        }
      }
      const rest = gesamtKm - k.s;
      if (rest <= maxHop) {
        const laden = rest * kwhJeKm + reserve - ankunft;
        if (laden > 0) {
          const e = stopp(k, ankunft, laden);
          const m = davor.minuten + e.minuten, eur = davor.euro + e.euro;
          const w = wertung(m, eur);
          if (!ende || w < ende.w) ende = { w, minuten: m, euro: eur, kante: { i, art, kWh: laden, ankunft } };
        }
      }
    }
  }
  if (!ende) return null;

  // Rückwärts bis zum Start durchlaufen
  const stopps = [];
  let kt = ende.kante;
  while (kt) {
    const e = stopp(kandidaten[kt.i], kt.ankunft, kt.kWh);
    stopps.unshift({ index: kt.i, kWh: kt.kWh, von: kt.ankunft / auto.akku * 100,
      bis: (kt.ankunft + kt.kWh) / auto.akku * 100, minuten: e.minuten, ladenMin: e.ladenMin, euro: e.euro });
    kt = kt.art === 1 ? kante[1][kt.i] : null;
  }
  return { stopps, minuten: ende.minuten, euro: ende.euro };
}

// Größte Lücke ohne Ladepunkt entlang der Route (Start und Ziel zählen mit)
function groessteLuecke(gesamtKm, kandidaten) {
  let von = 0, bestVon = 0, best = 0;
  for (const k of [...kandidaten.map((c) => c.s), gesamtKm]) {
    if (k - von > best) { best = k - von; bestVon = von; }
    von = k;
  }
  return { km: best, ab: bestVon };
}

// Drei Wertungen: schnellste, günstigste und ein Kompromiss (1 Minute ≈ 25 Cent)
const WERTUNGEN = [
  { name: "Am schnellsten", wert: (m, e) => m + e * 0.001 },
  { name: "Am günstigsten", wert: (m, e) => e + m * 0.02 },
  { name: "Ausgewogen", wert: (m, e) => e + m * 0.25 },
];

function alleVarianten(gesamtKm, kandidaten, auto) {
  const gesehen = new Set(), liste = [];
  for (const w of WERTUNGEN) {
    const plan = planen(gesamtKm, kandidaten, auto, w.wert);
    if (!plan) continue;
    const schluessel = plan.stopps.map((s) => s.index).join(",");
    if (gesehen.has(schluessel)) {
      liste.find((p) => p.schluessel === schluessel).namen.push(w.name);
      continue;
    }
    gesehen.add(schluessel);
    liste.push({ ...plan, schluessel, namen: [w.name] });
  }
  return liste;
}

// Fahrzeit entlang der Route aus Abschnitten [[Meter, Sekunden], ...] in Fahrtrichtung.
// Ergebnis: Funktion Anteil der Strecke (0..1) -> Minuten ab Start. Ohne Abschnitte gleichmäßig verteilt.
function fahrzeitProfil(abschnitte, gesamtMin) {
  const km = [0], min = [0];
  for (const [m, s] of abschnitte || []) {
    km.push(km[km.length - 1] + (m || 0) / 1000);
    min.push(min[min.length - 1] + (s || 0) / 60);
  }
  const laenge = km[km.length - 1];
  if (!(laenge > 0)) return (anteil) => Math.max(0, Math.min(1, anteil)) * gesamtMin;
  return (anteil) => {
    const ziel = Math.max(0, Math.min(1, anteil)) * laenge;
    let lo = 0, hi = km.length - 1;
    while (hi - lo > 1) {
      const mitte = (lo + hi) >> 1;
      if (km[mitte] < ziel) lo = mitte; else hi = mitte;
    }
    const t = km[hi] > km[lo] ? (ziel - km[lo]) / (km[hi] - km[lo]) : 0;
    return min[lo] + (min[hi] - min[lo]) * t;
  };
}

// Zeitleiste eines Plans: je Etappe Strecke und Fahrzeit, je Stopp Ankunft und Weiterfahrt
// (Minuten ab Abfahrt). fahrzeit kommt aus fahrzeitProfil.
function zeitplan(plan, kandidaten, gesamtKm, fahrzeit) {
  const etappen = [], halte = [];
  const tempo = PLAN.mittleresTempo / 60;               // km je Minute auf dem Umweg
  let pause = 0, vorS = 0, vorAbstand = 0, vorFahrt = 0;
  for (const s of plan.stopps) {
    const k = kandidaten[s.index];
    const fahrt = fahrzeit(k.s / gesamtKm);
    etappen.push({ km: k.s - vorS + vorAbstand + k.abstand, minuten: fahrt - vorFahrt + (vorAbstand + k.abstand) / tempo });
    const an = fahrt + pause + k.abstand / tempo;
    halte.push({ an, ab: an + s.ladenMin + PLAN.ladeAufschlagMin });
    pause += s.minuten;                                 // Laden, Aufschlag und Umweg hin und zurück
    vorS = k.s; vorAbstand = k.abstand; vorFahrt = fahrt;
  }
  const gesamt = fahrzeit(1);
  etappen.push({ km: gesamtKm - vorS + vorAbstand, minuten: gesamt - vorFahrt + vorAbstand / tempo });
  return { etappen, halte, ankunft: gesamt + pause };
}

// Was kosten dieselben Stopps je nach Ladekarte? optionenFuer(k) liefert LadeTarife.optionen für den Kandidaten.
// ohne: nur Ad-hoc; mit: Ad-hoc und meine Karten; vorschlaege: welche weitere Karte wie viel spart.
function kartenVergleich(stopps, kandidaten, optionenFuer, karten = new Set()) {
  const summe = (erlaubt) => {
    let euro = 0, geschaetzt = false, unsicher = false;
    for (const s of stopps) {
      if (!(s.kWh > 0)) continue;
      const ps = optionenFuer(kandidaten[s.index]).filter((p) => LT.hatPreis(p) && erlaubt(p));
      if (!ps.length) { euro += s.kWh * PLAN.ersatzPreisCt / 100; geschaetzt = true; continue; }
      const best = ps.reduce((a, b) => (LT.kosten(b, s.kWh) < LT.kosten(a, s.kWh) ? b : a));
      euro += LT.kosten(best, s.kWh);
      unsicher ||= best.unsicher;
    }
    return { euro, geschaetzt, unsicher };
  };
  const adhoc = (p) => p.typ === "adhoc";
  const meine = (p) => adhoc(p) || karten.has(p.name);
  const ohne = summe(adhoc), mit = summe(meine);
  const andere = new Map();
  for (const s of stopps) {
    for (const p of optionenFuer(kandidaten[s.index])) {
      if (!meine(p) && LT.hatPreis(p) && !andere.has(p.name)) andere.set(p.name, p);
    }
  }
  const vorschlaege = [...andere.values()].map((p) => {
    const r = summe((q) => meine(q) || q.name === p.name);
    return { name: p.name, anbieter: p.anbieter || "", grund: p.grund || 0, ...r, ersparnis: mit.euro - r.euro };
  }).filter((v) => v.ersparnis >= 0.01).sort((a, b) => b.ersparnis - a.ersparnis || a.grund - b.grund);
  return { ohne, mit, vorschlaege };
}

// Marken, bei denen man nicht laden möchte (gilt über alle Schreibweisen in Deutschland und Frankreich)
const MARKEN = [
  { name: "Tesla", muster: /tesla/i },
  { name: "IONITY", muster: /ionity/i },
  { name: "EnBW", muster: /enbw/i },
  { name: "Aral pulse / bp", muster: /\bbp\b|aral/i },
  { name: "Shell", muster: /shell/i },
  { name: "TotalEnergies", muster: /total ?energies/i },
  { name: "Lidl", muster: /lidl/i },
  { name: "Aldi", muster: /aldi/i },
  { name: "Kaufland", muster: /kaufland/i },
  { name: "Fastned", muster: /fastned/i },
  { name: "Allego", muster: /allego/i },
  { name: "EWE Go", muster: /ewe go/i },
  { name: "E.ON", muster: /e\.on\b/i },
  { name: "Electra", muster: /electra\b/i },
  { name: "Power Dot", muster: /power ?dot/i },
  { name: "IZIVIA", muster: /izivia/i },
];

// true, wenn alle Betreiber der Station zu gemiedenen Marken gehören
function meidet(namen, meiden) {
  if (!meiden?.size || !namen.length) return false;
  const muster = MARKEN.filter((m) => meiden.has(m.name)).map((m) => m.muster);
  return muster.length > 0 && namen.every((n) => muster.some((r) => r.test(n)));
}

// Valhalla liefert die Strecke als Polyline mit 6 Nachkommastellen; Ergebnis [[lon, lat], ...]
function polyline6(text) {
  const punkte = [];
  let i = 0, lat = 0, lon = 0;
  while (i < text.length) {
    for (let achse = 0; achse < 2; achse++) {
      let b, shift = 0, wert = 0;
      do {
        b = text.charCodeAt(i++) - 63;
        wert |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const d = wert & 1 ? ~(wert >> 1) : wert >> 1;
      if (achse === 0) lat += d; else lon += d;
    }
    punkte.push([lon / 1e6, lat / 1e6]);
  }
  return punkte;
}

if (typeof module !== "undefined") {
  module.exports = {
    PLAN, zerlege, entlangDerRoute, deckung, planen, bewerten, ladeStopp, ladeMinuten, alleVarianten,
    entfernungKm: planerEntfernungKm, groessteLuecke, fahrzeitProfil, zeitplan, kartenVergleich, MARKEN, meidet, polyline6,
  };
}

// ===================== Oberfläche (nur im Browser) =====================

if (typeof document !== "undefined" && typeof karte !== "undefined") {
  const DE_URL = "daten/de.json";
  const FR_URL = "daten/fr.json";
  const VALHALLA_URL = "https://valhalla1.openstreetmap.de/route";
  let frStatus = "";   // "", "geladen" oder "fehlt"; Fehler erlauben einen erneuten Versuch
  const PLANER_SPEICHER = "ladekarte.planer";
  const AUTO_STANDARD = { akku: 60, verbrauch: 20, maxKw: 100, start: 80, reserve: 10, ziel: 80, minKw: 50, umweg: 3,
    fahrzeug: "", meiden: [], schoen: true, maut: true };

  // Richtwerte: nutzbarer Akku (kWh), höchste DC-Ladeleistung (kW), Verbrauch gemischt mit viel Autobahn (kWh/100 km)
  const FAHRZEUGE = [
    ["Škoda Enyaq 85", 77, 135, 20],
    ["Škoda Enyaq 85x", 77, 175, 21],
    ["Škoda Elroq 85", 77, 175, 19],
    ["Škoda Elroq 60", 59, 165, 18.5],
    ["VW ID.3 Pro S", 77, 175, 18],
    ["VW ID.4 Pro", 77, 175, 20],
    ["Cupra Born (77 kWh)", 77, 170, 18],
    ["Tesla Model 3 Long Range", 75, 250, 16.5],
    ["Tesla Model Y Long Range", 75, 250, 18],
    ["Hyundai Ioniq 5 (84 kWh)", 80, 250, 20],
    ["Kia EV6 (84 kWh)", 80, 250, 19.5],
    ["BMW i4 eDrive40", 81, 205, 18.5],
    ["Renault Mégane E-Tech (60 kWh)", 60, 130, 18],
    ["MG4 Long Range", 62, 140, 18.5],
  ];

  // Zusätzliche Strecken neben der schnellsten (Valhalla, Server der FOSSGIS)
  const STRECKEN = [
    { art: "schoen", titel: "Am schönsten", text: "über Landstraßen, wenig Autobahn", optionen: { use_highways: 0.3 }, an: () => auto.schoen !== false },
    { art: "maut", titel: "Ohne Maut", text: "meidet mautpflichtige Straßen", optionen: { use_tolls: 0 }, an: () => auto.maut !== false },
  ];

  let deDaten = null;
  let auto = { ...AUTO_STANDARD };
  const routeEbene = L.layerGroup().addTo(karte);
  const entlangEbene = L.layerGroup().addTo(karte);
  const zeichenflaeche = L.canvas ? L.canvas({ padding: 0.3 }) : undefined;
  let letzteRoute = null;
  let edit = null;       // {strecke, indices, picker, sort, plan}
  let entlangSort = "km", entlangMax = 40, entlangOffen = false;

  try { Object.assign(auto, JSON.parse(localStorage.getItem(PLANER_SPEICHER)) || {}); } catch {}
  if (!Array.isArray(auto.meiden)) auto.meiden = [];
  const speichern = () => { try { localStorage.setItem(PLANER_SPEICHER, JSON.stringify(auto)); } catch {} };
  const gemieden = () => new Set(auto.meiden);
  const meineKarten = () => (typeof karten !== "undefined" ? karten : new Set());
  const tarifListe = () => (typeof alleTarife === "function" ? alleTarife() : []);

  const felder = [
    ["akku", "Akku (kWh)", 10, 200, 1],
    ["verbrauch", "Verbrauch (kWh/100 km)", 8, 40, 0.5],
    ["maxKw", "Max. Ladeleistung (kW)", 11, 350, 1],
    ["start", "Start-Ladestand (%)", 10, 100, 1],
    ["reserve", "Reserve bei Ankunft (%)", 0, 40, 1],
    ["ziel", "Laden bis höchstens (%)", 50, 100, 1],
    ["minKw", "Säulen ab (kW)", 11, 350, 1],
    ["umweg", "Max. Abstand zur Route (km)", 0.5, 15, 0.5],
  ];

  function rendereFelder() {
    $("planer-felder").innerHTML = felder.map(([k, t, mi, ma, st]) =>
      `<label>${t}<input type="number" inputmode="decimal" data-feld="${k}" min="${mi}" max="${ma}" step="${st}" value="${auto[k]}"></label>`).join("");
  }
  rendereFelder();
  $("planer-felder").addEventListener("change", (ev) => {
    const f = ev.target.dataset?.feld;
    if (!f) return;
    const [, , mi, ma] = felder.find((x) => x[0] === f);
    const v = parseFloat(String(ev.target.value).replace(",", "."));
    auto[f] = Number.isFinite(v) ? Math.min(ma, Math.max(mi, v)) : AUTO_STANDARD[f];
    ev.target.value = auto[f];
    if (["akku", "verbrauch", "maxKw"].includes(f) && auto.fahrzeug) {
      auto.fahrzeug = "";
      $("planer-fahrzeug").value = "";
    }
    speichern();
  });

  $("planer-fahrzeug").innerHTML = `<option value="">Eigene Werte</option>` +
    FAHRZEUGE.map(([n, a, k, v]) => `<option value="${esc(n)}">${esc(n)} (${a} kWh, ${k} kW)</option>`).join("");
  $("planer-fahrzeug").value = auto.fahrzeug || "";
  $("planer-fahrzeug").addEventListener("change", (ev) => {
    const f = FAHRZEUGE.find(([n]) => n === ev.target.value);
    auto.fahrzeug = f ? f[0] : "";
    if (f) [, auto.akku, auto.maxKw, auto.verbrauch] = f;
    rendereFelder();
    speichern();
  });

  $("planer-schoen").checked = auto.schoen !== false;
  $("planer-maut").checked = auto.maut !== false;
  for (const [id, feld] of [["planer-schoen", "schoen"], ["planer-maut", "maut"]]) {
    $(id).addEventListener("change", (ev) => { auto[feld] = ev.target.checked; speichern(); });
  }

  // "Nicht laden bei": Marken über alle Betreibernamen hinweg
  function rendereMeiden() {
    const m = gemieden();
    $("planer-meiden").innerHTML = MARKEN.map((x) =>
      `<button type="button" aria-pressed="${m.has(x.name)}" data-meide="${esc(x.name)}">${esc(x.name)}</button>`).join("");
    $("planer-meiden-anzahl").textContent = m.size ? `: ${[...m].join(", ")}` : "";
  }
  rendereMeiden();
  $("planer-meiden").addEventListener("click", (ev) => {
    const k = ev.target.closest?.("button[data-meide]");
    if (!k) return;
    const n = k.dataset.meide;
    auto.meiden = auto.meiden.includes(n) ? auto.meiden.filter((x) => x !== n) : [...auto.meiden, n];
    speichern();
    rendereMeiden();
    neuRechnen();
  });

  // "Meine Ladekarten": dieselbe Auswahl wie in der Liste
  function rendereKarten() {
    const k = meineKarten();
    const namen = [...new Set(tarifListe().filter((t) => t.typ !== "adhoc").map((t) => t.name))]
      .sort((a, b) => a.localeCompare(b, "de"));
    $("planer-karten").innerHTML = namen.map((n) =>
      `<button type="button" aria-pressed="${k.has(n)}" data-karte="${esc(n)}">${esc(n)}</button>`).join("") ||
      `<p class="leise">Tarife werden geladen …</p>`;
    $("planer-karten-anzahl").textContent = k.size ? ` (${k.size} gewählt)` : "";
  }
  function kartenGeaendert() {
    if (typeof speichereEinstellungen === "function") speichereEinstellungen();
    if (typeof baueMeineKnoepfe === "function") baueMeineKnoepfe();
    if (typeof aktualisiereMarker === "function") aktualisiereMarker();
    if (typeof zeichne === "function") zeichne();
    rendereKarten();
    neuRechnen();
  }
  globalThis.planerKartenNeu = () => { rendereKarten(); neuRechnen(); };
  $("planer-karten").addEventListener("click", (ev) => {
    const b = ev.target.closest?.("button[data-karte]");
    if (!b) return;
    const k = meineKarten(), n = b.dataset.karte;
    k.has(n) ? k.delete(n) : k.add(n);
    kartenGeaendert();
  });
  if (typeof datenBereit !== "undefined") datenBereit.then(rendereKarten, () => {});

  const zeitText = (min) => {
    const m = Math.round(min);
    return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min` : `${m} min`;
  };
  const zahlText = (x, stellen = 0) => x.toFixed(stellen).replace(".", ",");

  // Abfahrt "HH:MM" heute, sonst jetzt (auf 5 Minuten aufgerundet); Ergebnis in Millisekunden
  function abfahrtAus(text) {
    const jetzt = new Date();
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(text || "").trim());
    if (m) { const d = new Date(jetzt); d.setHours(Number(m[1]), Number(m[2]), 0, 0); return d.getTime(); }
    return Math.ceil(jetzt.getTime() / 300000) * 300000;
  }
  function uhrzeit(R, min) {
    const d = new Date(R.abfahrt + min * 60000);
    const t = d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
    const tag0 = new Date(R.abfahrt); tag0.setHours(0, 0, 0, 0);
    const tage = Math.floor((d.getTime() - tag0.getTime()) / 86400000);
    return tage > 0 ? `${t} (+${tage} Tag)` : t;
  }

  async function ladeDeDaten() {
    if (deDaten) return deDaten;
    $("planer-status").textContent = "Lade Ladestationen für ganz Deutschland …";
    const a = await fetch(DE_URL);
    if (!a.ok) throw new Error("Daten nicht geladen (" + a.status + ")");
    deDaten = await a.json();
    return deDaten;
  }

  // Grober Ausschnitt von Frankreich einschließlich Elsass und Korsika.
  // Angrenzende Länder dürfen mit erfasst werden, damit keine Frankreich-Route fehlt.
  async function ladeFrankreich(punkte) {
    if (frStatus === "geladen") return;
    frStatus = "";
    if (!punkte.some((p) => p.lon > -6 && p.lon < 10 && p.lat > 41 && p.lat < 52)) return;
    try {
      $("planer-status").textContent = "Lade Ladestationen für Frankreich …";
      const a = await fetch(FR_URL);
      if (!a.ok) throw new Error("HTTP " + a.status);
      const fr = await a.json();
      if (!Array.isArray(fr.betreiber) || !Array.isArray(fr.orte) || !fr.standorte?.length) {
        throw new Error("Ungültige Stationsdaten");
      }
      const bo = deDaten.betreiber.length, oo = deDaten.orte.length;
      const standorte = fr.standorte.map((z) => {
        const zeile = [...z];
        zeile[4] = z[4] < 0 ? -1 : z[4] + bo;
        zeile[7] = z[7] < 0 ? -1 : z[7] + oo;
        zeile[8] = "FR";
        return zeile;
      });
      deDaten.betreiber = deDaten.betreiber.concat(fr.betreiber);
      deDaten.orte = deDaten.orte.concat(fr.orte);
      deDaten.standorte = deDaten.standorte.concat(standorte);
      frStatus = "geladen";
    } catch (e) {
      console.warn("Frankreich-Daten nicht geladen", e);
      frStatus = "fehlt";
    }
  }

  async function finde(text) {
    const t = text.trim();
    if (!t) throw new Error("Bitte Start und Ziel eintragen.");
    const m = t.match(/^(-?\d+[.,]\d+)\s*[,;]\s*(-?\d+[.,]\d+)$/);
    if (m) return { lat: parseFloat(m[1].replace(",", ".")), lon: parseFloat(m[2].replace(",", ".")), name: t };
    const a = await fetch("https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=de,fr,at,ch,nl,be,lu,cz,pl,dk,it,es&accept-language=de&q=" + encodeURIComponent(t));
    if (!a.ok) throw new Error("Ortssuche nicht erreichbar.");
    const l = await a.json();
    if (!l.length) throw new Error(`„${t}“ nicht gefunden.`);
    return { lat: parseFloat(l[0].lat), lon: parseFloat(l[0].lon), name: l[0].display_name.split(",").slice(0, 2).join(",") };
  }

  // Schnellste Strecke (OSRM), mit Fahrzeit je Abschnitt für die Zeitleiste
  async function holeOsrm(wege) {
    const punkte = wege.map((p) => `${p.lon},${p.lat}`).join(";");
    const url = `https://router.project-osrm.org/route/v1/driving/${punkte}?overview=full&geometries=geojson&annotations=distance,duration`;
    const a = await fetch(url);
    if (!a.ok) throw new Error("Routenberechnung nicht erreichbar.");
    const d = await a.json();
    if (!d.routes?.length) throw new Error("Keine Route gefunden.");
    const r = d.routes[0];
    const abschnitte = (r.legs || []).flatMap((l) => (l.annotation?.distance || []).map((m, i) => [m, l.annotation.duration[i]]));
    return { geometry: r.geometry, distance: r.distance, duration: r.duration, abschnitte };
  }

  // Weitere Strecken mit eigenen Vorlieben (z. B. ohne Maut) von Valhalla
  async function holeValhalla(wege, optionen) {
    const anfrage = { locations: wege.map((p) => ({ lat: p.lat, lon: p.lon })), costing: "auto",
      costing_options: { auto: optionen }, units: "kilometers", directions_type: "maneuvers" };
    const signal = typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(25000) : undefined;
    const a = await fetch(`${VALHALLA_URL}?json=${encodeURIComponent(JSON.stringify(anfrage))}`, signal ? { signal } : undefined);
    if (!a.ok) throw new Error("Valhalla " + a.status);
    const d = await a.json();
    const legs = d.trip?.legs;
    if (!legs?.length) throw new Error("Keine Route");
    const coordinates = legs.flatMap((l, i) => polyline6(l.shape).slice(i ? 1 : 0));
    const abschnitte = legs.flatMap((l) => (l.maneuvers || []).map((m) => [m.length * 1000, m.time]));
    return { geometry: { coordinates }, distance: d.trip.summary.length * 1000, duration: d.trip.summary.time, abschnitte };
  }

  function bereiteStrecke(route, art) {
    const punkte = zerlege(route.geometry.coordinates);
    return { ...art, route, punkte, gesamtKm: punkte[punkte.length - 1].s, fahrzeit: fahrzeitProfil(route.abschnitte, route.duration / 60) };
  }

  function stationVon(z, namen) {
    return { betreiber: namen, dc: true, land: z[8] || "DE", kwMax: z[2], station: deDaten.orte[z[7]] || "" };
  }

  function kandidatenFuer(punkte) {
    const aus = typeof ausgeblendet !== "undefined" ? ausgeblendet : new Set();
    const m = gemieden();
    const filter = (z) => {
      if (!z[3] || z[2] < auto.minKw) return false;
      const b = [].concat(z[4]).map((i) => deDaten.betreiber[i]).filter(Boolean);
      if (aus.size && b.length && b.every((x) => aus.has(x))) return false;
      return !meidet(b, m);
    };
    return entlangDerRoute(punkte, deDaten.standorte, auto.umweg, filter).map((t) => {
      const z = t.zeile;
      const namen = [].concat(z[4]).map((i) => deDaten.betreiber[i]).filter(Boolean);
      if (!namen.length) namen.push("Betreiber unbekannt");
      const p = eigenerPreis(stationVon(z, namen));
      return { s: t.s, abstand: t.abstand, kw: z[2], ct: p && LT.hatPreis(p) ? p.v : null, jeVorgang: p?.jeVorgang || 0, preis: p, zeile: z, namen };
    });
  }

  // Alle Karten an dieser Säule (einmal je Kandidat ausgerechnet)
  function optionenFuer(k) {
    if (!k._optionen) k._optionen = LT.optionen(stationVon(k.zeile, k.namen), tarifListe());
    return k._optionen;
  }

  // Varianten für alle Strecken: auf der schnellsten drei Wertungen, auf den anderen die ausgewogene
  function berechne(R) {
    for (const st of R.strecken) st.kandidaten = kandidatenFuer(st.punkte);
    const roh = [];
    const schnell = R.strecken[0];
    for (const v of alleVarianten(schnell.gesamtKm, schnell.kandidaten, auto)) roh.push({ ...v, strecke: 0 });
    R.strecken.forEach((st, i) => {
      if (i === 0) return;
      const plan = planen(st.gesamtKm, st.kandidaten, auto, WERTUNGEN[2].wert);
      if (plan) roh.push({ ...plan, strecke: i, namen: [st.titel] });
    });
    // Mit bewerten() nachrechnen: gleiche Werte wie im Editor, dazu Ankunftsladestand und Warnungen
    R.varianten = roh.map((v) => {
      const st = R.strecken[v.strecke];
      return { ...bewerten(st.gesamtKm, st.kandidaten, auto, v.stopps.map((s) => s.index)), strecke: v.strecke, namen: v.namen };
    });
    if (!(R.gewaehlt < R.varianten.length)) R.gewaehlt = 0;
  }

  function neuRechnen() {
    const R = letzteRoute || neuRechnen.ohneErgebnis;
    if (!R) return;
    berechne(R);
    zeigeErgebnis(R);
  }

  const ortVon = (k) => (k.zeile[7] >= 0 ? deDaten.orte[k.zeile[7]] : "Ladestopp");
  const preisKurz = (k) => (k.ct != null ? LT.label(k.preis) : `≈${PLAN.ersatzPreisCt} ct/kWh geschätzt`);

  function preisDetails(k) {
    const p = k.preis;
    if (!p) return "";
    const quelle = /^https:\/\//.test(p.quelle || "")
      ? `<a href="${esc(p.quelle)}" target="_blank" rel="noopener">Tarif beim Anbieter</a>` : "";
    const rechnung = p.min != null ? `Für die Planung: ${zahlText(p.v, 2)} ct/kWh (oberer Bereichswert). `
      : p.ab ? "Mindestpreis als Rechenwert; der Stationspreis kann höher sein. " : "";
    return `<details class="leise"><summary>${esc(p.name)} · Tarifdetails</summary><p>${esc(p.hinweis || "")}</p>` +
      `<p>${rechnung}${p.grund ? `${zahlText(p.grund, 2)} €/Monat zusätzlich; nicht in den Fahrtkosten enthalten. ` : ""}` +
      `${p.jeVorgang ? `${zahlText(p.jeVorgang, 2)} € je Ladevorgang, in den Kosten enthalten. ` : ""}` +
      `${p.geprueft ? `Geprüft am ${esc(p.geprueft)}. ` : ""}${quelle}</p></details>`;
  }

  // Preise aller Karten an der Säule, günstigste zuerst
  function kartenHtml(k) {
    const opt = optionenFuer(k);
    if (opt.length < 2) return "";
    const meine = meineKarten();
    const zeilen = opt.slice(0, 14).map((p) => {
      const art = p.typ === "adhoc" ? "für alle" : meine.has(p.name) ? "habe ich" : p.grund ? `${zahlText(p.grund, 2)} €/Monat` : "";
      return `<li${p === k.preis || p.name === k.preis?.name ? ' class="meins"' : ""}><span>${esc(p.name)}${art ? ` <small>${esc(art)}</small>` : ""}</span><b>${esc(LT.label(p))}</b></li>`;
    }).join("");
    return `<details class="leise"><summary>Preise je Ladekarte (${opt.length})</summary><ul class="kartenpreise">${zeilen}</ul></details>`;
  }

  // Hinweis, wenn eine Karte, die ich nicht habe, hier deutlich günstiger ist
  function besserMit(k) {
    const meine = meineKarten();
    const best = optionenFuer(k).find((p) => LT.hatPreis(p) && p.typ !== "adhoc" && !meine.has(p.name));
    if (!best || (k.ct != null && best.v > k.ct - 2)) return "";
    return `<br><span class="tipp">Mit ${esc(best.name)}: ${esc(LT.label(best))}</span>`;
  }

  // ---- Karte ----
  function zeichnePlan(R, plan, anpassen) {
    routeEbene.clearLayers();
    const st = R.strecken[plan.strecke];
    R.strecken.forEach((andere, i) => {
      if (i === plan.strecke) return;
      L.polyline(andere.route.geometry.coordinates.map(([lo, la]) => [la, lo]), { color: "#7A8794", weight: 3, opacity: .6, dashArray: "6 8", interactive: false }).addTo(routeEbene);
    });
    const linie = L.polyline(st.route.geometry.coordinates.map(([lo, la]) => [la, lo]), { color: "#2E74B5", weight: 5, opacity: .85 }).addTo(routeEbene);
    const punktIcon = (t) => L.divIcon({ className: "marker", html: `<span class="routenpunkt">${t}</span>`, iconSize: [0, 0] });
    L.marker([R.von.lat, R.von.lon], { icon: punktIcon("A") }).addTo(routeEbene);
    L.marker([R.nach.lat, R.nach.lon], { icon: punktIcon("B") }).addTo(routeEbene);
    const z = zeitplan(plan, st.kandidaten, st.gesamtKm, st.fahrzeit);
    plan.stopps.forEach((s, n) => {
      const k = st.kandidaten[s.index];
      const m = L.marker([k.zeile[0], k.zeile[1]], { icon: punktIcon(n + 1), zIndexOffset: 3000 }).addTo(routeEbene);
      m.bindPopup(stoppPopup(R, k, s, n, z.halte[n]));
    });
    if (anpassen) {
      const links = amRechner.matches ? 450 : 20;
      karte.fitBounds(linie.getBounds(), { paddingTopLeft: [links, 90], paddingBottomRight: [20, amRechner.matches ? 40 : 120] });
    }
  }

  function stoppPopup(R, k, s, n, halt) {
    return `<b>${n + 1}. ${esc(ortVon(k))}</b><br>${esc(k.namen.join(" / "))}<br>${zahlText(k.kw)} kW · ${zahlText(k.abstand, 1)} km neben der Route<br>` +
      `an ${uhrzeit(R, halt.an)} · ${zeitText(s.ladenMin)} laden ${zahlText(s.von)} → ${zahlText(s.bis)} %<br>` +
      `ca. ${zahlText(s.euro, 2)} € · ${preisKurz(k)}${preisDetails(k)}<br>` +
      `<a href="${esc(routeLink({ lat: k.zeile[0], lon: k.zeile[1] }))}" target="_blank" rel="noopener">Hinfahren</a>`;
  }

  // Alle Ladestationen der gezeigten Strecke als Punkte auf der Karte
  function zeichneEntlang(R) {
    entlangEbene.clearLayers();
    if (!L.circleMarker) return;
    const st = R.strecken[(edit?.plan || R.varianten[R.gewaehlt]).strecke];
    st.kandidaten.forEach((k, i) => {
      L.circleMarker([k.zeile[0], k.zeile[1]], {
        renderer: zeichenflaeche, radius: k.kw >= 150 ? 6 : 4.5, weight: 1, color: "#fff",
        fillColor: k.kw >= 150 ? "#F2B200" : "#2E74B5", fillOpacity: .95,
      }).bindPopup(() => `<b>${esc(ortVon(k))}</b><br>${esc(k.namen.join(" / "))}<br>${zahlText(k.kw)} kW · km ${zahlText(k.s)} · ${zahlText(k.abstand, 1)} km neben der Route<br>` +
        `Für mich: ${preisKurz(k)}${besserMit(k)}<br><button type="button" class="textknopf" data-einplanen="${i}">Als Ladestopp einplanen</button>`)
        .addTo(entlangEbene);
    });
  }
  karte.on?.("popupopen", (ev) => {
    const b = ev.popup.getElement?.()?.querySelector("[data-einplanen]");
    b?.addEventListener("click", () => { karte.closePopup(); einplanen(Number(b.dataset.einplanen)); });
  });

  // Link, der die ganze Route mit den Stopps in einer Karten-App öffnet
  function mapsLink(R, plan) {
    const st = R.strecken[plan.strecke];
    const wege = plan.stopps.map((s) => `${st.kandidaten[s.index].zeile[0]},${st.kandidaten[s.index].zeile[1]}`);
    if (R.via) wege.unshift(`${R.via.lat},${R.via.lon}`);
    return "https://www.google.com/maps/dir/?api=1&travelmode=driving" +
      `&origin=${R.von.lat},${R.von.lon}&destination=${R.nach.lat},${R.nach.lon}` + (wege.length ? `&waypoints=${wege.join("%7C")}` : "");
  }

  // ---- Zusammenfassung und Leiste unten (wenn der Planer zu ist) ----
  const gesamtMin = (R, plan) => R.strecken[plan.strecke].route.duration / 60 + plan.minuten;
  function planTexte(R, plan) {
    return `${zeitText(gesamtMin(R, plan))} · ${plan.stopps.length} Stopp${plan.stopps.length === 1 ? "" : "s"} · ca. ${zahlText(plan.euro, 2)} €`;
  }
  function aktualisiereLeiste() {
    const offen = $("planer").classList.contains("offen");
    const plan = letzteRoute && (edit?.plan || letzteRoute.varianten[letzteRoute.gewaehlt]);
    $("planer-leiste").hidden = !(letzteRoute && plan && !offen);
    if (plan && letzteRoute) $("planer-leiste-text").textContent = planTexte(letzteRoute, plan);
  }
  function schliesse_planer() {
    $("planer").classList.remove("offen");
    $("route-knopf").setAttribute("aria-expanded", "false");
    aktualisiereLeiste();
  }

  // ---- Ergebnis ----
  function kopfHtml(R) {
    const schnell = R.strecken[0];
    const via = R.via ? ` über ${esc(R.via.name)}` : "";
    let h = `<p class="leise">${esc(R.von.name)} → ${esc(R.nach.name)}${via}: ${zahlText(schnell.route.distance / 1000)} km, reine Fahrzeit ${zeitText(schnell.route.duration / 60)}.</p>`;
    if (frStatus === "fehlt") h += `<p class="warnung">Ladestationen für Frankreich konnten nicht geladen werden. Dieser Plan berücksichtigt nur Deutschland. Bitte vor einer Fahrt nach Frankreich erneut mit Internet planen.</p>`;
    if (R.ausgefallen.length) h += `<p class="leise">${esc(R.ausgefallen.join(" und "))}: Strecke konnte gerade nicht berechnet werden.</p>`;
    if (gemieden().size) h += `<p class="leise">Ohne ${esc([...gemieden()].join(", "))}.</p>`;
    return h;
  }

  const FUSSNOTE = `<p class="leise">Kostenvergleich mit hinterlegten Tarifen, keine Live-Preise. Bei Preisbereichen wird der obere Wert verwendet; „ab“ bezeichnet einen Mindestpreis, ~ unsicher. Ohne Tarif: ≈${PLAN.ersatzPreisCt} ct/kWh. Monats-, Park- und Blockiergebühren sind nicht enthalten. Karten- und Abopreise gelten nur, wenn du die Karte unter „Meine Ladekarten“ wählst. Ladezeiten geschätzt: volle Leistung bis 50 %, danach abnehmend.</p>`;

  function optionKnopf(R, v, n) {
    const st = R.strecken[v.strecke];
    const zusatz = v.strecke ? st.text : v.stopps.length ? `${v.stopps.length} Stopp${v.stopps.length === 1 ? "" : "s"}` : "ohne Ladestopp";
    return `<button type="button" class="option" data-option="${n}" aria-pressed="${n === R.gewaehlt}">
      <b>${esc(v.namen.join(" · "))}</b><span>${zeitText(gesamtMin(R, v))}</span><span>ca. ${zahlText(v.euro, 2)} €</span><small>${esc(zusatz)}</small></button>`;
  }

  // Zeitleiste und Kosten einer Variante; im Editor mit Knöpfen zum Ändern
  function varianteHtml(R, v, bearbeiten) {
    const st = R.strecken[v.strecke];
    const { kandidaten, gesamtKm } = st;
    const fahrMin = st.route.duration / 60;
    const z = zeitplan(v, kandidaten, gesamtKm, st.fahrzeit);
    const ladenMin = v.stopps.reduce((a, s) => a + s.minuten, 0);
    const geschaetzt = v.stopps.some((s) => kandidaten[s.index].ct == null || kandidaten[s.index].preis?.unsicher);

    const etappe = (e, pos) => {
      let h = `<li class="zl-etappe"><span>${zahlText(e.km)} km · ${zeitText(e.minuten)}</span>`;
      if (bearbeiten) {
        if (edit.picker?.modus === "hinzu" && edit.picker.pos === pos) {
          const sVor = pos === 0 ? 0 : kandidaten[v.stopps[pos - 1].index].s;
          const sNach = pos === v.stopps.length ? gesamtKm : kandidaten[v.stopps[pos].index].s;
          h += wahlListe(st, imAbschnitt(st, sVor, sNach));
        } else {
          h += ` <button type="button" class="textknopf" data-hinzu="${pos}">+ Stopp hinzufügen</button>`;
        }
      }
      return h + `</li>`;
    };

    let liste = `<li class="zl-punkt"><span class="zl-marke">A</span><div><b>${esc(R.von.name)}</b><br><span class="leise">Abfahrt ${uhrzeit(R, 0)} mit ${zahlText(auto.start)} %</span></div></li>`;
    v.stopps.forEach((s, n) => {
      const k = kandidaten[s.index];
      const halt = z.halte[n];
      const warn = (s.warnungen || []).map((w) => `<br><span class="warnung">${esc(w)}</span>`).join("");
      liste += etappe(z.etappen[n], n);
      liste += `<li class="zl-stopp"><span class="zl-marke zl-laden">${n + 1}</span><div>
        <b>${esc(ortVon(k))}</b> · ${esc(k.namen[0])}<br>
        <span class="leise">${zahlText(k.kw)} kW${k.abstand >= 0.5 ? ` · ${zahlText(k.abstand, 1)} km neben der Route` : ""}${k.zeile[8] === "FR" ? " · Frankreich" : ""}</span><br>
        an ${uhrzeit(R, halt.an)} mit ${zahlText(s.von)} % · <b>${zeitText(s.ladenMin)}</b> laden bis ${zahlText(s.bis)} % · weiter ${uhrzeit(R, halt.ab)}<br>
        <strong>ca. ${zahlText(s.euro, 2)} €</strong> <span class="leise">· ${preisKurz(k)}${k.preis?.name && k.ct != null ? ` (${esc(k.preis.name)})` : ""}</span>${besserMit(k)}${warn}
        ${kartenHtml(k)}${preisDetails(k)}`;
      if (bearbeiten) {
        liste += `<div class="knoepfe"><button type="button" class="textknopf" data-ersetzen="${n}">Ersetzen</button>
          <button type="button" class="textknopf" data-entfernen="${n}">Entfernen</button></div>`;
        if (edit.picker?.modus === "ersetzen" && edit.picker.pos === n) {
          const nah = kandidaten.map((_, i) => i).filter((i) => Math.abs(kandidaten[i].s - k.s) <= 40 && i !== s.index && !edit.indices.includes(i));
          liste += wahlListe(st, nah);
        }
      }
      liste += `</div></li>`;
    });
    liste += etappe(z.etappen[v.stopps.length], v.stopps.length);
    liste += `<li class="zl-punkt"><span class="zl-marke">B</span><div><b>${esc(R.nach.name)}</b><br><span class="leise">Ankunft ${uhrzeit(R, z.ankunft)} mit ${zahlText(Math.max(0, v.zielProzent))} %</span></div></li>`;

    const warnZiel = (v.warnungen || []).map((w) => `<p class="warnung">${esc(w)}</p>`).join("");
    const knoepfe = bearbeiten
      ? `<a class="knopf-leise" href="${esc(mapsLink(R, v))}" target="_blank" rel="noopener">In Karten-App öffnen</a>
         <button type="button" class="knopf-leise" data-zurueck="1">Zurück zu den Vorschlägen</button>`
      : `<button type="button" class="knopf-leise" data-zeige="1">Auf der Karte zeigen</button>
         <button type="button" class="knopf-leise" data-bearbeiten="1">Bearbeiten</button>
         <a class="knopf-leise" href="${esc(mapsLink(R, v))}" target="_blank" rel="noopener">In Karten-App öffnen</a>`;
    return `<article class="variante${bearbeiten ? " bearbeiten" : ""}">
      <h3>${esc(bearbeiten ? "Meine Route" : v.namen.join(" und "))}${v.strecke ? ` <small>${esc(st.text)}</small>` : ""}</h3>
      <p><strong>${zeitText(fahrMin + v.minuten)}</strong> gesamt (${zeitText(fahrMin)} fahren, ${zeitText(ladenMin)} laden) · ${zahlText(st.route.distance / 1000)} km · ca. <strong>${zahlText(v.euro, 2)} €</strong>${geschaetzt ? " (teils geschätzt)" : ""}</p>
      ${warnZiel}
      <ol class="zeitleiste">${liste}</ol>
      ${vergleichHtml(R, v)}
      <div class="knoepfe">${knoepfe}</div>
    </article>`;
  }

  // "Welche Ladekarte lohnt sich?" für die Stopps dieser Variante
  function vergleichHtml(R, v) {
    if (!v.stopps.length) return "";
    const st = R.strecken[v.strecke];
    const meine = meineKarten();
    const kv = kartenVergleich(v.stopps, st.kandidaten, optionenFuer, meine);
    const zeile = (titel, r, extra = "") =>
      `<li><span>${titel}</span><b>${zahlText(r.euro, 2)} €${r.geschaetzt ? "*" : ""}</b>${extra}</li>`;
    let h = zeile("Ohne Karte (Ad-hoc)", kv.ohne);
    if (meine.size) h += zeile("Mit meinen Karten", kv.mit);
    h += kv.vorschlaege.slice(0, 4).map((p) => zeile(
      `+ ${esc(p.name)}${p.grund ? ` <small>${zahlText(p.grund, 2)} €/Monat</small>` : ""}`, p,
      `<small class="spart">spart ${zahlText(p.ersparnis, 2)} €</small><button type="button" class="textknopf" data-karte-nehmen="${esc(p.name)}">Habe ich</button>`)).join("");
    const stern = [kv.ohne, kv.mit, ...kv.vorschlaege].some((r) => r.geschaetzt)
      ? ` * enthält Stopps ohne bekannten Preis (≈${PLAN.ersatzPreisCt} ct/kWh).` : "";
    return `<section class="vergleich"><h4>Welche Ladekarte lohnt sich auf dieser Strecke?</h4><ul>${h}</ul>
      <p class="leise">Gleiche Ladestopps, je Säule der günstigste passende Preis. Grundgebühren sind nicht eingerechnet.${stern}</p></section>`;
  }

  // Alle Ladestationen an der Strecke, aufklappbar
  function entlangHtml(R) {
    const st = R.strecken[(edit?.plan || R.varianten[R.gewaehlt]).strecke];
    return `<details class="entlang" id="planer-entlang"${entlangOffen ? " open" : ""}><summary>Alle Ladestationen an dieser Strecke (${st.kandidaten.length})</summary><div id="planer-entlang-liste"></div></details>`;
  }
  function kandidatZeile(k, i, attr) {
    const meine = meineKarten();
    const best = optionenFuer(k).find((p) => LT.hatPreis(p));
    const guenstiger = best && best.typ !== "adhoc" && !meine.has(best.name) && (k.ct == null || best.v < k.ct)
      ? ` · mit ${esc(best.name)} ${esc(LT.label(best))}` : "";
    return `<button type="button" class="wahl" ${attr}="${i}"><b>${esc(ortVon(k))}</b> · ${esc(k.namen[0])}<br><span class="leise">km ${zahlText(k.s)}, ${zahlText(k.kw)} kW, ${preisKurz(k)}${guenstiger}, ${zahlText(k.abstand, 1)} km Abstand</span></button>`;
  }
  function fuelleEntlang() {
    const R = letzteRoute;
    const ziel = $("planer-entlang-liste");
    if (!R || !ziel) return;
    const st = R.strecken[(edit?.plan || R.varianten[R.gewaehlt]).strecke];
    const preis = (k) => k.ct ?? PLAN.ersatzPreisCt;
    const reihe = st.kandidaten.map((k, i) => i).sort(entlangSort === "preis"
      ? (a, b) => preis(st.kandidaten[a]) - preis(st.kandidaten[b]) || st.kandidaten[a].s - st.kandidaten[b].s
      : entlangSort === "kw" ? (a, b) => st.kandidaten[b].kw - st.kandidaten[a].kw || st.kandidaten[a].s - st.kandidaten[b].s
      : (a, b) => st.kandidaten[a].s - st.kandidaten[b].s);
    const sortKnopf = (wert, text) => `<button type="button" class="textknopf" data-entlang-sort="${wert}" ${entlangSort === wert ? 'aria-current="true"' : ""}>${text}</button>`;
    ziel.innerHTML = `<p class="leise">Sortiert nach ${sortKnopf("km", "Strecke")} · ${sortKnopf("preis", "Preis")} · ${sortKnopf("kw", "Leistung")}. Antippen plant die Station als Ladestopp ein.</p>
      <div class="auswahl">${reihe.slice(0, entlangMax).map((i) => kandidatZeile(st.kandidaten[i], i, "data-einplanen")).join("")}</div>` +
      (reihe.length > entlangMax ? `<button type="button" class="knopf-leise" data-entlang-mehr="1">Weitere ${Math.min(40, reihe.length - entlangMax)} anzeigen</button>` : "");
  }

  function zeigeErgebnis(R) {
    edit = null;
    letzteRoute = null;
    neuRechnen.ohneErgebnis = null;
    entlangEbene.clearLayers();
    if (!R.varianten.length) {
      const schnell = R.strecken[0];
      const km = schnell.gesamtKm;
      const l = groessteLuecke(km, schnell.kandidaten);
      const reichweite = (auto.akku * (auto.ziel - auto.reserve) / 100) / (auto.verbrauch / 100);
      const grund = l.km > reichweite
        ? `Zwischen Kilometer ${zahlText(l.ab)} und ${zahlText(l.ab + l.km)} gibt es keine passende Ladestation in den Daten (${frStatus === "geladen" ? "die Daten gelten für Deutschland und Frankreich" : "die Daten gelten nur für Deutschland"}), das ist mehr als die Reichweite von etwa ${zahlText(reichweite)} km zwischen zwei Halten.`
        : `Mit diesen Einstellungen ist keine Route mit Ladestopps möglich. Probiere einen größeren Abstand zur Route, eine niedrigere Mindestleistung oder mehr Ladestand.`;
      $("planer-ergebnis").innerHTML = kopfHtml(R) + `<p class="warnung">${grund}</p>`;
      routeEbene.clearLayers();
      neuRechnen.ohneErgebnis = R;     // nach geänderten Einstellungen erneut versuchen
      aktualisiereLeiste();
      return;
    }
    letzteRoute = R;
    const v = R.varianten[R.gewaehlt];
    $("planer-ergebnis").innerHTML = kopfHtml(R) +
      (R.varianten.length > 1 ? `<div class="optionen" role="group" aria-label="Varianten">${R.varianten.map((x, n) => optionKnopf(R, x, n)).join("")}</div>` : "") +
      varianteHtml(R, v, false) + entlangHtml(R) + FUSSNOTE;
    zeichnePlan(R, v, true);
    entlangWiederherstellen();
    aktualisiereLeiste();
  }

  // ---- Route bearbeiten: eigene Stopps, live neu gerechnet ----
  function imAbschnitt(st, vonS, bisS) {
    return st.kandidaten.map((k, i) => i).filter((i) => st.kandidaten[i].s > vonS + 5 && st.kandidaten[i].s < bisS - 5 && !edit.indices.includes(i));
  }
  function wahlListe(st, liste) {
    const { kandidaten } = st;
    const sort = edit.sort || "preis";
    const sortiert = [...liste].sort(sort === "preis"
      ? (a, b) => (kandidaten[a].ct ?? PLAN.ersatzPreisCt) - (kandidaten[b].ct ?? PLAN.ersatzPreisCt) || kandidaten[b].kw - kandidaten[a].kw
      : (a, b) => kandidaten[b].kw - kandidaten[a].kw || (kandidaten[a].ct ?? 99) - (kandidaten[b].ct ?? 99)).slice(0, 12);
    if (!sortiert.length) return `<p class="leise">Keine passende Ladestation in diesem Abschnitt.</p>`;
    return `<div class="auswahl"><p class="leise">Sortiert nach
      <button type="button" class="textknopf" data-sort="preis" ${sort === "preis" ? 'aria-current="true"' : ""}>Preis</button> ·
      <button type="button" class="textknopf" data-sort="kw" ${sort === "kw" ? 'aria-current="true"' : ""}>Leistung</button>
      (die besten 12)</p>` + sortiert.map((ci) => kandidatZeile(kandidaten[ci], ci, "data-wahl")).join("") +
      `<button type="button" class="knopf-leise" data-abbruch="1">Abbrechen</button></div>`;
  }

  function rendereEditor(anpassen) {
    const R = letzteRoute;
    const st = R.strecken[edit.strecke];
    edit.plan = { ...bewerten(st.gesamtKm, st.kandidaten, auto, edit.indices), strecke: edit.strecke, namen: ["Meine Route"] };
    $("planer-ergebnis").innerHTML = kopfHtml(R) + varianteHtml(R, edit.plan, true) + entlangHtml(R) +
      `<p class="leise">Keine Live-Preise. Preisbereiche werden mit dem oberen Wert berechnet, „ab“ ist ein Mindestpreis, ≈ geschätzt und ~ unsicher. Monats-, Park- und Blockiergebühren sind nicht enthalten.</p>`;
    zeichnePlan(R, edit.plan, anpassen);
    entlangWiederherstellen();
    aktualisiereLeiste();
  }

  function starteEditor() {
    const R = letzteRoute;
    const v = R.varianten[R.gewaehlt];
    edit = { strecke: v.strecke, indices: v.stopps.map((s) => s.index), picker: null, sort: "preis" };
  }

  // Station aus der Liste "an dieser Strecke" oder von der Karte als Stopp aufnehmen
  function einplanen(i) {
    if (!letzteRoute) return;
    if (!edit) starteEditor();
    if (!edit.indices.includes(i)) edit.indices = [...edit.indices, i];
    edit.picker = null;
    rendereEditor(false);
    if (!amRechner.matches) {
      $("planer").classList.add("offen");
      $("route-knopf").setAttribute("aria-expanded", "true");
      aktualisiereLeiste();
    }
  }

  $("planer-ergebnis").addEventListener("click", (ev) => {
    const R = letzteRoute;
    if (!R) return;
    const t = ev.target.closest("button, a");
    if (!t) return;
    const d = t.dataset;
    const zeigeKarte = () => { if (!amRechner.matches) schliesse_planer(); };
    if (d.option !== undefined) {
      R.gewaehlt = Number(d.option);
      zeigeErgebnis(R);
    } else if (d.zeige !== undefined) {
      zeichnePlan(R, edit?.plan || R.varianten[R.gewaehlt], true);
      zeigeKarte();
    } else if (d.bearbeiten !== undefined) {
      starteEditor();
      rendereEditor(true);
    } else if (d.karteNehmen) {
      meineKarten().add(d.karteNehmen);
      kartenGeaendert();
    } else if (d.einplanen !== undefined) {
      einplanen(Number(d.einplanen));
    } else if (d.entlangSort) {
      entlangSort = d.entlangSort;
      fuelleEntlang();
    } else if (d.entlangMehr) {
      entlangMax += 40;
      fuelleEntlang();
    } else if (!edit) {
      return;
    } else if (d.entfernen !== undefined) {
      const s = edit.plan.stopps[Number(d.entfernen)];
      edit.indices = edit.indices.filter((i) => i !== s.index);
      edit.picker = null;
      rendereEditor(false);
    } else if (d.ersetzen !== undefined) {
      edit.picker = { modus: "ersetzen", pos: Number(d.ersetzen) };
      rendereEditor(false);
    } else if (d.hinzu !== undefined) {
      edit.picker = { modus: "hinzu", pos: Number(d.hinzu) };
      rendereEditor(false);
    } else if (d.wahl !== undefined) {
      const neu = Number(d.wahl);
      if (edit.picker?.modus === "ersetzen") {
        const alt = edit.plan.stopps[edit.picker.pos].index;
        edit.indices = edit.indices.map((i) => (i === alt ? neu : i));
      } else {
        edit.indices = [...edit.indices, neu];
      }
      edit.picker = null;
      rendereEditor(false);
    } else if (d.sort) {
      edit.sort = d.sort;
      rendereEditor(false);
    } else if (d.abbruch) {
      edit.picker = null;
      rendereEditor(false);
    } else if (d.zurueck) {
      zeigeErgebnis(R);
    }
  });

  // Liste "Alle Ladestationen an dieser Strecke": erst beim Aufklappen füllen, dann auch auf der Karte zeigen
  $("planer-ergebnis").addEventListener("toggle", (ev) => {
    if (ev.target?.id !== "planer-entlang" || !letzteRoute) return;
    entlangOffen = ev.target.open;
    if (entlangOffen) {
      entlangMax = 40;
      fuelleEntlang();
      zeichneEntlang(letzteRoute);
    } else {
      entlangEbene.clearLayers();
    }
  }, true);

  // Nach jedem Neuaufbau des Ergebnisses: war die Liste offen, wieder füllen und auf der Karte zeigen
  function entlangWiederherstellen() {
    if (!entlangOffen || !letzteRoute) return;
    fuelleEntlang();
    zeichneEntlang(letzteRoute);
  }

  async function planeRoute(ev) {
    ev?.preventDefault();
    const knopf = $("planer-los");
    knopf.disabled = true;
    $("planer-ergebnis").innerHTML = "";
    entlangEbene.clearLayers();
    try {
      await datenBereit;   // Tarife und gespeicherte Karten müssen vor dem Kostenvergleich vorliegen.
      rendereKarten();
      $("planer-status").textContent = "Suche Orte …";
      const viaText = $("planer-via").value.trim();
      const [von, nach, via] = await Promise.all([
        $("planer-von").value.trim() === "" && ich ? { lat: ich.lat, lon: ich.lon, name: "Mein Standort" } : finde($("planer-von").value),
        finde($("planer-nach").value),
        viaText ? finde(viaText) : null,
      ]);
      $("planer-status").textContent = "Berechne Strecken …";
      const wege = [von, ...(via ? [via] : []), nach];
      const zusatz = STRECKEN.filter((s) => s.an());
      const [haupt, ...weitere] = await Promise.allSettled([holeOsrm(wege), ...zusatz.map((s) => holeValhalla(wege, s.optionen))]);
      if (haupt.status === "rejected") throw haupt.reason;
      await ladeDeDaten();
      const strecken = [bereiteStrecke(haupt.value, { art: "schnell", titel: "Am schnellsten", text: "" })];
      const ausgefallen = [];
      weitere.forEach((r, i) => {
        if (r.status !== "fulfilled") {
          console.warn(zusatz[i].titel, r.reason);
          ausgefallen.push(zusatz[i].titel);
          return;
        }
        const neu = bereiteStrecke(r.value, zusatz[i]);
        // Fast dieselbe Straße wie eine schon gefundene Strecke? Dann nicht doppelt anbieten.
        if (strecken.some((alt) => deckung(neu.punkte, alt.punkte) > 0.9)) return;
        strecken.push(neu);
      });
      await ladeFrankreich(strecken.flatMap((s) => s.punkte));
      $("planer-status").textContent = "Suche Ladestopps …";
      await new Promise((r) => setTimeout(r, 30));          // Anzeige aktualisieren, bevor gerechnet wird
      const R = { von, nach, via, strecken, ausgefallen, gewaehlt: 0, abfahrt: abfahrtAus($("planer-abfahrt").value) };
      berechne(R);
      $("planer-status").textContent = "";
      zeigeErgebnis(R);
    } catch (e) {
      console.error(e);
      $("planer-status").textContent = "";
      melde(e.message || "Planung fehlgeschlagen.");
    } finally {
      knopf.disabled = false;
    }
  }
  $("planer-form").addEventListener("submit", planeRoute);

  $("planer-tausch").addEventListener("click", () => {
    const v = $("planer-von").value;
    $("planer-von").value = $("planer-nach").value;
    $("planer-nach").value = v;
  });
  $("planer-leiste").addEventListener("click", () => {
    $("planer").classList.add("offen");
    $("route-knopf").setAttribute("aria-expanded", "true");
    aktualisiereLeiste();
  });

  $("route-knopf").addEventListener("click", () => {
    const offen = $("planer").classList.toggle("offen");
    $("route-knopf").setAttribute("aria-expanded", String(offen));
    if (offen) rendereKarten();
    if (offen && !letzteRoute) $("planer-nach").focus();
    aktualisiereLeiste();
  });
  $("planer-zu").addEventListener("click", schliesse_planer);
  $("planer-weg").addEventListener("click", () => {
    routeEbene.clearLayers();
    entlangEbene.clearLayers();
    letzteRoute = null;
    neuRechnen.ohneErgebnis = null;
    edit = null;
    $("planer-ergebnis").innerHTML = "";
    aktualisiereLeiste();
  });
}
