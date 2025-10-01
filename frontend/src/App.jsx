import { useEffect, useMemo, useRef, useState } from 'react';

function resolveApiBase() {
  const envBase = import.meta.env.VITE_API_BASE_URL?.trim();
  if (envBase) {
    return envBase.replace(/\/+$/, '');
  }

  if (typeof window !== 'undefined') {
    const { origin, hostname } = window.location;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://localhost:5000';
    }
    return origin.replace(/\/+$/, '');
  }

  return 'http://localhost:5000';
}

const API_BASE = resolveApiBase();

const FIELD_LIBRARY = [
  { key: 'manufacturer', label: 'Manufacturer', sample: 'Acme Industries' },
  { key: 'part_number', label: 'Part number', sample: 'ACM-42-9000' },
  {
    key: 'description',
    label: 'Description',
    sample: 'Heavy duty fastener with zinc coating',
    descriptionDependent: true,
  },
  { key: 'stock_quantity', label: 'Quantity', sample: 'Qty: 128' },
  { key: 'bin_location', label: 'Bin', sample: 'Bin: A3-14' },
  { key: 'notes', label: 'Notes', sample: 'Handle with care' },
  {
    key: 'manufacturer_right',
    label: 'Manufacturer (right)',
    sample: 'Globex Corp',
    requiresDual: true,
  },
  {
    key: 'part_number_right',
    label: 'Part number (right)',
    sample: 'GBX-77-100',
    requiresDual: true,
  },
  {
    key: 'description_right',
    label: 'Description (right)',
    sample: 'Secondary component details',
    requiresDual: true,
    descriptionDependent: true,
  },
  {
    key: 'stock_quantity_right',
    label: 'Quantity (right)',
    sample: 'Qty: 64',
    requiresDual: true,
  },
  {
    key: 'bin_location_right',
    label: 'Bin (right)',
    sample: 'Bin: B2-07',
    requiresDual: true,
  },
  {
    key: 'notes_right',
    label: 'Notes (right)',
    sample: 'Secondary notes',
    requiresDual: true,
  },
];

const FIELD_MAP = FIELD_LIBRARY.reduce((map, field) => {
  map[field.key] = field;
  return map;
}, {});

const FIELD_FORMAT_DEFAULTS = {
  manufacturer: '{value}',
  part_number: '{value_upper}',
  description: '{value}',
  stock_quantity: 'On Hand: {value}',
  bin_location: 'Bin: {value}',
  notes: '{value}',
  manufacturer_right: '{value}',
  part_number_right: '{value_upper}',
  description_right: '{value}',
  stock_quantity_right: 'On Hand: {value}',
  bin_location_right: 'Bin: {value}',
  notes_right: '{value}',
};

const DESCRIPTION_KEYS = new Set(['description', 'description_right']);

const DEFAULT_SINGLE_BLOCKS = [
  { key: 'manufacturer', width: 'half' },
  { key: 'part_number', width: 'half' },
  { key: 'description', width: 'full' },
  { key: 'stock_quantity', width: 'half' },
  { key: 'bin_location', width: 'half' },
  { key: 'notes', width: 'full' },
];

const DEFAULT_DUAL_BLOCKS = [
  { key: 'manufacturer', width: 'half' },
  { key: 'part_number', width: 'half' },
  { key: 'manufacturer_right', width: 'half' },
  { key: 'part_number_right', width: 'half' },
  { key: 'description', width: 'full' },
  { key: 'description_right', width: 'full' },
  { key: 'stock_quantity', width: 'half' },
  { key: 'bin_location', width: 'half' },
  { key: 'stock_quantity_right', width: 'half' },
  { key: 'bin_location_right', width: 'half' },
  { key: 'notes', width: 'full' },
  { key: 'notes_right', width: 'full' },
];

const SAMPLE_TEXT = FIELD_LIBRARY.reduce((accumulator, field) => {
  accumulator[field.key] = field.sample;
  return accumulator;
}, {});

function cloneBlocks(blocks = []) {
  return blocks.map((block) => ({
    key: block.key,
    width: block.width === 'half' ? 'half' : 'full',
  }));
}

function createDefaultLayoutConfig(partsPerLabel = 1, includeDescription = true) {
  const base = partsPerLabel === 2 ? DEFAULT_DUAL_BLOCKS : DEFAULT_SINGLE_BLOCKS;
  const filtered = includeDescription
    ? base
    : base.filter((block) => !DESCRIPTION_KEYS.has(block.key));
  return { version: 1, blocks: cloneBlocks(filtered) };
}

function normalizeLayoutConfig(raw, partsPerLabel = 1, includeDescription = true) {
  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      parsed = null;
    }
  }

  const normalized = [];
  if (parsed && typeof parsed === 'object' && Array.isArray(parsed.blocks)) {
    for (const item of parsed.blocks) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const key = item.key;
      if (typeof key !== 'string' || normalized.some((block) => block.key === key)) {
        continue;
      }
      const fieldMeta = FIELD_MAP[key];
      if (!fieldMeta) {
        continue;
      }
      if (fieldMeta.requiresDual && partsPerLabel !== 2) {
        continue;
      }
      if (DESCRIPTION_KEYS.has(key) && !includeDescription) {
        continue;
      }
      normalized.push({
        key,
        width: item.width === 'half' ? 'half' : 'full',
      });
    }
  }

  if (!normalized.length) {
    return createDefaultLayoutConfig(partsPerLabel, includeDescription);
  }

  return { version: 1, blocks: normalized };
}

function normalizeFieldFormats(raw) {
  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      parsed = null;
    }
  }

  const normalized = { ...FIELD_FORMAT_DEFAULTS };
  if (parsed && typeof parsed === 'object') {
    for (const [key, value] of Object.entries(parsed)) {
      if (!FIELD_MAP[key] || typeof value !== 'string') {
        continue;
      }
      normalized[key] = value;
    }
  }

  return normalized;
}

function prepareFieldFormatPayload(formats, partsPerLabel = 1, includeDescription = true) {
  const normalized = normalizeFieldFormats(formats);
  const payload = {};
  for (const key of Object.keys(FIELD_MAP)) {
    const field = FIELD_MAP[key];
    if (field.requiresDual && partsPerLabel !== 2) {
      continue;
    }
    if (field.descriptionDependent && !includeDescription) {
      continue;
    }
    const value = normalized[key];
    const text = typeof value === 'string' ? value.trim() : '';
    payload[key] = text || FIELD_FORMAT_DEFAULTS[key] || '{value}';
  }
  return payload;
}

function createEmptyTemplateForm() {
  return {
    name: '',
    description: '',
    image_position: 'left',
    accent_color: '#0a3d62',
    text_align: 'left',
    include_description: true,
    parts_per_label: 1,
    layout_config: createDefaultLayoutConfig(1, true),
    field_formats: normalizeFieldFormats(null),
  };
}

function TemplatePlayground({
  layoutConfig,
  onChange,
  partsPerLabel,
  includeDescription,
  accentColor,
  textAlign,
  imagePosition,
}) {
  const [selectedField, setSelectedField] = useState('');
  const blocks = layoutConfig?.blocks ?? [];

  const usedKeys = useMemo(() => new Set(blocks.map((block) => block.key)), [blocks]);

  const availableFields = useMemo(() => {
    return FIELD_LIBRARY.filter((field) => {
      if (field.requiresDual && partsPerLabel !== 2) {
        return false;
      }
      if (field.descriptionDependent && !includeDescription) {
        return false;
      }
      return !usedKeys.has(field.key);
    });
  }, [partsPerLabel, includeDescription, usedKeys]);

  function updateBlocks(nextBlocks) {
    onChange({ version: 1, blocks: cloneBlocks(nextBlocks) });
  }

  function addField() {
    if (!selectedField) {
      return;
    }
    const next = [...blocks, { key: selectedField, width: 'full' }];
    setSelectedField('');
    updateBlocks(next);
  }

  function removeField(index) {
    const next = blocks.filter((_, idx) => idx !== index);
    updateBlocks(next);
  }

  function moveField(index, direction) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= blocks.length) {
      return;
    }
    const next = [...blocks];
    const [moved] = next.splice(index, 1);
    next.splice(targetIndex, 0, moved);
    updateBlocks(next);
  }

  function updateWidth(index, width) {
    const next = blocks.map((block, idx) =>
      idx === index ? { ...block, width: width === 'half' ? 'half' : 'full' } : block,
    );
    updateBlocks(next);
  }

  const previewBlocks = blocks.length
    ? blocks
    : createDefaultLayoutConfig(partsPerLabel, includeDescription).blocks;

  const previewClassName = `playground-preview image-${imagePosition} align-${textAlign}`;

  return (
    <div className="page">
      <header className="hero">
        <div>
          <h1>Label Generator</h1>
          <p>Manage templates and labels, then export printable PDFs.</p>
        </div>
        <button type="button" className="refresh" onClick={loadAll} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh data'}
        </button>
      </header>

      {message && <div className="banner success">{message}</div>}
      {error && <div className="banner error">{error}</div>}

      <nav className="tab-bar">
        {[{ key: 'new-label', label: 'New label' }, { key: 'templates', label: 'Templates' }, { key: 'print-queue', label: 'Print queue' }].map(
          (tab) => {
            const badgeValue =
              tab.key === 'new-label'
                ? labels.length
                : tab.key === 'templates'
                ? templates.length
                : tab.key === 'print-queue'
                ? selectedLabels.length
                : 0;
            return (
              <button
                key={tab.key}
                type="button"
                className={`tab-button${activeTab === tab.key ? ' active' : ''}`}
                onClick={() => setActiveTab(tab.key)}
              >
                <span>{tab.label}</span>
                {badgeValue > 0 && <span className="tab-badge">{badgeValue}</span>}
              </button>
            );
          },
        )}
      </nav>

      {activeTab === 'new-label' && (
        <section className="panel">
          <div className="panel-header">
            <h2>{editingLabelId ? 'Edit label' : 'New label'}</h2>
            {editingLabelId && (
              <button type="button" onClick={resetLabelForm} className="link-button">
                Cancel edit
              </button>
            )}
          </div>
          <form className="grid" onSubmit={submitLabel}>
            <label>
              Template
              <select name="template_id" value={labelForm.template_id} onChange={handleLabelChange} required>
                <option value="">Select template</option>
                {templates.map((template) => (
                  <option value={template.id} key={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Default copies
              <input
                name="default_copies"
                type="number"
                min="1"
                value={labelForm.default_copies}
                onChange={handleLabelChange}
              />
            </label>
            {selectedTemplate && (
              <p className="form-hint">
                {requiresDualParts
                  ? 'Two parts will be printed on each label. Provide details for both sides below.'
                  : 'This template prints a single part per label.'}
              </p>
            )}
            <div className="form-divider">{leftDividerLabel}</div>
            <label>
              {`Manufacturer${leftSideSuffix}`}
              <input name="manufacturer" value={labelForm.manufacturer} onChange={handleLabelChange} required />
            </label>
            <label>
              {`Part number${leftSideSuffix}`}
              <input name="part_number" value={labelForm.part_number} onChange={handleLabelChange} required />
            </label>
            <label>
              {`Quantity on hand${leftSideSuffix}`}
              <input
                name="stock_quantity"
                type="number"
                min="0"
                value={labelForm.stock_quantity}
                onChange={handleLabelChange}
              />
            </label>
            <label>
              {`Bin location${leftSideSuffix}`}
              <input name="bin_location" value={labelForm.bin_location} onChange={handleLabelChange} />
            </label>
            <label>
              {`Image URL${leftSideSuffix}`}
              <input name="image_url" value={labelForm.image_url} onChange={handleLabelChange} />
            </label>
            <label>
              {`Upload image${leftSideSuffix}`}
              <input
                type="file"
                accept="image/*"
                ref={leftImageInputRef}
                onChange={(event) =>
                  handleImageFileChange('left', event.target.files && event.target.files[0] ? event.target.files[0] : null)
                }
              />
              <span className="form-subtext">
                {imageFileLeft
                  ? `Selected file: ${imageFileLeft.name}`
                  : labelForm.image_url
                    ? 'Existing image will be reused unless you pick a new file.'
                    : 'You can upload an image instead of providing a URL.'}
              </span>
            </label>
            <label>
              {`Description${leftSideSuffix}`}
              <input name="description" value={labelForm.description} onChange={handleLabelChange} />
            </label>
            <label className="full">
              {`Notes${leftSideSuffix}`}
              <textarea name="notes" value={labelForm.notes} onChange={handleLabelChange} rows={3} />
            </label>
            {requiresDualParts && (
              <>
                <div className="form-divider">Right side details</div>
                <p className="form-subtext">These fields populate the right half of the label.</p>
                <label>
                  Manufacturer (right side)
                  <input
                    name="manufacturer_right"
                    value={labelForm.manufacturer_right}
                    onChange={handleLabelChange}
                    required={requiresDualParts}
                  />
                </label>
                <label>
                  Part number (right side)
                  <input
                    name="part_number_right"
                    value={labelForm.part_number_right}
                    onChange={handleLabelChange}
                    required={requiresDualParts}
                  />
                </label>
                <label>
                  Quantity on hand (right side)
                  <input
                    name="stock_quantity_right"
                    type="number"
                    min="0"
                    value={labelForm.stock_quantity_right}
                    onChange={handleLabelChange}
                  />
                </label>
                <label>
                  Bin location (right side)
                  <input
                    name="bin_location_right"
                    value={labelForm.bin_location_right}
                    onChange={handleLabelChange}
                  />
                </label>
                <label>
                  Image URL (right side)
                  <input
                    name="image_url_right"
                    value={labelForm.image_url_right}
                    onChange={handleLabelChange}
                  />
                </label>
                <label>
                  Upload image (right side)
                  <input
                    type="file"
                    accept="image/*"
                    ref={rightImageInputRef}
                    onChange={(event) =>
                      handleImageFileChange('right', event.target.files && event.target.files[0] ? event.target.files[0] : null)
                    }
                  />
                  <span className="form-subtext">
                    {imageFileRight
                      ? `Selected file: ${imageFileRight.name}`
                      : labelForm.image_url_right
                        ? 'Existing image will be reused unless you pick a new file.'
                        : 'You can upload an image instead of providing a URL.'}
                  </span>
                </label>
                <label>
                  Description (right side)
                  <input
                    name="description_right"
                    value={labelForm.description_right}
                    onChange={handleLabelChange}
                  />
                </label>
                <label className="full">
                  Notes (right side)
                  <textarea
                    name="notes_right"
                    value={labelForm.notes_right}
                    onChange={handleLabelChange}
                    rows={3}
                  />
                </label>
              </>
            )}
            <button type="submit" className="primary">
              {editingLabelId ? 'Update label' : 'Create label'}
            </button>
          </form>

          <h3>Labels</h3>
          <div className="table">
            <div className="table-row table-head">
              <span>Select</span>
              <span>Manufacturer</span>
              <span>Part #</span>
              <span>Template</span>
              <span>Qty</span>
              <span className="actions">Actions</span>
            </div>
            {labels.map((label) => (
              <div className="table-row" key={label.id}>
                <span>
                  <input
                    type="checkbox"
                    checked={Boolean(printSelection[label.id]?.selected)}
                    onChange={() => toggleLabelSelection(label)}
                  />
                </span>
                <span className="stacked">
                  <span>{label.manufacturer}</span>
                  {label.template?.parts_per_label === 2 && (
                    <span className="muted">Right: {label.manufacturer_right || '—'}</span>
                  )}
                </span>
                <span className="stacked">
                  <span>{label.part_number}</span>
                  {label.template?.parts_per_label === 2 && (
                    <span className="muted">Right: {label.part_number_right || '—'}</span>
                  )}
                </span>
                <span className="stacked">
                  <span>{label.template?.name || '—'}</span>
                  {label.template?.parts_per_label === 2 && <span className="muted">Two parts</span>}
                </span>
                <span className="copies-cell">
                  <input
                    type="number"
                    min="1"
                    value={printSelection[label.id]?.copies || label.default_copies || 1}
                    onChange={(event) => updateLabelCopies(label.id, event.target.value)}
                    disabled={!printSelection[label.id]?.selected}
                  />
                </span>
                <span className="actions">
                  <button type="button" onClick={() => editLabel(label)}>
                    Edit
                  </button>
                  <button type="button" className="danger" onClick={() => deleteLabel(label.id)}>
                    Delete
                  </button>
                </span>
              </div>
            ))}
            {!labels.length && <div className="table-row">No labels yet</div>}
          </div>
        </section>
      )}

      {activeTab === 'templates' && (
        <section className="panel">
          <div className="panel-header">
            <h2>{editingTemplateId ? 'Edit template' : 'New template'}</h2>
            {editingTemplateId && (
              <button type="button" onClick={resetTemplateForm} className="link-button">
                Cancel edit
              </button>
            )}
          </div>
          <form className="grid" onSubmit={submitTemplate}>
            <label>
              Template name
              <input name="name" value={templateForm.name} onChange={handleTemplateChange} required />
            </label>
            <label>
              Description
              <input name="description" value={templateForm.description} onChange={handleTemplateChange} />
            </label>
            <label>
              Accent color
              <input
                name="accent_color"
                type="color"
                value={templateForm.accent_color}
                onChange={handleTemplateChange}
              />
            </label>
            <label>
              Image position
              <select name="image_position" value={templateForm.image_position} onChange={handleTemplateChange}>
                <option value="left">Left</option>
                <option value="right">Right</option>
                <option value="top">Top</option>
                <option value="none">None</option>
              </select>
            </label>
            <label>
              Parts per label
              <select
                name="parts_per_label"
                value={templateForm.parts_per_label}
                onChange={handleTemplateChange}
              >
                <option value={1}>Single part</option>
                <option value={2}>Two parts</option>
              </select>
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                name="include_description"
                checked={templateForm.include_description}
                onChange={handleTemplateChange}
              />
              Include description fields
            </label>
            <label>
              Text alignment
              <select name="text_align" value={templateForm.text_align} onChange={handleTemplateChange}>
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </label>

            <div className="layout-playground">
              <TemplatePlayground
                layoutConfig={templateForm.layout_config}
                onChange={(config) =>
                  setTemplateForm((form) => ({
                    ...form,
                    layout_config: normalizeLayoutConfig(
                      config,
                      form.parts_per_label,
                      form.include_description,
                    ),
                  }))
                }
                partsPerLabel={templateForm.parts_per_label}
                includeDescription={templateForm.include_description}
                accentColor={templateForm.accent_color}
                textAlign={templateForm.text_align}
                imagePosition={templateForm.image_position}
              />
            </div>

            <div className="field-format-section">
              <div className="panel-header">
                <h3>Field formatting</h3>
                <button
                  type="button"
                  className="link-button field-format-reset"
                  onClick={() =>
                    setTemplateForm((form) => ({
                      ...form,
                      field_formats: normalizeFieldFormats(null),
                    }))
                  }
                >
                  Reset formats
                </button>
              </div>
              <div className="field-format-grid">
                {formatFields.map((field) => (
                  <div key={field.key} className="field-format-item">
                    <label>
                      <span>{field.label}</span>
                      <input
                        name={field.key}
                        value={templateForm.field_formats[field.key] || ''}
                        onChange={handleFieldFormatChange}
                      />
                    </label>
                    <p className="form-subtext">
                      Use placeholders like {'{value}'}, {'{value_upper}'}, {'{value_lower}'}, or {'{value_title}'}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <button type="submit" className="primary">
              {editingTemplateId ? 'Update template' : 'Create template'}
            </button>
          </form>

          <h3>Templates</h3>
          <div className="table">
            <div className="table-row table-head">
              <span>Name</span>
              <span>Accent</span>
              <span>Layout</span>
              <span>Description</span>
              <span className="actions">Actions</span>
            </div>
            {templates.map((template) => (
              <div className="table-row" key={template.id}>
                <span>{template.name}</span>
                <span>
                  <span className="swatch" style={{ backgroundColor: template.accent_color }} />
                  {template.accent_color}
                </span>
                <span className="stacked">
                  <span className="pill">{template.image_position}</span>
                  <span className="muted">
                    {template.parts_per_label === 2 ? 'Two parts' : 'Single part'}
                  </span>
                </span>
                <span>{template.include_description ? 'Includes description' : 'No description'}</span>
                <span className="actions">
                  <button type="button" onClick={() => editTemplate(template)}>
                    Edit
                  </button>
                  <button type="button" className="danger" onClick={() => deleteTemplate(template.id)}>
                    Delete
                  </button>
                </span>
              </div>
            ))}
            {!templates.length && <div className="table-row">No templates yet</div>}
          </div>
        </section>
      )}

      {activeTab === 'print-queue' && (
        <section className="panel">
          <div className="panel-header">
            <h2>Print queue</h2>
            <span>{selectedLabels.length} labels selected</span>
          </div>
          <p>Select labels from the New label tab and adjust copies, then export a PDF.</p>
          <div className="queue-list">
            {queueItems.length ? (
              queueItems.map(({ label, copies }) => (
                <div className="queue-row" key={label.id}>
                  <div className="queue-main">
                    <strong>{label.manufacturer}</strong>
                    <span className="muted">{label.part_number}</span>
                  </div>
                  <div className="queue-meta">
                    <span>{label.template?.name || '—'}</span>
                    <span className="muted">{copies} copies</span>
                  </div>
                </div>
              ))
            ) : (
              <p className="muted">No labels selected yet. Use the New label tab to build your queue.</p>
            )}
          </div>
          <button type="button" className="primary" onClick={downloadPdf} disabled={!selectedLabels.length}>
            Download selected as PDF
          </button>
        </section>
      )}
    </div>
  );
}

export default App;
