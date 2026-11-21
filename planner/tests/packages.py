"""Fixture directory trees of the package layouts seen in the wild. The given directory is the package root."""
from pathlib import Path

from PIL import Image

from tests.meshes import cube, write_binary_stl


def _stl(root: Path, *rel: str) -> None:
    for r in rel:
        write_binary_stl(root / r, *cube())


def _img(root: Path, *rel: str) -> None:
    for r in rel:
        (root / r).parent.mkdir(parents=True, exist_ok=True)
        Image.new("RGB", (1, 1), "gray").save(root / r)


def _touch(root: Path, *rel: str) -> None:
    for r in rel:
        (root / r).parent.mkdir(parents=True, exist_ok=True)
        (root / r).write_text("x")


def spiderman(root: Path) -> Path:
    _stl(root, "STL/1-10 Scale Split/body.stl", "STL/1-10 Scale Split/L_arm.stl", "STL/1-10 Scale Split/R_arm.stl",
         "STL/1-10 Scale/178mm_upperBody.stl", "STL/75mm Miniature/75mm_upperBody.stl",
         "STL/Bust/bust_torso.stl", "STL/Bust/Bust_plinth_01.stl",
         "Presupports/1-10 Scale Split/STL/NOM_body_Supported.stl")
    _touch(root, "Presupports/1-10 Scale Split/Lychee/NOM_body_Supported.lys")
    _img(root, *(f"Render Images/{n}.jpg" for n in ("Colored_01", "Turntable_01", "BS_01", "Parts", "Bust", "Scale")))
    return root


def ciri(root: Path) -> Path:
    _stl(root, "178 mm split/head.stl", "178 mm split/torso.stl", "178 mm split/L_arm.stl",
         "178 mm split/output (1).stl", "178 mm/178mm_ciri.stl", "75 mm/ciri_75mm_ciri.stl",
         "Bust/CiriBust_head.stl")
    _touch(root, "178 mm split/Info.txt")
    _img(root, "Turntable_01.jpg", "Beautyshot_01.jpg", "ScaleParts.jpg", "Bust.jpg")
    return root


def artorias(root: Path) -> Path:
    _stl(root, "Artorias_STL/178mm_split/head.stl", "Artorias_STL/178mm_split/torso.stl",
         "Artorias_STL/178mm/Artorias178mm_body.stl", "Artorias_STL/Bust/ArtoriasBust_head.stl",
         "Artorias_Presupport/178mm_split/STL/head.stl")
    return root


def flat(root: Path) -> Path:
    _stl(root, "a.stl", "b.stl", "c.stl")
    return root
