import re
from pathlib import Path

from tests.meshes import cube, write_binary_stl
from tests.packages import artorias, ciri, flat, spiderman
from wpm.profiles import detect
from wpm.profiles.nomnom import scan


def test_spiderman_layout(tmp_path):
    pkg = scan(spiderman(tmp_path / "spiderman"))
    assert pkg.profile == "nomnom" and pkg.name == "spiderman"
    assert [(v.name, v.kind) for v in pkg.variants] == [
        ("1-10 Scale Split", "split"), ("1-10 Scale", "unsplit"),
        ("75mm Miniature", "miniature"), ("Bust", "bust")]
    assert [p.id for p in pkg.variants[0].parts] == ["body", "l-arm", "r-arm"]
    assert {r.role for r in pkg.references} == {"colour", "turntable", "beauty", "parts", "bust", "scale"}


def test_presupports_and_junk_are_ignored(tmp_path):
    pkg = scan(ciri(tmp_path / "c"))
    split = next(v for v in pkg.variants if v.kind == "split")
    assert [p.id for p in split.parts] == ["head", "l-arm", "torso"]        # no output (1).stl
    root = spiderman(tmp_path / "s")
    assert all("presupport" not in str(p.path.relative_to(root)).lower()
               for v in scan(root).variants for p in v.parts)


def test_ciri_reference_roles(tmp_path):
    roles = {r.path.name: r.role for r in scan(ciri(tmp_path / "c")).references}
    assert roles == {"Turntable_01.jpg": "turntable", "Beautyshot_01.jpg": "beauty",
                     "ScaleParts.jpg": "parts", "Bust.jpg": "bust"}


def test_artorias_layout_has_no_references(tmp_path):
    pkg = scan(artorias(tmp_path / "a"))
    assert [v.name for v in pkg.variants] == ["178mm_split", "178mm", "Bust"]
    assert pkg.references == ()


def test_flat_directory_is_one_variant(tmp_path):
    pkg = scan(flat(tmp_path / "f"))
    assert len(pkg.variants) == 1 and pkg.variants[0].kind == "split" and len(pkg.variants[0].parts) == 3


def test_directory_holding_several_packages_is_not_a_package(tmp_path):
    ciri(tmp_path / "models" / "x")
    artorias(tmp_path / "models" / "y")
    assert scan(tmp_path / "models") is None


def test_detect_from_a_variant_directory(tmp_path):
    root = spiderman(tmp_path / "s")
    pkg, variant = detect(root / "STL" / "1-10 Scale Split")
    assert pkg.root == root and variant == "1-10-scale-split" and len(pkg.references) == 6


def test_detect_from_the_container_and_from_the_root(tmp_path):
    root = spiderman(tmp_path / "s")
    assert detect(root / "STL")[0].root == root and detect(root / "STL")[1] is None
    assert detect(Path(str(root) + "/"))[0].root == root


def test_detect_from_a_ciri_variant_inside_a_models_folder(tmp_path):
    root = ciri(tmp_path / "models" / "c")
    artorias(tmp_path / "models" / "a")
    pkg, variant = detect(root / "178 mm split")
    assert pkg.root == root and variant == "178-mm-split"


def test_detect_preselects_the_only_variant(tmp_path):
    pkg, variant = detect(flat(tmp_path / "f"))
    assert variant == pkg.variants[0].id == "f"


def test_a_175mm_variant_is_not_a_miniature(tmp_path):
    root = tmp_path / "p"
    write_binary_stl(root / "175mm" / "body.stl", *cube())
    write_binary_stl(root / "75mm" / "body.stl", *cube())
    assert {v.name: v.kind for v in scan(root).variants} == {"175mm": "unsplit", "75mm": "miniature"}


def test_colliding_part_names_get_distinct_ids(tmp_path):
    d = tmp_path / "p"
    d.mkdir()
    for n in ("Arm A.stl", "arm_a.stl", "żółw.stl"):
        write_binary_stl(d / n, *cube())
    ids = [p.id for p in scan(d).variants[0].parts]
    assert len(set(ids)) == 3 and all(re.fullmatch(r"[a-z0-9-]+", i) for i in ids)


def test_not_a_package(tmp_path):
    (tmp_path / "readme.txt").write_text("x")
    assert detect(tmp_path) is None and detect(tmp_path / "missing") is None


def test_a_stray_stl_does_not_turn_a_folder_of_packages_into_a_package(tmp_path):
    models = tmp_path / "models"
    ciri(models / "x")
    artorias(models / "y")
    write_binary_stl(models / "loose.stl", *cube())
    assert scan(models) is None
    assert detect(models / "x")[0].root == models / "x"
