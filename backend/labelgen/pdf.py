"""PDF generation utilities for the label generator."""

from __future__ import annotations

import io
from dataclasses import dataclass
from typing import Iterable, Optional

import requests
from PIL import Image
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfgen import canvas


@dataclass(slots=True)
class TemplateConfig:
    name: str
    image_position: str
    accent_color: str
    text_align: str
    include_description: bool
    parts_per_label: int


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


class ImageCache:
    """Cache remote images while generating the PDF to reduce network calls."""

    def __init__(self) -> None:
        self._store: dict[str, Optional[Image.Image]] = {}

    def get(self, url: str) -> Optional[Image.Image]:
        if url in self._store:
            return self._store[url]

        try:
            response = requests.get(url, timeout=10)
            response.raise_for_status()
            image = Image.open(io.BytesIO(response.content))
            image.load()
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


def _render_part(
    canv: canvas.Canvas,
    part: PartDetails,
    template: TemplateConfig,
    x: float,
    y: float,
    width: float,
    height: float,
    image_cache: ImageCache,
    accent: colors.Color,
    is_split: bool,
    use_placeholder: bool,
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
    if effective_position not in {"left", "top"}:
        effective_position = "none"
    if is_split and effective_position == "left":
        effective_position = "top"

    image = None
    if part.image_url and effective_position in {"left", "top"}:
        image = image_cache.get(part.image_url)

    if image is not None and effective_position == "left" and inner_width > 0 and inner_height > 0:
        image_width = inner_width * 0.38
        image_height = inner_height
        aspect = image.width / image.height if image.height else 1
        target_height = image_width / aspect
        if target_height > image_height:
            target_height = image_height
            image_width = target_height * aspect
        canv.drawImage(
            ImageReader(image),
            inner_x,
            inner_y + (inner_height - target_height) / 2,
            width=image_width,
            height=target_height,
            preserveAspectRatio=True,
            mask="auto",
        )
        text_area_x = inner_x + image_width + part_padding / 2
        text_area_width = max(inner_width - image_width - part_padding / 2, 0)
    elif image is not None and effective_position == "top" and inner_width > 0 and inner_height > 0:
        image_height = inner_height * (0.45 if is_split else 0.55)
        image_width = inner_width
        aspect = image.width / image.height if image.height else 1
        target_width = image_height * aspect
        if target_width > image_width:
            target_width = image_width
            image_height = target_width / aspect
        canv.drawImage(
            ImageReader(image),
            inner_x + (inner_width - target_width) / 2,
            inner_y + inner_height - image_height,
            width=target_width,
            height=image_height,
            preserveAspectRatio=True,
            mask="auto",
        )
        text_area_y_top = inner_y + inner_height - image_height - part_padding / 2
    elif use_placeholder and inner_width > 0 and inner_height > 0:
        placeholder_height = min(0.65 * inch, inner_height * 0.45)
        canv.setFillColor(colors.Color(0.92, 0.92, 0.92))
        canv.rect(
            inner_x,
            inner_y + inner_height - placeholder_height,
            inner_width,
            placeholder_height,
            fill=1,
            stroke=0,
        )
        canv.setFillColor(colors.black)

    align_center = template.text_align == "center" and text_area_width > 0
    heading_size = 12 if is_split else 14
    subheading_size = 10 if is_split else 12
    body_size = 9 if is_split else 10
    description_size = 8 if is_split else 9
    qty_size = 10 if is_split else 11
    note_size = 7 if is_split else 8

    text_y = text_area_y_top - (6 if is_split else 4)
    manufacturer = (part.manufacturer or "Unknown Manufacturer").strip() or "Unknown Manufacturer"
    canv.setFillColor(accent)
    canv.setFont("Helvetica-Bold", heading_size)
    if align_center:
        canv.drawCentredString(text_area_x + text_area_width / 2, text_y, manufacturer.upper())
    else:
        canv.drawString(text_area_x, text_y, manufacturer.upper())
    text_y -= heading_size + (6 if is_split else 8)

    canv.setFillColor(colors.black)
    canv.setFont("Helvetica-Bold", subheading_size)
    part_number = (part.part_number or "").strip() or "—"
    part_line = f"Part #: {part_number}"
    if align_center:
        canv.drawCentredString(text_area_x + text_area_width / 2, text_y, part_line)
    else:
        canv.drawString(text_area_x, text_y, part_line)
    text_y -= subheading_size + (5 if is_split else 6)

    if part.bin_location:
        canv.setFont("Helvetica", body_size)
        location_line = f"Bin: {part.bin_location.strip()}"
        if align_center:
            canv.drawCentredString(text_area_x + text_area_width / 2, text_y, location_line)
        else:
            canv.drawString(text_area_x, text_y, location_line)
        text_y -= body_size + (5 if is_split else 6)

    if template.include_description and part.description:
        canv.setFont("Helvetica", description_size)
        max_width = text_area_width if not align_center else text_area_width * 0.9
        max_width = max(max_width, 1)
        for line in _wrap_text(part.description.strip(), "Helvetica", description_size, max_width):
            if align_center:
                canv.drawCentredString(text_area_x + text_area_width / 2, text_y, line)
            else:
                canv.drawString(text_area_x, text_y, line)
            text_y -= description_size + (4 if is_split else 4)

    canv.setFont("Helvetica-Bold", qty_size)
    qty_line = f"On Hand: {part.stock_quantity}"
    canv.drawString(text_area_x, y + part_padding, qty_line)

    if part.notes:
        canv.setFont("Helvetica-Oblique", note_size)
        canv.drawRightString(x + width - part_padding, y + part_padding, part.notes.strip())


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

    canv.setStrokeColor(colors.Color(0.65, 0.65, 0.65))
    canv.setLineWidth(1)
    canv.roundRect(x + 2, y + 2, width - 4, height - 4, radius=8, stroke=1, fill=0)

    template = label.template
    accent = _hex_to_color(template.accent_color)
    is_split = template.parts_per_label == 2 and label.right is not None

    if is_split:
        column_gap = padding / 2
        column_width = (inner_width - column_gap) / 2 if inner_width > 0 else 0
        _render_part(
            canv,
            label.left,
            template,
            inner_x,
            inner_y,
            column_width,
            inner_height,
            image_cache,
            accent,
            is_split=True,
            use_placeholder=False,
        )
        if label.right:
            right_x = inner_x + column_width + column_gap
            _render_part(
                canv,
                label.right,
                template,
                right_x,
                inner_y,
                column_width,
                inner_height,
                image_cache,
                accent,
                is_split=True,
                use_placeholder=False,
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
            inner_x,
            inner_y,
            inner_width,
            inner_height,
            image_cache,
            accent,
            is_split=False,
            use_placeholder=True,
        )


def build_pdf(labels: Iterable[tuple[LabelData, int]]) -> bytes:
    """Generate a PDF containing the provided labels."""

    buffer = io.BytesIO()
    canv = canvas.Canvas(buffer, pagesize=letter)
    page_width, page_height = letter
    margin = 0.35 * inch
    columns = 2
    rows = 5
    usable_width = page_width - 2 * margin
    usable_height = page_height - 2 * margin
    cell_width = usable_width / columns
    cell_height = usable_height / rows

    image_cache = ImageCache()

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