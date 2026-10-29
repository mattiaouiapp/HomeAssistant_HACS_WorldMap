from __future__ import annotations

from dataclasses import asdict
from pathlib import Path
from typing import Any

import voluptuous as vol

from homeassistant.components import frontend, websocket_api
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import (
    HomeAssistant,
    ServiceCall,
    ServiceResponse,
    SupportsResponse,
    callback,
)
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.storage import Store
from homeassistant.helpers.typing import ConfigType
from homeassistant.loader import async_get_integration

from .const import (
    ATTR_COLOR,
    ATTR_DATE,
    ATTR_LATITUDE,
    ATTR_LONGITUDE,
    ATTR_NAME,
    ATTR_NOTES,
    ATTR_PIN_ID,
    CARD_FILE,
    DEFAULT_COLOR,
    DOMAIN,
    SIGNAL_PINS_UPDATED,
    STORAGE_KEY,
    STORAGE_VERSION,
    URL_BASE,
)
from .pins import PinStore

PLATFORMS: list[Platform] = [Platform.SENSOR]
WWW = Path(__file__).parent / "www"

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

type WorldMapConfigEntry = ConfigEntry[PinStore]


def _color(value: Any) -> str:
    value = cv.string(value).strip().lower()
    if len(value) == 7 and value[0] == "#" and all(c in "0123456789abcdef" for c in value[1:]):
        return value
    raise vol.Invalid("color must be #rrggbb")


def _date(value: Any) -> str | None:
    if value in (None, ""):
        return None
    return cv.date(value).isoformat()


# Optional fields shared by add and update; add makes name/coordinates required.
_FIELDS = {
    vol.Optional(ATTR_COLOR): _color,
    vol.Optional(ATTR_DATE): vol.Any(None, _date),
    vol.Optional(ATTR_NOTES): vol.All(vol.Any(None, cv.string), lambda v: v or ""),
}
_ADD = {
    vol.Required(ATTR_NAME): vol.All(cv.string, vol.Length(min=1)),
    vol.Required(ATTR_LATITUDE): cv.latitude,
    vol.Required(ATTR_LONGITUDE): vol.Coerce(float),
    **_FIELDS,
}
_UPDATE = {
    vol.Required(ATTR_PIN_ID): cv.string,
    vol.Optional(ATTR_NAME): vol.All(cv.string, vol.Length(min=1)),
    vol.Optional(ATTR_LATITUDE): cv.latitude,
    vol.Optional(ATTR_LONGITUDE): vol.Coerce(float),
    **_FIELDS,
}
_REMOVE = {vol.Required(ATTR_PIN_ID): cv.string}


def _store(hass: HomeAssistant) -> PinStore:
    entries = hass.config_entries.async_loaded_entries(DOMAIN)
    if not entries:
        raise ServiceValidationError(
            translation_domain=DOMAIN, translation_key="not_loaded"
        )
    return entries[0].runtime_data


def _pin_or_raise(store: PinStore, pin_id: str) -> None:
    if pin_id not in store.pins:
        raise ServiceValidationError(
            translation_domain=DOMAIN,
            translation_key="pin_not_found",
            translation_placeholders={"pin_id": pin_id},
        )


def _add(store: PinStore, data: dict[str, Any]) -> dict[str, Any]:
    fields = {k: v for k, v in data.items() if k != "type" and k != "id"}
    fields.setdefault(ATTR_COLOR, DEFAULT_COLOR)
    return asdict(store.async_add(**fields))


def _update(store: PinStore, data: dict[str, Any]) -> dict[str, Any]:
    _pin_or_raise(store, data[ATTR_PIN_ID])
    fields = {k: v for k, v in data.items() if k not in ("type", "id", ATTR_PIN_ID)}
    return asdict(store.async_update(data[ATTR_PIN_ID], **fields))


def _remove(store: PinStore, data: dict[str, Any]) -> None:
    _pin_or_raise(store, data[ATTR_PIN_ID])
    store.async_remove(data[ATTR_PIN_ID])


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    version = (await async_get_integration(hass, DOMAIN)).version
    await hass.http.async_register_static_paths(
        [StaticPathConfig(URL_BASE, str(WWW), cache_headers=True)]
    )
    # The version query busts the browser cache after an update.
    frontend.add_extra_js_url(hass, f"{URL_BASE}/{CARD_FILE}?v={version}")

    for command in (ws_subscribe, ws_add, ws_update, ws_remove):
        websocket_api.async_register_command(hass, command)

    async def add_pin(call: ServiceCall) -> ServiceResponse:
        return _add(_store(hass), dict(call.data))

    async def update_pin(call: ServiceCall) -> ServiceResponse:
        return _update(_store(hass), dict(call.data))

    async def remove_pin(call: ServiceCall) -> None:
        _remove(_store(hass), dict(call.data))

    hass.services.async_register(
        DOMAIN, "add_pin", add_pin, vol.Schema(_ADD), SupportsResponse.OPTIONAL
    )
    hass.services.async_register(
        DOMAIN, "update_pin", update_pin, vol.Schema(_UPDATE), SupportsResponse.OPTIONAL
    )
    hass.services.async_register(DOMAIN, "remove_pin", remove_pin, vol.Schema(_REMOVE))
    return True


async def async_setup_entry(hass: HomeAssistant, entry: WorldMapConfigEntry) -> bool:
    store = PinStore(hass, WWW)
    await store.async_load()
    entry.runtime_data = store
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: WorldMapConfigEntry) -> bool:
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)


async def async_remove_entry(hass: HomeAssistant, entry: WorldMapConfigEntry) -> None:
    await Store(hass, STORAGE_VERSION, STORAGE_KEY).async_remove()


def _ws_store(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg_id: int):
    try:
        return _store(hass)
    except ServiceValidationError:
        connection.send_error(msg_id, "not_loaded", "MMOUi World Map is not set up")
        return None


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/subscribe"})
@callback
def ws_subscribe(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Send the pins now and again after every change."""
    if not (store := _ws_store(hass, connection, msg["id"])):
        return

    @callback
    def forward() -> None:
        connection.send_message(
            websocket_api.event_message(msg["id"], {"pins": store.as_list()})
        )

    connection.subscriptions[msg["id"]] = async_dispatcher_connect(
        hass, SIGNAL_PINS_UPDATED, forward
    )
    connection.send_result(msg["id"])
    forward()


def _ws_write(command: str, schema: dict, action):
    @websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/{command}", **schema})
    @callback
    def handler(
        hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
    ) -> None:
        if not (store := _ws_store(hass, connection, msg["id"])):
            return
        try:
            result = action(store, msg)
        except ServiceValidationError:
            connection.send_error(msg["id"], "not_found", "Pin not found")
            return
        connection.send_result(msg["id"], result)

    return handler


ws_add = _ws_write("add", _ADD, _add)
ws_update = _ws_write("update", _UPDATE, _update)
ws_remove = _ws_write("remove", _REMOVE, _remove)
