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
    <div className="template-playground">
      <div className="template-playground-header">
        <div>
          <h3>Visual template playground</h3>
          <p className="playground-hint">
            Add, reorder, and resize the data fields to match how you want this template to print.
          </p>
        </div>
        <div className="playground-add">
          <select
            value={selectedField}
            onChange={(event) => setSelectedField(event.target.value)}
          >
            <option value="">Select field to add</option>
            {availableFields.map((field) => (
              <option key={field.key} value={field.key}>
                {field.label}
              </option>
            ))}
          </select>
          <button type="button" onClick={addField} disabled={!selectedField}>
            Add field
          </button>
        </div>
      </div>

      <div className="playground-content">
        <div className="playground-list">
          {blocks.length === 0 && (
            <p className="playground-empty">No fields chosen yet — add one to get started.</p>
          )}
          {blocks.map((block, index) => {
            const field = FIELD_MAP[block.key];
            return (
              <div className="playground-row" key={block.key}>
                <div className="playground-row-main">
                  <strong>{field?.label ?? block.key}</strong>
                  <span className="playground-row-subtle">
                    {block.width === 'half' ? 'Half width' : 'Full width'}
                  </span>
                </div>
                <div className="playground-row-actions">
                  <label>
                    Width
                    <select
                      value={block.width}
                      onChange={(event) => updateWidth(index, event.target.value)}
                    >
                      <option value="full">Full</option>
                      <option value="half">Half</option>
                    </select>
                  </label>
                  <div className="playground-row-buttons">
                    <button
                      type="button"
                      onClick={() => moveField(index, -1)}
                      disabled={index === 0}
                    >
                      Move up
                    </button>
                    <button
                      type="button"
                      onClick={() => moveField(index, 1)}
                      disabled={index === blocks.length - 1}
                    >
                      Move down
                    </button>
                    <button type="button" className="danger" onClick={() => removeField(index)}>
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="playground-preview-wrapper">
          <div className="playground-preview-label">Live preview</div>
          <div className={previewClassName} style={{ borderColor: accentColor }}>
            {(imagePosition === 'left' || imagePosition === 'top') && (
              <div className="playground-preview-image" />
            )}
            <div className="playground-preview-content">
              {previewBlocks.map((block) => {
                const field = FIELD_MAP[block.key];
                return (
                  <div
                    key={block.key}
                    className={`playground-block ${block.width === 'half' ? 'half' : 'full'}`}
                  >
                    <span className="playground-block-label">{field?.label ?? block.key}</span>
                    <span className="playground-block-value">
                      {SAMPLE_TEXT[block.key] || 'Sample value'}
                    </span>
                  </div>
                );
              })}
            </div>
            {imagePosition === 'right' && <div className="playground-preview-image" />}
          </div>
          <p className="playground-footnote">
            Preview uses placeholder content. Actual data comes from each label when printing.
          </p>
        </div>
      </div>
    </div>
  );
}

const emptyLabelForm = {
  manufacturer: '',
  part_number: '',
  description: '',
  stock_quantity: 0,
  bin_location: '',
  image_url: '',
  notes: '',
  default_copies: 1,
  template_id: '',
  manufacturer_right: '',
  part_number_right: '',
  description_right: '',
  stock_quantity_right: 0,
  bin_location_right: '',
  image_url_right: '',
  notes_right: '',
};

function App() {
  const [templates, setTemplates] = useState([]);
  const [labels, setLabels] = useState([]);
  const [templateForm, setTemplateForm] = useState(() => createEmptyTemplateForm());
  const [labelForm, setLabelForm] = useState(emptyLabelForm);
  const [editingTemplateId, setEditingTemplateId] = useState(null);
  const [editingLabelId, setEditingLabelId] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [printSelection, setPrintSelection] = useState({});
  const [imageFileLeft, setImageFileLeft] = useState(null);
  const [imageFileRight, setImageFileRight] = useState(null);

  const leftImageInputRef = useRef(null);
  const rightImageInputRef = useRef(null);

  const formatFields = useMemo(() => {
    return FIELD_LIBRARY.filter((field) => {
      if (field.requiresDual && templateForm.parts_per_label !== 2) {
        return false;
      }
      if (field.descriptionDependent && !templateForm.include_description) {
        return false;
      }
      return true;
    });
  }, [templateForm.parts_per_label, templateForm.include_description]);

  const selectedLabels = useMemo(
    () =>
      Object.entries(printSelection)
        .filter(([, value]) => value?.selected)
        .map(([id, value]) => ({ id: Number(id), copies: value.copies || 1 })),
    [printSelection],
  );

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === Number(labelForm.template_id)),
    [templates, labelForm.template_id],
  );
  const requiresDualParts = selectedTemplate?.parts_per_label === 2;
  const leftDividerLabel = requiresDualParts ? 'Left side details' : 'Part details';
  const leftSideSuffix = requiresDualParts ? ' (left side)' : '';

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    setPrintSelection((previous) => {
      const next = {};
      for (const label of labels) {
        const existing = previous[label.id];
        if (existing?.selected) {
          next[label.id] = {
            selected: true,
            copies: existing.copies || label.default_copies || 1,
          };
        }
      }
      return next;
    });
  }, [labels]);

  useEffect(() => {
    if (!requiresDualParts) {
      setImageFileRight(null);
      if (rightImageInputRef.current) {
        rightImageInputRef.current.value = '';
      }
    }
  }, [requiresDualParts]);

  async function loadAll() {
    setLoading(true);
    setError('');
    try {
      await Promise.all([loadTemplates(), loadLabels()]);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }

  async function loadTemplates() {
    const response = await fetch(`${API_BASE}/api/templates`);
    if (!response.ok) {
      throw new Error('Failed to load templates');
    }
    const data = await response.json();
    setTemplates(
      data.map((template) => ({
        ...template,
        layout_config: normalizeLayoutConfig(
          template.layout_config,
          template.parts_per_label,
          template.include_description,
        ),
        field_formats: normalizeFieldFormats(template.field_formats),
      })),
    );
  }

  async function loadLabels() {
    const response = await fetch(`${API_BASE}/api/labels`);
    if (!response.ok) {
      throw new Error('Failed to load labels');
    }
    const data = await response.json();
    setLabels(
      data.map((label) => ({
        ...label,
        template: label.template
          ? {
              ...label.template,
              layout_config: normalizeLayoutConfig(
                label.template.layout_config,
                label.template.parts_per_label,
                label.template.include_description,
              ),
              field_formats: normalizeFieldFormats(label.template.field_formats),
            }
          : label.template,
      })),
    );
  }

  function resetTemplateForm() {
    setTemplateForm(createEmptyTemplateForm());
    setEditingTemplateId(null);
  }

  function resetLabelForm() {
    setLabelForm(emptyLabelForm);
    setEditingLabelId(null);
    setImageFileLeft(null);
    setImageFileRight(null);
    if (leftImageInputRef.current) {
      leftImageInputRef.current.value = '';
    }
    if (rightImageInputRef.current) {
      rightImageInputRef.current.value = '';
    }
  }

  function handleTemplateChange(event) {
    const { name, value, type, checked } = event.target;
    setTemplateForm((form) => {
      const parsedValue =
        type === 'checkbox'
          ? checked
          : name === 'parts_per_label'
          ? Number(value)
          : value;

      if (name === 'include_description') {
        const includeDescription = Boolean(parsedValue);
        const filteredLayout = includeDescription
          ? form.layout_config
          : {
              ...form.layout_config,
              blocks: (form.layout_config?.blocks ?? []).filter(
                (block) => !DESCRIPTION_KEYS.has(block.key),
              ),
            };
        return {
          ...form,
          include_description: includeDescription,
          layout_config: normalizeLayoutConfig(
            filteredLayout,
            form.parts_per_label,
            includeDescription,
          ),
        };
      }

      if (name === 'parts_per_label') {
        const partsPerLabel = Number(parsedValue) || 1;
        return {
          ...form,
          parts_per_label: partsPerLabel,
          layout_config: normalizeLayoutConfig(
            form.layout_config,
            partsPerLabel,
            form.include_description,
          ),
        };
      }

      return {
        ...form,
        [name]: parsedValue,
      };
    });
  }

  function handleFieldFormatChange(fieldKey, value) {
    setTemplateForm((form) => ({
      ...form,
      field_formats: {
        ...form.field_formats,
        [fieldKey]: value,
      },
    }));
  }

  function resetFieldFormat(fieldKey) {
    setTemplateForm((form) => ({
      ...form,
      field_formats: {
        ...form.field_formats,
        [fieldKey]: FIELD_FORMAT_DEFAULTS[fieldKey] || '{value}',
      },
    }));
  }

  function handleLabelChange(event) {
    const { name, value } = event.target;
    setLabelForm((form) => ({
      ...form,
      [name]:
        name === 'stock_quantity' || name === 'default_copies' || name === 'stock_quantity_right'
          ? Number(value)
          : value,
    }));
  }

  function handleImageFileChange(side, file) {
    if (side === 'left') {
      setImageFileLeft(file ?? null);
    } else {
      setImageFileRight(file ?? null);
    }
  }

  async function uploadImageFile(file) {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(`${API_BASE}/api/uploads`, {
      method: 'POST',
      body: formData,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || 'Unable to upload image');
    }
    return data;
  }

  async function submitTemplate(event) {
    event.preventDefault();
    setError('');
    const method = editingTemplateId ? 'PUT' : 'POST';
    const url = editingTemplateId
      ? `${API_BASE}/api/templates/${editingTemplateId}`
      : `${API_BASE}/api/templates`;

    const payload = {
      ...templateForm,
      layout_config: normalizeLayoutConfig(
        templateForm.layout_config,
        templateForm.parts_per_label,
        templateForm.include_description,
      ),
      field_formats: prepareFieldFormatPayload(
        templateForm.field_formats,
        templateForm.parts_per_label,
        templateForm.include_description,
      ),
    };

    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.error || 'Unable to save template');
      return;
    }

    await loadTemplates();
    setMessage(`Template ${editingTemplateId ? 'updated' : 'created'} successfully`);
    resetTemplateForm();
  }

  async function submitLabel(event) {
    event.preventDefault();
    setError('');
    if (!labelForm.template_id) {
      setError('Select a template for the label');
      return;
    }

    if (requiresDualParts) {
      if (!labelForm.manufacturer_right.trim() || !labelForm.part_number_right.trim()) {
        setError('Enter manufacturer and part number for the right side');
        return;
      }
    }

    const payload = {
      ...labelForm,
      template_id: Number(labelForm.template_id),
      stock_quantity: Number(labelForm.stock_quantity) || 0,
      default_copies: Number(labelForm.default_copies) || 1,
      stock_quantity_right: Number(labelForm.stock_quantity_right) || 0,
    };

    try {
      if (imageFileLeft) {
        const upload = await uploadImageFile(imageFileLeft);
        payload.image_url = upload.path;
      }
      if (requiresDualParts && imageFileRight) {
        const upload = await uploadImageFile(imageFileRight);
        payload.image_url_right = upload.path;
      }
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Unable to upload image');
      return;
    }

    if (!requiresDualParts) {
      payload.manufacturer_right = '';
      payload.part_number_right = '';
      payload.description_right = '';
      payload.stock_quantity_right = 0;
      payload.bin_location_right = '';
      payload.image_url_right = '';
      payload.notes_right = '';
    }

    const method = editingLabelId ? 'PUT' : 'POST';
    const url = editingLabelId
      ? `${API_BASE}/api/labels/${editingLabelId}`
      : `${API_BASE}/api/labels`;

    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.error || 'Unable to save label');
      return;
    }

    await loadLabels();
    setMessage(`Label ${editingLabelId ? 'updated' : 'created'} successfully`);
    resetLabelForm();
  }

  function editTemplate(template) {
    setEditingTemplateId(template.id);
    setTemplateForm({
      name: template.name,
      description: template.description || '',
      image_position: template.image_position,
      accent_color: template.accent_color,
      text_align: template.text_align,
      include_description: Boolean(template.include_description),
      parts_per_label: template.parts_per_label || 1,
      layout_config: normalizeLayoutConfig(
        template.layout_config,
        template.parts_per_label || 1,
        Boolean(template.include_description),
      ),
      field_formats: normalizeFieldFormats(template.field_formats),
    });
  }

  async function deleteTemplate(templateId) {
    if (!window.confirm('Delete this template? Labels using it must be reassigned manually.')) {
      return;
    }
    setError('');
    const response = await fetch(`${API_BASE}/api/templates/${templateId}`, { method: 'DELETE' });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.error || 'Unable to delete template');
      return;
    }
    await loadTemplates();
    await loadLabels();
    setMessage('Template removed');
  }

  function editLabel(label) {
    setEditingLabelId(label.id);
    setLabelForm({
      manufacturer: label.manufacturer,
      part_number: label.part_number,
      description: label.description || '',
      stock_quantity: label.stock_quantity || 0,
      bin_location: label.bin_location || '',
      image_url: label.image_url || '',
      notes: label.notes || '',
      default_copies: label.default_copies || 1,
      template_id: label.template_id,
      manufacturer_right: label.manufacturer_right || '',
      part_number_right: label.part_number_right || '',
      description_right: label.description_right || '',
      stock_quantity_right: label.stock_quantity_right || 0,
      bin_location_right: label.bin_location_right || '',
      image_url_right: label.image_url_right || '',
      notes_right: label.notes_right || '',
    });
    setImageFileLeft(null);
    setImageFileRight(null);
    if (leftImageInputRef.current) {
      leftImageInputRef.current.value = '';
    }
    if (rightImageInputRef.current) {
      rightImageInputRef.current.value = '';
    }
  }

  async function deleteLabel(labelId) {
    if (!window.confirm('Delete this label?')) {
      return;
    }
    setError('');
    const response = await fetch(`${API_BASE}/api/labels/${labelId}`, { method: 'DELETE' });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.error || 'Unable to delete label');
      return;
    }
    await loadLabels();
    setMessage('Label removed');
  }

  function toggleLabelSelection(label) {
    setPrintSelection((previous) => {
      const existing = previous[label.id];
      const selected = !existing?.selected;
      return {
        ...previous,
        [label.id]: {
          selected,
          copies: existing?.copies || label.default_copies || 1,
        },
      };
    });
  }

  function updateLabelCopies(labelId, copies) {
    const parsed = Number(copies) || 1;
    setPrintSelection((previous) => ({
      ...previous,
      [labelId]: {
        selected: previous[labelId]?.selected ?? true,
        copies: parsed,
      },
    }));
  }

  async function downloadPdf() {
    if (!selectedLabels.length) {
      setError('Select at least one label to print');
      return;
    }

    setError('');
    setMessage('Generating PDF...');
    const response = await fetch(`${API_BASE}/api/labels/print`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: selectedLabels.map((item) => ({ label_id: item.id, copies: item.copies })),
      }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.error || 'Unable to generate PDF');
      setMessage('');
      return;
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'labels.pdf';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
    setMessage('PDF downloaded successfully');
  }

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
            Name
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
            </select>
          </label>
          <label>
            Text alignment
            <select name="text_align" value={templateForm.text_align} onChange={handleTemplateChange}>
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </label>
          <label>
            Parts per label
            <select name="parts_per_label" value={templateForm.parts_per_label} onChange={handleTemplateChange}>
              <option value={1}>Single part</option>
              <option value={2}>Two parts (left &amp; right)</option>
            </select>
          </label>
          <p className="form-hint">
            Dual templates split the printable area so two parts can share one label.
          </p>
          <label className="checkbox">
            <input
              type="checkbox"
              name="include_description"
              checked={templateForm.include_description}
              onChange={handleTemplateChange}
            />
            Include description on labels
          </label>
          <div className="layout-playground">
            <TemplatePlayground
              layoutConfig={templateForm.layout_config}
              onChange={(nextLayout) =>
                setTemplateForm((form) => ({
                  ...form,
                  layout_config: normalizeLayoutConfig(
                    nextLayout,
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
            <div className="form-divider">Field formatting</div>
            <p className="form-subtext">
              Control how each field is rendered when printing. Use placeholders like{' '}
              <code>{'{value}'}</code>, <code>{'{value_upper}'}</code>, <code>{'{value_lower}'}</code>, or{' '}
              <code>{'{value_number}'}</code>.
            </p>
            <div className="field-format-grid">
              {formatFields.map((field) => {
                const currentValue =
                  (templateForm.field_formats && templateForm.field_formats[field.key]) ||
                  FIELD_FORMAT_DEFAULTS[field.key] ||
                  '{value}';
                return (
                  <div className="field-format-item" key={field.key}>
                    <label>
                      {field.label}
                      <input
                        value={currentValue}
                        onChange={(event) => handleFieldFormatChange(field.key, event.target.value)}
                      />
                    </label>
                    <button
                      type="button"
                      className="link-button field-format-reset"
                      onClick={() => resetFieldFormat(field.key)}
                    >
                      Reset to default
                    </button>
                  </div>
                );
              })}
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

      <section className="panel">
        <div className="panel-header">
          <h2>Print queue</h2>
          <span>{selectedLabels.length} labels selected</span>
        </div>
        <p>Select labels above and adjust copies, then export a PDF.</p>
        <button type="button" className="primary" onClick={downloadPdf} disabled={!selectedLabels.length}>
          Download selected as PDF
        </button>
      </section>
    </div>
  );
}

export default App;
