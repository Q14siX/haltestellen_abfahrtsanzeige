<p align="center">
  <img src="https://raw.githubusercontent.com/Q14siX/haltestellen_abfahrtsanzeige/main/custom_components/haltestellen_abfahrtsanzeige/brand/logo.png" alt="Haltestellen-Abfahrtsanzeige" width="580">
</p>

<h1 align="center">Haltestellen-Abfahrtsanzeige</h1>

<p align="center">
  <strong>Deine Busabfahrten. Dein Dashboard. Deine Ansicht.</strong><br>
  <em>Your bus departures. Your dashboard. Your way.</em>
</p>

<p align="center">
  <a href="#deutsch">Deutsch</a> · <a href="#english">English</a> · <a href="RELEASE.md">Release Notes</a>
</p>

---

<a id="deutsch"></a>
## 🇩🇪 Deutsch

### Busabfahrten direkt in Home Assistant

**Haltestellen-Abfahrtsanzeige** ist eine quelloffene Home-Assistant-Integration für die nächsten Bus- und Fernbusabfahrten. Sie nutzt die öffentliche [Transitous](https://transitous.org/)-Schnittstelle und kombiniert aktuelle Fahrplandaten mit einem individuell gestaltbaren Dashboard, Sensoren und Automationsauslösern.

Richte jede gewünschte Haltestelle einmal in Home Assistant ein und wähle anschließend **einen oder mehrere Haltestellen-Sensoren direkt im Karteneditor** aus. Die Abfahrten werden zu einer gemeinsamen, zeitlich geordneten Anzeige zusammengeführt. Eine gesonderte Haupt-Haltestelle oder feste Fahrtrichtung ist nicht erforderlich.

### Das bietet die Integration

| Bereich | Funktionen |
| --- | --- |
| **Abfahrtsinformationen** | Linie, Ziel, Soll- und Prognosezeit, Countdown, Verspätung, Ausfall, Steig und Verkehrsunternehmen – sofern vorhanden |
| **Vier Kartenansichten** | Abfahrtstabelle, Liste, digitaler Monitor und interaktive Karte |
| **Mehrere Haltestellen** | Gemeinsame Anzeige mehrerer Sensoren mit erkennbarer Einstiegshaltestelle |
| **Fahrtdetails** | Nachfolgende Halte, Ankunfts-/Abfahrtszeiten und optionale Streckenkarte |
| **Verkehrshinweise** | Fahrtausfälle, größere Verspätungen und Textmeldungen aus der Datenquelle |
| **Filter & Favoriten** | Linien- und Fahrtzielfilter, Schnellfilter und lokal gespeicherte Linienfavoriten |
| **Individuelle Darstellung** | Konfigurierbare Spalten, Beschriftungen, Sortierung, Farben, Vollbild- und Kioskmodus |
| **Feingranulare Sichtbarkeit** | Kopfbereich, Datenqualität, Schnellfilter, Fahrtdetails und Kartenelemente separat ein- oder ausblenden |
| **Automationen** | Auslöser für bevorstehende Abfahrten, Verspätungen und ausgefallene Fahrten |
| **Systemstatus** | API-Erreichbarkeit, Abrufdauer, Datenalter und Home-Assistant-Diagnoseexport |
| **Schonende Datenabfragen** | Dynamisches, datensparendes oder festes Aktualisierungsprofil mit Fehler-Backoff |
| **Zweisprachigkeit** | Deutsche und englische Oberfläche einschließlich Karteneditor und Einrichtungsdialogen |

Die Karte ist responsiv, unterstützt helle und dunkle Home-Assistant-Themes und berücksichtigt Tastaturbedienung, Screenreader-Beschriftungen sowie reduzierte Animationen.

### Voraussetzungen

- **Home Assistant 2026.9.0 oder neuer**.
- Internetzugriff der Home-Assistant-Instanz auf `https://api.transitous.org`.
- Für Kartendarstellungen: Zugriff auf den in Home Assistant verwendeten Kartendienst.
- Optional: [HACS](https://www.hacs.xyz/) zur Installation und Verwaltung.

Ein Benutzerkonto oder persönlicher API-Schlüssel für Transitous ist nicht erforderlich. Beachte die [Transitous-API-Nutzungsbedingungen](https://transitous.org/api/), insbesondere die Vorgaben für quelloffene, nichtkommerzielle und ressourcenschonende Nutzung.

### Installation

#### Über HACS

1. Öffne **HACS** in Home Assistant.
2. Wähle oben rechts **⋮ → Benutzerdefinierte Repositories**.
3. Füge die Adresse **dieses GitHub-Repositories** hinzu und wähle den Typ **Integration**.
4. Installiere **Haltestellen-Abfahrtsanzeige** über HACS.
5. **Starte Home Assistant neu.**

Die Integration kann als benutzerdefiniertes Repository genutzt werden; ein Eintrag im standardmäßigen HACS-Katalog ist dafür nicht notwendig.

#### Manuell

1. Lade das ZIP-Paket der GitHub-Veröffentlichung herunter und entpacke es.
2. Kopiere den vollständigen Ordner `custom_components/haltestellen_abfahrtsanzeige` in das Verzeichnis `custom_components` Deiner Home-Assistant-Konfiguration.
3. Starte Home Assistant neu.

Die Verzeichnisstruktur muss danach so aussehen:

```text
<config>/
└── custom_components/
    └── haltestellen_abfahrtsanzeige/
        ├── __init__.py
        ├── manifest.json
        ├── frontend/
        ├── translations/
        └── ...
```

### Haltestellen einrichten

1. Öffne **Einstellungen → Geräte & Dienste → Integration hinzufügen**.
2. Suche nach **Haltestellen-Abfahrtsanzeige**.
3. Gib den gewünschten Ort ein, zum Beispiel **Hamburg**.
4. Wähle eine angebotene Haltestelle und lege einen Namen fest.
5. Wiederhole die Einrichtung für weitere Haltestellen.

Pro eingerichteter Haltestelle erstellt Home Assistant einen eigenen Abfahrtssensor. Die konkrete Entitäts-ID findest Du unter **Entwicklerwerkzeuge → Zustände**.

### Dashboard-Karte verwenden

Die Integration liefert die Lovelace-Karte **`custom:haltestellen-abfahrtsanzeige`** samt grafischem Konfigurationseditor. Bei Dashboard-Ressourcen, die über die Home-Assistant-Oberfläche verwaltet werden, wird die Kartenressource automatisch eingerichtet.

**Empfohlen:** Füge die benutzerdefinierte Karte im Dashboard hinzu. Unter **Grundlagen → Haltestellen auswählen** kannst Du über **eine durchsuchbare Mehrfachauswahl** alle gewünschten Sensoren markieren. Ein einzelner Sensor funktioniert genauso wie mehrere.

Im Editor stehen sechs übersichtliche Einstellungsbereiche zur Verfügung:

| Bereich | Konfiguration |
| --- | --- |
| **Grundlagen** | Sensoren, Ansicht, Anzahl der Abfahrten, Darstellungsdichte, Kioskmodus |
| **Sichtbarkeit** | Kopfbereich, Uhr, Aktualisierungsstatus, Verkehrshinweise, Vollbild-Schaltfläche, Fußzeile |
| **Schnellfilter** | Gesamte Leiste oder einzelne Linien-, Ziel-, Favoriten- und Zurücksetzen-Elemente anzeigen bzw. ausblenden |
| **Spalten** | Sichtbare Angaben, Tabellenkopf, Sortierung, Spaltenbeschriftungen |
| **Fahrtverlauf** | Folgehalte, Detailansicht, Kartenfläche, Linien, Legende und Kartenbedienung |
| **Beschriftung** | Eigene Überschriften, Untertitel und Anzeige- bzw. Leertexte |

Die Optionen hängen von der gewählten Ansicht ab. Nicht benötigte untergeordnete Einstellungen werden automatisch ausgeblendet. Du kannst zum Beispiel die **gesamte Schnellfilter-Leiste deaktivieren**, ohne die zuvor gespeicherten Favoriten zu verlieren. Ausgeblendete Schnellfilter filtern die Anzeige nicht heimlich weiter.

#### Kartenansichten

| `view` | Darstellung |
| --- | --- |
| `table` | Abfahrtstabelle mit optionalem Tabellenkopf und Sortierung |
| `list` | Kartenartige, mobilfreundliche Abfahrtsliste |
| `monitor` | Großflächige digitale Abfahrtstafel für Displays |
| `map` | Fahrtverlauf und Folgehalte auf einer Karte |

#### YAML-Beispiel: Eine Haltestelle

```yaml
type: custom:haltestellen-abfahrtsanzeige
entities:
  - sensor.hamburg_hauptbahnhof
view: table
title: Abfahrten am Hauptbahnhof
max_rows: 15
show_disruptions: true
show_data_quality: true
show_quick_filters: false
```

#### YAML-Beispiel: Mehrere Haltestellen

```yaml
type: custom:haltestellen-abfahrtsanzeige
entities:
  - sensor.hamburg_hauptbahnhof
  - sensor.hamburg_rathaus
view: monitor
title: Meine Abfahrten
max_rows: 20
kiosk_mode: true
show_fullscreen_button: true
```

Diese Entitäts-IDs sind **Beispiele**. Verwende die IDs der tatsächlich in Deiner Installation angelegten Sensoren.

Favoriten werden **im jeweiligen Browser** gespeichert und nicht zwischen Geräten synchronisiert. Der Vollbildmodus wird über eine Schaltfläche gestartet und ist von den Berechtigungen des Browsers abhängig; der Kioskmodus optimiert die Kartenansicht, blendet aber nicht automatisch alle Home-Assistant- oder Browser-Menüs aus.

Für den Fahrtverlauf werden verfügbare Geometriedaten nachgeladen. Sind keine passenden Streckendaten vorhanden, kann eine **schematische, gestrichelte Verbindung** dargestellt werden. Diese ist keine exakte Straßenroute. Die notwendige OpenStreetMap-Attribution bleibt in Kartenansichten sichtbar.

#### Bei YAML-verwalteten Dashboard-Ressourcen

Wenn Home Assistant die Lovelace-Ressourcen nicht über die Oberfläche verwaltet, trage die Karte manuell ein:

```yaml
lovelace:
  resources:
    - url: /haltestellen_abfahrtsanzeige/haltestellen-abfahrtsanzeige.js
      type: module
```

### Sensoren, Diagnose und Automationen

Der Hauptsensor einer Haltestelle zeigt die **Minuten bis zur nächsten nicht ausgefallenen Abfahrt**. Zu seinen Attributen zählen unter anderem:

| Attribut | Bedeutung |
| --- | --- |
| `abfahrten` | Strukturierte Liste der kommenden Abfahrten |
| `haltestelle` | Name der Haltestelle |
| `naechste_linie`, `naechstes_ziel` | Linie und Ziel der nächsten Abfahrt |
| `naechste_abfahrt` | Zeitpunkt der nächsten Abfahrt |
| `zeitpunkt_abfrage`, `datenstatus` | Aktualität und Qualität der Daten |
| `verkehrshinweise`, `verkehrshinweise_anzahl` | Verfügbare Störungsinformationen |
| `next_departures` | Zusätzliches Datenformat für kompatible Abfahrtskarten |

Ergänzend werden Diagnoseentitäten für die Erreichbarkeit der API und die Dauer des letzten Datenabrufs bereitgestellt. Ein Diagnoseexport ist über die Home-Assistant-Integrationsverwaltung verfügbar.

Im grafischen Home-Assistant-Automationseditor stehen drei Auslöser bereit: **Abfahrt steht bevor**, **Verspätung erreicht** und **Fahrt fällt aus**. Optional lassen sie sich nach Linie und Fahrtziel einschränken. Eine Benachrichtigung oder andere Aktion wird erst ausgeführt, wenn Du sie in Deiner Automation selbst festlegst.

### Intelligente Aktualisierung

Das Abfrageprofil wird **pro Haltestelle** in den Optionen der Integration eingestellt:

| Zeit bis zur nächsten Abfahrt | Dynamisch (Standard) | Datensparend |
| --- | ---: | ---: |
| Bis 5 Minuten | 1 Minute | 2 Minuten |
| Mehr als 5 bis 15 Minuten | 2 Minuten | 4 Minuten |
| Mehr als 15 bis 45 Minuten | 4 Minuten | 6 Minuten |
| Später oder keine Abfahrt | 10 Minuten | 12 Minuten |

Alternativ steht **Fest: 5 Minuten** zur Auswahl. Bei API-Fehlern verlängert die Integration das Intervall, respektiert gegebenenfalls `Retry-After`-Vorgaben und nutzt bis zum nächsten erfolgreichen Abruf vorhandene Daten mit entsprechendem Aktualitätshinweis. Der Countdown wird zwischen API-Abfragen lokal aktualisiert. **Mehrere Sensoren in einer Karte verursachen keine zusätzlichen regelmäßigen Karten-Abfragen.**

### Datenqualität, Datenschutz und Grenzen

- Echtzeitangaben sind **Prognosen des Datenanbieters**, keine bestätigte Fahrzeugposition.
- Regionale Verfügbarkeit, Echtzeitdaten, Verkehrshinweise, Folgehalte und Streckengeometrien hängen von den jeweiligen Originaldatenquellen ab.
- Eine leere Störungsliste bedeutet **nicht**, dass der Verkehr garantiert störungsfrei ist.
- Haltestellenkennungen bzw. -koordinaten werden für die Fahrplanabfrage an Transitous übertragen. Die Kartenansicht kann Kartendaten von einem zusätzlichen Dienst laden.
- Die Benutzeroberfläche ist **Deutsch/Englisch**. Haltestellennamen und externe Meldungstexte können in der ursprünglichen Sprache erscheinen. Technische Attributnamen bleiben aus Kompatibilitätsgründen unverändert.
- Die Integration ist ein **unabhängiges Community-Projekt** und kein offizielles Produkt von Home Assistant, Transitous oder eines Verkehrsunternehmens.

### Fehlerbehebung

| Symptom | Prüfen |
| --- | --- |
| Integration fehlt | Verzeichnisstruktur und Home-Assistant-Neustart |
| Haltestelle wird nicht gefunden | Ortsbezeichnung, Transitous-Abdeckung und Internetverbindung |
| Karte lädt nicht | Dashboard-Ressource, JavaScript-Cache und Browser-Neuladen |
| Keine Abfahrten | Ausgewählte Haltestelle, Fahrtangebot, API-Status und Diagnoseentitäten |
| Meldungen oder Echtzeitdaten fehlen | Verfügbarkeit der Angaben in der jeweiligen regionalen Datenquelle |
| Keine Kartenlinie | Verfügbarkeit von Koordinaten bzw. Streckengeometrie |

Für Supportanfragen sind die Integrationsversion, eine kurze Fehlerbeschreibung und ein **vorher auf persönliche Angaben geprüfter** Diagnoseexport hilfreich.

### Datenquellen und Lizenz

Die Abfahrtsdaten stammen von [Transitous](https://transitous.org/) und den im [Quellenverzeichnis](https://transitous.org/sources/) genannten Datenbereitstellern. Es gelten die [Transitous-API-Regeln](https://transitous.org/api/) und die jeweiligen Lizenzen der ursprünglichen Datensätze. Kartendaten: © [OpenStreetMap-Mitwirkende](https://www.openstreetmap.org/copyright).

Der Quellcode dieser Integration steht unter der [MIT-Lizenz](LICENSE). Die Lizenz der Integration ersetzt keine Rechte oder Pflichten an externen Fahrplan- und Kartendaten.

---

<a id="english"></a>
## 🇬🇧 English

### Bus departures inside Home Assistant

**Haltestellen-Abfahrtsanzeige (Bus Stop Departure Board)** is an open-source Home Assistant integration for upcoming local and long-distance bus departures. It uses the public [Transitous](https://transitous.org/) API and brings timetable data together with a customizable dashboard, sensors, and automation triggers.

Configure each stop once in Home Assistant, then select **one or more stop sensors directly in the visual card editor**. Departures are combined into a single chronological board. No separate primary stop or fixed travel direction is required.

### Features

| Area | Capabilities |
| --- | --- |
| **Departures** | Route, destination, scheduled/predicted time, countdown, delay, cancellation, platform, and operator where available |
| **Four card views** | Departure table, list, digital monitor, and interactive map |
| **Multiple stops** | Combine several sensors in one board, clearly identifying the departure stop |
| **Trip details** | Following stops, arrival/departure times, and optional route map |
| **Service notices** | Cancellations, significant delays, and feed-provided text alerts |
| **Filters & favorites** | Route/destination filters, on-card quick filters, and locally saved favorite routes |
| **Personalized display** | Configurable columns, labels, sorting, colors, fullscreen and kiosk modes |
| **Granular visibility** | Independently show or hide headers, data quality, quick filters, trip details, and map elements |
| **Automations** | Triggers for approaching departures, delays, and cancelled services |
| **Diagnostics** | API connectivity, request duration, data age, and Home Assistant diagnostics export |
| **Efficient polling** | Adaptive, economy, or fixed refresh profiles with error backoff |
| **Two languages** | German and English UI, including setup dialogs and card editor |

The card is responsive, supports light and dark Home Assistant themes, and includes keyboard focus indicators, screenreader labels, and reduced-motion handling.

### Requirements

- **Home Assistant 2026.9.0 or later**.
- Network access from Home Assistant to `https://api.transitous.org`.
- For maps: access to the tile service used by Home Assistant.
- Optional: [HACS](https://www.hacs.xyz/) for installation and management.

No personal Transitous account or API key is required. Follow the [Transitous API usage policy](https://transitous.org/api/), including its open-source, noncommercial, and resource-conscious conditions.

### Installation

#### HACS

1. Open **HACS** in Home Assistant.
2. Select **⋮ → Custom repositories** in the top-right menu.
3. Add the URL of **this GitHub repository** and select **Integration** as the type.
4. Install **Haltestellen-Abfahrtsanzeige** from HACS.
5. **Restart Home Assistant.**

The project can be installed as a custom repository; inclusion in the default HACS catalog is not required.

#### Manual installation

1. Download and extract the GitHub release ZIP.
2. Copy the complete `custom_components/haltestellen_abfahrtsanzeige` folder into the `custom_components` directory of your Home Assistant configuration.
3. Restart Home Assistant.

The installed structure should look like this:

```text
<config>/
└── custom_components/
    └── haltestellen_abfahrtsanzeige/
        ├── __init__.py
        ├── manifest.json
        ├── frontend/
        ├── translations/
        └── ...
```

### Configure stops

1. Open **Settings → Devices & services → Add integration**.
2. Search for **Haltestellen-Abfahrtsanzeige**.
3. Enter a city, for example **Hamburg**.
4. Select a stop returned by the provider and enter a name.
5. Repeat to configure more stops.

Home Assistant creates a separate departure sensor for each configured stop. Find the actual entity ID in **Developer tools → States**.

### Add the dashboard card

The integration ships with the **`custom:haltestellen-abfahrtsanzeige`** Lovelace card and a visual editor. The JavaScript resource is automatically registered when dashboard resources are managed through the Home Assistant interface.

**Recommended:** Add the custom card to a dashboard, then go to **Basics → Select stops**. Use the **single searchable multi-select** to select as many sensors as needed. A single-sensor card works the same way.

The visual editor organizes its options into six sections:

| Section | Settings |
| --- | --- |
| **Basics** | Sensors, view, departure count, density, kiosk mode |
| **Visibility** | Header, clock, updated timestamp, service notices, fullscreen button, footer |
| **Quick filters** | Show or hide the whole bar, or individual route, destination, favorites and reset controls |
| **Columns** | Visible fields, table header, sorting, column labels |
| **Trip details** | Following stops, detail panel, map canvas, route lines, legend, map controls |
| **Labels** | Custom titles, subtitles, and empty-state text |

Options are context-sensitive: irrelevant subordinate settings stay hidden. For example, you can **disable the entire quick-filter bar** while retaining saved favorites. Hidden quick filters do not keep filtering departures in the background.

#### Card views

| `view` | Description |
| --- | --- |
| `table` | Departure table with optional header and sorting |
| `list` | Mobile-friendly departure list |
| `monitor` | Large digital departure board for wall-mounted displays |
| `map` | Interactive trip and following-stops map |

#### YAML example: Single stop

```yaml
type: custom:haltestellen-abfahrtsanzeige
entities:
  - sensor.hamburg_hauptbahnhof
view: table
title: Central Station departures
max_rows: 15
show_disruptions: true
show_data_quality: true
show_quick_filters: false
```

#### YAML example: Multiple stops

```yaml
type: custom:haltestellen-abfahrtsanzeige
entities:
  - sensor.hamburg_hauptbahnhof
  - sensor.hamburg_rathaus
view: monitor
title: My departures
max_rows: 20
kiosk_mode: true
show_fullscreen_button: true
```

These entity IDs are **illustrative only**. Replace them with the actual IDs in your installation.

Favorites are saved **locally in each browser** and do not sync between devices. Fullscreen is activated by a button and depends on browser permissions. Kiosk mode optimizes the card layout but does not automatically remove Home Assistant or browser navigation.

Trip geometries are fetched when needed. If detailed route geometry is unavailable, a **dashed schematic connection** may be shown; this is not an actual street route. Required OpenStreetMap attribution remains visible in map views.

#### YAML-managed dashboard resources

If your Lovelace resources are not managed through the Home Assistant interface, add the resource yourself:

```yaml
lovelace:
  resources:
    - url: /haltestellen_abfahrtsanzeige/haltestellen-abfahrtsanzeige.js
      type: module
```

### Sensors, diagnostics, and automations

Each stop's main sensor reports the **number of minutes until the next non-cancelled departure**. Its attributes include:

| Attribute | Meaning |
| --- | --- |
| `abfahrten` | Structured list of upcoming departures |
| `haltestelle` | Stop name |
| `naechste_linie`, `naechstes_ziel` | Route and destination of the next departure |
| `naechste_abfahrt` | Time of the next departure |
| `zeitpunkt_abfrage`, `datenstatus` | Data freshness and quality |
| `verkehrshinweise`, `verkehrshinweise_anzahl` | Available service notices |
| `next_departures` | Alternative data structure for compatible departure cards |

Additional diagnostic entities report API availability and the last request duration. A diagnostics export is available from the Home Assistant integration management interface.

Three triggers are available in the visual Home Assistant automation editor: **Departure soon**, **Delay reached**, and **Trip cancelled**. Optional route and destination filters can narrow them down. Notifications or other actions only occur if you explicitly configure them in an automation.

### Smart refresh

Choose a polling profile **per stop** in the integration options:

| Time to next departure | Adaptive (default) | Economy |
| --- | ---: | ---: |
| Up to 5 minutes | 1 minute | 2 minutes |
| More than 5 to 15 minutes | 2 minutes | 4 minutes |
| More than 15 to 45 minutes | 4 minutes | 6 minutes |
| Later or no departures | 10 minutes | 12 minutes |

A **fixed 5-minute** profile is also available. API failures increase the retry interval, and the integration honors applicable server `Retry-After` values. Previously received data may remain visible with a freshness warning. Countdown values update locally between API calls. **Combining stops in a card does not generate extra recurring requests by the card.**

### Data quality, privacy, and limitations

- Realtime values are **provider predictions**, not verified vehicle positions.
- Coverage, live updates, service notices, following stops, and route geometry depend on the original regional data feeds.
- An empty service-notice list **does not guarantee** disruption-free operations.
- Stop identifiers and/or coordinates are sent to Transitous for timetable queries. Map views may load tiles from a separate provider.
- The UI supports **German and English**. Stop names and upstream notices may remain in their source language. Technical attribute names are intentionally stable for automation compatibility.
- This is an **independent community project**, not an official Home Assistant, Transitous, or transport operator product.

### Troubleshooting

| Problem | Check |
| --- | --- |
| Integration missing | Directory structure and Home Assistant restart |
| Stop not found | City spelling, Transitous coverage, network connectivity |
| Card not loading | Dashboard resource, browser cache, hard refresh |
| No departures | Stop selection, service schedule, API diagnostics |
| Realtime data or alerts missing | Availability of these fields in the regional source feed |
| Route geometry missing | Coordinates and trip shape availability |

For support, provide the integration version, steps to reproduce, and a diagnostics export **reviewed for private information**.

### Sources and license

Timetable data is supplied by [Transitous](https://transitous.org/) and the operators listed in its [source directory](https://transitous.org/sources/). The [Transitous API policy](https://transitous.org/api/) and the original datasets' licensing conditions apply. Map data: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright).

This integration's source code is licensed under the [MIT License](LICENSE). External timetable and map content retains its own attribution and licensing requirements.