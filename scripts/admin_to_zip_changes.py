#!/usr/bin/env python3
"""
Convert admin-area assignment CSV into ZIP-level reassignment CSVs.

Typical usage:
  python3 scripts/admin_to_zip_changes.py \
    --asis asis.csv \
    --baseline data/asis_admin_assignments.csv \
    --updated out/area_assignments_after_edit.csv \
    --out-dir out
"""

from __future__ import annotations

import argparse
import csv
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Set


DEPOT_NAMES = {
    "SGM": "相模原デポ SGM",
    "FUJ": "藤沢デポ FUJ",
    "YOK": "横浜港北デポ YOK",
}


@dataclass
class AreaAssignment:
    area_id: str
    area_name: str
    depot_code: str


def normalize_header(value: str) -> str:
    return str(value or "").replace("\ufeff", "").strip().lower()


def normalize_zip(value: str) -> str:
    digits = re.sub(r"[^\d]", "", str(value or ""))
    return digits[:7] if len(digits) >= 7 else digits


def normalize_depot_code(value: str) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    upper = raw.upper()
    if upper in DEPOT_NAMES:
        return upper
    if "SGM" in upper or "相模原" in raw:
        return "SGM"
    if "FUJ" in upper or "藤沢" in raw:
        return "FUJ"
    if "YOK" in upper or "横浜港北" in raw:
        return "YOK"
    return ""


def canonical_area_name(value: str) -> str:
    out = str(value or "").strip()
    out = re.sub(r"[\s　]", "", out)
    out = re.sub(r"\(.*?\)", "", out)
    out = re.sub(r"（.*?）", "", out)
    out = re.sub(r"^(東京都|神奈川県)", "", out)
    if out == "町田":
        out = "町田市"
    if out == "藤沢":
        out = "藤沢市"
    if re.match(r"^横浜.+区$", out) and not out.startswith("横浜市"):
        out = "横浜市" + out[len("横浜") :]
    if re.match(r"^川崎.+区$", out) and not out.startswith("川崎市"):
        out = "川崎市" + out[len("川崎") :]
    if re.match(r"^相模原.+区$", out) and not out.startswith("相模原市"):
        out = "相模原市" + out[len("相模原") :]
    return out


def read_csv(path: Path) -> List[dict]:
    with path.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        return [dict(row) for row in reader]


def pick_value(row: dict, headers: Iterable[str]) -> str:
    lowered = {normalize_header(k): k for k in row.keys()}
    for h in headers:
        key = lowered.get(normalize_header(h))
        if key is not None:
            return str(row.get(key, "")).strip()
    return ""


def load_area_assignments(path: Path) -> Dict[str, AreaAssignment]:
    rows = read_csv(path)
    out: Dict[str, AreaAssignment] = {}
    for row in rows:
        area_id = pick_value(row, ["area_id", "area_code", "id", "code", "N03_007"])
        area_name = pick_value(row, ["area_name", "municipality", "name", "名称", "市区", "市区町村"])
        depot = normalize_depot_code(pick_value(row, ["depot_code", "depot", "管轄デポ", "担当デポ"]))
        if not area_id:
            continue
        out[area_id] = AreaAssignment(area_id=area_id, area_name=area_name, depot_code=depot)
    return out


def build_name_index(assignments: Dict[str, AreaAssignment]) -> Dict[str, Set[str]]:
    index: Dict[str, Set[str]] = {}
    for area_id, rec in assignments.items():
        for raw in [area_id, rec.area_name]:
            key = canonical_area_name(raw)
            if not key:
                continue
            if key not in index:
                index[key] = set()
            index[key].add(area_id)
    return index


def resolve_area_ids(city_value: str, area_value: str, name_index: Dict[str, Set[str]]) -> Set[str]:
    candidates: Set[str] = set()
    for raw in [city_value, area_value]:
        key = canonical_area_name(raw)
        if key in name_index:
            candidates.update(name_index[key])
    return candidates


def detect_area_changes(
    baseline: Dict[str, AreaAssignment],
    updated: Dict[str, AreaAssignment],
    include_clear: bool = False,
) -> Dict[str, AreaAssignment]:
    changed: Dict[str, AreaAssignment] = {}
    for area_id, new in updated.items():
        old = baseline.get(area_id, AreaAssignment(area_id=area_id, area_name=new.area_name, depot_code=""))
        old_code = normalize_depot_code(old.depot_code)
        new_code = normalize_depot_code(new.depot_code)
        if not include_clear and not new_code:
            continue
        if old_code != new_code:
            name = new.area_name or old.area_name or area_id
            changed[area_id] = AreaAssignment(area_id=area_id, area_name=name, depot_code=new_code)
    return changed


def write_csv(path: Path, headers: List[str], rows: List[List[str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(headers)
        writer.writerows(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description="Convert admin-area assignment changes into ZIP-level changes.")
    parser.add_argument("--asis", default="asis.csv", help="Path to as-is ZIP assignment CSV.")
    parser.add_argument("--baseline", default="data/asis_admin_assignments.csv", help="Baseline admin assignment CSV.")
    parser.add_argument("--updated", required=True, help="Updated admin assignment CSV exported from the map tool.")
    parser.add_argument("--out-dir", default="out", help="Output directory.")
    parser.add_argument(
        "--include-clear",
        action="store_true",
        help="Treat blank depot in updated CSV as an intentional clear and include it as a change.",
    )
    args = parser.parse_args()

    asis_path = Path(args.asis)
    baseline_path = Path(args.baseline)
    updated_path = Path(args.updated)
    out_dir = Path(args.out_dir)

    baseline = load_area_assignments(baseline_path)
    updated = load_area_assignments(updated_path)
    changed_areas = detect_area_changes(baseline, updated, include_clear=args.include_clear)
    name_index = build_name_index(updated or baseline)

    area_change_rows: List[List[str]] = []
    for area_id in sorted(changed_areas):
        new = changed_areas[area_id]
        old = baseline.get(area_id, AreaAssignment(area_id=area_id, area_name=new.area_name, depot_code=""))
        old_code = normalize_depot_code(old.depot_code)
        new_code = normalize_depot_code(new.depot_code)
        area_change_rows.append(
            [
                area_id,
                new.area_name or old.area_name or area_id,
                old_code,
                DEPOT_NAMES.get(old_code, ""),
                new_code,
                DEPOT_NAMES.get(new_code, ""),
            ]
        )

    asis_rows = read_csv(asis_path)

    zip_all_rows: List[List[str]] = []
    zip_changes_rows: List[List[str]] = []

    for row in asis_rows:
        zip_code = normalize_zip(pick_value(row, ["郵便番号", "zip_code", "zipcode", "zip", "postal_code"]))
        city = pick_value(row, ["市区", "city", "municipality"])
        town = pick_value(row, ["町", "town"])
        area_label = pick_value(row, ["対応エリア", "area_name", "municipality"])
        before_code = normalize_depot_code(pick_value(row, ["管轄デポ", "担当デポ", "depot_code", "depot"]))
        before_name = DEPOT_NAMES.get(before_code, "")

        matched_area_ids = resolve_area_ids(city, area_label, name_index)
        area_id = ""
        area_name = ""
        match_status = "NO_MATCH"
        if len(matched_area_ids) == 1:
            area_id = next(iter(matched_area_ids))
            area_name = (updated.get(area_id) or baseline.get(area_id) or AreaAssignment(area_id, "", "")).area_name
            match_status = "OK"
        elif len(matched_area_ids) > 1:
            match_status = "AMBIGUOUS"

        after_code = before_code
        if area_id and area_id in changed_areas:
            after_code = changed_areas[area_id].depot_code
        after_name = DEPOT_NAMES.get(after_code, "")
        changed = "1" if after_code != before_code else "0"

        all_row = [
            zip_code,
            city,
            town,
            area_label,
            area_id,
            area_name,
            match_status,
            before_code,
            before_name,
            after_code,
            after_name,
            changed,
        ]
        zip_all_rows.append(all_row)
        if changed == "1":
            zip_changes_rows.append(all_row)

    write_csv(
        out_dir / "area_changes.csv",
        ["area_id", "area_name", "before_depot_code", "before_depot_name", "after_depot_code", "after_depot_name"],
        area_change_rows,
    )
    write_csv(
        out_dir / "zip_reassignment_all.csv",
        [
            "zip_code",
            "city",
            "town",
            "area_label",
            "area_id",
            "area_name",
            "match_status",
            "before_depot_code",
            "before_depot_name",
            "after_depot_code",
            "after_depot_name",
            "changed",
        ],
        zip_all_rows,
    )
    write_csv(
        out_dir / "zip_changes_only.csv",
        [
            "zip_code",
            "city",
            "town",
            "area_label",
            "area_id",
            "area_name",
            "match_status",
            "before_depot_code",
            "before_depot_name",
            "after_depot_code",
            "after_depot_name",
            "changed",
        ],
        zip_changes_rows,
    )

    print(f"updated admin areas loaded: {len(updated)}")
    print(f"changed admin areas: {len(area_change_rows)}")
    print(f"zip rows processed: {len(zip_all_rows)}")
    print(f"zip rows changed: {len(zip_changes_rows)}")
    print(f"wrote: {out_dir / 'area_changes.csv'}")
    print(f"wrote: {out_dir / 'zip_reassignment_all.csv'}")
    print(f"wrote: {out_dir / 'zip_changes_only.csv'}")


if __name__ == "__main__":
    main()
