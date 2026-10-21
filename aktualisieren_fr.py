"""Erzeugt daten/fr.json: öffentliche Ladestandorte in Frankreich für den Streckenplaner.

Quelle: "Base nationale des IRVE" auf transport.data.gouv.fr / data.gouv.fr
(Licence Ouverte / Etalab). Die Datei hat eine Zeile je Ladepunkt (rund 100 MB).

    python3 aktualisieren_fr.py              # lädt die aktuelle Datei
    python3 aktualisieren_fr.py irve.csv     # oder nimmt eine schon heruntergeladene

Aufbau von fr.json wie bei de.json:
  "betreiber", "orte", "standorte": [[lat, lon, kwMax, dc, betreiber, ladepunkte, id, ort], ...]
"""
import csv, datetime, io, json, math, os, re, sys, urllib.request

ORDNER = os.path.dirname(os.path.abspath(__file__))
ZIEL = os.path.join(ORDNER, "daten", "fr.json")
# Stabile Ressourcen-Adresse der validierten, deduplizierten PAN-Konsolidierung.
# Die alte Ressource 81743 wird zum 31.12.2026 eingestellt.
DOWNLOAD = "https://www.data.gouv.fr/api/1/datasets/r/4ca78c71-4ea4-475d-bd3a-d4aef88f7bf8"
KOPF = {"User-Agent": "Mozilla/5.0 (privates Ladesaeulen-Kartenprojekt)"}

csv.field_size_limit(10_000_000)


def wahr(x):
    return str(x).strip().lower() in ("true", "1", "oui", "vrai", "t")


def zahl(x):
    try:
        wert = float(str(x).strip().replace(",", "."))
        return wert if math.isfinite(wert) else None
    except ValueError:
        return None


def spalte(kopf, *namen):
    klein = {k.strip().lower(): i for i, k in enumerate(kopf)}
    for n in namen:
        if n in klein:
            return klein[n]
    return None


def koordinaten(zeile, i_lat, i_lon, i_xy):
    if i_lat is not None and i_lon is not None:
        la, lo = zahl(zeile[i_lat]), zahl(zeile[i_lon])
        if la is not None and lo is not None:
            return la, lo
    if i_xy is not None:
        m = re.findall(r"-?\d+(?:\.\d+)?", zeile[i_xy])
        if len(m) >= 2:
            return float(m[1]), float(m[0])        # [lon, lat]
    return None, None


def verarbeite(text):
    leser = csv.reader(io.StringIO(text))
    kopf = next(leser)
    c = {
        "id": spalte(kopf, "id_station_itinerance"),
        "betreiber": spalte(kopf, "nom_operateur", "nom_enseigne"),
        "kw": spalte(kopf, "puissance_nominale"),
        "ccs": spalte(kopf, "prise_type_combo_ccs"),
        "chademo": spalte(kopf, "prise_type_chademo"),
        "lat": spalte(kopf, "consolidated_latitude"),
        "lon": spalte(kopf, "consolidated_longitude"),
        "xy": spalte(kopf, "coordonneesxy"),
        "ort": spalte(kopf, "consolidated_commune", "commune", "nom_station", "adresse_station"),
    }
    if c["id"] is None or (c["xy"] is None and (c["lat"] is None or c["lon"] is None)):
        raise SystemExit("Erwartete Spalten fehlen. Hat sich das Format der Datei geändert?")
    standorte = {}
    for z in leser:
        if len(z) <= max(i for i in c.values() if i is not None):
            continue
        lat, lon = koordinaten(z, c["lat"], c["lon"], c["xy"])
        if lat is None or lon is None or not (41 < lat < 52) or not (-6 < lon < 10):
            continue                                   # Frankreich einschließlich Korsika; Übersee lassen wir weg
        sid = z[c["id"]].strip() or f"{lat:.4f}_{lon:.4f}"
        kw = zahl(z[c["kw"]]) if c["kw"] is not None else 0
        dc = (c["ccs"] is not None and wahr(z[c["ccs"]])) or (c["chademo"] is not None and wahr(z[c["chademo"]]))
        st = standorte.get(sid)
        if st is None:
            st = standorte[sid] = {"lat": lat, "lon": lon, "kw": 0, "dc": False, "n": 0,
                                   "betreiber": (z[c["betreiber"]].strip() if c["betreiber"] is not None else ""),
                                   "ort": (z[c["ort"]].strip() if c["ort"] is not None else "")}
        st["kw"] = max(st["kw"], kw or 0)
        st["dc"] = st["dc"] or dc
        st["n"] += 1
    return standorte


def main():
    if len(sys.argv) > 1:
        with open(sys.argv[1], "rb") as f:
            roh = f.read()
        name = sys.argv[1]
    else:
        print("Lade", DOWNLOAD, "…")
        with urllib.request.urlopen(urllib.request.Request(DOWNLOAD, headers=KOPF), timeout=600) as a:
            roh = a.read()
            name = a.geturl()
    try:
        text = roh.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = roh.decode("cp1252")
    datum = re.search(r"(\d{4}-?\d{2}-?\d{2})", os.path.basename(name))
    stand = datum.group(1) if datum else datetime.date.today().isoformat()
    st = verarbeite(text)
    if not st:
        raise SystemExit("Keine französischen Standorte gefunden; vorhandene Daten bleiben erhalten.")
    namen = sorted({s["betreiber"] for s in st.values() if s["betreiber"]})
    orte = sorted({s["ort"] for s in st.values() if s["ort"]})
    nr = {n: i for i, n in enumerate(namen)}
    onr = {n: i for i, n in enumerate(orte)}
    zeilen = [[round(s["lat"], 4), round(s["lon"], 4), round(s["kw"]), int(s["dc"]),
               nr.get(s["betreiber"], -1), s["n"], sid, onr.get(s["ort"], -1)] for sid, s in st.items()]
    ergebnis = {"stand": stand, "quelle": "Base nationale des IRVE, Licence Ouverte (Etalab)",
                "betreiber": namen, "orte": orte, "standorte": zeilen}
    os.makedirs(os.path.dirname(ZIEL), exist_ok=True)
    with open(ZIEL, "w", encoding="utf-8") as f:
        json.dump(ergebnis, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Fertig: {len(zeilen)} Standorte, {len(namen)} Betreiber (Stand {stand}).")


if __name__ == "__main__":
    main()
