"""Helpers for working with visual label layout configurations."""

from __future__ import annotations

import json
from copy import deepcopy
from typing import Any


FIELD_LIBRARY: dict[str, dict[str, Any]] = {
    "manufacturer": {"label": "Manufacturer", "sample": "Acme Industries"},
    "part_number": {"label": "Part number", "sample": "ACM-42-9000"},
    "description": {"label": "Description", "sample": "Heavy duty fastener"},
    "stock_quantity": {"label": "Quantity", "sample": "Qty: 128"},
    "bin_location": {"label": "Bin", "sample": "Bin: A3-14"},
    "image_url": {"label": "Image", "sample": "Product image"},
    "notes": {"label": "Notes", "sample": "Handle with care"},
    "manufacturer_right": {
        "label": "Manufacturer (right)",
        "sample": "Globex Corp",
        "requires_dual": True,
    },
    "part_number_right": {
        "label": "Part number (right)",
        "sample": "GBX-77-100",
        "requires_dual": True,
    },
    "description_right": {
        "label": "Description (right)",
        "sample": "Right side description",
        "requires_dual": True,
    },
    "stock_quantity_right": {
        "label": "Quantity (right)",
        "sample": "Qty: 64",
        "requires_dual": True,
    },
    "bin_location_right": {
        "label": "Bin (right)",
        "sample": "Bin: B2-07",
        "requires_dual": True,
    },
    "notes_right": {
        "label": "Notes (right)",
        "sample": "Secondary notes",
        "requires_dual": True,
    },
}

_DEFAULT_SINGLE_BLOCKS = [
    {"key": "manufacturer", "width": "half"},
    {"key": "part_number", "width": "half"},
    {"key": "description", "width": "full"},
    {"key": "stock_quantity", "width": "half"},
    {"key": "bin_location", "width": "half"},
    {"key": "notes", "width": "full"},
]

_DEFAULT_DUAL_BLOCKS = [
    {"key": "manufacturer", "width": "half"},
    {"key": "part_number", "width": "half"},
    {"key": "manufacturer_right", "width": "half"},
    {"key": "part_number_right", "width": "half"},
    {"key": "description", "width": "full"},
    {"key": "description_right", "width": "full"},
    {"key": "stock_quantity", "width": "half"},
    {"key": "bin_location", "width": "half"},
    {"key": "stock_quantity_right", "width": "half"},
    {"key": "bin_location_right", "width": "half"},
    {"key": "notes", "width": "full"},
    {"key": "notes_right", "width": "full"},
]


def default_layout_config(
    parts_per_label: int = 1,
    include_description: bool = True,
) -> dict[str, Any]:
    """Return a default layout configuration for the given template settings."""

    blocks_source = _DEFAULT_DUAL_BLOCKS if parts_per_label == 2 else _DEFAULT_SINGLE_BLOCKS
    blocks = deepcopy(blocks_source)
    if not include_description:
        blocks = [
            block
            for block in blocks
            if block["key"] not in {"description", "description_right"}
        ]
    return {"version": 1, "blocks": blocks}


def normalize_layout_config(
    value: Any,
    parts_per_label: int = 1,
    include_description: bool = True,
) -> dict[str, Any]:
    """Validate a layout payload and return a normalized configuration."""

    parsed: Any
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            parsed = None
    elif isinstance(value, dict):
        parsed = value
    else:
        parsed = None

    blocks: list[dict[str, str]] = []
    if isinstance(parsed, dict):
        candidate_blocks = parsed.get("blocks")
        if isinstance(candidate_blocks, list):
            for item in candidate_blocks:
                if not isinstance(item, dict):
                    continue
                key = item.get("key")
                if not isinstance(key, str):
                    continue
                field_meta = FIELD_LIBRARY.get(key)
                if field_meta is None:
                    continue
                if field_meta.get("requires_dual") and parts_per_label != 2:
                    continue
                if key in {"description", "description_right"} and not include_description:
                    continue
                width = item.get("width")
                normalized_width = "half" if width == "half" else "full"
                blocks.append({"key": key, "width": normalized_width})

    if not blocks:
        return default_layout_config(parts_per_label, include_description)

    return {"version": 1, "blocks": blocks}


def dumps_layout_config(config: dict[str, Any]) -> str:
    """Serialize a layout configuration to JSON."""

    return json.dumps(config, separators=(",", ":"))
