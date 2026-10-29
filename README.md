# MMOUi World Map per Home Assistant

Una mappa del mondo per tenere traccia dei posti dove sei stato: viaggi, aeroporti, hotel, o qualsiasi altra raccolta di luoghi.

- **Bandierine colorate**: ognuna ha il suo colore, scelto liberamente.
- **Date**: un giorno solo o un periodo.
- **Note** libere e, se vuoi, un **voto da 1 a 5 cuoricini**.
- **Paesi visitati evidenziati**: si accende solo il pezzo di territorio con la bandierina. Parigi accende la Francia continentale, non la Corsica né la Guyana.
- **Più mappe separate**: ognuna con le sue bandierine e i suoi sensori, per esempio viaggi, aeroporti e hotel.
- **Ricerca dei luoghi**, e per gli aeroporti ricerca per codice IATA/ICAO, nome o città.

L'integrazione salva le bandierine in Home Assistant e porta con sé la card **World Map** (`custom:worldmap-card`). Basta un solo repository HACS.

## Installazione

### HACS

1. HACS → menu ⋮ → **Repository personalizzati** → aggiungi `https://github.com/mattiaouiapp/HomeAssistant_HACS_WorldMap`, categoria **Integrazione**.
2. Installa **MMOUi World Map** e riavvia Home Assistant.
3. **Impostazioni → Dispositivi e servizi → Aggiungi integrazione → MMOUi World Map**.
4. Ricarica la pagina del browser con Ctrl+Shift+R, poi aggiungi la card **World Map** a una dashboard. Per partire subito usa la [dashboard pronta](#dashboard).

### Manuale

Copia `custom_components/mmoui_worldmap` in `<config>/custom_components/`, riavvia e prosegui dal punto 3.

### Aggiornamento

1. HACS → **MMOUi World Map** → **Aggiorna**, poi riavvia Home Assistant.
2. Se hai la risorsa JavaScript manuale, aggiorna il suo `?v=` (vedi sotto).
3. Ricarica la dashboard con Ctrl+Shift+R. Nell'app per iPhone o Android usa **Impostazioni app → Debugging → Reset frontend cache**.

## Configurazione del JavaScript della card

La card è il file `worldmap-card.js`, servito dall'integrazione all'indirizzo:

```
/mmoui_worldmap/worldmap-card.js?v=<versione>
```

### Caricamento automatico (consigliato)

Quando l'integrazione è configurata, il file viene aggiunto da sola a ogni pagina di Home Assistant, già con la versione installata (`?v=1.4.1`). **Non serve aggiungere nessuna risorsa Lovelace.** Il caricamento automatico parte solo dopo il punto 3 dell'installazione: con l'integrazione solo installata da HACS ma non aggiunta, la card non c'è.

### Risorsa manuale (facoltativa)

Serve solo se il caricamento automatico non funziona nel tuo browser o nella tua app.

1. **Impostazioni → Dashboard → ⋮ (in alto a destra) → Risorse → Aggiungi risorsa**.
2. URL: `/mmoui_worldmap/worldmap-card.js?v=1.4.1`, mettendo la versione installata (la trovi in HACS o in `manifest.json`).
3. Tipo di risorsa: **Modulo JavaScript**. Funziona anche come "File JavaScript", ma il tipo giusto è il modulo.
4. Ricarica con Ctrl+Shift+R.

Se usi la risorsa manuale e quella automatica insieme non succede niente di male: la seconda copia si ferma e scrive in console `WORLDMAP-CARD not registered (already defined?)`.

### Perché il `?v=` conta

Home Assistant dice al browser di tenere il file in cache per un mese. Il browser decide cosa riscaricare guardando l'indirizzo completo, `?v=` compreso:

- la risorsa automatica cambia `?v=` da sola a ogni aggiornamento;
- **la risorsa manuale no**. Se resta su una versione vecchia, il browser continua a usare la vecchia copia anche dopo l'aggiornamento: per esempio la mappa c'è ma mancano i cuoricini. Dopo ogni aggiornamento cambia il `?v=` con la nuova versione, oppure elimina la risorsa e lascia fare al caricamento automatico.

### Come controllare che la card sia caricata

Apri la console del browser (F12 → Console) e ricarica la dashboard.

- **Banner blu `WORLDMAP-CARD 1.4.1`**: la card è caricata e registrata, nella versione indicata.
- **Nessun banner**: il file non è arrivato. Apri `http://<tuo-ha>:8123/mmoui_worldmap/worldmap-card.js` nel browser:
  - se risponde 404, l'integrazione non è caricata: controlla che sia aggiunta e guarda i log di Home Assistant cercando `mmoui_worldmap`;
  - se vedi il codice, è la cache: Ctrl+Shift+R, o il reset della cache nell'app.
- **"Custom element doesn't exist: worldmap-card"** sulla dashboard: la card non si è registrata. Aggiorna all'ultima versione, svuota la cache, e se resta mandami gli errori della console.

## La card

```yaml
type: custom:worldmap-card
```

- **Aggiungere una bandierina**: clicca sulla mappa, oppure cerca un luogo nella casella in alto e scegli un risultato. Nel modulo che si apre metti:
  - **nome**, proposto in automatico dal punto cliccato;
  - **colore**, uno dei 12 pronti o uno a piacere; la card ricorda l'ultimo usato;
  - **data**: "Dal" per un giorno solo, "Dal" e "Al" per un periodo;
  - **voto** da 1 a 5 cuoricini, sulle mappe con `rating: true`; tocca di nuovo l'ultimo cuore per toglierlo;
  - **note**.
- **Modificare o eliminare**: clicca sulla bandierina. L'eliminazione chiede conferma.
- **Filtrare per colore**: sotto la mappa c'è un chip per ogni colore usato. Cliccalo per nascondere o mostrare quelle bandierine.
- **Paesi**: passa sopra un paese evidenziato per vederne il nome e il numero di bandierine.

### Opzioni

Si impostano tutte anche dall'editor visuale della card.

| Opzione | Default | Descrizione |
| --- | --- | --- |
| `title` | `I miei viaggi` | Titolo della card |
| `map` | predefinita | Mappa delle bandierine (lettere minuscole, cifre e `_`, es. `aeroporti`). Ogni mappa ha le sue bandierine, i suoi paesi e i suoi sensori |
| `height` | `450` | Altezza della mappa in pixel |
| `tiles` | `auto` | `auto` (chiara o scura secondo il tema), `light`, `dark`, `streets`, `osm`, `satellite` |
| `tile_url` / `tile_attribution` | — | Un server di tile a scelta, es. `https://tile.openstreetmap.org/{z}/{x}/{y}.png` |
| `show_countries` | `true` | Evidenzia i paesi visitati, solo nel pezzo di territorio con la bandierina |
| `country_color` | colore primario del tema | Colore dei paesi evidenziati |
| `country_opacity` | `0.35` | Opacità dei paesi evidenziati |
| `default_color` | `#e53935` | Colore proposto per la prima bandierina |
| `center` / `zoom` | — | Vista iniziale fissa, es. `center: [45, 10]`, `zoom: 4`. Senza, la mappa inquadra tutte le bandierine |
| `airports` | `false` | Mappa di aeroporti: la ricerca trova gli aeroporti per codice IATA/ICAO (MXP, LIRF), nome (Malpensa) o città (Roma, Londra), e un click si aggancia all'aeroporto più vicino entro 40 km |
| `rating` | `false` | Voto da 1 a 5, con i cuoricini nel modulo, nei dettagli e nel tooltip |
| `poi` | `false` | Un click propone il nome dell'edificio cliccato (un hotel, un ristorante) invece della città |
| `readonly` | `false` | Nasconde la ricerca e disattiva aggiunta, modifica ed eliminazione |

### Esempi

```yaml
# Viaggi: la mappa predefinita
type: custom:worldmap-card
title: I miei viaggi

# Aeroporti
type: custom:worldmap-card
map: aeroporti
title: Aeroporti
airports: true
default_color: "#1e88e5"

# Hotel, con i voti
type: custom:worldmap-card
map: hotel
title: Hotel
rating: true
poi: true
default_color: "#d81b60"
```

## Entità

Per la mappa predefinita:

| Entità | Stato | Attributi |
| --- | --- | --- |
| `sensor.worldmap_places` | Numero di bandierine | `last_place`, `last_country`, `average_rating`, `places` |
| `sensor.worldmap_countries` | Numero di paesi visitati | `countries` (nomi), `codes` (codici ISO) |

`places` è l'elenco completo delle bandierine: nome, paese, bandiera, colore, `date` e `date_end`, voto, note. L'ordine va dal viaggio più recente, con quelle senza data in fondo. Non viene salvato nello storico.

Ogni altra mappa ha i suoi sensori, `sensor.worldmap_<mappa>_places` e `sensor.worldmap_<mappa>_countries` (es. `sensor.worldmap_hotel_places`), con gli stessi attributi. Compaiono con la prima bandierina della mappa.

## Dashboard

[`dashboards/viaggi.yaml`](dashboards/viaggi.yaml) è una dashboard pronta con tre schede. Ognuna ha la mappa, i numeri, i paesi visitati e l'elenco dei luoghi.

| Scheda | Mappa | Numeri |
| --- | --- | --- |
| **Viaggi** | predefinita | luoghi, paesi, ultimo e primo viaggio, giorni in viaggio, % di mondo visitato |
| **Aeroporti** | `aeroporti`, con la ricerca degli aeroporti | aeroporti, paesi, ultimo e primo volo |
| **Hotel** | `hotel`, con i cuoricini | hotel, paesi, voto medio, il migliore, notti |

Per installarla:
1. **Impostazioni → Dashboard → Aggiungi dashboard → Nuova dashboard da zero**.
2. Aprila, poi **⋮ → Modifica dashboard → ⋮ → Editor configurazione grezza**.
3. Sostituisci tutto con il contenuto del file.

Il file è generato da `dev/gen_dashboard.py`: per cambiarlo modifica lo script e rilancia `python3 dev/gen_dashboard.py dashboards/viaggi.yaml`.

## Servizi

Le bandierine si gestiscono anche da automazioni e script.

```yaml
action: mmoui_worldmap.add_pin
data:
  name: Lisbona
  latitude: 38.72
  longitude: -9.14
  color: "#1e88e5"
  map: hotel              # facoltativo, se manca va sulla mappa predefinita
  date: "2024-05-10"
  date_end: "2024-05-15"  # facoltativo, per un periodo
  rating: 4               # facoltativo, da 1 a 5
  notes: Pastéis de nata
```

- **`mmoui_worldmap.add_pin`** restituisce la bandierina creata, con il suo `id` e il paese trovato.
- **`mmoui_worldmap.update_pin`** vuole `pin_id` e cambia solo i campi indicati. Con `map` sposta la bandierina su un'altra mappa.
- **`mmoui_worldmap.remove_pin`** vuole solo `pin_id`.

Una `date_end` precedente a `date`, o senza `date`, viene rifiutata.

## Dati e servizi esterni

- **Salvataggio**: le bandierine sono in `<config>/.storage/mmoui_worldmap.pins`, quindi finiscono nei backup di Home Assistant.
- **Paese di ogni bandierina**: viene calcolato in locale, sui confini [Natural Earth](https://www.naturalearthdata.com) 1:50m inclusi nell'integrazione. Un punto appena fuori dalla costa conta per il paese più vicino, entro circa 30 km.
- **Confini disegnati**: la card usa una versione semplificata degli stessi confini, più leggera da scaricare e da disegnare.
- **Mappa**: le tile arrivano da Esri, da OpenStreetMap o dal server indicato.
- **Ricerca e nome proposto**: arrivano da [Nominatim](https://nominatim.openstreetmap.org), quindi si trovano i luoghi e gli hotel presenti in OpenStreetMap. Le chiamate partono dal browser.
- **Aeroporti**: l'elenco dei circa 4.100 aeroporti con codice IATA e voli di linea viene da [OurAirports](https://ourairports.com) (pubblico dominio) ed è incluso nell'integrazione.
- **Leaflet** [1.9.4](https://leafletjs.com) è incluso.

## Sviluppo

- `docker compose -f dev/docker-compose.yml up` avvia Home Assistant su http://localhost:8124 con l'integrazione montata.
- `python3 dev/build_card_data.py` rigenera i dati della card: i confini semplificati e gli aeroporti, scaricati da OurAirports.
- `python3 dev/gen_dashboard.py dashboards/viaggi.yaml` rigenera la dashboard.
