"""Conservative disruption indicators derived from the existing stop-times response.

No claims about network-wide absence of alerts are made: provider fields and
coverage vary with the local feeds.
"""
from __future__ import annotations

import hashlib
from collections.abc import Mapping
from typing import Any

MAJOR_DELAY_MINUTES = 10
MAX_NOTICES = 20


def _localized(value: Any, language: str) -> str:
    if isinstance(value, str):
        return value.strip()[:800]
    if isinstance(value, Mapping):
        for key in (language, "de", "en", "text", "value", "translation"):
            if key in value:
                found = _localized(value[key], language)
                if found:
                    return found
        return ""
    if isinstance(value, list):
        for item in value:
            found = _localized(item, language)
            if found:
                return found
    return ""


def _explicit_translation(value: Any, language: str) -> str:
    """Only return a translation if the provider explicitly supplied it."""
    if isinstance(value, Mapping):
        for key in (language, language.upper()):
            if key in value:
                return _localized(value[key], language)
    elif isinstance(value, list):
        for item in value:
            if isinstance(item, Mapping) and str(item.get("lang") or item.get("language") or "").lower().startswith(language):
                return _localized(item.get("text") or item.get("value") or item.get("translation"), language)
    return ""


def _provider_notices(source: Any, language: str, *, line: str = "") -> list[dict[str, Any]]:
    """Only use explicit textual provider alerts; never interpret unknown codes."""
    if not isinstance(source, Mapping):
        return []
    collected = []
    for field in ("alerts", "serviceAlerts", "service_alerts", "notices"):
        values = source.get(field)
        if not isinstance(values, list):
            continue
        for item in values:
            if not isinstance(item, Mapping):
                continue
            raw_title = item.get("headerText") or item.get("header") or item.get("title")
            raw_detail = item.get("descriptionText") or item.get("description") or item.get("text")
            title = _localized(raw_title, language)
            detail = _localized(raw_detail, language)
            if not (title or detail):
                continue
            title = title or detail[:100]
            if detail == title:
                detail = ""
            notice = {"typ": "hinweis", "titel": title[:160], "beschreibung": detail,
                      "linie": line, "quelle": "provider"}
            for lang in ("de", "en"):
                title_lang = _explicit_translation(raw_title, lang)
                detail_lang = _explicit_translation(raw_detail, lang)
                if title_lang:
                    notice[f"titel_{lang}"] = title_lang[:160]
                if detail_lang:
                    notice[f"beschreibung_{lang}"] = detail_lang[:800]
            collected.append(notice)
    return collected


def collect_disruptions(raw: dict[str, Any], departures: list[dict[str, Any]],
                        language: str = "de") -> list[dict[str, Any]]:
    """Summarize confirmed trip cancellations/delays and provider textual alerts.

    Summary is based only on the *visible retrieved departures*, not the whole
    transport network. Deduplicates repeated feed messages and caps HA state size.
    """
    results = _provider_notices(raw, language)
    events = raw.get("stopTimes") if isinstance(raw, dict) else None
    if isinstance(events, list):
        for event in events:
            if not isinstance(event, Mapping):
                continue
            if str(event.get("mode", "")).upper() not in ("BUS", "COACH"):
                continue
            line = str(event.get("routeShortName") or event.get("displayName") or "").strip()[:60]
            results.extend(_provider_notices(event, language, line=line))
            results.extend(_provider_notices(event.get("place"), language, line=line))
    for row in departures:
        line = str(row.get("linie") or "Bus")[:60]
        destination = str(row.get("ziel") or "")[:120]
        suffix = f" → {destination}" if destination else ""
        if row.get("ausfall"):
            title = (f"Linie {line}{suffix}: Fahrt fällt aus" if language == "de"
                     else f"Line {line}{suffix}: departure cancelled")
            kind = "ausfall"
        elif isinstance(row.get("verspaetung_minuten"), (int, float)) and not isinstance(row.get("verspaetung_minuten"), bool) and row["verspaetung_minuten"] >= MAJOR_DELAY_MINUTES:
            mins = int(row["verspaetung_minuten"])
            title = (f"Linie {line}{suffix}: {mins} Min. Verspätung" if language == "de"
                     else f"Line {line}{suffix}: {mins} min delay")
            kind = "verspaetung"
        else:
            continue
        results.append({"typ": kind, "titel": title, "beschreibung": "",
                        "linie": line, "ziel": destination,
                        "verspaetung_minuten": int(row["verspaetung_minuten"]) if kind == "verspaetung" else None,
                        "abfahrt": row.get("plan_abfahrt"), "quelle": "stoptimes"})
    unique: dict[str, dict[str, Any]] = {}
    for item in results:
        key = "|".join(str(item.get(k) or "") for k in ("typ", "titel", "beschreibung", "linie", "abfahrt"))
        identifier = hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]
        unique.setdefault(identifier, {"id": identifier, **item})
    return list(unique.values())[:MAX_NOTICES]
