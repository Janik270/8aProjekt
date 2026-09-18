# 8a Tools

Der kreative Werkzeugkasten der Klasse 8a an der Realschule Zusmarshausen. Die Anwendung bündelt ein Whiteboard und einen gemeinsamen Texteditor in einem einheitlichen, responsiven Design. Sie ist ein Klassenprojekt und keine offizielle Schulwebsite.

## Werkzeuge

- **Excalidraw:** Endloses Whiteboard mit Formen, Freihandzeichnen, Bildern, Bibliotheken, Dunkelmodus und Export.
- **Group Writer:** Formatierter Texteditor mit Überschriften, Listen, Rückgängig/Wiederholen und HTML-Export.
- **Teilen:** Jeder Arbeitsbereich besitzt getrennte Links zum Ansehen und Bearbeiten. Links können kopiert oder als QR-Code heruntergeladen werden.
- **Gemeinsam arbeiten:** Änderungen werden automatisch gespeichert und auf anderen geöffneten Geräten regelmäßig synchronisiert.
- **Zuletzt geöffnet:** Eigene Bearbeitungslinks bleiben lokal im Browser griffbereit.

Das Whiteboard verwendet die freie React-Komponente von [Excalidraw](https://github.com/excalidraw/excalidraw). Der gemeinsame Editor orientiert sich am freien [GroupWriter](https://github.com/kitsteam/groupwriter) und verwendet wie dieses Projekt [TipTap](https://tiptap.dev/).

## Lokal starten

Voraussetzung: **Node.js 24 oder neuer** und npm.

```sh
npm install
npm run dev
```

Die Website läuft unter `http://localhost:5173`. Der Node-Server läuft standardmäßig auf Port 3001; Vite leitet `/api` automatisch dorthin weiter.

## Datenbank und Freigaben

Beim ersten Start wird `data/8a.sqlite` angelegt. Whiteboards und Dokumente werden mit zufälligen IDs gespeichert. Der Bearbeitungsschlüssel steht ausschließlich im Hash des Freigabelinks und wird in der Datenbank nur als SHA-256-Hash abgelegt. Ein Link ohne Schlüssel erlaubt nur das Ansehen.

| Endpunkt | Funktion |
| --- | --- |
| `GET /api/site` | Projekt- und Schulangaben |
| `POST /api/workspaces` | Whiteboard oder Dokument erstellen |
| `GET /api/workspaces/:id` | Geteilten Inhalt abrufen |
| `PUT /api/workspaces/:id` | Inhalt mit Bearbeitungsschlüssel speichern |
| `GET /api/health` | Server- und Datenbankprüfung |

Die Konfiguration ist in `.env.example` dokumentiert. Für einen öffentlichen Betrieb werden HTTPS, Backups und abhängig vom Einsatz eine zusätzliche Zugriffsverwaltung empfohlen.

## Build und Tests

```sh
npm run build
npm test
npx playwright install chromium
npm run test:e2e
```

Die API-Tests prüfen Erstellung, Persistenz und Schreibschutz. Die Browser-Tests decken Dashboard, beide Werkzeuge, QR-Freigabe, Theme, Sidebar sowie Desktop- und Mobilansicht ab.
# 8aProjekt
