/* MMOUi World Map card: a Leaflet world map with coloured flags on the places
 * you visited and the countries that hold at least one flag highlighted. */

const BASE = new URL(".", import.meta.url).pathname;
const VERSION = new URL(import.meta.url).searchParams.get("v") || "";
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
    no_results: "No results", name: "Name", color: "Color", date: "Date", notes: "Notes",
    save: "Save", cancel: "Cancel", edit: "Edit", delete: "Delete", confirm_delete: "Delete this flag?",
    yes_delete: "Yes, delete", add_here: "New flag", not_loaded: "Set up the MMOUi World Map integration first.",
    error: "Error", all: "All", unknown_place: "New place", filter: "Show",
  },
  it: {
    title: "I miei viaggi", places: "luoghi", countries: "paesi", search: "Cerca un luogo…",
    no_results: "Nessun risultato", name: "Nome", color: "Colore", date: "Data", notes: "Note",
    save: "Salva", cancel: "Annulla", edit: "Modifica", delete: "Elimina", confirm_delete: "Eliminare questa bandierina?",
    yes_delete: "Sì, elimina", add_here: "Nuova bandierina", not_loaded: "Configura prima l'integrazione MMOUi World Map.",
    error: "Errore", all: "Tutti", unknown_place: "Nuovo luogo", filter: "Mostra",
  },
};

let leafletPromise;
let leafletCss;
let countriesPromise;

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
    this._config = {
      height: 450,
      tiles: "auto",
      show_countries: true,
      country_opacity: 0.35,
      readonly: false,
      ...config,
    };
    if (this._map) this._rebuild();
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

  _rebuild() {
    this._map.remove();
    this._map = null;
    this.shadowRoot.replaceChildren(this.shadowRoot.children[0], this.shadowRoot.children[1]);
    this._buildDom();
    this._buildMap();
    this._render();
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
      { type: "mmoui_worldmap/subscribe" },
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
      marker.bindTooltip(pin.name, { direction: "top", offset: [10, -34] });
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
    const counts = {};
    for (const pin of this._visible()) if (pin.country) counts[pin.country] = (counts[pin.country] || 0) + 1;
    const color = this._config.country_color
      || getComputedStyle(this).getPropertyValue("--primary-color").trim() || "#03a9f4";
    this._countryLayer.clearLayers();
    const layer = this._L.geoJSON(
      { type: "FeatureCollection", features: this._geo.features.filter((f) => counts[f.properties.iso]) },
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

  _openDetails(pin, marker) {
    const country = pin.country ? `${flagEmoji(pin.country)} ${this._countryName(pin.country, pin.country_name)}` : "";
    const date = pin.date ? new Date(`${pin.date}T00:00:00`).toLocaleDateString(this._hass.locale?.language || undefined) : "";
    const actions = el("div", { class: "actions" });
    const content = el("div", { class: "details" },
      el("div", { class: "name" }, el("span", { class: "dot", style: `background:${pin.color}` }), pin.name),
      country ? el("div", { class: "meta" }, country) : null,
      date ? el("div", { class: "meta" }, date) : null,
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
      el("label", {}, this._t("date"), date),
      notes, error,
      el("div", { class: "actions" },
        save,
        el("button", { type: "button", onclick: () => this._map.closePopup() }, this._t("cancel"))));
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      if (!name.value.trim()) { name.focus(); return; }
      save.disabled = true;
      const data = { name: name.value.trim(), color, date: date.value || null, notes: notes.value.trim() };
      const msg = pin
        ? { type: "mmoui_worldmap/update", pin_id: pin.id, ...data }
        : { type: "mmoui_worldmap/add", latitude: latlng.lat, longitude: latlng.lng, ...data };
      this._call(msg)
        .then(() => { this._rememberColor(color); this._map.closePopup(); })
        .catch((err) => { error.textContent = `${this._t("error")}: ${err?.message || err}`; error.hidden = false; save.disabled = false; });
    });
    paint();

    this._L.popup({ minWidth: 240, maxWidth: 280, className: "form-popup" })
      .setLatLng(latlng).setContent(form).openOn(this._map);
    setTimeout(() => name.focus(), 50);

    if (!pin && !suggestedName) this._reverseGeocode(latlng).then((place) => { if (place && !name.value) name.value = place; });
  }

  _call(msg) {
    return this._hass.callWS(msg);
  }

  _lastColor() {
    try { return localStorage.getItem("mmoui_worldmap_color"); } catch { return null; }
  }

  _rememberColor(color) {
    try { localStorage.setItem("mmoui_worldmap_color", color); } catch { /* private mode */ }
  }

  async _reverseGeocode(latlng) {
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&lat=${latlng.lat}&lon=${latlng.lng}&accept-language=${this._lang()}`);
      const data = await r.json();
      const a = data.address || {};
      return a.city || a.town || a.village || a.municipality || a.county || a.state || a.country || data.name || "";
    } catch {
      return "";
    }
  }

  async _doSearch() {
    clearTimeout(this._searchTimer);
    const query = this._search.value.trim();
    if (query.length < 3) { this._results.hidden = true; return; }
    let found = [];
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=${encodeURIComponent(query)}&accept-language=${this._lang()}`);
      found = await r.json();
    } catch { /* offline */ }
    if (this._search.value.trim() !== query) return;
    this._results.replaceChildren(...(found.length
      ? found.map((place) => el("button", {
          class: "result",
          onclick: () => {
            this._results.hidden = true;
            this._search.value = "";
            const latlng = this._L.latLng(Number(place.lat), Number(place.lon));
            this._map.flyTo(latlng, Math.max(this._map.getZoom(), 6), { duration: 0.8 });
            this._map.once("moveend", () => this._openForm(latlng, null, place.name || place.display_name.split(",")[0]));
          },
        }, el("b", {}, place.name || place.display_name.split(",")[0]), el("small", {}, place.display_name)))
      : [el("div", { class: "empty" }, this._t("no_results"))]));
    this._results.hidden = false;
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
    this._form.data = { height: 450, tiles: "auto", show_countries: true, country_opacity: 0.35, readonly: false, ...this._config };
    this._form.schema = [
      { name: "title", label: it ? "Titolo" : "Title", selector: { text: {} } },
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
