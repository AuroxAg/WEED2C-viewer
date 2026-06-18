#!/usr/bin/env python3
"""
Aurox Dataset Viewers — data preparation pipeline (multi-dataset).

Each dataset is extracted from its source archive into per-dataset folders and
reduced to a single compact, self-describing manifest consumed by the generic
viewer:

    images/<id>/   full-resolution images        (gitignored)
    thumbs/<id>/   ~520px web thumbnails          (gitignored)
    data/<id>.json manifest for the viewer        (committed)

The manifest schema is shared across datasets so the viewer stays generic. Per
image: f (file), w/h (size), n (per-class counts), b (boxes
[classIdx, xmin, ymin, xmax, ymax]) plus any facet keys the dataset declares
(e.g. g = collection, s = stage). Top level: classes, facets, density, metrics,
totals. See data/datasets.json for the registry of all datasets.

Usage:
    python3 prepare.py all                 # prepare every dataset it can find
    python3 prepare.py weed2c              # one dataset
    python3 prepare.py soycotton --skip-thumbs

Adding a dataset: write a build_<id>() that returns a manifest dict, register it
in BUILDERS, and add its presentation entry to data/datasets.json.

Only the Python standard library + Pillow are required (numpy is optional and
only used for the canopy index).
"""
from __future__ import annotations

import argparse
import io
import json
import os
import sys
import zipfile
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow is required: pip install Pillow")

try:
    import numpy as np
except ImportError:
    np = None  # canopy index is skipped if numpy is unavailable

ROOT = Path(__file__).resolve().parent
IMAGES_DIR = ROOT / "images"
THUMBS_DIR = ROOT / "thumbs"
DATA_DIR = ROOT / "data"
THUMB_WIDTH = 520
THUMB_QUALITY = 74


# --- Shared helpers ----------------------------------------------------------
def canopy_fraction(im_rgb):
    """Excess-Green vegetation fraction in [0,1] — a per-image proxy for canopy
    development. Returns None when numpy is unavailable."""
    if np is None:
        return None
    a = np.asarray(im_rgb, dtype=np.float32)
    R, G, B = a[..., 0], a[..., 1], a[..., 2]
    s = R + G + B + 1e-6
    exg = (2.0 * G - R - B) / s
    return round(float((exg > 0.05).mean()), 3)


def write_image_and_thumb(src_bytes, out_jpg: Path, thumb_path: Path, want_canopy):
    """Write the full image and a web thumbnail; return (w, h, canopy|None)."""
    out_jpg.write_bytes(src_bytes)
    with Image.open(io.BytesIO(src_bytes)) as im:
        w, h = im.size
        im = im.convert("RGB")
        ratio = THUMB_WIDTH / float(im.width)
        tsize = (THUMB_WIDTH, max(1, int(round(im.height * ratio))))
        thumb = im.resize(tsize, Image.LANCZOS)
        thumb.save(thumb_path, "JPEG", quality=THUMB_QUALITY, optimize=True)
        cv = canopy_fraction(thumb) if want_canopy else None
    return w, h, cv


def dataset_dirs(ds_id: str):
    img = IMAGES_DIR / ds_id
    thb = THUMBS_DIR / ds_id
    img.mkdir(parents=True, exist_ok=True)
    thb.mkdir(parents=True, exist_ok=True)
    DATA_DIR.mkdir(exist_ok=True)
    return img, thb


def write_manifest(ds_id: str, manifest: dict):
    out = DATA_DIR / f"{ds_id}.json"
    out.write_text(json.dumps(manifest, ensure_ascii=False, separators=(",", ":")))
    size = out.stat().st_size / 1024
    print(f"\nManifest → {out}  ({size:.0f} KB)")
    t = manifest["totals"]
    print(f"Images: {t['images']} | Boxes: {t['boxes']}")
    for c in manifest["classes"]:
        print(f"  {c['label']:16} {c['count']:>6} boxes")


# =============================================================================
# WEED2C-Dataset — UAV soybean weed detection (Pascal VOC)
# =============================================================================
WEED2C_ZIP = lambda: Path(os.environ.get("WEED2C_ZIP") or (ROOT / "WEED2C-Dataset.zip"))

WEED2C_CLASSES = [
    {"id": "buva",
     "label": "Hairy fleabane", "sci": "Conyza spp. · buva", "color": "#4A5123"},
    {"id": "capim_amargoso",
     "label": "Sourgrass", "sci": "Digitaria insularis · capim-amargoso", "color": "#B9AA8A"},
]

# The three filename prefixes are real collection sessions (date + field).
WEED2C_GROUPS = [
    {"id": "08-12-2020-v1", "label": "Dec 8, 2020 · Field 1", "sub": "2020-12-08"},
    {"id": "08-12-2020-v2", "label": "Dec 8, 2020 · Field 2", "sub": "2020-12-08"},
    {"id": "18-12-2020",    "label": "Dec 18, 2020",          "sub": "2020-12-18"},
]

# Estimated soybean vegetative stage. The dataset ships NO per-image stage label;
# the paper (Tetila et al., 2024) states three areas were imaged across V3/V4/V5.
# We order the sessions by measured canopy (Excess-Green coverage:
# T2≈0.43 < T1≈0.48 << 18-dez≈0.84) and by date, then assign V3<V4<V5. This is an
# INFERENCE, surfaced as "estimated" in the UI. Edit if authors confirm the map.
WEED2C_STAGES = [
    {"id": "V3", "label": "V3", "desc": "3rd trifoliate leaf · early canopy"},
    {"id": "V4", "label": "V4", "desc": "4th trifoliate leaf · intermediate canopy"},
    {"id": "V5", "label": "V5", "desc": "5th trifoliate leaf · advanced canopy"},
]
WEED2C_SESSION_STAGE = {
    "08-12-2020-v2": "V3",   # lowest measured canopy coverage (~0.43)
    "08-12-2020-v1": "V4",   # intermediate coverage (~0.48)
    "18-12-2020":    "V5",   # clearly denser canopy (~0.84), 10 days later
}


def _group_of(stem: str) -> str:
    """Collection-session key from a stem like '08-12-2020-v1 (100)'."""
    return stem.split(" (")[0].strip()


def _parse_voc(xml_bytes: bytes):
    """Return (width, height, [(class, xmin, ymin, xmax, ymax), ...])."""
    root = ET.fromstring(xml_bytes)
    size = root.find("size")
    w = int(size.findtext("width")) if size is not None else 0
    h = int(size.findtext("height")) if size is not None else 0
    boxes = []
    for obj in root.findall("object"):
        name = (obj.findtext("name") or "").strip()
        bb = obj.find("bndbox")
        if bb is None:
            continue
        try:
            xmin = int(round(float(bb.findtext("xmin"))))
            ymin = int(round(float(bb.findtext("ymin"))))
            xmax = int(round(float(bb.findtext("xmax"))))
            ymax = int(round(float(bb.findtext("ymax"))))
        except (TypeError, ValueError):
            continue
        boxes.append((name, xmin, ymin, xmax, ymax))
    return w, h, boxes


def build_weed2c(skip_thumbs: bool) -> dict:
    zip_path = WEED2C_ZIP()
    if not zip_path.exists():
        sys.exit(f"WEED2C dataset not found: {zip_path}")
    img_dir, thb_dir = dataset_dirs("weed2c")

    class_ids = [c["id"] for c in WEED2C_CLASSES]
    class_idx = {c: i for i, c in enumerate(class_ids)}
    group_ids = [g["id"] for g in WEED2C_GROUPS]
    group_idx = {g: i for i, g in enumerate(group_ids)}
    stage_ids = [s["id"] for s in WEED2C_STAGES]
    stage_idx = {s: i for i, s in enumerate(stage_ids)}

    zf = zipfile.ZipFile(zip_path)
    members: dict[str, dict] = defaultdict(dict)
    for n in zf.namelist():
        if n.endswith("/"):
            continue
        p = Path(n)
        if p.suffix.lower() in (".jpg", ".jpeg"):
            members[p.stem]["jpg"] = n
        elif p.suffix.lower() == ".xml":
            members[p.stem]["xml"] = n

    stems = sorted((s for s, m in members.items() if "jpg" in m),
                   key=lambda s: (_group_of(s), s))
    total = len(stems)
    print(f"[weed2c] {total} images in archive.")

    images = []
    class_totals = defaultdict(int)
    group_counts = defaultdict(int)
    stage_counts = defaultdict(int)
    stage_canopy = defaultdict(list)
    unknown_classes, unknown_groups = set(), set()

    for i, stem in enumerate(stems, 1):
        m = members[stem]
        jpg_name = m["jpg"]
        grp = _group_of(stem)
        if grp not in group_idx:
            unknown_groups.add(grp)
            continue
        group_counts[grp] += 1

        out_jpg = img_dir / Path(jpg_name).name
        thumb_path = thb_dir / Path(jpg_name).name
        w = h = 0
        cv = None
        if not skip_thumbs:
            w, h, cv = write_image_and_thumb(zf.read(jpg_name), out_jpg, thumb_path, True)
        elif thumb_path.exists():
            with Image.open(thumb_path) as thumb:
                cv = canopy_fraction(thumb.convert("RGB"))

        boxes = []
        counts = [0] * len(class_ids)
        if "xml" in m:
            xw, xh, parsed = _parse_voc(zf.read(m["xml"]))
            if xw and xh:
                w, h = xw, xh
            for (cname, xmin, ymin, xmax, ymax) in parsed:
                if cname not in class_idx:
                    unknown_classes.add(cname)
                    continue
                ci = class_idx[cname]
                counts[ci] += 1
                class_totals[cname] += 1
                boxes.append([ci, xmin, ymin, xmax, ymax])

        if not w or not h:
            with Image.open(out_jpg) as im:
                w, h = im.size

        stage = WEED2C_SESSION_STAGE[grp]
        stage_counts[stage] += 1
        if cv is not None:
            stage_canopy[stage].append(cv)

        rec = {"f": Path(jpg_name).name, "g": group_idx[grp], "s": stage_idx[stage],
               "w": w, "h": h, "n": counts, "b": boxes}
        if cv is not None:
            rec["cv"] = cv
        images.append(rec)
        if i % 100 == 0 or i == total:
            print(f"  [weed2c] {i}/{total}")

    classes = [{"label": c["label"], "sci": c["sci"], "color": c["color"],
                "count": class_totals[c["id"]]} for c in WEED2C_CLASSES]
    stage_values = [{
        "label": s["label"], "desc": s["desc"], "count": stage_counts[s["id"]],
        "canopy": (round(sum(stage_canopy[s["id"]]) / len(stage_canopy[s["id"]]), 3)
                   if stage_canopy[s["id"]] else None),
    } for s in WEED2C_STAGES]
    group_values = [{"label": g["label"], "sub": g["sub"],
                     "count": group_counts[g["id"]]} for g in WEED2C_GROUPS]

    return {
        "id": "weed2c",
        "dataset": "WEED2C-Dataset",
        "task": "Object detection",
        "classLabel": "Weed class",
        "classes": classes,
        "facets": [
            {"id": "stage", "key": "s", "label": "Vegetative stage",
             "estimated": True, "badge": True,
             "note": ("Stage estimated from collection date and canopy coverage "
                      "(Excess Green); the dataset does not label stage per image."),
             "values": stage_values},
            {"id": "collection", "key": "g", "label": "Collection",
             "values": group_values},
        ],
        "metrics": {"canopy": True},
        "density": [
            {"id": "sparse", "label": "Sparse", "hint": "1–3", "min": 1, "max": 3},
            {"id": "medium", "label": "Medium", "hint": "4–8", "min": 4, "max": 8},
            {"id": "dense",  "label": "Dense",  "hint": "9+",  "min": 9, "max": None},
        ],
        "totals": {"images": len(images), "boxes": sum(class_totals.values())},
        "images": images,
    }


# =============================================================================
# SoyCotton-Leafs — soybean vs cotton leaves (COCO instance segmentation)
# =============================================================================
SOYCOTTON_ZIP = lambda: Path(os.environ.get("SOYCOTTON_ZIP") or (ROOT / "SoyCotton.zip"))

# COCO category id -> ordered class slot. The viewer overlays the boxes derived
# from each instance mask; soy/cotton get two distinguishable on-brand hues.
SOYCOTTON_CLASSES = [
    {"coco": 1, "label": "Soybean", "sci": "Glycine max · leaf", "color": "#5E7A2E"},
    {"coco": 2, "label": "Cotton",  "sci": "Gossypium hirsutum · leaf", "color": "#B98A4A"},
]


def _find_coco_json(zf: zipfile.ZipFile) -> str:
    for n in zf.namelist():
        if n.endswith(".json") and "annotation" in n.lower():
            return n
    for n in zf.namelist():
        if n.endswith(".json"):
            return n
    sys.exit("SoyCotton: no COCO annotations .json found in archive.")


def build_soycotton(skip_thumbs: bool) -> dict:
    zip_path = SOYCOTTON_ZIP()
    if not zip_path.exists():
        sys.exit(f"SoyCotton dataset not found: {zip_path}")
    img_dir, thb_dir = dataset_dirs("soycotton")

    zf = zipfile.ZipFile(zip_path)
    coco_name = _find_coco_json(zf)
    print(f"[soycotton] reading {coco_name} …")
    coco = json.loads(zf.read(coco_name))

    cat_to_slot = {c["coco"]: i for i, c in enumerate(SOYCOTTON_CLASSES)}
    n_classes = len(SOYCOTTON_CLASSES)

    # Map each COCO image to a record; index annotations by image id.
    by_id: dict[int, dict] = {}
    for im in coco["images"]:
        by_id[im["id"]] = {
            "f": Path(im["file_name"]).name,
            "w": int(im["width"]), "h": int(im["height"]),
            "n": [0] * n_classes, "b": [],
        }
    ann_by_img: dict[int, list] = defaultdict(list)
    for a in coco["annotations"]:
        ann_by_img[a["image_id"]].append(a)

    class_totals = [0] * n_classes
    for img_id, rec in by_id.items():
        for a in ann_by_img.get(img_id, []):
            slot = cat_to_slot.get(a["category_id"])
            if slot is None:
                continue
            x, y, bw, bh = a["bbox"]
            xmin = max(0, int(round(x)))
            ymin = max(0, int(round(y)))
            xmax = min(rec["w"], int(round(x + bw)))
            ymax = min(rec["h"], int(round(y + bh)))
            if xmax <= xmin or ymax <= ymin:
                continue
            rec["n"][slot] += 1
            class_totals[slot] += 1
            rec["b"].append([slot, xmin, ymin, xmax, ymax])

    # Build the locator from the archive's image members (by basename).
    file_member = {Path(n).name: n for n in zf.namelist()
                   if Path(n).suffix.lower() in (".jpg", ".jpeg", ".png")}

    images = []
    recs = sorted(by_id.values(), key=lambda r: r["f"])
    total = len(recs)
    print(f"[soycotton] {total} images, {len(coco['annotations'])} annotations.")
    for i, rec in enumerate(recs, 1):
        member = file_member.get(rec["f"])
        if not skip_thumbs:
            if not member:
                print(f"  ! missing image in archive: {rec['f']}")
                continue
            out_jpg = img_dir / rec["f"]
            thumb_path = thb_dir / rec["f"]
            w, h, _ = write_image_and_thumb(zf.read(member), out_jpg, thumb_path, False)
            # trust COCO dims (bbox coords live in that space); only fill if absent
            if not rec["w"] or not rec["h"]:
                rec["w"], rec["h"] = w, h
        images.append(rec)
        if i % 100 == 0 or i == total:
            print(f"  [soycotton] {i}/{total}")

    classes = [{"label": c["label"], "sci": c["sci"], "color": c["color"],
                "count": class_totals[i]} for i, c in enumerate(SOYCOTTON_CLASSES)]

    return {
        "id": "soycotton",
        "dataset": "SoyCotton-Leafs",
        "task": "Instance segmentation",
        "classLabel": "Leaf class",
        "boxNote": "Boxes shown are the tight bounding boxes of each instance mask.",
        "classes": classes,
        "facets": [],
        "metrics": {"canopy": False},
        "density": [
            {"id": "sparse", "label": "Sparse", "hint": "1–9",   "min": 1,  "max": 9},
            {"id": "medium", "label": "Medium", "hint": "10–29", "min": 10, "max": 29},
            {"id": "dense",  "label": "Dense",  "hint": "30+",   "min": 30, "max": None},
        ],
        "totals": {"images": len(images), "boxes": sum(class_totals)},
        "images": images,
    }


# =============================================================================
BUILDERS = {
    "weed2c": build_weed2c,
    "soycotton": build_soycotton,
}


def main():
    ap = argparse.ArgumentParser(description="Prepare Aurox dataset viewer manifests.")
    ap.add_argument("datasets", nargs="*", default=["all"],
                    help=f"dataset id(s) to build: {', '.join(BUILDERS)} or 'all'.")
    ap.add_argument("--skip-thumbs", action="store_true",
                    help="Skip image extraction/thumbnailing; rebuild manifest only.")
    args = ap.parse_args()

    targets = list(BUILDERS) if (not args.datasets or "all" in args.datasets) \
        else args.datasets
    for ds_id in targets:
        builder = BUILDERS.get(ds_id)
        if not builder:
            print(f"! unknown dataset '{ds_id}' (have: {', '.join(BUILDERS)})")
            continue
        print(f"\n=== {ds_id} ===")
        manifest = builder(args.skip_thumbs)
        write_manifest(ds_id, manifest)


if __name__ == "__main__":
    main()
