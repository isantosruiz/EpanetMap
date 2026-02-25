from __future__ import annotations

import math
import re
from pathlib import Path
from statistics import mean
from typing import Any

from flask import Flask, jsonify, render_template, request


BASE_DIR = Path(__file__).resolve().parent.parent
app = Flask(
    __name__,
    static_folder=str(BASE_DIR / "static"),
    template_folder=str(BASE_DIR / "templates"),
)


class EpanetParseError(Exception):
    """Raised when a .NET/.INP file cannot be parsed for map layout data."""


def _clean_line(raw_line: str) -> str:
    return raw_line.split(";", 1)[0].strip()


def _safe_float(value: str) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _parse_sections(raw_text: str) -> dict[str, list[str]]:
    sections: dict[str, list[str]] = {}
    current_section: str | None = None

    for raw_line in raw_text.splitlines():
        line = _clean_line(raw_line)
        if not line:
            continue

        if line.startswith("[") and line.endswith("]"):
            current_section = line[1:-1].strip().upper()
            sections.setdefault(current_section, [])
            continue

        if current_section is not None:
            sections[current_section].append(line)

    return sections


def parse_epanet_network(raw_text: str) -> dict[str, Any]:
    sections = _parse_sections(raw_text)

    nodes: dict[str, dict[str, Any]] = {}
    coordinates: dict[str, tuple[float, float]] = {}
    pipes: list[dict[str, Any]] = []
    vertices: dict[str, list[tuple[float, float]]] = {}

    for section_name, node_type in (
        ("JUNCTIONS", "junction"),
        ("RESERVOIRS", "reservoir"),
        ("TANKS", "tank"),
    ):
        for line in sections.get(section_name, []):
            parts = line.split()
            if not parts:
                continue
            node_id = parts[0]
            nodes[node_id] = {"id": node_id, "type": node_type}

    for line in sections.get("COORDINATES", []):
        parts = line.split()
        if len(parts) < 3:
            continue
        node_id = parts[0]
        x = _safe_float(parts[1])
        y = _safe_float(parts[2])
        if x is None or y is None:
            continue
        coordinates[node_id] = (x, y)
        nodes.setdefault(node_id, {"id": node_id, "type": "unknown"})

    for line in sections.get("VERTICES", []):
        parts = line.split()
        if len(parts) < 3:
            continue
        pipe_id = parts[0]
        x = _safe_float(parts[1])
        y = _safe_float(parts[2])
        if x is None or y is None:
            continue
        vertices.setdefault(pipe_id, []).append((x, y))

    for line in sections.get("PIPES", []):
        parts = line.split()
        if len(parts) < 3:
            continue

        pipe_id = parts[0]
        start_node = parts[1]
        end_node = parts[2]

        pipes.append(
            {
                "id": pipe_id,
                "start_node": start_node,
                "end_node": end_node,
                "length": _safe_float(parts[3]) if len(parts) > 3 else None,
                "diameter": _safe_float(parts[4]) if len(parts) > 4 else None,
                "roughness": _safe_float(parts[5]) if len(parts) > 5 else None,
                "minor_loss": _safe_float(parts[6]) if len(parts) > 6 else None,
                "status": parts[7] if len(parts) > 7 else None,
                "vertices": vertices.get(pipe_id, []),
            }
        )

    if not pipes:
        raise EpanetParseError("No se encontro la seccion [PIPES] con datos validos.")

    if not coordinates:
        raise EpanetParseError(
            "No se encontro la seccion [COORDINATES]. El archivo necesita coordenadas para dibujar el layout."
        )

    return {
        "nodes": nodes,
        "coordinates": coordinates,
        "pipes": pipes,
    }


def _parse_utm_zone(raw_zone: str) -> tuple[int, str]:
    match = re.match(r"^\s*(\d{1,2})\s*([C-HJ-NP-Xc-hj-np-x])\s*$", raw_zone or "")
    if not match:
        raise EpanetParseError(
            "Zona UTM invalida. Usa formato como 14Q o 30T (numero 1-60 y letra C-X)."
        )

    zone_number = int(match.group(1))
    if not 1 <= zone_number <= 60:
        raise EpanetParseError("El numero de zona UTM debe estar entre 1 y 60.")

    zone_letter = match.group(2).upper()
    return zone_number, zone_letter


def _transform_factory(
    points: list[tuple[float, float]],
    center_lat: float,
    center_lon: float,
    meters_per_unit: float,
    coordinate_mode: str,
    utm_zone: str,
):
    normalized_mode = coordinate_mode.strip().lower()
    if normalized_mode not in {"local", "utm"}:
        raise EpanetParseError("coordinate_mode debe ser local o utm.")

    if normalized_mode == "utm":
        zone_number, zone_letter = _parse_utm_zone(utm_zone)

        try:
            import utm
        except ModuleNotFoundError:
            raise EpanetParseError(
                "El modo UTM requiere la libreria 'utm'. Ejecuta: pip install -r requirements.txt"
            )

        mode = "utm"
        mode_meta = {"utm_zone": f"{zone_number}{zone_letter}"}

        def to_latlon(x: float, y: float) -> tuple[float, float]:
            try:
                lat, lon = utm.to_latlon(
                    easting=x,
                    northing=y,
                    zone_number=zone_number,
                    zone_letter=zone_letter,
                )
            except Exception:
                raise EpanetParseError(
                    "Coordenadas UTM fuera de rango o incompatibles con la zona indicada."
                )
            return float(lat), float(lon)

        return mode, to_latlon, mode_meta

    if meters_per_unit <= 0:
        raise EpanetParseError("El parametro meters_per_unit debe ser mayor a 0 para modo local.")

    mode = "local"
    mode_meta = {}
    center_x = mean([p[0] for p in points])
    center_y = mean([p[1] for p in points])
    safe_cos = max(abs(math.cos(math.radians(center_lat))), 1e-6)

    def to_latlon(x: float, y: float) -> tuple[float, float]:
        dx_m = (x - center_x) * meters_per_unit
        dy_m = (y - center_y) * meters_per_unit
        lat = center_lat + (dy_m / 111_320.0)
        lon = center_lon + (dx_m / (111_320.0 * safe_cos))
        return lat, lon

    return mode, to_latlon, mode_meta


def to_map_payload(
    network: dict[str, Any],
    center_lat: float,
    center_lon: float,
    meters_per_unit: float,
    coordinate_mode: str,
    utm_zone: str,
) -> dict[str, Any]:
    node_coords = list(network["coordinates"].values())
    mode, to_latlon, mode_meta = _transform_factory(
        points=node_coords,
        center_lat=center_lat,
        center_lon=center_lon,
        meters_per_unit=meters_per_unit,
        coordinate_mode=coordinate_mode,
        utm_zone=utm_zone,
    )

    node_points: list[dict[str, Any]] = []
    for node_id, node in network["nodes"].items():
        coord = network["coordinates"].get(node_id)
        if coord is None:
            continue
        lat, lon = to_latlon(coord[0], coord[1])
        node_points.append(
            {
                "id": node_id,
                "type": node["type"],
                "lat": lat,
                "lon": lon,
            }
        )

    pipe_segments: list[dict[str, Any]] = []
    all_lat: list[float] = []
    all_lon: list[float] = []

    for pipe in network["pipes"]:
        start_coord = network["coordinates"].get(pipe["start_node"])
        end_coord = network["coordinates"].get(pipe["end_node"])
        if start_coord is None or end_coord is None:
            continue

        raw_path = [start_coord, *pipe["vertices"], end_coord]
        path_latlon: list[list[float]] = []
        for x, y in raw_path:
            lat, lon = to_latlon(x, y)
            path_latlon.append([lat, lon])
            all_lat.append(lat)
            all_lon.append(lon)

        pipe_segments.append(
            {
                "id": pipe["id"],
                "start_node": pipe["start_node"],
                "end_node": pipe["end_node"],
                "length": pipe["length"],
                "diameter": pipe["diameter"],
                "status": pipe["status"],
                "coordinates": path_latlon,
            }
        )

    if not pipe_segments:
        raise EpanetParseError(
            "No se pudieron proyectar tuberias porque faltan coordenadas en nodos de inicio/fin."
        )

    meta: dict[str, Any] = {
        "projection_mode": mode,
        "node_count": len(node_points),
        "pipe_count": len(pipe_segments),
    }
    meta.update(mode_meta)

    return {
        "meta": meta,
        "nodes": node_points,
        "pipes": pipe_segments,
        "bounds": {
            "south": min(all_lat),
            "north": max(all_lat),
            "west": min(all_lon),
            "east": max(all_lon),
        },
    }


@app.get("/")
def index():
    return render_template("index.html")


@app.post("/api/parse-network")
def parse_network():
    uploaded_file = request.files.get("file")
    if uploaded_file is None or not uploaded_file.filename:
        return jsonify({"error": "Debes subir un archivo .NET o .INP"}), 400

    def parse_float_or_default(field_name: str, default: float) -> float:
        raw = (request.form.get(field_name, "") or "").strip()
        if raw == "":
            return default
        return float(raw)

    try:
        center_lat = parse_float_or_default("center_lat", 0.0)
        center_lon = parse_float_or_default("center_lon", 0.0)
        meters_per_unit = parse_float_or_default("meters_per_unit", 1.0)
    except ValueError:
        return jsonify({"error": "Los parametros numericos no son validos."}), 400
    coordinate_mode = request.form.get("coordinate_mode", "utm")
    utm_zone = request.form.get("utm_zone", "")

    raw_bytes = uploaded_file.read()
    if not raw_bytes:
        return jsonify({"error": "El archivo esta vacio."}), 400

    decoded_text = None
    for encoding in ("utf-8-sig", "latin-1"):
        try:
            decoded_text = raw_bytes.decode(encoding)
            break
        except UnicodeDecodeError:
            continue

    if decoded_text is None:
        return jsonify({"error": "No se pudo decodificar el archivo de EPANET."}), 400

    try:
        network = parse_epanet_network(decoded_text)
        payload = to_map_payload(
            network=network,
            center_lat=center_lat,
            center_lon=center_lon,
            meters_per_unit=meters_per_unit,
            coordinate_mode=coordinate_mode,
            utm_zone=utm_zone,
        )
        return jsonify(payload)
    except EpanetParseError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception:
        return jsonify({"error": "Error interno al procesar el archivo de red."}), 500


@app.get("/api/health")
def health():
    return jsonify({"ok": True})


if __name__ == "__main__":
    app.run(debug=True)
