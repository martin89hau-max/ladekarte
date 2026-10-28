"use strict";
// Gemeinsame Tarifauswahl: Preise sind an Land, Betreiber und Zahlungsweg gebunden.
//
// Ein Eintrag gilt entweder für einen bestimmten Betreiber (betreiber + aliases) oder,
// mit betreiber "*", als Standardpreis einer Ladekarte an allen übrigen Säulen im Land
// (Roaming). Hat dieselbe Karte für den Betreiber einen eigenen Eintrag, gilt nur dieser.
// nutzbar: false heißt: Die Karte funktioniert bei diesem Betreiber nicht.
const LadeTarife = (() => {
  const normalisiert = new Map();   // dieselben Namen kommen für jede Säule wieder
  const normal = (text) => {
    const s = String(text || "");
    let n = normalisiert.get(s);
    if (n === undefined) {
      n = s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      normalisiert.set(s, n);
    }
    return n;
  };
  const ueberall = (t) => t.betreiber === "*";

  // Passt der Eintrag zum Betreiber der Station? (Platzhalter "*" zählt hier nicht.)
  function betreiberPasst(t, st) {
    const namen = [t.betreiber, ...(t.aliases || [])].map(normal);
    return st.betreiber.some((b) => namen.includes(normal(b)));
  }

  function passt(t, st) {
    if ((t.land || "DE") !== (st.land || "DE")) return false;
    if (ueberall(t)) {
      if (!st.betreiber.length) return false;
      const ausser = (t.ausserBetreiber || []).map(normal);
      if (st.betreiber.every((b) => ausser.includes(normal(b)))) return false;
    } else if (!betreiberPasst(t, st)) {
      return false;
    }
    const station = normal(st.station);
    if (t.stationPrefix && !station.startsWith(normal(t.stationPrefix))) return false;
    if (t.stationen && !t.stationen.map(normal).includes(station)) return false;
    if (t.ausserStationen?.map(normal).includes(station)) return false;
    if (t.kwUeber != null && !(st.kwMax > t.kwUeber)) return false;
    if (t.kwBis != null && !(st.kwMax <= t.kwBis)) return false;
    return true;
  }

  // Preis eines Eintrags an dieser Station, mit Bereich und Unsicherheit
  function alsPreis(t, st) {
    const v = st.dc ? t.dc : t.ac;
    const min = st.dc ? t.dcMin : t.acMin;
    return { ...t, v, min, unsicher: t.sicherheit !== "gefunden" || t.ab === true || min != null };
  }
  const hatPreis = (p) => p.nutzbar !== false && Number.isFinite(p.v) && p.v >= 0;

  // Alle Karten und Zahlungswege an dieser Station, je Name der günstigste passende Eintrag.
  // Betreibereigene Einträge haben Vorrang vor dem Standardpreis "*" derselben Karte.
  function optionen(st, tarife) {
    const eigen = new Map(), standard = new Map();
    for (const t of tarife) {
      if (!passt(t, st)) continue;
      const ziel = ueberall(t) ? standard : eigen;
      (ziel.get(t.name) || ziel.set(t.name, []).get(t.name)).push(alsPreis(t, st));
    }
    const liste = [];
    for (const [name, eintraege] of [...eigen, ...[...standard].filter(([n]) => !eigen.has(n))]) {
      const mitPreis = eintraege.filter(hatPreis).sort((a, b) => a.v - b.v);
      liste.push(mitPreis[0] || eintraege.find((p) => p.nutzbar === false) || eintraege.find((p) => p.hinweis) || eintraege[0]);
    }
    return liste.sort((a, b) => (hatPreis(b) - hatPreis(a)) || (a.v ?? 0) - (b.v ?? 0) || a.name.localeCompare(b.name, "de"));
  }

  // Günstigster Preis, den ich hier zahle: Ad-hoc für jeden, Karten und Abos nur, wenn ich sie habe.
  // Ohne Preis, aber mit Hinweis (z. B. "Preis vor Ort prüfen"), kommt der Hinweis zurück.
  function bester(st, tarife, karten = new Set()) {
    let best = null, info = null;
    for (const p of optionen(st, tarife)) {
      if (p.typ !== "adhoc" && !karten.has(p.name)) continue;
      if (!hatPreis(p)) {
        if (p.hinweis && p.nutzbar !== false) info ||= p;
        continue;
      }
      // Bei Preisbereichen mit deren oberem Wert planen, nicht mit dem günstigsten Zeitfenster.
      if (!best || p.v < best.v) best = p;
    }
    return best || info;
  }

  // Kosten in Euro für eine Ladung mit diesem Preis (Startgebühr eingerechnet)
  function kosten(p, kWh) {
    return kWh * p.v / 100 + (p.jeVorgang || 0);
  }

  const zahl = (v) => new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(v);
  function label(t) {
    if (t?.nutzbar === false) return "nicht nutzbar";
    if (!t || !Number.isFinite(t.v)) return "Preis vor Ort prüfen";
    if (t.min != null) return `${zahl(t.min)}–${zahl(t.v)} ct/kWh`;
    return `${t.ab ? "ab " : ""}${zahl(t.v)} ct/kWh${t.unsicher && !t.ab ? "~" : ""}`;
  }
  return { passt, optionen, bester, kosten, hatPreis, label, normal };
})();

if (typeof module !== "undefined") module.exports = LadeTarife;
