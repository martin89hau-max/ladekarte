import csv
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import aktualisieren_fr as fr


def csv_text(rows):
    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=list(rows[0]))
    writer.writeheader()
    writer.writerows(rows)
    return out.getvalue()


class FrankreichImportTest(unittest.TestCase):
    def test_pan_station_mit_mehreren_ladepunkten(self):
        row = {
            "id_station_itinerance": "FRTEST1", "nom_operateur": "Testbetrieb",
            "nom_station": "Paris Centre", "puissance_nominale": "22",
            "prise_type_combo_ccs": "false", "prise_type_chademo": "false",
            "coordonneesXY": "[2.35, 48.86]",
        }
        stations = fr.verarbeite(csv_text([
            row, dict(row, puissance_nominale="150,5", prise_type_combo_ccs="true")
        ]))
        self.assertEqual(len(stations), 1)
        station = stations["FRTEST1"]
        self.assertEqual((station["lat"], station["lon"]), (48.86, 2.35))
        self.assertEqual((station["n"], station["kw"], station["dc"]), (2, 150.5, True))
        self.assertEqual(station["ort"], "Paris Centre")

    def test_korsika_bleibt_uebersee_und_ungueltige_werte_entfallen(self):
        row = {
            "id_station_itinerance": "CORSE", "consolidated_latitude": "42.7",
            "consolidated_longitude": "9.45", "puissance_nominale": "NaN",
        }
        stations = fr.verarbeite(csv_text([
            row,
            dict(row, id_station_itinerance="REUNION", consolidated_latitude="-21.1", consolidated_longitude="55.5"),
            dict(row, id_station_itinerance="INVALID", consolidated_longitude="nan"),
        ]))
        self.assertEqual(list(stations), ["CORSE"])
        self.assertEqual(stations["CORSE"]["kw"], 0)

    def test_unvollstaendige_koordinatenspalten_werden_abgelehnt(self):
        with self.assertRaises(SystemExit):
            fr.verarbeite("id_station_itinerance,consolidated_latitude\nFR1,48.8\n")

    def test_leerer_import_ueberschreibt_keine_vorhandenen_daten(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "empty.csv"
            source.write_text("id_station_itinerance,coordonneesXY\n", encoding="utf-8")
            target = Path(directory) / "fr.json"
            target.write_text('{"standorte":["vorhanden"]}', encoding="utf-8")
            with patch.object(fr, "ZIEL", str(target)), patch("sys.argv", ["aktualisieren_fr.py", str(source)]):
                with self.assertRaises(SystemExit):
                    fr.main()
            self.assertEqual(json.loads(target.read_text(encoding="utf-8"))["standorte"], ["vorhanden"])


if __name__ == "__main__":
    unittest.main()
