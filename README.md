# MMOUi World Map per Home Assistant

Una mappa del mondo con le bandierine dei posti visitati. Ogni bandierina ha il suo colore, scelto liberamente, e i paesi con almeno una bandierina vengono evidenziati.

L'integrazione salva le bandierine in Home Assistant e porta con sé la card **World Map**, quindi basta un solo repository HACS: non serve aggiungere risorse Lovelace a mano.

## Installazione

### HACS

1. HACS → menu ⋮ → **Repository personalizzati** → aggiungi `https://github.com/mattiaouiapp/HomeAssistant_HACS_WorldMap`, categoria **Integrazione**.
2. Installa **MMOUi World Map** e riavvia Home Assistant.
3. **Impostazioni → Dispositivi e servizi → Aggiungi integrazione → MMOUi World Map**.
4. Ricarica la pagina del browser, poi aggiungi la card **World Map** a una dashboard.

### Manuale

Copia `custom_components/mmoui_worldmap` in `<config>/custom_components/` e riavvia.

## La card

```yaml
type: custom:worldmap-card
```

- **Aggiungere una bandierina**: clicca sulla mappa, oppure cerca un luogo nella casella in alto e scegli un risultato. Nel modulo che si apre metti nome, colore (12 colori pronti o uno a piacere), data e note. Il nome viene proposto in automatico dal luogo cliccato.
- **Modificare o eliminare**: clicca sulla bandierina.
- **Filtrare per colore**: sotto la mappa c'è un chip per ogni colore usato. Cliccalo per nascondere o mostrare quelle bandierine.
- **Paesi**: passa sopra un paese evidenziato per vederne il nome e il numero di bandierine.

### Opzioni

Si impostano tutte anche dall'editor visuale della card.

| Opzione | Default | Descrizione |
| --- | --- | --- |
| `title` | `I miei viaggi` | Titolo della card |
| `height` | `450` | Altezza della mappa in pixel |
| `tiles` | `auto` | `auto` (chiara o scura secondo il tema), `light`, `dark`, `streets`, `osm`, `satellite` |
| `tile_url` / `tile_attribution` | — | Un server di tile a scelta, es. `https://tile.openstreetmap.org/{z}/{x}/{y}.png` |
| `show_countries` | `true` | Evidenzia i paesi visitati |
| `country_color` | colore primario del tema | Colore dei paesi evidenziati |
| `country_opacity` | `0.35` | Opacità dei paesi evidenziati |
| `default_color` | `#e53935` | Colore proposto per la prima bandierina (poi la card ricorda l'ultimo usato) |
| `center` / `zoom` | — | Vista iniziale fissa, es. `center: [45, 10]`, `zoom: 4`. Senza, la mappa inquadra tutte le bandierine |
| `readonly` | `false` | Nasconde la ricerca e disattiva aggiunta, modifica ed eliminazione |

## Entità

| Entità | Stato | Attributi |
| --- | --- | --- |
| `sensor.worldmap_places` | Numero di bandierine | `last_place`, `last_country` |
| `sensor.worldmap_countries` | Numero di paesi visitati | `countries` (nomi), `codes` (codici ISO) |

## Servizi

Le bandierine si gestiscono anche da automazioni e script.

```yaml
action: mmoui_worldmap.add_pin
data:
  name: Lisbona
  latitude: 38.72
  longitude: -9.14
  color: "#1e88e5"
  date: "2024-05-10"
  notes: Pastéis de nata
```

- `mmoui_worldmap.add_pin` restituisce la bandierina creata, con il suo `id` e il paese trovato.
- `mmoui_worldmap.update_pin` cambia solo i campi indicati, oltre a `pin_id`.
- `mmoui_worldmap.remove_pin` vuole solo `pin_id`.

## Dati e servizi esterni

- Le bandierine sono salvate in `<config>/.storage/mmoui_worldmap.pins` e quindi finiscono nei backup di Home Assistant.
- Il paese di ogni bandierina viene calcolato in locale, sui confini [Natural Earth](https://www.naturalearthdata.com) 1:50m inclusi nell'integrazione. Un punto appena fuori dalla costa conta per il paese più vicino, entro circa 30 km.
- Le tile della mappa arrivano da Esri (o da OpenStreetMap, o dal server indicato). La ricerca e il nome proposto arrivano da [Nominatim](https://nominatim.openstreetmap.org). Le chiamate partono dal browser.
- [Leaflet](https://leafletjs.com) 1.9.4 è incluso nell'integrazione.

## Sviluppo

`docker compose -f dev/docker-compose.yml up` avvia Home Assistant su http://localhost:8124 con l'integrazione montata.
