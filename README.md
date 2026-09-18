# 8a Projekt

Das Grundgerüst für den digitalen Klassenraum der Klasse 8a an der Realschule Zusmarshausen. Ein eigenständiges Klassenprojekt, keine offizielle Schulwebsite.

## Lokal starten

Voraussetzung: **Node.js 24 oder neuer** und npm.

```sh
npm install
npm run dev
```

Die Website läuft unter **http://localhost:5173**. Der Node-Server läuft auf Port 3001. Vite leitet Anfragen an `/api` automatisch weiter.

## Enthalten

- Responsive Startseite mit eigener Illustration und lokal eingebundenen Schriftarten.
- Links einklappbare Sidebar; auf dem Handy ein ausfahrbares Menü mit Escape-Taste, Fokusführung und Hintergrundsperre.
- Projektseite, Info-Dialoge sowie helles und dunkles Design. Design und Desktop-Menüzustand werden im Browser gespeichert.
- SQLite-Datenbank mit versioniertem Schema, Schulangaben und vorbereiteten Modulen.
- Express-API mit Lade-, Fehler- und Wiederholungszuständen in der Oberfläche.

Stundenplan, Aufgaben und Termine sind **als geplant gekennzeichnet**. Die eigentlichen Schulalltagsfunktionen, Konten und die Erfassung persönlicher Schülerdaten sind noch nicht implementiert.

## Datenbank und API

Beim ersten Serverstart wird `data/8a.sqlite` automatisch angelegt und einmalig mit den Projektinformationen befüllt. Änderungen bleiben über Neustarts erhalten. Es ist kein separater Datenbankdienst erforderlich. Verwendet wird das in Node.js integrierte `node:sqlite`; Node 24 kann dafür eine ExperimentalWarning ausgeben.

| Endpunkt | Inhalt |
| --- | --- |
| `GET /api/site` | Projektname, Schule, Klasse, Begrüßungstext und geplante Module aus SQLite |
| `GET /api/health` | Server- und Datenbankprüfung |

`server/database.js` enthält Schema und erste Migration; `server/app.js` die Routen. Weitere Funktionen können durch neue Migrationen, API-Routen und Seiten ergänzt werden. Die API ist zunächst nur lesend; es gibt keine öffentliche Schreibschnittstelle.

Die optionalen Einstellungen stehen in `.env.example`. Für eigene Werte eine `.env` anlegen. `DATABASE_PATH` wird relativ zum Projektverzeichnis ausgewertet. `PORT` wird auch vom Vite-Proxy berücksichtigt. Der API-Server bindet standardmäßig nur an `127.0.0.1`.

Die Datenbank und `.env` gehören nicht ins Repository. Für ein konsistentes Backup den Server beenden und `data/8a.sqlite` sichern; keine laufende WAL-Datenbank nur durch Kopieren der Hauptdatei sichern.

## Build und Betrieb

```sh
npm run build
npm start
```

Danach liefert derselbe Server Website und API unter **http://localhost:3001** aus. Für einen späteren öffentlichen Betrieb sind eine passende Domain, HTTPS und bei personenbezogenen Funktionen eine Zugriffsverwaltung gesondert einzurichten.

## Prüfen

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Die Servertests prüfen API, Datenbankzugriff und Persistenz über einen Neustart. Die Browsertests prüfen Desktop und Handy, Navigation, Dialoge, gespeicherte Einstellungen, Fehlerbehandlung und horizontales Überlaufen. Sie starten einen separaten Server auf Port 4173 mit einer eigenen Datenbank im Arbeitsspeicher. Screenshots liegen anschließend unter `test-results/`.

Technische Referenzen: [Vite](https://vite.dev/guide/) und [Node.js SQLite](https://nodejs.org/api/sqlite.html).
# 8aProjekt
