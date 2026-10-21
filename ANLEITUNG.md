# Ladekarte Haßberge und Schweinfurt

Eine Web-App, die alle öffentlichen Ladesäulen in den Landkreisen Haßberge und Schweinfurt (inklusive Stadt Schweinfurt) auf einer Karte zeigt. Die Daten kommen aus der Liste der Bundesnetzagentur und werden jeden Montag automatisch aktualisiert. Du musst nichts von Hand eintragen.

## Was in den Dateien steckt

| Datei | Aufgabe |
| --- | --- |
| `index.html` | Die App selbst: Karte, Liste „In der Nähe“, Filter, Details zu jeder Säule |
| `aktualisieren.py` | Lädt die Liste der Bundesnetzagentur, filtert auf deine Region und speichert `daten/standorte.json` |
| `aktualisieren_fr.py` | Lädt französische IRVE-Ladestandorte und speichert `daten/fr.json` für den Streckenplaner |
| `planer.js` | Plant Routen mit Ladestopps in Deutschland und Frankreich |
| `.github/workflows/aktualisieren.yml` | Startet das Skript jeden Montag automatisch auf GitHub |
| `manifest.webmanifest` | Name, Farben und Icons, damit sich die Seite als App installieren lässt |
| `sw.js` | Service Worker: speichert App, Daten und angesehene Kartenausschnitte für unterwegs ohne Netz |
| `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png` | App-Icons für Android, iPhone und Computer |

## Einrichtung (einmalig, etwa 15 Minuten)

Am einfachsten geht das am Computer.

**1. Repository anlegen.** Melde dich bei github.com an (kostenloses Konto reicht). Klicke oben rechts auf „+“ und dann auf „New repository“. Name zum Beispiel `ladekarte`, Sichtbarkeit **Public** (GitHub Pages ist nur für öffentliche Repositories kostenlos). Dann „Create repository“.

**2. Dateien hochladen.** Im neuen Repository auf „uploading an existing file“ klicken und diese Dateien hineinziehen: `index.html`, `aktualisieren.py`, `manifest.webmanifest`, `sw.js` und die vier Icon-Dateien (`icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`). Unten auf „Commit changes“.

*Schon eingerichtet?* Dann reicht es, die neuen und geänderten Dateien genauso hochzuladen. Gleichnamige Dateien werden ersetzt.

**3. Den Ablauf anlegen.** Der Ordner `.github` lässt sich im Browser oft nicht hochladen, deshalb so: „Add file“ und dann „Create new file“. Als Dateinamen genau `.github/workflows/aktualisieren.yml` eintippen (die Schrägstriche legen die Ordner an). Den Inhalt der Datei `aktualisieren.yml` hineinkopieren und auf „Commit changes“ klicken.

**4. Daten zum ersten Mal holen.** Oben auf den Reiter „Actions“, links „Daten aktualisieren“ auswählen, rechts „Run workflow“ und nochmal „Run workflow“. Nach etwa einer Minute erscheint ein grüner Haken. Im Repository liegt jetzt die Datei `daten/standorte.json`.

**5. Seite veröffentlichen.** „Settings“, dann links „Pages“. Unter „Source“ „Deploy from a branch“ wählen, Branch `main`, Ordner `/ (root)`, „Save“. Nach ein bis zwei Minuten steht oben die Adresse, zum Beispiel `https://deinname.github.io/ladekarte/`.

**6. Aufs Handy.** Die Adresse im Handy-Browser öffnen und auf „Liste“ tippen. Android: Oben in der Liste erscheint „Als App aufs Handy“ mit dem Knopf „Installieren“ (alternativ Chrome-Menü, drei Punkte, „App installieren“). iPhone: in Safari auf „Teilen“ und „Zum Home-Bildschirm“, die Liste zeigt das auch als Hinweis. Danach startet die Karte mit eigenem Icon wie eine App.

## Am eigenen Rechner testen

```
python3 aktualisieren.py
python3 -m http.server 8000
```

Unter Windows heißt der Befehl meist `python` statt `python3`. Dann im Browser `http://localhost:8000` öffnen. Ein Doppelklick auf `index.html` reicht nicht, weil der Browser die Datendatei dann aus Sicherheitsgründen nicht lädt.

## Anpassen

- **Weitere Landkreise:** In `aktualisieren.py` oben die Liste `REGION` ergänzen, zum Beispiel `"bad kissingen"`. Es reicht ein Teil des Namens, klein geschrieben.
- **Startausschnitt der Karte:** In `index.html` oben `START_MITTE` und `START_ZOOM` ändern.
- **Ab wann aus Punkten Schilder werden:** `PUNKTE_UNTER_ZOOM` in `index.html`.
- **Stecker-Knöpfe in der Liste:** `STECKER_GRUPPEN` in `index.html`. Es erscheinen nur Stecker, die in den Daten auch vorkommen.
- **App-Name und Farben:** in `manifest.webmanifest`.
- **Änderungen am Service Worker:** Wer `sw.js` ändert, zählt oben `VERSION` hoch (`"v1"` → `"v2"`). Änderungen an `index.html` und den Daten kommen auch ohne das an, weil die App diese immer zuerst aus dem Netz holt.

## Wenn etwas nicht klappt

- **Roter Haken bei Actions:** Auf den fehlgeschlagenen Lauf klicken und die Meldung lesen. Steht dort „Kein CSV-Link gefunden“, hat die Bundesnetzagentur ihre Seite umgebaut. Dann die CSV von bundesnetzagentur.de/ladesaeulenkarte herunterladen und lokal `python3 aktualisieren.py dateiname.csv` ausführen.
- **Fehler beim Speichern („Permission denied“ o. ä.):** Settings, Actions, General, ganz unten „Workflow permissions“ auf „Read and write permissions“ stellen.
- **Eine Säule fehlt auf der Karte:** Manchmal stehen in der Liste der Bundesnetzagentur falsche Koordinaten (zum Beispiel eine Säule aus Poppenhausen, die laut Liste in der Eifel steht). Solche Säulen lässt das Skript weg, damit die Karte nicht bis ans andere Ende Deutschlands aufzieht. Im Protokoll des Actions-Laufs steht dann eine Zeile „Ausgelassen, Koordinaten liegen außerhalb des Kreises“. Ab wie vielen Kilometern das gilt, steht oben in `aktualisieren.py` unter `MAX_ABSTAND_KM`.
- **App zeigt nach einer Änderung noch die alte Fassung:** Einmal mit Internet schließen und neu öffnen. Hilft das nicht, im Browser die Website-Daten der Seite löschen.
- **Montags kommt nichts Neues:** Die Bundesnetzagentur aktualisiert die Liste nur einmal im Monat, an den anderen Montagen gibt es einfach keine Änderung. Falls GitHub den Ablauf nach längerer Ruhe pausiert, kommt eine E-Mail. Unter „Actions“ lässt er sich wieder einschalten.

## Was die Karte zeigt (und was noch nicht)

Jedes Schild auf der Karte zeigt die höchste Ladeleistung an diesem Standort in kW. Blau heißt normales Laden (AC), gelb heißt Schnellladen (DC). Weit herausgezoomt werden die Schilder zu Punkten. Ein Tipp öffnet die Details mit Steckern, Bezahlarten, Öffnungszeiten und einem Knopf für die Route.

## Strecken nach Frankreich

Im Streckenplaner kannst du auch französische Ziele wie Paris, Lyon oder Straßburg eingeben. Die französischen Ladestandorte werden bei passenden Routen automatisch nachgeladen. Enthalten sind das französische Festland und Korsika; Überseegebiete sind nicht enthalten. Die regionale Hauptkarte bleibt auf Haßberge und Schweinfurt ausgerichtet.

`daten/fr.json` stammt aus der validierten, deduplizierten [IRVE-Konsolidierung des französischen Point d’Accès National](https://www.data.gouv.fr/datasets/beta-bases-nationales-des-points-de-recharge-pour-vehicules-electriques-en-france-irve) (Licence Ouverte / Etalab). Der GitHub-Ablauf aktualisiert diese Datei jeden Montag. Lokal geht das mit `python3 aktualisieren_fr.py`; eine bereits geladene CSV kann als Dateiname übergeben werden. Stationsnamen dienen als Ortsangabe, falls die Quelle keine Gemeinde nennt. Die Daten enthalten keine Live-Belegung oder verifizierten französischen Ladetarife.

Nach dem ersten Laden bleiben die Stationsdaten offline verfügbar. Ortssuche und Routenberechnung benötigen weiterhin Internet. Falls die französischen Daten fehlen, zeigt die App eine Fehlermeldung; beim nächsten Planungsversuch lädt sie erneut.

## Ohne Netz

Nach dem ersten Öffnen mit Internet sind App und Ladesäulen auf dem Handy gespeichert. Im Funkloch startet die App trotzdem, zeigt alle Säulen, die Liste und die Details. Oben im Schild steht dann „Offline · Stand …“ mit dem Datum der gespeicherten Daten. Sobald wieder Netz da ist, holt sie sich still die neueste Fassung.

Von der Karte selbst sind nur die Ausschnitte gespeichert, die du dir schon einmal angesehen hast (bis etwa 800 Kacheln, ältere werden nach 30 Tagen erneuert). Unbekannte Gegenden bleiben offline grau, die Säulen darauf siehst du aber trotzdem.

## Liste „In der Nähe“

Oben rechts schaltet „Liste“ von der Karte auf eine Liste um. Sie ist nach Entfernung sortiert: zu deinem Standort, wenn du ihn freigegeben hast, sonst zur Mitte des Kartenausschnitts. Ein Tipp auf „Standort verwenden“ oder auf den Ortungsknopf unten rechts holt deinen Standort.

- **Suche:** Ort, Postleitzahl, Straße oder Betreiber eintippen. „hassfurt“ findet auch „Haßfurt“, „koenigsberg“ auch „Königsberg“.
- **Stecker:** Die Knöpfe CCS, Typ 2 usw. zeigen nur Standorte mit diesem Stecker. Die Auswahl merkt sich die App, du stellst dein Auto also nur einmal ein. Auch der Filter Alle/Schnell/Ab 150 kW wird gemerkt.
- **Zurück zur Karte:** Knopf „Karte“ oben rechts oder die Zurück-Taste des Handys. Ist eine Suche oder ein Stecker gewählt, zeigt die Karte oben links einen dunklen Hinweis. Ein Tipp darauf öffnet die Liste, das × hebt die Auswahl auf.
- Im Detailblatt einer Säule bringt „Auf der Karte“ dich direkt zu ihr. Am Computer bleibt die Karte neben der Liste sichtbar.

Live-Belegung und Ad-hoc-Preise kommen in Phase 2 über die Mobilithek dazu. Dafür sind Grün und Rot in der Karte bewusst noch frei.

Daten: Bundesnetzagentur.de (CC BY 4.0). Karte: OpenStreetMap-Mitwirkende. Angaben ohne Gewähr.
