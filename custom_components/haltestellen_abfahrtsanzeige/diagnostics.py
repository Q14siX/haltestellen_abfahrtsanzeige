"""Privacy-preserving downloadable diagnostics for a configured stop."""
from __future__ import annotations

from typing import Any

from homeassistant.components.diagnostics import async_redact_data
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import (
    API_BASE, CONF_BOARD_SIZE, CONF_STOP_ID, CONF_STOP_NAME, DEFAULT_BOARD_SIZE,
    DOMAIN, CONF_REFRESH_MODE, DEFAULT_REFRESH_MODE, VERSION,
)
from .departures import data_quality, upcoming

_PRIVATE_FIELDS = {
    "stop_id", "stop_name", "name", "stop_lat", "stop_lon",
    "origin_id", "origin_name", "origin_lat", "origin_lon",
    "latitude", "longitude", "lat", "lon", "address", "token", "password",
}


async def async_get_config_entry_diagnostics(
    hass: HomeAssistant, entry: ConfigEntry,
) -> dict[str, Any]:
    """Export health without leaking the stop location or full timetable."""
    coordinator = hass.data.get(DOMAIN, {}).get(entry.entry_id)
    if coordinator is None:
        return {
            "integration": DOMAIN,
            "version": VERSION,
            "loaded": False,
        }

    # Redact rather than omit these keys: their presence helps troubleshoot
    # migrations, while their values can identify someone's home or commute.
    entry_data = {
        field: entry.data.get(field)
        for field in (CONF_STOP_ID, CONF_STOP_NAME, "name", "stop_lat", "stop_lon")
        if field in entry.data
    }
    safe_configuration = async_redact_data(entry_data, _PRIVATE_FIELDS)
    data = coordinator.data
    upcoming_rows = upcoming(data)
    quality = data_quality(data, last_update_success=coordinator.last_update_success)
    return {
        "integration": DOMAIN,
        "version": VERSION,
        "provider": "Transitous/MOTIS",
        "api_endpoint": f"{API_BASE}/api/v6/stoptimes",
        "configuration": safe_configuration,
        "configured_departure_limit": entry.options.get(CONF_BOARD_SIZE, DEFAULT_BOARD_SIZE),
        "poll_mode": coordinator.refresh_mode,
        "poll_interval_seconds": int(coordinator.update_interval.total_seconds()),
        "poll_reason": coordinator.poll_reason,
        "next_poll_estimate": coordinator.next_poll_estimate,
        "coordinator_success": coordinator.last_update_success,
        "quality": quality,
        "requests_since_integration_load": coordinator.health.snapshot(),
        "departure_counts": {
            "upcoming": len(upcoming_rows),
            "cancelled": sum(bool(row.get("ausfall")) for row in upcoming_rows),
            "realtime": sum(bool(row.get("echtzeit")) and not row.get("ausfall") for row in upcoming_rows),
            "schedule_only": sum(not row.get("echtzeit") and not row.get("ausfall") for row in upcoming_rows),
        },
    }
