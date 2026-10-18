// Service Worker der Ladekarte: macht die App installierbar und offline nutzbar.
//
// - App-Hülle (Seite, Icons, Leaflet) wird beim Installieren gespeichert.
// - Seite und Ladesäulen-Daten: erst Netz, bei Funkloch der gespeicherte Stand.
// - Schriften und Leaflet: aus dem Speicher (die Adressen enthalten die Version).
// - Kartenkacheln: was du dir angesehen hast, bleibt für unterwegs gespeichert
//   (höchstens KACHELN_MAX Stück, älteste fliegen zuerst raus).
//
// Wenn du diese Datei änderst, VERSION hochzählen, damit Handys die neue Fassung holen.

const VERSION = "v4";
const HUELLE = `ladekarte-huelle-${VERSION}`;
const DATEN = "ladekarte-daten";
const KACHELN = "ladekarte-kacheln";
const KACHELN_MAX = 800;          // etwa 15–25 MB
const KACHEL_ALTER_TAGE = 30;     // danach eine Kachel neu holen (wenn Netz da ist)
const NETZ_WARTEZEIT = 5000;      // so lange aufs Netz warten, dann gespeicherte Fassung zeigen

const EIGENE_DATEIEN = [
  "./",
  "manifest.webmanifest",
  "icon-192.png",
  "icon-512.png",
  "icon-maskable-512.png",
  "apple-touch-icon.png",
];
const FREMDE_DATEIEN = [
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css",
];

self.addEventListener("install", (ev) => {
  ev.waitUntil((async () => {
    const cache = await caches.open(HUELLE);
    await cache.addAll(EIGENE_DATEIEN.map((url) => new Request(url, { cache: "reload" })));
    // Fremde Dateien: Fehler hier sollen die Installation nicht verhindern
    await Promise.all(FREMDE_DATEIEN.map((url) =>
      cache.add(new Request(url, { mode: "cors" })).catch(() => {})));
    // Ladesäulen gleich mitnehmen, damit die App schon nach dem ersten Besuch offline geht
    await caches.open(DATEN).then((c) => c.addAll(["daten/standorte.json", "daten/preise.json", "daten/tarife.json"])).catch(() => {});
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (ev) => {
  ev.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith("ladekarte-huelle-") && name !== HUELLE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (ev) => {
  const req = ev.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (req.mode === "navigate") {
    // Nur die App-Seite selbst; andere Seiten im Ordner normal laden
    if (url.origin === location.origin && /\/(index\.html)?$/.test(url.pathname)) {
      ev.respondWith(erstNetz(req, HUELLE, "./"));
    }
  } else if (url.origin === location.origin && /\/daten\/(standorte|preise|tarife)\.json$/.test(url.pathname)) {
    ev.respondWith(erstNetz(req, DATEN));
  } else if (url.hostname.endsWith("tile.openstreetmap.org")) {
    ev.respondWith(kachel(ev));
  } else if (
    url.hostname === "cdnjs.cloudflare.com" ||
    url.hostname === "fonts.googleapis.com" ||
    url.hostname === "fonts.gstatic.com" ||
    url.origin === location.origin
  ) {
    ev.respondWith(erstSpeicher(req, HUELLE));
  }
});

// Netz zuerst; antwortet es nicht rechtzeitig oder gar nicht, die gespeicherte Fassung.
async function erstNetz(req, cacheName, ersatzSchluessel) {
  const cache = await caches.open(cacheName);
  const schluessel = ersatzSchluessel || req;
  // "no-cache": beim Server nachfragen statt dem HTTP-Cache des Browsers zu glauben,
  // sonst kommt eine geänderte Seite erst Minuten bis Tage später an.
  const netz = fetch(req, { cache: "no-cache" }).then(async (antwort) => {
    if (antwort.ok) await cache.put(schluessel, antwort.clone());
    return antwort;
  });
  netz.catch(() => {});   // Fehler werden unten behandelt
  const gespeichert = await cache.match(schluessel, { ignoreSearch: true });
  if (!gespeichert) return netz;
  // Bei langsamem Netz nicht ewig warten, aber im Hintergrund trotzdem aktualisieren
  const zeit = new Promise((fertig) => setTimeout(() => fertig(gespeichert), NETZ_WARTEZEIT));
  return Promise.race([netz.then((a) => (a.ok ? a : gespeichert), () => gespeichert), zeit]);
}

// Speicher zuerst, sonst Netz (und dann speichern).
async function erstSpeicher(req, cacheName) {
  const cache = await caches.open(cacheName);
  const gespeichert = await cache.match(req);
  if (gespeichert) return gespeichert;
  const antwort = await fetch(req);
  if (antwort.ok || antwort.type === "opaque") cache.put(req, antwort.clone()).catch(() => {});
  return antwort;
}

let kachelZaehler = 0;
async function kachel(ev) {
  const cache = await caches.open(KACHELN);
  const gespeichert = await cache.match(ev.request);
  const datum = Date.parse(gespeichert?.headers.get("date") || "");
  const frisch = gespeichert && (isNaN(datum) || Date.now() - datum < KACHEL_ALTER_TAGE * 864e5);
  if (frisch) return gespeichert;
  let antwort;
  try {
    antwort = await fetch(ev.request);
  } catch (fehler) {
    if (gespeichert) return gespeichert;   // alt, aber besser als nichts
    throw fehler;
  }
  if (antwort.ok) {
    ev.waitUntil(cache.put(ev.request, antwort.clone()).then(() => {
      if (++kachelZaehler % 50 === 0) return aufraeumen(cache);
    }));
  }
  return antwort;
}

async function aufraeumen(cache) {
  const schluessel = await cache.keys();   // älteste zuerst
  const zuViel = schluessel.length - KACHELN_MAX;
  for (let i = 0; i < zuViel; i++) await cache.delete(schluessel[i]);
}
