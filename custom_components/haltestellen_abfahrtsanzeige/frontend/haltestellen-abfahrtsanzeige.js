// Home Assistant 2026.9+ provides a policy-compliant, cached map-tile proxy.
// Its short-lived access token is requested through the authenticated WebSocket.
const MAP_TILE_TOKEN_MAX_AGE = 20 * 60 * 1000;
const LOCAL_MAP_TILES_AUTH = {token: null, loaded: 0, pending: null};
async function localMapTilesToken(hass, force=false) {
  if (!hass || typeof hass.callWS !== "function") return null;
  if (!force && LOCAL_MAP_TILES_AUTH.token &&
      Date.now() - LOCAL_MAP_TILES_AUTH.loaded < MAP_TILE_TOKEN_MAX_AGE) {
    return LOCAL_MAP_TILES_AUTH.token;
  }
  if (LOCAL_MAP_TILES_AUTH.pending) return LOCAL_MAP_TILES_AUTH.pending;
  LOCAL_MAP_TILES_AUTH.pending = Promise.resolve()
    .then(() => hass.callWS({type: "map_tiles/access_token"}))
    .then(reply => {
      const token = typeof reply?.token === "string" ? reply.token : null;
      if (token && /^[a-f0-9]{64}$/i.test(token)) {
        LOCAL_MAP_TILES_AUTH.token = token;
        LOCAL_MAP_TILES_AUTH.loaded = Date.now();
        return token;
      }
      return null;
    })
    .catch(() => null)
    .finally(() => { LOCAL_MAP_TILES_AUTH.pending = null; });
  return LOCAL_MAP_TILES_AUTH.pending;
}
/* Haltestellen-Abfahrtsanzeige · Home Assistant custom dashboard card */
// Trip shapes are requested only when a route map is opened. Coalesce duplicate
// cards and cache the decoded geometry instead of hitting Transitous each tick.
const TRIP_SHAPE_CACHE = new Map();
async function tripGeometryFor(hass, tripId) {
  if (!tripId || typeof hass?.callApi !== "function") return [];
  const key=String(tripId);
  const cached=TRIP_SHAPE_CACHE.get(key);
  if(cached && cached.until>Date.now())return cached.result;
  const pending=Promise.resolve()
    .then(()=>hass.callApi("GET",`haltestellen_abfahrtsanzeige/route?trip_id=${encodeURIComponent(key)}`))
    .then(response=>{
      const coords=Array.isArray(response?.geometry)?response.geometry:[];
      const valid=coords.length>=2 && coords.length<=800 && coords.every(p=>
        Array.isArray(p) && p.length===2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) &&
        p[0]>=-85.0511 && p[0]<=85.0511 && p[1]>=-180 && p[1]<=180);
      return valid?coords.map(p=>({lat:p[0],lon:p[1]})):[];
    }).catch(()=>[]);
  TRIP_SHAPE_CACHE.set(key,{until:Date.now()+2*60000,result:pending});
  const result=await pending;
  TRIP_SHAPE_CACHE.set(key,{until:Date.now()+(result.length?20:2)*60000,result});
  if(TRIP_SHAPE_CACHE.size>80)TRIP_SHAPE_CACHE.delete(TRIP_SHAPE_CACHE.keys().next().value);
  return result;
}
const BOARD_TYPE = "haltestellen-abfahrtsanzeige";
const BOARD_BUILD = "20261023.234716";
const COLUMNS = [
  ["stop", "Haltestelle", "Stop"],
  ["line", "Linie", "Line"],
  ["destination", "Fahrtziel", "Destination"],
  ["departure", "Abfahrt", "Departure"],
  ["countdown", "In", "In"],
  ["delay", "Verspätung", "Delay"],
  ["platform", "Steig", "Platform"],
  ["status", "Status", "Status"],
  ["operator", "Unternehmen", "Operator"],
];
const DEFAULTS = {
  type: `custom:${BOARD_TYPE}`, entity: "", entities: [], title: "", subtitle: "", footer_text: "",
  heading_text: "", empty_text: "", max_rows: 15, density: "comfortable", view: "table",
  label_line: "", label_destination: "", label_departure: "", label_countdown: "",
  label_delay: "", label_platform: "", label_status: "", label_operator: "",
  show_header: true, show_subtitle: true, show_clock: true, show_footer: true,
  show_updated: true, show_cancelled: true, show_scheduled: true, show_day_labels: true,
  show_data_quality: true, show_stale_warning: true, show_disruptions: true,
  show_fullscreen_button: true, kiosk_mode: false, show_quick_filters: true,
  show_eyebrow: true, show_empty_state: true, show_table_header: true, show_table_sort: true,
  show_quick_filter_heading: true, show_quick_filter_reset: true,
  show_quick_filter_line: true, show_quick_filter_destination: true,
  show_quick_filter_favorites_only: true, show_quick_filter_favorites_edit: true,
  show_disruption_heading: true, show_disruption_count: true,
  show_disruption_descriptions: true, show_disruption_stale_note: true,
  show_map_trip_selector: true, show_map_trip_selector_heading: true,
  show_map_journey: true, show_map_canvas: true, show_map_controls: true,
  show_map_legend: true, show_map_diagnostics: true, show_map_timeline_heading: true,
  show_detail_heading: true, show_more_stops_notice: true, show_stop_cancellation: true,
  show_line_colors: true, show_stop: true, show_line: true, show_destination: true,
  show_departure: true, show_countdown: true, show_delay: true,
  show_platform: false, show_status: true, show_operator: false,
  sort_by: "departure", sort_direction: "asc",
  filter_lines: [], filter_destinations: [],
  show_route_details: true, show_stop_times: true, show_stop_delays: true,
  show_inline_map: true, show_inline_map_hover: true, inline_map_height: "300",
  map_departures: 8, map_height: "400", show_map_line: true, show_actual_route: true, show_map_timeline: true,

};
const STRINGS = {
  de: {
    heading: "ABFAHRTSANZEIGE", noStop: "Haltestelle", missing: "Bitte zuerst einen Haltestellen-Sensor auswählen.",
    unavailable: "Abfahrtsdaten derzeit nicht verfügbar.", empty: "Keine weiteren Abfahrten vorhanden.",
    filterEmpty: "Keine Abfahrten entsprechen den ausgewählten Filtern.",
    cancelled: "Fällt aus", realtime: "Live", planned: "Plan", now: "Jetzt", delayMin: "Min",
    liveConfirmed: "Echtzeitinformationen verfügbar", scheduleOnly: "Nur Fahrplandaten",
    qualityMixed: "Echtzeit: {live} · Fahrplan: {scheduled}",
    qualityStale: "Fahrplandaten veraltet", qualityOffline: "Aktualisierung fehlgeschlagen – letzte bekannte Fahrten",
    qualityNoData: "Noch keine aktuellen Daten", qualityUncertain: "Zeitangabe ungesichert",
    qualityAge: "Letzter erfolgreicher Abruf vor {minutes} Min",
    disruptionsTitle: "Verkehrshinweise", disruptionsOld: "Letzter bekannter Stand – Daten möglicherweise veraltet", disruptionsCount: "Meldungen",
    updated: "Aktualisiert", hr: "Std.", min: "min", noData: "–", stops: "Abfahrten", tomorrow: "Morgen",
    sections: ["Haltestelle", "Darstellung", "Eigene Texte", "Spalten auswählen", "Spaltennamen", "Weitere Angaben", "Sortierung"],
    sectionNotes: ["Sensor für die Haltestelle auswählen", "Wie soll die Abfahrtstafel aussehen?", "Beschriftungen selbst eingeben", "Nur die gewünschten Informationen anzeigen", "Alle Spalten lassen sich umbenennen", "Zusätzliche Daten und Kennzeichen", "Standardsortierung für die Abfahrten"],
    stopSensor: "Haltestelle auswählen", title: "Überschrift", subtitle: "Untertitel", headingText: "Kleine Kopfzeile",
    footer: "Fußzeilentext", emptyText: "Text ohne Abfahrten", rows: "Anzahl Abfahrten", density: "Zeilenhöhe",
    compact: "Kompakt", comfortable: "Normal", spacious: "Großzügig", view: "Ansicht", table: "Abfahrtstafel (Tabelle)",
    list: "Moderne Liste", monitor: "Digitaler Abfahrtsmonitor", map: "Haltestellenkarte", header: "Überschrift anzeigen", subtitleToggle: "Untertitel anzeigen",
    clock: "Aktuelle Uhrzeit", footerToggle: "Fußzeile anzeigen", updatedToggle: "Letzte Aktualisierung",
    cancelledToggle: "Ausgefallene Busse anzeigen", scheduled: "Sollzeit bei Abweichung",
    lineColors: "Linien farbig kennzeichnen", sortBy: "Standardsortierung", sortDirection: "Sortierreihenfolge",
    ascending: "Aufsteigend", descending: "Absteigend",
    fallback: "Bitte Haltestelle wählen", noSensors: "Keine Abfahrtssensoren gefunden",
    sample: "Beispiel: Abfahrten am Bahnhof", fields: "Freie Texte erscheinen direkt in der Karte.",
    visible: "Sichtbar", emptyColumns: "Mindestens eine Spalte muss angezeigt werden.", refresh: "Echtzeit, falls verfügbar",
    routeDetails: "Fahrtverlauf beim Anklicken öffnen", stopTimes: "Zeiten der nächsten Haltestellen",
    stopDelays: "Verspätungen an Haltestellen", inlineMap: "Karte beim Öffnen einer Abfahrt anzeigen",
    inlineMapHover: "Haltestellen bei Mausberührung auf der Karte hervorheben", inlineMapHeight: "Höhe der Fahrtkarte", following: "Nächste Haltestellen",
    followingUnavailable: "Für diese Fahrt sind derzeit keine weiteren Haltestellen verfügbar.",
    moreFollowing: "Weitere Haltestellen sind in dieser Ansicht nicht enthalten.",
    detailsOpen: "Fahrtverlauf anzeigen", detailsClose: "Fahrtverlauf schließen",
    stopCancelled: "Halt entfällt", clockArrival: "Ankunft",
    mapChoose: "Nächste Abfahrten · Fahrt auswählen", mapFollowing: "Fahrtverlauf · nächste Haltestellen",
    mapStart: "Abfahrtshaltestelle", mapZoomIn: "Hineinzoomen", mapZoomOut: "Herauszoomen",
    mapFit: "Alle Haltestellen anzeigen", mapNoGeo: "Für diesen Fahrtverlauf liegen noch keine Haltestellen-Koordinaten vor.",
    mapStraightLine: "Schematische Verbindung (Luftlinie)", mapActualRoute: "Linienverlauf laut Fahrplandaten", mapAria: "Interaktive Haltestellenkarte",
    mapMissingCoords: "Einige Folgehalte haben keine Kartenkoordinaten und erscheinen nur in der Liste.",
    mapTilesUnavailable: "Kartengrundlage nicht verfügbar – Haltepunkte und Fahrtverlauf bleiben sichtbar.",
    invalidConfig: "Ungültige Kartenkonfiguration", multiStopCount: "{count} Haltestellen",
    multiStopPartial: "{available}/{total} Haltestellen",
    fullscreenEnter: "Vollbild", fullscreenExit: "Vollbild beenden",
    quickFilters: "Schnellfilter", quickFiltersAria: "Schnellfilter und Favoriten",
    quickReset: "Zurücksetzen", quickAll: "Alle", quickLine: "Linie", quickDestination: "Fahrtziel",
    quickFavoritesOnly: "★ Nur Favoriten", quickFavoriteLines: "Linien merken:", quickFavoriteLine: "Favorit Linie {line}",
    tableCaption: "Nächste Abfahrten, sortierbar nach Spalten", sortDepartures: "Abfahrten sortieren",
    noticeLine: "Linie {line}", noticeCancelled: "{line}{destination}: Fahrt fällt aus",
    noticeDelay: "{line}{destination}: {minutes} Min. Verspätung",
  },
  en: {
    heading: "DEPARTURES", noStop: "Stop", missing: "Choose a departure sensor first.",
    unavailable: "Departures currently unavailable.", empty: "No upcoming departures.",
    filterEmpty: "No departures match the selected filters.",
    cancelled: "Cancelled", realtime: "Live", planned: "Scheduled", now: "Now", delayMin: "min",
    liveConfirmed: "Realtime information available", scheduleOnly: "Scheduled times only",
    qualityMixed: "Live: {live} · Schedule: {scheduled}",
    qualityStale: "Timetable data is outdated", qualityOffline: "Update failed – last known departures",
    qualityNoData: "No current data yet", qualityUncertain: "Uncertain time information",
    qualityAge: "Last successful update {minutes} min ago",
    disruptionsTitle: "Service alerts", disruptionsOld: "Last known status – information may be outdated", disruptionsCount: "Notices",
    updated: "Updated", hr: "hr", min: "min", noData: "–", stops: "Departures", tomorrow: "Tomorrow",
    sections: ["Stop", "Appearance", "Your texts", "Visible columns", "Column names", "Additional details", "Sorting"],
    sectionNotes: ["Select a bus-stop sensor", "Choose the layout of the board", "Write any headings and labels", "Display only what you need", "Rename every column", "Further information and indicators", "Default sorting for departures"],
    stopSensor: "Choose stop", title: "Heading", subtitle: "Subtitle", headingText: "Small heading",
    footer: "Footer text", emptyText: "Message when empty", rows: "Departures shown", density: "Row height",
    compact: "Compact", comfortable: "Regular", spacious: "Spacious", view: "Layout", table: "Departure board (table)",
    list: "Modern list", monitor: "Digital departure monitor", map: "Route map", header: "Show heading", subtitleToggle: "Show subtitle", clock: "Current time",
    footerToggle: "Show footer", updatedToggle: "Last update",
    cancelledToggle: "Show cancelled buses", scheduled: "Show scheduled time if changed",
    lineColors: "Color-code lines", sortBy: "Default sort", sortDirection: "Sort order",
    ascending: "Ascending", descending: "Descending",
    fallback: "Choose a stop", noSensors: "No compatible sensors found",
    sample: "Example: Central Station departures", fields: "Custom text appears immediately on the card.",
    visible: "Visible", emptyColumns: "Show at least one column.", refresh: "Real-time, where available",
    routeDetails: "Expand trip stops on selection", stopTimes: "Arrival times at subsequent stops",
    stopDelays: "Delays at intermediate stops", inlineMap: "Show map when expanding a departure",
    inlineMapHover: "Highlight map stops when hovering over the list", inlineMapHeight: "Trip map height", following: "Next stops",
    followingUnavailable: "No following stop information is available for this trip.",
    moreFollowing: "Additional stops are not included in this view.",
    detailsOpen: "Show following stops", detailsClose: "Hide following stops",
    stopCancelled: "Stop cancelled", clockArrival: "Arrival",
    mapChoose: "Upcoming departures · Select a trip", mapFollowing: "Trip stops · Upcoming stops",
    mapStart: "Departure stop", mapZoomIn: "Zoom in", mapZoomOut: "Zoom out",
    mapFit: "Fit all stops", mapNoGeo: "No geographic coordinates are available for this trip.",
    mapStraightLine: "Schematic connection (straight line)", mapActualRoute: "Route shape from timetable data", mapAria: "Interactive stop map",
    mapMissingCoords: "Some stops have no map coordinates and appear only in the list.",
    mapTilesUnavailable: "Map background unavailable – stops and route are still shown.",
    invalidConfig: "Invalid departure board configuration", multiStopCount: "{count} stops",
    multiStopPartial: "{available}/{total} stops",
    fullscreenEnter: "Fullscreen", fullscreenExit: "Exit fullscreen",
    quickFilters: "Quick filters", quickFiltersAria: "Quick filters and favorites",
    quickReset: "Reset", quickAll: "All", quickLine: "Line", quickDestination: "Destination",
    quickFavoritesOnly: "★ Favorites only", quickFavoriteLines: "Favorite lines:", quickFavoriteLine: "Favorite line {line}",
    tableCaption: "Upcoming departures, sorted by the selected column", sortDepartures: "Sort departures",
    noticeLine: "Line {line}", noticeCancelled: "{line}{destination}: departure cancelled",
    noticeDelay: "{line}{destination}: {minutes} min delay",
  },
};
const languageOf = hass => String(hass?.locale?.language || hass?.language || "de").toLowerCase().startsWith("de") ? "de" : "en";
const words = hass => STRINGS[languageOf(hass)];
const formatMessage = (template, values={}) => String(template).replace(/\{(\w+)\}/g, (match,key)=>
  Object.prototype.hasOwnProperty.call(values,key)?String(values[key]):match);
// Feed notices may only be available in the provider's original language.
// Derived cancellations and delays always follow the viewing user's locale.
function localizedNotice(notice,hass){
  const w=words(hass),lang=languageOf(hass);
  const translatedTitle=notice?.[`titel_${lang}`];
  const translatedDescription=notice?.[`beschreibung_${lang}`];
  let title=typeof translatedTitle==="string"&&translatedTitle?translatedTitle:String(notice?.titel||"");
  let description=typeof translatedDescription==="string"?translatedDescription:String(notice?.beschreibung||"");
  if(notice?.quelle==="stoptimes" && Object.prototype.hasOwnProperty.call(notice,"ziel") && ["ausfall","verspaetung"].includes(notice.typ)){
    const line=formatMessage(w.noticeLine,{line:notice.linie||"Bus"});
    const destination=notice.ziel?` → ${notice.ziel}`:"";
    if(notice.typ==="ausfall")title=formatMessage(w.noticeCancelled,{line,destination});
    else if(Number.isFinite(Number(notice.verspaetung_minuten)))
      title=formatMessage(w.noticeDelay,{line,destination,minutes:Math.round(Number(notice.verspaetung_minuten))});
  }
  if(notice?.haltestelle)title=`${notice.haltestelle}: ${title}`;
  return {title,description};
}
function node(tag, className = "", text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined && text !== null) el.textContent = String(text);
  return el;
}
const validTime = v => typeof v === "string" && Number.isFinite(Date.parse(v));
const columnLabel = (config, key, hass) => {
  const entry = COLUMNS.find(x => x[0] === key);
  return config[`label_${key}`] || (entry ? entry[languageOf(hass) === "de" ? 1 : 2] : key);
};
const visibleColumns = cfg => COLUMNS.filter(([key]) => cfg[`show_${key}`] !== false);
const delayText = (value, w) => typeof value === "number" && Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${value} ${w.delayMin}` : "–";
// An empty filter means all routes/destinations. Filters are per dashboard card,
// never persisted to the underlying stop sensor or applied to other cards.
const filterValues = value => Array.isArray(value)
  ? [...new Set(value.filter(x=>typeof x==="string" || typeof x==="number" && Number.isFinite(x))
      .map(x=>String(x).trim()).filter(Boolean))]
  : [];
const departureLine = row => String(row?.linie ?? "").trim();
const departureDestination = row => String(row?.ziel || row?.richtung || "").trim();
// Combine existing stop sensors in Lovelace; no additional network requests.
function selectedStopEntities(cfg){
  const explicit=Array.isArray(cfg?.entities)?cfg.entities.filter(id=>typeof id==="string"&&id.startsWith("sensor.")):[];
  return [...new Set(explicit.length?explicit:[cfg?.entity].filter(Boolean))];
}
// Recorder receives a compact sensor preview. The complete cached departures
// are delivered separately by the integration's authenticated WebSocket command.
function fullStopState(hass,id,snapshots){
  const state=hass?.states?.[id];
  const snapshot=snapshots?.get(id);
  if(!state || !snapshot || !snapshot.data || snapshot.revision!==state.attributes?.zeitpunkt_abfrage)return state;
  return {...state,attributes:{...state.attributes,
    abfahrten:snapshot.data.abfahrten,verkehrshinweise:snapshot.data.verkehrshinweise}};
}
function mergedStopState(hass,cfg,snapshots=null){
  const ids=selectedStopEntities(cfg);
  if(ids.length<=1)return fullStopState(hass,ids[0],snapshots);
  const source=ids.map(id=>({id,state:fullStopState(hass,id,snapshots)}));
  const present=source.filter(x=>x.state && Array.isArray(x.state.attributes?.abfahrten));
  const rows=present.flatMap(({id,state})=>{
    const name=state.attributes.haltestelle||state.attributes.friendly_name||id;
    return state.attributes.abfahrten.map(r=>({...r,_stop_name:name,_stop_entity:id,_stop_attrs:state.attributes}));
  });
  const notices=present.flatMap(({id,state})=>(Array.isArray(state.attributes.verkehrshinweise)?state.attributes.verkehrshinweise:[])
    .map(n=>({...n,haltestelle:state.attributes.haltestelle||state.attributes.friendly_name||id})));
  const timestamps=present.map(x=>x.state.attributes.zeitpunkt_abfrage).filter(validTime);
  const success=present.every(x=>x.state.attributes.abruf_erfolgreich!==false)&&present.length===ids.length;
  return {state:present.length?"0":"unavailable",attributes:{
    haltestelle:(present.length===ids.length?words(hass).multiStopCount:words(hass).multiStopPartial)
      .replace("{count}",String(ids.length)).replace("{available}",String(present.length)).replace("{total}",String(ids.length)),
    abfahrten:rows,verkehrshinweise:notices,abruf_erfolgreich:success,
    zeitpunkt_abfrage:timestamps.length?new Date(Math.min(...timestamps.map(Date.parse))).toISOString():null,
  }};
}
function getRows(state, cfg, now = Date.now()) {
  const arr = Array.isArray(state?.attributes?.abfahrten) ? state.attributes.abfahrten : [];
  const lines = new Set(filterValues(cfg.filter_lines));
  const destinations = new Set(filterValues(cfg.filter_destinations));
  return arr.filter(r => r && validTime(r.abfahrt) && Date.parse(r.abfahrt) >= now - 30000 &&
    (cfg.show_cancelled || !r.ausfall) &&
    (!lines.size || lines.has(departureLine(r))) &&
    (!destinations.size || destinations.has(departureDestination(r))));
}
function availableFilterValues(state, key, selected=[]) {
  const rows=Array.isArray(state?.attributes?.abfahrten)?state.attributes.abfahrten:[];
  const options=rows.filter(row=>row && validTime(row.abfahrt) && Date.parse(row.abfahrt)>=Date.now()-30000)
    .map(row=>key==="filter_lines"?departureLine(row):departureDestination(row));
  return [...new Set([...options,...filterValues(selected)])].filter(Boolean)
    .sort((a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:"base"}));
}
function boardDataSignature(state) {
  const attrs = state?.attributes || {};
  const status = !state ? "missing" : ["unavailable", "unknown"].includes(state.state) ? state.state : "ready";
  return JSON.stringify([status, attrs.haltestelle || "", attrs.friendly_name || "", attrs.abfahrten || [],
    attrs.abruf_erfolgreich, attrs.zeitpunkt_abfrage || "", attrs.verkehrshinweise || []]);
}
function lineColor(line) {
  const colors = ["#2762cb", "#11866d", "#7752b4", "#ae466f", "#ab6b1e", "#167d99", "#3e658d", "#5d713e"];
  let hash = 0;
  for (const ch of String(line || "Bus")) hash = (Math.imul(hash, 31) + ch.charCodeAt(0)) >>> 0;
  return colors[hash % colors.length];
}
function safeColor(str, fallback) { return /^#[\da-f]{6}$/i.test(str || "") ? str : fallback; }
function colorDistance(first, second) {
  if (!/^#[0-9a-f]{6}$/i.test(first||"") || !/^#[0-9a-f]{6}$/i.test(second||""))return 1e9;
  const parts=color=>[1,3,5].map(i=>parseInt(color.slice(i,i+2),16));
  const a=parts(first),b=parts(second);
  return Math.sqrt(a.reduce((sum,n,i)=>sum+Math.pow(n-b[i],2),0));
}
function lineColorStyles(rows) {
  // Stable per-stop assignments. Explicit operator colors are retained when they
  // clearly distinguish routes; conflicting colors are replaced with distinct ones.
  const entries=new Map();
  for(const row of rows||[]) {
    const line=String(row?.linie||"Bus").trim()||"Bus";
    if(!entries.has(line))entries.set(line,{preferred:null,text:null});
    const info=entries.get(line);
    if(!info.preferred && /^#[0-9a-f]{6}$/i.test(row?.linienfarbe||"")){
      info.preferred=row.linienfarbe;
      info.text=/^#[0-9a-f]{6}$/i.test(row?.linien_textfarbe||"")?row.linien_textfarbe:null;
    }
  }
  const names=[...entries.keys()].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:"base"}));
  const colors=["#2762cb","#11866d","#7752b4","#ae466f","#ab6b1e","#167d99","#3e658d","#5d713e",
    "#b04d24","#6846a8","#196984","#874853","#61752b","#884bb1","#9d542b","#285a9b"];
  const styles=new Map(),used=[];
  for(const line of names){
    const original=entries.get(line);
    const distinct=color=>used.every(previous=>colorDistance(color,previous)>=80);
    let chosen=original.preferred&&distinct(original.preferred)?original.preferred:null;
    if(!chosen){
      let hash=0;for(const ch of line)hash=(Math.imul(hash,31)+ch.charCodeAt(0))>>>0;
      for(let i=0;i<colors.length;i++){
        const option=colors[(hash+i)%colors.length];
        if(distinct(option)){chosen=option;break;}
      }
    }
    if(!chosen){
      // Very busy stops can have more distinct lines than predefined colors.
      // Keep generating deterministic hues until a new color is available.
      let hash=0;for(const ch of line)hash=(Math.imul(hash,31)+ch.charCodeAt(0))>>>0;
      for(let i=0;i<360;i++){
        const hue=(hash*13+i*137.508)%360;
        const option=`hsl(${hue.toFixed(2)} 55% 36%)`;
        if(!used.includes(option)){chosen=option;break;}
      }
    }
    const text=original.preferred===chosen && original.text?original.text:"#ffffff";
    // Transit agencies may publish a white badge with white lettering.
    // Validate their recommended foreground and choose readable black/white text.
    const background=chosen||lineColor(line);
    const rgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255)
      .map(c=>c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4);
    const lum=hex=>rgb(hex).reduce((sum,c,i)=>sum+c*[0.2126,0.7152,0.0722][i],0);
    const ratio=(a,b)=>{const x=lum(a),y=lum(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
    const preferred=/^#[0-9a-f]{6}$/i.test(text)?text:null;
    const foreground=/^#[0-9a-f]{6}$/i.test(background)
      ? preferred && ratio(background,preferred)>=4.5?preferred
        : ratio(background,"#ffffff")>=ratio(background,"#111827")?"#ffffff":"#111827"
      : "#ffffff";
    styles.set(line,{background,text:foreground});
    used.push(chosen||lineColor(line));
  }
  return styles;
}


// Do not infer realtime status from an on-time departure alone. Backend MOTIS
// TimestampReason identifies the actual time source for individual journeys.
function freshnessOf(state, now = Date.now()) {
  const attrs=state?.attributes||{};
  const stamp=attrs.letzter_erfolgreicher_abruf||attrs.zeitpunkt_abfrage;
  const hasStamp=validTime(stamp);
  const age=hasStamp?Math.max(0,(now-Date.parse(stamp))/60000):null;
  const failed=attrs.abruf_erfolgreich===false;
  return {failed,age,stale:failed||(hasStamp&&age>15),hasStamp};
}
function qualityLabel(rows, w) {
  const valid=rows.filter(r=>!r.ausfall);
  if(!valid.length)return "";
  const live=valid.filter(r=>r.zeitqualitaet==="realtime" ||
    (!r.zeitqualitaet && r.echtzeit===true)).length;
  const schedule=valid.length-live;
  if(live===valid.length)return w.liveConfirmed;
  if(!live)return w.scheduleOnly;
  return w.qualityMixed.replace("{live}",live).replace("{scheduled}",schedule);
}

function durationText(time, now, lang = "de") {
  const mins = Math.max(0, Math.ceil((Date.parse(time) - now) / 60000));
  const w = STRINGS[lang] || STRINGS.de;
  if (!mins) return w.now;
  return mins >= 60 ? `${Math.floor(mins / 60)} ${w.hr} ${mins % 60} ${w.min}` : `${mins} ${w.min}`;
}
// A stop's day is defined by Home Assistant's configured time zone, not by
// the operating system's browser time zone or by fixed 24-hour UTC windows.
function timeZoneOf(hass) {
  const zone=hass?.config?.time_zone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  try { new Intl.DateTimeFormat("en-US",{timeZone:zone});return zone; }
  catch(_error){return "UTC";}
}
function civilDayIndex(time, timeZone) {
  const date=new Date(time);
  const parts=new Intl.DateTimeFormat("en-GB",{timeZone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date);
  const fields=Object.fromEntries(parts.filter(p=>["year","month","day"].includes(p.type)).map(p=>[p.type,Number(p.value)]));
  return Math.round(Date.UTC(fields.year,fields.month-1,fields.day)/86400000);
}
function departureDayLabel(time, now, hass, locale) {
  if(!validTime(time))return "";
  const tz=timeZoneOf(hass),diff=civilDayIndex(Date.parse(time),tz)-civilDayIndex(now,tz);
  if(diff===0)return "";
  if(diff===1)return words(hass).tomorrow;
  const thisYear=new Intl.DateTimeFormat("en",{timeZone:tz,year:"numeric"}).format(now);
  const departureYear=new Intl.DateTimeFormat("en",{timeZone:tz,year:"numeric"}).format(Date.parse(time));
  return new Intl.DateTimeFormat(locale,{
    timeZone:tz,weekday:"short",day:"2-digit",month:"2-digit",
    ...(thisYear===departureYear?{}:{year:"numeric"})
  }).format(Date.parse(time));
}
function clockText(time, locale = "de-DE", timeZone) {
  return validTime(time) ? new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", ...(timeZone?{timeZone}:{}) }).format(Date.parse(time)) : "–";
}
function sortRows(rows, key, direction, now = Date.now()) {
  const val = row => {
    if (key === "departure" || key === "countdown") return Date.parse(row.abfahrt);
    if (key === "delay") return Number(row.verspaetung_minuten) || 0;
    if (key === "status") return row.ausfall ? 2 : row.echtzeit ? 1 : 0;
    if (key === "platform") return String(row.steig || "");
    if (key === "operator") return String(row.verkehrsunternehmen || "");
    if (key === "line") return String(row.linie || "");
    return String(row.ziel || row.richtung || "");
  };
  return rows.slice().sort((a, b) => {
    const x = val(a), y = val(b);
    const cmp = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: "base" });
    return (direction === "desc" ? -1 : 1) * (cmp || Date.parse(a.abfahrt) - Date.parse(b.abfahrt));
  });
}
// Keep foreground, background and controls coherent even when a custom HA theme
// exposes conflicting --ha-card-background and --primary-text-color variables.
const THEME_CSS = `
:host{--transit-paper:#ffffff;--transit-ink:#172638;--transit-muted:#526579;
  --transit-surface:#f0f4f9;--transit-border:#d4dee9;--transit-accent:#2165b5;
  --primary-text-color:var(--transit-ink);--secondary-text-color:var(--transit-muted);
  --card-background-color:var(--transit-paper);--ha-card-background:var(--transit-paper);
  --secondary-background-color:var(--transit-surface);--divider-color:var(--transit-border);
  --primary-color:var(--transit-accent);--transit-accent-ink:#ffffff;
  --success-color:#087452;--error-color:#b4233b;
  color:var(--transit-ink);color-scheme:light}
:host([data-transit-theme="dark"]){--transit-paper:#17283b;--transit-ink:#f3f7fc;
  --transit-muted:#becfe2;--transit-surface:#23364a;--transit-border:#41566c;
  --transit-accent:#85bfff;--transit-accent-ink:#13243a;
  --success-color:#74e5bc;--error-color:#ff999c;
  color-scheme:dark}
:host ha-card.monitor,:host(:fullscreen) ha-card{
  --primary-text-color:#f3f8fe;--secondary-text-color:#bacfe2;
  --card-background-color:#10283b;--secondary-background-color:#1a3852;
  --divider-color:#37556d;--primary-color:#ffd36f;
  --success-color:#74e5bc;--error-color:#ff9a9a;
  color-scheme:dark}
`;
function applyTransitTheme(element,hass){
  const mode=hass?.themes?.darkMode===true?"dark":"light";
  const changed=element.getAttribute("data-transit-theme")!==mode;
  if(changed)element.setAttribute("data-transit-theme",mode);
  return changed;
}

const BOARD_CSS = `
.stopName{font-size:.84em;color:var(--secondary-text-color,#64748b);font-weight:600}
.disruptionPanel{margin:10px 16px;border:1px solid var(--divider-color,#dce2ec);border-radius:13px;overflow:hidden;background:var(--card-background-color,#fff);min-width:0}
.disruptionHeader{display:flex;align-items:center;gap:9px;padding:10px 13px;font-size:13px;background:color-mix(in srgb,#f0ae2d 11%,var(--card-background-color,#fff));color:var(--primary-text-color,#203047)}
.disruptionSymbol{display:grid;place-items:center;border-radius:50%;width:20px;height:20px;background:#a8630e;color:white;font-weight:800}
.disruptionCount{margin-left:auto;color:var(--secondary-text-color,#738198);font-size:11px}
.disruptionStale{font-size:11px;padding:8px 13px;background:color-mix(in srgb,#e9a83b 12%,var(--card-background-color,#fff))}
.disruptionList{max-height:260px;overflow:auto;overscroll-behavior:contain}
.disruptionItem{padding:9px 13px;border-top:1px solid var(--divider-color,#e5e9ef);border-left:3px solid #7f8fa2;overflow-wrap:anywhere}
.disruptionItem.disruptionCancelled{border-left-color:#c03e46}.disruptionItem.disruptionDelay{border-left-color:#ce8a2a}
.disruptionTitle{font-weight:680;font-size:12px;line-height:1.5}.disruptionText{font-size:11px;line-height:1.55;margin-top:3px;white-space:pre-line;max-height:140px;overflow:auto}
@media(max-width:480px){.disruptionPanel{margin:8px 10px}}

.dataQuality{display:flex;flex-wrap:wrap;align-items:center;gap:6px 11px;padding:9px 22px;
  background:var(--secondary-background-color,rgba(100,130,160,.065));color:var(--secondary-text-color,#50647c);
  border-top:1px solid var(--divider-color,rgba(130,150,170,.18));font-size:12px;line-height:1.35}
.dataQuality[hidden]{display:none}
.qualityPill{display:inline-flex;align-items:center;gap:7px;font-weight:700}
.qualityDot{width:7px;height:7px;border-radius:50%;background:#208b68;flex:none}
.dataQuality.scheduled .qualityDot{background:#8290a2}
.dataQuality.stale{background:color-mix(in srgb,#eab64e 12%,var(--card-background-color,#fff));
  color:var(--primary-text-color,#263245)}
.dataQuality.stale .qualityDot{background:#d49121}
.dataQuality .qualityAge{font-size:11px;opacity:.85}
.monitor .dataQuality{background:#173550;color:#dcebf7;border-color:#294966}
.monitor .dataQuality.stale{background:#4b3c26;color:#fff2d2}
@media(max-width:480px){.dataQuality{padding:8px 12px}}

/* The calendar badge is separate from the absolute departure time so the
   timetable remains legible in table, list, digital display and map views. */
.timeWithDay{display:inline-flex;flex-direction:column;gap:2px;align-items:flex-start;max-width:100%;vertical-align:middle}
.departureDay{display:block;font-size:11px;line-height:1.25;font-weight:750;color:var(--primary-color,#326cc8);white-space:normal;max-width:100%}
.plannedDay{display:inline;font-size:inherit;font-weight:700;margin:0 4px 0 2px}
.listTime .timeWithDay,.mapJourneyTime .timeWithDay,.mapStopClock .timeWithDay,.stopWhen .timeWithDay{align-items:flex-end}
.mapTripInfo .timeWithDay{align-items:flex-start}
.monitor .departureDay{color:#ffd16e}
.monitor .plannedDay{color:#ffd16e}

.mapMissingCoords{padding:7px 11px;background:var(--secondary-background-color,#f3f6fa);color:var(--secondary-text-color,#64748b);font-size:11px;}
/* Fourth presentation: interactive route map. The board still fills its HA tile. */
.mapMode{box-sizing:border-box;width:100%;max-width:100%;min-width:0;padding:0 18px 18px}
.mapSectionLabel{font-size:11px;font-weight:800;color:var(--secondary-text-color,#64748b);text-transform:uppercase;letter-spacing:.065em;margin:9px 0 9px}
.mapDepartures{display:flex;align-items:stretch;gap:9px;max-width:100%;padding:1px 0 12px;overflow-x:auto;scrollbar-width:thin}
.mapTrip{min-width:166px;max-width:235px;flex:0 0 190px;display:flex;align-items:center;gap:9px;text-align:left;cursor:pointer;background:var(--secondary-background-color,#f1f5fa);border:1px solid var(--divider-color,#d8e0e9);border-radius:11px;padding:10px;color:var(--primary-text-color,#24344c);font:inherit;transition:border-color .12s,background-color .12s}
.mapTrip.selected{border:2px solid var(--primary-color,#326cc8);padding:9px;background:color-mix(in srgb,var(--primary-color,#326cc8) 10%,var(--card-background-color,#fff))}
.mapTrip:focus-visible,.mapPin:focus-visible,.mapStopItem:focus-visible,.mapControl:focus-visible{outline:3px solid var(--primary-color,#4383e8);outline-offset:2px}
.mapTrip.cancelled{opacity:.55}.mapTripLine{flex:0 0 auto;padding:6px 8px;min-width:35px;border-radius:7px;text-align:center;font-size:13px;font-weight:830}
.mapTripInfo{display:flex;flex-direction:column;gap:4px;min-width:0}.mapTripDestination{font-size:12px;font-weight:740;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mapTripTime{font-size:12px;color:var(--secondary-text-color,#697f90);font-variant-numeric:tabular-nums}
.mapContent{box-sizing:border-box;width:100%;max-width:100%;border:1px solid var(--divider-color,#d8e0e9);border-radius:14px;overflow:hidden;min-width:0}
.mapJourney{display:flex;align-items:center;justify-content:space-between;gap:10px 12px;padding:12px 15px;background:var(--secondary-background-color,#f4f7fb)}
.mapJourneyMain{display:flex;align-items:center;gap:10px;min-width:0}.mapJourneyLine{background:var(--primary-color,#245caf);color:var(--transit-accent-ink,#fff);font-size:13px;font-weight:850;border-radius:7px;padding:6px 8px;white-space:nowrap}
.mapJourneyDest{font-size:14px;font-weight:760;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.mapJourneyTime{font-size:16px;font-weight:820;white-space:nowrap;display:flex;flex-direction:column;align-items:flex-end;font-variant-numeric:tabular-nums}
.mapJourneyDelay{font-size:11px;font-weight:620;color:var(--secondary-text-color,#667589)}
.mapCanvasWrapper{width:100%;min-width:0}.mapViewport{width:100%;min-width:0;max-width:100%;position:relative;overflow:hidden;background:#dce8e5;touch-action:none;cursor:grab;isolation:isolate;user-select:none}
/* A schematic background stays usable if the map-tile server is unreachable. */
.mapViewport{background-color:#e6eef0;background-image:linear-gradient(45deg,transparent 48%,#cad9dd88 49%,#cad9dd88 51%,transparent 52%),linear-gradient(-45deg,transparent 48%,#cad9dd55 49%,#cad9dd55 51%,transparent 52%);background-size:60px 60px}
.mapTileFailed{position:absolute;bottom:36px;left:8px;right:8px;z-index:4;pointer-events:none;display:flex;justify-content:center}
.mapTileFailed span{color:#30465e;background:#ffffffed;border:1px solid #d4e0e9;border-radius:7px;padding:6px 9px;font-size:11px;text-align:center}
.mapTileFailed[hidden]{display:none}
.mapViewport:active{cursor:grabbing}.mapTiles,.mapPins,.mapLines{position:absolute;inset:0}.mapTiles{z-index:0;overflow:hidden}.mapPins{z-index:2;pointer-events:none}.mapLines{width:100%;height:100%;z-index:1;pointer-events:none;overflow:hidden}
.mapTile{width:256px;height:256px;position:absolute;max-width:none;object-fit:cover;pointer-events:none;user-select:none;display:block}
.mapPin{position:absolute;transform:translate(-50%,-50%);pointer-events:auto;z-index:3;display:flex;align-items:center;justify-content:center;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 7px #001a3766;background:#285ca7;color:#fff;font-weight:830;font-size:12px;min-width:28px;height:28px;padding:0 3px;cursor:pointer;font-family:inherit}
.mapPin.origin{background:#0a9679;min-width:36px;height:36px;border-width:3px;font-size:15px}.mapPin.focused{outline:3px solid #facb49;outline-offset:2px}
.mapControls{position:absolute;right:11px;top:11px;z-index:5;display:grid;gap:4px;background:#ffffffdd;padding:5px;border-radius:11px;box-shadow:0 2px 12px #122b4b33}
.mapControl{height:30px;width:32px;border:0;border-radius:7px;color:#263850;background:white;cursor:pointer;font-size:20px;line-height:1;font-weight:710;display:flex;align-items:center;justify-content:center}
.mapControl:hover{background:#e8eff7}
.mapAttribution{position:absolute;bottom:5px;right:5px;z-index:6;background:#fffefadd;color:#33465a;font-size:10px;line-height:1.2;padding:3px 6px;border-radius:4px}
.mapAttribution a{color:#1c4d7b;text-decoration:none}.mapAttribution a:hover{text-decoration:underline}
.mapLegend{position:absolute;bottom:24px;left:6px;max-width:calc(100% - 130px);background:#fffefbe8;color:#425469;border-radius:5px;padding:3px 6px;font-size:10px;line-height:1.3;z-index:5}
.mapPopup{position:absolute;transform:translate(-50%,-100%);z-index:7;min-width:155px;max-width:245px;background:#fff;color:#21314a;box-shadow:0 3px 20px #182e4b4d;border-radius:10px;padding:10px 12px;pointer-events:none;font-size:12px;text-align:center;border:1px solid #ccd8e2}
.mapPopup[hidden]{display:none}.mapPopupName{font-weight:760;font-size:12px}.mapPopupTime{font-size:15px;font-weight:850;font-variant-numeric:tabular-nums;margin-top:3px}.mapPopupLate{font-size:11px;color:#bf4444;margin-top:2px}
.mapNoCoords{background:var(--secondary-background-color,#e9f0f5);color:var(--secondary-text-color,#667589);min-height:170px;padding:30px 18px;display:flex;align-items:center;justify-content:center;text-align:center;font-size:13px}
.mapTimeline{padding:13px 15px 16px;background:var(--card-background-color,#fff)}
.mapTimeline>.mapSectionLabel{margin:1px 0 11px}
.mapStopList{max-height:260px;overflow-y:auto;scrollbar-width:thin;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:3px 10px;align-items:start}
.mapStopItem{border:0;background:transparent;padding:8px 6px;display:flex;align-items:center;text-align:left;gap:9px;font:inherit;color:var(--primary-text-color,#263245);border-radius:8px;cursor:pointer;min-width:0}
.mapStopItem:hover{background:var(--secondary-background-color,#f0f4f8)}
.mapStopItem.hovered{background:color-mix(in srgb,#f5c14b 17%,var(--card-background-color,#fff));box-shadow:inset 0 0 0 1px #d8ad4a}
.mapStopItem:focus-visible{outline:2px solid var(--primary-color,#4383e8);outline-offset:-2px}
.mapStopNumber{display:flex;align-items:center;justify-content:center;flex:0 0 26px;height:26px;border-radius:50%;font-size:11px;font-weight:820;background:var(--secondary-background-color,#eaf0f9);border:1px solid var(--divider-color,#d9e2ec);color:var(--primary-color,#285aaf)}
.mapStopNumber.start{background:#138a73;color:white;border:0;font-size:17px}
.mapStopInfo{display:flex;flex-direction:column;min-width:0;flex:1;gap:1px}.mapStopName{font-size:12px;font-weight:650;line-height:1.35;overflow-wrap:anywhere}.mapStopStatus{font-size:10px;color:var(--error-color,#bb4a45)}
.mapStopClock{font-size:12px;font-weight:780;white-space:nowrap;margin-left:auto;font-variant-numeric:tabular-nums}
.mapExtra{font-size:11px;padding:10px 6px 0;color:var(--secondary-text-color,#64748b)}
@media(max-width:480px){.mapMode{padding:0 10px 10px}.mapTrip{flex-basis:165px;min-width:165px}.mapJourney{padding:11px 10px}.mapJourneyDest{font-size:12px}.mapJourneyTime{font-size:13px}.mapTimeline{padding:11px}.mapLegend{max-width:calc(100% - 80px)}}
/* Dark monitor integration: map selector and timeline keep excellent contrast. */
.monitor .mapTrip{background:#173550;border-color:#294966;color:#ecf5fc}.monitor .mapTrip.selected{background:#234862;border-color:#ffd46f}
.monitor .mapTripTime,.monitor .mapSectionLabel{color:#b3c9d9}.monitor .mapContent{border-color:#34536e}.monitor .mapJourney{background:#183750}.monitor .mapJourneyDest{color:#fff}.monitor .mapJourneyDelay{color:#ffc7aa}
.monitor .mapJourneyLine{background:#e8bd55;color:#122941}.monitor .mapTimeline{background:#102942}.monitor .mapStopItem{color:#f5faff}.monitor .mapStopItem:hover{background:#274963}.monitor .mapStopItem.hovered{background:#394a55;box-shadow:inset 0 0 0 1px #ffd46f}.monitor .mapStopNumber{background:#294d71;color:#ffde85;border-color:#48647e}.monitor .mapStopNumber.start{background:#168c71;color:white}

:host{display:block;width:100%;max-width:100%;min-width:0;height:auto;min-height:0;box-sizing:border-box;--board-accent:var(--primary-color,#4477d6);font-family:var(--paper-font-body1_-_font-family,system-ui,sans-serif)}
ha-card{display:block;width:100%;max-width:100%;min-width:0;height:auto;min-height:0;position:relative;box-sizing:border-box;overflow:hidden;border-radius:var(--ha-card-border-radius,18px);background:var(--ha-card-background,var(--card-background-color,#fff));color:var(--primary-text-color,#1d293c);box-shadow:var(--ha-card-box-shadow,0 1px 3px rgba(0,0,0,.07))}
.hero{padding:22px 24px 18px;display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.heroCopy{min-width:0;flex:1}.eyebrow{font-size:10px;font-weight:760;letter-spacing:.13em;text-transform:uppercase;color:var(--secondary-text-color,#61738d);margin:0 0 7px}
.title{font-size:clamp(18px,2.2vw,24px);font-weight:750;line-height:1.24;letter-spacing:-.025em;word-break:break-word}
.subtitle{color:var(--secondary-text-color,#667587);font-size:13px;margin-top:6px;line-height:1.4}
.clock{display:flex;align-items:center;gap:8px;flex-shrink:0;white-space:nowrap;font-weight:740;font-size:16px;border:1px solid var(--divider-color,#dde3ea);background:var(--secondary-background-color,rgba(100,120,150,.06));border-radius:12px;padding:9px 11px;font-variant-numeric:tabular-nums}
.clockDot{width:7px;height:7px;background:var(--success-color,#1a906f);border-radius:50%}
.tableWrap{width:100%;max-width:100%;min-width:0;box-sizing:border-box;overflow-x:auto;scrollbar-width:thin}
.tableWrap.noHorizontalScroll{overflow-x:hidden}table{width:100%;min-width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
thead{background:var(--secondary-background-color,rgba(110,130,150,.065))}
th{text-align:left;font-size:11px;letter-spacing:.045em;font-weight:770;color:var(--secondary-text-color,#718093);padding:13px 16px;white-space:nowrap}
th:first-child,td:first-child{padding-left:24px}th:last-child,td:last-child{padding-right:24px}
th button{background:none;border:0;color:inherit;font:inherit;font-weight:inherit;letter-spacing:inherit;padding:0;text-align:left;cursor:pointer;white-space:nowrap}
th button:hover,th button:focus-visible,.sorted{color:var(--board-accent)}.sortArrow{margin-left:4px}
td{padding:13px 16px;font-size:13px;border-top:1px solid var(--divider-color,rgba(100,120,140,.12));vertical-align:middle;white-space:nowrap}
tr:hover td{background:var(--secondary-background-color,rgba(110,130,150,.04))}tr.cancelled td{opacity:.62}
.lineBadge{display:inline-flex;justify-content:center;align-items:center;min-width:40px;box-sizing:border-box;border-radius:9px;padding:7px 9px;font-size:14px;font-weight:850;color:white;line-height:1}
.destination{font-size:14px;font-weight:670;white-space:normal;min-width:110px;line-height:1.4}
.departTime{font-size:15px;font-weight:780}.planTime{font-size:11px;color:var(--secondary-text-color,#758195);margin-top:3px}
.remaining{font-weight:760;font-size:13px}.delayLate{color:var(--error-color,#bb4444);font-weight:730}.delayEarly{color:var(--success-color,#158466);font-weight:730}
.pill{display:inline-block;border-radius:8px;background:var(--secondary-background-color,rgba(110,130,150,.08));font-size:11px;font-weight:700;padding:5px 8px;color:var(--secondary-text-color,#64748b)}
.pill.cancel{background:rgba(193,54,54,.1);color:var(--error-color,#c44242)}.pill.live{background:rgba(36,147,110,.1);color:var(--success-color,#148b69)}
.list{padding:6px 12px 12px;display:flex;flex-direction:column;gap:0}
.listRow{display:flex;align-items:center;gap:14px;padding:13px 12px;border-bottom:1px solid var(--divider-color,rgba(110,130,150,.12))}.listRow:last-child{border:0}
.listRow.cancelled{opacity:.6}.listCore{display:flex;flex-direction:column;min-width:0;gap:4px;flex:1}.listDest{font-size:14px;font-weight:720;word-break:break-word}.listMeta{font-size:12px;color:var(--secondary-text-color,#718095);display:flex;flex-wrap:wrap;gap:5px 10px}.listTime{text-align:right;white-space:nowrap;font-size:16px;font-weight:780;font-variant-numeric:tabular-nums}
.listRemaining{font-size:12px;font-weight:570;color:var(--secondary-text-color);margin-top:5px}.listRow .lineBadge{flex-shrink:0}
.empty{padding:35px 18px;text-align:center;font-size:13px;color:var(--secondary-text-color,#768397)}
.foot{display:flex;justify-content:space-between;flex-wrap:wrap;gap:7px 16px;padding:13px 24px;color:var(--secondary-text-color,#768397);font-size:11px;border-top:1px solid var(--divider-color,rgba(110,130,150,.15))}
.compact td{padding-top:8px;padding-bottom:8px}.compact .listRow{padding-top:9px;padding-bottom:9px}
.spacious td{padding-top:18px;padding-bottom:18px}.spacious .listRow{padding-top:17px;padding-bottom:17px}

.expandable{cursor:pointer}.expandable:focus-visible{outline:2px solid var(--board-accent);outline-offset:-2px}
.expandable:hover{background:var(--secondary-background-color,rgba(110,130,150,.065))}
.routeDetailCell{padding:0!important;background:var(--secondary-background-color,rgba(110,130,150,.04));white-space:normal}
.routeDetailRow:hover .routeDetailCell{background:var(--secondary-background-color,rgba(110,130,150,.04))}
.routeDetails{box-sizing:border-box;padding:16px 24px 17px;border-bottom:1px solid var(--divider-color,rgba(110,130,150,.16));min-width:0}
.routeHeading{font-size:12px;font-weight:750;color:var(--secondary-text-color,#6c7c90);margin:0 0 12px;letter-spacing:.02em}
.stopList{display:grid;grid-template-columns:minmax(0,1fr);gap:4px;overflow:visible;padding:7px 4px 9px;box-sizing:border-box}
.stopItem{display:flex;align-items:center;box-sizing:border-box;width:100%;gap:12px;position:relative;padding:10px 13px;min-height:46px}
.stopItem::before{content:"";position:absolute;left:18px;top:calc(50% + 6px);bottom:calc(-50% - 4px);width:2px;background:var(--divider-color,#d5dfe9);pointer-events:none}
.stopItem:last-child::before{display:none}
.stopDot{flex-shrink:0;width:12px;height:12px;border:2px solid var(--board-accent);box-sizing:border-box;background:var(--card-background-color,#fff);border-radius:50%;margin-top:0;position:relative;z-index:1}
.stopInfo{min-width:0;flex:1;display:flex;flex-direction:column;justify-content:center;gap:3px}
.stopName{font-size:13px;font-weight:650;line-height:1.35;white-space:normal;overflow-wrap:anywhere}
.stopMeta{display:flex;flex-wrap:wrap;gap:4px 10px;color:var(--secondary-text-color,#788599);font-size:11px}
.stopWhen{font-size:13px;font-weight:750;white-space:nowrap;font-variant-numeric:tabular-nums;margin-left:auto;align-self:center}
.stopLate{color:var(--error-color,#c44242)}
.stopEmpty{font-size:12px;color:var(--secondary-text-color,#788599);padding:4px 0 7px}
.routeExtra{font-size:11px;color:var(--secondary-text-color,#788599);padding:5px 0 0 24px}
.listRouteDetails{padding-left:54px;padding-right:13px}
.listRow[aria-expanded="true"]{border-bottom:0}
.listRouteDetails .routeDetails{padding:10px 0 16px}
/* Dedicated digital timetable monitor: no advertising, branding or imprint. */
.monitor{--board-accent:#f8cb4b;background:#091a2e;color:#f5f8fc;border:1px solid #234058;border-radius:9px;box-shadow:0 12px 30px #0002;font-variant-numeric:tabular-nums}
.monitor .hero{padding:20px 23px 16px;background:#102942;border-bottom:2px solid #d5a83a}
.monitor .eyebrow{color:#f0c15b;letter-spacing:.18em}
.monitor .title{color:#ffffff;font-weight:820;letter-spacing:.02em}
.monitor .subtitle{color:#b5c6d9}
.monitor .clock{background:#061421;color:#ffdf7d;border:1px solid #44617b;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:18px;border-radius:6px}
.monitor .clockDot{background:#ffd76b}
.monitor thead{background:#132f4c}
.monitor th{color:#aec9dc;padding-top:14px;padding-bottom:14px;font-size:12px;text-transform:uppercase}
.monitor th button{color:inherit}
.monitor th button:hover,.monitor th button:focus-visible,.monitor th.sorted{color:#ffcf54}
.monitor td{color:#f1f7ff;border-top:1px solid #274159;padding-top:15px;padding-bottom:15px}
.monitor tbody tr:nth-child(even) td{background:#0e2239}
.monitor tbody tr:hover td{background:#193850}
.monitor .lineBadge{min-width:44px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;border-radius:4px}
.monitor .destination{color:#f5f9ff;font-weight:700;font-size:15px}
.monitor .departTime{color:#ffe18b;font-size:18px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
.monitor .remaining{color:#f7d777;font-weight:850}
.monitor .planTime{color:#adbed2}
.monitor .delayLate{color:#ff8888}
.monitor .delayEarly{color:#74e4b1}
.monitor .pill{color:#d7e8f7;background:#29435c}
.monitor .pill.live{color:#72edbd;background:#1b4b4c}
.monitor .pill.cancel{color:#ffaaaa;background:#512b3d}
.monitor .foot{background:#102942;border-top:1px solid #2c4760;color:#bdd0df}
.monitor .routeDetailCell,.monitor .routeDetailRow:hover .routeDetailCell{background:#142e46!important}
.monitor .routeDetails{background:#142e46;border-bottom-color:#476079}
.monitor .routeHeading,.monitor .stopMeta,.monitor .routeExtra{color:#b3cade}
.monitor .stopName,.monitor .stopWhen{color:#eff6ff}
.monitor .stopDot{background:#122a42;border-color:#ffd26a}
.monitor .stopItem::before{background:#58738f}
.monitor .stopEmpty{color:#aabed3}
.monitor .listRow{border-bottom-color:#2f4b65}
.monitor .listMeta,.monitor .listRemaining{color:#bad1e0}
.monitor .listDest,.monitor .listTime{color:#f6f9fe}
.monitor .listTime{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;color:#ffdc72}
.monitor .listRouteDetails .routeDetails{background:#142e46}
.monitor .expandable:focus-visible{outline:2px solid #ffd16e}

.quickFilters{padding:12px 18px;border-bottom:1px solid var(--divider-color,#dce2e9);display:grid;gap:10px;min-width:0}
.quickFiltersHead{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:13px}
.quickControls{display:flex;flex-wrap:wrap;align-items:end;gap:10px;min-width:0}
.quickSelectLabel{display:grid;gap:5px;flex:1 1 155px;min-width:110px;font-size:11px;font-weight:650}
.quickSelect{width:100%;min-height:36px;border:1px solid var(--divider-color,#cbd5e1);border-radius:8px;background:var(--card-background-color,#fff);color:var(--primary-text-color,#243248);font:inherit;font-size:13px;padding:6px 8px}
.quickReset,.quickFavoriteOnly,.quickFavButton{border:1px solid var(--divider-color,#cbd5e1);border-radius:8px;background:var(--card-background-color,#fff);color:var(--primary-text-color,#243248);font:inherit;cursor:pointer;padding:8px 10px;min-height:35px}
.quickReset{font-size:11px}.quickFavoriteOnly{font-size:12px}
.quickFavoriteOnly[aria-pressed="true"],.quickFavButton[aria-pressed="true"]{border-color:var(--primary-color,#397ccf);background:color-mix(in srgb,var(--primary-color,#397ccf) 15%,var(--card-background-color,#fff))}
.quickFavList{display:flex;align-items:center;gap:6px;flex-wrap:wrap;max-height:105px;overflow-y:auto}
.quickFavLabel{font-size:11px;opacity:.8;margin-right:5px}.quickFavButton{padding:5px 9px;min-height:30px;font-size:12px}
.quickFilters button:focus-visible,.quickFilters select:focus-visible{outline:2px solid var(--primary-color,#397ccf);outline-offset:2px}
.monitor .quickFilters,:host(:fullscreen) .quickFilters{color:#eff7ff;background:#132c42;border-color:#36516b}
.monitor .quickFilters button,.monitor .quickFilters select,:host(:fullscreen) .quickFilters button,:host(:fullscreen) .quickFilters select{background:#213b54;color:#f1f7ff;border-color:#4b6782}
@media(max-width:580px){.quickFilters{padding:10px 12px}.quickControls{gap:7px}}

/* Fullscreen and kiosk display: fullscreen is activated only by the user's click. */
:host(:fullscreen){display:block!important;box-sizing:border-box;width:100vw!important;height:100vh!important;overflow:auto!important;background:#091a29!important;padding:clamp(8px,1.4vw,24px)!important;color:#fff;}
:host(:fullscreen) ha-card{min-height:calc(100vh - 48px);margin:0 auto;max-width:1800px;background:#0e2335;color:#f3f7ff;border-radius:16px;}
:host(:fullscreen) .hero{padding:clamp(20px,3vw,48px)}
:host(:fullscreen) .title{font-size:clamp(27px,3.5vw,55px)}
:host(:fullscreen) .clock{font-size:clamp(20px,2.1vw,36px)}
:host(:fullscreen) th{font-size:clamp(14px,1.1vw,20px)}
:host(:fullscreen) td{font-size:clamp(17px,1.65vw,29px);padding-top:clamp(12px,1.6vw,25px);padding-bottom:clamp(12px,1.6vw,25px)}
:host(:fullscreen) .listRow{padding-top:clamp(14px,1.8vw,30px);padding-bottom:clamp(14px,1.8vw,30px)}
:host(:fullscreen) .listDest{font-size:clamp(19px,1.9vw,33px)}
:host(:fullscreen) .listTime{font-size:clamp(21px,2vw,36px)}
.screenActions{position:absolute;top:8px;right:8px;z-index:5;display:flex;justify-content:flex-end}
ha-card{position:relative}
.fullscreenToggle{background:var(--secondary-background-color,#edf2f7);color:var(--primary-text-color,#173044);border:1px solid var(--divider-color,#bdc8d2);border-radius:9px;padding:7px 11px;font:inherit;font-size:12px;cursor:pointer;min-height:34px}
.fullscreenToggle:hover{filter:brightness(.94)}
.fullscreenToggle:focus-visible{outline:3px solid var(--primary-color,#1687d9);outline-offset:2px}
:host(:fullscreen) .fullscreenToggle{background:#24425c;color:#fff;border-color:#55708a;font-size:14px;padding:10px 15px}
.kiosk .eyebrow,.kiosk .subtitle{display:none}
.kiosk .hero{padding:20px 24px}
.kiosk .title{font-size:clamp(24px,2.7vw,40px)}
.kiosk .clock{font-size:clamp(19px,2vw,30px)}
.kiosk th{font-size:clamp(13px,1.1vw,19px)}
.kiosk td{font-size:clamp(16px,1.5vw,26px);padding-top:16px;padding-bottom:16px}
.kiosk .foot{opacity:.75}
@media(max-width:650px){.screenActions{top:5px;right:5px}.fullscreenToggle{font-size:11px;padding:6px 9px}.heroCopy{padding-right:76px}}
/* Route detail layout: full-width map above an unrestricted vertical stop list. */
.routeDetailsBody{display:flex;flex-direction:column;width:100%;min-width:0;gap:12px;align-items:stretch}
.routeDetailsBody>.stopList{max-height:none;overflow:visible;min-width:0;width:100%;box-sizing:border-box}
.routeDetailsBody>.routeHeading{margin:2px 0 1px}
.inlineRouteMap{box-sizing:border-box;min-width:0;width:100%;border:1px solid var(--divider-color,#cad5e2);border-radius:12px;overflow:hidden;background:var(--secondary-background-color,#edf3f7)}
.inlineRouteMap .mapViewport{border-radius:0}
.inlineRouteStop{cursor:default;border-radius:11px;transition:background .12s ease,box-shadow .12s ease,color .12s ease;box-shadow:inset 0 0 0 1px transparent}
.inlineRouteStop.hovered,.inlineRouteStop:focus-visible{background:color-mix(in srgb,#f1b634 13%,var(--card-background-color,#fff));outline:none;box-shadow:inset 0 0 0 2px #e6b847}
.mapPin.highlighted,.mapPin.highlighted.origin{background:#f8b723;color:#132c40;z-index:9;border-color:#fff;box-shadow:0 0 0 7px #ffd56877,0 0 24px 8px #ffc648b0;transform:translate(-50%,-50%) scale(1.3);transition:box-shadow .12s,transform .12s}
.monitor .inlineRouteStop.hovered,.monitor .inlineRouteStop:focus-visible{background:#31465a;color:#fff;box-shadow:inset 0 0 0 2px #f0c15b}
@media(max-width:650px){.routeDetailsBody{gap:10px}.stopItem{min-height:46px;padding:10px 11px}.stopItem::before{left:16px}}
@media(max-width:580px){.hero{padding:18px 16px 15px}.clock{font-size:13px;padding:8px}.title{font-size:19px}th,td{padding:10px 12px}th:first-child,td:first-child{padding-left:16px}th:last-child,td:last-child{padding-right:16px}.foot{padding:11px 16px}.list{padding:0 7px 8px}.listRow{gap:10px}}

/* Keyboard visibility, touch access and user accessibility preferences. */
.srOnly{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}
button:focus-visible,[role="button"]:focus-visible,[tabindex="0"]:focus-visible,select:focus-visible,input:focus-visible{outline:3px solid var(--primary-color,#1767d2)!important;outline-offset:3px!important}
.fullscreenToggle,.mapControl,.mapPin,.quickFavorite,.quickReset{min-height:44px;min-width:44px}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;scroll-behavior:auto!important;transition-duration:.01ms!important}}
@media(forced-colors:active){button,[role="button"],.qualityPill,.pill,.mapPin{forced-color-adjust:auto;border:1px solid ButtonText}button:focus-visible,[role="button"]:focus-visible{outline:3px solid Highlight!important}}
`;
class StopDepartureDisplay extends HTMLElement {
  constructor(){
    super();this.attachShadow({mode:"open"});this._cfg={...DEFAULTS};
    this._sortOverride=null;this._quickLine="";this._quickDestination="";this._favoriteOnly=false;this._favoriteLines=new Set();this._favoritesLoadedKey="";this._openTrips=new Set();this._configSignature="";
    this._selectedTripKey=null;this._mapState=null;this._mapInstances=new Set();this._inlineMaps=new Map();this._tableObserver=null;
    this._fullscreenListener=()=>this._syncFullscreenButton();
    this._richSnapshots=new Map();this._richRequests=new Map();
    this._lastDataSignature=null;this._lastMinute=null;this._lastCivilDay=null;this._lastTimeZone=null;this._renderedRows=[];this._ticker=null;
  }
  connectedCallback(){
    document.addEventListener("fullscreenchange",this._fullscreenListener);
    if(!this._ticker)this._ticker=setInterval(()=>this._tick(),10000);
    this._tick();
  }
  disconnectedCallback(){
    document.removeEventListener("fullscreenchange",this._fullscreenListener);
    if(document.fullscreenElement===this)document.exitFullscreen?.().catch(()=>{});
    if(this._ticker){clearInterval(this._ticker);this._ticker=null;}
    this._disposeMap();
    this._tableObserver?.disconnect();this._tableObserver=null;
  }
  setConfig(config){
    if(!config||typeof config!=="object")throw new Error(STRINGS[this._hass?languageOf(this._hass):(String(navigator?.language||"en").toLowerCase().startsWith("de")?"de":"en")].invalidConfig);
    const next={...DEFAULTS,...config};delete next.show_sort;
    const signature=JSON.stringify(next);
    if(signature===this._configSignature)return;
    this._cfg=next;this._configSignature=signature;this._refreshRichData();this._draw();
  }
  _mergedState(){return mergedStopState(this._hass,this._cfg,this._richSnapshots);}
  _refreshRichData(){
    const hass=this._hass;
    if(!hass || typeof hass.callWS!=="function")return;
    const ids=selectedStopEntities(this._cfg);
    for(const id of this._richSnapshots.keys())if(!ids.includes(id))this._richSnapshots.delete(id);
    for(const id of this._richRequests.keys())if(!ids.includes(id))this._richRequests.delete(id);
    for(const id of ids){
      const revision=hass.states?.[id]?.attributes?.zeitpunkt_abfrage;
      if(!revision)continue;
      if(this._richSnapshots.get(id)?.revision===revision)continue;
      const prior=this._richRequests.get(id);
      if(prior?.revision===revision && (prior.pending || Date.now()-prior.started<60000))continue;
      const request={revision,started:Date.now(),pending:true};
      this._richRequests.set(id,request);
      Promise.resolve().then(()=>hass.callWS({type:"haltestellen_abfahrtsanzeige/get_departures",entity_id:id}))
        .then(result=>{
          if(!Array.isArray(result?.abfahrten)||!Array.isArray(result?.verkehrshinweise))return;
          // Ignore outdated replies if the coordinator advanced since the request.
          if(result.zeitpunkt_abfrage!==this._hass?.states?.[id]?.attributes?.zeitpunkt_abfrage)return;
          this._richSnapshots.set(id,{revision:result.zeitpunkt_abfrage,data:result});
          if(this.isConnected && selectedStopEntities(this._cfg).includes(id))this._draw();
        })
        .catch(()=>{ /* Keep the compact preview and retry after the cooldown. */ })
        .finally(()=>{if(this._richRequests.get(id)===request)request.pending=false;});
    }
  }
  set hass(value){
    const languageChanged=this._hass && languageOf(this._hass)!==languageOf(value);
    this._hass=value;
    const themeChanged=applyTransitTheme(this,value);
    this._refreshRichData();
    const state=this._mergedState();
    const signature=boardDataSignature(state);
    if(languageChanged||themeChanged||signature!==this._lastDataSignature||this._lastTimeZone!==timeZoneOf(value))this._draw();
    else {this._tick();this._syncUpdated(state);}
  }
  // Sections dashboards must not reserve a fixed number of rows for a
  // departure board: row count and expanded stop lists change dynamically.
  getGridOptions(){
    return {columns:"full",rows:"auto"};
  }
  // Masonry layouts still rely on getCardSize() to balance their columns.
  getCardSize(){
    const rendered=this.shadowRoot?.querySelector("ha-card")?.getBoundingClientRect().height;
    if(rendered && Number.isFinite(rendered))return Math.max(1,Math.ceil(rendered/50));
    const cfg=this._cfg;
    const shown=this._renderedRows?.length || Math.max(1,Number(cfg.max_rows)||15);
    const lineHeight=cfg.density==="compact"?46:cfg.density==="spacious"?79:63;
    const head=cfg.show_header===false?0:100;
    const foot=cfg.show_updated || (cfg.show_footer && cfg.footer_text)?45:0;
    const colHead=cfg.view==="table" || cfg.view==="monitor"?55:0;
    const height=cfg.view==="map"
      ? head+foot+(Number(cfg.map_height)||400)+220
      : head+foot+colHead+shown*lineHeight+30+this._openTrips.size*200;
    return Math.max(2,Math.ceil(height/50));
  }
  static getConfigElement(){return document.createElement(`${BOARD_TYPE}-editor`);}
  static getStubConfig(hass){
    const entity=Object.keys(hass?.states||{}).find(id=>id.startsWith("sensor.") && Array.isArray(hass.states[id]?.attributes?.abfahrten)) || "";
    const {type,...defaults}=DEFAULTS;return {...defaults,entity};
  }
  _syncFullscreenButton(){
    const button=this.shadowRoot?.querySelector(".fullscreenToggle");
    if(!button)return;
    const active=document.fullscreenElement===this;
    const w=words(this._hass);
    button.textContent=active?w.fullscreenExit:w.fullscreenEnter;
    button.setAttribute("aria-label",button.textContent);
    button.setAttribute("aria-pressed",String(active));
  }
  async _toggleFullscreen(){
    try{
      if(document.fullscreenElement===this)await document.exitFullscreen();
      else if(!document.fullscreenElement && typeof this.requestFullscreen==="function")await this.requestFullscreen();
    }catch(err){
      // Browsers may reject fullscreen (e.g. iframe permission or missing gesture).
      this._syncFullscreenButton();
    }
  }
  _favoritesKey(){return `${BOARD_TYPE}:favorite-lines:${selectedStopEntities(this._cfg).join(",")}`;}
  _loadFavorites(){
    const key=this._favoritesKey();if(this._favoritesLoadedKey===key)return;
    this._favoritesLoadedKey=key;this._favoriteLines=new Set();this._quickLine="";this._quickDestination="";this._favoriteOnly=false;
    try{const stored=JSON.parse(localStorage.getItem(key)||"[]");this._favoriteLines=new Set(filterValues(stored));}catch(_err){}
  }
  _saveFavorites(){try{localStorage.setItem(this._favoritesKey(),JSON.stringify([...this._favoriteLines]));}catch(_err){}}
  _quickFilterBar(card,sourceRows){
    if(this._cfg.show_quick_filters===false)return;
    const cfg=this._cfg;
    const lineEnabled=cfg.show_quick_filter_line!==false;
    const destEnabled=cfg.show_quick_filter_destination!==false;
    const favOnlyEnabled=cfg.show_quick_filter_favorites_only!==false;
    const favEditEnabled=cfg.show_quick_filter_favorites_edit!==false;
    if(!lineEnabled&&!destEnabled&&!favOnlyEnabled&&!favEditEnabled&&cfg.show_quick_filter_heading===false&&cfg.show_quick_filter_reset===false)return;
    const w=words(this._hass);
    const lines=[...new Set(sourceRows.map(departureLine).filter(Boolean))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
    const dests=[...new Set(sourceRows.filter(r=>!lineEnabled||!this._quickLine||departureLine(r)===this._quickLine).map(departureDestination).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
    const toolbar=node("section","quickFilters");toolbar.setAttribute("aria-label",w.quickFiltersAria);
    const head=node("div","quickFiltersHead");
    if(cfg.show_quick_filter_heading!==false)head.appendChild(node("strong","",w.quickFilters));
    const reset=node("button","quickReset",w.quickReset);reset.type="button";
    reset.dataset.focusKey="quick:reset";reset.addEventListener("click",()=>{this._quickLine="";this._quickDestination="";this._favoriteOnly=false;this._draw();});
    if(cfg.show_quick_filter_reset!==false)head.appendChild(reset);
    if(head.childNodes.length)toolbar.appendChild(head);
    const controls=node("div","quickControls");
    const makeSelect=(title,items,current,callback)=>{
      const label=node("label","quickSelectLabel");label.appendChild(node("span","",title));
      const select=node("select","quickSelect");select.dataset.focusKey=`quick:${title}`;select.setAttribute("aria-label",title);
      const all=node("option","",w.quickAll);all.value="";select.appendChild(all);
      for(const item of items){const option=node("option","",item);option.value=item;select.appendChild(option);}
      select.value=items.includes(current)?current:"";
      select.addEventListener("change",()=>callback(select.value));label.appendChild(select);controls.appendChild(label);
    };
    if(lineEnabled)makeSelect(w.quickLine,lines,this._quickLine,value=>{this._quickLine=value;this._quickDestination="";this._draw();});
    if(destEnabled)makeSelect(w.quickDestination,dests,this._quickDestination,value=>{this._quickDestination=value;this._draw();});
    const only=node("button","quickFavoriteOnly",w.quickFavoritesOnly);only.type="button";
    only.dataset.focusKey="quick:favorites";only.setAttribute("aria-pressed",String(this._favoriteOnly));only.addEventListener("click",()=>{this._favoriteOnly=!this._favoriteOnly;this._draw();});
    if(favOnlyEnabled)controls.appendChild(only);
    if(controls.childNodes.length)toolbar.appendChild(controls);
    if(favEditEnabled && lines.length){
      const favs=node("div","quickFavList");favs.appendChild(node("span","quickFavLabel",w.quickFavoriteLines));
      for(const line of lines){const active=this._favoriteLines.has(line),btn=node("button","quickFavButton",`${active?"★":"☆"} ${line}`);
        btn.type="button";btn.dataset.focusKey=`favorite:${line}`;btn.setAttribute("aria-pressed",String(active));btn.setAttribute("aria-label",formatMessage(w.quickFavoriteLine,{line}));
        btn.addEventListener("click",()=>{if(active)this._favoriteLines.delete(line);else this._favoriteLines.add(line);this._saveFavorites();this._draw();});favs.appendChild(btn);
      }toolbar.appendChild(favs);
    }
    card.appendChild(toolbar);
  }
  _sort(){
    const cfg=this._cfg;
    if(this._sortOverride)return this._sortOverride;
    try {
      const storeKey=`${BOARD_TYPE}:sort:${selectedStopEntities(cfg).join(",")}`;
      const saved=JSON.parse(localStorage.getItem(storeKey)||"null");
      if(saved && COLUMNS.some(([k])=>k===saved.by) && ["asc","desc"].includes(saved.direction))return saved;
    } catch (_err) { /* No storage in private browsing or tests */ }
    return {by:cfg.sort_by||"departure",direction:cfg.sort_direction||"asc"};
  }
  _styleForLine(row){
    const key=String(row?.linie||"Bus").trim()||"Bus";
    return this._lineStyles?.get(key)||{background:lineColor(key),text:"#ffffff"};
  }
  _syncTableOverflow(wrap){
    if(!wrap?.isConnected)return;
    // Fractional table sizing and expanded colspan cells can create a few
    // pixels of artificial overflow, even on full-width desktop dashboards.
    // Preserve true horizontal scrolling when visible columns need the room.
    const excess=Math.max(0,wrap.scrollWidth-wrap.clientWidth);
    wrap.classList.toggle("noHorizontalScroll",excess<=16);
    if(excess<=16 && wrap.scrollLeft)wrap.scrollLeft=0;
  }
  _changeSort(by,direction){
    this._sortOverride={by,direction};
    try{localStorage.setItem(`${BOARD_TYPE}:sort:${selectedStopEntities(this._cfg).join(",")}`,JSON.stringify(this._sortOverride));}catch(_err){}
    // Sorting is a presentation preference, not a change to the HA dashboard config.
    this._draw();
  }
  _addDayLabel(parent,time,locale,now=Date.now(),cls="departureDay") {
    if(this._cfg.show_day_labels===false)return;
    const label=departureDayLabel(time,now,this._hass,locale);
    if(label)parent.appendChild(node("span",cls,label));
  }
  _appendClock(parent,time,locale,now=Date.now(),cls="departTime") {
    const wrapper=node("span","timeWithDay");
    this._addDayLabel(wrapper,time,locale,now);
    wrapper.appendChild(node("span",cls,clockText(time,locale,timeZoneOf(this._hass))));
    parent.appendChild(wrapper);
    return wrapper;
  }
  _cell(key,row,cfg,w,locale,now){
    const td=node("td");this._value(td,key,row,cfg,w,locale,now);return td;
  }
  _value(container,key,row,cfg,w,locale,now){
    if(key==="stop")container.appendChild(node("span","stopName",row._stop_name||"–"));
    else if(key==="line"){
      const el=node("span","lineBadge",row.linie || "Bus");
      const style=this._styleForLine(row);
      el.style.background=cfg.show_line_colors ? style.background : "var(--secondary-text-color,#64748b)";
      el.style.color=cfg.show_line_colors ? style.text : "#ffffff";container.appendChild(el);
    } else if(key==="destination")container.appendChild(node("div","destination",row.ziel||row.richtung||"–"));
    else if(key==="departure"){
      this._appendClock(container,row.abfahrt,locale,now);
      if(cfg.show_scheduled && validTime(row.plan_abfahrt) && Date.parse(row.plan_abfahrt)!==Date.parse(row.abfahrt)){
        const plan=node("div","planTime");
        plan.appendChild(node("span","",`${w.planned}: `));
        this._addDayLabel(plan,row.plan_abfahrt,locale,now,"plannedDay");
        plan.appendChild(node("span","",clockText(row.plan_abfahrt,locale,timeZoneOf(this._hass))));
        container.appendChild(plan);
      }
    } else if(key==="countdown"){
      const remain=node("span","remaining",row.ausfall?"–":durationText(row.abfahrt,now,languageOf(this._hass)));
      if(!row.ausfall)remain.dataset.departure=row.abfahrt;
      container.appendChild(remain);
    }
    else if(key==="delay"){
      const d=row.verspaetung_minuten;
      container.appendChild(node("span",Number(d)>0?"delayLate":Number(d)<0?"delayEarly":"",delayText(d,w)));
    } else if(key==="platform")container.appendChild(node("span","",row.steig||"–"));
    else if(key==="operator")container.appendChild(node("span","",row.verkehrsunternehmen||"–"));
    else if(key==="status"){
      const stale=freshnessOf(this._mergedState()).stale;
      const quality=row.zeitqualitaet || (row.echtzeit?"realtime":"schedule");
      const status=row.ausfall?w.cancelled:stale?w.qualityStale:quality==="uncertain"?w.qualityUncertain:
        quality==="realtime"?w.realtime:w.planned;
      container.appendChild(node("span","pill "+(row.ausfall?"cancel":stale?"stale":quality==="realtime"?"live":""),status));
    }
  }
  _tripKey(row){
    return [row._stop_entity||"",row.fahrt_id||"",row.linie||"",row.ziel||"",row.plan_abfahrt||row.abfahrt||""].join("|");
  }
  _toggleTrip(row,control){
    const key=this._tripKey(row),opened=this._openTrips.has(key);
    if(opened)this._openTrips.delete(key);else this._openTrips.add(key);
    control.setAttribute("aria-expanded",opened?"false":"true");
    control.setAttribute("aria-label",`${row.linie||"Bus"} ${row.ziel||""}: ${opened?words(this._hass).detailsOpen:words(this._hass).detailsClose}`);
    const next=control.nextElementSibling;
    const isTable=control.tagName==="TR";
    const detailClass=isTable?"routeDetailRow":"listRouteDetails";
    if(next?.classList.contains(detailClass)){
      const map=this._inlineMaps.get(key);
      if(map){this._disposeMap(map);this._inlineMaps.delete(key);}
      next.remove();if(isTable)this._syncTableOverflow(this.shadowRoot?.querySelector(".tableWrap"));return;
    }
    if(opened)return;
    const w=words(this._hass),locale=this._hass?.locale?.language||this._hass?.language||"de-DE";
    const detail=isTable?node("tr",detailClass):node("div",detailClass);
    if(isTable){
      const cell=node("td","routeDetailCell");
      cell.colSpan=visibleColumns(this._cfg).filter(([key])=>key!=="stop"||selectedStopEntities(this._cfg).length>1).length;
      cell.appendChild(this._stopsView(row,w,locale));detail.appendChild(cell);
    } else detail.appendChild(this._stopsView(row,w,locale));
    control.insertAdjacentElement("afterend",detail);
    if(isTable){
      const width=this.shadowRoot?.querySelector(".tableWrap")?.clientWidth;
      if(width)detail.querySelector(".routeDetails").style.width=`${width}px`;
      this._syncTableOverflow(this.shadowRoot?.querySelector(".tableWrap"));
    }
  }
  _canExpand(){return this._cfg.show_route_details!==false;}
  _setupExpand(control,row,w){
    if(!this._canExpand())return;
    const expanded=this._openTrips.has(this._tripKey(row));
    control.classList.add("expandable");
    control.setAttribute("role","button");
    control.setAttribute("tabindex","0");
    control.setAttribute("aria-expanded",expanded?"true":"false");
    control.setAttribute("aria-label",`${row.linie||"Bus"} ${row.ziel||""}: ${expanded?w.detailsClose:w.detailsOpen}`);
    control.addEventListener("click",()=>this._toggleTrip(row,control));
    control.addEventListener("keydown",event=>{
      if(event.key==="Enter"||event.key===" "){
        event.preventDefault();this._toggleTrip(row,control);
      }
    });
  }
  _stopsView(row,w,locale){
    const wrap=node("div","routeDetails");
    const stops=Array.isArray(row.folgende_haltestellen)?row.folgende_haltestellen:[];
    if(!stops.length){
      wrap.appendChild(node("div","stopEmpty",w.followingUnavailable));
      return wrap;
    }
    const body=node("div",this._cfg.show_inline_map!==false?"routeDetailsBody":"routeDetailsBody noMap");
    const list=node("div","stopList");
    const stopItems=[];
    for(const [index,stop] of stops.entries()){
      if(!stop||typeof stop!=="object")continue;
      const item=node("div","stopItem inlineRouteStop"),dot=node("span","stopDot"),info=node("div","stopInfo");
      info.appendChild(node("div","stopName",stop.name||"–"));
      const meta=node("div","stopMeta");
      if(this._cfg.show_stop_cancellation!==false && stop.ausfall)meta.appendChild(node("span","stopLate",w.stopCancelled));
      if(this._cfg.show_stop_delays!==false && Number(stop.verspaetung_minuten)>0){
        meta.appendChild(node("span","stopLate",`+${stop.verspaetung_minuten} ${w.min}`));
      }
      if(this._cfg.show_stop_delays!==false && Number(stop.verspaetung_minuten)<0){
        meta.appendChild(node("span","",`${stop.verspaetung_minuten} ${w.min}`));
      }
      if(meta.childNodes.length)info.appendChild(meta);
      item.append(dot,info);
      if(this._cfg.show_stop_times!==false){
        const value=stop.ankunft||stop.abfahrt;
        if(validTime(value)){
          const when=node("div","stopWhen");
          this._appendClock(when,value,locale);
          item.appendChild(when);
        }
      }
      list.appendChild(item);
      stopItems.push({item,number:index+1});
    }
    if(this._cfg.show_inline_map!==false && this._cfg.view!=="map"){
      const attrs=this._mergedState()?.attributes||{};
      const points=this._mapStops(row,attrs);
      const wrapper=node("div","inlineRouteMap");
      if(points.length){
        const viewport=node("div","mapViewport");
        const requested=Number(this._cfg.inline_map_height);
        viewport.style.height=`${[240,300,400].includes(requested)?requested:300}px`;
        viewport.setAttribute("role","application");
        viewport.setAttribute("aria-label",w.mapAria);
        wrapper.append(viewport);
        const map=this._createTileMap(viewport,points,w,locale,true,row);
        this._inlineMaps.set(this._tripKey(row),map);
        if(this._cfg.show_inline_map_hover!==false){
          for(const {item,number} of stopItems){
            if(!points.some(stop=>stop.number===number))continue;
            const setHighlight=active=>{
              item.classList.toggle("hovered",active);
              map.highlightStop?.(active?number:null);
            };
            item.tabIndex=0;
            item.addEventListener("mouseenter",()=>setHighlight(true));
            item.addEventListener("mouseleave",()=>setHighlight(false));
            item.addEventListener("focus",()=>setHighlight(true));
            item.addEventListener("blur",()=>setHighlight(false));
            // Touch devices can highlight a stop without changing the overall map view.
            item.addEventListener("click",()=>setHighlight(true));
          }
        }
      } else if(this._cfg.show_map_diagnostics!==false)wrapper.append(node("div","mapNoCoords",w.mapNoGeo));
      body.append(wrapper);
    }
    if(this._cfg.show_detail_heading!==false)body.append(node("div","routeHeading",w.following));
    body.append(list);
    wrap.append(body);
    if(this._cfg.show_more_stops_notice!==false && Number(row.weitere_haltestellen)>0)wrap.appendChild(node("div","routeExtra",`${row.weitere_haltestellen} · ${w.moreFollowing}`));
    return wrap;
  }
  _mapStops(row, attrs) {
    // Coordinates come from the selected MOTIS StopTime and its following Place objects.
    const stops = [];
    const valid = (lat, lon) => Number.isFinite(Number(lat)) && Number.isFinite(Number(lon)) &&
      lat !== null && lon !== null && lat !== "" && lon !== "" &&
      Number(lat) >= -85.0511 && Number(lat) <= 85.0511 && Number(lon) >= -180 && Number(lon) <= 180;
    const initial = {
      name: attrs.haltestelle || attrs.station || words(this._hass).noStop,
      lat: row.start_lat ?? attrs.stop_lat,
      lon: row.start_lon ?? attrs.stop_lon,
      ankunft: row.abfahrt,
      ausfall: false,
      start: true
    };
    if (valid(initial.lat, initial.lon)) stops.push({...initial, lat:Number(initial.lat), lon:Number(initial.lon), number:0});
    for (const [i, stop] of (Array.isArray(row.folgende_haltestellen) ? row.folgende_haltestellen : []).entries()) {
      if (!stop || !valid(stop.lat, stop.lon)) continue;
      stops.push({...stop, lat:Number(stop.lat), lon:Number(stop.lon), number:i+1});
    }
    return stops;
  }
  _mapFocusPoint(stopIndex) {
    const map=this._mapState;
    const stop=map?.allStops.find(p=>p.number===stopIndex);
    if (!stop || !map) return;
    map.center={lat:stop.lat,lon:stop.lon};
    map.selectedStop=stop.number;
    map.render();
  }
  _disposeMap(target=null) {
    const maps=target?[target]:[...this._mapInstances];
    for(const map of maps){
      map.disposed=true;
      map.resizeObserver?.disconnect();
      if(map.tokenRefreshTimer)clearInterval(map.tokenRefreshTimer);
      this._mapInstances.delete(map);
      if(this._mapState===map)this._mapState=null;
    }
    if(!target)this._inlineMaps.clear();
  }
  _buildMapView(card,rows,attrs,w,locale,now) {
    const cfg=this._cfg;
    const container=node("div","mapMode");
    card.append(container);
    if (!rows.length) return;
    const options=rows.slice(0,Math.max(1,Math.min(16,Number(cfg.map_departures)||8)));
    if (!options.some(row=>this._tripKey(row)===this._selectedTripKey)) {
      const first=options.find(row=>!row.ausfall)||options[0];
      this._selectedTripKey=this._tripKey(first);
    }
    const label=node("div","mapSectionLabel",w.mapChoose);
    const chooser=node("div","mapDepartures");
    if(cfg.show_map_trip_selector!==false){
      if(cfg.show_map_trip_selector_heading!==false)container.append(label);
      container.append(chooser);
    }
    for (const row of options) {
      const active=this._tripKey(row)===this._selectedTripKey;
      const button=node("button",`mapTrip${active?" selected":""}${row.ausfall?" cancelled":""}`);
      button.type="button";
      button.setAttribute("aria-pressed",String(active));
      const day= this._cfg.show_day_labels!==false ? departureDayLabel(row.abfahrt,Date.now(),this._hass,locale) : "";
      button.setAttribute("aria-label",`${row.linie||"Bus"} ${row.ziel||""} ${day} ${clockText(row.abfahrt,locale,timeZoneOf(this._hass))}`.trim());
      const badge=node("span","mapTripLine",row.linie||"Bus");
      const color=this._styleForLine(row);
      badge.style.background=cfg.show_line_colors?color.background:"#64748b";
      badge.style.color=cfg.show_line_colors?color.text:"#fff";
      const info=node("span","mapTripInfo");
      if(cfg.show_destination!==false)info.append(node("span","mapTripDestination",row.ziel||"–"));
      if(cfg.show_stop!==false && row._stop_name)info.append(node("span","stopName",row._stop_name));
      if(cfg.show_departure!==false)this._appendClock(info,row.abfahrt,locale,Date.now(),"mapTripTime");
      if(cfg.show_countdown!==false){const remain=node("span","mapTripTime",row.ausfall?"–":durationText(row.abfahrt,Date.now(),languageOf(this._hass)));
        if(!row.ausfall)remain.dataset.departure=row.abfahrt;
        info.append(remain);
      }
      if(cfg.show_status!==false && row.ausfall)info.append(node("span","mapTripStatus",w.cancelled));
      if(cfg.show_day_labels!==false && day)info.append(node("span","mapTripDay",day));
      if(cfg.show_line!==false)button.append(badge);
      if(info.childNodes.length)button.append(info);
      button.addEventListener("click",()=>{
        if (this._selectedTripKey===this._tripKey(row)) return;
        this._selectedTripKey=this._tripKey(row);
        for (const b of chooser.querySelectorAll(".mapTrip")) {
          const chosen=b===button;b.classList.toggle("selected",chosen);b.setAttribute("aria-pressed",String(chosen));
        }
        this._renderMapTrip(content,row,row._stop_attrs||attrs,w,locale);
      });
      chooser.append(button);
    }
    const content=node("div","mapContent");container.append(content);
    this._renderMapTrip(content,options.find(r=>this._tripKey(r)===this._selectedTripKey)||options[0],(options.find(r=>this._tripKey(r)===this._selectedTripKey)||options[0])._stop_attrs||attrs,w,locale);
  }
  _renderMapTrip(container,row,attrs,w,locale) {
    this._disposeMap();
    container.replaceChildren();
    const header=node("div","mapJourney");
    const title=node("div","mapJourneyMain");
    const lineBadge=node("span","mapJourneyLine",row.linie||"Bus");
    const lineStyle=this._styleForLine(row);
    if(this._cfg.show_line_colors!==false){lineBadge.style.background=lineStyle.background;lineBadge.style.color=lineStyle.text;}
    if(this._cfg.show_line!==false)title.append(lineBadge);
    if(this._cfg.show_destination!==false)title.append(node("span","mapJourneyDest",row.ziel||"–"));
    if(this._cfg.show_stop!==false && row._stop_name)title.append(node("span","stopName",row._stop_name));
    const right=node("div","mapJourneyTime");
    if(this._cfg.show_departure!==false)this._appendClock(right,row.abfahrt,locale);
    if(this._cfg.show_countdown!==false){const remain=node("span","mapJourneyDelay",row.ausfall?"–":durationText(row.abfahrt,Date.now(),languageOf(this._hass)));
      if(!row.ausfall)remain.dataset.departure=row.abfahrt;
      right.append(remain);
    }
    if(this._cfg.show_platform!==false && row.steig)right.append(node("span","mapJourneyDelay",`${columnLabel(this._cfg,"platform",this._hass)} ${row.steig}`));
    if(this._cfg.show_operator!==false && row.verkehrsunternehmen)right.append(node("span","mapJourneyDelay",row.verkehrsunternehmen));
    if(this._cfg.show_scheduled!==false && this._cfg.show_departure!==false && validTime(row.plan_abfahrt) && Date.parse(row.plan_abfahrt)!==Date.parse(row.abfahrt))right.append(node("span","mapJourneyDelay",`${w.planned}: ${clockText(row.plan_abfahrt,locale,timeZoneOf(this._hass))}`));
    if (row.ausfall && this._cfg.show_status!==false) right.append(node("span","mapJourneyDelay delayLate",w.cancelled));
    else if (!row.ausfall && this._cfg.show_delay!==false) right.append(node("span","mapJourneyDelay",delayText(row.verspaetung_minuten,w)));
    if(title.childNodes.length)header.append(title);
    if(right.childNodes.length)header.append(right);
    if(this._cfg.show_map_journey!==false && header.childNodes.length)container.append(header);

    const allStops=Array.isArray(row.folgende_haltestellen)?row.folgende_haltestellen:[];
    const pins=this._mapStops(row,row._stop_attrs||attrs);
    let mapInstance=null;
    const mapWrapper=node("div","mapCanvasWrapper");
    if(this._cfg.show_map_canvas!==false)container.append(mapWrapper);
    if(this._cfg.show_map_canvas===false){
      // No map instance, but the optional timeline below can still be displayed.
    } else if (!pins.length) {
      if(this._cfg.show_map_diagnostics!==false)mapWrapper.append(node("div","mapNoCoords",w.mapNoGeo));
    } else {
      const viewport=node("div","mapViewport");
      viewport.style.height=`${[300,400,520].includes(Number(this._cfg.map_height))?Number(this._cfg.map_height):400}px`;
      viewport.setAttribute("role","application");
      viewport.setAttribute("aria-label",w.mapAria);
      mapWrapper.append(viewport);
      mapInstance=this._createTileMap(viewport,pins,w,locale,false,row);
      if(this._cfg.show_map_diagnostics!==false && pins.filter(stop=>!stop.start).length < allStops.length){
        mapWrapper.append(node("div","mapMissingCoords",w.mapMissingCoords));
      }
    }
    if (this._cfg.show_map_timeline!==false) {
      const section=node("section","mapTimeline");
      if(this._cfg.show_map_timeline_heading!==false)section.append(node("div","mapSectionLabel",w.mapFollowing));
      const list=node("div","mapStopList");
      const addItem=(stop,num,isStart=false)=>{
        const item=node("button","mapStopItem");item.type="button";
        item.setAttribute("aria-label",`${isStart?w.mapStart:`${num}.`} ${stop.name||"–"}`);
        item.append(node("span",`mapStopNumber${isStart?" start":""}`,isStart?"●":String(num)));
        const info=node("span","mapStopInfo");
        info.append(node("span","mapStopName",stop.name||"–"));
        if (this._cfg.show_stop_cancellation!==false && stop.ausfall) info.append(node("span","mapStopStatus",w.stopCancelled));
        if (this._cfg.show_stop_delays!==false && typeof stop.verspaetung_minuten==="number" && stop.verspaetung_minuten!==0) {
          info.append(node("span","mapStopStatus",delayText(stop.verspaetung_minuten,w)));
        }
        item.append(info);
        const clock=stop.ankunft||stop.abfahrt;
        if (this._cfg.show_stop_times!==false && validTime(clock)){
          const stopClock=node("span","mapStopClock");
          this._appendClock(stopClock,clock,locale,Date.now(),"mapClockTime");
          item.append(stopClock);
        }
        const stopNumber=isStart?0:num;
        if (mapInstance && this._cfg.show_inline_map_hover!==false && pins.some(stop=>stop.number===stopNumber)) {
          const highlight=active=>{
            item.classList.toggle("hovered",active);
            mapInstance.highlightStop?.(active?stopNumber:null);
          };
          item.addEventListener("mouseenter",()=>highlight(true));
          item.addEventListener("mouseleave",()=>highlight(false));
          item.addEventListener("focus",()=>highlight(true));
          item.addEventListener("blur",()=>highlight(false));
        }
        item.addEventListener("click",()=>this._mapFocusPoint(stopNumber));
        list.append(item);
      };
      addItem({name:attrs.haltestelle||attrs.station||w.noStop,ankunft:row.abfahrt},0,true);
      allStops.forEach((stop,i)=>{if(stop?.name)addItem(stop,i+1);});
      section.append(list);
      if(this._cfg.show_more_stops_notice!==false && Number(row.weitere_haltestellen)>0)section.append(node("div","mapExtra",`${row.weitere_haltestellen} · ${w.moreFollowing}`));
      container.append(section);
    }
  }
  _createTileMap(viewport,points,w,locale,inline=false,row=null) {
    // Lightweight slippy map. Image tiles are served by Home Assistant's built-in
    // map_tiles proxy, which identifies requests upstream and caches responses.
    const TILE=256;
    const project=(lat,lon,z)=>{
      const r=Math.PI/180,scale=TILE*Math.pow(2,z),clamped=Math.max(-85.05112878,Math.min(85.05112878,lat));
      return {x:(lon+180)/360*scale,y:(1-Math.asinh(Math.tan(clamped*r))/Math.PI)/2*scale};
    };
    const unproject=(x,y,z)=>{
      const scale=TILE*Math.pow(2,z);
      return {lat:Math.atan(Math.sinh(Math.PI*(1-2*y/scale)))*180/Math.PI,lon:x/scale*360-180};
    };
    const tiles=node("div","mapTiles"), pins=node("div","mapPins");
    const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
    svg.classList.add("mapLines");svg.setAttribute("aria-hidden","true");
    const notice=node("div","mapLegend",w.mapStraightLine);
    const attributions=node("div","mapAttribution");
    const credit=node("a","","© OpenStreetMap contributors");
    credit.href="https://www.openstreetmap.org/copyright";
    credit.target="_blank";credit.rel="noopener noreferrer";attributions.append(credit);
    const controls=node("div","mapControls");
    const tileFallback=node("div","mapTileFailed");tileFallback.hidden=true;
    tileFallback.append(node("span","",w.mapTilesUnavailable));
    viewport.append(tiles,svg,pins,attributions);
    if(this._cfg.show_map_diagnostics!==false)viewport.append(tileFallback);
    if (this._cfg.show_map_controls!==false)viewport.append(controls);
    if (this._cfg.show_map_legend!==false && this._cfg.show_map_line!==false && points.length>1)viewport.append(notice);
    const popup=node("div","mapPopup");popup.hidden=true;viewport.append(popup);
    const map={center:{lat:points[0].lat,lon:points[0].lon},zoom:14, allStops:points,
      selectedStop:null,highlightedStop:null,routeShape:null,render:null,reset:null,tileToken:null,
      tokenLoading:false,tokenRefreshTimer:null,lastTileRetry:0,disposed:false};
    const updateTileFallback=()=>{
      if(map.disposed)return;
      const current=[...tiles.querySelectorAll("img.mapTile")];
      tileFallback.hidden=!!map.tileToken &&
        !(current.length && current.every(img=>img.dataset.failed==="true"));
    };
    this._mapInstances.add(map);
    if(!inline)this._mapState=map;
    const loadAccessToken=(force=false)=>{
      if (map.disposed || map.tokenLoading) return;
      map.tokenLoading=true;
      localMapTilesToken(this._hass, force).then(token=>{
        if (map.disposed) return;
        map.tokenLoading=false;
        if (token) {
          map.tileToken=token;
          // Retry only failed tiles; successfully loaded tiles stay in the browser cache.
          for (const img of tiles.querySelectorAll('img.mapTile[data-failed="true"]')) img.remove();
          map.render?.();
        } else {
          updateTileFallback();
        }
      });
    };
    // A websocket map token rotates on the HA server; renew proactively while
    // keeping the already rendered tiles, so an open dashboard stays usable.
    map.tokenRefreshTimer=setInterval(()=>loadAccessToken(),MAP_TILE_TOKEN_MAX_AGE);
    const fit=()=>{
      const width=viewport.clientWidth||600,height=viewport.clientHeight||400;
      if (points.length===1){map.zoom=15;map.center={lat:points[0].lat,lon:points[0].lon};map.render();return;}
      const fitPoints=map.routeShape?.length?points.concat(map.routeShape):points;
      const p=fitPoints.map(s=>project(s.lat,s.lon,0));
      const minX=Math.min(...p.map(v=>v.x)),maxX=Math.max(...p.map(v=>v.x));
      const minY=Math.min(...p.map(v=>v.y)),maxY=Math.max(...p.map(v=>v.y));
      const dx=Math.max(.000001,maxX-minX),dy=Math.max(.000001,maxY-minY);
      const z=Math.floor(Math.min(Math.log2(Math.max(1,width-110)/dx),Math.log2(Math.max(1,height-115)/dy)));
      map.zoom=Math.max(3,Math.min(17,z));
      map.center=unproject((minX+maxX)*.5*Math.pow(2,map.zoom),(minY+maxY)*.5*Math.pow(2,map.zoom),map.zoom);
      map.selectedStop=null;map.render();
    };
    const openPopup=(stop,screenX,screenY)=>{
      popup.replaceChildren();
      popup.append(node("div","mapPopupName",stop.name||"–"));
      const time=stop.ankunft||stop.abfahrt;
      if (validTime(time)){
        const popupTime=node("div","mapPopupTime");
        this._appendClock(popupTime,time,locale);
        popup.append(popupTime);
      }
      if(this._cfg.show_stop_cancellation!==false && stop.ausfall)popup.append(node("div","mapPopupLate",w.stopCancelled));
      else if (typeof stop.verspaetung_minuten==="number" && stop.verspaetung_minuten!==0)popup.append(node("div","mapPopupLate",delayText(stop.verspaetung_minuten,w)));
      popup.hidden=false;
      popup.style.left=`${Math.max(90,Math.min((viewport.clientWidth||600)-90,screenX))}px`;
      popup.style.top=`${Math.max(60,Math.min((viewport.clientHeight||400)-18,screenY-18))}px`;
    };
    const render=()=>{
      if (map.disposed) return;
      const width=viewport.clientWidth||600,height=viewport.clientHeight||400;
      const world=Math.pow(2,map.zoom),center=project(map.center.lat,map.center.lon,map.zoom);
      const left=center.x-width/2,top=center.y-height/2;
      const startX=Math.floor(left/TILE),endX=Math.floor((left+width-1)/TILE);
      const startY=Math.floor(top/TILE),endY=Math.floor((top+height-1)/TILE);
      const old=new Map([...tiles.children].map(el=>[el.dataset.tileId,el]));
      const needed=new Set();
      if (map.tileToken) for(let x=startX;x<=endX;x++)for(let y=startY;y<=endY;y++){
        if(y<0||y>=world)continue;
        const wrapped=((x%world)+world)%world,key=`${map.zoom}/${wrapped}/${y}`;
        needed.add(key);
        let img=old.get(key);
        if(!img){img=node("img","mapTile");img.dataset.tileId=key;img.alt="";
          img.decoding="async";img.draggable=false;
          img.referrerPolicy="same-origin";
          img.addEventListener("load",()=>{img.dataset.failed="false";updateTileFallback();});
          img.addEventListener("error",()=>{
            img.dataset.failed="true";img.style.display="none";updateTileFallback();
            // Token expiry or a transient failed proxy request. Do not hammer
            // either Home Assistant or the upstream tile service on errors.
            if(Date.now()-map.lastTileRetry>90000){
              map.lastTileRetry=Date.now();
              loadAccessToken(true);
            }
          });
          img.src=`/api/map_tiles/raster/${key}.png?token=${encodeURIComponent(map.tileToken)}`;
          tiles.append(img);
        }
        img.style.left=`${Math.round(x*TILE-left)}px`;
        img.style.top=`${Math.round(y*TILE-top)}px`;
      }
      for(const [key,img] of old)if(!needed.has(key))img.remove();
      updateTileFallback();
      svg.setAttribute("viewBox",`0 0 ${width} ${height}`);
      svg.replaceChildren();
      if(this._cfg.show_map_line!==false && points.length>1){
        const path=document.createElementNS("http://www.w3.org/2000/svg","polyline");
        const route=map.routeShape?.length?map.routeShape:points;
        path.setAttribute("points",route.map(p=>{const q=project(p.lat,p.lon,map.zoom);return `${q.x-left},${q.y-top}`;}).join(" "));
        path.setAttribute("fill","none");path.setAttribute("stroke","#2563eb");path.setAttribute("stroke-width","3.5");
        if(!map.routeShape?.length)path.setAttribute("stroke-dasharray","7 7");
        path.setAttribute("stroke-linejoin","round");path.setAttribute("stroke-linecap","round");
        svg.append(path);
      }
      pins.replaceChildren();
      for (const stop of points) {
        const q=project(stop.lat,stop.lon,map.zoom),x=q.x-left,y=q.y-top;
        if(x<-40||y<-40||x>width+40||y>height+40)continue;
        const mark=node("button",`mapPin${stop.start?" origin":""}${stop.number===map.selectedStop?" focused":""}${stop.number===map.highlightedStop?" highlighted":""}`,stop.start?"●":String(stop.number));
        mark.type="button";mark.dataset.stopNumber=String(stop.number);mark.style.left=`${x}px`;mark.style.top=`${y}px`;
        mark.setAttribute("aria-label",`${stop.start?w.mapStart:`${stop.number}.`} ${stop.name}`);
        mark.addEventListener("click",event=>{event.stopPropagation();map.selectedStop=stop.number;openPopup(stop,x,y);});
        pins.append(mark);
        if(stop.number===map.selectedStop)openPopup(stop,x,y);
      }
      if(map.selectedStop==null)popup.hidden=true;
    };
    map.render=render;map.reset=fit;
    map.highlightStop=number=>{
      if(map.disposed)return;
      map.highlightedStop=number;
      for(const pin of pins.querySelectorAll(".mapPin")){
        pin.classList.toggle("highlighted",number!==null && Number(pin.dataset.stopNumber)===number);
      }
    };
    const addButton=(txt,description,handler)=>{
      const button=node("button","mapControl",txt);button.type="button";button.title=description;button.setAttribute("aria-label",description);
      button.addEventListener("click",e=>{e.stopPropagation();handler();});controls.append(button);
    };
    const changeZoom=(increment)=>{
      const next=Math.min(18,Math.max(3,map.zoom+increment));
      if(next!==map.zoom){map.zoom=next;map.selectedStop=null;render();}
    };
    addButton("+",w.mapZoomIn,()=>changeZoom(1));
    addButton("−",w.mapZoomOut,()=>changeZoom(-1));
    addButton("⌖",w.mapFit,fit);
    let drag=null;
    viewport.addEventListener("pointerdown",e=>{
      if(e.button!==0 || e.target.closest("button,a"))return;
      drag={x:e.clientX,y:e.clientY,center:project(map.center.lat,map.center.lon,map.zoom)};
      viewport.setPointerCapture?.(e.pointerId);
      popup.hidden=true;map.selectedStop=null;
    });
    viewport.addEventListener("pointermove",e=>{
      if(!drag)return;
      const p=unproject(drag.center.x-(e.clientX-drag.x),drag.center.y-(e.clientY-drag.y),map.zoom);
      map.center={lat:Math.max(-85.0511,Math.min(85.0511,p.lat)),lon:Math.max(-179.9,Math.min(179.9,p.lon))};
      render();
    });
    const finish=()=>{drag=null;};
    viewport.addEventListener("pointerup",finish);
    viewport.addEventListener("pointercancel",finish);
    viewport.addEventListener("lostpointercapture",finish);
    viewport.addEventListener("click",e=>{if(e.target===viewport || e.target.classList.contains("mapTile"))popup.hidden=true;});
    // The map is not redrawn for unrelated Home Assistant state changes.
    if(typeof ResizeObserver!=="undefined"){
      map.resizeObserver=new ResizeObserver(()=>{
        if(!map.disposed && viewport.isConnected){
          if(!map.initialFit){map.initialFit=true;fit();}
          else render();
        }
      });
      map.resizeObserver.observe(viewport);
    }
    fit();
    // Acquire the token asynchronously after the map and route markers exist.
    // Until then the schematic background remains usable.
    loadAccessToken();
    if (this._cfg.show_map_line!==false && this._cfg.show_actual_route!==false && row?.fahrt_id) {
      tripGeometryFor(this._hass,row.fahrt_id).then(geometry=>{
        if(map.disposed || !geometry.length)return;
        map.routeShape=geometry;
        notice.textContent=w.mapActualRoute;
        fit();
      });
    }
    return map;
  }
  _syncDataQuality(now=Date.now()) {
    const indicator=this.shadowRoot?.querySelector(".dataQuality");
    if(!indicator)return;
    const state=this._mergedState(), w=words(this._hass);
    const fresh=freshnessOf(state,now);
    const rows=this._renderedRows||[];
    const isStale=fresh.stale;
    const showWarning=this._cfg.show_stale_warning!==false;
    const qualityText=this._cfg.show_data_quality!==false?qualityLabel(rows,w):"";
    const headline=isStale && showWarning
      ? (fresh.failed?w.qualityOffline:w.qualityStale)
      : qualityText;
    const age=isStale && showWarning && fresh.age!==null
      ? w.qualityAge.replace("{minutes}",String(Math.floor(fresh.age))) : "";
    const visible=!!headline;
    indicator.hidden=!visible;
    indicator.classList.toggle("stale",isStale && showWarning);
    indicator.classList.toggle("scheduled",!isStale && qualityText===w.scheduleOnly);
    const signature=`${headline}|${age}|${isStale}`;
    if(indicator.dataset.value===signature)return;
    indicator.replaceChildren();
    if(headline){
      const pill=node("span","qualityPill");pill.append(node("span","qualityDot"),node("span","",headline));
      indicator.append(pill);
    }
    if(age)indicator.append(node("span","qualityAge",age));
    indicator.dataset.value=signature;
  }
  _syncUpdated(state){
    const target=this.shadowRoot?.querySelector(".footerMeta");
    if(!target)return;
    const w=words(this._hass),locale=this._hass?.locale?.language||this._hass?.language||"de-DE";
    const stamp=state?.attributes?.zeitpunkt_abfrage;
    const updated=this._cfg.show_updated && validTime(stamp) ? `${w.updated}: ${clockText(stamp,locale,timeZoneOf(this._hass))}` : "";
    const signature=`${languageOf(this._hass)}|${updated}`;
    if(target.dataset.value===signature)return;
    target.replaceChildren();
    if(updated)target.append(node("span","",updated));
    target.dataset.value=signature;
  }
  _tick(){
    this._refreshRichData();
    if(!this._hass||!this.shadowRoot||!this.shadowRoot.firstChild)return;
    const now=Date.now(),minute=Math.floor(now/60000);
    // Rebuild date labels when local midnight is crossed even without new API data.
    if(this._lastCivilDay!==null && this._lastCivilDay!==civilDayIndex(now,timeZoneOf(this._hass))){
      this._draw();return;
    }
    if(this._renderedRows.some(row=>validTime(row.abfahrt) && Date.parse(row.abfahrt)<now-30000)){
      this._draw();return;
    }
    if(freshnessOf(this._mergedState(),now).stale!==this._qualityWasStale){
      this._draw();return;
    }
    if(minute===this._lastMinute)return;
    this._lastMinute=minute;
    this._syncDataQuality(now);
    const locale=this._hass?.locale?.language||this._hass?.language||"de-DE";
    const clock=this.shadowRoot.querySelector(".clockTime");
    if(clock)clock.textContent=new Intl.DateTimeFormat(locale,{hour:"2-digit",minute:"2-digit",timeZone:timeZoneOf(this._hass)}).format(now);
    const lang=languageOf(this._hass);
    for(const item of this.shadowRoot.querySelectorAll("[data-departure]")){
      const newText=durationText(item.dataset.departure,now,lang);
      if(item.textContent!==newText)item.textContent=newText;
    }
  }
  _draw(){
    if(!this._hass||!this.shadowRoot)return;
    // Preserve keyboard focus across live data and filter-driven redraws.
    const focused=this.shadowRoot.activeElement;
    const focusKey=focused?.dataset?.focusKey||null;
    const focusSelection=focused?.tagName==="SELECT"?focused.value:null;
    const hass=this._hass,cfg=this._cfg,w=words(hass),locale=hass?.locale?.language||hass?.language||"de-DE";
    const now=Date.now(),state=this._mergedState(),attrs=state?.attributes||{};
    this._lineStyles=lineColorStyles(Array.isArray(attrs.abfahrten)?attrs.abfahrten:[]);
    this._loadFavorites();
    const sourceRows=getRows(state,cfg,now);
    const quick=cfg.show_quick_filters!==false;
    const all=sourceRows.filter(r=>(!quick||cfg.show_quick_filter_line===false||!this._quickLine||departureLine(r)===this._quickLine)
      &&(!quick||cfg.show_quick_filter_destination===false||!this._quickDestination||departureDestination(r)===this._quickDestination)
      &&(!quick||cfg.show_quick_filter_favorites_only===false||!this._favoriteOnly||this._favoriteLines.has(departureLine(r))));
    const sort=this._sort();
    const filterActive=filterValues(cfg.filter_lines).length>0 || filterValues(cfg.filter_destinations).length>0 ||
      (quick && ((cfg.show_quick_filter_line!==false && !!this._quickLine) ||
        (cfg.show_quick_filter_destination!==false && !!this._quickDestination) ||
        (cfg.show_quick_filter_favorites_only!==false && this._favoriteOnly)));
    const limit=Math.min(80,Math.max(1,Number(cfg.max_rows)||15));
    // The display shows the next N chronological departures. Sorting changes
    // only the order within this fixed set and never pulls later trips into view.
    const upcoming=all.slice().sort((a,b)=>Date.parse(a.abfahrt)-Date.parse(b.abfahrt)).slice(0,limit);
    const rows=sortRows(upcoming,sort.by,sort.direction,now);
    this._lastDataSignature=boardDataSignature(state);
    this._lastMinute=Math.floor(now/60000);
    this._lastTimeZone=timeZoneOf(hass);
    this._lastCivilDay=civilDayIndex(now,this._lastTimeZone);
    this._renderedRows=rows;
    this._qualityWasStale=freshnessOf(state,now).stale;
    const root=this.shadowRoot;
    const oldScroll=root.querySelector(".tableWrap")?.scrollLeft||0;
    this._disposeMap();
    this._tableObserver?.disconnect();this._tableObserver=null;
    root.replaceChildren();
    const style=node("style");style.textContent=THEME_CSS+BOARD_CSS;root.appendChild(style);
    const card=node("ha-card",`${cfg.density}${cfg.view==="monitor" || cfg.kiosk_mode?" monitor":""}${cfg.kiosk_mode?" kiosk":""}`);root.appendChild(card);
    card.setAttribute("role","region");
    card.setAttribute("aria-label",cfg.title||attrs.haltestelle||attrs.friendly_name||w.noStop);
    if(cfg.show_fullscreen_button!==false){
      const actionBar=node("div","screenActions");
      const fullscreen=node("button","fullscreenToggle");fullscreen.type="button";
      fullscreen.dataset.focusKey="fullscreen";fullscreen.addEventListener("click",()=>this._toggleFullscreen());
      actionBar.append(fullscreen);card.append(actionBar);this._syncFullscreenButton();
    }
    if(cfg.show_header){
      const hero=node("div","hero"),copy=node("div","heroCopy");
      if(cfg.show_eyebrow!==false && cfg.heading_text!=="-")copy.appendChild(node("div","eyebrow",cfg.heading_text||w.heading));
      copy.appendChild(node("div","title",cfg.title||attrs.haltestelle||attrs.friendly_name||w.noStop));
      if(cfg.show_subtitle && cfg.subtitle)copy.appendChild(node("div","subtitle",cfg.subtitle));
      hero.appendChild(copy);
      if(cfg.show_clock){const clock=node("div","clock");clock.appendChild(node("span","clockDot"));clock.appendChild(node("span","clockTime",new Intl.DateTimeFormat(locale,{hour:"2-digit",minute:"2-digit",timeZone:timeZoneOf(hass)}).format(now)));hero.appendChild(clock);}
      card.appendChild(hero);
    }
    this._quickFilterBar(card,sourceRows);
    if(cfg.show_disruptions!==false && Array.isArray(attrs.verkehrshinweise) && attrs.verkehrshinweise.length){
      const section=node("section","disruptionPanel"),header=node("div","disruptionHeader");
      const notices=attrs.verkehrshinweise.filter(n=>n&&(
        typeof n.titel==="string"&&n.titel.trim() || n.quelle==="stoptimes" && n.linie)).slice(0,20);
      if(notices.length){
        if(cfg.show_disruption_heading!==false)header.append(node("span","disruptionSymbol","!"),node("strong","",w.disruptionsTitle));
        if(cfg.show_disruption_count!==false)header.append(node("span","disruptionCount",`${notices.length} ${w.disruptionsCount}`));
        if(header.childNodes.length)section.append(header);
        if(cfg.show_disruption_stale_note!==false && freshnessOf(state,now).stale)section.append(node("div","disruptionStale",w.disruptionsOld));
        const list=node("div","disruptionList");
        for(const n of notices){
          const item=node("div",`disruptionItem ${n.typ==="ausfall"?"disruptionCancelled":n.typ==="verspaetung"?"disruptionDelay":"disruptionNotice"}`);
          const notice=localizedNotice(n,hass);
          item.append(node("div","disruptionTitle",notice.title));
          if(cfg.show_disruption_descriptions!==false && notice.description)item.append(node("div","disruptionText",notice.description));
          list.append(item);
        }
        section.append(list);card.append(section);
      }
    }
    if(cfg.show_data_quality!==false || cfg.show_stale_warning!==false){
      const indicator=node("div","dataQuality");card.appendChild(indicator);
      this._syncDataQuality(now);
    }
    const columns=visibleColumns(cfg);
    if(!state || state.state==="unavailable" || state.state==="unknown" && !rows.length || !rows.length){
      if(cfg.show_empty_state!==false)card.appendChild(node("div","empty",!state?w.missing:state.state==="unavailable"?w.unavailable:filterActive?w.filterEmpty:cfg.empty_text||w.empty));
    } else if(cfg.view==="map"){
      this._buildMapView(card,rows,attrs,w,locale,now);
    } else if(cfg.view==="list"){
      const list=node("div","list");
      for(const row of rows){
        const item=node("div","listRow"+(row.ausfall?" cancelled":""));
        if(cfg.show_line){const ln=node("div");this._value(ln,"line",row,cfg,w,locale,now);item.appendChild(ln);}
        const core=node("div","listCore");
        if(cfg.show_destination)core.appendChild(node("div","listDest",row.ziel||row.richtung||"–"));

        const meta=node("div","listMeta");
        if(cfg.show_platform && row.steig)meta.appendChild(node("span","",`${columnLabel(cfg,"platform",hass)} ${row.steig}`));
        if(cfg.show_stop!==false && selectedStopEntities(cfg).length>1)meta.appendChild(node("span","stopName",row._stop_name||""));
        if(cfg.show_delay)meta.appendChild(node("span",Number(row.verspaetung_minuten)>0?"delayLate":"",typeof row.verspaetung_minuten!=="number"?"":delayText(row.verspaetung_minuten,w)));
        if(cfg.show_status){
          const stale=freshnessOf(state,now).stale;
          meta.appendChild(node("span","",row.ausfall?w.cancelled:stale?w.qualityStale:
            row.zeitqualitaet==="uncertain"?w.qualityUncertain:row.echtzeit?w.realtime:w.planned));
        }
        if(cfg.show_operator && row.verkehrsunternehmen)meta.appendChild(node("span","",row.verkehrsunternehmen));
        if(meta.children.length)core.appendChild(meta);
        item.appendChild(core);
        if(cfg.show_departure || cfg.show_countdown){const side=node("div","listTime");
          if(cfg.show_departure)this._appendClock(side,row.abfahrt,locale,now,"listDepartureTime");
          if(cfg.show_countdown){const remain=node("div","listRemaining",row.ausfall?"–":durationText(row.abfahrt,now,languageOf(hass)));
            if(!row.ausfall)remain.dataset.departure=row.abfahrt;
            side.appendChild(remain);
          }
          if(cfg.show_scheduled && cfg.show_departure && validTime(row.plan_abfahrt) && Date.parse(row.plan_abfahrt)!==Date.parse(row.abfahrt)){
            const planned=node("div","planTime");
            planned.appendChild(node("span","",`${w.planned}: `));
            this._addDayLabel(planned,row.plan_abfahrt,locale,now,"plannedDay");
            planned.appendChild(node("span","",clockText(row.plan_abfahrt,locale,timeZoneOf(this._hass))));
            side.appendChild(planned);
          }
          item.appendChild(side);
        }
        this._setupExpand(item,row,w);
        list.appendChild(item);
        if(this._canExpand() && this._openTrips.has(this._tripKey(row))){
          const detail=node("div","listRouteDetails");detail.appendChild(this._stopsView(row,w,locale));list.appendChild(detail);
        }
      }
      card.appendChild(list);
    }else{
      const wrap=node("div","tableWrap"),table=node("table"),thead=node("thead"),thr=node("tr");
      const caption=node("caption","srOnly",w.tableCaption);table.appendChild(caption);
      for(const [key] of columns.filter(([key])=>key!=="stop"||selectedStopEntities(cfg).length>1)){
        const th=node("th",sort.by===key?"sorted":""),button=node("button","",columnLabel(cfg,key,hass));
        if(cfg.show_table_sort!==false){
          if(sort.by===key){th.setAttribute("aria-sort",sort.direction==="desc"?"descending":"ascending");button.appendChild(node("span","sortArrow",sort.direction==="desc"?"↓":"↑"));}
          button.type="button";button.dataset.focusKey=`sort:${key}`;
          button.setAttribute("aria-label",`${columnLabel(cfg,key,hass)}: ${w.sortDepartures}`);
          button.addEventListener("click",()=>this._changeSort(key,key===sort.by && sort.direction==="asc"?"desc":"asc"));
          th.appendChild(button);
        }else th.appendChild(node("span","",columnLabel(cfg,key,hass)));
        thr.appendChild(th);
      }
      if(cfg.show_table_header!==false){thead.appendChild(thr);table.appendChild(thead);}
      const tbody=node("tbody");
      for(const row of rows){
        const tr=node("tr",row.ausfall?"cancelled":"");
        for(const [key] of columns.filter(([key])=>key!=="stop"||selectedStopEntities(cfg).length>1)){
          const cell=this._cell(key,row,cfg,w,locale,now);
          tr.appendChild(cell);
        }
        this._setupExpand(tr,row,w);
        tbody.appendChild(tr);
        if(this._canExpand() && this._openTrips.has(this._tripKey(row))){
          const detailRow=node("tr","routeDetailRow"),td=node("td","routeDetailCell");
          td.colSpan=columns.filter(([key])=>key!=="stop"||selectedStopEntities(cfg).length>1).length;td.appendChild(this._stopsView(row,w,locale));
          detailRow.appendChild(td);tbody.appendChild(detailRow);
        }
      }
      table.appendChild(tbody);wrap.appendChild(table);card.appendChild(wrap);wrap.scrollLeft=oldScroll;
      // Table columns may scroll horizontally on narrow HA tiles. Expanded route
      // details and their maps must use the *visible tile width*, not the table's
      // potentially much wider intrinsic width.
      const fitDetails=()=>{
        const width=wrap.clientWidth;
        if(width)for(const detail of wrap.querySelectorAll(".routeDetails"))detail.style.width=`${width}px`;
        this._syncTableOverflow(wrap);
      };
      fitDetails();
      if(typeof ResizeObserver!=="undefined"){
        this._tableObserver=new ResizeObserver(fitDetails);
        this._tableObserver.observe(wrap);
      }
    }
    // Optional footer: custom text and last update only.
    if ((cfg.show_footer && cfg.footer_text) || cfg.show_updated) {
      const foot=node("div","foot");
      if(cfg.show_footer && cfg.footer_text)foot.appendChild(node("span","",cfg.footer_text));
      foot.appendChild(node("span","footerMeta"));card.appendChild(foot);
      this._syncUpdated(state);
    }
    if(focusKey){
      const match=Array.from(root.querySelectorAll("[data-focus-key]")).find(el=>el.dataset.focusKey===focusKey);
      if(match){match.focus({preventScroll:true});if(focusSelection!==null && match.tagName==="SELECT")match.value=focusSelection;}
    }
  }
}
// User-specific favorites are stored in the browser and do not modify the dashboard configuration.
const EDITOR_CSS = `

/* Compact, searchable single multi-stop control. */
.stopPicker{display:grid;gap:9px;min-width:0}
.stopPickerToggle{display:flex;align-items:center;justify-content:space-between;gap:10px;
  width:100%;min-height:48px;text-align:left;padding:11px 14px;border-radius:11px;
  background:var(--card-background-color);color:var(--primary-text-color);
  border:1px solid var(--divider-color);font:inherit;font-size:13px;cursor:pointer}
.stopPickerToggle:hover{border-color:var(--primary-color)}
.stopPickerChevron{color:var(--secondary-text-color);font-size:16px}
.stopSelectedTags{display:flex;flex-wrap:wrap;gap:6px}
.stopSelectedTag{max-width:100%;padding:5px 9px;border-radius:7px;
  color:var(--primary-text-color);background:var(--secondary-background-color);
  border:1px solid var(--divider-color);font-size:12px;overflow-wrap:anywhere}
.stopPickerMenu{display:grid;gap:9px;border:1px solid var(--divider-color);border-radius:12px;
  background:var(--card-background-color);padding:11px;box-shadow:0 7px 21px #00000010}
.stopPickerMenu .stopMultiSelector{display:grid;grid-template-columns:1fr;max-height:255px;
  overflow-y:auto;gap:5px;margin:0;padding:1px}
.stopPickerMenu .multiStopItem{display:flex;min-height:46px;gap:10px;padding:10px 12px;
  border:1px solid var(--divider-color);border-radius:9px;
  background:var(--secondary-background-color);color:var(--primary-text-color)}
.stopPickerMenu .multiStopItem:has(input:checked){border-color:var(--primary-color);
  background:color-mix(in srgb,var(--primary-color) 9%,var(--card-background-color))}
.stopPickerMenu .multiStopItem input{width:19px;height:19px;flex:none;accent-color:var(--primary-color)}
.stopPickerTools{display:flex;justify-content:flex-end}
.stopClear{border:1px solid var(--divider-color);border-radius:8px;min-height:38px;padding:7px 12px;
  background:var(--secondary-background-color);color:var(--primary-text-color);font:inherit;cursor:pointer}
.stopPickerEmpty{padding:10px;font-size:12px;color:var(--secondary-text-color)}
.stopPicker button:focus-visible,.stopPicker input:focus-visible{outline:3px solid var(--primary-color);outline-offset:2px}

.stopMultiSelector{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:8px;margin-top:12px}.multiStopItem{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--divider-color,#ddd);border-radius:10px;cursor:pointer}.multiStopItem input{width:18px;height:18px;accent-color:var(--primary-color,#3284da)}
:host{display:block;width:100%;min-width:0;color:var(--primary-text-color,#203047);font:inherit;box-sizing:border-box;container-type:inline-size}
*,*::before,*::after{box-sizing:border-box}
.editor{display:grid;gap:14px;padding:0 0 16px;min-width:0}
.edHead{display:grid;gap:4px;padding:3px 2px 1px}
.edEyebrow{text-transform:uppercase;font-size:10px;font-weight:800;letter-spacing:.12em;color:var(--primary-color,#3676cd)}
.edTitle{font-size:19px;font-weight:780;line-height:1.26;letter-spacing:-.025em}
.edSub{font-size:12px;color:var(--secondary-text-color,#738198);line-height:1.45}
.tabs{display:flex;flex-wrap:wrap;gap:5px;max-width:100%;padding:5px;border-radius:13px;background:var(--secondary-background-color,rgba(105,126,152,.09));border:1px solid var(--divider-color,rgba(120,139,166,.15))}
.tab{display:flex;align-items:center;justify-content:center;gap:7px;flex:1 1 calc(33.333% - 5px);min-width:0;min-height:39px;padding:9px 8px;white-space:normal;border:1px solid transparent;border-radius:9px;background:transparent;color:var(--secondary-text-color,#687890);font:inherit;font-weight:670;font-size:12px;cursor:pointer;transition:background-color .12s,border-color .12s,color .12s}
.tab:hover{color:var(--primary-text-color,#203047);background:var(--card-background-color,#fff)}
.tab[aria-selected="true"]{background:var(--card-background-color,#fff);color:var(--primary-text-color,#203047);border-color:var(--divider-color,#d8e0e9);box-shadow:0 1px 3px #0000000d}
.tabNo{font-size:10px;font-weight:810;letter-spacing:.02em;color:var(--primary-color,#3676cd)}
.tab:focus-visible,.viewChoice:focus-visible,.field input:focus-visible,.field textarea:focus-visible,.field select:focus-visible,.columnInput:focus-visible,.switch input:focus-visible{outline:2px solid var(--primary-color,#3c80db);outline-offset:2px}
.panel{border:1px solid var(--divider-color,#d6e0ec);border-radius:15px;background:var(--card-background-color,#fff);min-width:0;overflow:hidden}
.panelHead{padding:17px 18px 14px;border-bottom:1px solid var(--divider-color,rgba(125,145,166,.17))}
.panelTitle{font-weight:780;font-size:15px;line-height:1.3}
.panelSub{font-size:11.5px;color:var(--secondary-text-color,#728096);line-height:1.45;margin-top:4px}
.panelBody{padding:16px 18px 18px;display:grid;gap:16px;min-width:0}
.section{display:grid;gap:10px;min-width:0}
.sectionTitle{font-size:12px;font-weight:790;color:var(--primary-text-color,#26374e);line-height:1.35}
.sectionSub{font-size:11px;color:var(--secondary-text-color,#7b879b);line-height:1.45;margin-top:2px}
.sectionSplit{border-top:1px solid var(--divider-color,rgba(125,145,166,.21));padding-top:16px}
.field{display:flex;flex-direction:column;gap:6px;min-width:0}
.fieldLabel{font-size:12px;font-weight:675;line-height:1.3;color:var(--primary-text-color,#34465e)}
.field input,.field select,.field textarea,.columnInput{display:block;width:100%;min-width:0;min-height:41px;border:1px solid var(--divider-color,#cbd5e1);border-radius:9px;background:var(--card-background-color,#fff);color:var(--primary-text-color,#243248);font:inherit;font-size:13px;line-height:1.35;padding:9px 11px;appearance:auto}
.field textarea{resize:vertical;min-height:60px}
.field input::placeholder,.field textarea::placeholder,.columnInput::placeholder{color:var(--secondary-text-color,#8492a3);opacity:.83}
.two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.viewGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.viewChoice{display:flex;align-items:center;gap:12px;min-width:0;min-height:70px;text-align:left;border:1px solid var(--divider-color,#ccd8e5);border-radius:11px;background:var(--secondary-background-color,rgba(103,131,160,.035));padding:11px 12px;color:var(--primary-text-color,#243248);font:inherit;font-size:12px;font-weight:680;cursor:pointer;transition:background .12s,border-color .12s}
.viewChoice:hover{border-color:var(--primary-color,#397ccf)}
.viewChoice[aria-checked="true"]{border-color:var(--primary-color,#397ccf);background:color-mix(in srgb,var(--primary-color,#397ccf) 9%,var(--card-background-color,#fff));box-shadow:inset 0 0 0 1px var(--primary-color,#397ccf)}
.viewGlyph{display:flex;align-items:center;justify-content:center;flex:0 0 39px;height:39px;border-radius:9px;background:var(--card-background-color,#fff);border:1px solid var(--divider-color,#d8e1eb);color:var(--primary-color,#3676cd)}
.viewChoice[aria-checked="true"] .viewGlyph{border-color:color-mix(in srgb,var(--primary-color,#3676cd) 25%,var(--divider-color,#ddd))}
.viewGlyph svg{width:23px;height:23px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.viewName{line-height:1.28;min-width:0}
.switchStack{display:grid;gap:7px}
.switch{display:flex;align-items:center;gap:13px;min-height:48px;padding:10px 12px;background:var(--secondary-background-color,rgba(115,134,164,.045));border:1px solid var(--divider-color,rgba(120,145,176,.13));border-radius:10px;font-size:12.5px;line-height:1.4;font-weight:610;cursor:pointer;min-width:0}
.switchText{flex:1;min-width:0}
.switch input{appearance:none;-webkit-appearance:none;flex:0 0 37px;width:37px;height:22px;border:0;border-radius:20px;background:var(--disabled-text-color,#abb8c7);position:relative;cursor:pointer;margin:0;transition:background .14s}
.switch input::after{content:"";position:absolute;left:3px;top:3px;background:#fff;border-radius:50%;width:16px;height:16px;box-shadow:0 1px 2px #0003;transition:transform .14s}
.switch input:checked{background:var(--primary-color,#347dcd)}.switch input:checked::after{transform:translateX(15px)}
.conditional{display:grid;gap:11px;padding:3px 0 3px 12px;margin-left:10px;border-left:2px solid var(--divider-color,#d5dfeb);min-width:0}
.note{font-size:11px;line-height:1.45;color:var(--secondary-text-color,#78879a)}
.columnGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.columnCard{display:grid;gap:9px;min-width:0;padding:10px;border:1px solid var(--divider-color,#d4deea);border-radius:11px;background:var(--secondary-background-color,rgba(106,124,154,.035))}
.columnCard.inactive{opacity:.67}
.columnCard .switch{background:transparent;border:0;padding:0;min-height:32px;gap:8px}
.columnCard .columnInput{font-size:12px;min-height:37px;padding:8px 9px}
.columnCard .columnInput:disabled{opacity:.65}
.sortGrid{margin-top:2px}
.filterGroup{display:grid;gap:11px;min-width:0}
.filterGroupTitle{font-size:12px;font-weight:760;color:var(--primary-text-color,#26374e)}
.filterMeta{font-size:11px;line-height:1.5;color:var(--secondary-text-color,#738198)}
.filterToolbar{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.filterReset{border:1px solid var(--divider-color,#ccd8e5);border-radius:8px;background:var(--card-background-color,#fff);color:var(--primary-text-color,#26374e);font:inherit;font-size:11.5px;min-height:32px;padding:6px 11px;cursor:pointer}
.filterReset:hover{border-color:var(--primary-color,#3676cd)}
.filterSearch{box-sizing:border-box;width:100%;min-height:40px;border:1px solid var(--divider-color,#cbd5e1);border-radius:9px;background:var(--card-background-color,#fff);color:var(--primary-text-color,#243248);font:inherit;font-size:12px;padding:9px 11px}
.filterChoices{display:flex;flex-wrap:wrap;gap:7px;min-width:0;max-height:230px;overflow-y:auto;align-content:flex-start;padding:2px}
.filterChoice{min-height:35px;max-width:100%;border:1px solid var(--divider-color,#ccd8e5);border-radius:9px;background:var(--secondary-background-color,rgba(100,120,160,.035));color:var(--primary-text-color,#243248);font:inherit;font-size:12px;font-weight:650;padding:7px 10px;cursor:pointer;overflow-wrap:anywhere;text-align:left}
.filterChoice[aria-pressed="true"]{background:color-mix(in srgb,var(--primary-color,#397ccf) 11%,var(--card-background-color,#fff));border-color:var(--primary-color,#397ccf);box-shadow:inset 0 0 0 1px var(--primary-color,#397ccf)}
.filterChoice:hover{border-color:var(--primary-color,#3676cd)}
.filterChoice:focus-visible,.filterReset:focus-visible,.filterSearch:focus-visible{outline:2px solid var(--primary-color,#3c80db);outline-offset:2px}
@container (max-width:370px){.tab{padding:8px 10px}.tabNo{display:none}.panelHead{padding:15px 13px 12px}.panelBody{padding:14px 13px 15px;gap:14px}.columnGrid{grid-template-columns:1fr}}
@container (max-width:325px){.two,.viewGrid{grid-template-columns:1fr}.tab{font-size:11px}.viewChoice{min-height:55px}}
/* Focused, adaptive two-pane settings editor. */
.editor{gap:17px;padding:8px 0 20px}
.edHead{padding:15px 18px 13px;border-radius:16px;background:linear-gradient(135deg,color-mix(in srgb,var(--primary-color,#397ccf) 9%,var(--card-background-color,#fff)),var(--card-background-color,#fff));border:1px solid var(--divider-color,#d7e1ec);gap:6px}
.edEyebrow{font-size:10px}.edTitle{font-size:20px}.edSub{font-size:12px}
.edSummary{display:flex;gap:7px;flex-wrap:wrap;margin-top:8px}.summaryTag{font-size:11px;padding:5px 9px;border-radius:999px;background:var(--secondary-background-color,#f0f4f9);border:1px solid var(--divider-color,#d7e1ec);font-weight:650}
.editorShell{display:grid;grid-template-columns:minmax(155px,190px) minmax(0,1fr);align-items:start;gap:14px}
.tabs{display:grid;gap:4px;padding:7px;position:sticky;top:8px;border-radius:14px;background:var(--card-background-color,#fff)}
.tab{justify-content:flex-start;flex:auto;min-height:46px;text-align:left;padding:10px 12px;border-radius:9px;font-size:12.5px;font-weight:675}
.tab[aria-selected="true"]{background:color-mix(in srgb,var(--primary-color,#397ccf) 10%,var(--card-background-color,#fff));border-color:color-mix(in srgb,var(--primary-color,#397ccf) 30%,var(--divider-color,#dde));box-shadow:none;color:var(--primary-text-color,#203047)}
.tabNo{flex:0 0 18px;color:var(--secondary-text-color,#718096)}.tab[aria-selected="true"] .tabNo{color:var(--primary-color,#3676cd)}
.editorPage{min-width:0}.panel{border-radius:15px}.panelHead{padding:19px 20px 15px}.panelTitle{font-size:16px}.panelSub{font-size:12px}.panelBody{padding:18px 20px 22px;gap:22px}
.section{gap:12px}.sectionTitle{font-size:13px}.switchStack{gap:8px}
.switch{min-height:52px;border-radius:11px;background:var(--secondary-background-color,rgba(112,132,164,.035));font-size:12.5px}
.switch:hover{border-color:color-mix(in srgb,var(--primary-color,#397ccf) 38%,var(--divider-color,#ddd))}
.conditional{padding:4px 0 4px 13px;margin-left:9px;border-left:2px solid color-mix(in srgb,var(--primary-color,#397ccf) 45%,var(--divider-color,#ddd))}
.stopMultiSelector{grid-template-columns:1fr;max-height:215px;overflow:auto;align-content:start;padding-right:2px}
.stopSearch{width:100%;min-height:41px;border:1px solid var(--divider-color,#cbd5e1);border-radius:9px;background:var(--card-background-color,#fff);color:var(--primary-text-color,#243248);padding:9px 11px;font:inherit;font-size:12px}
.stopSearch:focus-visible{outline:2px solid var(--primary-color,#3c80db);outline-offset:2px}
.multiStopItem{font-size:12px;min-height:42px}.multiStopItem[hidden],.filterChoice[hidden]{display:none!important}
.columnGrid{grid-template-columns:repeat(auto-fit,minmax(160px,1fr))}.columnCard{padding:12px}
.field input,.field select,.field textarea{font-size:13px;min-height:43px}
@container (max-width:620px){.editorShell{grid-template-columns:minmax(0,1fr);gap:12px}.tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));position:static;gap:5px}.tab{min-height:44px;justify-content:center;text-align:center;flex:auto;font-size:12px;padding:8px 5px}.tabNo{display:none}.panelBody{padding:16px}.panelHead{padding:16px}}
@container (max-width:355px){.tabs{grid-template-columns:repeat(2,minmax(0,1fr))}.two,.viewGrid{grid-template-columns:1fr}}
@media (prefers-reduced-motion:reduce){.tab,.switch,.viewChoice,.switch input,.switch input::after{transition:none!important}}
`;
const EDITOR_WORDS = {
  de: {

    visibility:"Sichtbarkeit",
    visibilityTitle:"Sichtbare Elemente",
    visibilitySub:"Lege gezielt fest, welche Bereiche in der Karte erscheinen. Abhängige Optionen werden automatisch eingeblendet.",
    selectedStops:"Haltestelle(n)",stopSelectedSingle:"Haltestelle ausgewählt",stopSelectedMultiple:"Haltestellen ausgewählt",
    settingsCategories:"Einstellungsbereiche",
    displayMode:"Anzeigeformat",
    infoSection:"Datenstatus und Verkehrshinweise",
    controlsSection:"Bedienelemente",
    showEyebrow:"Kleine Überschrift anzeigen",
    emptyMessage:"Hinweis bei fehlenden Abfahrten anzeigen",
    quickFiltersSwitch:"Schnellfilter-Leiste anzeigen",
    disruptionHeading:"Überschrift der Verkehrshinweise anzeigen",
    disruptionCount:"Anzahl der Verkehrshinweise anzeigen",
    disruptionDescription:"Beschreibung der Verkehrshinweise anzeigen",
    disruptionStale:"Hinweis auf veraltete Störungsdaten anzeigen",
    filterSettingsTitle:"Schnellfilter und feste Filter",
    filterSettingsSub:"Schnellfilter sind direkt in der Karte bedienbar; feste Filter gelten für diese Kartenkonfiguration.",
    quickFilterSection:"Schnellfilter auf der Karte",
    quickFilterHeading:"Überschrift „Schnellfilter“ anzeigen",
    quickFilterReset:"Schaltfläche „Zurücksetzen“ anzeigen",
    quickFilterLine:"Linienauswahl anzeigen",
    quickFilterDestination:"Fahrtzielauswahl anzeigen",
    quickFavoriteOnly:"Schalter „Nur Favoriten“ anzeigen",
    quickFavoriteEditor:"Favoriten-Sterne für Linien anzeigen",
    quickFilterHint:"Wird ein Schnellfilter ausgeblendet, wirkt seine vorherige Auswahl nicht weiter. Favoriten bleiben gespeichert.",
    presetFilterSection:"Feste Auswahl für diese Karte",
    visibleInformation:"Informationen pro Abfahrt",
    visibleInfoHint:"Für diese Darstellung werden nur die hier unterstützten Angaben eingeblendet.",
    departureExtras:"Abfahrtsdetails",
    tableSection:"Tabellenkopf und Bedienung",
    tableHeader:"Tabellenüberschriften anzeigen",
    tableSort:"Sortierschaltflächen in den Überschriften anzeigen",
    mapCanvas:"Interaktive Karte anzeigen",
    mapDiagnostics:"Kartenhinweise bei fehlenden Daten anzeigen",
    mapControls:"Zoom- und Zentrierungsschaltflächen anzeigen",
    mapLegend:"Legende zur Linienverbindung anzeigen",
    mapSelectionSection:"Fahrtauswahl",
    mapTripSelector:"Auswahl der Fahrten anzeigen",
    mapTripSelectorHeading:"Überschrift über der Fahrtauswahl anzeigen",
    mapJourneySection:"Ausgewählte Fahrt",
    mapJourney:"Zusammenfassung der ausgewählten Fahrt anzeigen",
    timelineSection:"Haltestellenliste zur Karte",
    mapTimelineHeading:"Überschrift der Haltestellenliste anzeigen",
    detailHeading:"Überschrift „Nächste Haltestellen“ anzeigen",
    stopCancellation:"Ausfallhinweise bei Folgehalten anzeigen",
    moreStops:"Hinweis auf weitere Haltestellen anzeigen",
    noCustomText:"Alle Bereiche für eigene Texte sind ausgeblendet. Du kannst sie unter „Sichtbarkeit“ wieder einschalten.",
    searchStops:"Haltestellen suchen …",clearStops:"Auswahl aufheben",
    eyebrow:"DASHBOARD",title:"Abfahrtstafel gestalten",subtitle:"Alle Einstellungen für diese Karte",
    basics:"Grundlagen",filters:"Schnellfilter",text:"Beschriftung",columns:"Spalten",trips:"Fahrtverlauf",more:"Optionen",
    filtersTitle:"Linien und Fahrtziele",filtersSub:"Wähle, welche Busse diese Karte zeigt. Der Sensor bleibt unverändert.",
    filterLines:"Buslinien",filterDestinations:"Fahrtziele und Richtungen",
    filterAll:"Alle anzeigen",filterSearch:"Einträge durchsuchen …",filterAvailable:"Aktuell verfügbar",filterSelected:"Ausgewählt",
    filterNoOptions:"Derzeit keine Abfahrten zur Auswahl vorhanden.",
    filterHint:"Ohne Auswahl werden alle angezeigt. Beide Filter wirken zusammen. Erst filtern, dann die nächsten Abfahrten auswählen und sortieren.",
    basicsTitle:"Haltestelle und Ansicht",basicsSub:"Haltestellen, Darstellung und Anzahl der Abfahrten",
    sensorSection:"Haltestellen auswählen",viewSection:"Darstellung auswählen",rowsSection:"Angezeigte Abfahrten",
    pickStop:"Haltestellen auswählen",noSensors:"Keine passenden Sensoren gefunden",chooseStop:"Haltestellen auswählen",
    table:"Tabelle",list:"Liste",monitor:"Digitalanzeige",map:"Karte",rows:"Anzahl der Abfahrten",density:"Zeilenabstand",
    compact:"Kompakt",comfortable:"Normal",spacious:"Großzügig",
    textsTitle:"Texte und Kopfbereich",textsSub:"Beschriftungen und zusätzliche Informationen individuell festlegen",
    titleSection:"Überschrift",subtitleSection:"Untertitel",footerSection:"Fußzeile",emptySection:"Leere Abfahrtstafel",
    headerSwitch:"Überschrift anzeigen",titleLabel:"Überschrift",headText:"Kleine Kopfzeile",
    subSwitch:"Untertitel anzeigen",subtitleLabel:"Untertitel",clockSwitch:"Aktuelle Uhrzeit anzeigen",
    footSwitch:"Fußzeile anzeigen",footerLabel:"Fußzeilentext",emptyLabel:"Text, wenn keine Abfahrten verfügbar sind",
    columnsTitle:"Spalten und Sortierung",columnsSub:"Nur die benötigten Informationen anzeigen und die Beschriftungen anpassen",
    visibleColumns:"Sichtbare Spalten",columnNames:"Spaltenname (optional)",columnNote:"Ausgeblendete Spalten erscheinen nicht in der Abfahrtstafel",
    sortSection:"Sortierung",sortNote:"Es werden ausschließlich die angezeigten Abfahrten sortiert",
    sortBy:"Sortieren nach",sortDirection:"Reihenfolge",ascending:"Aufsteigend",descending:"Absteigend",
    tripsTitle:"Fahrtverlauf und Karten",tripsSub:"Nachfolgende Haltestellen und interaktive Karten konfigurieren",
    expandSection:"Details zu einer Abfahrt",showDetails:"Fahrtverlauf beim Anklicken öffnen",
    stopTimes:"Uhrzeiten der folgenden Haltestellen anzeigen",stopDelays:"Verspätungen der folgenden Haltestellen anzeigen",
    inlineMapSection:"Karte im Fahrtverlauf",inlineMap:"Karte oberhalb der Haltestellenliste anzeigen",
    inlineMapHover:"Haltestellen beim Darüberfahren auf der Karte hervorheben",inlineMapHeight:"Höhe der Detailkarte",
    mapSection:"Eigenständige Kartenansicht",mapHeight:"Kartenhöhe",mapDepartures:"Fahrten zur Auswahl",
    mapLine:"Haltestellen verbinden",actualRoute:"Tatsächlichen Linienverlauf verwenden, sofern vorhanden",mapTimeline:"Haltestellenliste unter der Karte anzeigen",
    extrasTitle:"Weitere Optionen",extrasSub:"Abfahrtsinformationen und Aktualisierungsanzeige",
    cancelled:"Ausgefallene Fahrten anzeigen",scheduled:"Planmäßige Zeit bei Abweichungen anzeigen",
    lineColors:"Linien farbig kennzeichnen",updated:"Zeitpunkt der letzten Aktualisierung anzeigen",
    dataQuality:"Echtzeitqualität anzeigen",staleWarning:"Bei veralteten Daten warnen",disruptions:"Störungen und Verkehrshinweise anzeigen",
    dayLabels:"Morgen, Wochentag und Datum bei späteren Abfahrten anzeigen",
    emptyPlaceholder:"Keine weiteren Abfahrten vorhanden",
    multiStopsTitle:"Weitere Haltestellen in dieser Karte",
    multiStopsDescription:"Wähle einen oder mehrere bereits eingerichtete Haltestellen-Sensoren.",
    fullscreenButton:"Vollbild-Schaltfläche anzeigen", kioskDisplay:"Kiosk-Darstellung (größere Schrift)",
  },
  en: {

    visibility:"Visibility",
    visibilityTitle:"Visible elements",
    visibilitySub:"Choose precisely which parts of the card appear. Related settings are only shown when applicable.",
    selectedStops:"stop(s)",stopSelectedSingle:"stop selected",stopSelectedMultiple:"stops selected",
    settingsCategories:"Settings categories",
    displayMode:"Display style",
    infoSection:"Data status and service alerts",
    controlsSection:"Controls",
    showEyebrow:"Show small heading",
    emptyMessage:"Show a message when no departures are available",
    quickFiltersSwitch:"Show quick-filter bar",
    disruptionHeading:"Show service-alert heading",
    disruptionCount:"Show number of service alerts",
    disruptionDescription:"Show service-alert descriptions",
    disruptionStale:"Show outdated service-alert warning",
    filterSettingsTitle:"Quick filters and fixed filters",
    filterSettingsSub:"Quick filters are controlled on the card; fixed filters apply to this card configuration.",
    quickFilterSection:"Quick filters on the card",
    quickFilterHeading:"Show “Quick filters” heading",
    quickFilterReset:"Show “Reset” button",
    quickFilterLine:"Show line selector",
    quickFilterDestination:"Show destination selector",
    quickFavoriteOnly:"Show “Favorites only” switch",
    quickFavoriteEditor:"Show line favorite buttons",
    quickFilterHint:"Hidden quick-filter controls no longer filter departures. Saved favorite lines are kept.",
    presetFilterSection:"Fixed selection for this card",
    visibleInformation:"Information per departure",
    visibleInfoHint:"Only information supported by the current view is shown.",
    departureExtras:"Departure details",
    tableSection:"Table header and controls",
    tableHeader:"Show table header",
    tableSort:"Show sorting buttons in the header",
    mapCanvas:"Show interactive map",
    mapDiagnostics:"Show notices for missing map data",
    mapControls:"Show zoom and fit controls",
    mapLegend:"Show route-line legend",
    mapSelectionSection:"Trip selection",
    mapTripSelector:"Show trip selector",
    mapTripSelectorHeading:"Show heading above trip selector",
    mapJourneySection:"Selected trip",
    mapJourney:"Show selected-trip summary",
    timelineSection:"Stop list beside the map",
    mapTimelineHeading:"Show stop-list heading",
    detailHeading:"Show “Following stops” heading",
    stopCancellation:"Show cancellation notices at subsequent stops",
    moreStops:"Show notice about additional stops",
    noCustomText:"All custom text areas are hidden. Enable them again under “Visibility”.",
    searchStops:"Search stops …",clearStops:"Clear selection",
    eyebrow:"DASHBOARD",title:"Customize departure board",subtitle:"All settings for this card",
    basics:"Basics",filters:"Quick filters",text:"Labels",columns:"Columns",trips:"Trip details",more:"Options",
    filtersTitle:"Lines and destinations",filtersSub:"Choose which buses this card displays. The sensor remains unchanged.",
    filterLines:"Bus lines",filterDestinations:"Destinations and directions",
    filterAll:"Show all",filterSearch:"Search entries …",filterAvailable:"Currently available",filterSelected:"Selected",
    filterNoOptions:"No departures available to select right now.",
    filterHint:"No selection means show all. Both filters are combined. Filter first, then select and sort the next departures.",
    basicsTitle:"Stop and appearance",basicsSub:"Stops, display layout and number of departures",
    sensorSection:"Select stops",viewSection:"Choose display layout",rowsSection:"Displayed departures",
    pickStop:"Select stop sensors",noSensors:"No compatible sensors found",chooseStop:"Select stops",
    table:"Table",list:"List",monitor:"Digital display",map:"Map",rows:"Number of departures",density:"Row spacing",
    compact:"Compact",comfortable:"Regular",spacious:"Spacious",
    textsTitle:"Labels and header",textsSub:"Customize headings and additional information",
    titleSection:"Heading",subtitleSection:"Subtitle",footerSection:"Footer",emptySection:"Empty departure board",
    headerSwitch:"Show heading",titleLabel:"Title",headText:"Small heading",
    subSwitch:"Show subtitle",subtitleLabel:"Subtitle",clockSwitch:"Show current time",
    footSwitch:"Show footer",footerLabel:"Footer text",emptyLabel:"Text when no departures are available",
    columnsTitle:"Columns and sorting",columnsSub:"Choose which information to display and customize its labels",
    visibleColumns:"Visible columns",columnNames:"Column name (optional)",columnNote:"Hidden columns do not appear on the departure board",
    sortSection:"Sorting",sortNote:"Only currently displayed departures are sorted",
    sortBy:"Sort by",sortDirection:"Order",ascending:"Ascending",descending:"Descending",
    tripsTitle:"Trip details and maps",tripsSub:"Configure subsequent stops and interactive maps",
    expandSection:"Departure details",showDetails:"Expand trip details on selection",
    stopTimes:"Show times at subsequent stops",stopDelays:"Show delays at subsequent stops",
    inlineMapSection:"Map in trip details",inlineMap:"Show map above the stop list",
    inlineMapHover:"Highlight map stops when hovering over the list",inlineMapHeight:"Detail map height",
    mapSection:"Standalone map view",mapHeight:"Map height",mapDepartures:"Trips available for selection",
    mapLine:"Connect stops",actualRoute:"Use actual route geometry when available",mapTimeline:"Show stop list below the map",
    extrasTitle:"Additional options",extrasSub:"Departure data and update indicators",
    cancelled:"Show cancelled departures",scheduled:"Show scheduled time when different",
    lineColors:"Color-code routes",updated:"Show last update time",
    dataQuality:"Show realtime data quality",staleWarning:"Warn when timetable data is outdated",disruptions:"Show disruptions and service alerts",
    dayLabels:"Show Tomorrow, weekday and date for later departures",
    emptyPlaceholder:"No upcoming departures",
    multiStopsTitle:"Additional stops in this card",
    multiStopsDescription:"Choose one or more configured stop sensors.",
    fullscreenButton:"Show fullscreen button", kioskDisplay:"Kiosk display (larger text)",
  },
};
const EDITOR_VIEW_ICONS = {
  table:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14h18M9 4v16"/></svg>',
  list:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5h12M9 12h12M9 19h12"/><circle cx="4.7" cy="5" r="1"/><circle cx="4.7" cy="12" r="1"/><circle cx="4.7" cy="19" r="1"/></svg>',
  monitor:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="4" width="19" height="15" rx="2"/><path d="M6 9h4M14 9h4M6 14h4M14 14h4M9 22h6M12 19v3"/></svg>',
  map:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18l-6 3V6l6-3 6 3 6-3v15l-6 3-6-3zM9 3v15M15 6v15"/><circle cx="16.5" cy="9.5" r="1.7"/></svg>',
};
class StopDepartureDisplayEditor extends HTMLElement {
  constructor(){
    super();this.attachShadow({mode:"open"});
    this._cfg={...DEFAULTS};this._signature="";this._tab="basics";this._hass=null;this._pickerOpen=false;this._stopQuery="";
    this._richSnapshots=new Map();this._richRequests=new Map();
  }
  setConfig(config){
    const next={...DEFAULTS,...config};delete next.show_sort;
    const signature=JSON.stringify(next);
    if(signature===this._signature)return;
    this._cfg=next;this._signature=signature;this._refreshRichData();
    const active=this.shadowRoot.activeElement;
    if(active && ["INPUT","TEXTAREA"].includes(active.tagName) && active.type!=="checkbox")return;
    this._render();
  }
  _mergedState(){return mergedStopState(this._hass,this._cfg,this._richSnapshots);}
  _refreshRichData(){
    const hass=this._hass;
    if(!hass || typeof hass.callWS!=="function")return;
    const ids=selectedStopEntities(this._cfg);
    for(const id of this._richSnapshots.keys())if(!ids.includes(id))this._richSnapshots.delete(id);
    for(const id of this._richRequests.keys())if(!ids.includes(id))this._richRequests.delete(id);
    for(const id of ids){
      const revision=hass.states?.[id]?.attributes?.zeitpunkt_abfrage;
      if(!revision || this._richSnapshots.get(id)?.revision===revision)continue;
      const previous=this._richRequests.get(id);
      if(previous?.revision===revision&&(previous.pending||Date.now()-previous.started<60000))continue;
      const request={revision,started:Date.now(),pending:true};this._richRequests.set(id,request);
      Promise.resolve().then(()=>hass.callWS({type:"haltestellen_abfahrtsanzeige/get_departures",entity_id:id}))
        .then(result=>{
          if(!Array.isArray(result?.abfahrten)||!Array.isArray(result?.verkehrshinweise))return;
          if(result.zeitpunkt_abfrage!==this._hass?.states?.[id]?.attributes?.zeitpunkt_abfrage)return;
          this._richSnapshots.set(id,{revision:result.zeitpunkt_abfrage,data:result});
          if(this.isConnected&&this._tab==="filters"&&!this.shadowRoot?.activeElement?.classList?.contains("filterSearch"))this._render();
        })
        .catch(()=>{ /* Compact preview remains available. */ })
        .finally(()=>{if(this._richRequests.get(id)===request)request.pending=false;});
    }
  }
  set hass(hass){
    const first=!this._hass;
    const changed=!first && languageOf(this._hass)!==languageOf(hass);
    const themeChanged=applyTransitTheme(this,hass);
    const prevSignature=this._filterOptionsSignature;
    this._hass=hass;
    this._refreshRichData();
    const state=this._mergedState();
    const choices=["filter_lines","filter_destinations"].map(key=>availableFilterValues(state,key,this._cfg[key]));
    this._filterOptionsSignature=JSON.stringify(choices);
    // Refresh the filter choices when the timetable changes, but never while
    // the user is typing into the filter search field.
    const isSearching=this.shadowRoot?.activeElement?.classList?.contains("filterSearch");
    if(first||changed||themeChanged||this._tab==="filters" && !isSearching && prevSignature!==this._filterOptionsSignature)this._render();
  }
  _set(key,value,refresh=false){
    if((this._cfg.view==="table"||this._cfg.view==="monitor") && key.startsWith("show_") && value===false && COLUMNS.some(([k])=>`show_${k}`===key) && visibleColumns(this._cfg).filter(([k])=>k!=="stop"||selectedStopEntities(this._cfg).length>1).length===1 && this._cfg[key]!==false)return false;
    this._cfg={...this._cfg,[key]:value};this._signature=JSON.stringify(this._cfg);
    this.dispatchEvent(new CustomEvent("config-changed",{detail:{config:{...this._cfg}},bubbles:true,composed:true}));
    if(refresh)this._render();
    return true;
  }
  _field(parent,key,label,opts={}){
    const wrap=node("label","field");wrap.append(node("span","fieldLabel",label));
    const input=node(opts.choices?"select":opts.multiline?"textarea":"input");
    input.dataset.editorFocusKey=`field:${key}`;
    if(opts.choices){for(const [value,title] of opts.choices){const option=node("option","",title);option.value=value;input.append(option);}}
    else if(!opts.multiline){
      input.type=opts.number?"number":"text";
      if(opts.number){input.min=String(opts.min??1);input.max=String(opts.max??80);input.step="1";}
    }else input.rows=2;
    if(opts.placeholder)input.placeholder=opts.placeholder;
    input.value=String(this._cfg[key]??"");
    input.addEventListener(opts.choices||opts.number?"change":"input",()=>{
      const val=opts.number?Math.max(opts.min??1,Math.min(opts.max??80,Number(input.value)||Number(opts.min??1))):input.value;
      if(key==="entity"){this._cfg.entities=[];this._set(key,val,true);}
      else this._set(key,val,Boolean(opts.refresh));
    });
    wrap.append(input);parent.append(wrap);
    return input;
  }
  _switch(parent,key,label,refresh=false){
    const wrap=node("label","switch");const input=node("input");input.type="checkbox";input.checked=this._cfg[key]!==false;
    input.addEventListener("change",()=>{
      const ok=this._set(key,input.checked,refresh);
      if(!ok)input.checked=this._cfg[key]!==false;
    });
    input.dataset.editorFocusKey=`setting:${key}`;
    wrap.append(node("span","switchText",label),input);parent.append(wrap);
    return input;
  }
  _filterGroup(parent,key,title,t){
    const group=this._section(parent,title);
    const state=this._mergedState();
    const options=availableFilterValues(state,key,this._cfg[key]);
    const availableCount=availableFilterValues(state,key,[]).length;
    const selected=filterValues(this._cfg[key]);
    const toolbar=node("div","filterToolbar");
    const count=node("div","filterMeta",`${t.filterAvailable}: ${availableCount} · ${t.filterSelected}: ${selected.length||t.filterAll}`);
    const reset=node("button","filterReset",t.filterAll);reset.type="button";
    reset.addEventListener("click",()=>this._set(key,[],true));
    toolbar.append(count,reset);group.append(toolbar);
    if(!options.length){group.append(node("div","filterMeta",t.filterNoOptions));return;}
    const search=node("input","filterSearch");search.type="search";search.placeholder=t.filterSearch;
    search.setAttribute("aria-label",`${title}: ${t.filterSearch}`);group.append(search);
    const choices=node("div","filterChoices");choices.setAttribute("role","group");choices.setAttribute("aria-label",title);group.append(choices);
    for(const value of options){
      const active=selected.includes(value);
      const choice=node("button","filterChoice",value);choice.type="button";
      choice.setAttribute("aria-pressed",String(active));choice.dataset.value=value;
      choice.addEventListener("click",()=>{
        const current=filterValues(this._cfg[key]);
        const next=current.includes(value)?current.filter(x=>x!==value):[...current,value];
        this._set(key,next,true);
      });
      choices.append(choice);
    }
    search.addEventListener("input",()=>{
      const term=search.value.trim().toLocaleLowerCase();
      for(const item of choices.children)item.hidden=!item.dataset.value.toLocaleLowerCase().includes(term);
    });
  }
  _panel(parent,title,sub){
    const panel=node("div","panel"),head=node("div","panelHead"),body=node("div","panelBody");
    head.append(node("div","panelTitle",title),node("div","panelSub",sub));
    panel.append(head,body);parent.append(panel);return body;
  }
  _section(parent,title,sub,split=false){
    const section=node("section",`section${split?" sectionSplit":""}`);
    const heading=node("div");heading.append(node("div","sectionTitle",title));
    if(sub)heading.append(node("div","sectionSub",sub));
    section.append(heading);parent.append(section);return section;
  }
  _when(parent){const wrap=node("div","conditional");parent.append(wrap);return wrap;}
  _tabControl(nav,name,label,index){
    const btn=node("button","tab");btn.type="button";btn.setAttribute("role","tab");
    btn.setAttribute("aria-selected",String(name===this._tab));
    btn.append(node("span","tabNo",String(index).padStart(2,"0")),node("span","",label));
    btn.dataset.editorFocusKey=`tab:${name}`;
    btn.addEventListener("click",()=>{if(name===this._tab)return;this._tab=name;this._render();});
    nav.append(btn);
  }
  _render(){
    if(!this._hass)return;
    const en=languageOf(this._hass)==="en",t=EDITOR_WORDS[en?"en":"de"],w=words(this._hass);
    const cfg=this._cfg,view=cfg.view,table=view==="table"||view==="monitor",map=view==="map";
    const isOn=key=>cfg[key]!==false;
    const root=this.shadowRoot;
    const activeKey=root.activeElement?.dataset?.editorFocusKey||null;
    root.replaceChildren();
    const style=node("style");style.textContent=THEME_CSS+EDITOR_CSS;root.append(style);
    const main=node("div","editor");root.append(main);
    const head=node("div","edHead");
    head.append(node("div","edEyebrow",t.eyebrow),node("div","edTitle",t.title),node("div","edSub",t.subtitle));
    const summary=node("div","edSummary");summary.append(node("span","summaryTag",({table:t.table,list:t.list,monitor:t.monitor,map:t.map})[view]||t.table));
    summary.append(node("span","summaryTag",`${selectedStopEntities(cfg).length} ${selectedStopEntities(cfg).length===1?t.stopSelectedSingle:t.stopSelectedMultiple}`));head.append(summary);main.append(head);
    const shell=node("div","editorShell");main.append(shell);
    const nav=node("nav","tabs");nav.setAttribute("aria-label",t.settingsCategories);shell.append(nav);
    const groups=[["basics",t.basics],["visibility",t.visibility],["filters",t.filters],["columns",t.columns],["trips",t.trips],["text",t.text]];
    groups.forEach(([id,label],i)=>this._tabControl(nav,id,label,i+1));
    const page=node("div","editorPage");shell.append(page);
    const switches=(parent,rows)=>{const stack=node("div","switchStack");parent.append(stack);rows.forEach(([k,l,rerender])=>this._switch(stack,k,l,Boolean(rerender)));return stack;};
    const dependent=(parent,key,label,children)=>{
      this._switch(parent,key,label,true);
      if(isOn(key)){const nested=this._when(parent);children(nested);}
    };
    if(this._tab==="basics"){
      const body=this._panel(page,t.basicsTitle,t.basicsSub);
      // One multi-entity picker replaces the former primary/extra-stop controls.
      const sensor=this._section(body,t.sensorSection,t.multiStopsDescription);
      const available=Object.keys(this._hass.states||{}).filter(id=>id.startsWith("sensor.")&&Array.isArray(this._hass.states[id]?.attributes?.abfahrten)).sort();
      const chosen=selectedStopEntities(cfg);
      const sensors=[...new Set([...available,...chosen])].map(id=>[id,this._hass.states[id]?.attributes?.friendly_name||id]);
      sensors.sort((a,b)=>a[1].localeCompare(b[1],undefined,{numeric:true}));
      const picker=node("div","stopPicker");sensor.append(picker);
      const toggle=node("button","stopPickerToggle");toggle.type="button";
      toggle.dataset.editorFocusKey="stop:toggle";
      toggle.setAttribute("aria-expanded",String(this._pickerOpen));
      toggle.setAttribute("aria-label",t.pickStop);
      const label=node("span","stopPickerSummary",chosen.length?`${chosen.length} ${chosen.length===1?t.stopSelectedSingle:t.stopSelectedMultiple}`:t.chooseStop);
      const chevron=node("span","stopPickerChevron",this._pickerOpen?"▴":"▾");
      toggle.append(label,chevron);
      toggle.addEventListener("click",()=>{this._pickerOpen=!this._pickerOpen;this._render();});picker.append(toggle);
      if(chosen.length){
        const tags=node("div","stopSelectedTags");picker.append(tags);
        for(const id of chosen){
          const label=sensors.find(([key])=>key===id)?.[1]||id;
          const chip=node("span","stopSelectedTag",label);tags.append(chip);
        }
      }
      if(this._pickerOpen){
        const dropdown=node("div","stopPickerMenu");picker.append(dropdown);
        if(sensors.length){
          const search=node("input","stopSearch");search.type="search";search.placeholder=t.searchStops;
          search.value=this._stopQuery;search.dataset.editorFocusKey="stop:search";
          search.setAttribute("aria-label",t.searchStops);dropdown.append(search);
          const selector=node("div","stopMultiSelector");selector.setAttribute("role","group");
          selector.setAttribute("aria-label",t.pickStop);dropdown.append(selector);
          for(const [id,label] of sensors){
            const wrap=node("label","multiStopItem");wrap.dataset.search=`${label} ${id}`.toLocaleLowerCase();
            const input=node("input");input.type="checkbox";input.checked=chosen.includes(id);
            input.dataset.editorFocusKey=`stop:${id}`;
            input.addEventListener("change",()=>{
              const old=selectedStopEntities(this._cfg);
              const next=input.checked?[...old,id]:old.filter(x=>x!==id);
              this._cfg={...this._cfg,entity:next[0]||"",entities:[...new Set(next)]};
              this._signature=JSON.stringify(this._cfg);
              this.dispatchEvent(new CustomEvent("config-changed",{detail:{config:{...this._cfg}},bubbles:true,composed:true}));
              this._render();
            });
            wrap.append(input,node("span","",label));selector.append(wrap);
          }
          const filter=()=>{const term=this._stopQuery.toLocaleLowerCase();for(const el of selector.children)el.hidden=!el.dataset.search.includes(term);};
          search.addEventListener("input",()=>{this._stopQuery=search.value;filter();});filter();
          const tools=node("div","stopPickerTools"),clear=node("button","stopClear",t.clearStops);
          clear.type="button";clear.addEventListener("click",()=>{
            this._cfg={...this._cfg,entity:"",entities:[]};this._signature=JSON.stringify(this._cfg);
            this.dispatchEvent(new CustomEvent("config-changed",{detail:{config:{...this._cfg}},bubbles:true,composed:true}));this._render();
          });
          tools.append(clear);dropdown.append(tools);
        }else dropdown.append(node("div","stopPickerEmpty",t.noSensors));
      }
      const layout=this._section(body,t.viewSection,null,true),views=node("div","viewGrid");layout.append(views);
      views.setAttribute("role","radiogroup");views.setAttribute("aria-label",t.viewSection);
      for(const [id,label] of [["table",t.table],["list",t.list],["monitor",t.monitor],["map",t.map]]){
        const choice=node("button","viewChoice");choice.type="button";choice.dataset.editorFocusKey=`view:${id}`;
        choice.setAttribute("role","radio");choice.setAttribute("aria-checked",String(view===id));
        const symbol=node("span","viewGlyph");symbol.innerHTML=EDITOR_VIEW_ICONS[id];choice.append(symbol,node("span","viewName",label));
        choice.addEventListener("click",()=>this._set("view",id,true));views.append(choice);
      }
      const amount=this._section(body,t.rowsSection,null,true),fields=node("div","two");amount.append(fields);
      this._field(fields,"max_rows",t.rows,{number:true,min:1,max:80});
      this._field(fields,"density",t.density,{choices:[["compact",t.compact],["comfortable",t.comfortable],["spacious",t.spacious]]});
      switches(this._section(body,t.displayMode,null,true),[["kiosk_mode",t.kioskDisplay]]);
    }else if(this._tab==="visibility"){
      const body=this._panel(page,t.visibilityTitle,t.visibilitySub);
      const header=this._section(body,t.titleSection);
      dependent(header,"show_header",t.headerSwitch,inner=>{
        switches(inner,[["show_eyebrow",t.showEyebrow],["show_subtitle",t.subSwitch],["show_clock",t.clockSwitch]]);
      });
      const info=this._section(body,t.infoSection,null,true);
      switches(info,[["show_data_quality",t.dataQuality],["show_stale_warning",t.staleWarning],["show_disruptions",t.disruptions,true]]);
      if(isOn("show_disruptions")){
        const content=this._when(info);
        switches(content,[["show_disruption_heading",t.disruptionHeading],["show_disruption_count",t.disruptionCount],
          ["show_disruption_descriptions",t.disruptionDescription],["show_disruption_stale_note",t.disruptionStale]]);
      }
      const toolbar=this._section(body,t.controlsSection,null,true);
      switches(toolbar,[["show_quick_filters",t.quickFiltersSwitch],["show_fullscreen_button",t.fullscreenButton]]);
      const foot=this._section(body,t.footerSection,null,true);
      dependent(foot,"show_footer",t.footSwitch,inner=>this._field(inner,"footer_text",t.footerLabel,{multiline:true}));
      switches(foot,[["show_updated",t.updated],["show_empty_state",t.emptyMessage]]);
    }else if(this._tab==="filters"){
      const body=this._panel(page,t.filterSettingsTitle,t.filterSettingsSub);
      const quick=this._section(body,t.quickFilterSection);
      dependent(quick,"show_quick_filters",t.quickFiltersSwitch,inner=>{
        switches(inner,[["show_quick_filter_heading",t.quickFilterHeading],["show_quick_filter_reset",t.quickFilterReset],
          ["show_quick_filter_line",t.quickFilterLine],["show_quick_filter_destination",t.quickFilterDestination],
          ["show_quick_filter_favorites_only",t.quickFavoriteOnly],["show_quick_filter_favorites_edit",t.quickFavoriteEditor]]);
        inner.append(node("div","note",t.quickFilterHint));
      });
      const preset=this._section(body,t.presetFilterSection,t.filtersSub,true);
      this._filterGroup(preset,"filter_lines",t.filterLines,t);
      this._filterGroup(preset,"filter_destinations",t.filterDestinations,t);
      preset.append(node("div","note",t.filterHint));
    }else if(this._tab==="columns"){
      const body=this._panel(page,t.columnsTitle,t.columnsSub);
      const gridSection=this._section(body,table?t.visibleColumns:t.visibleInformation);
      const grid=node("div","columnGrid");gridSection.append(grid);
      for(const [key,de,eng] of COLUMNS){
        if(key==="stop" && selectedStopEntities(cfg).length<=1)continue;
        const active=isOn(`show_${key}`),label=en?eng:de;
        const card=node("div",`columnCard${active?"":" inactive"}`);
        this._switch(card,`show_${key}`,label,true);
        if(table){
          const custom=node("input","columnInput");custom.type="text";custom.value=cfg[`label_${key}`]||"";
          custom.placeholder=t.columnNames;custom.disabled=!active;custom.setAttribute("aria-label",`${label}: ${t.columnNames}`);
          custom.addEventListener("input",()=>this._set(`label_${key}`,custom.value));card.append(custom);
        }
        grid.append(card);
      }
      gridSection.append(node("div","note",table?t.columnNote:t.visibleInfoHint));
      const options=this._section(body,t.departureExtras,null,true);
      switches(options,[["show_cancelled",t.cancelled],["show_scheduled",t.scheduled],["show_day_labels",t.dayLabels],["show_line_colors",t.lineColors]]);
      if(table){
        const tbl=this._section(body,t.tableSection,null,true);
        dependent(tbl,"show_table_header",t.tableHeader,inner=>switches(inner,[["show_table_sort",t.tableSort]]));
      }
      const sort=this._section(body,t.sortSection,t.sortNote,true),fields=node("div","two sortGrid");sort.append(fields);
      this._field(fields,"sort_by",t.sortBy,{choices:COLUMNS.filter(([key])=>isOn(`show_${key}`)).map(([key,de,eng])=>[key,en?eng:de])});
      this._field(fields,"sort_direction",t.sortDirection,{choices:[["asc",t.ascending],["desc",t.descending]]});
    }else if(this._tab==="trips"){
      const body=this._panel(page,t.tripsTitle,t.tripsSub);
      if(map){
        const canvas=this._section(body,t.mapSection);
        dependent(canvas,"show_map_canvas",t.mapCanvas,inner=>{
          const sizes=node("div","two");inner.append(sizes);
          this._field(sizes,"map_height",t.mapHeight,{choices:[["300","300 px"],["400","400 px"],["520","520 px"]]});
          switches(inner,[["show_map_controls",t.mapControls],["show_map_legend",t.mapLegend],
            ["show_map_line",t.mapLine,true],["show_map_diagnostics",t.mapDiagnostics]]);
          if(isOn("show_map_line"))this._switch(this._when(inner),"show_actual_route",t.actualRoute);
        });
        const choose=this._section(body,t.mapSelectionSection,null,true);
        dependent(choose,"show_map_trip_selector",t.mapTripSelector,inner=>{
          this._switch(inner,"show_map_trip_selector_heading",t.mapTripSelectorHeading);
          this._field(inner,"map_departures",t.mapDepartures,{number:true,min:1,max:16});
        });
        const journey=this._section(body,t.mapJourneySection,null,true);
        switches(journey,[["show_map_journey",t.mapJourney]]);
        const timeline=this._section(body,t.timelineSection,null,true);
        dependent(timeline,"show_map_timeline",t.mapTimeline,inner=>{
          switches(inner,[["show_map_timeline_heading",t.mapTimelineHeading],["show_stop_times",t.stopTimes],
            ["show_stop_delays",t.stopDelays],["show_stop_cancellation",t.stopCancellation],
            ["show_more_stops_notice",t.moreStops],...(isOn("show_map_canvas")?[["show_inline_map_hover",t.inlineMapHover]]:[])]);
        });
      }else{
        const detail=this._section(body,t.expandSection);
        dependent(detail,"show_route_details",t.showDetails,inner=>{
          switches(inner,[["show_detail_heading",t.detailHeading],["show_stop_times",t.stopTimes],
            ["show_stop_delays",t.stopDelays],["show_stop_cancellation",t.stopCancellation],
            ["show_more_stops_notice",t.moreStops]]);
          const inline=this._section(inner,t.inlineMapSection,null,true);
          dependent(inline,"show_inline_map",t.inlineMap,sub=>{
            const height=node("div","two");sub.append(height);
            this._field(height,"inline_map_height",t.inlineMapHeight,{choices:[["240","240 px"],["300","300 px"],["400","400 px"]]});
            switches(sub,[["show_map_controls",t.mapControls],["show_map_legend",t.mapLegend],
              ["show_inline_map_hover",t.inlineMapHover],["show_map_line",t.mapLine,true],["show_map_diagnostics",t.mapDiagnostics]]);
            if(isOn("show_map_line"))this._switch(this._when(sub),"show_actual_route",t.actualRoute);
          });
        });
      }
    }else if(this._tab==="text"){
      const body=this._panel(page,t.textsTitle,t.textsSub);
      if(isOn("show_header")){
        const title=this._section(body,t.titleSection);
        this._field(title,"title",t.titleLabel,{placeholder:w.sample});
        if(isOn("show_eyebrow"))this._field(title,"heading_text",t.headText,{placeholder:w.heading});
        if(isOn("show_subtitle"))this._field(title,"subtitle",t.subtitleLabel);
      }
      if(isOn("show_footer")){
        const foot=this._section(body,t.footerSection,null,true);
        this._field(foot,"footer_text",t.footerLabel,{multiline:true});
      }
      if(isOn("show_empty_state")){
        const empty=this._section(body,t.emptySection,null,true);
        this._field(empty,"empty_text",t.emptyLabel,{multiline:true,placeholder:t.emptyPlaceholder});
      }
      if(!isOn("show_header")&&!isOn("show_footer")&&!isOn("show_empty_state"))body.append(node("div","note",t.noCustomText));
    }
    if(activeKey){
      const target=Array.from(root.querySelectorAll("[data-editor-focus-key]")).find(el=>el.dataset.editorFocusKey===activeKey);
      target?.focus({preventScroll:true});
    }
  }
}
if(!customElements.get(BOARD_TYPE))customElements.define(BOARD_TYPE,StopDepartureDisplay);
if(!customElements.get(`${BOARD_TYPE}-editor`))customElements.define(`${BOARD_TYPE}-editor`,StopDepartureDisplayEditor);
window.customCards=window.customCards||[];
if(!window.customCards.some(card=>card.type===BOARD_TYPE))window.customCards.push({type:BOARD_TYPE,name:"Haltestellen-Abfahrtsanzeige / Stop Departure Display",description:"Bus-Abfahrten / Bus departures · DE / EN · Table, list, monitor, map",preview:true});

/* Custom footer and last-update status are independently configurable. */
