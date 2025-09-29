"""Flask application factory for the label generator."""

from __future__ import annotations

import io
import os
from datetime import datetime

from flask import (Flask, flash, redirect, render_template, request, send_file,
                   url_for)

from . import db, pdf


def create_app(test_config: dict | None = None) -> Flask:
    app = Flask(__name__, instance_relative_config=True)
    app.config.from_mapping(
        SECRET_KEY="dev",
        DATABASE=os.path.join(app.instance_path, "labelgen.sqlite"),
    )

    if test_config is not None:
        app.config.update(test_config)

    os.makedirs(app.instance_path, exist_ok=True)

    db.init_app(app)

    @app.before_request
    def ensure_schema() -> None:
        if not app.config.get("_schema_loaded"):
            db.init_db()
            app.config["_schema_loaded"] = True

    @app.route("/")
    def home():
        return redirect(url_for("labels"))

    @app.route("/templates", methods=["GET", "POST"])
    def templates():
        if request.method == "POST":
            action = request.form.get("action", "create")
            name = request.form.get("name", "").strip()
            image_position = request.form.get("image_position", "left")
            accent_color = request.form.get("accent_color", "#0a3d62").strip() or "#0a3d62"
            text_align = request.form.get("text_align", "left")
            include_description = 1 if request.form.get("include_description") else 0
            description = request.form.get("description", "").strip() or None

            if not name:
                flash("Template name is required.", "error")
            else:
                payload = {
                    "name": name,
                    "description": description,
                    "image_position": image_position,
                    "accent_color": accent_color,
                    "text_align": text_align,
                    "include_description": include_description,
                }
                if action == "update":
                    payload["id"] = int(request.form["template_id"])
                try:
                    db.upsert_template(payload)
                    flash("Template saved.")
                except Exception as exc:
                    flash(f"Unable to save template: {exc}", "error")
            return redirect(url_for("templates"))

        templates = db.fetch_templates()
        return render_template("templates/index.html", templates=templates)

    @app.post("/templates/<int:template_id>/delete")
    def delete_template(template_id: int):
        db.delete_template(template_id)
        flash("Template removed.")
        return redirect(url_for("templates"))

    @app.route("/labels", methods=["GET", "POST"])
    def labels():
        if request.method == "POST":
            manufacturer = request.form.get("manufacturer", "").strip()
            part_number = request.form.get("part_number", "").strip()
            if not manufacturer or not part_number:
                flash("Manufacturer and part number are required.", "error")
            else:
                try:
                    template_id = int(request.form.get("template_id", 0))
                except (TypeError, ValueError):
                    template_id = 0
                if template_id <= 0:
                    flash("Choose a template before saving the label.", "error")
                    return redirect(url_for("labels"))
                description = request.form.get("description", "").strip() or None
                stock_qty = int(request.form.get("stock_quantity", 0) or 0)
                bin_location = request.form.get("bin_location", "").strip() or None
                image_url = request.form.get("image_url", "").strip() or None
                notes = request.form.get("notes", "").strip() or None
                default_copies = max(1, int(request.form.get("default_copies", 1) or 1))

                db.create_label(
                    {
                        "template_id": template_id,
                        "manufacturer": manufacturer,
                        "part_number": part_number,
                        "description": description,
                        "stock_quantity": stock_qty,
                        "bin_location": bin_location,
                        "image_url": image_url,
                        "notes": notes,
                        "default_copies": default_copies,
                    }
                )
                flash("Label added to library.")
            return redirect(url_for("labels"))

        templates = db.fetch_templates()
        labels = db.fetch_labels()
        return render_template("labels/index.html", templates=templates, labels=labels)

    @app.post("/labels/<int:label_id>/update")
    def update_label(label_id: int):
        fields = {}
        for key in ("manufacturer", "part_number", "description", "stock_quantity", "bin_location", "image_url", "notes", "default_copies"):
            value = request.form.get(key)
            if value is None:
                continue
            value = value.strip()
            if key in {"stock_quantity", "default_copies"}:
                fields[key] = int(value or 0)
            else:
                fields[key] = value or None
        template_id = request.form.get("template_id")
        if template_id:
            fields["template_id"] = int(template_id)

        if fields:
            db.update_label(label_id, fields)
            flash("Label updated.")
        else:
            flash("No changes detected.", "info")
        return redirect(url_for("labels"))

    @app.post("/labels/<int:label_id>/delete")
    def delete_label(label_id: int):
        db.delete_label(label_id)
        flash("Label removed.")
        return redirect(url_for("labels"))

    @app.post("/labels/print")
    def print_labels():
        selected_ids = request.form.getlist("label_ids")
        if not selected_ids:
            flash("Select at least one label to generate a PDF.", "error")
            return redirect(url_for("labels"))

        labels_by_id = {str(label["id"]): label for label in db.fetch_labels()}
        chosen: list[tuple[pdf.LabelData, int]] = []
        for label_id in selected_ids:
            label = labels_by_id.get(label_id)
            if not label:
                continue
            copies_value = request.form.get(f"copies_{label_id}")
            try:
                copies = int(copies_value) if copies_value else label["default_copies"]
            except ValueError:
                copies = label["default_copies"]

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
            chosen.append((label_data, max(1, copies)))

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
    app.run(debug=True)


if __name__ == "__main__":
    main()