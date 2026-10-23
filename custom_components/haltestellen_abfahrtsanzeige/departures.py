"""Normalize MOTIS stop-time events for a Home Assistant departure board."""
from __future__ import annotations

import math
import json
from datetime import datetime, timezone
from typing import Any

from .const import DATA_STALE_AFTER


# Keep Home Assistant attribute sizes predictable even for long-distance coaches.
# Each row explicitly reports if additional stops have been omitted.
MAX_FOLLOWING_STOPS = 30


def parse_time(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        result = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return result if result.tzinfo else result.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _text(value: Any) -> str:
    return str(value).strip() if value is not None else ""


def _is_bus(event: dict[str, Any]) -> bool:
    # MOTIS modes for public road-based buses; preserve bus-only semantics.
    return _text(event.get("mode")).upper() in {"BUS", "COACH"}


def _following_stops(event: dict[str, Any]) -> tuple[list[dict[str, Any]], int]:
    """Extract following, ordered trip stops from MOTIS `fetchStops` output.

    Times are localizable ISO strings, no interpolated or guessed stop data.
    A stop's planned arrival and realtime arrival are independent values.
    """
    items = event.get("nextStops")
    if not isinstance(items, list):
        return [], 0
    result: list[dict[str, Any]] = []
    for place in items:
        if not isinstance(place, dict):
            continue
        name = _text(place.get("name"))
        if not name:
            continue
        planned_arrival = parse_time(place.get("scheduledArrival"))
        actual_arrival = parse_time(place.get("arrival")) or planned_arrival
        planned_departure = parse_time(place.get("scheduledDeparture"))
        actual_departure = parse_time(place.get("departure")) or planned_departure
        delay = (
            round((actual_arrival - planned_arrival).total_seconds() / 60)
            if actual_arrival and planned_arrival else None
        )
        # MOTIS Place coordinates are geographic positions, never route geometry.
        try:
            lat, lon = float(place["lat"]), float(place["lon"])
            if not (-85.0511 <= lat <= 85.0511 and -180 <= lon <= 180):
                raise ValueError("out of range")
        except (KeyError, TypeError, ValueError):
            lat, lon = None, None
        result.append({
            "name": name,
            "lat": lat,
            "lon": lon,
            "ankunft": actual_arrival.isoformat() if actual_arrival else None,
            "plan_ankunft": planned_arrival.isoformat() if planned_arrival else None,
            "abfahrt": actual_departure.isoformat() if actual_departure else None,
            "plan_abfahrt": planned_departure.isoformat() if planned_departure else None,
            "verspaetung_minuten": delay,
            "ausfall": bool(place.get("cancelled", False)),
            "steig": _text(place.get("track")),
        })
    overflow = max(0, len(result) - MAX_FOLLOWING_STOPS)
    return result[:MAX_FOLLOWING_STOPS], overflow


def convert_stoptimes(raw: dict[str, Any], stop_name: str, limit: int = 40,
                      now: datetime | None = None,
                      stop_position: tuple[float, float] | None = None) -> dict[str, Any]:
    """Keep future scheduled or predicted BUS departures; preserve cancellations."""
    now = now or datetime.now(timezone.utc)
    if not isinstance(raw, dict) or not isinstance(raw.get("stopTimes"), list):
        raise ValueError("Invalid stop departure payload")
    result: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()
    for event in raw["stopTimes"]:
        if not isinstance(event, dict) or not _is_bus(event):
            continue
        place = event.get("place") or {}
        if not isinstance(place, dict):
            continue
        planned = parse_time(place.get("scheduledDeparture"))
        actual = parse_time(place.get("departure")) or planned
        if actual is None and planned is None:
            continue
        cancelled = bool(event.get("cancelled") or event.get("tripCancelled"))
        effective = (planned if cancelled else actual) or planned
        if effective is None or effective < now:
            continue
        if (event.get("pickupDropoffType") == "NOT_ALLOWED" or place.get("pickupType") == "NOT_ALLOWED") and not cancelled:
            continue
        trip_id = _text(event.get("tripId"))
        stop_id = _text(place.get("stopId"))
        unique = (trip_id or _text(event.get("routeId")), stop_id, (planned or effective).isoformat())
        if unique in seen:
            continue
        seen.add(unique)
        destination = _text(event.get("headsign")) or _text((event.get("tripTo") or {}).get("name"))
        line = _text(event.get("routeShortName")) or _text(event.get("displayName")) or _text(event.get("routeLongName")) or "Bus"
        delay = round((actual - planned).total_seconds() / 60) if planned and actual and not cancelled else None
        following, overflow = _following_stops(event)
        # TimestampReason is more precise than the generic trip-wide realTime
        # flag: an individual departure can have no usable realtime timestamp.
        reason = _text(place.get("departureTimestampReason")).upper()
        if reason in {"OBSERVED", "PREDICTED", "PROPAGATED"}:
            confirmed_realtime = True
            time_quality = "realtime"
        elif reason in {"NO_RT_DATA", "INCONSISTENT_RT"}:
            confirmed_realtime = False
            time_quality = "schedule" if reason == "NO_RT_DATA" else "uncertain"
        else:
            confirmed_realtime = bool(event.get("realTime"))
            time_quality = "realtime" if confirmed_realtime else "schedule"
        try:
            start_lat, start_lon = float(place["lat"]), float(place["lon"])
            if not (-85.0511 <= start_lat <= 85.0511 and -180 <= start_lon <= 180):
                raise ValueError("out of range")
        except (KeyError, TypeError, ValueError):
            start_lat, start_lon = stop_position or (None, None)
        result.append({
            "linie": line,
            "fahrt_id": trip_id,
            "start_lat": start_lat,
            "start_lon": start_lon,
            "ziel": destination,
            "abfahrt": effective.isoformat(),
            "plan_abfahrt": planned.isoformat() if planned else effective.isoformat(),
            "verspaetung_minuten": delay,
            "echtzeit": confirmed_realtime,
            "zeitqualitaet": time_quality,
            "zeitbegruendung": reason or None,
            "ausfall": cancelled,
            "steig": _text(place.get("track")),
            "verkehrsunternehmen": _text(event.get("agencyName")),
            "linienfarbe": _text(event.get("routeColor")),
            "linien_textfarbe": _text(event.get("routeTextColor")),
            "folgende_haltestellen": following,
            "weitere_haltestellen": overflow,
        })
    result.sort(key=lambda row: row["abfahrt"])
    result = result[:max(1, min(limit, 80))]
    return {
        "haltestelle": stop_name,
        "stop_lat": stop_position[0] if stop_position else None,
        "stop_lon": stop_position[1] if stop_position else None,
        "abfahrten": result,
        "abfahrten_gesamt": len(result),
        "zeitpunkt_abfrage": now.isoformat(),
    }


def upcoming(data: dict[str, Any] | None, now: datetime | None = None) -> list[dict[str, Any]]:
    now = now or datetime.now(timezone.utc)
    rows = (data or {}).get("abfahrten", [])
    if not isinstance(rows, list):
        return []
    return [row for row in rows if isinstance(row, dict) and (dep := parse_time(row.get("abfahrt"))) and dep >= now]


def next_departure(data: dict[str, Any] | None, now: datetime | None = None) -> dict[str, Any] | None:
    for row in upcoming(data, now):
        if not row.get("ausfall"):
            return row
    return None


def minutes_until_next(data: dict[str, Any] | None, now: datetime | None = None) -> int | None:
    now = now or datetime.now(timezone.utc)
    row = next_departure(data, now)
    dep = parse_time(row.get("abfahrt")) if row else None
    return max(0, math.ceil((dep - now).total_seconds() / 60)) if dep else None


def card_compatible_departures(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Expose the field names read by Public Transport Departures Card.

    The card expects the original scheduled time and an independent delay value;
    its own display logic adds the delay. All dates stay ISO 8601 with timezone.
    Keep the original German board attributes independent of this adapter.
    """
    departures: list[dict[str, Any]] = []
    for row in rows:
        planned = row.get("plan_abfahrt") or row.get("abfahrt")
        if not planned:
            continue
        departures.append({
            "scheduledDeparture": planned,
            "delayDeparture": row.get("verspaetung_minuten") or 0,
            "isCancelled": bool(row.get("ausfall", False)),
            "train": row.get("linie") or "Bus",
            "destination": row.get("ziel") or "",
            "platform": row.get("steig") or "",
            "via": [stop["name"] for stop in row.get("folgende_haltestellen", [])],
            "realtimeDeparture": row.get("abfahrt") or planned,
            "realtime": bool(row.get("echtzeit", False)),
            "agency": row.get("verkehrsunternehmen") or "",
        })
    return departures


def data_quality(
    data: dict[str, Any] | None,
    *,
    last_update_success: bool = True,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Return localized-neutral data freshness and source quality indicators.

    The time recorded in `zeitpunkt_abfrage` is the time of the last successful
    response, never the time of the last attempted API request.
    """
    now = now or datetime.now(timezone.utc)
    fetched = parse_time((data or {}).get("zeitpunkt_abfrage"))
    seconds_old = max(0, (now - fetched).total_seconds()) if fetched else None
    stale = not last_update_success or seconds_old is None or seconds_old > DATA_STALE_AFTER.total_seconds()
    rows = upcoming(data, now)
    realtime_count = sum(1 for row in rows if row.get("echtzeit") and not row.get("ausfall"))
    schedule_count = sum(1 for row in rows if not row.get("echtzeit") and not row.get("ausfall"))
    return {
        "datenstatus": "stale" if stale and fetched else "unavailable" if not fetched else "fresh",
        "abruf_erfolgreich": bool(last_update_success and fetched),
        "datenalter_minuten": round(seconds_old / 60, 1) if seconds_old is not None else None,
        "letzter_erfolgreicher_abruf": fetched.isoformat() if fetched else None,
        "echtzeit_abfahrten": realtime_count,
        "fahrplan_abfahrten": schedule_count,
    }


# Home Assistant Recorder rejects an entity's entire attribute payload above 16 KiB.
# Use a lower threshold to allow for JSON escaping and future metadata fields.
MAX_RECORDER_ATTRIBUTES_BYTES = 7_500
MAX_COMPACT_ROWS_BYTES = 4_500
MAX_COMPAT_DEPARTURES = 10


def _recorder_bytes(attributes: dict[str, Any]) -> int:
    # ensure_ascii=True is deliberately pessimistic for Unicode and quotes.
    return len(json.dumps(attributes, ensure_ascii=True, separators=(",", ":")).encode("utf-8"))


def _compact_departure(row: dict[str, Any]) -> dict[str, Any]:
    # Full following stops, positions and geometry-related metadata stay in the
    # coordinator and are served to the frontend via an authenticated WebSocket.
    fields = (
        "linie", "fahrt_id", "ziel", "abfahrt", "plan_abfahrt",
        "verspaetung_minuten", "echtzeit", "zeitqualitaet",
        "ausfall", "steig", "verkehrsunternehmen",
        "linienfarbe", "linien_textfarbe",
    )
    compact = {}
    for key in fields:
        value = row.get(key)
        if value is None or value == "":
            continue
        compact[key] = value[:160] if isinstance(value, str) else value
    return compact


def _compact_notice(notice: dict[str, Any]) -> dict[str, Any]:
    # Notice descriptions can be exceptionally long and are not necessary in
    # the recorder. The full, localized notice is available in the frontend.
    fields = ("id", "typ", "titel", "linie", "ziel", "quelle", "verspaetung_minuten", "abfahrt")
    return {key: (value[:160] if isinstance(value, str) else value)
            for key in fields if (value := notice.get(key)) is not None and value != ""}


def _try_append(attributes: dict[str, Any], key: str, item: dict[str, Any], limit: int) -> bool:
    collection = attributes[key]
    collection.append(item)
    if _recorder_bytes(attributes) <= limit:
        return True
    collection.pop()
    return False


def sensor_attributes(data: dict[str, Any] | None, now: datetime | None = None,
                      last_update_success: bool = True) -> dict[str, Any]:
    """Keep Recorder-safe, automation-friendly summaries in sensor state.

    The full set of journey details is held in the coordinator and fetched by
    our Lovelace card on demand. Neither the API data nor the dashboard must
    be truncated to fit the historical state database.
    """
    base = data or {}
    rows = upcoming(base, now)
    current = next_departure(base, now)
    notices = base.get("verkehrshinweise", [])
    if not isinstance(notices, list):
        notices = []
    name = str(base.get("haltestelle") or "")[:160]
    attributes = {
        **data_quality(base, last_update_success=last_update_success, now=now),
        "haltestelle": name,
        "station": name,
        "stop_lat": base.get("stop_lat"),
        "stop_lon": base.get("stop_lon"),
        "abfahrten": [],
        "verkehrshinweise": [],
        "verkehrshinweise_anzahl": len(notices),
        "next_departures": [],
        "abfahrten_gesamt": len(rows),
        "naechste_linie": str(current.get("linie") or "")[:160] if current else None,
        "naechstes_ziel": str(current.get("ziel") or "")[:160] if current else None,
        "naechste_abfahrt": current.get("abfahrt") if current else None,
        "zeitpunkt_abfrage": base.get("zeitpunkt_abfrage"),
        "abfahrten_gekuerzt": False,
        "verkehrshinweise_gekuerzt": False,
    }
    # Reserve some space for compatibility data and short service notices.
    for row in rows:
        if not _try_append(attributes, "abfahrten", _compact_departure(row), MAX_COMPACT_ROWS_BYTES):
            break
    for departure in card_compatible_departures(rows[:MAX_COMPAT_DEPARTURES]):
        # Following-stop names are deliberately not duplicated in Recorder.
        departure["via"] = []
        if not _try_append(attributes, "next_departures", departure, MAX_RECORDER_ATTRIBUTES_BYTES - 2_000):
            break
    for notice in notices:
        if isinstance(notice, dict) and not _try_append(
            attributes, "verkehrshinweise", _compact_notice(notice), MAX_RECORDER_ATTRIBUTES_BYTES
        ):
            break
    attributes["abfahrten_gekuerzt"] = len(attributes["abfahrten"]) < len(rows)
    attributes["verkehrshinweise_gekuerzt"] = len(attributes["verkehrshinweise"]) < len(notices)
    # Conservative final guard for unexpectedly long upstream strings.
    while _recorder_bytes(attributes) > MAX_RECORDER_ATTRIBUTES_BYTES:
        if attributes["verkehrshinweise"]:
            attributes["verkehrshinweise"].pop()
            attributes["verkehrshinweise_gekuerzt"] = True
        elif attributes["next_departures"]:
            attributes["next_departures"].pop()
        elif attributes["abfahrten"]:
            attributes["abfahrten"].pop()
            attributes["abfahrten_gekuerzt"] = True
        else:
            break
    return attributes
