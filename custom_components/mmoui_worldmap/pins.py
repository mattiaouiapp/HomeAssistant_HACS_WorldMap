"""Pin storage and the country lookup behind it."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
import json
import math
from pathlib import Path
from typing import Any
import uuid

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.storage import Store

from .const import COUNTRIES_FILE, SIGNAL_PINS_UPDATED, STORAGE_KEY, STORAGE_VERSION

type Ring = list[tuple[float, float]]

COAST_TOLERANCE = 0.3  # degrees of latitude, about 33 km


@dataclass
class Pin:
    id: str
    name: str
    latitude: float
    longitude: float
    color: str
    country: str | None = None
    country_name: str | None = None
    date: str | None = None
    notes: str = ""
    created: str = field(default_factory=lambda: datetime.now(UTC).isoformat())


@dataclass
class _Country:
    iso: str
    name: str
    name_it: str
    bbox: tuple[float, float, float, float]
    # Each polygon is its outer ring followed by its holes.
    polygons: list[list[Ring]]


def _in_ring(lon: float, lat: float, ring: Ring) -> bool:
    inside = False
    j = len(ring) - 1
    for i, (xi, yi) in enumerate(ring):
        xj, yj = ring[j]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def _distance_to_ring(lon: float, lat: float, ring: Ring, scale: float) -> float:
    """Distance in degrees of latitude, longitudes shrunk by cos(lat)."""
    best = float("inf")
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        ax, ay = (x1 - lon) * scale, y1 - lat
        bx, by = (x2 - lon) * scale, y2 - lat
        dx, dy = bx - ax, by - ay
        length = dx * dx + dy * dy
        t = 0.0 if length == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / length))
        best = min(best, math.hypot(ax + t * dx, ay + t * dy))
    return best


def _load_countries(path: Path) -> list[_Country]:
    data = json.loads(path.read_text(encoding="utf-8"))
    countries = []
    for feature in data["features"]:
        polygons = [
            [[(x, y) for x, y in ring] for ring in polygon]
            for polygon in feature["geometry"]["coordinates"]
        ]
        xs = [x for polygon in polygons for x, _ in polygon[0]]
        ys = [y for polygon in polygons for _, y in polygon[0]]
        props = feature["properties"]
        countries.append(
            _Country(props["iso"], props["name"], props["name_it"], (min(xs), min(ys), max(xs), max(ys)), polygons)
        )
    return countries


def flag_emoji(iso: str | None) -> str:
    if not iso or len(iso) != 2 or not iso.isalpha():
        return ""
    return "".join(chr(0x1F1E6 + ord(c) - ord("A")) for c in iso.upper())


def normalize_longitude(lon: float) -> float:
    """Bring a longitude from a wrapped map copy back into [-180, 180)."""
    return round((lon + 180) % 360 - 180, 6)


class PinStore:
    def __init__(self, hass: HomeAssistant, www: Path) -> None:
        self._hass = hass
        self._store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self._countries_path = www / COUNTRIES_FILE
        self._countries: list[_Country] = []
        self._names: dict[str, _Country] = {}
        self.pins: dict[str, Pin] = {}

    async def async_load(self) -> None:
        self._countries = await self._hass.async_add_executor_job(
            _load_countries, self._countries_path
        )
        self._names = {c.iso: c for c in self._countries}
        stored = await self._store.async_load() or {}
        self.pins = {p["id"]: Pin(**p) for p in stored.get("pins", [])}

    def country_of(self, lat: float, lon: float) -> _Country | None:
        for country in self._countries:
            x0, y0, x1, y1 = country.bbox
            if not (x0 <= lon <= x1 and y0 <= lat <= y1):
                continue
            for outer, *holes in country.polygons:
                if _in_ring(lon, lat, outer) and not any(_in_ring(lon, lat, h) for h in holes):
                    return country
        # The simplified coastlines leave many seaside cities just offshore:
        # fall back to the nearest country within about 30 km.
        scale = math.cos(math.radians(lat))
        nearest, best = None, COAST_TOLERANCE
        for country in self._countries:
            x0, y0, x1, y1 = country.bbox
            if not (x0 - best <= lon <= x1 + best and y0 - best <= lat <= y1 + best):
                continue
            for outer, *_ in country.polygons:
                if (distance := _distance_to_ring(lon, lat, outer, scale)) < best:
                    nearest, best = country, distance
        return nearest

    def country_label(self, pin: Pin) -> str | None:
        """The pin's country name in Home Assistant's language (Italian or English)."""
        country = self._names.get(pin.country or "")
        if not country:
            return pin.country_name
        return country.name_it if self._hass.config.language.startswith("it") else country.name

    def as_list(self) -> list[dict[str, Any]]:
        return [asdict(p) for p in self.pins.values()]

    @callback
    def _changed(self) -> None:
        self._store.async_delay_save(lambda: {"pins": self.as_list()}, 1)
        async_dispatcher_send(self._hass, SIGNAL_PINS_UPDATED)

    def _locate(self, pin: Pin) -> None:
        pin.latitude = round(pin.latitude, 6)
        pin.longitude = normalize_longitude(pin.longitude)
        country = self.country_of(pin.latitude, pin.longitude)
        pin.country = country.iso if country else None
        pin.country_name = country.name if country else None

    @callback
    def async_add(self, **fields: Any) -> Pin:
        pin = Pin(id=uuid.uuid4().hex, **fields)
        self._locate(pin)
        self.pins[pin.id] = pin
        self._changed()
        return pin

    @callback
    def async_update(self, pin_id: str, **fields: Any) -> Pin:
        pin = self.pins[pin_id]
        for key, value in fields.items():
            setattr(pin, key, value)
        if "latitude" in fields or "longitude" in fields:
            self._locate(pin)
        self._changed()
        return pin

    @callback
    def async_remove(self, pin_id: str) -> None:
        del self.pins[pin_id]
        self._changed()
