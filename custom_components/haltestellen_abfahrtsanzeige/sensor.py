"""One departure-board sensor per stop; attributes contain future departures."""
from __future__ import annotations

from datetime import datetime, timedelta

from homeassistant.components.sensor import SensorEntity, SensorDeviceClass
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import UnitOfTime
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity import EntityCategory
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.event import async_track_time_interval
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import CONF_NAME, DOMAIN
from .departures import minutes_until_next, sensor_attributes


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry,
                            async_add_entities: AddConfigEntryEntitiesCallback) -> None:
    coordinator = hass.data[DOMAIN][entry.entry_id]
    german = str(hass.config.language).replace("_", "-").split("-")[0].lower() == "de"
    async_add_entities([
        BusStopSensor(entry, coordinator),
        BusApiDurationSensor(entry, coordinator, german),
    ])


class BusStopSensor(CoordinatorEntity, SensorEntity):
    """Minutes to next usable bus; departure-board rows in state attributes."""
    _attr_has_entity_name = False
    _attr_icon = "mdi:bus-clock"
    _attr_native_unit_of_measurement = UnitOfTime.MINUTES
    # A countdown is a prediction, not a long-term statistical measurement.
    # Keep its native unit stable but opt out of recorder statistics.
    _attr_state_class = None

    def __init__(self, entry: ConfigEntry, coordinator) -> None:
        super().__init__(coordinator)
        self._attr_name = entry.data[CONF_NAME]
        self._attr_unique_id = f"{DOMAIN}_{entry.entry_id}"

    @property
    def available(self) -> bool:
        # Preserve an explicitly labelled stale snapshot if Transitous is
        # temporarily offline. No cached data means unavailable as before.
        return self.coordinator.data is not None

    @property
    def native_value(self) -> int | None:
        return minutes_until_next(self.coordinator.data)

    @property
    def extra_state_attributes(self) -> dict:
        return sensor_attributes(
            self.coordinator.data,
            last_update_success=self.coordinator.last_update_success,
        )

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        self.async_on_remove(async_track_time_interval(
            self.hass, self._handle_minute, timedelta(minutes=1),
        ))

    @callback
    def _handle_minute(self, _now: datetime) -> None:
        # Refresh countdown and freshness locally. Remote requests are scheduled
        # exclusively by the coordinator to respect adaptive limits/backoff.
        self.async_write_ha_state()


class BusApiDurationSensor(CoordinatorEntity, SensorEntity):
    """Elapsed time of the most recent existing departure request."""

    _attr_entity_category = EntityCategory.DIAGNOSTIC
    _attr_device_class = SensorDeviceClass.DURATION
    _attr_native_unit_of_measurement = "ms"
    _attr_state_class = None
    _attr_icon = "mdi:timer-outline"
    _attr_has_entity_name = False

    def __init__(self, entry: ConfigEntry, coordinator, german: bool) -> None:
        super().__init__(coordinator)
        self._attr_name = f"{entry.data[CONF_NAME]} – {'API-Abrufdauer' if german else 'API request duration'}"
        self._attr_unique_id = f"{DOMAIN}_{entry.entry_id}_api_duration"

    @property
    def available(self) -> bool:
        return self.coordinator.health.last_duration_ms is not None

    @property
    def native_value(self) -> float | None:
        return self.coordinator.health.last_duration_ms
    @property
    def extra_state_attributes(self) -> dict:
        return {
            "aktualisierungsmodus": self.coordinator.refresh_mode,
            "aktualisierungsintervall_sekunden": int(self.coordinator.update_interval.total_seconds()),
            "aktualisierungsgrund": self.coordinator.poll_reason,
            "naechster_abruf_voraussichtlich": self.coordinator.next_poll_estimate,
        }

