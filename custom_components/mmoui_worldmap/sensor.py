from __future__ import annotations

from typing import Any

from homeassistant.components.sensor import SensorEntity, SensorStateClass
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from . import WorldMapConfigEntry
from .const import DEFAULT_MAP, DOMAIN, SIGNAL_PINS_UPDATED
from .pins import PinStore, flag_emoji


async def async_setup_entry(
    hass: HomeAssistant,
    entry: WorldMapConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    store = entry.runtime_data
    added: set[str] = set()

    @callback
    def add_new_maps() -> None:
        new = store.maps() - added
        added.update(new)
        async_add_entities(
            sensor(entry, map_id) for map_id in sorted(new) for sensor in (PlacesSensor, CountriesSensor)
        )

    add_new_maps()
    # A flag on a new map brings that map's sensors.
    entry.async_on_unload(async_dispatcher_connect(hass, SIGNAL_PINS_UPDATED, add_new_maps))


class _WorldMapSensor(SensorEntity):
    _attr_has_entity_name = True
    _attr_should_poll = False
    _attr_state_class = SensorStateClass.MEASUREMENT
    _key: str

    def __init__(self, entry: WorldMapConfigEntry, map_id: str) -> None:
        self._pins: PinStore = entry.runtime_data
        self._map = map_id
        # Fixed IDs, whatever the language, so dashboards and templates work everywhere.
        if map_id == DEFAULT_MAP:
            self._attr_translation_key = self._key
            self._attr_unique_id = f"{entry.entry_id}_{self._key}"
            self.entity_id = f"sensor.worldmap_{self._key}"
        else:
            self._attr_translation_key = f"map_{self._key}"
            self._attr_translation_placeholders = {"map": map_id.replace("_", " ").capitalize()}
            self._attr_unique_id = f"{entry.entry_id}_{map_id}_{self._key}"
            self.entity_id = f"sensor.worldmap_{map_id}_{self._key}"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.entry_id)},
            name="World Map",
            manufacturer="MMOUi",
            entry_type=DeviceEntryType.SERVICE,
        )
        self._refresh()

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(
            async_dispatcher_connect(self.hass, SIGNAL_PINS_UPDATED, self._handle_update)
        )

    @callback
    def _handle_update(self) -> None:
        self._refresh()
        self.async_write_ha_state()

    def _refresh(self) -> None:
        raise NotImplementedError


class PlacesSensor(_WorldMapSensor):
    _key = "places"
    _attr_icon = "mdi:map-marker-multiple"
    # The full list is for dashboards; it would bloat the recorder at every change.
    _unrecorded_attributes = frozenset({"places"})

    def _refresh(self) -> None:
        # Newest trip first; flags without a date go last, newest added first.
        pins = sorted(
            self._pins.of_map(self._map),
            key=lambda p: (p.date is not None, p.date or "", p.created),
            reverse=True,
        )
        self._attr_native_value = len(pins)
        places = [
            {
                "id": p.id,
                "name": p.name,
                "country": self._pins.country_label(p),
                "country_code": p.country,
                "flag": flag_emoji(p.country),
                "color": p.color,
                "date": p.date,
                "notes": p.notes,
            }
            for p in pins
        ]
        last = places[0] if places else None
        self._attr_extra_state_attributes: dict[str, Any] = {
            "last_place": last["name"] if last else None,
            "last_country": last["country"] if last else None,
            "places": places,
        }


class CountriesSensor(_WorldMapSensor):
    _key = "countries"
    _attr_icon = "mdi:earth"

    def _refresh(self) -> None:
        countries = {
            p.country: self._pins.country_label(p) for p in self._pins.of_map(self._map) if p.country
        }
        self._attr_native_value = len(countries)
        self._attr_extra_state_attributes = {
            "countries": sorted(countries.values()),
            "codes": sorted(countries),
        }
