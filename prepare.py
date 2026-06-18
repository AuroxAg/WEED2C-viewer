#!/usr/bin/env python3
"""
WEED2C Viewer — data preparation pipeline.

Reads WEED2C-Dataset.zip, extracts the JPGs, generates web thumbnails, parses
the Pascal-VOC (.xml) annotations and emits a single compact manifest
(data/index.json) consumed by the static viewer.

Usage:
    python3 prepare.py                 # full run (extract + thumbs + manifest)
    python3 prepare.py --skip-thumbs   # rebuild manifest only (fast)

Output layout:
    images/   full-resolution JPGs            (gitignored)
    thumbs/   ~520px web thumbnails           (gitignored)
    data/index.json   manifest for the viewer (committed)

Only the Python standard library + Pillow are required.
"""
from __future__ import annotations

import argparse
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
# Source archive: env override lets the deploy build point at a downloaded copy.
ZIP_PATH = Path(os.environ.get("WEED2C_ZIP") or (ROOT / "WEED2C-Dataset.zip"))
IMAGES_DIR = ROOT / "images"
THUMBS_DIR = ROOT / "thumbs"
DATA_DIR = ROOT / "data"
THUMB_WIDTH = 520
THUMB_QUALITY = 74

# --- Domain knowledge --------------------------------------------------------
# The dataset ships two weed classes (the "2C" in WEED2C). Common names are in
# Brazilian Portuguese; scientific names and palette follow the Aurox system.
CLASS_META = {
    "buva": {
        "label": "Hairy fleabane",
        "sci": "Conyza spp. · buva",
        "color": "#4A5123",   # Field Olive
    },
    "capim_amargoso": {
        "label": "Sourgrass",
        "sci": "Digitaria insularis · capim-amargoso",
        "color": "#B9AA8A",   # Dry Soil
    },
}

# The three filename prefixes are real collection sessions (date + field).
GROUP_META = {
    "08-12-2020-v1": {"label": "Dec 8, 2020 · Field 1", "date": "2020-12-08"},
    "08-12-2020-v2": {"label": "Dec 8, 2020 · Field 2", "date": "2020-12-08"},
    "18-12-2020":    {"label": "Dec 18, 2020",          "date": "2020-12-18"},
}

# --- Estimated soybean vegetative stage --------------------------------------
# The dataset ships NO per-image stage label. The paper (Tetila et al., 2024)
# states three areas were imaged across the V3/V4/V5 vegetative stages. We order
# the three collection sessions by measured canopy development (Excess-Green
# coverage: T2≈0.43 < T1≈0.48 << 18-dez≈0.84) and by date, then assign V3<V4<V5.
# This is an INFERENCE, surfaced as "estimated" in the UI. Edit this map if the
# dataset authors confirm the true area→stage assignment.
STAGE_ORDER = ["V3", "V4", "V5"]
STAGE_META = {
    "V3": {"label": "V3", "desc": "3rd trifoliate leaf · early canopy"},
    "V4": {"label": "V4", "desc": "4th trifoliate leaf · intermediate canopy"},
    "V5": {"label": "V5", "desc": "5th trifoliate leaf · advanced canopy"},
}
SESSION_STAGE = {
    "08-12-2020-v2": "V3",   # lowest measured canopy coverage (~0.43)
    "08-12-2020-v1": "V4",   # intermediate coverage (~0.48)
    "18-12-2020":    "V5",   # clearly denser canopy (~0.84), 10 days later
}


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


def group_of(stem: str) -> str:
    """Derive the collection-session key from a filename stem like
    '08-12-2020-v1 (100)'."""
    return stem.split(" (")[0].strip()


def parse_voc(xml_bytes: bytes):
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


def main():
    ap = argparse.ArgumentParser(description="Prepare the WEED2C viewer dataset.")
    ap.add_argument("--skip-thumbs", action="store_true",
                    help="Skip image extraction/thumbnailing; rebuild manifest only.")
    args = ap.parse_args()

    if not ZIP_PATH.exists():
        sys.exit(f"Dataset not found: {ZIP_PATH}")

    IMAGES_DIR.mkdir(exist_ok=True)
    THUMBS_DIR.mkdir(exist_ok=True)
    DATA_DIR.mkdir(exist_ok=True)

    class_ids = list(CLASS_META.keys())
    class_idx = {c: i for i, c in enumerate(class_ids)}
    group_ids = list(GROUP_META.keys())
    group_idx = {g: i for i, g in enumerate(group_ids)}
    stage_idx = {s: i for i, s in enumerate(STAGE_ORDER)}

    zf = zipfile.ZipFile(ZIP_PATH)
    names = zf.namelist()
    # Map stem -> {jpg, xml}
    members: dict[str, dict] = defaultdict(dict)
    for n in names:
        if n.endswith("/"):
            continue
        p = Path(n)
        stem = p.stem
        if p.suffix.lower() in (".jpg", ".jpeg"):
            members[stem]["jpg"] = n
        elif p.suffix.lower() == ".xml":
            members[stem]["xml"] = n

    stems = sorted(
        (s for s, m in members.items() if "jpg" in m),
        key=lambda s: (group_of(s), s),
    )
    total = len(stems)
    print(f"Found {total} images in archive.")

    images = []
    class_totals = defaultdict(int)         # class -> box count
    group_image_counts = defaultdict(int)   # group -> image count
    stage_image_counts = defaultdict(int)   # stage -> image count
    stage_canopy = defaultdict(list)        # stage -> [canopy fractions]
    unknown_classes = set()
    unknown_groups = set()

    for i, stem in enumerate(stems, 1):
        m = members[stem]
        jpg_name = m["jpg"]
        grp = group_of(stem)
        if grp not in group_idx:
            unknown_groups.add(grp)
            continue
        group_image_counts[grp] += 1

        # --- extract full image + thumbnail + canopy index ---
        out_jpg = IMAGES_DIR / Path(jpg_name).name
        thumb_path = THUMBS_DIR / Path(jpg_name).name
        w = h = 0
        cv = None
        if not args.skip_thumbs:
            data = zf.read(jpg_name)
            out_jpg.write_bytes(data)
            with Image.open(out_jpg) as im:
                w, h = im.size
                im = im.convert("RGB")
                ratio = THUMB_WIDTH / float(im.width)
                tsize = (THUMB_WIDTH, max(1, int(round(im.height * ratio))))
                thumb = im.resize(tsize, Image.LANCZOS)
                thumb.save(thumb_path, "JPEG", quality=THUMB_QUALITY, optimize=True)
                cv = canopy_fraction(thumb)
        elif thumb_path.exists():
            # manifest-only rebuild: recover canopy from the existing thumbnail
            with Image.open(thumb_path) as thumb:
                cv = canopy_fraction(thumb.convert("RGB"))

        # --- annotations ---
        boxes = []
        counts = [0] * len(class_ids)
        if "xml" in m:
            xw, xh, parsed = parse_voc(zf.read(m["xml"]))
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

        if not w or not h:  # fall back if neither thumb pass nor xml had size
            with Image.open(out_jpg) as im:
                w, h = im.size

        stage = SESSION_STAGE[grp]
        stage_image_counts[stage] += 1
        if cv is not None:
            stage_canopy[stage].append(cv)

        rec = {
            "f": Path(jpg_name).name,
            "g": group_idx[grp],
            "s": stage_idx[stage],
            "w": w,
            "h": h,
            "n": counts,
            "b": boxes,
        }
        if cv is not None:
            rec["cv"] = cv
        images.append(rec)
        if i % 100 == 0 or i == total:
            print(f"  processed {i}/{total}")

    classes_out = [{
        "id": c,
        "label": CLASS_META[c]["label"],
        "sci": CLASS_META[c]["sci"],
        "color": CLASS_META[c]["color"],
        "count": class_totals[c],
    } for c in class_ids]

    groups_out = [{
        "id": g,
        "label": GROUP_META[g]["label"],
        "date": GROUP_META[g]["date"],
        "count": group_image_counts[g],
    } for g in group_ids]

    stages_out = [{
        "id": s,
        "label": STAGE_META[s]["label"],
        "desc": STAGE_META[s]["desc"],
        "count": stage_image_counts[s],
        "canopy": (round(sum(stage_canopy[s]) / len(stage_canopy[s]), 3)
                   if stage_canopy[s] else None),
    } for s in STAGE_ORDER]

    manifest = {
        "dataset": "WEED2C-Dataset",
        "source": "https://github.com/EvertonTetila/WEED2C-Dataset",
        "stageNote": ("Stage estimated from collection date and canopy coverage "
                      "(Excess Green); the dataset does not label stage per image."),
        "classes": classes_out,
        "groups": groups_out,
        "stages": stages_out,
        "totals": {
            "images": len(images),
            "boxes": sum(class_totals.values()),
        },
        "images": images,
    }

    out = DATA_DIR / "index.json"
    out.write_text(json.dumps(manifest, ensure_ascii=False, separators=(",", ":")))
    print(f"\nManifest → {out}  ({out.stat().st_size/1024:.0f} KB)")
    print(f"Images: {len(images)} | Boxes: {sum(class_totals.values())}")
    for c in classes_out:
        print(f"  {c['label']:16} {c['count']:>5} boxes")
    print("Estimated stage (images · mean canopy):")
    for s in stages_out:
        cv = f"{s['canopy']:.3f}" if s["canopy"] is not None else "n/a"
        print(f"  {s['label']:4} {s['count']:>4} imgs · canopy {cv}")
    if unknown_classes:
        print(f"  ! unknown classes skipped: {sorted(unknown_classes)}")
    if unknown_groups:
        print(f"  ! unknown groups skipped: {sorted(unknown_groups)}")


if __name__ == "__main__":
    main()
