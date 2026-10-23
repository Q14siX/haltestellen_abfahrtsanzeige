"""Authenticated read-only WebSocket endpoint for complete departure board data.

Full timetables do not belong in Recorder state attributes. Fetching over this
connection only reads the already cached coordinator; no Transitous requests.
"""
from __future__ import annotations

from typing import Any

import probatio

from homeassistant.auth.permissions.const import POLICY_READ
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import entity_registry as er

from .const import DOMAIN


@websocket_api.websocket_command(
    {
        probatio.Required("type"): f"{DOMAIN}/get_departures",
        probatio.Required("entity_id"): str,
    }
)
@callback
def websocket_get_departures(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Return full cached departures for an actual stop sensor in this integration."""
    entity_id = msg["entity_id"]
    registry_entry = er.async_get(hass).async_get(entity_id)
    if (
        registry_entry is None
        or registry_entry.platform != DOMAIN
        or registry_entry.domain != "sensor"
        or registry_entry.config_entry_id is None
        or registry_entry.unique_id != f"{DOMAIN}_{registry_entry.config_entry_id}"
    ):
        connection.send_error(msg["id"], websocket_api.ERR_NOT_FOUND, "Unknown departure sensor")
        return
    if not connection.user.permissions.check_entity(entity_id, POLICY_READ):
        connection.send_error(msg["id"], websocket_api.ERR_UNAUTHORIZED, "Access denied")
        return
    coordinator = hass.data.get(DOMAIN, {}).get(registry_entry.config_entry_id)
    if coordinator is None:
        connection.send_error(msg["id"], websocket_api.ERR_NOT_FOUND, "Departure sensor unavailable")
        return
    data = coordinator.data or {}
    connection.send_result(msg["id"], {
        "zeitpunkt_abfrage": data.get("zeitpunkt_abfrage"),
        "abfahrten": data.get("abfahrten", []),
        "verkehrshinweise": data.get("verkehrshinweise", []),
    })
