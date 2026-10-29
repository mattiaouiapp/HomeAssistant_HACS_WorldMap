from __future__ import annotations

DOMAIN = "mmoui_worldmap"
STORAGE_KEY = f"{DOMAIN}.pins"
STORAGE_VERSION = 1

# Card, Leaflet and country boundaries are served from www/ under this path.
URL_BASE = f"/{DOMAIN}"
CARD_FILE = "worldmap-card.js"
COUNTRIES_FILE = "countries.geojson"

SIGNAL_PINS_UPDATED = f"{DOMAIN}_pins_updated"

ATTR_PIN_ID = "pin_id"
ATTR_NAME = "name"
ATTR_LATITUDE = "latitude"
ATTR_LONGITUDE = "longitude"
ATTR_COLOR = "color"
ATTR_DATE = "date"
ATTR_NOTES = "notes"
ATTR_MAP = "map"

DEFAULT_COLOR = "#e53935"
# Flags are grouped in maps (e.g. travels, airports); this one has the plain entity IDs.
DEFAULT_MAP = "default"
