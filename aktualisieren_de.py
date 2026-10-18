"""Erzeugt daten/de.json: alle öffentlichen Ladestandorte in Deutschland in kompakter Form.

Gedacht für den Streckenplaner (Standorte entlang einer Route). Nutzt dieselbe
Verarbeitung wie aktualisieren.py, behält aber nur das Nötigste je Standort.

    python3 aktualisieren_de.py            # lädt die aktuelle Liste der Bundesnetzagentur
    python3 aktualisieren_de.py liste.csv  # oder nimmt eine schon heruntergeladene Datei

Aufbau von de.json:
  "betreiber": ["Name", ...]                  Liste aller Betreiber
  "orte": ["Name", ...]                       Liste aller Orte
  "standorte": [[lat, lon, kwMax, dc, betreiber-Nummer(n), ladepunkte, id, ort-Nummer], ...]
  dc ist 1 oder 0; betreiber ist eine Zahl oder bei mehreren eine Liste von Zahlen.
"""
import datetime, json, os, re, sys

import aktualisieren as a

a.in_region = lambda kreis, lat, lon, hat_kreisspalte: True   # ganz Deutschland
ZIEL = os.path.join(a.ORDNER, "daten", "de.json")


def main():
    if len(sys.argv) > 1:
        with open(sys.argv[1], "rb") as f:
            roh = f.read()
        name = sys.argv[1]
    else:
        url = a.finde_csv_link()
        print(f"Lade {url} …")
        roh = a.hole(url)
        name = url
    datum = re.search(r"(\d{4}-\d{2}-\d{2})", os.path.basename(name))
    stand = datum.group(1) if datum else datetime.date.today().isoformat()

    liste, anzahl = a.verarbeite(a.als_text(roh))
    namen = sorted({b for st in liste for b in st["betreiber"]})
    nr = {n: i for i, n in enumerate(namen)}
    orte = sorted({st["ort"] for st in liste if st["ort"]})
    onr = {n: i for i, n in enumerate(orte)}
    zeilen = []
    for st in liste:
        if all("betrieb" not in (e["status"] or "").lower() and e["status"] for e in st["einrichtungen"]):
            continue   # nur Standorte, an denen mindestens eine Säule in Betrieb ist
        b = [nr[x] for x in st["betreiber"]]
        zeilen.append([round(st["lat"], 4), round(st["lon"], 4), round(st["kwMax"]), int(st["dc"]),
                       b[0] if len(b) == 1 else b, st["ladepunkte"], st["id"], onr.get(st["ort"], -1)])
    ergebnis = {"stand": stand, "quelle": "Bundesnetzagentur.de (CC BY 4.0)", "betreiber": namen, "orte": orte, "standorte": zeilen}
    os.makedirs(os.path.dirname(ZIEL), exist_ok=True)
    with open(ZIEL, "w", encoding="utf-8") as f:
        json.dump(ergebnis, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Fertig: {anzahl} Ladeeinrichtungen, {len(zeilen)} Standorte, {len(namen)} Betreiber, {len(orte)} Orte (Stand {stand}).")


if __name__ == "__main__":
    main()
