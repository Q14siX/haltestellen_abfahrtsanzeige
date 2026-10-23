"""Place -> stop -> display name; no destination or manual stop identifiers."""
from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.core import callback
from homeassistant.data_entry_flow import FlowResult
from homeassistant.helpers import selector
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import TransitousClient, TransitousError
from .const import (
    ALLOWED_BOARD_SIZES, ALLOWED_REFRESH_MODES, CONF_BOARD_SIZE, CONF_REFRESH_MODE,
    DEFAULT_REFRESH_MODE, CONF_NAME, CONF_SEARCH,
    CONF_STOP_ID, CONF_STOP_NAME, DEFAULT_BOARD_SIZE, DOMAIN,
)


class BusTimetableFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Choose a city and one of its validated stops."""
    VERSION = 2

    def __init__(self) -> None:
        self._choices: dict[str, dict[str, Any]] = {}
        self._town = ""
        self._stop: dict[str, Any] | None = None

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: config_entries.ConfigEntry) -> config_entries.OptionsFlow:
        return BusTimetableOptionsFlow()

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            self._town = str(user_input.get(CONF_SEARCH, "")).strip()
            if len(self._town) < 2:
                errors[CONF_SEARCH] = "invalid_search"
            else:
                try:
                    stops = await TransitousClient(async_get_clientsession(self.hass), language=self.hass.config.language).list_city_stops(self._town)
                except TransitousError:
                    errors["base"] = "cannot_connect"
                else:
                    if stops:
                        self._choices = {s["id"]: s for s in stops}
                        return await self.async_step_select_stop()
                    errors["base"] = "no_stops"
        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema({vol.Required(CONF_SEARCH, default=self._town): selector.TextSelector()}),
            errors=errors,
        )

    async def async_step_select_stop(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        if not self._choices:
            return await self.async_step_user()
        errors: dict[str, str] = {}
        if user_input is not None:
            stop_id = str(user_input.get(CONF_STOP_ID, ""))
            if stop_id in self._choices:
                self._stop = self._choices[stop_id]
                return await self.async_step_confirm()
            errors[CONF_STOP_ID] = "invalid_stop"
        return self.async_show_form(
            step_id="select_stop",
            data_schema=vol.Schema({vol.Required(CONF_STOP_ID): selector.SelectSelector(
                selector.SelectSelectorConfig(
                    options=[selector.SelectOptionDict(value=key, label=value["label"])
                             for key, value in self._choices.items()],
                    mode=selector.SelectSelectorMode.DROPDOWN,
                ),
            )}),
            description_placeholders={"town": self._town, "count": str(len(self._choices))},
            errors=errors,
        )

    async def async_step_confirm(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        if self._stop is None:
            return await self.async_step_user()
        errors: dict[str, str] = {}
        if user_input is not None:
            name = str(user_input.get(CONF_NAME, "")).strip()
            if not name:
                errors[CONF_NAME] = "invalid_name"
            else:
                await self.async_set_unique_id(self._stop["id"])
                self._abort_if_unique_id_configured()
                return self.async_create_entry(
                    title=name,
                    data={
                        CONF_STOP_ID: self._stop["id"],
                        CONF_STOP_NAME: self._stop["name"],
                        CONF_NAME: name,
                        "stop_lat": self._stop["lat"],
                        "stop_lon": self._stop["lon"],
                    },
                )
        return self.async_show_form(
            step_id="confirm",
            data_schema=vol.Schema({vol.Required(
                CONF_NAME, default=self._stop["name"]
            ): selector.TextSelector()}),
            description_placeholders={"stop": self._stop["name"]},
            errors=errors,
        )


class BusTimetableOptionsFlow(config_entries.OptionsFlow):
    """Control the departure limit and adaptive poll cadence for a stop."""
    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        if user_input is not None:
            return self.async_create_entry(data={
                CONF_BOARD_SIZE: int(user_input[CONF_BOARD_SIZE]),
                CONF_REFRESH_MODE: user_input[CONF_REFRESH_MODE],
            })
        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema({
                vol.Required(
                    CONF_BOARD_SIZE,
                    default=self.config_entry.options.get(CONF_BOARD_SIZE, DEFAULT_BOARD_SIZE),
                ): vol.In(ALLOWED_BOARD_SIZES),
                vol.Required(
                    CONF_REFRESH_MODE,
                    default=self.config_entry.options.get(CONF_REFRESH_MODE, DEFAULT_REFRESH_MODE),
                ): selector.SelectSelector(selector.SelectSelectorConfig(
                    options=list(ALLOWED_REFRESH_MODES),
                    translation_key=CONF_REFRESH_MODE,
                    mode=selector.SelectSelectorMode.DROPDOWN,
                )),
            }),
        )
