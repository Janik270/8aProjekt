# 8a Tools

Der kreative Werkzeugkasten der Klasse 8a an der Realschule Zusmarshausen. Die Anwendung bündelt ein Whiteboard, einen gemeinsamen Texteditor und ein Ampel-Tool in einem einheitlichen, responsiven Design. Sie ist ein Klassenprojekt und keine offizielle Schulwebsite.

## Werkzeuge

- **Excalidraw:** Endloses Whiteboard mit Formen, Freihandzeichnen, Bildern, Bibliotheken, Dunkelmodus und Export.
- **Group Writer:** Formatierter Texteditor mit Überschriften, Listen, Rückgängig/Wiederholen und HTML-Export.
- **Ampel-Tool:** Eine Lehrkraft erstellt eine Klasse mit QR-Code und sieht die roten, gelben oder grünen Rückmeldungen aller beigetretenen Schülerinnen und Schüler live. Der Beitrittslink zeigt ausschließlich die reduzierte Namens- und Farbauswahl ohne die restliche Werkzeug-Navigation.
- **Teilen:** Jeder Arbeitsbereich besitzt getrennte Links zum Ansehen und Bearbeiten. Links können kopiert oder als QR-Code heruntergeladen werden.
- **Gemeinsam arbeiten:** WebSockets übertragen Änderungen direkt während des Schreibens und Zeichnens. Yjs führt gleichzeitige Änderungen zusammen; der gemeinsame Stand bleibt in SQLite gespeichert.
- **Namen und Cursor:** Über „Dein Name“ lässt sich der eigene Anzeigename ändern. Andere im selben Projekt sehen den Namen in der Teilnehmerliste, Schreibcursor im Dokument sowie Mauszeiger und Auswahl auf dem Whiteboard.
- **Verbindungsstatus:** Die Oberfläche zeigt Live-Verbindung, Speichern und Verbindungsabbrüche an. Bei kurzen Unterbrechungen bleiben Änderungen im geöffneten Tab erhalten und werden nach dem Wiederverbinden zusammengeführt.
- **Konten und geräteübergreifende Projekte:** Unten in der Sidebar lassen sich Konten erstellen und öffnen. Eigene Projekte werden automatisch dem Konto zugeordnet; freigegebene Projekte können ausdrücklich als Lese- oder Bearbeitungsprojekt gespeichert und danach auf anderen Geräten geöffnet werden.
- **Private Projektlisten:** Das reine Öffnen eines Freigabelinks trägt ein Projekt nicht in „Zuletzt geöffnet“ oder in das Konto des Empfängers ein.
- **Zuletzt geöffnet:** Eigene Bearbeitungslinks bleiben lokal im Browser griffbereit.

Das Whiteboard verwendet die freie React-Komponente von [Excalidraw](https://github.com/excalidraw/excalidraw). Der gemeinsame Editor orientiert sich am freien [GroupWriter](https://github.com/kitsteam/groupwriter) und verwendet wie dieses Projekt [TipTap](https://tiptap.dev/).

## Lokal starten

Voraussetzung: **Node.js 24 oder neuer** und npm.

```sh
npm install
npm run dev
```

Die Website läuft unter `http://localhost:5173`. Der Node-Server läuft standardmäßig auf Port 3001; Vite leitet `/api` automatisch dorthin weiter.

Beim Betrieb hinter einem Reverse Proxy muss dieser WebSocket-Upgrades für `/api/workspaces/:id/live` weiterleiten. Nach einem Update den Node-Server neu starten und geöffnete Browser-Tabs neu laden. Vorhandene Projekte werden beim ersten Öffnen automatisch in das gemeinsame Datenformat übernommen.

## Datenbank und Freigaben

Beim ersten Start wird `data/8a.sqlite` angelegt. Whiteboards und Dokumente werden mit zufälligen IDs gespeichert. Der Bearbeitungsschlüssel steht ausschließlich im Hash des Freigabelinks und wird in der Datenbank nur als SHA-256-Hash abgelegt. Ein Link ohne Schlüssel erlaubt nur das Ansehen.

| Endpunkt | Funktion |
| --- | --- |
| `GET /api/site` | Projekt- und Schulangaben |
| `POST /api/workspaces` | Whiteboard oder Dokument erstellen |
| `GET /api/workspaces/:id` | Geteilten Inhalt abrufen |
| `PUT /api/workspaces/:id` | Inhalt mit Bearbeitungsschlüssel speichern |
| `WS /api/workspaces/:id/live` | Live-Inhalt, Namen, Cursor und Speicherbestätigungen |
| `POST /api/auth/register` | Konto erstellen und anmelden |
| `POST /api/auth/login` / `logout` | Sitzung beginnen oder beenden |
| `GET /api/account` | Konto und gespeicherte Projekte laden |
| `POST/DELETE /api/account/projects/:id` | Freigegebenes Projekt speichern oder aus dem Konto entfernen |
| `POST /api/traffic-rooms` | Ampel-Klasse mit Lehrerschlüssel erstellen |
| `GET /api/traffic-rooms/:id/status` | Geschützte Live-Übersicht der Lehrkraft laden |
| `POST /api/traffic-rooms/:id/students` | Mit einem Namen als Schüler beitreten |
| `PUT /api/traffic-rooms/:id/students/:studentId` | Eigene Ampelfarbe mit dem persönlichen Schlüssel ändern |
| `GET /api/health` | Server- und Datenbankprüfung |

Passwörter werden mit `scrypt` und individuellem Salt gespeichert. Die Anmeldung verwendet einen zufälligen, nur als Hash gespeicherten Sitzungsschlüssel in einem `HttpOnly`-Cookie. Eine Kontolöschung oder Passwort-Zurücksetzung ist derzeit nicht Teil der Oberfläche; dafür müsste vor einem öffentlichen Einsatz zusätzlich ein verlässlicher Wiederherstellungsweg eingerichtet werden.

Die Konfiguration ist in `.env.example` dokumentiert. Für einen öffentlichen Betrieb werden HTTPS, Backups und abhängig vom Einsatz eine zusätzliche Zugriffsverwaltung empfohlen.

## Build und Tests

```sh
npm run build
npm test
npx playwright install chromium
npm run test:e2e
```

Die API-Tests prüfen Erstellung, Persistenz, gleichzeitige Änderungen, Teilnehmerwechsel, Ampel-Klassen und den serverseitigen Schreibschutz. Die Browser-Tests decken Dashboard, alle Werkzeuge, QR-Freigabe, Ampel-Liveanzeige, die isolierte Schüleransicht, Theme, Sidebar, Namen, Cursor, Wiederverbinden sowie Desktop- und Mobilansicht ab.
# 8aProjekt
# 8aProjekt
# 8aProjekt
