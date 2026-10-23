<p align="center">
  <img src="https://raw.githubusercontent.com/Q14siX/haltestellen_abfahrtsanzeige/main/custom_components/haltestellen_abfahrtsanzeige/brand/icon.png" alt="Haltestellen-Abfahrtsanzeige" width="112">
</p>

# Haltestellen-Abfahrtsanzeige — First Public Release

**Version `20261023.114618` · 23 October 2026 · Home Assistant 2026.9.0+**

[Deutsch](#deutsch) · [English](#english) · [Documentation / Dokumentation](README.md)

---

<a id="deutsch"></a>
## 🇩🇪 Deutsch

### Erstveröffentlichung

**Haltestellen-Abfahrtsanzeige** bringt Bus- und Fernbusabfahrten auf Dein Home-Assistant-Dashboard. Die Integration verwendet Fahrplandaten der öffentlichen **Transitous/MOTIS-API** und verbindet Haltestellensensoren mit einer frei konfigurierbaren Lovelace-Karte, Diagnosedaten und nativen Automationsauslösern.

### Funktionsumfang dieser Veröffentlichung

- **Haltestellenverwaltung:** Ortsbasierte Suche, eigene Sensoren je Haltestelle und gemeinsame Darstellung beliebig vieler eingerichteter Haltestellen über eine durchsuchbare Mehrfachauswahl.
- **Vier Dashboard-Ansichten:** Tabelle, Liste, digitaler Abfahrtsmonitor und interaktive Fahrtverlaufskarte.
- **Abfahrts- und Fahrtinformationen:** Linien, Ziele, Sollzeiten, Prognosen, Countdown, Verspätungen, Ausfälle sowie verfügbare Folgehalte, Steige und Verkehrsunternehmen.
- **Störungen und Datenqualität:** Anzeige größerer Verspätungen, Ausfälle und bereitgestellter Verkehrshinweise einschließlich Kennzeichnung veralteter Daten.
- **Flexibler Karteneditor:** Klar gegliederte Einstellungen, abhängige Anzeigeoptionen, individuelle Spalten und Beschriftungen sowie umfassendes Ein- und Ausblenden einzelner Oberflächenelemente.
- **Schnellfilter und Favoriten:** Direkte Filterung nach Linie und Ziel, browserlokale Linienfavoriten und vollständig deaktivierbare Schnellfilter-Leiste.
- **Präsentationsmodi:** Helle und dunkle Themes, responsive Darstellung, Vollbild und Kiosk-Anzeige für Tablets oder Wanddisplays.
- **Automationen:** Native Auslöser für bevorstehende Abfahrten, Verspätungsschwellen und ausgefallene Fahrten.
- **Intelligente Abfragen:** Dynamisches, datensparendes oder festes Aktualisierungsprofil, Fehler-Backoff und Beachtung serverseitiger Wartezeiten.
- **Diagnose und Zugänglichkeit:** API-Status, Abrufdauer, Diagnoseexport, Tastatur- und Screenreader-Unterstützung sowie deutsche und englische Benutzeroberfläche.

### Installation

**HACS:** Repository als benutzerdefiniertes Repository vom Typ **Integration** hinzufügen, Integration installieren und Home Assistant neu starten.

**Manuell:** Den Ordner `custom_components/haltestellen_abfahrtsanzeige` vollständig in die Home-Assistant-Konfiguration kopieren und Home Assistant neu starten.

Anschließend unter **Einstellungen → Geräte & Dienste** mindestens eine Haltestelle konfigurieren und die Karte `custom:haltestellen-abfahrtsanzeige` zum Dashboard hinzufügen. Die vollständige Anleitung und YAML-Beispiele stehen in der [README.md](README.md).

### Voraussetzungen und Hinweise

- **Home Assistant 2026.9.0 oder neuer** und Zugriff auf `https://api.transitous.org`.
- Für Transitous gelten die [API-Nutzungsbedingungen](https://transitous.org/api/) einschließlich der Vorgaben für quelloffene und nichtkommerzielle Nutzung.
- Echtzeitprognosen, Störungsmeldungen und Streckengeometrien hängen von der jeweiligen Datenquelle ab; ihre Verfügbarkeit kann regional unterschiedlich sein.
- © [OpenStreetMap-Mitwirkende](https://www.openstreetmap.org/copyright). Die Originaldatenquellen und deren Lizenzhinweise sind im [Transitous-Quellenverzeichnis](https://transitous.org/sources/) aufgeführt.
- Der Integrationscode steht unter der [MIT-Lizenz](LICENSE); die Rechte an externen Daten bleiben davon unberührt.

---

<a id="english"></a>
## 🇬🇧 English

### Initial public release

**Haltestellen-Abfahrtsanzeige (Bus Stop Departure Board)** brings local and long-distance bus departures to your Home Assistant dashboard. The integration uses the public **Transitous/MOTIS API** to combine stop sensors, a configurable Lovelace card, diagnostics, and native automation triggers.

### Included in this release

- **Stop management:** City-based search, one sensor per configured stop, and combined departure boards with a searchable multi-select for any number of configured stops.
- **Four dashboard views:** Table, list, digital departure monitor, and interactive trip map.
- **Departure and trip details:** Routes, destinations, scheduled and predicted times, countdown, delays, cancellations, and available following stops, platforms, and operators.
- **Service alerts and data quality:** Significant delays, cancelled departures, available operator notices, and warnings about stale data.
- **Flexible card editor:** Clearly grouped settings, context-aware options, customizable columns and labels, and granular show/hide controls for individual UI elements.
- **Quick filters and favorites:** On-card route and destination filtering, browser-local favorite routes, and a fully optional quick-filter bar.
- **Display modes:** Light and dark themes, responsive layout, fullscreen, and kiosk presentation for tablets and wall displays.
- **Automations:** Native triggers for approaching departures, delay thresholds, and trip cancellations.
- **Smart polling:** Adaptive, economy, or fixed refresh intervals, error backoff, and server-specified retry delays.
- **Diagnostics and accessibility:** API health, request duration, diagnostics export, keyboard and screenreader support, plus a German/English interface.

### Installation

**HACS:** Add the repository as a custom repository of type **Integration**, install it, and restart Home Assistant.

**Manual:** Copy the entire `custom_components/haltestellen_abfahrtsanzeige` folder into your Home Assistant configuration and restart Home Assistant.

Next, configure at least one stop under **Settings → Devices & services** and add the `custom:haltestellen-abfahrtsanzeige` card to a dashboard. Complete setup instructions and YAML examples are available in [README.md](README.md).

### Requirements and important notes

- **Home Assistant 2026.9.0 or later** and access to `https://api.transitous.org`.
- The [Transitous API policy](https://transitous.org/api/) applies, including its open-source and noncommercial usage conditions.
- Realtime predictions, service alerts, and route geometries depend on upstream data feeds; regional availability varies.
- © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright). Original data sources and licenses are listed in the [Transitous source directory](https://transitous.org/sources/).
- The integration code is distributed under the [MIT License](LICENSE); external data retains its own licensing requirements.
