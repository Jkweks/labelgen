"""Database helpers for the label generator application."""

from __future__ import annotations

import sqlite3
from typing import Iterable, Mapping

import click
from flask import current_app, g

from . import layouts


def get_db() -> sqlite3.Connection:
    """Return a connection to the application's SQLite database."""

    if "db" not in g:
        database_path = current_app.config["DATABASE"]
        connection = sqlite3.connect(database_path, detect_types=sqlite3.PARSE_DECLTYPES)
        connection.row_factory = sqlite3.Row
        g.db = connection
    return g.db  # type: ignore[return-value]


def close_db(_: Exception | None = None) -> None:
    """Close the database connection for the current request context."""

    database = g.pop("db", None)
    if database is not None:
        database.close()


def init_db() -> None:
    """Create database tables if they do not exist and seed defaults."""

    database = get_db()
    database.executescript(
        """
        CREATE TABLE IF NOT EXISTS template (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            description TEXT,
            image_position TEXT NOT NULL DEFAULT 'left',
            accent_color TEXT NOT NULL DEFAULT '#0a3d62',
            text_align TEXT NOT NULL DEFAULT 'left',
            include_description INTEGER NOT NULL DEFAULT 1,
            parts_per_label INTEGER NOT NULL DEFAULT 1,
            layout_config TEXT,
            field_formats TEXT
        );

        CREATE TABLE IF NOT EXISTS label (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            template_id INTEGER NOT NULL,
            manufacturer TEXT NOT NULL,
            part_number TEXT NOT NULL,
            description TEXT,
            stock_quantity INTEGER NOT NULL DEFAULT 0,
            bin_location TEXT,
            image_url TEXT,
            notes TEXT,
            default_copies INTEGER NOT NULL DEFAULT 1,
            manufacturer_right TEXT,
            part_number_right TEXT,
            description_right TEXT,
            stock_quantity_right INTEGER NOT NULL DEFAULT 0,
            bin_location_right TEXT,
            image_url_right TEXT,
            notes_right TEXT,
            FOREIGN KEY(template_id) REFERENCES template(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_label_template ON label(template_id);
        CREATE INDEX IF NOT EXISTS idx_label_part_number ON label(part_number);
        """
    )
    database.commit()

    template_columns = {
        row["name"] for row in database.execute("PRAGMA table_info(template)")
    }
    if "parts_per_label" not in template_columns:
        database.execute(
            "ALTER TABLE template ADD COLUMN parts_per_label INTEGER NOT NULL DEFAULT 1"
        )
    if "layout_config" not in template_columns:
        database.execute("ALTER TABLE template ADD COLUMN layout_config TEXT")
    if "field_formats" not in template_columns:
        database.execute("ALTER TABLE template ADD COLUMN field_formats TEXT")

    label_columns = {row["name"] for row in database.execute("PRAGMA table_info(label)")}
    if "manufacturer_right" not in label_columns:
        database.execute("ALTER TABLE label ADD COLUMN manufacturer_right TEXT")
    if "part_number_right" not in label_columns:
        database.execute("ALTER TABLE label ADD COLUMN part_number_right TEXT")
    if "description_right" not in label_columns:
        database.execute("ALTER TABLE label ADD COLUMN description_right TEXT")
    if "stock_quantity_right" not in label_columns:
        database.execute(
            "ALTER TABLE label ADD COLUMN stock_quantity_right INTEGER NOT NULL DEFAULT 0"
        )
    if "bin_location_right" not in label_columns:
        database.execute("ALTER TABLE label ADD COLUMN bin_location_right TEXT")
    if "image_url_right" not in label_columns:
        database.execute("ALTER TABLE label ADD COLUMN image_url_right TEXT")
    if "notes_right" not in label_columns:
        database.execute("ALTER TABLE label ADD COLUMN notes_right TEXT")
    database.commit()

    seed_default_templates()


def seed_default_templates() -> None:
    """Insert a set of starter templates if the table is empty."""

    database = get_db()
    existing = database.execute("SELECT COUNT(*) FROM template").fetchone()[0]
    if existing:
        return

    templates: Iterable[Mapping[str, object]] = (
        {
            "name": "Classic Shelf",
            "description": "Image on the left, text on the right",
            "image_position": "left",
            "accent_color": "#0a3d62",
            "text_align": "left",
            "include_description": 1,
            "parts_per_label": 1,
            "layout_config": layouts.dumps_layout_config(
                layouts.default_layout_config(1, True)
            ),
            "field_formats": layouts.dumps_field_formats(
                layouts.normalize_field_formats(None)
            ),
        },
        {
            "name": "Poster",
            "description": "Image on top, centered text below",
            "image_position": "top",
            "accent_color": "#b33939",
            "text_align": "center",
            "include_description": 1,
            "parts_per_label": 1,
            "layout_config": layouts.dumps_layout_config(
                layouts.default_layout_config(1, True)
            ),
            "field_formats": layouts.dumps_field_formats(
                layouts.normalize_field_formats(None)
            ),
        },
    )

    database.executemany(
        """
        INSERT INTO template (
            name,
            description,
            image_position,
            accent_color,
            text_align,
            include_description,
            parts_per_label,
            layout_config,
            field_formats
        )
        VALUES (
            :name,
            :description,
            :image_position,
            :accent_color,
            :text_align,
            :include_description,
            :parts_per_label,
            :layout_config,
            :field_formats
        )
        """,
        templates,
    )
    database.commit()


def fetch_templates() -> list[sqlite3.Row]:
    database = get_db()
    return database.execute(
        "SELECT * FROM template ORDER BY name COLLATE NOCASE"
    ).fetchall()


def fetch_template(template_id: int) -> sqlite3.Row | None:
    database = get_db()
    return database.execute(
        "SELECT * FROM template WHERE id = ?",
        (template_id,),
    ).fetchone()


def upsert_template(data: Mapping[str, object]) -> int:
    database = get_db()
    if data.get("id"):
        database.execute(
            """
            UPDATE template
               SET name = :name,
                   description = :description,
                   image_position = :image_position,
                   accent_color = :accent_color,
                   text_align = :text_align,
                   include_description = :include_description,
                   parts_per_label = :parts_per_label,
                   layout_config = :layout_config,
                   field_formats = :field_formats
             WHERE id = :id
            """,
            data,
        )
        template_id = int(data["id"])
    else:
        cursor = database.execute(
            """
            INSERT INTO template (
                name,
                description,
                image_position,
                accent_color,
                text_align,
                include_description,
                parts_per_label,
                layout_config,
                field_formats
            )
            VALUES (
                :name,
                :description,
                :image_position,
                :accent_color,
                :text_align,
                :include_description,
                :parts_per_label,
                :layout_config,
                :field_formats
            )
        """,
        data,
        )
        template_id = int(cursor.lastrowid)
    database.commit()
    return template_id


def delete_template(template_id: int) -> None:
    database = get_db()
    database.execute("DELETE FROM template WHERE id = ?", (template_id,))
    database.commit()


def fetch_labels() -> list[sqlite3.Row]:
    database = get_db()
    return database.execute(
        """
        SELECT label.*, template.name AS template_name, template.image_position, template.accent_color,
               template.text_align, template.include_description, template.parts_per_label, template.layout_config,
               template.field_formats
          FROM label
          JOIN template ON template.id = label.template_id
         ORDER BY label.manufacturer COLLATE NOCASE, label.part_number COLLATE NOCASE
        """
    ).fetchall()


def fetch_label(label_id: int) -> sqlite3.Row | None:
    database = get_db()
    return database.execute(
        "SELECT * FROM label WHERE id = ?",
        (label_id,),
    ).fetchone()


def create_label(data: Mapping[str, object]) -> int:
    database = get_db()
    cursor = database.execute(
        """
        INSERT INTO label (
            template_id,
            manufacturer,
            part_number,
            description,
            stock_quantity,
            bin_location,
            image_url,
            notes,
            default_copies,
            manufacturer_right,
            part_number_right,
            description_right,
            stock_quantity_right,
            bin_location_right,
            image_url_right,
            notes_right
        ) VALUES (
            :template_id,
            :manufacturer,
            :part_number,
            :description,
            :stock_quantity,
            :bin_location,
            :image_url,
            :notes,
            :default_copies,
            :manufacturer_right,
            :part_number_right,
            :description_right,
            :stock_quantity_right,
            :bin_location_right,
            :image_url_right,
            :notes_right
        )
        """,
        data,
    )
    database.commit()
    return int(cursor.lastrowid)


def update_label(label_id: int, data: Mapping[str, object]) -> None:
    database = get_db()
    assignments = ", ".join(f"{column} = :{column}" for column in data.keys())
    query = f"UPDATE label SET {assignments} WHERE id = :id"
    payload = dict(data)
    payload["id"] = label_id
    database.execute(query, payload)
    database.commit()


def fetch_label_with_template(label_id: int) -> sqlite3.Row | None:
    database = get_db()
    return database.execute(
        """
        SELECT label.*, template.name AS template_name, template.image_position, template.accent_color,
               template.text_align, template.include_description, template.parts_per_label, template.layout_config,
               template.field_formats
          FROM label
          JOIN template ON template.id = label.template_id
         WHERE label.id = ?
        """,
        (label_id,),
    ).fetchone()


def delete_label(label_id: int) -> None:
    database = get_db()
    database.execute("DELETE FROM label WHERE id = ?", (label_id,))
    database.commit()


def init_app(app) -> None:
    """Register database lifecycle hooks and CLI commands."""

    app.teardown_appcontext(close_db)

    @app.cli.command("init-db")
    def init_db_command() -> None:
        init_db()
        click.echo("Initialized the database.")