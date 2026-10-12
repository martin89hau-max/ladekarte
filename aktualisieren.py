#!/usr/bin/env python3
"""
Holt die aktuelle "Liste der Ladesäulen" der Bundesnetzagentur, filtert sie auf
die Landkreise Haßberge und Schweinfurt (inklusive Stadt Schweinfurt) und
speichert das Ergebnis als daten/standorte.json für die Karte (index.html).

Aufruf:
    python3 aktualisieren.py              # lädt die aktuelle Liste automatisch
    python3 aktualisieren.py liste.csv    # nutzt eine schon heruntergeladene CSV

Es wird nur die Python-Standardbibliothek gebraucht, kein pip install.
"""

import csv
import datetime
import io
import json
import math
import os
import re
import sys
import urllib.parse
import urllib.request
from statistics import median

# ---------------------------------------------------------------------------
# Einstellungen
# ---------------------------------------------------------------------------

# Teile des Kreisnamens aus der Spalte "Kreis/kreisfreie Stadt" (klein geschrieben).
# "schweinfurt" erwischt Landkreis UND Stadt Schweinfurt.
# Weitere Kreise einfach ergänzen, z. B. "bad kissingen", "rhön-grabfeld".
REGION = ["haßberge", "hassberge", "schweinfurt"]

# Notlösung, falls die Kreis-Spalte einmal fehlt: grobes Rechteck um die Region
# (Süd, West, Nord, Ost).
REGION_RECHTECK = (49.85, 9.95, 50.35, 10.95)

# Säulen, die weiter als so viele Kilometer von der Mitte ihres Kreises entfernt
# liegen, haben falsche Koordinaten in der Liste und werden ausgelassen.
# Ein Landkreis ist selten breiter als 60 km, 40 km lassen also genug Luft.
MAX_ABSTAND_KM = 40

# Seite der Bundesnetzagentur, auf der der Link zur CSV-Datei steht.
# Der Dateiname enthält das Datum und ändert sich jeden Monat, deshalb suchen
# wir den Link jedes Mal neu.
DOWNLOAD_SEITE = (
    "https://www.bundesnetzagentur.de/DE/Fachthemen/ElektrizitaetundGas/"
    "E-Mobilitaet/Ladesaeulenkarte/start.html"
)

ORDNER = os.path.dirname(os.path.abspath(__file__))
ZIELDATEI = os.path.join(ORDNER, "daten", "standorte.json")
KOPFZEILEN = {"User-Agent": "Mozilla/5.0 (privates Ladesaeulen-Kartenprojekt)"}


# ---------------------------------------------------------------------------
# Herunterladen
# ---------------------------------------------------------------------------

def hole(url):
    anfrage = urllib.request.Request(url, headers=KOPFZEILEN)
    with urllib.request.urlopen(anfrage, timeout=120) as antwort:
        return antwort.read()


def finde_csv_link():
    html = hole(DOWNLOAD_SEITE).decode("utf-8", errors="replace")
    treffer = re.findall(r'href="([^"]*Ladesaeulenregister[^"]*\.csv[^"]*)"', html, re.I)
    if not treffer:
        raise SystemExit(
            "Kein CSV-Link auf der Seite der Bundesnetzagentur gefunden.\n"
            "Vielleicht wurde die Seite umgebaut. Lade die CSV dann von Hand "
            "herunter und starte: python3 aktualisieren.py liste.csv"
        )
    return urllib.parse.urljoin(DOWNLOAD_SEITE, treffer[0].replace("&amp;", "&"))


def als_text(rohdaten):
    # Die Bundesnetzagentur hat schon UTF-8 und Windows-1252 verwendet.
    try:
        return rohdaten.decode("utf-8-sig")
    except UnicodeDecodeError:
        return rohdaten.decode("cp1252")


# ---------------------------------------------------------------------------
# Spalten finden
# ---------------------------------------------------------------------------
# Die Spaltennamen haben sich über die Jahre mehrfach geändert
# (z. B. "Anschlussleistung" -> "Nennleistung Ladeeinrichtung [kW]").
# Deshalb suchen wir Spalten über Stichworte statt über feste Namen.

def normalisiere(name):
    return re.sub(r"\s+", " ", name.replace("\ufeff", "")).strip().lower()


class Spalten:
    def __init__(self, kopf):
        self.namen = [normalisiere(n) for n in kopf]
        self.stecker = {}   # Ladepunkt-Nummer -> Spalte mit Steckertyp
        self.leistung = {}  # Ladepunkt-Nummer -> Spalte mit kW
        for i, n in enumerate(self.namen):
            m = re.search(r"steckertyp\w*\s*(\d+)$", n)
            if m:
                self.stecker[int(m.group(1))] = i
            m = re.search(r"(?:^|[_\s])p(\d+)\s*\[kw\]", n) or re.search(
                r"nennleistung stecker\s*(\d+)$", n
            )
            if m:
                self.leistung[int(m.group(1))] = i

    def suche(self, *stichworte, genau=False):
        for wort in stichworte:
            for i, n in enumerate(self.namen):
                if (n == wort) if genau else (wort in n):
                    return i
        return None


# ---------------------------------------------------------------------------
# Werte umwandeln
# ---------------------------------------------------------------------------

def zahl(text):
    if text is None:
        return None
    t = text.strip().replace(" ", "")
    if not t:
        return None
    if "," in t:  # deutsches Komma: "50,0345" oder "1.234,5"
        t = t.replace(".", "").replace(",", ".")
    try:
        return float(t)
    except ValueError:
        return None


STECKER_KURZ = [
    ("combo", "CCS"),
    ("ccs", "CCS"),
    ("chademo", "CHAdeMO"),
    ("tesla", "Tesla"),
    ("schuko", "Schuko"),
    ("typ 1", "Typ 1"),
    ("kupplung typ 2", "Typ 2 Kabel"),
    ("typ 2", "Typ 2"),
]


def stecker_kurz(text):
    namen = []
    for teil in re.split(r"[,;]", text):
        klein = teil.strip().lower()
        if not klein:
            continue
        name = next((kurz for muster, kurz in STECKER_KURZ if muster in klein), teil.strip())
        if name not in namen:
            namen.append(name)
    return namen


def ist_dc(stecker_text):
    t = stecker_text.lower()
    return "dc" in t or "combo" in t or "chademo" in t


# ---------------------------------------------------------------------------
# Hauptteil
# ---------------------------------------------------------------------------

def lies_zeilen(text):
    kopf_treffer = re.search(r"^.*Breitengrad.*$", text, re.M)
    if not kopf_treffer:
        raise SystemExit("Keine Kopfzeile mit 'Breitengrad' gefunden. Ist das die richtige Datei?")
    kopfzeile = kopf_treffer.group(0)
    trenner = ";" if kopfzeile.count(";") > kopfzeile.count(",") else ","
    leser = csv.reader(io.StringIO(text[kopf_treffer.start():]), delimiter=trenner)
    kopf = next(leser)
    return Spalten(kopf), leser


# Bezahlarten in der Liste der Bundesnetzagentur → kurze, verständliche Namen.
# Die Reihenfolge hier ist auch die Reihenfolge in der App.
BEZAHLARTEN = [
    ("kostenlos", "Kostenlos"),
    ("bargeld", "Bargeld"),
    ("kreditkarte", "Kreditkarte"),
    ("debitkarte", "Girocard/Debitkarte"),
    ("onlinezahl", "App oder Website"),
    ("rfid", "Ladekarte"),
    ("plug & charge", "Plug & Charge"),
    ("sonstige", "Sonstige"),
]


def bezahlarten(text):
    teile = [t.strip().lower() for t in text.split(";") if t.strip()]
    ergebnis = []
    for stichwort, name in BEZAHLARTEN:
        treffer = [t for t in teile if stichwort in t]
        if not treffer:
            continue
        # "Kreditkarte (Lesegerät)" + "Kreditkarte (NFC)" → "Kreditkarte (Lesegerät, kontaktlos)"
        wie = []
        if any("lesegerät" in t or "lesegeraet" in t for t in treffer):
            wie.append("Lesegerät")
        if any("nfc" in t for t in treffer):
            wie.append("kontaktlos")
        ergebnis.append(f"{name} ({', '.join(wie)})" if wie else name)
    # Unbekannte neue Bezahlarten nicht verschlucken
    bekannt = [s for s, _ in BEZAHLARTEN]
    for t in text.split(";"):
        if t.strip() and not any(s in t.lower() for s in bekannt):
            ergebnis.append(t.strip())
    return ergebnis


WOCHENTAGE = ["montag", "dienstag", "mittwoch", "donnerstag", "freitag", "samstag", "sonntag"]
TAG_KURZ = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]


def oeffnungszeiten(tage, zeiten, freitext):
    """Macht aus "Montag; Dienstag; … 00:00-23:59; 00:00-23:59; …" etwas wie
    "Rund um die Uhr" oder "Mo–Fr 08:00–16:00"."""
    frei = freitext.strip()
    if not tage and not zeiten:
        if not frei or frei.lower() == "keine angabe":
            return ""
        return "Rund um die Uhr" if "24/7" in frei or "24 stunden" in frei.lower() else frei

    tag_liste = [t.strip().lower() for t in tage.split(";") if t.strip()]
    zeit_liste = [z.strip() for z in zeiten.split(";") if z.strip()]
    if len(zeit_liste) == 1:
        zeit_liste *= len(tag_liste)
    if not tag_liste or len(tag_liste) != len(zeit_liste) or any(t not in WOCHENTAGE for t in tag_liste):
        # Unerwartetes Format: lieber roh zeigen als falsch deuten
        return " ".join(x for x in (tage, zeiten) if x)

    def schoen(zeit):
        zeit = zeit.replace(" ", "")
        if zeit in ("00:00-23:59", "00:00-24:00", "0:00-24:00"):
            return "ganztags"
        return zeit.replace("-", "–")

    je_tag = {WOCHENTAGE.index(t): schoen(z) for t, z in zip(tag_liste, zeit_liste)}
    if len(je_tag) == 7 and set(je_tag.values()) == {"ganztags"}:
        return "Rund um die Uhr"

    # Aufeinanderfolgende Tage mit gleicher Zeit zusammenfassen: "Mo–Fr 08:00–16:00"
    gruppen = []
    for tag in sorted(je_tag):
        zeit = je_tag[tag]
        if gruppen and gruppen[-1][1] == tag - 1 and gruppen[-1][2] == zeit:
            gruppen[-1][1] = tag
        else:
            gruppen.append([tag, tag, zeit])
    teile = []
    for von, bis, zeit in gruppen:
        if von == 0 and bis == 6:
            tage_text = "Täglich"
        elif von == bis:
            tage_text = TAG_KURZ[von]
        else:
            tage_text = f"{TAG_KURZ[von]}–{TAG_KURZ[bis]}"
        teile.append(f"{tage_text} {zeit}")
    return ", ".join(teile)


def abstand_km(lat1, lon1, lat2, lon2):
    # Für ein paar hundert Kilometer reicht die flache Näherung völlig.
    dy = (lat1 - lat2) * 111.2
    dx = (lon1 - lon2) * 111.2 * math.cos(math.radians((lat1 + lat2) / 2))
    return math.hypot(dx, dy)


def in_region(kreis, lat, lon, hat_kreisspalte):
    if hat_kreisspalte:
        k = kreis.lower()
        return any(teil in k for teil in REGION)
    sued, west, nord, ost = REGION_RECHTECK
    return sued <= lat <= nord and west <= lon <= ost


def verarbeite(text):
    sp, zeilen = lies_zeilen(text)

    s = {
        "id": sp.suche("ladeeinrichtungs-id"),
        "betreiber": sp.suche("betreiber", genau=True),
        "name": sp.suche("anzeigename"),
        "status": sp.suche("status", genau=True),
        "art": sp.suche("art der lade"),
        "anzahl": sp.suche("anzahl ladepunkte"),
        "kw": sp.suche("nennleistung ladeeinrichtung", "anschlussleistung"),
        "strasse": sp.suche("straße", "strasse"),
        "hausnr": sp.suche("hausnummer"),
        "plz": sp.suche("postleitzahl"),
        "ort": sp.suche("ort", genau=True),
        "kreis": sp.suche("kreisfreie"),
        "lat": sp.suche("breitengrad"),
        "lon": sp.suche("längengrad", "laengengrad"),
        "standort": sp.suche("standortbezeichnung"),
        "parken": sp.suche("parkraum"),
        "bezahlen": sp.suche("bezahlsystem"),
        "oeffnung": sp.suche("öffnungszeiten", "offnungszeiten", genau=True),
        "tage": sp.suche("öffnungszeiten: wochentage", "offnungszeiten: wochentage"),
        "zeiten": sp.suche("öffnungszeiten: tageszeiten", "offnungszeiten: tageszeiten"),
    }
    if s["lat"] is None or s["lon"] is None:
        raise SystemExit("Spalten für Breiten-/Längengrad nicht gefunden.")
    if not sp.stecker:
        print("Hinweis: keine Stecker-Spalten erkannt, Steckertypen fehlen in der Karte.")

    def feld(zeile, schluessel):
        i = s[schluessel]
        return zeile[i].strip() if i is not None and i < len(zeile) else ""

    # Erster Durchgang: alle Zeilen der Region einsammeln
    kandidaten = []
    for zeile in zeilen:
        if len(zeile) <= max(s["lat"], s["lon"]):
            continue
        lat, lon = zahl(feld(zeile, "lat")), zahl(feld(zeile, "lon"))
        if lat is None or lon is None:
            continue
        if not in_region(feld(zeile, "kreis"), lat, lon, s["kreis"] is not None):
            continue
        kandidaten.append((zeile, lat, lon))

    # Tippfehler in den Koordinaten aussortieren: Eine Säule, die weiter als
    # MAX_ABSTAND_KM von der Mitte ihres Kreises liegt, steht in Wahrheit woanders
    # und würde die Karte beim Start bis ans andere Ende Deutschlands aufziehen.
    mitten = {}
    for kreis in {feld(z, "kreis") for z, _, _ in kandidaten}:
        im_kreis = [(lat, lon) for z, lat, lon in kandidaten if feld(z, "kreis") == kreis]
        mitten[kreis] = (median(p[0] for p in im_kreis), median(p[1] for p in im_kreis))

    standorte = {}
    einrichtungen_gesamt = 0
    ausgelassen = {}

    for zeile, lat, lon in kandidaten:
        mitte = mitten[feld(zeile, "kreis")]
        if abstand_km(lat, lon, *mitte) > MAX_ABSTAND_KM:
            ort = f"{feld(zeile, 'ort')}, {feld(zeile, 'strasse')} {feld(zeile, 'hausnr')} bei {lat}, {lon}"
            ausgelassen[ort] = ausgelassen.get(ort, 0) + 1
            continue

        # Ladepunkte dieser Ladeeinrichtung
        punkte = []
        for nr in sorted(sp.stecker):
            i = sp.stecker[nr]
            roh = zeile[i].strip() if i < len(zeile) else ""
            if not roh:
                continue
            j = sp.leistung.get(nr)
            kw = zahl(zeile[j]) if j is not None and j < len(zeile) else None
            punkte.append({"stecker": stecker_kurz(roh), "kw": kw, "dc": ist_dc(roh)})

        kw_einrichtung = zahl(feld(zeile, "kw"))
        kw_max = max([p["kw"] or 0 for p in punkte] + [0]) or kw_einrichtung or 0
        dc = any(p["dc"] for p in punkte) or "schnell" in feld(zeile, "art").lower()

        oeffnung = oeffnungszeiten(feld(zeile, "tage"), feld(zeile, "zeiten"), feld(zeile, "oeffnung"))

        einrichtung = {
            "betreiber": feld(zeile, "betreiber"),
            "name": feld(zeile, "name"),
            "status": feld(zeile, "status"),
            "kw": kw_max,
            "dc": dc,
            "anzahl": int(zahl(feld(zeile, "anzahl")) or len(punkte) or 1),
            "punkte": punkte,
            "bezahlen": bezahlarten(feld(zeile, "bezahlen")),
            "oeffnung": oeffnung,
            "parken": feld(zeile, "parken"),
        }

        # Mehrere Ladesäulen am selben Ort (auf ca. 10 m genau) zu einem Standort bündeln
        schluessel = (round(lat, 4), round(lon, 4))
        if schluessel not in standorte:
            strasse = " ".join(x for x in (feld(zeile, "strasse"), feld(zeile, "hausnr")) if x)
            standorte[schluessel] = {
                "id": feld(zeile, "id") or f"{schluessel[0]}_{schluessel[1]}",
                "lat": round(lat, 6),
                "lon": round(lon, 6),
                "strasse": strasse,
                "plz": feld(zeile, "plz"),
                "ort": feld(zeile, "ort"),
                "kreis": feld(zeile, "kreis"),
                "bezeichnung": feld(zeile, "standort"),
                "einrichtungen": [],
            }
        standorte[schluessel]["einrichtungen"].append(einrichtung)
        einrichtungen_gesamt += 1

    for ort, n in ausgelassen.items():
        print(f"Ausgelassen, Koordinaten liegen außerhalb des Kreises ({n} Ladeeinrichtung(en)): {ort}")

    # Zusammenfassung pro Standort für die Marker
    liste = []
    for st in standorte.values():
        e = st["einrichtungen"]
        e.sort(key=lambda x: -x["kw"])
        st["kwMax"] = max(x["kw"] for x in e)
        st["dc"] = any(x["dc"] for x in e)
        st["ladepunkte"] = sum(x["anzahl"] for x in e)
        st["betreiber"] = sorted({x["betreiber"] for x in e if x["betreiber"]})
        liste.append(st)
    liste.sort(key=lambda x: (x["ort"], x["strasse"]))
    return liste, einrichtungen_gesamt


def main():
    # Damit Umlaute und „…“ auch in der Windows-Konsole lesbar ankommen
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except AttributeError:
        pass

    if len(sys.argv) > 1:
        pfad = sys.argv[1]
        print(f"Lese {pfad} …")
        with open(pfad, "rb") as f:
            rohdaten = f.read()
        quelle_url = None
    else:
        quelle_url = finde_csv_link()
        print(f"Lade {quelle_url} …")
        rohdaten = hole(quelle_url)

    name = os.path.basename(quelle_url or sys.argv[1])
    datum = re.search(r"(\d{4}-\d{2}-\d{2})", name)
    stand = datum.group(1) if datum else datetime.date.today().isoformat()

    standorte, anzahl = verarbeite(als_text(rohdaten))
    if not standorte:
        # Lieber abbrechen als eine leere Datei speichern, die die Karte leer macht.
        raise SystemExit("Keine Ladesäulen in der Region gefunden. Datei bleibt unverändert.")

    ergebnis = {
        "stand": stand,
        "erzeugt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "quelle": "Bundesnetzagentur.de (CC BY 4.0)",
        "standorte": standorte,
    }
    os.makedirs(os.path.dirname(ZIELDATEI), exist_ok=True)
    with open(ZIELDATEI, "w", encoding="utf-8") as f:
        json.dump(ergebnis, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Fertig: {anzahl} Ladeeinrichtungen an {len(standorte)} Standorten (Stand {stand}).")


if __name__ == "__main__":
    main()
