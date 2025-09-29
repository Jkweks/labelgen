# Label Generator

Create and organize printable bin labels that include product imagery, manufacturer details, part numbers, and quantities. The app lets you maintain multiple visual templates and export mixed layouts to a 10-up letter-sized PDF for printing.

## Features

- Build reusable templates with configurable image placement, accent color, and text alignment.
- Store every label with manufacturer, part number, quantity, description, bin location, image URL, and custom notes.
- Choose which labels to print, adjust quantities per part, and download a PDF (10 labels per sheet).
- Mix different templates on the same sheet – each label remembers the template it was assigned.
- Edit or delete labels and templates from the web UI.

## Getting started

### Requirements

- Python 3.11+

### Installation

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### Run the application

```bash
flask --app labelgen run
```

The first request initializes the SQLite database (stored in `instance/labelgen.sqlite`). Visit `http://127.0.0.1:5000` to start adding templates and labels.

### Generate the database manually (optional)

```bash
flask --app labelgen init-db
```

### Exporting PDFs

1. Add a few labels to the library and choose the template for each.
2. Tick the checkboxes next to the labels you need and set the number of copies.
3. Click **Download selected as PDF** to export a 10-per-page letter-sized PDF that is ready for printing.

Image URLs are fetched live during PDF generation. If an image cannot be retrieved the label will render with a neutral placeholder banner instead.

## Tests

Currently there are no automated tests. Run the application locally and verify PDF generation as needed.
