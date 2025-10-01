"""PDF generation utilities for the label generator."""

from __future__ import annotations

import io
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Optional
from urllib.parse import urlparse

import requests
from PIL import Image
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfgen import canvas

from . import layouts


@dataclass(slots=True)
class TemplateConfig:
    name: str
    image_position: str
    accent_color: str
    text_align: str
    include_description: bool
    parts_per_label: int
    layout_config: dict[str, Any]
    field_formats: dict[str, str]


@dataclass(slots=True)
class PartDetails:
    manufacturer: str
    part_number: str
    stock_quantity: int
    description: str | None
    bin_location: str | None
    image_url: str | None
    notes: str | None


@dataclass(slots=True)
class LabelData:
    left: PartDetails
    right: PartDetails | None
    template: TemplateConfig


@dataclass(slots=True)
class FieldStyle:
    show_label: bool = True
    label_font: str = "Helvetica-Bold"
    label_size: int = 6
    value_font: str = "Helvetica"
    value_size: int = 9
    value_size_split: int | None = None
    use_accent: bool = False

    def resolved_value_size(self, is_split: bool) -> int:
        if is_split and self.value_size_split:
            return self.value_size_split
        return self.value_size


@dataclass(slots=True)
class BlockLayout:
    key: str
    label: str | None
    lines: list[str]
    style: FieldStyle
    value_font: str
    value_size: int
    height: float
    width: float


@dataclass(slots=True)
class RowLayout:
    blocks: list[BlockLayout]
    height: float


_DEFAULT_FIELD_STYLE = FieldStyle()
_FIELD_STYLE_OVERRIDES: dict[str, FieldStyle] = {
    "manufacturer": FieldStyle(show_label=False, value_font="Helvetica", value_size=9, value_size_split=8),
    "part_number": FieldStyle(
        show_label=False,
        value_font="Helvetica-Bold",
        value_size=14,
        value_size_split=12,
        use_accent=True,
    ),
    "stock_quantity": FieldStyle(
        show_label=False,
        value_font="Helvetica-Bold",
        value_size=11,
        value_size_split=10,
    ),
    "notes": FieldStyle(
        show_label=False,
        value_font="Helvetica-Oblique",
        value_size=8,
        value_size_split=7,
    ),
}

_LABEL_TEXT_COLOR = colors.Color(0.4, 0.46, 0.58)
_COLUMN_GAP = 0.08 * inch
_ROW_GAP_FULL = 0.1 * inch
_ROW_GAP_SPLIT = 0.07 * inch


class ImageCache:
    """Cache remote images while generating the PDF to reduce network calls."""

    def __init__(self, uploads_root: str | None = None) -> None:
        self._store: dict[str, Optional[Image.Image]] = {}
        self._uploads_root = Path(uploads_root).resolve() if uploads_root else None

    def _load_local_image(self, url: str) -> Optional[Image.Image]:
        if not url:
            return None

        parsed = urlparse(url)
        candidate: Path | None = None

        if parsed.scheme in {"http", "https"}:
            return None
        if parsed.scheme == "file":
            candidate = Path(parsed.path)
        else:
            text = parsed.path or url
            if not text:
                return None
            stripped = text.lstrip("/")
            path_value = stripped
            if stripped.startswith("uploads/"):
                parts = stripped.split("/", 1)
                path_value = parts[1] if len(parts) == 2 else ""
            if not path_value:
                return None

            path_candidate = Path(path_value)
            if path_candidate.is_absolute():
                candidate = path_candidate
            elif self._uploads_root is not None:
                tentative = (self._uploads_root / path_candidate).resolve()
                try:
                    tentative.relative_to(self._uploads_root)
                except ValueError:
                    return None
                candidate = tentative

        if candidate is None or not candidate.exists():
            return None

        try:
            with candidate.open("rb") as handle:
                image = Image.open(handle)
                image.load()
            return image.copy()
        except Exception:
            return None

    def get(self, url: str) -> Optional[Image.Image]:
        if url in self._store:
            return self._store[url]

        try:
            parsed = urlparse(url)
            if parsed.scheme in {"http", "https"}:
                response = requests.get(url, timeout=10)
                response.raise_for_status()
                image = Image.open(io.BytesIO(response.content))
                image.load()
                image = image.copy()
            else:
                image = self._load_local_image(url)
            self._store[url] = image
            return image
        except Exception:
            self._store[url] = None
            return None


def _hex_to_color(value: str) -> colors.Color:
    try:
        return colors.HexColor(value)
    except Exception:
        return colors.HexColor("#0a3d62")


def _wrap_text(value: str, font_name: str, font_size: int, max_width: float) -> list[str]:
    words = value.split()
    if not words:
        return []

    lines: list[str] = []
    current = words[0]
    for word in words[1:]:
        candidate = f"{current} {word}"
        width = pdfmetrics.stringWidth(candidate, font_name, font_size)
        if width <= max_width:
            current = candidate
        else:
            lines.append(current)
            current = word
    lines.append(current)
    return lines


class _SafeFormatDict(dict[str, Any]):
    def __missing__(self, key: str) -> str:
        return ""


def _field_style_for_key(key: str) -> FieldStyle:
    base = key[:-6] if key.endswith("_right") else key
    return _FIELD_STYLE_OVERRIDES.get(base, _DEFAULT_FIELD_STYLE)


def _extract_part_value(part: PartDetails, key: str) -> Any:
    base = key[:-6] if key.endswith("_right") else key
    return getattr(part, base, None)


def _format_field_value(template: TemplateConfig, key: str, value: Any) -> str:
    formats = template.field_formats or {}
    format_string = formats.get(key)
    if format_string is None and key.endswith("_right"):
        format_string = formats.get(key[:-6])
    if format_string is None:
        format_string = layouts.FIELD_FORMAT_DEFAULTS.get(key)
    if not format_string:
        format_string = "{value}"

    if isinstance(value, bool):
        value_text = "True" if value else "False"
    elif isinstance(value, int):
        value_text = str(value)
    elif isinstance(value, float):
        value_text = str(int(value)) if value.is_integer() else str(value)
    elif value is None:
        value_text = ""
    else:
        value_text = str(value).strip()

    replacements = {
        "value": value_text,
        "value_upper": value_text.upper(),
        "value_lower": value_text.lower(),
        "value_title": value_text.title(),
        "value_number": value
        if isinstance(value, (int, float)) and not isinstance(value, bool)
        else "",
        "value_raw": value,
    }
    try:
        formatted = format_string.format_map(_SafeFormatDict(replacements))
    except Exception:
        formatted = value_text
    return formatted.strip()


def _prepare_block_layout(
    block: dict[str, Any],
    part: PartDetails,
    template: TemplateConfig,
    width: float,
    is_split: bool,
) -> BlockLayout:
    key = block.get("key")
    if not isinstance(key, str):
        key = ""
    field_meta = layouts.FIELD_LIBRARY.get(key, {})
    label = field_meta.get("label", key.replace("_", " ").title())
    style = _field_style_for_key(key)
    value_font = style.value_font
    value_size = style.resolved_value_size(is_split)
    formatted = _format_field_value(template, key, _extract_part_value(part, key))
    max_width = max(width - 2, 1)
    lines = _wrap_text(formatted, value_font, value_size, max_width) if formatted else []
    if not lines and formatted:
        lines = [formatted]

    show_label = style.show_label and bool(label)
    label_text = label if show_label else None

    height = 0.0
    if label_text:
        height += style.label_size
    if label_text and lines:
        height += 2
    if lines:
        height += len(lines) * value_size
        if len(lines) > 1:
            height += (len(lines) - 1) * 2
    else:
        height += value_size * 0.6
    height += 4

    return BlockLayout(
        key=key,
        label=label_text,
        lines=lines,
        style=style,
        value_font=value_font,
        value_size=value_size,
        height=height,
        width=width,
    )


def _group_blocks_by_row(blocks: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    rows: list[list[dict[str, Any]]] = []
    current: list[dict[str, Any]] = []
    for block in blocks:
        width = block.get("width")
        normalized_width = "half" if width == "half" else "full"
        candidate = {"key": block.get("key"), "width": normalized_width}
        if normalized_width == "full":
            if current:
                rows.append(current)
                current = []
            rows.append([candidate])
        else:
            current.append(candidate)
            if len(current) == 2:
                rows.append(current)
                current = []
    if current:
        rows.append(current)
    return rows


def _build_row_layouts(
    blocks: list[dict[str, Any]],
    part: PartDetails,
    template: TemplateConfig,
    available_width: float,
    is_split: bool,
) -> list[RowLayout]:
    if available_width <= 0:
        return []

    row_layouts: list[RowLayout] = []
    for row in _group_blocks_by_row(blocks):
        if not row:
            continue
        widths: list[float]
        if len(row) == 1:
            block_width = available_width
            if row[0].get("width") == "half":
                block_width = max((available_width - _COLUMN_GAP) / 2, available_width * 0.48)
            widths = [block_width]
        else:
            column_count = len(row)
            inner_width = max(available_width - _COLUMN_GAP * (column_count - 1), 1)
            widths = [inner_width / column_count for _ in row]

        row_blocks: list[BlockLayout] = []
        max_height = 0.0
        for block, width in zip(row, widths):
            layout_block = _prepare_block_layout(block, part, template, max(width, 1), is_split)
            row_blocks.append(layout_block)
            max_height = max(max_height, layout_block.height)
        if not row_blocks:
            continue
        row_layouts.append(RowLayout(blocks=row_blocks, height=max_height))

    return row_layouts


def _filter_blocks_for_side(
    template: TemplateConfig,
    side: str,
) -> list[dict[str, Any]]:
    layout = template.layout_config or {}
    blocks = []
    if isinstance(layout, dict):
        candidate_blocks = layout.get("blocks")
        if isinstance(candidate_blocks, list):
            blocks = candidate_blocks

    suffix = "_right"
    result: list[dict[str, Any]] = []
    for block in blocks:
        key = block.get("key") if isinstance(block, dict) else None
        if not isinstance(key, str):
            continue
        if side == "right" and not key.endswith(suffix):
            continue
        if side != "right" and key.endswith(suffix):
            continue
        width = block.get("width")
        result.append({"key": key, "width": "half" if width == "half" else "full"})

    if result:
        return result

    fallback = layouts.default_layout_config(template.parts_per_label, template.include_description)
    if isinstance(fallback, dict):
        candidate_blocks = fallback.get("blocks")
        if isinstance(candidate_blocks, list):
            return _filter_blocks_for_side(
                TemplateConfig(
                    name=template.name,
                    image_position=template.image_position,
                    accent_color=template.accent_color,
                    text_align=template.text_align,
                    include_description=template.include_description,
                    parts_per_label=template.parts_per_label,
                    layout_config=fallback,
                    field_formats=template.field_formats,
                ),
                side,
            )

    return []


def _draw_aligned(
    canv: canvas.Canvas,
    text: str,
    font: str,
    size: int,
    align: str,
    x: float,
    width: float,
    baseline: float,
) -> None:
    canv.setFont(font, size)
    if align == "center":
        canv.drawCentredString(x + width / 2, baseline, text)
    elif align == "right":
        canv.drawRightString(x + width, baseline, text)
    else:
        canv.drawString(x, baseline, text)


def _draw_block(
    canv: canvas.Canvas,
    block: BlockLayout,
    x: float,
    top: float,
    width: float,
    align: str,
    accent: colors.Color,
) -> None:
    cursor = top
    if block.label:
        canv.setFillColor(_LABEL_TEXT_COLOR)
        baseline = cursor - block.style.label_size
        _draw_aligned(
            canv,
            block.label,
            block.style.label_font,
            block.style.label_size,
            align,
            x,
            width,
            baseline,
        )
        cursor = baseline - 2

    text_color = accent if block.style.use_accent else colors.black
    canv.setFillColor(text_color)
    if block.lines:
        baseline = cursor
        for index, line in enumerate(block.lines):
            baseline -= block.value_size
            _draw_aligned(
                canv,
                line,
                block.value_font,
                block.value_size,
                align,
                x,
                width,
                baseline,
            )
            if index < len(block.lines) - 1:
                baseline -= 2
        cursor = baseline
    else:
        baseline = cursor - block.value_size
        _draw_aligned(
            canv,
            "",
            block.value_font,
            block.value_size,
            align,
            x,
            width,
            baseline,
        )

def _render_part(
    canv: canvas.Canvas,
    part: PartDetails,
    template: TemplateConfig,
    blocks: list[dict[str, Any]],
    x: float,
    y: float,
    width: float,
    height: float,
    image_cache: ImageCache,
    accent: colors.Color,
    is_split: bool,
) -> None:
    part_padding = 0.12 * inch if is_split else 0.16 * inch
    inner_x = x + part_padding
    inner_y = y + part_padding
    inner_width = max(width - 2 * part_padding, 0)
    inner_height = max(height - 2 * part_padding, 0)

    text_area_x = inner_x
    text_area_width = inner_width
    text_area_y_top = inner_y + inner_height

    effective_position = template.image_position.lower() if template.image_position else "left"
    if effective_position not in {"left", "right", "top"}:
        effective_position = "none"
    if is_split and effective_position == "left":
        effective_position = "top"

    image = None
    if part.image_url and effective_position in {"left", "right", "top"}:
        image = image_cache.get(part.image_url)

    if image is not None and effective_position == "left" and inner_width > 0 and inner_height > 0:
        image_width = inner_width * 0.38
        image_height = inner_height
        aspect = image.width / image.height if image.height else 1
        target_height = image_width / aspect
        if target_height > image_height:
            target_height = image_height
            image_width = target_height * aspect
        image_y = inner_y + (inner_height - target_height) / 2
        canv.drawImage(
            ImageReader(image),
            inner_x,
            image_y,
            width=image_width,
            height=target_height,
            preserveAspectRatio=True,
            mask="auto",
        )
        text_area_x = inner_x + image_width + part_padding / 2
        text_area_width = max(inner_width - image_width - part_padding / 2, 0)
    elif image is not None and effective_position == "right" and inner_width > 0 and inner_height > 0:
        image_width = inner_width * 0.35
        image_height = inner_height
        aspect = image.width / image.height if image.height else 1
        target_height = image_width / aspect
        if target_height > image_height:
            target_height = image_height
            image_width = target_height * aspect
        image_x = inner_x + inner_width - image_width
        image_y = inner_y + (inner_height - target_height) / 2
        canv.drawImage(
            ImageReader(image),
            image_x,
            image_y,
            width=image_width,
            height=target_height,
            preserveAspectRatio=True,
            mask="auto",
        )
        text_area_width = max(inner_width - image_width - part_padding / 2, 0)
    elif image is not None and effective_position == "top" and inner_width > 0 and inner_height > 0:
        image_height = inner_height * (0.45 if is_split else 0.55)
        image_width = inner_width
        aspect = image.width / image.height if image.height else 1
        target_width = image_height * aspect
        if target_width > image_width:
            target_width = image_width
            image_height = target_width / aspect
        image_x = inner_x + (inner_width - target_width) / 2
        image_y = inner_y + inner_height - image_height
        canv.drawImage(
            ImageReader(image),
            image_x,
            image_y,
            width=target_width,
            height=image_height,
            preserveAspectRatio=True,
            mask="auto",
        )
        text_area_y_top = image_y - part_padding / 2

    align = (template.text_align or "left").lower()
    if align not in {"left", "center", "right"}:
        align = "left"

    row_layouts = _build_row_layouts(blocks, part, template, text_area_width, is_split)
    if not row_layouts:
        return

    row_gap = _ROW_GAP_SPLIT if is_split else _ROW_GAP_FULL
    cursor = text_area_y_top
    for index, row in enumerate(row_layouts):
        cursor -= row.height
        row_top = cursor + row.height
        row_x = text_area_x
        for block_index, block_layout in enumerate(row.blocks):
            _draw_block(
                canv,
                block_layout,
                row_x,
                row_top,
                block_layout.width,
                align,
                accent,
            )
            row_x += block_layout.width
            if block_index < len(row.blocks) - 1:
                row_x += _COLUMN_GAP
        if index < len(row_layouts) - 1:
            cursor -= row_gap


def draw_label(
    canv: canvas.Canvas,
    label: LabelData,
    x: float,
    y: float,
    width: float,
    height: float,
    image_cache: ImageCache,
) -> None:
    padding = 0.18 * inch
    inner_x = x + padding
    inner_y = y + padding
    inner_width = width - 2 * padding
    inner_height = height - 2 * padding

    template = label.template
    accent = _hex_to_color(template.accent_color)
    is_split = template.parts_per_label == 2 and label.right is not None

    left_blocks = _filter_blocks_for_side(template, "left")
    right_blocks = _filter_blocks_for_side(template, "right") if is_split else []

    if is_split:
        column_gap = padding / 2
        column_width = (inner_width - column_gap) / 2 if inner_width > 0 else 0
        _render_part(
            canv,
            label.left,
            template,
            left_blocks,
            inner_x,
            inner_y,
            column_width,
            inner_height,
            image_cache,
            accent,
            is_split=True,
        )
        if label.right:
            right_x = inner_x + column_width + column_gap
            _render_part(
                canv,
                label.right,
                template,
                right_blocks,
                right_x,
                inner_y,
                column_width,
                inner_height,
                image_cache,
                accent,
                is_split=True,
            )
        divider_x = inner_x + column_width + column_gap / 2
        canv.setStrokeColor(colors.Color(0.82, 0.82, 0.82))
        canv.setLineWidth(0.8)
        canv.line(divider_x, inner_y, divider_x, inner_y + inner_height)
    else:
        _render_part(
            canv,
            label.left,
            template,
            left_blocks,
            inner_x,
            inner_y,
            inner_width,
            inner_height,
            image_cache,
            accent,
            is_split=False,
        )


_PAGE_LAYOUTS: dict[int, tuple[int, int]] = {
    10: (2, 5),
    12: (2, 6),
}


def build_pdf(
    labels: Iterable[tuple[LabelData, int]],
    uploads_root: str | None = None,
    labels_per_page: int = 12,
) -> bytes:
    """Generate a PDF containing the provided labels."""

    buffer = io.BytesIO()
    canv = canvas.Canvas(buffer, pagesize=letter)
    page_width, page_height = letter
    margin = 0.35 * inch

    try:
        columns, rows = _PAGE_LAYOUTS[int(labels_per_page)]
    except (KeyError, TypeError, ValueError):
        columns, rows = _PAGE_LAYOUTS[12]

    usable_width = page_width - 2 * margin
    usable_height = page_height - 2 * margin
    cell_width = usable_width / columns
    cell_height = usable_height / rows

    image_cache = ImageCache(uploads_root)

    index = 0
    for label, copies in labels:
        for _ in range(max(1, copies)):
            page_number = index // (columns * rows)
            if index and index % (columns * rows) == 0:
                canv.showPage()
            position = index % (columns * rows)
            col = position % columns
            row = position // columns
            x = margin + col * cell_width
            y = page_height - margin - (row + 1) * cell_height
            draw_label(canv, label, x, y, cell_width, cell_height, image_cache)
            index += 1

    if index == 0:
        canv.setFont("Helvetica", 12)
        canv.drawString(margin, page_height - margin - 20, "No labels selected.")

    canv.save()
    buffer.seek(0)
    return buffer.getvalue()