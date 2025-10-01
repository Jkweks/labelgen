"""Flask application factory exposing a JSON API for label management."""

from __future__ import annotations

import io
import os
import uuid
from datetime import datetime
from typing import Any
from urllib.parse import urlparse

from flask import Flask, jsonify, request, send_file, send_from_directory
from flask_cors import CORS
from werkzeug.exceptions import BadRequest, HTTPException, NotFound
from werkzeug.utils import secure_filename

from . import db, layouts, pdf


def create_app(test_config: dict[str, Any] | None = None) -> Flask:
    """Create and configure the Flask application instance."""

    app = Flask(__name__, instance_relative_config=True)
    app.config.from_mapping(
        SECRET_KEY="dev",
        DATABASE=os.path.join(app.instance_path, "labelgen.sqlite"),
    )

    if test_config is not None:
        app.config.update(test_config)

    os.makedirs(app.instance_path, exist_ok=True)
    app.config.setdefault("UPLOAD_FOLDER", os.path.join(app.instance_path, "uploads"))
    os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)

    db.init_app(app)
    CORS(app, resources={r"/api/*": {"origins": "*"}})

    @app.before_request
    def ensure_schema() -> None:
        if not app.config.get("_schema_loaded"):
            db.init_db()
            app.config["_schema_loaded"] = True

    def serialize_template(record: Any) -> dict[str, Any]:
        parts_per_label = int(record["parts_per_label"] or 1)
        include_description = bool(record["include_description"])
        return {
            "id": record["id"],
            "name": record["name"],
            "description": record["description"],
            "image_position": record["image_position"],
            "accent_color": record["accent_color"],
            "text_align": record["text_align"],
            "include_description": include_description,
            "parts_per_label": parts_per_label,
            "layout_config": layouts.normalize_layout_config(
                record["layout_config"], parts_per_label, include_description
            ),
        }

    def _normalize_image_reference(value: str | None) -> str | None:
        if not value:
            return None
        stripped = value.strip()
        if not stripped:
            return None
        parsed = urlparse(stripped)
        if parsed.scheme and parsed.netloc:
            if parsed.path.startswith("/uploads/"):
                return parsed.path.lstrip("/")
            return stripped
        if stripped.startswith("/uploads/"):
            return stripped.lstrip("/")
        if stripped.startswith("uploads/"):
            return stripped
        return stripped

    def _public_image_url(value: str | None) -> str | None:
        if not value:
            return None
        if value.startswith("uploads/"):
            return f"{request.url_root.rstrip('/')}/{value}"
        if value.startswith("/uploads/"):
            return f"{request.url_root.rstrip('/')}{value}"
        return value

    def serialize_label(record: Any) -> dict[str, Any]:
        return {
            "id": record["id"],
            "template_id": record["template_id"],
            "manufacturer": record["manufacturer"],
            "part_number": record["part_number"],
            "description": record["description"],
            "stock_quantity": int(record["stock_quantity"] or 0),
            "bin_location": record["bin_location"],
            "image_url": _public_image_url(record["image_url"]),
            "notes": record["notes"],
            "default_copies": int(record["default_copies"] or 1),
            "manufacturer_right": record["manufacturer_right"],
            "part_number_right": record["part_number_right"],
            "description_right": record["description_right"],
            "stock_quantity_right": int(record["stock_quantity_right"] or 0),
            "bin_location_right": record["bin_location_right"],
            "image_url_right": _public_image_url(record["image_url_right"]),
            "notes_right": record["notes_right"],
            "template": {
                "name": record["template_name"],
                "image_position": record["image_position"],
                "accent_color": record["accent_color"],
                "text_align": record["text_align"],
                "include_description": bool(record["include_description"]),
                "parts_per_label": int(record["parts_per_label"] or 1),
                "layout_config": layouts.normalize_layout_config(
                    record["layout_config"],
                    int(record["parts_per_label"] or 1),
                    bool(record["include_description"]),
                ),
            },
        }

    @app.errorhandler(BadRequest)
    def handle_bad_request(error: BadRequest):
        return jsonify({"error": error.description}), 400

    @app.errorhandler(NotFound)
    def handle_not_found(error: NotFound):
        return jsonify({"error": error.description}), 404

    @app.errorhandler(Exception)
    def handle_exception(error: Exception):
        if isinstance(error, HTTPException):
            return jsonify({"error": error.description}), error.code
        app.logger.exception("Unhandled exception")
        return jsonify({"error": "Internal server error"}), 500

    @app.get("/healthz")
    def healthcheck() -> tuple[str, int]:
        return "ok", 200

    @app.post("/api/uploads")
    def upload_image():
        if "file" not in request.files:
            raise BadRequest("No file part in the request")

        file = request.files["file"]
        if file is None or file.filename == "":
            raise BadRequest("No file provided")

        if file.mimetype and not file.mimetype.startswith("image/"):
            raise BadRequest("Only image uploads are supported")

        original_name = secure_filename(file.filename)
        _, ext = os.path.splitext(original_name)
        unique_name = f"{uuid.uuid4().hex}{ext.lower()}"
        destination = os.path.join(app.config["UPLOAD_FOLDER"], unique_name)
        file.save(destination)

        relative_path = f"uploads/{unique_name}"
        public_url = f"{request.url_root.rstrip('/')}/{relative_path}"
        return jsonify({"path": relative_path, "url": public_url}), 201

    @app.get("/uploads/<path:filename>")
    def serve_upload(filename: str):
        return send_from_directory(app.config["UPLOAD_FOLDER"], filename)

    @app.get("/api/templates")
    def list_templates():
        templates = [serialize_template(template) for template in db.fetch_templates()]
        return jsonify(templates)

    @app.post("/api/templates")
    def create_template():
        payload = request.get_json(silent=True) or {}
        name = (payload.get("name") or "").strip()
        if not name:
            raise BadRequest("Template name is required")

        data = {
            "name": name,
            "description": (payload.get("description") or "").strip() or None,
            "image_position": payload.get("image_position") or "left",
            "accent_color": (payload.get("accent_color") or "#0a3d62").strip() or "#0a3d62",
            "text_align": payload.get("text_align") or "left",
            "include_description": 1 if payload.get("include_description", True) else 0,
        }
        try:
            parts_value = int(payload.get("parts_per_label") or 1)
        except (TypeError, ValueError):
            raise BadRequest("parts_per_label must be a number")
        if parts_value not in (1, 2):
            raise BadRequest("parts_per_label must be 1 or 2")
        data["parts_per_label"] = parts_value
        include_description = bool(data["include_description"])
        layout_payload = payload.get("layout_config")
        normalized_layout = layouts.normalize_layout_config(
            layout_payload, parts_value, include_description
        )
        data["layout_config"] = layouts.dumps_layout_config(normalized_layout)
        template_id = db.upsert_template(data)
        template = db.fetch_template(template_id)
        if template is None:
            raise NotFound("Template not found")
        return jsonify(serialize_template(template)), 201

    @app.put("/api/templates/<int:template_id>")
    def update_template(template_id: int):
        if not db.fetch_template(template_id):
            raise NotFound("Template not found")

        payload = request.get_json(silent=True) or {}
        name = (payload.get("name") or "").strip()
        if not name:
            raise BadRequest("Template name is required")

        data = {
            "id": template_id,
            "name": name,
            "description": (payload.get("description") or "").strip() or None,
            "image_position": payload.get("image_position") or "left",
            "accent_color": (payload.get("accent_color") or "#0a3d62").strip() or "#0a3d62",
            "text_align": payload.get("text_align") or "left",
            "include_description": 1 if payload.get("include_description", True) else 0,
        }
        try:
            parts_value = int(payload.get("parts_per_label") or 1)
        except (TypeError, ValueError):
            raise BadRequest("parts_per_label must be a number")
        if parts_value not in (1, 2):
            raise BadRequest("parts_per_label must be 1 or 2")
        data["parts_per_label"] = parts_value
        include_description = bool(data["include_description"])
        layout_payload = payload.get("layout_config")
        normalized_layout = layouts.normalize_layout_config(
            layout_payload, parts_value, include_description
        )
        data["layout_config"] = layouts.dumps_layout_config(normalized_layout)
        db.upsert_template(data)
        template = db.fetch_template(template_id)
        if template is None:
            raise NotFound("Template not found")
        return jsonify(serialize_template(template))

    @app.delete("/api/templates/<int:template_id>")
    def delete_template(template_id: int):
        if not db.fetch_template(template_id):
            raise NotFound("Template not found")
        db.delete_template(template_id)
        return ("", 204)

    @app.get("/api/labels")
    def list_labels():
        labels = [serialize_label(label) for label in db.fetch_labels()]
        return jsonify(labels)

    @app.post("/api/labels")
    def create_label():
        payload = request.get_json(silent=True) or {}
        template_id = int(payload.get("template_id") or 0)
        if template_id <= 0:
            raise BadRequest("template_id is required")
        template_record = db.fetch_template(template_id)
        if not template_record:
            raise NotFound("Template not found")
        parts_per_label = int(template_record["parts_per_label"] or 1)

        manufacturer = (payload.get("manufacturer") or "").strip()
        part_number = (payload.get("part_number") or "").strip()
        if not manufacturer or not part_number:
            raise BadRequest("Manufacturer and part number are required")

        data = {
            "template_id": template_id,
            "manufacturer": manufacturer,
            "part_number": part_number,
            "description": (payload.get("description") or "").strip() or None,
            "stock_quantity": int(payload.get("stock_quantity") or 0),
            "bin_location": (payload.get("bin_location") or "").strip() or None,
            "image_url": _normalize_image_reference(payload.get("image_url")),
            "notes": (payload.get("notes") or "").strip() or None,
            "default_copies": max(1, int(payload.get("default_copies") or 1)),
            "manufacturer_right": None,
            "part_number_right": None,
            "description_right": None,
            "stock_quantity_right": 0,
            "bin_location_right": None,
            "image_url_right": None,
            "notes_right": None,
        }
        if parts_per_label == 2:
            manufacturer_right = (payload.get("manufacturer_right") or "").strip()
            part_number_right = (payload.get("part_number_right") or "").strip()
            if not manufacturer_right or not part_number_right:
                raise BadRequest("Right-side manufacturer and part number are required")
            data["manufacturer_right"] = manufacturer_right
            data["part_number_right"] = part_number_right
            data["description_right"] = (payload.get("description_right") or "").strip() or None
            data["stock_quantity_right"] = int(payload.get("stock_quantity_right") or 0)
            data["bin_location_right"] = (payload.get("bin_location_right") or "").strip() or None
            data["image_url_right"] = _normalize_image_reference(payload.get("image_url_right"))
            data["notes_right"] = (payload.get("notes_right") or "").strip() or None
        label_id = db.create_label(data)
        label = db.fetch_label_with_template(label_id)
        if label is None:
            raise NotFound("Label not found")
        return jsonify(serialize_label(label)), 201

    @app.put("/api/labels/<int:label_id>")
    def update_label(label_id: int):
        existing_label = db.fetch_label(label_id)
        if not existing_label:
            raise NotFound("Label not found")

        payload = request.get_json(silent=True) or {}
        updates: dict[str, Any] = {}
        for key in (
            "manufacturer",
            "part_number",
            "description",
            "bin_location",
            "image_url",
            "notes",
            "manufacturer_right",
            "part_number_right",
            "description_right",
            "bin_location_right",
            "image_url_right",
            "notes_right",
        ):
            if key in payload:
                raw_value = payload.get(key)
                if key in {"image_url", "image_url_right"}:
                    updates[key] = _normalize_image_reference(raw_value)
                else:
                    value = (raw_value or "").strip()
                    updates[key] = value or None
        for key in ("stock_quantity", "default_copies", "stock_quantity_right"):
            if key in payload:
                raw_value = int(payload.get(key) or 0)
                updates[key] = max(1, raw_value) if key == "default_copies" else raw_value
        if "template_id" in payload:
            template_id = int(payload.get("template_id") or 0)
            if template_id <= 0:
                raise BadRequest("template_id is invalid")
            if not db.fetch_template(template_id):
                raise NotFound("Template not found")
            updates["template_id"] = template_id

        if not updates:
            raise BadRequest("No fields provided for update")

        target_template_id = updates.get("template_id", existing_label["template_id"])
        template_record = db.fetch_template(target_template_id)
        if not template_record:
            raise NotFound("Template not found")
        parts_per_label = int(template_record["parts_per_label"] or 1)
        if parts_per_label == 2:
            final_manufacturer_right = (
                updates.get("manufacturer_right")
                if "manufacturer_right" in updates
                else existing_label["manufacturer_right"]
            )
            final_part_number_right = (
                updates.get("part_number_right")
                if "part_number_right" in updates
                else existing_label["part_number_right"]
            )
            if not final_manufacturer_right or not final_part_number_right:
                raise BadRequest(
                    "Right-side manufacturer and part number are required for this template"
                )
        else:
            updates["manufacturer_right"] = None
            updates["part_number_right"] = None
            updates["description_right"] = None
            updates["bin_location_right"] = None
            updates["image_url_right"] = None
            updates["notes_right"] = None
            updates["stock_quantity_right"] = 0

        db.update_label(label_id, updates)
        label = db.fetch_label_with_template(label_id)
        if label is None:
            raise NotFound("Label not found")
        return jsonify(serialize_label(label))

    @app.delete("/api/labels/<int:label_id>")
    def delete_label(label_id: int):
        if not db.fetch_label(label_id):
            raise NotFound("Label not found")
        db.delete_label(label_id)
        return ("", 204)

    @app.post("/api/labels/print")
    def print_labels():
        payload = request.get_json(silent=True) or {}
        items = payload.get("items")
        if not isinstance(items, list) or not items:
            raise BadRequest("items must be a non-empty list")

        available = {label["id"]: label for label in db.fetch_labels()}
        chosen: list[tuple[pdf.LabelData, int]] = []
        for item in items:
            try:
                label_id = int(item.get("label_id"))
            except (TypeError, ValueError, AttributeError):
                raise BadRequest("label_id must be an integer")

            label = available.get(label_id)
            if not label:
                raise NotFound(f"Label {label_id} not found")

            copies = item.get("copies")
            try:
                copies_value = int(copies) if copies is not None else label["default_copies"]
            except (TypeError, ValueError):
                copies_value = label["default_copies"]

            template_config = pdf.TemplateConfig(
                name=label["template_name"],
                image_position=label["image_position"],
                accent_color=label["accent_color"],
                text_align=label["text_align"],
                include_description=bool(label["include_description"]),
                parts_per_label=int(label["parts_per_label"] or 1),
            )
            left_part = pdf.PartDetails(
                manufacturer=label["manufacturer"],
                part_number=label["part_number"],
                stock_quantity=int(label["stock_quantity"] or 0),
                description=label["description"],
                bin_location=label["bin_location"],
                image_url=label["image_url"],
                notes=label["notes"],
            )
            right_part = None
            if template_config.parts_per_label == 2:
                if not label["manufacturer_right"] or not label["part_number_right"]:
                    raise BadRequest(
                        f"Label {label_id} is missing right-side details required by its template"
                    )
                right_part = pdf.PartDetails(
                    manufacturer=label["manufacturer_right"],
                    part_number=label["part_number_right"],
                    stock_quantity=int(label["stock_quantity_right"] or 0),
                    description=label["description_right"],
                    bin_location=label["bin_location_right"],
                    image_url=label["image_url_right"],
                    notes=label["notes_right"],
                )
            label_data = pdf.LabelData(
                left=left_part,
                right=right_part,
                template=template_config,
            )
            chosen.append((label_data, max(1, copies_value)))

        pdf_bytes = pdf.build_pdf(chosen)
        timestamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
        return send_file(
            io.BytesIO(pdf_bytes),
            mimetype="application/pdf",
            download_name=f"labels-{timestamp}.pdf",
            as_attachment=True,
        )

    return app


def main() -> None:
    app = create_app()
    app.run(host="0.0.0.0", port=5000)


if __name__ == "__main__":
    main()
