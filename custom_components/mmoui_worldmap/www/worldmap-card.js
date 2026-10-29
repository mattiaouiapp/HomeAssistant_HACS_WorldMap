/* MMOUi World Map card: a Leaflet world map with coloured flags on the places
 * you visited and the countries that hold at least one flag highlighted. */

// Works as a module (auto-loaded by the integration) and as a plain script
// (a Lovelace resource of type "JavaScript"), and loading it twice is harmless.
(() => {
if (customElements.get("worldmap-card")) return;

// Keep in step with the version in manifest.json.
const VERSION = "1.3.0";
const BASE = "/mmoui_worldmap/";
const asset = (file) => `${BASE}${file}?v=${VERSION}`;

const PALETTE = [
  "#e53935", "#fb8c00", "#fdd835", "#43a047", "#00897b",
  "#1e88e5", "#3949ab", "#8e24aa", "#d81b60", "#6d4c41", "#546e7a", "#212121",
];

const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";
const ESRI_ATTRIBUTION = "Tiles &copy; Esri";
const TILES = {
  light: {
    url: `${ESRI}/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
    labels: `${ESRI}/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
    attribution: ESRI_ATTRIBUTION, maxZoom: 16,
  },
  dark: {
    url: `${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
    labels: `${ESRI}/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
    attribution: ESRI_ATTRIBUTION, maxZoom: 16,
  },
  streets: {
    url: `${ESRI}/World_Street_Map/MapServer/tile/{z}/{y}/{x}`,
    attribution: ESRI_ATTRIBUTION, maxZoom: 18,
  },
  osm: {
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 19,
  },
  satellite: {
    url: `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`,
    attribution: ESRI_ATTRIBUTION, maxZoom: 18,
  },
};

const STRINGS = {
  en: {
    title: "My travels", places: "places", countries: "countries", search: "Search a place…",
    no_results: "No results", name: "Name", color: "Color", date: "Date", date_from: "From", date_to: "To (optional)", notes: "Notes", rating: "Rating",
    date_range: "The end date is before the start date",
    save: "Save", cancel: "Cancel", edit: "Edit", delete: "Delete", confirm_delete: "Delete this flag?",
    yes_delete: "Yes, delete", add_here: "New flag", not_loaded: "Set up the MMOUi World Map integration first.",
    error: "Error", all: "All", unknown_place: "New place", filter: "Show",
  },
  it: {
    title: "I miei viaggi", places: "luoghi", countries: "paesi", search: "Cerca un luogo…",
    no_results: "Nessun risultato", name: "Nome", color: "Colore", date: "Data", date_from: "Dal", date_to: "Al (facoltativo)", notes: "Note", rating: "Voto",
    date_range: "La data di fine è prima della data di inizio",
    save: "Salva", cancel: "Annulla", edit: "Modifica", delete: "Elimina", confirm_delete: "Eliminare questa bandierina?",
    yes_delete: "Sì, elimina", add_here: "Nuova bandierina", not_loaded: "Configura prima l'integrazione MMOUi World Map.",
    error: "Errore", all: "Tutti", unknown_place: "Nuovo luogo", filter: "Mostra",
  },
};

let leafletPromise;
let leafletCss;
let countriesPromise;
let airportsPromise;
const NOMINATIM_CACHE = new Map();

function loadLeaflet() {
  leafletPromise ??= new Promise((resolve, reject) => {
    if (window.L) return resolve(window.L);
    const script = document.createElement("script");
    script.src = asset("leaflet/leaflet.js");
    script.onload = () => resolve(window.L);
    script.onerror = reject;
    document.head.appendChild(script);
  });
  leafletCss ??= fetch(asset("leaflet/leaflet.css")).then((r) => r.text());
  return Promise.all([leafletPromise, leafletCss]);
}

function loadCountries() {
  countriesPromise ??= fetch(asset("countries.geojson")).then((r) => r.json());
  return countriesPromise;
}

// Airports with an IATA code that are large, medium or have scheduled flights (OurAirports).
function loadAirports() {
  airportsPromise ??= fetch(asset("airports.json")).then((r) => r.json()).then((data) =>
    data.airports.map(([iata, icao, name, city, country, lat, lon, size, keywords]) => ({
      iata, icao, name, city, country, lat, lon, size,
      text: fold(`${name} ${city} ${keywords}`),
    })));
  return airportsPromise;
}

const fold = (text) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

// Words people type around an airport name that never appear in the data.
const AIRPORT_WORDS = /\b(aeroporto|aeroporti|airport|airports|aeropuerto|aeroport|aéroport|flughafen|di|de|del|of|the)\b/g;

function airportLabel(a) {
  const short = a.name
    .replace(/\s*\b(International\s+)?Airport\b/gi, "")
    .replace(/\s+,/g, ",").replace(/^[,\s]+|[,\s]+$/g, "").trim();
  return `${short || a.name} (${a.iata})`;
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2
    + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

function searchAirports(airports, query) {
  const code = query.trim().toUpperCase();
  const words = fold(query).replace(AIRPORT_WORDS, " ").split(/\s+/).filter((w) => w.length > 1);
  const scored = [];
  for (const a of airports) {
    let score;
    if (a.iata === code || a.icao === code) score = 0;
    else if (words.length && words.every((w) => a.text.includes(w))) {
      score = words.every((w) => fold(a.city).startsWith(w) || fold(a.name).startsWith(w)) ? 1 : 2;
    } else continue;
    scored.push([score, -a.size, a]);
  }
  scored.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  return scored.slice(0, 8).map((x) => x[2]);
}

function airportsNear(airports, lat, lon, km) {
  return airports
    .map((a) => [distanceKm(lat, lon, a.lat, a.lon), a])
    .filter(([d]) => d <= km)
    .sort((x, y) => (y[1].size - x[1].size) || (x[0] - y[0]))
    .map(([, a]) => a);
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "onclick") {
      // A button that re-renders its own popup leaves a detached target, which
      // Leaflet would read as a click on the map and close the popup.
      node.addEventListener("click", (ev) => { ev.stopPropagation(); value(ev); });
    } else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (key === "class") node.className = value;
    else if (value !== undefined && value !== null && value !== false) node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child !== null && child !== undefined && child !== false) {
      node.append(child instanceof Node ? child : document.createTextNode(child));
    }
  }
  return node;
}

function flagEmoji(iso) {
  if (!iso || !/^[A-Z]{2}$/.test(iso)) return "";
  return String.fromCodePoint(...[...iso].map((c) => 0x1f1a5 + c.charCodeAt(0)));
}

function flagSvg(color) {
  return `<svg viewBox="0 0 32 40" width="32" height="40" aria-hidden="true">
    <ellipse cx="7" cy="38" rx="5" ry="1.6" fill="rgba(0,0,0,.3)"/>
    <rect x="5.5" y="3" width="3" height="35" rx="1.5" fill="#37474f"/>
    <path d="M8.5 4 C15 1 20 8 30 4 L30 20 C20 24 15 17 8.5 20 Z" fill="${color}" stroke="rgba(0,0,0,.35)" stroke-width="1"/>
  </svg>`;
}

function inRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function nearestVertex(lon, lat, ring) {
  const scale = Math.cos((lat * Math.PI) / 180);
  let best = Infinity;
  for (const [x, y] of ring) best = Math.min(best, Math.hypot((x - lon) * scale, y - lat));
  return best;
}

function hearts(rating) {
  return rating ? "♥".repeat(rating) + "♡".repeat(5 - rating) : "";
}

// Keep HA's dashboard shortcuts (e, c, m, …) away from the card's inputs.
function isolateKeys(node) {
  for (const type of ["keydown", "keyup", "keypress"]) {
    node.addEventListener(type, (ev) => ev.stopPropagation());
  }
  return node;
}

class WorldMapCard extends HTMLElement {
  static getStubConfig() {
    return {};
  }

  static getConfigElement() {
    return document.createElement("worldmap-card-editor");
  }

  setConfig(config) {
    const map = String(config.map || "default").trim().toLowerCase();
    if (!/^[a-z0-9_]{1,32}$/.test(map)) throw new Error("map: use lowercase letters, digits or _");
    const previousMap = this._config?.map;
    this._config = {
      height: 450,
      tiles: "auto",
      show_countries: true,
      country_opacity: 0.35,
      readonly: false,
      airports: false,
      rating: false,
      poi: false,
      ...config,
      map,
    };
    if (this._map) this._rebuild(previousMap !== map);
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) this._init();
    else if (this._map && this._tilesKey() !== this._currentTiles) this._applyTiles();
  }

  getCardSize() {
    return Math.ceil((this._config?.height || 450) / 50) + 1;
  }

  getGridOptions() {
    return { columns: 12, rows: "auto", min_columns: 6 };
  }

  _t(key) {
    const lang = (this._hass?.locale?.language || this._hass?.language || "en").slice(0, 2);
    return (STRINGS[lang] || STRINGS.en)[key];
  }

  _lang() {
    return (this._hass?.locale?.language || this._hass?.language || "en").slice(0, 2);
  }

  connectedCallback() {
    if (this._hass && !this._unsub && this._map) this._subscribe();
    if (this._map) setTimeout(() => this._map.invalidateSize(), 0);
  }

  disconnectedCallback() {
    this._unsubscribe();
  }

  async _init() {
    this._pins = [];
    this._hidden = new Set();
    this.attachShadow({ mode: "open" });
    const [L, css] = await loadLeaflet();
    this._L = L;
    this.shadowRoot.append(el("style", {}, css), el("style", {}, CARD_CSS));
    this._buildDom();
    this._buildMap();
    this._subscribe();
    if (this._config.show_countries) {
      loadCountries().then((geo) => {
        this._geo = geo;
        this._renderCountries();
      });
    }
  }

  _rebuild(mapChanged) {
    if (mapChanged) {
      this._unsubscribe();
      this._pins = [];
      this._hidden.clear();
    }
    this._map.remove();
    this._map = null;
    this.shadowRoot.replaceChildren(this.shadowRoot.children[0], this.shadowRoot.children[1]);
    this._buildDom();
    this._buildMap();
    this._render();
    if (mapChanged) this._subscribe();
    if (this._config.show_countries) loadCountries().then((geo) => { this._geo = geo; this._renderCountries(); });
  }

  _buildDom() {
    const c = this._config;
    this._stats = el("div", { class: "stats" });
    this._results = el("div", { class: "results", hidden: true });
    this._search = isolateKeys(el("input", {
      type: "search",
      placeholder: this._t("search"),
      onkeydown: (ev) => { if (ev.key === "Enter") this._doSearch(); if (ev.key === "Escape") this._results.hidden = true; },
      oninput: () => { clearTimeout(this._searchTimer); this._searchTimer = setTimeout(() => this._doSearch(), 600); },
    }));
    this._mapEl = el("div", { class: "map", style: `height:${parseInt(c.height, 10) || 450}px` });
    this._filters = el("div", { class: "filters" });
    this._message = el("div", { class: "message", hidden: true });
    this.shadowRoot.append(
      el("ha-card", {},
        el("div", { class: "header" },
          el("div", { class: "title-block" },
            el("div", { class: "title" }, c.title ?? this._t("title")),
            this._stats),
          c.readonly ? null : el("div", { class: "search" }, this._search, this._results)),
        this._message,
        this._mapEl,
        this._filters));
  }

  _buildMap() {
    const L = this._L;
    const c = this._config;
    this._map = L.map(this._mapEl, {
      worldCopyJump: true,
      minZoom: 1,
      zoomControl: true,
    }).setView(c.center || [30, 10], c.zoom ?? 2);
    // Place names above the highlighted countries, under the flags.
    const labels = this._map.createPane("labels");
    labels.style.zIndex = 450;
    labels.style.pointerEvents = "none";
    this._applyTiles();
    this._countryLayer = L.layerGroup().addTo(this._map);
    this._markerLayer = L.layerGroup().addTo(this._map);
    this._fitted = Boolean(c.center);

    // A click that only closes an open popup must not open the add form too.
    this._map.on("preclick", () => { this._popupWasOpen = Boolean(this._map._popup?.isOpen()); });
    this._map.on("click", (ev) => {
      if (this._config.readonly || this._popupWasOpen) return;
      this._openForm(ev.latlng.wrap());
    });
    new ResizeObserver(() => this._map?.invalidateSize()).observe(this._mapEl);
  }

  _tilesKey() {
    const c = this._config;
    if (c.tile_url) return "custom";
    if (c.tiles === "auto") return this._hass?.themes?.darkMode ? "dark" : "light";
    return TILES[c.tiles] ? c.tiles : "light";
  }

  _applyTiles() {
    const key = this._tilesKey();
    const tiles = key === "custom"
      ? { url: this._config.tile_url, attribution: this._config.tile_attribution || "", maxZoom: 18 }
      : TILES[key];
    this._tileLayer?.remove();
    this._tileLayer = this._L.layerGroup([
      this._L.tileLayer(tiles.url, { attribution: tiles.attribution, maxZoom: tiles.maxZoom }),
      ...(tiles.labels ? [this._L.tileLayer(tiles.labels, { maxZoom: tiles.maxZoom, pane: "labels" })] : []),
    ]).addTo(this._map);
    this._map.setMaxZoom(tiles.maxZoom);
    this._currentTiles = key;
  }

  async _subscribe() {
    if (this._unsub || !this._hass) return;
    const pending = this._hass.connection.subscribeMessage(
      (msg) => { this._pins = msg.pins; this._message.hidden = true; this._render(); },
      { type: "mmoui_worldmap/subscribe", map: this._config.map },
    );
    this._unsub = pending;
    try {
      await pending;
    } catch (err) {
      this._unsub = null;
      this._showMessage(err?.code === "not_loaded" ? this._t("not_loaded") : `${this._t("error")}: ${err?.message || err}`);
    }
  }

  _unsubscribe() {
    const pending = this._unsub;
    this._unsub = null;
    pending?.then((unsub) => unsub()).catch(() => {});
  }

  _showMessage(text) {
    this._message.textContent = text;
    this._message.hidden = false;
  }

  _countryName(iso, fallback) {
    if (this._lang() === "it" && this._geo) {
      const feature = this._geo.features.find((f) => f.properties.iso === iso);
      if (feature) return feature.properties.name_it;
    }
    return fallback;
  }

  _visible() {
    return this._pins.filter((p) => !this._hidden.has(p.color));
  }

  _render() {
    if (!this._map) return;
    const L = this._L;
    this._markerLayer.clearLayers();
    for (const pin of this._visible()) {
      const marker = L.marker([pin.latitude, pin.longitude], {
        icon: L.divIcon({ className: "flag", html: flagSvg(pin.color), iconSize: [32, 40], iconAnchor: [7, 38], popupAnchor: [10, -34] }),
        title: pin.name,
        riseOnHover: true,
      });
      const tip = this._config.rating && pin.rating ? `${pin.name} ${hearts(pin.rating)}` : pin.name;
      marker.bindTooltip(tip, { direction: "top", offset: [10, -34], className: "pin-tip" });
      marker.on("click", () => this._openDetails(pin, marker));
      this._markerLayer.addLayer(marker);
    }

    const countries = new Set(this._pins.map((p) => p.country).filter(Boolean));
    this._stats.textContent = `${this._pins.length} ${this._t("places")} · ${countries.size} ${this._t("countries")}`;
    this._renderFilters();
    this._renderCountries();

    if (!this._fitted && this._pins.length) {
      this._fitted = true;
      const bounds = L.latLngBounds(this._pins.map((p) => [p.latitude, p.longitude]));
      this._map.fitBounds(bounds.pad(0.3), { maxZoom: 5 });
    }
  }

  _renderFilters() {
    const colors = [...new Set(this._pins.map((p) => p.color))];
    this._filters.replaceChildren();
    this._filters.hidden = colors.length < 2;
    if (colors.length < 2) return;
    this._filters.append(el("span", { class: "label" }, this._t("filter")));
    for (const color of colors) {
      const count = this._pins.filter((p) => p.color === color).length;
      this._filters.append(el("button", {
        class: `chip${this._hidden.has(color) ? " off" : ""}`,
        title: color,
        onclick: () => {
          if (this._hidden.has(color)) this._hidden.delete(color);
          else this._hidden.add(color);
          this._render();
        },
      }, el("span", { class: "dot", style: `background:${color}` }), String(count)));
    }
  }

  _renderCountries() {
    if (!this._map || !this._geo || !this._config.show_countries) return;
    // Light up only the piece of the country that holds a flag: Paris lights
    // mainland France, not Corsica or French Guiana.
    const counts = {};
    const parts = new Map();
    for (const pin of this._visible()) {
      if (!pin.country) continue;
      counts[pin.country] = (counts[pin.country] || 0) + 1;
      const part = this._partOf(pin);
      if (part) parts.set(part.key, part);
    }
    const color = this._config.country_color
      || getComputedStyle(this).getPropertyValue("--primary-color").trim() || "#03a9f4";
    this._countryLayer.clearLayers();
    const layer = this._L.geoJSON(
      {
        type: "FeatureCollection",
        features: [...parts.values()].map(({ props, polygon }) => ({
          type: "Feature", properties: props, geometry: { type: "Polygon", coordinates: polygon },
        })),
      },
      {
        interactive: true,
        style: { color, weight: 1, opacity: 0.7, fillColor: color, fillOpacity: Number(this._config.country_opacity) },
        onEachFeature: (feature, lyr) => {
          const p = feature.properties;
          const name = this._lang() === "it" ? p.name_it : p.name;
          lyr.bindTooltip(`${flagEmoji(p.iso)} ${name} · ${counts[p.iso]}`, { sticky: true });
        },
      },
    );
    this._countryLayer.addLayer(layer);
  }

  // The polygon of the pin's country that contains it, or the nearest one for
  // a pin just off the coast. Cached per pin position.
  _partOf(pin) {
    this._partCache ??= new Map();
    const cacheKey = `${pin.country}:${pin.latitude}:${pin.longitude}`;
    if (this._partCache.has(cacheKey)) return this._partCache.get(cacheKey);
    const lon = pin.longitude;
    const lat = pin.latitude;
    let best = null;
    let bestDistance = Infinity;
    this._geo.features.forEach((feature, f) => {
      if (feature.properties.iso !== pin.country) return;
      feature.geometry.coordinates.forEach((polygon, i) => {
        const [outer, ...holes] = polygon;
        const distance = inRing(lon, lat, outer) && !holes.some((h) => inRing(lon, lat, h))
          ? 0
          : nearestVertex(lon, lat, outer);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = { key: `${f}:${i}`, props: feature.properties, polygon };
        }
      });
    });
    this._partCache.set(cacheKey, best);
    return best;
  }

  _openDetails(pin, marker) {
    const country = pin.country ? `${flagEmoji(pin.country)} ${this._countryName(pin.country, pin.country_name)}` : "";
    const day = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString(this._hass.locale?.language || undefined);
    const date = pin.date ? (pin.date_end ? `${day(pin.date)} – ${day(pin.date_end)}` : day(pin.date)) : "";
    const actions = el("div", { class: "actions" });
    const content = el("div", { class: "details" },
      el("div", { class: "name" }, el("span", { class: "dot", style: `background:${pin.color}` }), pin.name),
      country ? el("div", { class: "meta" }, country) : null,
      date ? el("div", { class: "meta" }, date) : null,
      this._config.rating && pin.rating ? el("div", { class: "hearts", title: `${pin.rating}/5` }, hearts(pin.rating)) : null,
      pin.notes ? el("div", { class: "notes" }, pin.notes) : null,
      this._config.readonly ? null : actions);

    const showButtons = () => actions.replaceChildren(
      el("button", { onclick: () => this._openForm(L_latlng(pin), pin) }, this._t("edit")),
      el("button", { class: "danger", onclick: showConfirm }, this._t("delete")));
    const showConfirm = () => actions.replaceChildren(
      el("span", { class: "confirm" }, this._t("confirm_delete")),
      el("button", { class: "danger", onclick: () => this._call({ type: "mmoui_worldmap/remove", pin_id: pin.id }).then(() => this._map.closePopup()) }, this._t("yes_delete")),
      el("button", { onclick: showButtons }, this._t("cancel")));
    const L_latlng = (p) => this._L.latLng(p.latitude, p.longitude);
    showButtons();

    marker.bindPopup(content, { minWidth: 200, maxWidth: 280 }).openPopup();
    marker.once("popupclose", () => marker.unbindPopup());
  }

  _openForm(latlng, pin = null, suggestedName = "") {
    let color = pin?.color || this._lastColor() || this._config.default_color || PALETTE[0];
    const name = isolateKeys(el("input", { type: "text", value: pin?.name || suggestedName, placeholder: this._t("name"), required: true }));
    const date = isolateKeys(el("input", { type: "date", value: pin?.date || "" }));
    const dateEnd = isolateKeys(el("input", { type: "date", value: pin?.date_end || "", min: pin?.date || undefined }));
    // The end can't come before the start; an end without a start makes no sense.
    const syncDates = () => {
      dateEnd.min = date.value;
      dateEnd.disabled = !date.value;
      if (!date.value || (dateEnd.value && dateEnd.value < date.value)) dateEnd.value = "";
    };
    date.addEventListener("change", syncDates);
    syncDates();
    // 1-5 hearts; tapping the current one again clears the rating.
    let rating = pin?.rating || null;
    const ratingRow = el("div", { class: "rating-input" }, el("span", { class: "label" }, this._t("rating")));
    const paintHearts = () => ratingRow.querySelectorAll("button").forEach((b, i) => {
      b.textContent = rating && i < rating ? "♥" : "♡";
      b.classList.toggle("on", Boolean(rating && i < rating));
    });
    for (let i = 1; i <= 5; i++) {
      ratingRow.append(el("button", {
        type: "button", title: `${i}/5`,
        onclick: () => { rating = rating === i ? null : i; paintHearts(); },
      }, "♡"));
    }
    paintHearts();
    const notes = isolateKeys(el("textarea", { rows: 2, placeholder: this._t("notes") }));
    notes.value = pin?.notes || "";
    const custom = el("input", { type: "color", value: color, title: this._t("color") });
    const swatches = el("div", { class: "swatches" });
    const paint = () => {
      for (const sw of swatches.querySelectorAll(".swatch")) sw.classList.toggle("selected", sw.dataset.color === color);
      custom.classList.toggle("selected", !PALETTE.includes(color));
      preview.innerHTML = flagSvg(color);
    };
    const preview = el("span", { class: "preview" });
    for (const c of PALETTE) {
      swatches.append(el("button", { type: "button", class: "swatch", "data-color": c, style: `background:${c}`, title: c, onclick: () => { color = c; paint(); } }));
    }
    custom.addEventListener("input", () => { color = custom.value; paint(); });
    swatches.append(custom);

    const error = el("div", { class: "form-error", hidden: true });
    const save = el("button", { type: "submit", class: "primary" }, this._t("save"));
    const form = el("form", { class: "pin-form" },
      el("div", { class: "form-title" }, preview, pin ? this._t("edit") : this._t("add_here")),
      name, swatches,
      el("div", { class: "dates" },
        el("label", {}, this._t("date_from"), date),
        el("label", {}, this._t("date_to"), dateEnd)),
      this._config.rating ? ratingRow : null,
      notes, error,
      el("div", { class: "actions" },
        save,
        el("button", { type: "button", onclick: () => this._map.closePopup() }, this._t("cancel"))));
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      if (!name.value.trim()) { name.focus(); return; }
      save.disabled = true;
      if (dateEnd.value && dateEnd.value < date.value) {
        error.textContent = this._t("date_range"); error.hidden = false; save.disabled = false; return;
      }
      const data = {
        name: name.value.trim(), color, date: date.value || null,
        date_end: (date.value && dateEnd.value) || null, notes: notes.value.trim(),
        ...(this._config.rating ? { rating } : {}),
      };
      const msg = pin
        ? { type: "mmoui_worldmap/update", pin_id: pin.id, ...data }
        : { type: "mmoui_worldmap/add", map: this._config.map, latitude: latlng.lat, longitude: latlng.lng, ...data };
      this._call(msg)
        .then(() => { this._rememberColor(color); this._map.closePopup(); })
        .catch((err) => { error.textContent = `${this._t("error")}: ${err?.message || err}`; error.hidden = false; save.disabled = false; });
    });
    paint();

    const popup = this._L.popup({ minWidth: 240, maxWidth: 280, className: "form-popup" })
      .setLatLng(latlng).setContent(form).openOn(this._map);
    setTimeout(() => name.focus(), 50);

    if (pin || suggestedName) return;
    if (this._config.airports) {
      // On an airports map a click snaps to the nearest airport within 40 km.
      loadAirports().then((airports) => {
        const [near] = airportsNear(airports, latlng.lat, latlng.lng, 40)
          .sort((x, y) => distanceKm(latlng.lat, latlng.lng, x.lat, x.lon) - distanceKm(latlng.lat, latlng.lng, y.lat, y.lon));
        if (near && !name.value) {
          name.value = airportLabel(near);
          latlng = this._L.latLng(near.lat, near.lon);
          popup.setLatLng(latlng);
        }
      });
    } else {
      this._reverseGeocode(latlng).then((place) => { if (place && !name.value) name.value = place; });
    }
  }

  _call(msg) {
    return this._hass.callWS(msg);
  }

  _lastColor() {
    try { return localStorage.getItem(`mmoui_worldmap_color_${this._config.map}`); } catch { return null; }
  }

  _rememberColor(color) {
    try { localStorage.setItem(`mmoui_worldmap_color_${this._config.map}`, color); } catch { /* private mode */ }
  }

  async _reverseGeocode(latlng) {
    try {
      // poi: the building clicked (a hotel, a restaurant), not the town around it.
      const zoom = this._config.poi ? 18 : 10;
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=${zoom}&lat=${latlng.lat}&lon=${latlng.lng}&accept-language=${this._lang()}`);
      const data = await r.json();
      const a = data.address || {};
      const town = a.city || a.town || a.village || a.municipality || a.county || a.state || a.country || "";
      if (this._config.poi) return data.name ? (town ? `${data.name}, ${town}` : data.name) : town;
      return town || data.name || "";
    } catch {
      return "";
    }
  }

  async _doSearch() {
    clearTimeout(this._searchTimer);
    const query = this._search.value.trim();
    if (query.length < 2) { this._results.hidden = true; return; }
    const results = this._config.airports ? await this._searchAirports(query) : await this._searchPlaces(query);
    if (this._search.value.trim() !== query) return;
    this._results.replaceChildren(...(results.length
      ? results.map(({ title, detail, lat, lon, name }) => el("button", {
          class: "result",
          onclick: () => {
            this._results.hidden = true;
            this._search.value = "";
            const latlng = this._L.latLng(lat, lon);
            this._map.flyTo(latlng, Math.max(this._map.getZoom(), this._config.airports ? 9 : 6), { duration: 0.8 });
            this._map.once("moveend", () => this._openForm(latlng, null, name));
          },
        }, el("b", {}, title), el("small", {}, detail)))
      : [el("div", { class: "empty" }, this._t("no_results"))]));
    this._results.hidden = false;
  }

  async _nominatim(query, limit) {
    // Nominatim allows about one request a second: don't ask twice for the same thing.
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=${limit}&q=${encodeURIComponent(query)}&accept-language=${this._lang()}`;
    if (!NOMINATIM_CACHE.has(url)) {
      NOMINATIM_CACHE.set(url, fetch(url).then((r) => (r.ok ? r.json() : [])).catch(() => []));
    }
    const found = await NOMINATIM_CACHE.get(url);
    if (!found.length) NOMINATIM_CACHE.delete(url);
    return found;
  }

  async _searchPlaces(query) {
    if (query.length < 3) return [];
    return (await this._nominatim(query, 6)).map((place) => {
      const name = place.name || place.display_name.split(",")[0];
      return { title: name, detail: place.display_name, lat: Number(place.lat), lon: Number(place.lon), name };
    });
  }

  async _searchAirports(query) {
    const airports = await loadAirports();
    const local = searchAirports(airports, query);
    const code = query.trim().toUpperCase();
    if (local[0] && (local[0].iata === code || local[0].icao === code)) return this._airportResults(local);
    // The data has English names ("Rome", "London"), so also look the query up as
    // a place and lead with the airports around it: "Roma" finds CIA and FCO.
    // Name matches follow, so "Orio" still finds Orio al Serio (BGY).
    const city = fold(query).replace(AIRPORT_WORDS, " ").trim();
    const [place] = city.length >= 3 ? await this._nominatim(city, 1) : [];
    const near = place ? airportsNear(airports, Number(place.lat), Number(place.lon), 80) : [];
    return this._airportResults([...new Set([...near.slice(0, 3), ...local, ...near])].slice(0, 8));
  }

  _airportResults(found) {
    return found.map((a) => ({
      title: `✈ ${a.iata} · ${airportLabel(a).replace(` (${a.iata})`, "")}`,
      detail: [a.city, a.country, a.icao].filter(Boolean).join(" · "),
      lat: a.lat,
      lon: a.lon,
      name: airportLabel(a),
    }));
  }
}

class WorldMapCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = config;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._form) this._form.hass = hass;
    else this._render();
  }

  _render() {
    if (!this._hass || !this._config) return;
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (s) => s.label;
      this._form.addEventListener("value-changed", (ev) => {
        this._config = ev.detail.value;
        this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: this._config }, bubbles: true, composed: true }));
      });
      this.append(this._form);
    }
    const it = (this._hass.locale?.language || "en").startsWith("it");
    this._form.hass = this._hass;
    this._form.data = { height: 450, tiles: "auto", show_countries: true, country_opacity: 0.35, readonly: false, airports: false, rating: false, poi: false, ...this._config };
    this._form.schema = [
      {
        type: "grid", name: "", schema: [
          { name: "title", label: it ? "Titolo" : "Title", selector: { text: {} } },
          { name: "map", label: it ? "Mappa (es. aeroporti; vuoto = predefinita)" : "Map (e.g. airports; empty = default)", selector: { text: {} } },
        ],
      },
      {
        type: "grid", name: "", schema: [
          { name: "height", label: it ? "Altezza (px)" : "Height (px)", selector: { number: { min: 200, max: 1200, step: 10, mode: "box" } } },
          {
            name: "tiles", label: it ? "Mappa" : "Map", selector: { select: { mode: "dropdown", options: [
              { value: "auto", label: it ? "Automatica (chiara/scura)" : "Automatic (light/dark)" },
              { value: "light", label: it ? "Chiara" : "Light" },
              { value: "dark", label: it ? "Scura" : "Dark" },
              { value: "streets", label: it ? "Stradale" : "Streets" },
              { value: "osm", label: "OpenStreetMap" },
              { value: "satellite", label: it ? "Satellite" : "Satellite" },
            ] } },
          },
        ],
      },
      {
        type: "grid", name: "", schema: [
          { name: "show_countries", label: it ? "Evidenzia i paesi visitati" : "Highlight visited countries", selector: { boolean: {} } },
          { name: "readonly", label: it ? "Sola lettura" : "Read only", selector: { boolean: {} } },
          { name: "airports", label: it ? "Mappa di aeroporti (ricerca per codice IATA/ICAO)" : "Airports map (search by IATA/ICAO code)", selector: { boolean: {} } },
          { name: "rating", label: it ? "Voto da 1 a 5 (cuoricini)" : "1-5 rating (hearts)", selector: { boolean: {} } },
          { name: "poi", label: it ? "Click sul luogo preciso (hotel, ristorante)" : "Click names the exact place (hotel, restaurant)", selector: { boolean: {} } },
          { name: "country_color", label: it ? "Colore dei paesi" : "Country color", selector: { text: { type: "color" } } },
          { name: "country_opacity", label: it ? "Opacità dei paesi" : "Country opacity", selector: { number: { min: 0.05, max: 1, step: 0.05, mode: "slider" } } },
        ],
      },
    ];
  }
}

const CARD_CSS = `
  :host { display: block; }
  ha-card { overflow: hidden; }
  .header { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; justify-content: space-between; padding: 12px 16px; }
  .title { font-size: 1.25em; font-weight: 500; color: var(--primary-text-color); }
  .stats { color: var(--secondary-text-color); font-size: .9em; }
  .search { position: relative; flex: 1 1 200px; max-width: 320px; }
  .search input { width: 100%; box-sizing: border-box; padding: 8px 12px; border-radius: 18px; font: inherit;
    border: 1px solid var(--divider-color); background: var(--secondary-background-color, #f5f5f5); color: var(--primary-text-color); }
  .results { position: absolute; z-index: 1000; top: calc(100% + 4px); left: 0; right: 0; max-height: 300px; overflow: auto;
    background: var(--card-background-color, #fff); border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,.25); }
  .result { display: block; width: 100%; text-align: left; padding: 8px 12px; border: 0; background: none; cursor: pointer; color: var(--primary-text-color); font: inherit; }
  .result:hover { background: var(--secondary-background-color); }
  .result small { display: block; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .empty { padding: 8px 12px; color: var(--secondary-text-color); }
  .message { margin: 0 16px 12px; padding: 8px 12px; border-radius: 8px; background: var(--warning-color, #ffa600); color: #000; }
  .map { width: 100%; background: var(--secondary-background-color); }
  .filters { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 8px 16px 12px; }
  .filters .label { color: var(--secondary-text-color); font-size: .85em; margin-right: 4px; }
  .chip { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px 3px 6px; border-radius: 14px; cursor: pointer; font: inherit; font-size: .85em;
    border: 1px solid var(--divider-color); background: var(--card-background-color); color: var(--primary-text-color); }
  .chip.off { opacity: .4; }
  .dot { display: inline-block; width: 12px; height: 12px; border-radius: 50%; border: 1px solid rgba(0,0,0,.25); flex: none; }
  .flag { background: none; border: 0; }
  .flag svg { filter: drop-shadow(0 1px 1px rgba(0,0,0,.3)); transition: transform .15s; transform-origin: 7px 38px; }
  .flag:hover svg { transform: scale(1.15); }
  .leaflet-container { font: inherit; }
  .leaflet-popup-content { margin: 12px 14px; }
  .leaflet-popup-content-wrapper, .leaflet-popup-tip { background: var(--card-background-color, #fff); color: var(--primary-text-color, #212121); }
  .leaflet-container a.leaflet-popup-close-button { color: var(--secondary-text-color, #757575); }
  .leaflet-bar a, .leaflet-bar a:hover { background: var(--card-background-color, #fff); color: var(--primary-text-color, #212121); border-color: var(--divider-color, #ccc); }
  .leaflet-control-attribution { background: color-mix(in srgb, var(--card-background-color, #fff) 80%, transparent) !important; color: var(--secondary-text-color); }
  .leaflet-control-attribution a { color: var(--primary-color); }
  .details .name { display: flex; gap: 8px; align-items: center; font-weight: 600; font-size: 1.1em; }
  .details .meta { color: var(--secondary-text-color, #555); margin-top: 4px; }
  .details .notes { margin-top: 6px; white-space: pre-wrap; }
  .actions { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 10px; }
  .actions button { padding: 5px 12px; border-radius: 6px; border: 1px solid var(--divider-color, #ccc); background: var(--card-background-color, #fff); color: var(--primary-text-color, #212121); cursor: pointer; font: inherit; }
  .actions button.primary { background: var(--primary-color, #03a9f4); border-color: transparent; color: #fff; }
  .actions button.danger { color: var(--error-color, #c62828); border-color: var(--error-color, #c62828); }
  .actions button:disabled { opacity: .5; }
  .confirm { width: 100%; font-weight: 500; }
  .pin-form { display: flex; flex-direction: column; gap: 8px; }
  .form-title { display: flex; align-items: center; gap: 6px; font-weight: 600; font-size: 1.05em; }
  .preview svg { width: 22px; height: 28px; display: block; }
  .pin-form input[type=text], .pin-form input[type=date], .pin-form textarea { font: inherit; padding: 6px 8px; border: 1px solid var(--divider-color, #ccc); border-radius: 6px; box-sizing: border-box; width: 100%;
    background: var(--secondary-background-color, #fff); color: var(--primary-text-color, #212121); color-scheme: light dark; }
  .hearts { color: #e91e63; letter-spacing: 2px; margin-top: 4px; font-size: 1.1em; }
  .rating-input { display: flex; align-items: center; gap: 2px; }
  .rating-input .label { font-size: .85em; color: var(--secondary-text-color, #555); margin-right: 6px; }
  .rating-input button { border: 0; background: none; cursor: pointer; padding: 0 2px; font-size: 1.4em; line-height: 1; color: #e91e63; }
  .pin-form .dates { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .pin-form label { display: flex; flex-direction: column; gap: 2px; font-size: .85em; color: var(--secondary-text-color, #555); }
  .swatches { display: flex; flex-wrap: wrap; gap: 6px; }
  .swatch { width: 22px; height: 22px; border-radius: 50%; border: 2px solid var(--card-background-color, #fff); box-shadow: 0 0 0 1px var(--divider-color, #bbb); cursor: pointer; padding: 0; }
  .swatch.selected, input[type=color].selected { box-shadow: 0 0 0 2px var(--primary-text-color, #222); }
  .swatches input[type=color] { width: 26px; height: 26px; border: 0; padding: 0; background: none; cursor: pointer; border-radius: 50%; }
  .form-error { color: var(--error-color, #c62828); font-size: .85em; }
`;

customElements.define("worldmap-card", WorldMapCard);
customElements.define("worldmap-card-editor", WorldMapCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "worldmap-card",
  name: "World Map",
  description: "Mappa del mondo con le bandierine dei posti visitati",
  preview: false,
});

console.info(`%c WORLDMAP-CARD %c ${VERSION} `, "color:#fff;background:#1e88e5;font-weight:700", "color:#1e88e5;background:#fff");
})();
