"""Downscale one reference image into the workspace."""
import os
from pathlib import Path

from PIL import Image, ImageOps


def prepare_reference(src: Path, dst: Path, max_side: int = 1600) -> None:
    """Write `src` as a JPEG whose longer side is at most `max_side`, upright, atomically."""
    dst = Path(dst)
    dst.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(src) as image:
        image = ImageOps.exif_transpose(image).convert("RGB")
        image.thumbnail((max_side, max_side), Image.LANCZOS)
        tmp = dst.with_suffix(dst.suffix + ".tmp")
        image.save(tmp, format="JPEG", quality=85)
    os.replace(tmp, dst)
