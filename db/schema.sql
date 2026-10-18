-- Datenbank der Ladekarte (Neon, PostgreSQL). Lässt sich mehrfach ausführen.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS betreiber (id serial PRIMARY KEY, name text UNIQUE NOT NULL, standorte int, link text);

CREATE TABLE IF NOT EXISTS stationen (
  id text PRIMARY KEY, lat double precision NOT NULL, lon double precision NOT NULL,
  geom geography(Point,4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lon,lat),4326)::geography) STORED,
  strasse text, plz text, ort text, kreis text, bezeichnung text,
  kw_max numeric, dc boolean, ladepunkte int, betreiber text[] NOT NULL DEFAULT '{}', daten jsonb);
CREATE INDEX IF NOT EXISTS stationen_geom_idx ON stationen USING gist (geom);

CREATE TABLE IF NOT EXISTS zahlungswege (
  id serial PRIMARY KEY, name text UNIQUE NOT NULL,
  typ text NOT NULL CHECK (typ IN ('adhoc','karte','abo','roaming')), grundgebuehr_monat numeric);

CREATE TABLE IF NOT EXISTS tarife (
  id serial PRIMARY KEY, betreiber_id int NOT NULL REFERENCES betreiber(id),
  zahlungsweg_id int REFERENCES zahlungswege(id), bezeichnung text,
  preis_ac_text text, preis_dc_text text, preis_ac_ct numeric, preis_dc_ct numeric,
  hinweis text, quelle_link text,
  sicherheit text NOT NULL CHECK (sicherheit IN ('gefunden','teilweise / unsicher','nicht gefunden')),
  recherchiert text, bestaetigt boolean NOT NULL DEFAULT false);
CREATE INDEX IF NOT EXISTS tarife_betreiber_idx ON tarife(betreiber_id);

CREATE TABLE IF NOT EXISTS station_preise (
  station_id text PRIMARY KEY REFERENCES stationen(id) ON DELETE CASCADE,
  preis_text text, hinweis text, link text, sicherheit text, recherchiert text);

CREATE TABLE IF NOT EXISTS nutzer (
  id serial PRIMARY KEY, name text NOT NULL,
  token text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(16),'hex'));
CREATE TABLE IF NOT EXISTS nutzer_karten (
  nutzer_id int REFERENCES nutzer(id) ON DELETE CASCADE, zahlungsweg_id int REFERENCES zahlungswege(id),
  PRIMARY KEY (nutzer_id, zahlungsweg_id));
CREATE TABLE IF NOT EXISTS nutzer_ausschluss (
  nutzer_id int REFERENCES nutzer(id) ON DELETE CASCADE, betreiber_id int REFERENCES betreiber(id),
  PRIMARY KEY (nutzer_id, betreiber_id));
