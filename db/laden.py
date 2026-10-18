"""Lädt daten/standorte.json und daten/preise.json in die Neon-Datenbank.

Aufruf:  DATABASE_URL="postgresql://..." python3 db/laden.py
Benötigt: pip install "psycopg[binary]"
Mehrfaches Ausführen ist ungefährlich: Stationen und Preise werden aktualisiert,
bestätigte Tarife (bestaetigt = true) bleiben unangetastet.
"""
import json, os, pathlib
import psycopg

WURZEL = pathlib.Path(__file__).resolve().parent.parent
url = os.environ["DATABASE_URL"]
standorte = json.loads((WURZEL / "daten/standorte.json").read_text(encoding="utf-8"))["standorte"]
preise = json.loads((WURZEL / "daten/preise.json").read_text(encoding="utf-8"))

with psycopg.connect(url) as con, con.cursor() as cur:
    cur.execute((WURZEL / "db/schema.sql").read_text(encoding="utf-8"))

    for s in standorte:
        cur.execute(
            """INSERT INTO stationen (id,lat,lon,strasse,plz,ort,kreis,bezeichnung,kw_max,dc,ladepunkte,betreiber,daten)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
               ON CONFLICT (id) DO UPDATE SET lat=EXCLUDED.lat, lon=EXCLUDED.lon, strasse=EXCLUDED.strasse,
                 plz=EXCLUDED.plz, ort=EXCLUDED.ort, kreis=EXCLUDED.kreis, bezeichnung=EXCLUDED.bezeichnung,
                 kw_max=EXCLUDED.kw_max, dc=EXCLUDED.dc, ladepunkte=EXCLUDED.ladepunkte,
                 betreiber=EXCLUDED.betreiber, daten=EXCLUDED.daten""",
            (s["id"], s["lat"], s["lon"], s.get("strasse"), s.get("plz"), s.get("ort"), s.get("kreis"),
             s.get("bezeichnung") or None, s["kwMax"], s["dc"], s["ladepunkte"], s["betreiber"],
             json.dumps(s, ensure_ascii=False)))

    for name, b in preise["betreiber"].items():
        cur.execute(
            """INSERT INTO betreiber (name, link) VALUES (%s,%s)
               ON CONFLICT (name) DO UPDATE SET link=EXCLUDED.link RETURNING id""",
            (name, b.get("link")))
        bid = cur.fetchone()[0]
        cur.execute("DELETE FROM tarife WHERE betreiber_id=%s AND zahlungsweg_id IS NULL AND NOT bestaetigt", (bid,))
        cur.execute(
            """INSERT INTO tarife (betreiber_id,bezeichnung,preis_ac_text,preis_dc_text,hinweis,quelle_link,sicherheit,recherchiert)
               VALUES (%s,'Standard',%s,%s,%s,%s,%s,%s)""",
            (bid, b.get("ac"), b.get("dc"), b.get("hinweis"), b.get("link"), b.get("status"), preise["stand"]))

    cur.execute("""UPDATE betreiber b SET standorte = (SELECT count(*) FROM stationen s WHERE b.name = ANY(s.betreiber))""")

    for sid, p in preise["standorte"].items():
        cur.execute(
            """INSERT INTO station_preise (station_id,preis_text,hinweis,link,sicherheit,recherchiert)
               VALUES (%s,%s,%s,%s,%s,%s)
               ON CONFLICT (station_id) DO UPDATE SET preis_text=EXCLUDED.preis_text, hinweis=EXCLUDED.hinweis,
                 link=EXCLUDED.link, sicherheit=EXCLUDED.sicherheit, recherchiert=EXCLUDED.recherchiert""",
            (sid, p.get("preis"), p.get("hinweis"), p.get("link"), p.get("status"), preise["stand"]))

print(f"{len(standorte)} Stationen, {len(preise['betreiber'])} Betreiber, {len(preise['standorte'])} Preise geladen.")
