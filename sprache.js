"use strict";
// Sprachfassung der Ladekarte: Deutsch (Standard) und Französisch.
//
// - Sprachwahl: ?lang=fr / ?lang=de in der Adresse > gespeicherte Wahl > Sprache des Geräts.
// - t("Deutscher Text", { n: 3 }) liefert den Text in der gewählten Sprache. Schlüssel ist der
//   deutsche Originaltext, Platzhalter stehen in geschweiften Klammern. Fehlt ein Eintrag
//   (oder ist Deutsch gewählt), kommt der deutsche Text zurück.
// - tn(n, "{n} Standort", "{n} Standorte") wählt Ein- oder Mehrzahl. Im Wörterbuch steht dafür
//   unter dem deutschen Mehrzahl-Text ein Paar [Einzahl, Mehrzahl].
// - Das feste HTML wird beim Laden übersetzt: Textknoten, placeholder, aria-label, title, alt,
//   <title> und meta description. Elemente mit data-t-html werden als Ganzes (innerHTML) übersetzt.
// - Läuft auch in Node (Tests); dort bleibt alles Deutsch.
//
// Neue Texte in der Oberfläche: immer mit t("…") schreiben und hier ins Wörterbuch eintragen.
// tests/sprache.test.cjs meldet fehlende Einträge.

const Sprache = (() => {
  const SPEICHER = "ladekarte.sprache";
  const SPRACHEN = ["de", "fr"];

  // Deutsch → Französisch. Leerzeichen vor : ; ! ? » werden beim Anzeigen automatisch geschützt.
  const FR = {
    // ---------- Seite, Kopf ----------
    "Laden – Haßberge und Schweinfurt": "Recharge – Haßberge et Schweinfurt",
    "Öffentliche Ladesäulen in den Landkreisen Haßberge und Schweinfurt auf einer Karte und als Liste nach Entfernung.":
      "Bornes de recharge publiques des arrondissements de Haßberge et de Schweinfurt, sur une carte et en liste triée par distance.",
    "Laden": "Recharge",
    "Haßberge und Schweinfurt": "Haßberge et Schweinfurt",
    "Karte der Ladesäulen": "Carte des bornes de recharge",
    "{n} Standorte": ["{n} station", "{n} stations"],
    "{n} Ladepunkte": ["{n} point de charge", "{n} points de charge"],
    "Offline · Stand {datum}": "Hors ligne · données du {datum}",
    "Offline": "Hors ligne",

    // ---------- Sprachumschalter ----------
    "Auf Französisch umschalten": "Passer en français",
    "Auf Deutsch umschalten": "Passer en allemand",

    // ---------- Knöpfe oben, Filterleiste ----------
    "Liste": "Liste",
    "Karte": "Carte",
    "Route": "Itinéraire",
    "Filter": "Filtres",
    "Ladeleistung": "Puissance de charge",
    "Alle": "Toutes",
    "Schnell": "Rapide",
    "Ab 150 kW": "Dès 150 kW",
    "Meinen Standort zeigen": "Afficher ma position",

    // ---------- Suchchip auf der Karte ----------
    "In der Liste ändern": "Modifier dans la liste",
    "Suche und Auswahl aufheben": "Effacer la recherche et les filtres",
    "Mit Preis": "Avec prix",
    "{n} Betreiber aus": ["{n} opérateur masqué", "{n} opérateurs masqués"],
    "Nur {liste}": "Uniquement {liste}",
    "„{text}“": "« {text} »",

    // ---------- Liste ----------
    "Ladesäulen in der Nähe": "Bornes à proximité",
    "Als App aufs Handy": "Installer l'appli sur le téléphone",
    "Startet vom Startbildschirm und zeigt die Säulen auch ohne Netz.":
      "Se lance depuis l'écran d'accueil et affiche les bornes même sans réseau.",
    "Installieren": "Installer",
    "Hinweis ausblenden": "Masquer ce message",
    "Tippe in Safari auf „Teilen“ und dann auf „Zum Home-Bildschirm“. Dann startet die Karte wie eine App, auch ohne Netz.":
      "Dans Safari, touchez « Partager » puis « Sur l'écran d'accueil ». La carte se lance alors comme une appli, même sans réseau.",
    "Ort, PLZ, Straße oder Betreiber": "Ville, code postal, rue ou opérateur",
    "Suchen": "Rechercher",
    "Nur mit Preis": "Avec prix uniquement",
    "Meine Karten und Betreiber": "Mes cartes et opérateurs",
    "Diese Karten und Abos habe ich": "Mes cartes et abonnements",
    "Meine Karten und Abos": "Mes cartes et abonnements",
    "Diese Betreiber ausblenden": "Masquer ces opérateurs",
    "Betreiber ausblenden": "Masquer des opérateurs",
    "Gespeichert nur auf diesem Gerät. Ohne Auswahl gilt der Ad-hoc-Preis.":
      "Enregistré uniquement sur cet appareil. Sans sélection, c'est le prix ad hoc (sans abonnement) qui s'applique.",
    "Nur mit diesem Stecker": "Uniquement avec cette prise",
    "Keine Ladesäule passt zu Suche und Filtern.": "Aucune borne ne correspond à la recherche et aux filtres.",
    "Alles zurücksetzen": "Tout réinitialiser",
    "nach Entfernung zu deinem Standort": "triées par distance depuis votre position",
    "nach Entfernung zur Kartenmitte": "triées par distance depuis le centre de la carte",
    "Standort verwenden": "Utiliser ma position",
    "Derzeit außer Betrieb": "Actuellement hors service",
    ", bis {kw} kW": ", jusqu'à {kw} kW",
    ", Schnellladen": ", recharge rapide",
    "{ort}, {strasse}: bis {kw} kW": "{ort}, {strasse} : jusqu'à {kw} kW",
    "{d} entfernt": "à {d}",
    "Ladestation": "Station de recharge",

    // ---------- Detailblatt ----------
    "Schließen": "Fermer",
    "Route starten": "Lancer l'itinéraire",
    "Auf der Karte": "Sur la carte",
    "Stecker unbekannt": "Prise inconnue",
    "Keine Angaben zu den Steckern.": "Aucune information sur les prises.",
    "Säule {n}": "Borne {n}",
    "Betreiber": "Opérateur",
    "Bezahlen": "Paiement",
    "Öffnungszeiten": "Horaires",
    "Parken": "Stationnement",
    "Preis (brutto)": "Prix (TTC)",
    ", recherchiert {stand}": ", relevé en {stand}",
    "Für mich: {preis} ct/kWh": "Pour moi : {preis} ct/kWh",
    "Je nach Ladekarte:": "Selon la carte de recharge :",
    "für alle": "pour tous",
    "habe ich": "ma carte",
    "{preis} €/Monat": "{preis} €/mois",
    "Preis nicht bekannt": "Prix inconnu",
    "Angaben des Betreibers:": "Indications de l'opérateur :",
    "Unsicher oder nicht bestätigt": "Incertain ou non confirmé",
    "Bitte an der Säule oder in der Lade-App prüfen.": "Vérifiez à la borne ou dans l'appli de recharge.",
    "Preisquelle": "Source du prix",
    "Recherchiert im {stand}, ohne Gewähr. Verbindlich ist der Preis an der Säule.":
      "Relevé en {stand}, sans garantie. Seul le prix affiché à la borne fait foi.",
    "Datenstand {datum}. Quelle: {quelle}. Preise recherchiert {preise}. Angaben ohne Gewähr.":
      "Données du {datum}. Source : {quelle}. Prix relevés en {preise}. Sans garantie.",
    "Ladesäulen: Bundesnetzagentur.de (CC BY 4.0)": "Bornes : Bundesnetzagentur.de (CC BY 4.0)",

    // Werte aus den Stationsdaten (Bundesnetzagentur)
    "In Betrieb": "En service",
    "In Wartung": "En maintenance",
    "Außer Betrieb": "Hors service",
    "Kostenlos": "Gratuit",
    "Bargeld": "Espèces",
    "Kreditkarte": "Carte bancaire",
    "Girocard/Debitkarte": "Girocard/carte de débit",
    "App oder Website": "Appli ou site web",
    "Ladekarte": "Carte de recharge",
    "Sonstige": "Autres",
    "Lesegerät": "terminal",
    "kontaktlos": "sans contact",
    "Rund um die Uhr": "24 h/24, 7 j/7",
    "Täglich": "Tous les jours",
    "ganztags": "toute la journée",
    "Keine Beschränkung": "Sans restriction",
    "Nur für Kunden/Besucher": "Réservé aux clients et visiteurs",

    // ---------- Meldungen, Ortung, Laden der Daten ----------
    "Dieses Gerät kann den Standort nicht bestimmen.": "Cet appareil ne peut pas déterminer votre position.",
    "Dein Standort": "Votre position",
    "Standortzugriff ist blockiert. Erlaube ihn in den Browser-Einstellungen.":
      "L'accès à la position est bloqué. Autorisez-le dans les réglages du navigateur.",
    "Standort nicht gefunden. Versuch es draußen noch einmal.": "Position introuvable. Réessayez à l'extérieur.",
    "Noch keine Ladesäulen-Daten": "Pas encore de données sur les bornes",
    "Starte auf GitHub unter <b>Actions</b> den Ablauf „Daten aktualisieren“ und lade die Seite danach neu.":
      "Sur GitHub, lancez sous <b>Actions</b> le workflow « Daten aktualisieren », puis rechargez la page.",
    "Zum Testen am eigenen Rechner: <code>python3 aktualisieren.py</code> ausführen.":
      "Pour tester sur votre ordinateur : exécutez <code>python3 aktualisieren.py</code>.",
    "Keine Verbindung": "Pas de connexion",
    "Die Ladesäulen sind auf diesem Gerät noch nicht gespeichert. Öffne die App einmal mit Internet, danach geht sie auch offline.":
      "Les bornes ne sont pas encore enregistrées sur cet appareil. Ouvrez l'appli une fois avec Internet ; elle fonctionnera ensuite aussi hors ligne.",

    // ---------- Planer: Formular ----------
    "Streckenplaner": "Planificateur d'itinéraire",
    "Route planen": "Planifier un itinéraire",
    "Planer schließen": "Fermer le planificateur",
    "Start (leer = mein Standort)": "Départ (vide = ma position)",
    "z. B. Schweinfurt": "p. ex. Strasbourg",
    "⇅ Start und Ziel tauschen": "⇅ Inverser départ et destination",
    "Ziel": "Destination",
    "z. B. Hamburg oder Paris": "p. ex. Paris ou Munich",
    "Route über (optional)": "En passant par (facultatif)",
    "z. B. Frankfurt, wenn die Strecke anders laufen soll": "p. ex. Lyon, pour imposer un autre chemin",
    "Abfahrt (leer = jetzt)": "Heure de départ (vide = maintenant)",
    "Meine Ladekarten": "Mes cartes de recharge",
    "Der Preis hängt von Karte und Betreiber ab. Wähle deine Karten und Abos, dann rechnet der Planer mit deinem Preis. Ohne Auswahl gilt der Ad-hoc-Preis.":
      "Le prix dépend de la carte et de l'opérateur. Choisissez vos cartes et abonnements : le planificateur calcule alors avec votre prix. Sans sélection, c'est le prix ad hoc (sans abonnement) qui s'applique.",
    "Nicht laden bei": "Ne pas recharger chez",
    "Mein Auto und Einstellungen": "Mon véhicule et réglages",
    "Fahrzeug": "Véhicule",
    "Schöne Strecke über Landstraßen mitberechnen": "Proposer aussi un itinéraire agréable par les routes secondaires",
    "Strecke ohne Maut mitberechnen": "Proposer aussi un itinéraire sans péage",
    "Fahrzeugwerte sind Richtwerte. Ausgeblendete Betreiber aus der Liste gelten auch hier. Gespeichert nur auf diesem Gerät.":
      "Les valeurs des véhicules sont indicatives. Les opérateurs masqués dans la liste sont aussi exclus ici. Enregistré uniquement sur cet appareil.",
    "Planen": "Planifier",
    "Route von der Karte entfernen": "Retirer l'itinéraire de la carte",
    "Ladestationen: Bundesnetzagentur (Deutschland), Base nationale des IRVE (Frankreich, Licence Ouverte). Orte: Nominatim (OpenStreetMap). Strecken: OSRM-Demoserver (schnellste) und Valhalla der FOSSGIS (schönste, ohne Maut). Alles ohne Gewähr.":
      "Bornes : Bundesnetzagentur (Allemagne), Base nationale des IRVE (France, Licence Ouverte). Lieux : Nominatim (OpenStreetMap). Itinéraires : serveur de démonstration OSRM (le plus rapide) et Valhalla de la FOSSGIS (le plus agréable, sans péage). Sans garantie.",
    "Meine Route": "Mon itinéraire",
    "Anzeigen": "Afficher",
    "Akku (kWh)": "Batterie (kWh)",
    "Verbrauch bei 120 km/h (kWh/100 km)": "Consommation à 120 km/h (kWh/100 km)",
    "Tempo auf der Autobahn (km/h)": "Vitesse sur autoroute (km/h)",
    "Max. Ladeleistung (kW)": "Puissance de charge max. (kW)",
    "Start-Ladestand (%)": "Niveau de charge au départ (%)",
    "Reserve bei Ankunft (%)": "Réserve à l'arrivée (%)",
    "Laden bis höchstens (%)": "Recharger au plus jusqu'à (%)",
    "Säulen ab (kW)": "Bornes à partir de (kW)",
    "Max. Abstand zur Route (km)": "Écart max. à l'itinéraire (km)",
    "Eigene Werte": "Valeurs personnalisées",
    "Tarife werden geladen …": "Chargement des tarifs…",
    " ({n} gewählt)": [" ({n} sélectionnée)", " ({n} sélectionnées)"],

    // ---------- Planer: Strecken und Wertungen ----------
    "Am schnellsten": "Le plus rapide",
    "Am günstigsten": "Le moins cher",
    "Ausgewogen": "Équilibré",
    "Am schönsten": "Le plus agréable",
    "über Landstraßen, wenig Autobahn": "par les routes secondaires, peu d'autoroute",
    "Ohne Maut": "Sans péage",
    "meidet mautpflichtige Straßen": "évite les routes à péage",

    // ---------- Planer: Status und Fehler ----------
    "Lade Ladestationen für ganz Deutschland …": "Chargement des bornes pour toute l'Allemagne…",
    "Daten nicht geladen ({status})": "Données non chargées ({status})",
    "Lade Ladestationen für Frankreich …": "Chargement des bornes pour la France…",
    "Bitte Start und Ziel eintragen.": "Veuillez saisir le départ et la destination.",
    "Ortssuche nicht erreichbar.": "La recherche de lieux est indisponible.",
    "„{ort}“ nicht gefunden.": "« {ort} » introuvable.",
    "Routenberechnung nicht erreichbar.": "Le calcul d'itinéraire est indisponible.",
    "Keine Route gefunden.": "Aucun itinéraire trouvé.",
    "Suche Orte …": "Recherche des lieux…",
    "Mein Standort": "Ma position",
    "Berechne Strecken …": "Calcul des itinéraires…",
    "Suche Ladestopps …": "Recherche des arrêts recharge…",
    "Planung fehlgeschlagen.": "Échec de la planification.",

    // ---------- Planer: Ergebnis ----------
    "{zeit} (+{n} Tag)": "{zeit} (+{n} j)",
    "Betreiber unbekannt": "Opérateur inconnu",
    "Ladestopp": "Arrêt recharge",
    "Wird unter „Nicht laden bei“ gespeichert und lässt sich dort wieder einschalten":
      "Enregistré sous « Ne pas recharger chez » ; vous pouvez l'y réactiver",
    "Nicht mehr bei {marke} laden": "Ne plus recharger chez {marke}",
    "≈{ct} ct/kWh geschätzt": "≈{ct} ct/kWh (estimé)",
    "Tarif beim Anbieter": "Tarif chez le fournisseur",
    "Für die Planung: {preis} ct/kWh (oberer Bereichswert). ": "Pour la planification : {preis} ct/kWh (haut de la fourchette). ",
    "Mindestpreis als Rechenwert; der Stationspreis kann höher sein. ":
      "Prix minimum utilisé pour le calcul ; le prix à la borne peut être plus élevé. ",
    "{name} · Tarifdetails": "{name} · détails du tarif",
    "{preis} €/Monat zusätzlich; nicht in den Fahrtkosten enthalten. ":
      "{preis} €/mois en plus ; non inclus dans le coût du trajet. ",
    "{preis} € je Ladevorgang, in den Kosten enthalten. ": "{preis} € par recharge, inclus dans le coût. ",
    "Geprüft am {datum}. ": "Vérifié le {datum}. ",
    "Preise je Ladekarte ({n})": "Prix par carte de recharge ({n})",
    "Mit {name}: {preis}": "Avec {name} : {preis}",
    "{kw} kW · {km} km neben der Route": "{kw} kW · à {km} km de l'itinéraire",
    "an {zeit} · {dauer} laden {von} → {bis} %": "arrivée {zeit} · {dauer} de recharge {von} → {bis} %",
    "ca. {euro} €": "env. {euro} €",
    "ca. <strong>{euro} €</strong>": "env. <strong>{euro} €</strong>",
    "Hinfahren": "Y aller",
    "{kw} kW · km {s} · {km} km neben der Route": "{kw} kW · km {s} · à {km} km de l'itinéraire",
    "Für mich: {preis}": "Pour moi : {preis}",
    "Als Ladestopp einplanen": "Ajouter comme arrêt recharge",
    "{n} Stopps": ["{n} arrêt", "{n} arrêts"],
    " über {via}": " via {via}",
    "{von} → {nach}{via}: {km} km, reine Fahrzeit {zeit}.": "{von} → {nach}{via} : {km} km, temps de conduite {zeit}.",
    "Mit {tempo} km/h auf der Autobahn ({anteil} % der Strecke): Verbrauch im Schnitt etwa {verbrauch} kWh/100 km.":
      "À {tempo} km/h sur autoroute ({anteil} % du trajet) : consommation moyenne d'environ {verbrauch} kWh/100 km.",
    "Ladestationen für Frankreich konnten nicht geladen werden. Dieser Plan berücksichtigt nur Deutschland. Bitte vor einer Fahrt nach Frankreich erneut mit Internet planen.":
      "Les bornes pour la France n'ont pas pu être chargées. Ce plan ne tient compte que de l'Allemagne. Avant un trajet en France, replanifiez avec une connexion Internet.",
    " und ": " et ",
    "{strecken}: Strecke konnte gerade nicht berechnet werden.": "{strecken} : itinéraire impossible à calculer pour le moment.",
    "Ohne {liste}.": "Sans {liste}.",
    "Kostenvergleich mit hinterlegten Tarifen, keine Live-Preise. Bei Preisbereichen wird der obere Wert verwendet; „ab“ bezeichnet einen Mindestpreis, ~ unsicher. Ohne Tarif: ≈{ct} ct/kWh. Monats-, Park- und Blockiergebühren sind nicht enthalten. Karten- und Abopreise gelten nur, wenn du die Karte unter „Meine Ladekarten“ wählst. Ladezeiten geschätzt: volle Leistung bis 50 %, danach abnehmend.":
      "Comparaison des coûts avec les tarifs enregistrés, pas de prix en temps réel. Pour les fourchettes de prix, la valeur haute est utilisée ; « dès » désigne un prix minimum, ~ incertain. Sans tarif : ≈{ct} ct/kWh. Les frais mensuels, de stationnement et d'occupation prolongée ne sont pas inclus. Les prix des cartes et abonnements ne s'appliquent que si vous choisissez la carte sous « Mes cartes de recharge ». Temps de recharge estimés : pleine puissance jusqu'à 50 %, puis dégressive.",
    "ohne Ladestopp": "sans arrêt recharge",
    "+ Stopp hinzufügen": "+ Ajouter un arrêt",
    "Abfahrt {zeit} mit {prozent} %": "Départ {zeit} avec {prozent} %",
    " · {km} km neben der Route": " · à {km} km de l'itinéraire",
    " · Frankreich": " · France",
    "an {an} mit {von} % · <b>{dauer}</b> laden bis {bis} % · weiter {ab}":
      "arrivée {an} avec {von} % · <b>{dauer}</b> de recharge jusqu'à {bis} % · départ {ab}",
    "Ersetzen": "Remplacer",
    "Entfernen": "Supprimer",
    "Ankunft {zeit} mit {prozent} %": "Arrivée {zeit} avec {prozent} %",
    "In Karten-App öffnen": "Ouvrir dans l'appli GPS",
    "Zurück zu den Vorschlägen": "Retour aux propositions",
    "Auf der Karte zeigen": "Afficher sur la carte",
    "Bearbeiten": "Modifier",
    "<strong>{gesamt}</strong> gesamt ({fahren} fahren, {laden} laden)":
      "<strong>{gesamt}</strong> au total ({fahren} de conduite, {laden} de recharge)",
    " (teils geschätzt)": " (en partie estimé)",
    "Ohne Karte (Ad-hoc)": "Sans carte (prix ad hoc)",
    "Mit meinen Karten": "Avec mes cartes",
    "spart {euro} €": "économise {euro} €",
    "Habe ich": "Je l'ai",
    " * enthält Stopps ohne bekannten Preis (≈{ct} ct/kWh).": " * comprend des arrêts sans prix connu (≈{ct} ct/kWh).",
    "Welche Ladekarte lohnt sich auf dieser Strecke?": "Quelle carte de recharge est la plus avantageuse sur ce trajet ?",
    "Gleiche Ladestopps, je Säule der günstigste passende Preis. Grundgebühren sind nicht eingerechnet.":
      "Mêmes arrêts recharge, avec à chaque borne le prix compatible le plus bas. Les abonnements mensuels ne sont pas inclus.",
    "Alle Ladestationen an dieser Strecke ({n})": "Toutes les bornes le long de ce trajet ({n})",
    " · mit {name} {preis}": " · avec {name} {preis}",
    "km {s}, {kw} kW, {preis}{guenstiger}, {km} km Abstand": "km {s}, {kw} kW, {preis}{guenstiger}, à {km} km",
    "Strecke": "Trajet",
    "Preis": "Prix",
    "Leistung": "Puissance",
    "Sortiert nach {a} · {b} · {c}. Antippen plant die Station als Ladestopp ein.":
      "Trier par {a} · {b} · {c}. Touchez une borne pour l'ajouter comme arrêt recharge.",
    "Weitere {n} anzeigen": "Afficher {n} de plus",
    "Zwischen Kilometer {a} und {b} gibt es keine passende Ladestation in den Daten ({daten}), das ist mehr als die Reichweite von etwa {km} km zwischen zwei Halten.":
      "Entre le kilomètre {a} et le kilomètre {b}, aucune borne compatible dans les données ({daten}) ; c'est plus que l'autonomie d'environ {km} km entre deux arrêts.",
    "die Daten gelten für Deutschland und Frankreich": "les données couvrent l'Allemagne et la France",
    "die Daten gelten nur für Deutschland": "les données ne couvrent que l'Allemagne",
    "Mit diesen Einstellungen ist keine Route mit Ladestopps möglich. Probiere einen größeren Abstand zur Route, eine niedrigere Mindestleistung oder mehr Ladestand.":
      "Aucun itinéraire avec arrêts recharge n'est possible avec ces réglages. Essayez un écart plus grand à l'itinéraire, une puissance minimale plus basse ou un niveau de charge plus élevé.",
    "Varianten": "Variantes",
    "Keine passende Ladestation in diesem Abschnitt.": "Aucune borne compatible sur ce tronçon.",
    "Sortiert nach": "Trier par",
    "(die besten 12)": "(les 12 meilleures)",
    "Abbrechen": "Annuler",
    "Keine Live-Preise. Preisbereiche werden mit dem oberen Wert berechnet, „ab“ ist ein Mindestpreis, ≈ geschätzt und ~ unsicher. Monats-, Park- und Blockiergebühren sind nicht enthalten.":
      "Pas de prix en temps réel. Les fourchettes de prix sont calculées avec la valeur haute, « dès » est un prix minimum, ≈ estimé et ~ incertain. Les frais mensuels, de stationnement et d'occupation prolongée ne sont pas inclus.",

    // Warnungen aus dem Rechenkern (bewerten), dort deutsch, hier bei der Anzeige übersetzt
    "Bis hierher reicht der Akku nicht.": "La batterie ne suffit pas jusqu'ici.",
    "Ankunft unter der Reserve.": "Arrivée sous la réserve.",
    "Bis zum nächsten Halt ist es zu weit für das Ladeziel.": "Le prochain arrêt est trop loin pour le niveau de charge maximal choisi.",
    "Das Ziel ist mit diesen Stopps nicht erreichbar.": "La destination n'est pas atteignable avec ces arrêts.",
    "Ankunft am Ziel unter der Reserve.": "Arrivée à destination sous la réserve.",

    // ---------- Preistexte (tarife.js) ----------
    "nicht nutzbar": "non utilisable",
    "Preis vor Ort prüfen": "Prix à vérifier sur place",
    "ab {preis}": "dès {preis}",
  };

  const MONATE = {
    Januar: "janvier", Februar: "février", "März": "mars", April: "avril", Mai: "mai", Juni: "juin",
    Juli: "juillet", August: "août", September: "septembre", Oktober: "octobre", November: "novembre", Dezember: "décembre",
  };
  const TAGE = { Mo: "lun.", Di: "mar.", Mi: "mer.", Do: "jeu.", Fr: "ven.", Sa: "sam.", So: "dim." };

  let code = "de";

  // Welche Sprache? Reihenfolge: Adresse (?lang=), gespeicherte Wahl, Sprache des Geräts.
  function bestimme({ suche = "", gespeichert = null, sprachen = [] } = {}) {
    let ausAdresse = null;
    try { ausAdresse = new URLSearchParams(suche).get("lang"); } catch {}
    ausAdresse = String(ausAdresse || "").toLowerCase().slice(0, 2);
    if (SPRACHEN.includes(ausAdresse)) return ausAdresse;
    if (SPRACHEN.includes(gespeichert)) return gespeichert;
    for (const s of sprachen) {
      const kurz = String(s || "").toLowerCase();
      if (kurz.startsWith("fr")) return "fr";
      if (kurz.startsWith("de")) return "de";
    }
    return "de";
  }

  // Französische Typografie: schmales geschütztes Leerzeichen vor : ; ! ? » und nach «
  const fein = (s) => s.replace(/ ([:;!?»])/g, " $1").replace(/« /g, "« ");

  function fuelle(text, werte) {
    if (!werte) return text;
    return text.replace(/\{(\w+)\}/g, (ganz, k) => (k in werte ? String(werte[k]) : ganz));
  }

  function t(text, werte) {
    if (code === "fr" && typeof FR[text] === "string") return fuelle(fein(FR[text]), werte);
    return fuelle(text, werte);
  }

  // Ein- oder Mehrzahl. Deutsch: 1 = Einzahl. Französisch: 0 und 1 = Einzahl.
  function tn(n, einzahl, mehrzahl, werte) {
    const w = { n, ...werte };
    if (code === "fr" && Array.isArray(FR[mehrzahl])) return fuelle(fein(FR[mehrzahl][Math.abs(n) < 2 ? 0 : 1]), w);
    return fuelle(n === 1 ? einzahl : mehrzahl, w);
  }

  // Steckernamen: "Typ 2" heißt auf Französisch "Type 2"
  function stecker(name) {
    if (code !== "fr") return name;
    return String(name).replace(/^Typ (\w+) Kabel$/, "Type $1 (câble)").replace(/^Typ\b/, "Type");
  }

  // Texte aus den Stationsdaten, z. B. "Kreditkarte (Lesegerät, kontaktlos)"
  function daten(text) {
    if (code !== "fr" || !text) return text;
    if (typeof FR[text] === "string") return t(text);
    const m = /^(.+?) \((.+)\)$/.exec(text);
    if (m && typeof FR[m[1]] === "string") return `${t(m[1])} (${m[2].split(", ").map((x) => t(x)).join(", ")})`;
    return text;
  }

  // Öffnungszeiten wie "Mo–Fr 08:00–16:00" oder "Täglich ganztags"
  function zeiten(text) {
    if (code !== "fr" || !text) return text;
    if (typeof FR[text] === "string") return t(text);
    return text.replace(/(^|[\s,–-])(Mo|Di|Mi|Do|Fr|Sa|So)(?=$|[\s,–-])/g, (g, vor, tag) => vor + TAGE[tag])
      .replace(/Täglich/g, t("Täglich")).replace(/ganztags/g, t("ganztags"));
  }

  // "Oktober 2026" -> "octobre 2026"
  function monat(text) {
    if (code !== "fr" || !text) return text;
    return String(text).replace(/\b(Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\b/g, (m) => MONATE[m]);
  }

  const normal = (s) => String(s).replace(/\s+/g, " ").trim();

  // Festes HTML übersetzen (einmal beim Laden)
  function uebersetzeSeite(doc) {
    doc.documentElement.lang = code;
    if (code === "de") return;
    doc.title = t(normal(doc.title));
    for (const meta of doc.querySelectorAll('meta[name="description"], meta[name="apple-mobile-web-app-title"]')) {
      meta.content = t(normal(meta.content));
    }
    const manifest = doc.querySelector('link[rel="manifest"]');
    if (manifest) manifest.href = "manifest.fr.webmanifest";
    for (const el of doc.querySelectorAll("[data-t-html]")) {
      const key = normal(el.innerHTML);
      if (typeof FR[key] === "string") el.innerHTML = t(key);
    }
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => (node.parentElement.closest("script, style, [data-t-html]")
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    const knoten = [];
    while (walker.nextNode()) knoten.push(walker.currentNode);
    for (const node of knoten) {
      const roh = node.nodeValue, key = normal(roh);
      if (!key || typeof FR[key] !== "string") continue;
      const vorne = roh.match(/^\s*/)[0], hinten = roh.match(/\s*$/)[0];
      node.nodeValue = vorne + t(key) + hinten;
    }
    for (const attr of ["placeholder", "aria-label", "title", "alt"]) {
      for (const el of doc.body.querySelectorAll(`[${attr}]`)) {
        const key = normal(el.getAttribute(attr));
        if (key && typeof FR[key] === "string") el.setAttribute(attr, t(key));
      }
    }
  }

  // Knöpfe zum Umschalten: zeigen die jeweils andere Sprache
  function baueUmschalter(doc, speicher, ort) {
    const andere = code === "fr" ? "de" : "fr";
    for (const knopf of doc.querySelectorAll("[data-sprache-wechsel]")) {
      knopf.textContent = andere === "fr" ? "Français" : "Deutsch";
      knopf.lang = andere;
      knopf.setAttribute("aria-label", andere === "fr" ? "Auf Französisch umschalten" : t("Auf Deutsch umschalten"));
      knopf.addEventListener("click", () => {
        try { speicher?.setItem(SPEICHER, andere); } catch {}
        const url = new URL(ort.href);
        url.searchParams.delete("lang");
        if (url.href === ort.href) ort.reload();
        else ort.replace(url.href);
      });
    }
  }

  return {
    FR, SPRACHEN, SPEICHER, bestimme, t, tn, stecker, daten, zeiten, monat, uebersetzeSeite, baueUmschalter,
    setze(neu) { code = SPRACHEN.includes(neu) ? neu : "de"; },
    get code() { return code; },
    get locale() { return code === "fr" ? "fr-FR" : "de-DE"; },
  };
})();

if (typeof window !== "undefined" && typeof document !== "undefined") {
  let speicher = null, gespeichert = null;
  try { speicher = window.localStorage; gespeichert = speicher.getItem(Sprache.SPEICHER); } catch {}
  const sprachen = navigator.languages?.length ? navigator.languages : [navigator.language];
  Sprache.setze(Sprache.bestimme({ suche: location.search, gespeichert, sprachen }));
  // Eine Wahl über ?lang= merken, damit die App auch ohne den Zusatz so bleibt
  const ausAdresse = new URLSearchParams(location.search).get("lang");
  if (ausAdresse && Sprache.SPRACHEN.includes(ausAdresse.toLowerCase().slice(0, 2))) {
    try { speicher?.setItem(Sprache.SPEICHER, Sprache.code); } catch {}
  }
  window.t = Sprache.t;
  window.tn = Sprache.tn;
  const los = () => {
    Sprache.uebersetzeSeite(document);
    Sprache.baueUmschalter(document, speicher, location);
  };
  if (document.body) los(); else document.addEventListener("DOMContentLoaded", los);
}

if (typeof module !== "undefined") module.exports = Sprache;
