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


@dataclass(slots=True)
class LabelData:
    manufacturer: str
    part_number: str
    stock_quantity: int
    description: str | None
    bin_location: str | None
    image_url: str | None
    notes: str | None
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

    text_area_x = inner_x
    text_area_width = inner_width
    text_area_y_top = inner_y + inner_height

    if label.image_url and template.image_position in {"left", "top"}:
        image = image_cache.get(label.image_url)
    else:
        image = None

    if image is not None and template.image_position == "left":
        image_width = inner_width * 0.42
        image_height = inner_height
        aspect = image.width / image.height
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
        text_area_x = inner_x + image_width + padding / 2
        text_area_width = inner_width - image_width - padding / 2
    elif image is not None and template.image_position == "top":
        image_height = inner_height * 0.55
        image_width = inner_width
        aspect = image.width / image.height
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
        text_area_y_top = inner_y + inner_height - image_height - padding / 2
    else:
        canv.setFillColor(colors.Color(0.92, 0.92, 0.92))
        canv.rect(inner_x, inner_y + inner_height - 0.8 * inch, inner_width, 0.8 * inch, fill=1, stroke=0)
        canv.setFillColor(colors.black)

    text_y = text_area_y_top - 4
    canv.setFillColor(accent)
    canv.setFont("Helvetica-Bold", 14)
    manufacturer = label.manufacturer.strip() or "Unknown Manufacturer"
    if template.text_align == "center":
        canv.drawCentredString(text_area_x + text_area_width / 2, text_y, manufacturer.upper())
    else:
        canv.drawString(text_area_x, text_y, manufacturer.upper())
    text_y -= 18

    canv.setFillColor(colors.black)
    canv.setFont("Helvetica-Bold", 12)
    part_line = f"Part #: {label.part_number.strip()}"
    if template.text_align == "center":
        canv.drawCentredString(text_area_x + text_area_width / 2, text_y, part_line)
    else:
        canv.drawString(text_area_x, text_y, part_line)
    text_y -= 16

    canv.setFont("Helvetica", 10)
    if label.bin_location:
        location_line = f"Bin: {label.bin_location.strip()}"
        if template.text_align == "center":
            canv.drawCentredString(text_area_x + text_area_width / 2, text_y, location_line)
        else:
            canv.drawString(text_area_x, text_y, location_line)
        text_y -= 14

    canv.setFont("Helvetica", 9)
    if template.include_description and label.description:
        max_width = text_area_width if template.text_align != "center" else text_area_width * 0.9
        for line in _wrap_text(label.description.strip(), "Helvetica", 9, max_width):
            if template.text_align == "center":
                canv.drawCentredString(text_area_x + text_area_width / 2, text_y, line)
            else:
                canv.drawString(text_area_x, text_y, line)
            text_y -= 12

    canv.setFont("Helvetica-Bold", 11)
    qty_line = f"On Hand: {label.stock_quantity}"
    canv.drawString(text_area_x, y + padding, qty_line)

    if label.notes:
        canv.setFont("Helvetica-Oblique", 8)
        canv.drawRightString(x + width - padding, y + padding, label.notes.strip())


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