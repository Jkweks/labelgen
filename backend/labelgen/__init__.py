"""Flask application factory exposing a JSON API for label management."""

from __future__ import annotations

import io
import os
from datetime import datetime
from typing import Any

from flask import Flask, jsonify, request, send_file
from flask_cors import CORS
from werkzeug.exceptions import BadRequest, HTTPException, NotFound

from . import db, pdf


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

    db.init_app(app)
    CORS(app, resources={r"/api/*": {"origins": "*"}})

    @app.before_request
    def ensure_schema() -> None:
        if not app.config.get("_schema_loaded"):
            db.init_db()
            app.config["_schema_loaded"] = True

    def serialize_template(record: Any) -> dict[str, Any]:
        return {
            "id": record["id"],
            "name": record["name"],
            "description": record["description"],
            "image_position": record["image_position"],
            "accent_color": record["accent_color"],
            "text_align": record["text_align"],
            "include_description": bool(record["include_description"]),
        }

    def serialize_label(record: Any) -> dict[str, Any]:
        return {
            "id": record["id"],
            "template_id": record["template_id"],
            "manufacturer": record["manufacturer"],
            "part_number": record["part_number"],
            "description": record["description"],
            "stock_quantity": int(record["stock_quantity"] or 0),
            "bin_location": record["bin_location"],
            "image_url": record["image_url"],
            "notes": record["notes"],
            "default_copies": int(record["default_copies"] or 1),
            "template": {
                "name": record["template_name"],
                "image_position": record["image_position"],
                "accent_color": record["accent_color"],
                "text_align": record["text_align"],
                "include_description": bool(record["include_description"]),
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
        if not db.fetch_template(template_id):
            raise NotFound("Template not found")

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
            "image_url": (payload.get("image_url") or "").strip() or None,
            "notes": (payload.get("notes") or "").strip() or None,
            "default_copies": max(1, int(payload.get("default_copies") or 1)),
        }
        label_id = db.create_label(data)
        label = db.fetch_label_with_template(label_id)
        if label is None:
            raise NotFound("Label not found")
        return jsonify(serialize_label(label)), 201

    @app.put("/api/labels/<int:label_id>")
    def update_label(label_id: int):
        if not db.fetch_label(label_id):
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
        ):
            if key in payload:
                value = (payload.get(key) or "").strip()
                updates[key] = value or None
        for key in ("stock_quantity", "default_copies"):
            if key in payload:
                updates[key] = int(payload.get(key) or 0)
        if "template_id" in payload:
            template_id = int(payload.get("template_id") or 0)
            if template_id <= 0:
                raise BadRequest("template_id is invalid")
            if not db.fetch_template(template_id):
                raise NotFound("Template not found")
            updates["template_id"] = template_id

        if not updates:
            raise BadRequest("No fields provided for update")

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
            )
            label_data = pdf.LabelData(
                manufacturer=label["manufacturer"],
                part_number=label["part_number"],
                stock_quantity=int(label["stock_quantity"] or 0),
                description=label["description"],
                bin_location=label["bin_location"],
                image_url=label["image_url"],
                notes=label["notes"],
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
