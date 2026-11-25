"""Stop departure display integration constants."""
from datetime import timedelta

DOMAIN = "haltestellen_abfahrtsanzeige"
API_BASE = "https://api.transitous.org"
API_TIMEOUT = 25
CONF_TRANSPORT_TYPES = "transport_types"
TRANSPORT_MODES = {
    "bus": ("BUS",),
    "coach": ("COACH",),
    "tram": ("TRAM",),
    "suburban": ("SUBURBAN",),
    "subway": ("SUBWAY",),
    "regional_rail": ("REGIONAL_RAIL", "REGIONAL_FAST_RAIL"),
    "long_distance_rail": ("LONG_DISTANCE", "HIGHSPEED_RAIL", "NIGHT_RAIL"),
    "ferry": ("FERRY",),
}
DEPARTURE_MODES = tuple(mode for modes in TRANSPORT_MODES.values() for mode in modes)
DEFAULT_TRANSPORT_TYPES = ("bus", "coach")
DEFAULT_DEPARTURE_MODES = tuple(
    mode for kind in DEFAULT_TRANSPORT_TYPES for mode in TRANSPORT_MODES[kind]
)
CITY_SEARCH_RADIUS_KM = 12.0
UPDATE_INTERVAL = timedelta(minutes=5)
CONF_REFRESH_MODE = "refresh_mode"
REFRESH_MODE_ADAPTIVE = "adaptive"
REFRESH_MODE_ECONOMY = "economy"
REFRESH_MODE_FIXED = "fixed"
DEFAULT_REFRESH_MODE = REFRESH_MODE_ADAPTIVE
ALLOWED_REFRESH_MODES = (REFRESH_MODE_ADAPTIVE, REFRESH_MODE_ECONOMY, REFRESH_MODE_FIXED)
# A successful timetable response older than this is not fresh enough for live alerts.
DATA_STALE_AFTER = timedelta(minutes=15)
CONF_BOARD_SIZE = "board_size"
DEFAULT_BOARD_SIZE = 40
ALLOWED_BOARD_SIZES = (20, 40, 60, 80)
CONF_NAME = "name"
CONF_SEARCH = "search"
CONF_STOP_ID = "stop_id"
CONF_STOP_NAME = "stop_name"
VERSION = "20261023.234716"
BOARD_RESOURCE_PATH = "/haltestellen_abfahrtsanzeige/haltestellen-abfahrtsanzeige.js"
BOARD_RESOURCE_URL = f"{BOARD_RESOURCE_PATH}?v={VERSION}"
