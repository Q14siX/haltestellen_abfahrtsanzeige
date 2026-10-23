"""Automatic registration of the Haltestellen-Abfahrtsanzeige dashboard card."""

from __future__ import annotations

import logging
from pathlib import Path
from urllib.parse import urlsplit

from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant

from .const import BOARD_RESOURCE_PATH, BOARD_RESOURCE_URL

_LOGGER = logging.getLogger(__name__)


def _resource_collection(hass: HomeAssistant):
    """Return the writable Lovelace resource collection, if enabled."""
    lovelace = hass.data.get("lovelace")
    if lovelace is None:
        _LOGGER.warning("Lovelace is not available; departure board resource was not registered")
        return None

    # Lovelace uses resource_mode since it became independent of dashboard mode.
    mode = getattr(lovelace, "resource_mode", getattr(lovelace, "mode", "storage"))
    if mode != "storage":
        _LOGGER.info(
            "Dashboard resources are managed through YAML; add %s as a module in lovelace.resources",
            BOARD_RESOURCE_PATH,
        )
        return None

    collection = getattr(lovelace, "resources", None)
    if collection is None:
        _LOGGER.warning("Lovelace resource collection is not available")
    return collection


async def _ensure_resources_loaded(collection) -> None:
    """Avoid overwriting existing Lovelace resources before the store is loaded.

    This explicitly handles both recent Home Assistant resource collections with
    async_get_info() and older lazy-loading collections.
    """
    get_info = getattr(collection, "async_get_info", None)
    if callable(get_info):
        await get_info()
    elif not getattr(collection, "loaded", False):
        await collection.async_load()


async def async_setup_dashboard(hass: HomeAssistant) -> None:
    """Serve the JS file and register exactly one versioned Lovelace resource."""
    file_path = Path(__file__).parent / "frontend" / "haltestellen-abfahrtsanzeige.js"
    try:
        await hass.http.async_register_static_paths(
            [StaticPathConfig(BOARD_RESOURCE_PATH, str(file_path), False)]
        )
    except RuntimeError:
        # A path can already be registered on integration reload.
        _LOGGER.debug("Departure board static path is already registered")

    collection = _resource_collection(hass)
    if collection is None:
        return

    try:
        await _ensure_resources_loaded(collection)
        matches = [
            resource
            for resource in collection.async_items()
            if urlsplit(resource.get("url", "")).path == BOARD_RESOURCE_PATH
        ]
        if not matches:
            await collection.async_create_item(
                {"res_type": "module", "url": BOARD_RESOURCE_URL}
            )
            _LOGGER.info("Registered departure board dashboard resource")
            return

        # Reuse the oldest entry and update its URL to invalidate browser caches.
        primary = matches[0]
        if primary.get("url") != BOARD_RESOURCE_URL or primary.get("type", primary.get("res_type")) != "module":
            await collection.async_update_item(
                primary["id"], {"res_type": "module", "url": BOARD_RESOURCE_URL}
            )
            _LOGGER.info("Updated departure board dashboard resource")
        for duplicate in matches[1:]:
            await collection.async_delete_item(duplicate["id"])
            _LOGGER.info("Removed duplicate departure board dashboard resource")
    except Exception:  # Lovelace must not stop route sensors from starting.
        _LOGGER.exception("Could not register the departure board dashboard resource")


async def async_remove_dashboard(hass: HomeAssistant) -> None:
    """Remove the integration's resource after its last route was deleted."""
    collection = _resource_collection(hass)
    if collection is None:
        return
    try:
        await _ensure_resources_loaded(collection)
        for resource in list(collection.async_items()):
            if urlsplit(resource.get("url", "")).path == BOARD_RESOURCE_PATH:
                await collection.async_delete_item(resource["id"])
        _LOGGER.debug("Unregistered departure board dashboard resource")
    except Exception:
        _LOGGER.exception("Could not unregister the departure board dashboard resource")
