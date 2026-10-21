"use strict";
// Gemeinsame Tarifauswahl: Preise sind an Land, Betreiber und Zahlungsweg gebunden.
const LadeTarife = (() => {
  const normal = (text) => String(text || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

  function passt(t, st) {
    if ((t.land || "DE") !== (st.land || "DE")) return false;
    const namen = [t.betreiber, ...(t.aliases || [])].map(normal);
    if (!st.betreiber.some((b) => namen.includes(normal(b)))) return false;
    const station = normal(st.station);
    if (t.stationPrefix && !station.startsWith(normal(t.stationPrefix))) return false;
    if (t.stationen && !t.stationen.map(normal).includes(station)) return false;
    if (t.ausserStationen?.map(normal).includes(station)) return false;
    if (t.kwUeber != null && !(st.kwMax > t.kwUeber)) return false;
    if (t.kwBis != null && !(st.kwMax <= t.kwBis)) return false;
    return true;
  }

  function bester(st, tarife, karten = new Set()) {
    let best = null, info = null;
    for (const t of tarife) {
      if (!passt(t, st) || (t.typ !== "adhoc" && !karten.has(t.name))) continue;
      const v = st.dc ? t.dc : t.ac;
      const min = st.dc ? t.dcMin : t.acMin;
      const tarif = { ...t, v, min, unsicher: t.sicherheit !== "gefunden" || t.ab === true || min != null };
      if (!Number.isFinite(v) || v < 0) {
        if (t.hinweis) info ||= tarif;
        continue;
      }
      // Bei Preisbereichen mit deren oberem Wert planen, nicht mit dem günstigsten Zeitfenster.
      if (!best || v < best.v) best = tarif;
    }
    return best || info;
  }

  const zahl = (v) => new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(v);
  function label(t) {
    if (!t || !Number.isFinite(t.v)) return "Preis vor Ort prüfen";
    if (t.min != null) return `${zahl(t.min)}–${zahl(t.v)} ct/kWh`;
    return `${t.ab ? "ab " : ""}${zahl(t.v)} ct/kWh${t.unsicher && !t.ab ? "~" : ""}`;
  }
  return { passt, bester, label };
})();

if (typeof module !== "undefined") module.exports = LadeTarife;
