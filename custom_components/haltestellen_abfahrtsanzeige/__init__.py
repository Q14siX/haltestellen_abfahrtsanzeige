"""Bus departure boards for any locality: one selected stop per entry."""
from __future__ import annotations

import logging
from time import perf_counter

from homeassistant.components import websocket_api
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api import TransitousClient, TransitousError
from .const import (
    CONF_BOARD_SIZE, CONF_STOP_ID, CONF_STOP_NAME, DEFAULT_BOARD_SIZE,
    CONF_REFRESH_MODE, DEFAULT_REFRESH_MODE, DOMAIN, UPDATE_INTERVAL,
)
from .dashboard import async_remove_dashboard, async_setup_dashboard
from .departures import convert_stoptimes
from .disruptions import collect_disruptions
from .route_geometry import TripGeometryService, TripGeometryView
from .monitoring import RequestHealth
from .polling import next_failed_poll, next_successful_poll
from .websocket import websocket_get_departures

_LOGGER = logging.getLogger(__name__)
PLATFORMS = ["sensor", "binary_sensor"]


class BusStopCoordinator(DataUpdateCoordinator[dict]):
    """Query an individual stop for all road-based bus departures."""
    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        super().__init__(hass, _LOGGER, name=f"{DOMAIN}_{entry.entry_id}",
                         update_interval=UPDATE_INTERVAL, always_update=True)
        self.entry = entry
        self.api = TransitousClient(async_get_clientsession(hass), language=hass.config.language)
        self.health = RequestHealth()
        self.poll_reason = "initial"

    @property
    def refresh_mode(self) -> str:
        return self.entry.options.get(CONF_REFRESH_MODE, DEFAULT_REFRESH_MODE)

    @property
    def next_poll_estimate(self) -> str | None:
        """Approximate next poll, rounded by Home Assistant's own scheduler."""
        last = self.health.last_attempt_at
        if not last or self.update_interval is None:
            return None
        return (last + self.update_interval).isoformat()

    async def _async_update_data(self) -> dict:
        data = self.entry.data
        started = perf_counter()
        try:
            lat, lon = data.get("stop_lat"), data.get("stop_lon")
            positions = None
            if lat is not None and lon is not None:
                positions = (float(lat), float(lon))
            elif data.get(CONF_STOP_ID):
                positions = await self.api.resolve_legacy_stop(data[CONF_STOP_NAME], data[CONF_STOP_ID])
                self.hass.config_entries.async_update_entry(
                    self.entry, data={**data, "stop_lat": positions[0], "stop_lon": positions[1]},
                )
            raw = await self.api.get_departures(
                data[CONF_STOP_ID], positions,
                self.entry.options.get(CONF_BOARD_SIZE, DEFAULT_BOARD_SIZE),
            )
            converted = convert_stoptimes(
                raw, data[CONF_STOP_NAME],
                limit=self.entry.options.get(CONF_BOARD_SIZE, DEFAULT_BOARD_SIZE),
                stop_position=positions,
            )
            converted["verkehrshinweise"] = collect_disruptions(
                raw, converted["abfahrten"],
                language=str(self.hass.config.language).split("-")[0].split("_")[0].lower(),
            )
        except (TransitousError, ValueError, KeyError, TypeError) as exc:
            self.health.record_failure(
                perf_counter() - started,
                http_status=exc.status_code if isinstance(exc, TransitousError) else None,
                category=(exc.error_category if isinstance(exc, TransitousError) else "data"),
            )
            policy = next_failed_poll(
                self.health.consecutive_failures, self.health.last_http_status,
                exc.retry_after_seconds if isinstance(exc, TransitousError) else None,
            )
            self.update_interval = policy.interval
            self.poll_reason = policy.reason
            # Home Assistant retains the last valid timetable as stale data.
            raise UpdateFailed(f"Transitous stop departure request failed: {exc}") from exc
        self.health.record_success(perf_counter() - started)
        policy = next_successful_poll(
            converted,
            self.entry.options.get(CONF_REFRESH_MODE, DEFAULT_REFRESH_MODE),
        )
        self.update_interval = policy.interval
        self.poll_reason = policy.reason
        return converted


async def _async_update_options(hass: HomeAssistant, entry: ConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    hass.data.setdefault(DOMAIN, {})
    if not hass.data[DOMAIN].get("_route_service"):
        service = TripGeometryService(hass)
        hass.data[DOMAIN]["_route_service"] = service
        hass.http.register_view(TripGeometryView(service))
    websocket_api.async_register_command(hass, websocket_get_departures)
    await async_setup_dashboard(hass)
    return True


async def async_migrate_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Convert legacy origin/destination configuration to origin-stop board."""
    if entry.version > 2:
        return False
    if entry.version == 2:
        return True
    existing = dict(entry.data)
    if "origin_id" in existing:
        new_data = {
            CONF_STOP_ID: existing["origin_id"],
            CONF_STOP_NAME: existing["origin_name"],
            "name": existing.get("origin_name") or entry.title,
        }
        for old, new in (("origin_lat", "stop_lat"), ("origin_lon", "stop_lon")):
            if old in existing:
                new_data[new] = existing[old]
        # HA cannot always change unique_id safely while old entries still exist.
        # Retain the old unique ID; new stop entries use the stop ID itself.
        hass.config_entries.async_update_entry(entry, data=new_data, version=2, title=new_data["name"])
    else:
        hass.config_entries.async_update_entry(entry, version=2)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    hass.data.setdefault(DOMAIN, {})
    coordinator = BusStopCoordinator(hass, entry)
    # Transitous can be unreachable immediately after a Home Assistant restart.
    # A failed first refresh must not prevent sensors from being created.
    # The coordinator will keep retrying at the normal polling interval.
    await coordinator.async_refresh()
    hass.data[DOMAIN][entry.entry_id] = coordinator
    entry.async_on_unload(entry.add_update_listener(_async_update_options))
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    success = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if success:
        hass.data[DOMAIN].pop(entry.entry_id, None)
    return success


async def async_remove_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    if not any(other.entry_id != entry.entry_id for other in hass.config_entries.async_entries(DOMAIN)):
        await async_remove_dashboard(hass)
