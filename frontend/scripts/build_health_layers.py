# /// script
# requires-python = ">=3.12"
# dependencies = ["shapely>=2.0"]
# ///
"""Genera las capas «zonas de afectación a la salud» y «escuelas» del mapa (/mapa).

Entradas:
  - scripts/zonas_salud.json: metadatos de cada zona (textos, fuentes) y cómo se arma su polígono.
  - src/app/features/satellite/basin.ts: trazo de los ríos (RIVERS) y de la presa (PRESA_VALSEQUILLO).
  - CSV del DENUE de INEGI, sector 61 «Servicios educativos» (descarga masiva nacional):
      https://www.inegi.org.mx/contenidos/masiva/denue/denue_00_61_csv.zip
    Descomprimir y pasar `conjunto_de_datos/denue_inegi_61_.csv` (por defecto se busca en scripts/raw/).

Salidas (en public/data/):
  - zonas_afectacion_salud.geojson: un polígono por zona (`tipo: "zona"`) + un punto de etiqueta (`tipo: "etiqueta"`).
  - escuelas_zonas_salud.geojson: escuelas del DENUE (SCIAN 6111xx) que caen dentro de alguna zona.

Cada polígono = unión de
  - un corredor de `radio_rio_m` a cada lado de los tramos de río indicados,
  - un círculo de `radio_comunidad_m` alrededor de cada comunidad (mediana de sus establecimientos en el DENUE),
  - (zona 4) la presa de Valsequillo con `radio_presa_m`.
Son trazos APROXIMADOS de prototipo, no límites oficiales.

Uso (desde frontend/):
  uv run scripts/build_health_layers.py [ruta/al/denue_inegi_61_.csv]
"""

import csv
import json
import math
import re
import statistics
import sys
import unicodedata
from pathlib import Path

import shapely
from shapely.geometry import LineString, Point, Polygon, box, mapping
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parent.parent
SPEC = ROOT / "scripts" / "zonas_salud.json"
BASIN = ROOT / "src" / "app" / "features" / "satellite" / "basin.ts"
OUT_ZONES = ROOT / "public" / "data" / "zonas_afectacion_salud.geojson"
OUT_SCHOOLS = ROOT / "public" / "data" / "escuelas_zonas_salud.geojson"
DEFAULT_DENUE = ROOT / "scripts" / "raw" / "denue_inegi_61_.csv"

#: SCIAN 6111x → nivel educativo (el último dígito: 1 = privado, 2 = público).
LEVELS = {
    "61111": "Preescolar",
    "61112": "Primaria",
    "61113": "Secundaria general",
    "61114": "Secundaria técnica",
    "61115": "Media técnica terminal",
    "61116": "Media superior",
    "61117": "Varios niveles",
    "61118": "Educación especial",
}

# Proyección local equirectangular (metros) centrada en la cuenca: suficiente a esta escala (~1 % de error).
LAT0 = 19.1
KX = 111_320 * math.cos(math.radians(LAT0))
KY = 110_540


def to_m(geom):
    return shapely.transform(geom, lambda xy: xy * (KX, KY))


def to_deg(geom):
    return shapely.transform(geom, lambda xy: xy / (KX, KY))


def norm(text: str) -> str:
    return " ".join(unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().upper().split())


def parse_pairs(block: str) -> list[tuple[float, float]]:
    """`[lat, lng]` de basin.ts → `(lng, lat)`."""
    return [(float(lng), float(lat)) for lat, lng in re.findall(r"\[(-?[\d.]+),\s*(-?[\d.]+)\]", block)]


def load_basin() -> tuple[dict[str, LineString], Polygon]:
    src = BASIN.read_text(encoding="utf-8")
    rivers = {
        name: LineString(parse_pairs(path))
        for name, path in re.findall(r"name: '([^']+)',[\s\S]*?path: \[([\s\S]*?)\]\s*,?\s*\}", src)
    }
    presa_block = re.search(r"PRESA_VALSEQUILLO[^=]*= \[([\s\S]*?)\];", src)
    if not rivers or not presa_block:
        sys.exit("No se pudieron leer RIVERS / PRESA_VALSEQUILLO de basin.ts")
    return rivers, Polygon(parse_pairs(presa_block.group(1)))


def load_schools(path: Path) -> list[dict]:
    with path.open(encoding="latin-1", newline="") as f:
        return [r for r in csv.DictReader(f) if r["cve_ent"] in ("21", "29") and r["codigo_act"][:5] in LEVELS]


def locate(places: list[dict], rows: list[dict]) -> list[tuple[str, Point]]:
    """Comunidad → mediana de las coordenadas de sus establecimientos educativos en el DENUE."""
    found = []
    for p in places:
        pts = [
            (float(r["longitud"]), float(r["latitud"]))
            for r in rows
            if norm(r[p["campo"]]) == p["nombre"] and norm(r["municipio"]) == p["municipio"]
        ]
        if not pts:
            print(f"  ⚠ sin coordenadas en el DENUE: {p['nombre']} ({p['municipio']}); se omite del polígono")
            continue
        found.append((p["nombre"], Point(statistics.median(x for x, _ in pts), statistics.median(y for _, y in pts))))
    return found


def round_coords(geom, digits: int = 5):
    return json.loads(json.dumps(mapping(geom)), parse_float=lambda s: round(float(s), digits))


def main() -> None:
    denue = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_DENUE
    if not denue.exists():
        sys.exit(f"No existe {denue}. Descarga el DENUE (ver docstring) o pasa la ruta del CSV.")
    spec = json.loads(SPEC.read_text(encoding="utf-8"))
    rivers, presa = load_basin()
    rows = load_schools(denue)
    print(f"DENUE: {len(rows)} escuelas en Puebla y Tlaxcala")

    zones = []
    for z in spec["zonas"]:
        parts = []
        for seg in z["rios"]:
            clipped = rivers[seg["rio"]].intersection(box(*seg["bbox"]))
            if clipped.is_empty:
                sys.exit(f"{z['id']}: el bbox no toca {seg['rio']}")
            parts.append(to_m(clipped).buffer(spec["radio_rio_m"]))
        for _, pt in locate(z["lugares"], rows):
            parts.append(to_m(pt).buffer(spec["radio_comunidad_m"]))
        if z.get("presa"):
            parts.append(to_m(presa).buffer(spec["radio_presa_m"]))
        area = unary_union(parts).simplify(40)
        zones.append((z, to_deg(area)))

    def zone_for(row: dict) -> str | None:
        pt = Point(float(row["longitud"]), float(row["latitud"]))
        hits = [z for z, geom in zones if geom.contains(pt)]
        if not hits:
            return None
        # Zonas vecinas (z1 Tlaxcala / z2 Puebla) se tocan sobre el río: gana la del mismo estado.
        same_state = [z for z in hits if z["cve_ent"] == row["cve_ent"]]
        return (same_state or hits)[0]["id"]

    schools = []
    for r in rows:
        zone_id = zone_for(r)
        if not zone_id:
            continue
        code = r["codigo_act"]
        level = LEVELS[code[:5]]
        funding = "Público" if code.endswith("2") else "Privado"
        schools.append(
            {
                "type": "Feature",
                "properties": {
                    "id": r["id"],
                    "nombre": " ".join(r["nom_estab"].split()) or f"{level} ({funding.lower()}) sin nombre en el DENUE",
                    "nivel": level,
                    "sostenimiento": funding,
                    "municipio": r["municipio"].strip(),
                    "localidad": r["localidad"].strip(),
                    "zona_id": zone_id,
                },
                "geometry": {"type": "Point", "coordinates": [round(float(r["longitud"]), 6), round(float(r["latitud"]), 6)]},
            }
        )
    schools.sort(key=lambda f: (f["properties"]["zona_id"], f["properties"]["nombre"]))
    count = {z["id"]: 0 for z, _ in zones}
    for s in schools:
        count[s["properties"]["zona_id"]] += 1

    features = []
    for z, geom in zones:
        props = {
            k: z[k]
            for k in ("id", "orden", "nombre", "estado", "municipios", "comunidades", "nivel", "evidencia",
                      "exposiciones", "efectos_salud", "descripcion")
        }  # fmt: skip
        props["fuentes"] = [spec["fuentes"][key] for key in z["fuentes"]]
        props["num_escuelas"] = count[z["id"]]
        props["trazo"] = "aproximado"
        features.append({"type": "Feature", "properties": {"tipo": "zona", **props}, "geometry": round_coords(geom)})
        label = geom.representative_point()
        features.append(
            {
                "type": "Feature",
                "properties": {"tipo": "etiqueta", "id": z["id"], "nombre": z["nombre"], "nivel": z["nivel"]},
                "geometry": round_coords(label),
            }
        )

    meta = {
        "fuente_escuelas": "INEGI, DENUE 05/2026, sector 61 (SCIAN 6111xx). Términos de libre uso de la información del INEGI.",
        "nota": "Trazos aproximados de prototipo: corredor alrededor del cauce dibujado en basin.ts y de las comunidades citadas.",
    }
    OUT_ZONES.write_text(
        json.dumps({"type": "FeatureCollection", "metadata": meta, "features": features}, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    OUT_SCHOOLS.write_text(
        json.dumps({"type": "FeatureCollection", "metadata": meta, "features": schools}, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    for z, _ in zones:
        print(f"  {z['id']}: {count[z['id']]} escuelas")
    print(f"→ {OUT_ZONES.relative_to(ROOT)}\n→ {OUT_SCHOOLS.relative_to(ROOT)} ({len(schools)} escuelas)")


if __name__ == "__main__":
    main()
