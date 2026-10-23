"""Read-only diagnostic indicators for existing API requests."""
from __future__ import annotations

from homeassistant.components.binary_sensor import BinarySensorDeviceClass, BinarySensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity import EntityCategory
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import CONF_NAME, DOMAIN


def _is_german(hass: HomeAssistant) -> bool:
    return str(hass.config.language).replace("_", "-").split("-")[0].lower() == "de"


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Add one connectivity indicator for the configured stop."""
    async_add_entities([BusDepartureApiHealth(entry, hass.data[DOMAIN][entry.entry_id], _is_german(hass))])


class BusDepartureApiHealth(CoordinatorEntity, BinarySensorEntity):
    """Whether the last scheduled stop-times request succeeded."""

    _attr_entity_category = EntityCategory.DIAGNOSTIC
    _attr_device_class = BinarySensorDeviceClass.CONNECTIVITY
    _attr_has_entity_name = False

    def __init__(self, entry: ConfigEntry, coordinator, german: bool) -> None:
        super().__init__(coordinator)
        self._attr_name = f"{entry.data[CONF_NAME]} – {'API erreichbar' if german else 'API reachable'}"
        self._attr_unique_id = f"{DOMAIN}_{entry.entry_id}_api_health"

    @property
    def available(self) -> bool:
        # CoordinatorEntity marks itself unavailable after errors by default;
        # monitoring must report OFF for failed requests instead.
        return self.coordinator.health.last_request_succeeded is not None

    @property
    def is_on(self) -> bool | None:
        return self.coordinator.health.last_request_succeeded

    @property
    def extra_state_attributes(self) -> dict:
        health = self.coordinator.health
        return {
            "letzter_abruf": health.last_attempt_at.isoformat() if health.last_attempt_at else None,
            "letzter_erfolgreicher_abruf": health.last_success_at.isoformat() if health.last_success_at else None,
            "aufeinanderfolgende_fehler": health.consecutive_failures,
            "letzter_http_status": health.last_http_status,
            "letzte_fehlerkategorie": health.last_error_category,
            "aktualisierungsmodus": self.coordinator.refresh_mode,
            "aktualisierungsintervall_sekunden": int(self.coordinator.update_interval.total_seconds()),
            "aktualisierungsgrund": self.coordinator.poll_reason,
            "naechster_abruf_voraussichtlich": self.coordinator.next_poll_estimate,
        }
