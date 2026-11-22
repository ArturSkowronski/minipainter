"""Write and read a minimal GLB: one mesh with positions and indices, no normals."""
import json
import os
from pathlib import Path

import numpy as np

_MAGIC, _JSON, _BIN = 0x46546C67, 0x4E4F534A, 0x004E4942


def _pad(data: bytes, fill: bytes) -> bytes:
    return data + fill * (-len(data) % 4)


def write_glb(path: Path, vertices: np.ndarray, faces: np.ndarray) -> None:
    """Write atomically: the file appears complete or not at all."""
    path = Path(path)
    v = np.ascontiguousarray(vertices, dtype="<f4")
    f = np.ascontiguousarray(faces, dtype="<u4")
    indices, positions = f.tobytes(), v.tobytes()
    doc = {
        "asset": {"version": "2.0", "generator": "warpaint-model"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 1}, "indices": 0, "mode": 4}]}],
        "buffers": [{"byteLength": len(indices) + len(positions)}],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": len(indices), "target": 34963},
            {"buffer": 0, "byteOffset": len(indices), "byteLength": len(positions), "target": 34962},
        ],
        "accessors": [
            {"bufferView": 0, "componentType": 5125, "count": int(f.size), "type": "SCALAR"},
            {"bufferView": 1, "componentType": 5126, "count": len(v), "type": "VEC3",
             "min": [float(x) for x in v.min(0)], "max": [float(x) for x in v.max(0)]},
        ],
    }
    head = _pad(json.dumps(doc, separators=(",", ":")).encode(), b" ")
    body = _pad(indices + positions, b"\0")
    total = 12 + 8 + len(head) + 8 + len(body)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "wb") as fh:
        fh.write(np.array([_MAGIC, 2, total, len(head), _JSON], dtype="<u4").tobytes())
        fh.write(head)
        fh.write(np.array([len(body), _BIN], dtype="<u4").tobytes())
        fh.write(body)
    os.replace(tmp, path)


def read_glb(path: Path) -> tuple[np.ndarray, np.ndarray]:
    """Return (vertices float32 (n, 3), faces uint32 (m, 3)) of a file written by write_glb."""
    raw = Path(path).read_bytes()
    json_len = int.from_bytes(raw[12:16], "little")
    doc = json.loads(raw[20:20 + json_len])
    body = raw[20 + json_len + 8:]

    def view(accessor_index: int, dtype: str, width: int) -> np.ndarray:
        acc = doc["accessors"][accessor_index]
        bv = doc["bufferViews"][acc["bufferView"]]
        return np.frombuffer(body, dtype=dtype, count=acc["count"] * width, offset=bv.get("byteOffset", 0))

    prim = doc["meshes"][0]["primitives"][0]
    vertices = view(prim["attributes"]["POSITION"], "<f4", 3).reshape(-1, 3)
    faces = view(prim["indices"], "<u4", 1).reshape(-1, 3)
    return vertices.astype(np.float32), faces.astype(np.uint32)
