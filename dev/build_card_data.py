"""Build the card's data files from the integration's data.

countries-lite.js: the borders in www/countries.geojson simplified for drawing
(Douglas-Peucker, 0.02 degrees). The integration keeps the full borders to find
each flag's country. airports.js: the OurAirports list (public domain) cut to
airports with an IATA code that are large or have scheduled flights.

Both are plain JSON despite the .js name: Home Assistant gzips .js responses
but not .json ones, which makes the download about five times smaller.

    python3 dev/build_card_data.py
"""

import csv
import io
import json
import math
from pathlib import Path
import urllib.request

WWW = Path(__file__).parent.parent / "custom_components" / "mmoui_worldmap" / "www"
TOLERANCE = 0.02
AIRPORTS_CSV = "https://davidmegginson.github.io/ourairports-data/airports.csv"
SIZE = {"large_airport": 2, "medium_airport": 1}


def simplify(ring: list, tol: float) -> list:
    if len(ring) < 5:
        return ring

    def far(a: int, b: int, out: list) -> None:
        (x1, y1), (x2, y2) = ring[a], ring[b]
        dx, dy = x2 - x1, y2 - y1
        length = dx * dx + dy * dy
        best, index = -1.0, None
        for i in range(a + 1, b):
            px, py = ring[i]
            t = 0 if length == 0 else max(0, min(1, ((px - x1) * dx + (py - y1) * dy) / length))
            d = math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
            if d > best:
                best, index = d, i
        if index is not None and best > tol:
            far(a, index, out)
            out.append(ring[index])
            far(index, b, out)

    mid = len(ring) // 2
    out = [ring[0]]
    far(0, mid, out)
    out.append(ring[mid])
    far(mid, len(ring) - 1, out)
    out.append(ring[-1])
    # Tiny islands and countries (Malta, San Marino) keep their full outline.
    return out if len(out) >= 4 else ring


def main() -> None:
    data = json.loads((WWW / "countries.geojson").read_text(encoding="utf-8"))
    for feature in data["features"]:
        feature["geometry"]["coordinates"] = [
            [simplify(ring, TOLERANCE) for ring in polygon]
            for polygon in feature["geometry"]["coordinates"]
        ]
    (WWW / "countries-lite.js").write_text(
        json.dumps(data, separators=(",", ":"), ensure_ascii=False), encoding="utf-8"
    )
    with urllib.request.urlopen(AIRPORTS_CSV) as response:
        rows = csv.DictReader(io.StringIO(response.read().decode("utf-8")))
        airports = []
        for r in rows:
            if not r["iata_code"] or r["type"] in ("closed", "heliport", "balloonport"):
                continue
            if r["scheduled_service"] != "yes" and r["type"] != "large_airport":
                continue
            keywords = ",".join(
                k.strip() for k in r["keywords"].split(",")
                if k.strip() and k.strip().upper() != r["iata_code"]
            )[:80]
            airports.append([
                r["iata_code"], r["icao_code"] or r["ident"], r["name"], r["municipality"],
                r["iso_country"], round(float(r["latitude_deg"]), 4),
                round(float(r["longitude_deg"]), 4), SIZE.get(r["type"], 0), keywords,
            ])
    airports.sort(key=lambda a: (-a[7], a[0]))
    (WWW / "airports.js").write_text(
        json.dumps(
            {
                "source": "OurAirports (public domain), https://ourairports.com",
                "fields": ["iata", "icao", "name", "city", "country", "lat", "lon", "size", "keywords"],
                "airports": airports,
            },
            separators=(",", ":"),
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

if __name__ == "__main__":
    main()
