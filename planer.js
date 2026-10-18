"use strict";
// Streckenplaner: Route von A nach B mit Ladestopps.
//
// Aufbau:
//  - Der Rechenkern (planen, entlangDerRoute, ...) ist reine Mathematik und läuft auch in Node.
//  - Der Teil unten (Oberfläche) läuft nur im Browser und braucht die Karte aus index.html.
//
// Die Zahlen sind Näherungen: gleichbleibender Verbrauch, Ladezeit aus einer
// mittleren Ladeleistung statt echter Ladekurve. Preise fehlen an vielen Säulen.

// ===================== Rechenkern =====================

const PLAN = {
  schrittKm: 1,          // so fein wird die Route für die Suche zerlegt
  zelle: 0.06,           // Rastergröße in Grad (ca. 5 km) für die schnelle Suche
  mittleresTempo: 50,    // km/h für Umwege zur Säule
  ladeAufschlagMin: 4,   // Anschließen, Bezahlen, Weiterfahren
  kurveFaktor: 0.75,     // mittlere Ladeleistung im Verhältnis zur Höchstleistung
  ersatzPreisCt: 69,     // Annahme, wenn für den Betreiber kein Preis bekannt ist
};

function entfernungKm(lat1, lon1, lat2, lon2) {
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
    const seg = entfernungKm(lat0, lon0, lat1, lon1);
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

// Alle Standorte finden, die höchstens maxAbstandKm von der Route entfernt sind.
// standorte: Zeilen [lat, lon, kwMax, dc, betreiber, ladepunkte, id, ort]
// Ergebnis: [{zeile, s, abstand}] nach s sortiert; s = Kilometer entlang der Route.
function entlangDerRoute(punkte, standorte, maxAbstandKm, filter) {
  const z = PLAN.zelle;
  const raster = new Map();
  punkte.forEach((p, i) => {
    const k = Math.floor(p.lat / z) + "," + Math.floor(p.lon / z);
    (raster.get(k) || raster.set(k, []).get(k)).push(i);
  });
  const treffer = [];
  for (const zeile of standorte) {
    if (filter && !filter(zeile)) continue;
    const cy = Math.floor(zeile[0] / z), cx = Math.floor(zeile[1] / z);
    let bester = Infinity, bestS = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const liste = raster.get((cy + dy) + "," + (cx + dx));
        if (!liste) continue;
        for (const i of liste) {
          const p = punkte[i];
          const d = entfernungKm(zeile[0], zeile[1], p.lat, p.lon);
          if (d < bester) { bester = d; bestS = p.s; }
        }
      }
    }
    if (bester <= maxAbstandKm) treffer.push({ zeile, s: bestS, abstand: bester });
  }
  treffer.sort((a, b) => a.s - b.s);
  return treffer;
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
  const stopp = (k, laden) => {
    const kw = Math.max(1, Math.min(k.kw, auto.maxKw) * PLAN.kurveFaktor);
    const minuten = laden / kw * 60 + PLAN.ladeAufschlagMin + umweg(k) / PLAN.mittleresTempo * 60;
    return { minuten, euro: laden * (k.ct ?? PLAN.ersatzPreisCt) / 100 };
  };

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
        const e = stopp(k, laden);
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
          const e = stopp(k, laden);
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
    const e = stopp(kandidaten[kt.i], kt.kWh);
    stopps.unshift({ index: kt.i, kWh: kt.kWh, von: kt.ankunft / auto.akku * 100,
      bis: (kt.ankunft + kt.kWh) / auto.akku * 100, minuten: e.minuten, euro: e.euro });
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
  { name: "Schnellste", wert: (m, e) => m + e * 0.001 },
  { name: "Günstigste", wert: (m, e) => e + m * 0.02 },
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

if (typeof module !== "undefined") {
  module.exports = { PLAN, zerlege, entlangDerRoute, planen, alleVarianten, entfernungKm, groessteLuecke };
}

// ===================== Oberfläche (nur im Browser) =====================

if (typeof document !== "undefined" && typeof karte !== "undefined") {
  const DE_URL = "daten/de.json";
  const PLANER_SPEICHER = "ladekarte.planer";
  const AUTO_STANDARD = { akku: 60, verbrauch: 20, maxKw: 100, start: 80, reserve: 10, ziel: 80, minKw: 50, umweg: 3 };

  let deDaten = null;
  let auto = { ...AUTO_STANDARD };
  const routeEbene = L.layerGroup().addTo(karte);
  let letzteRoute = null;

  try { Object.assign(auto, JSON.parse(localStorage.getItem(PLANER_SPEICHER)) || {}); } catch {}
  const speichern = () => { try { localStorage.setItem(PLANER_SPEICHER, JSON.stringify(auto)); } catch {} };

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

  $("planer-felder").innerHTML = felder.map(([k, t, mi, ma, st]) =>
    `<label>${t}<input type="number" inputmode="decimal" data-feld="${k}" min="${mi}" max="${ma}" step="${st}" value="${auto[k]}"></label>`).join("");
  $("planer-felder").addEventListener("change", (ev) => {
    const f = ev.target.dataset?.feld;
    if (!f) return;
    const [, , mi, ma] = felder.find((x) => x[0] === f);
    const v = parseFloat(String(ev.target.value).replace(",", "."));
    auto[f] = Number.isFinite(v) ? Math.min(ma, Math.max(mi, v)) : AUTO_STANDARD[f];
    ev.target.value = auto[f];
    speichern();
  });

  const zeitText = (min) => {
    const m = Math.round(min);
    return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min` : `${m} min`;
  };
  const zahlText = (x, stellen = 0) => x.toFixed(stellen).replace(".", ",");

  async function ladeDeDaten() {
    if (deDaten) return deDaten;
    $("planer-status").textContent = "Lade Ladestationen für ganz Deutschland …";
    const a = await fetch(DE_URL);
    if (!a.ok) throw new Error("Daten nicht geladen (" + a.status + ")");
    deDaten = await a.json();
    return deDaten;
  }

  async function finde(text) {
    const t = text.trim();
    if (!t) throw new Error("Bitte Start und Ziel eintragen.");
    const m = t.match(/^(-?\d+[.,]\d+)\s*[,;]\s*(-?\d+[.,]\d+)$/);
    if (m) return { lat: parseFloat(m[1].replace(",", ".")), lon: parseFloat(m[2].replace(",", ".")), name: t };
    const a = await fetch("https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=de&accept-language=de&q=" + encodeURIComponent(t));
    if (!a.ok) throw new Error("Ortssuche nicht erreichbar.");
    const l = await a.json();
    if (!l.length) throw new Error(`„${t}“ nicht gefunden.`);
    return { lat: parseFloat(l[0].lat), lon: parseFloat(l[0].lon), name: l[0].display_name.split(",").slice(0, 2).join(",") };
  }

  async function hole(von, nach) {
    const url = `https://router.project-osrm.org/route/v1/driving/${von.lon},${von.lat};${nach.lon},${nach.lat}?overview=full&geometries=geojson`;
    const a = await fetch(url);
    if (!a.ok) throw new Error("Routenberechnung nicht erreichbar.");
    const d = await a.json();
    if (!d.routes?.length) throw new Error("Keine Route gefunden.");
    return d.routes[0];
  }

  function preisFuer(namen, dc) {
    const e = eigenerPreis({ betreiber: namen, dc });
    return e ? { ct: e.v, name: e.name, unsicher: e.unsicher } : null;
  }

  function kandidatenFuer(punkte) {
    const ausgeschlossen = ausgeblendet;
    const filter = (z) => {
      if (!z[3] || z[2] < auto.minKw) return false;
      const b = [].concat(z[4]).map((i) => deDaten.betreiber[i]);
      return !(ausgeschlossen.size && b.every((x) => ausgeschlossen.has(x)));
    };
    const treffer = entlangDerRoute(punkte, deDaten.standorte, auto.umweg, filter);
    return treffer.map((t) => {
      const z = t.zeile;
      const namen = [].concat(z[4]).map((i) => deDaten.betreiber[i]);
      const p = preisFuer(namen, true);
      return { s: t.s, abstand: t.abstand, kw: z[2], ct: p ? p.ct : null, preis: p, zeile: z, namen };
    });
  }

  function zeichnePlan(route, punkte, kandidaten, plan, von, nach) {
    routeEbene.clearLayers();
    const linie = L.polyline(route.geometry.coordinates.map(([lo, la]) => [la, lo]), { color: "#2E74B5", weight: 5, opacity: .85 }).addTo(routeEbene);
    const punktIcon = (t) => L.divIcon({ className: "marker", html: `<span class="routenpunkt">${t}</span>`, iconSize: [0, 0] });
    L.marker([von.lat, von.lon], { icon: punktIcon("A") }).addTo(routeEbene);
    L.marker([nach.lat, nach.lon], { icon: punktIcon("B") }).addTo(routeEbene);
    plan.stopps.forEach((s, n) => {
      const k = kandidaten[s.index];
      const m = L.marker([k.zeile[0], k.zeile[1]], { icon: punktIcon(n + 1), zIndexOffset: 3000 }).addTo(routeEbene);
      m.bindPopup(stoppText(s, k, n));
    });
    karte.fitBounds(linie.getBounds(), { paddingTopLeft: [20, 90], paddingBottomRight: [20, 120] });
  }

  function stoppText(s, k, n) {
    const ort = k.zeile[7] >= 0 ? deDaten.orte[k.zeile[7]] : "";
    const preis = k.preis ? `${zahlText(k.preis.ct)} ct (${esc(k.preis.name)})${k.preis.unsicher ? ", unsicher" : ""}` : `ca. ${PLAN.ersatzPreisCt} ct (geschätzt)`;
    return `<b>${n + 1}. ${esc(ort || "Ladestopp")}</b><br>${esc(k.namen.join(" / "))}<br>${zahlText(k.kw)} kW · ${zahlText(k.abstand, 1)} km neben der Route<br>` +
      `Laden ${zahlText(s.von)} → ${zahlText(s.bis)} %, ${zeitText(s.minuten)}, ca. ${zahlText(s.euro, 2)} €<br>Preis: ${preis}<br>` +
      `<a href="${esc(routeLink({ lat: k.zeile[0], lon: k.zeile[1] }))}" target="_blank" rel="noopener">Hinfahren</a>`;
  }

  function zeigeErgebnis(route, punkte, kandidaten, varianten, von, nach) {
    const fahrMin = route.duration / 60;
    const km = route.distance / 1000;
    const kopf = `<p class="leise">${esc(von.name)} → ${esc(nach.name)}: ${zahlText(km)} km, reine Fahrzeit ${zeitText(fahrMin)}.</p>`;
    if (!varianten.length) {
      const l = groessteLuecke(km, kandidaten);
      const reichweite = (auto.akku * (auto.ziel - auto.reserve) / 100) / (auto.verbrauch / 100);
      const grund = l.km > reichweite
        ? `Zwischen Kilometer ${zahlText(l.ab)} und ${zahlText(l.ab + l.km)} gibt es keine passende Ladestation in den Daten (sie gelten nur für Deutschland), das ist mehr als die Reichweite von etwa ${zahlText(reichweite)} km zwischen zwei Halten.`
        : `Mit diesen Einstellungen ist keine Route mit Ladestopps möglich. Probiere einen größeren Abstand zur Route, eine niedrigere Mindestleistung oder mehr Ladestand.`;
      $("planer-ergebnis").innerHTML = kopf + `<p class="warnung">${grund}</p>`;
      return;
    }
    $("planer-ergebnis").innerHTML = kopf + varianten.map((v, n) => {
      const gesamt = fahrMin + v.minuten;
      const ersatz = v.stopps.some((s) => kandidaten[s.index].ct == null);
      const stops = v.stopps.map((s, i) => {
        const k = kandidaten[s.index];
        const ort = k.zeile[7] >= 0 ? deDaten.orte[k.zeile[7]] : "Ladestopp";
        const preis = k.preis ? `${zahlText(k.preis.ct)} ct${k.preis.unsicher ? "~" : ""}` : `≈${PLAN.ersatzPreisCt} ct?`;
        return `<li><b>${i + 1}. ${esc(ort)}</b> · ${esc(k.namen[0])}<br><span class="leise">${zahlText(k.kw)} kW, Laden ${zahlText(s.von)}→${zahlText(s.bis)} %, ${zeitText(s.minuten)}, ${zahlText(s.euro, 2)} € (${preis})</span></li>`;
      }).join("");
      return `<article class="variante" data-variante="${n}">
        <h3>${esc(v.namen.join(" und "))}</h3>
        <p><strong>${zeitText(gesamt)}</strong> gesamt · ${v.stopps.length} Stopp${v.stopps.length === 1 ? "" : "s"} · ca. <strong>${zahlText(v.euro, 2)} €</strong>${ersatz ? " (teils geschätzt)" : ""}</p>
        ${stops ? `<ul class="stopps">${stops}</ul>` : `<p class="leise">Ohne Ladestopp erreichbar.</p>`}
        <button type="button" class="knopf-leise" data-zeige="${n}">Auf der Karte zeigen</button>
      </article>`;
    }).join("") + `<p class="leise">Schätzung mit gleichbleibendem Verbrauch und mittlerer Ladeleistung. Preise sind teils geschätzt (≈) oder unsicher (~). Verbindlich sind Anzeige an der Säule und Tarif des Anbieters.</p>`;
    letzteRoute = { route, punkte, kandidaten, varianten, von, nach };
    zeichnePlan(route, punkte, kandidaten, varianten[0], von, nach);
  }

  $("planer-ergebnis").addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-zeige]");
    if (!b || !letzteRoute) return;
    const { route, punkte, kandidaten, varianten, von, nach } = letzteRoute;
    zeichnePlan(route, punkte, kandidaten, varianten[Number(b.dataset.zeige)], von, nach);
    $("planer").classList.remove("offen");
  });

  async function planeRoute(ev) {
    ev?.preventDefault();
    const knopf = $("planer-los");
    knopf.disabled = true;
    $("planer-ergebnis").innerHTML = "";
    try {
      $("planer-status").textContent = "Suche Orte …";
      const [von, nach] = await Promise.all([
        $("planer-von").value.trim() === "" && ich ? { lat: ich.lat, lon: ich.lon, name: "Mein Standort" } : finde($("planer-von").value),
        finde($("planer-nach").value),
      ]);
      $("planer-status").textContent = "Berechne Route …";
      const route = await hole(von, nach);
      await ladeDeDaten();
      $("planer-status").textContent = "Suche Ladestopps …";
      await new Promise((r) => setTimeout(r, 30));          // Anzeige aktualisieren, bevor gerechnet wird
      const punkte = zerlege(route.geometry.coordinates);
      const kandidaten = kandidatenFuer(punkte);
      const gesamtKm = punkte[punkte.length - 1].s;
      const varianten = alleVarianten(gesamtKm, kandidaten, auto);
      $("planer-status").textContent = "";
      zeigeErgebnis(route, punkte, kandidaten, varianten, von, nach);
    } catch (e) {
      console.error(e);
      $("planer-status").textContent = "";
      melde(e.message || "Planung fehlgeschlagen.");
    } finally {
      knopf.disabled = false;
    }
  }
  $("planer-form").addEventListener("submit", planeRoute);

  $("route-knopf").addEventListener("click", () => {
    const offen = $("planer").classList.toggle("offen");
    $("route-knopf").setAttribute("aria-expanded", String(offen));
    if (offen) $("planer-nach").focus();
  });
  $("planer-zu").addEventListener("click", () => {
    $("planer").classList.remove("offen");
    $("route-knopf").setAttribute("aria-expanded", "false");
  });
  $("planer-weg").addEventListener("click", () => {
    routeEbene.clearLayers();
    letzteRoute = null;
    $("planer-ergebnis").innerHTML = "";
  });
}
