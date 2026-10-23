"""Native Home Assistant automation triggers for bus stop departures.

These appear in the visual automation editor. Notifications are only performed
by actions explicitly selected in an automation by the Home Assistant user.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, ClassVar, override

import probatio

from homeassistant.const import CONF_ENTITY_ID, CONF_OPTIONS
from homeassistant.core import CALLBACK_TYPE, HomeAssistant, callback
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.event import (
    async_track_state_change_event,
    async_track_time_interval,
)
from homeassistant.helpers.trigger import (
    Trigger,
    TriggerActionRunner,
    TriggerConfig,
    TriggerNotTriggeredReporter,
)
from homeassistant.helpers.typing import ConfigType

from .automation_rules import (
    DELAY_REACHED,
    DEPARTURE_SOON,
    TRIP_CANCELLED,
    DepartureRuleMonitor,
)
from .const import DOMAIN

CONF_LINE = "line"
CONF_DESTINATION = "destination"
CONF_MINUTES_BEFORE = "minutes_before"
CONF_MINIMUM_DELAY = "minimum_delay"

_COMMON_OPTIONS = {
    probatio.Required(CONF_ENTITY_ID): cv.entity_id,
    probatio.Optional(CONF_LINE, default=""): cv.string,
    probatio.Optional(CONF_DESTINATION, default=""): cv.string,
}


def _schema(threshold_field: str | None) -> probatio.Schema:
    fields = dict(_COMMON_OPTIONS)
    if threshold_field:
        fields[probatio.Optional(threshold_field, default=10 if threshold_field == CONF_MINUTES_BEFORE else 5)] = probatio.All(
            probatio.Coerce(int), probatio.Range(min=1, max=120),
        )
    return probatio.Schema({probatio.Required(CONF_OPTIONS): fields})


class _BusDepartureTrigger(Trigger):
    """Shared event handling for stop-specific, once-per-trip triggers."""

    rule_kind: ClassVar[str]
    threshold_option: ClassVar[str | None] = None
    config_schema: ClassVar[probatio.Schema]

    @classmethod
    @override
    async def async_validate_config(cls, hass: HomeAssistant, config: ConfigType) -> ConfigType:
        """Reject non-stop entities and invalid thresholds."""
        config = cls.config_schema(config)
        entity_id = config[CONF_OPTIONS][CONF_ENTITY_ID]
        entry = er.async_get(hass).async_get(entity_id)
        if entry is None or entry.platform != DOMAIN:
            german = str(hass.config.language).replace("_", "-").split("-")[0].lower() == "de"
            label = ("ist kein Sensor der Haltestellen-Abfahrtsanzeige" if german
                     else "is not a Bus Stop Departure Board sensor")
            raise probatio.Invalid(f"{entity_id} {label}")
        return config

    def __init__(self, hass: HomeAssistant, config: TriggerConfig) -> None:
        super().__init__(hass, config)
        options = config.options or {}
        self._entity_id = options[CONF_ENTITY_ID]
        self._monitor = DepartureRuleMonitor(
            self.rule_kind,
            line=options.get(CONF_LINE, ""),
            destination=options.get(CONF_DESTINATION, ""),
            threshold=int(options.get(self.threshold_option, 10) if self.threshold_option else 10),
        )

    @override
    async def async_attach_runner(
        self,
        run_action: TriggerActionRunner,
        did_not_trigger: TriggerNotTriggeredReporter | None = None,
    ) -> CALLBACK_TYPE:
        """Listen to state changes and periodically evaluate departure times."""

        @callback
        def check_current_departures() -> None:
            state = self._hass.states.get(self._entity_id)
            if state is None or state.state == "unavailable":
                return
            # The sensor exists before its first successful API response.
            # An empty startup placeholder must not establish the rule's
            # baseline; otherwise existing cancellations arriving on the first
            # refresh could be mistaken for newly reported events.
            if not state.attributes.get("zeitpunkt_abfrage"):
                return
            # Cached or stale predictions must never generate fresh alerts.
            if state.attributes.get("datenstatus", "fresh") != "fresh":
                return
            if state.attributes.get("abruf_erfolgreich") is False:
                return
            rows = state.attributes.get("abfahrten")
            if not isinstance(rows, list):
                return
            for payload in self._monitor.evaluate(rows, now=datetime.now(timezone.utc)):
                payload.update({
                    "entity_id": self._entity_id,
                    "stop": state.attributes.get("haltestelle") or state.name,
                    "event_type": self.rule_kind,
                })
                run_action(payload, f"{self.rule_kind}: {payload['line']} → {payload['destination']}")

        @callback
        def state_changed(_event: Any) -> None:
            check_current_departures()

        @callback
        def minute_tick(_now: datetime) -> None:
            check_current_departures()

        unsubscribe_state = async_track_state_change_event(
            self._hass, [self._entity_id], state_changed,
        )
        unsubscribe_timer = async_track_time_interval(
            self._hass, minute_tick, timedelta(seconds=30),
        )
        check_current_departures()  # establish a baseline; do not replay past alerts

        @callback
        def unsubscribe() -> None:
            unsubscribe_state()
            unsubscribe_timer()

        return unsubscribe


class DepartureSoonTrigger(_BusDepartureTrigger):
    """Trigger once per bus when its departure threshold is reached."""

    rule_kind = DEPARTURE_SOON
    threshold_option = CONF_MINUTES_BEFORE
    config_schema = _schema(CONF_MINUTES_BEFORE)


class DelayReachedTrigger(_BusDepartureTrigger):
    """Trigger when a service reaches the selected delay threshold."""

    rule_kind = DELAY_REACHED
    threshold_option = CONF_MINIMUM_DELAY
    config_schema = _schema(CONF_MINIMUM_DELAY)


class TripCancelledTrigger(_BusDepartureTrigger):
    """Trigger when a service is newly reported as cancelled."""

    rule_kind = TRIP_CANCELLED
    config_schema = _schema(None)


TRIGGERS: dict[str, type[Trigger]] = {
    DEPARTURE_SOON: DepartureSoonTrigger,
    DELAY_REACHED: DelayReachedTrigger,
    TRIP_CANCELLED: TripCancelledTrigger,
}


async def async_get_triggers(_hass: HomeAssistant) -> dict[str, type[Trigger]]:
    """Expose the integration's triggers to the Home Assistant editor."""
    return TRIGGERS
