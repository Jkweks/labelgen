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

function createEmptyLabelForm(templateId = '') {
  return {
    template_id: templateId ? String(templateId) : '',
    default_copies: 1,
    manufacturer: '',
    part_number: '',
    description: '',
    stock_quantity: '',
    bin_location: '',
    image_url: '',
    notes: '',
    manufacturer_right: '',
    part_number_right: '',
    description_right: '',
    stock_quantity_right: '',
    bin_location_right: '',
    image_url_right: '',
    notes_right: '',
  };
}

function formatSampleValue(templateText, rawValue) {
  const value = rawValue ?? '';
  const upper = value.toUpperCase();
  const lower = value.toLowerCase();
  const title = value.replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
  return templateText
    .replace(/\{value_upper\}/gi, upper)
    .replace(/\{value_lower\}/gi, lower)
    .replace(/\{value_title\}/gi, title)
    .replace(/\{value\}/gi, value);
}
function TemplatePlayground({
  layoutConfig,
  onChange,
  partsPerLabel,
  includeDescription,
  accentColor,
  textAlign,
  imagePosition,
  fieldFormats,
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

  const formattedSamples = useMemo(() => {
    const payload = fieldFormats || prepareFieldFormatPayload(null, partsPerLabel, includeDescription);
    const result = {};
    for (const block of previewBlocks) {
      const field = FIELD_MAP[block.key];
      if (!field) {
        continue;
      }
      const sample = SAMPLE_TEXT[field.key] ?? '';
      const templateText = payload[field.key] ?? FIELD_FORMAT_DEFAULTS[field.key] ?? '{value}';
      result[field.key] = formatSampleValue(templateText, sample);
    }
    return result;
  }, [fieldFormats, previewBlocks, partsPerLabel, includeDescription]);

  return (
    <div className="template-playground">
      <div className="template-playground-header">
        <div>
          <h3>Layout playground</h3>
          <p className="playground-hint">
            Arrange the blocks below to control how label data appears in the PDF preview.
          </p>
        </div>
        <div className="playground-add">
          <select value={selectedField} onChange={(event) => setSelectedField(event.target.value)}>
            <option value="">Add field…</option>
            {availableFields.map((field) => (
              <option value={field.key} key={field.key}>
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
          {previewBlocks.length ? (
            previewBlocks.map((block, index) => {
              const field = FIELD_MAP[block.key];
              if (!field) {
                return null;
              }
              return (
                <div className="playground-row" key={block.key}>
                  <div className="playground-row-main">
                    <span>{field.label}</span>
                    <span className="playground-row-subtle">{block.width === 'half' ? 'Half width' : 'Full width'}</span>
                  </div>
                  <div className="playground-row-actions">
                    <label>
                      Width
                      <select
                        value={block.width === 'half' ? 'half' : 'full'}
                        onChange={(event) => updateWidth(index, event.target.value)}
                      >
                        <option value="full">Full</option>
                        <option value="half">Half</option>
                      </select>
                    </label>
                    <div className="playground-row-buttons">
                      <button type="button" onClick={() => moveField(index, -1)} disabled={index === 0}>
                        Move up
                      </button>
                      <button
                        type="button"
                        onClick={() => moveField(index, 1)}
                        disabled={index === previewBlocks.length - 1}
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
            })
          ) : (
            <p className="playground-empty">No fields configured.</p>
          )}
        </div>

        <div className="playground-preview-wrapper">
          <span className="playground-preview-label">Live preview</span>
          <div className={previewClassName} style={{ borderColor: accentColor }}>
            {imagePosition !== 'none' && <div className="playground-preview-image" />}
            <div className="playground-preview-content">
              {previewBlocks.map((block) => {
                const field = FIELD_MAP[block.key];
                if (!field) {
                  return null;
                }
                return (
                  <div className={`playground-block ${block.width === 'half' ? 'half' : 'full'}`} key={block.key}>
                    <span className="playground-block-label">{field.label}</span>
                    <span className="playground-block-value">{formattedSamples[block.key] ?? SAMPLE_TEXT[block.key]}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <p className="playground-footnote">Preview uses example content for illustration only.</p>
        </div>
      </div>
    </div>
  );
}
function App() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('new-label');
  const [templates, setTemplates] = useState([]);
  const [labels, setLabels] = useState([]);
  const [templateForm, setTemplateForm] = useState(createEmptyTemplateForm());
  const [editingTemplateId, setEditingTemplateId] = useState(null);
  const [labelForm, setLabelForm] = useState(createEmptyLabelForm());
  const [editingLabelId, setEditingLabelId] = useState(null);
  const [imageFileLeft, setImageFileLeft] = useState(null);
  const [imageFileRight, setImageFileRight] = useState(null);
  const [printSelection, setPrintSelection] = useState({});
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [submittingLabel, setSubmittingLabel] = useState(false);
  const [submittingTemplate, setSubmittingTemplate] = useState(false);

  const leftImageInputRef = useRef(null);
  const rightImageInputRef = useRef(null);

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    if (!message) {
      return undefined;
    }
    const timeout = setTimeout(() => setMessage(''), 4000);
    return () => clearTimeout(timeout);
  }, [message]);

  useEffect(() => {
    if (!error) {
      return undefined;
    }
    const timeout = setTimeout(() => setError(''), 6000);
    return () => clearTimeout(timeout);
  }, [error]);

  useEffect(() => {
    setPrintSelection((selection) => {
      const next = {};
      for (const label of labels) {
        const current = selection[label.id];
        if (current?.selected) {
          next[label.id] = { selected: true, copies: current.copies || label.default_copies || 1 };
        }
      }
      return next;
    });
  }, [labels]);

  const selectedTemplate = useMemo(() => {
    const templateId = Number(labelForm.template_id);
    if (!templateId) {
      return null;
    }
    return templates.find((template) => template.id === templateId) || null;
  }, [labelForm.template_id, templates]);

  const requiresDualParts = selectedTemplate?.parts_per_label === 2;
  const descriptionEnabled = selectedTemplate ? !!selectedTemplate.include_description : true;

  useEffect(() => {
    if (requiresDualParts) {
      return;
    }
    setLabelForm((form) => ({
      ...form,
      manufacturer_right: '',
      part_number_right: '',
      description_right: '',
      stock_quantity_right: '',
      bin_location_right: '',
      image_url_right: '',
      notes_right: '',
    }));
  }, [requiresDualParts]);

  useEffect(() => {
    if (descriptionEnabled) {
      return;
    }
    setLabelForm((form) => ({
      ...form,
      description: '',
      notes: '',
      description_right: '',
      notes_right: '',
    }));
  }, [descriptionEnabled]);

  const leftDividerLabel = requiresDualParts ? 'Left side details' : 'Label details';
  const leftSideSuffix = requiresDualParts ? ' (left)' : '';

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

  const templateFieldFormats = useMemo(
    () =>
      prepareFieldFormatPayload(
        templateForm.field_formats,
        templateForm.parts_per_label,
        templateForm.include_description,
      ),
    [templateForm.field_formats, templateForm.parts_per_label, templateForm.include_description],
  );

  const selectedLabels = useMemo(
    () => labels.filter((label) => printSelection[label.id]?.selected),
    [labels, printSelection],
  );

  const queueItems = useMemo(
    () =>
      selectedLabels.map((label) => ({
        label,
        copies: printSelection[label.id]?.copies || label.default_copies || 1,
      })),
    [selectedLabels, printSelection],
  );
  async function fetchJson(path, options) {
    const response = await fetch(`${API_BASE}${path}`, options);
    if (!response.ok) {
      let messageText = `Request failed with status ${response.status}`;
      try {
        const data = await response.json();
        if (data?.error) {
          messageText = data.error;
        }
      } catch (parseError) {
        // ignore JSON parse issues
      }
      throw new Error(messageText);
    }
    if (response.status === 204) {
      return null;
    }
    return response.json();
  }

  async function loadAll() {
    setLoading(true);
    setError('');
    try {
      const [templatesData, labelsData] = await Promise.all([
        fetchJson('/api/templates'),
        fetchJson('/api/labels'),
      ]);
      setTemplates(Array.isArray(templatesData) ? templatesData : []);
      setLabels(Array.isArray(labelsData) ? labelsData : []);
    } catch (loadError) {
      console.error(loadError);
      setError(loadError.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }

  function resetTemplateForm() {
    setEditingTemplateId(null);
    setTemplateForm(createEmptyTemplateForm());
  }

  function resetLabelForm() {
    setEditingLabelId(null);
    setLabelForm(createEmptyLabelForm());
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
      if (name === 'parts_per_label') {
        const parts = parseInt(value, 10) === 2 ? 2 : 1;
        return {
          ...form,
          parts_per_label: parts,
          layout_config: normalizeLayoutConfig(form.layout_config, parts, form.include_description),
          field_formats: prepareFieldFormatPayload(form.field_formats, parts, form.include_description),
        };
      }
      if (name === 'include_description') {
        const include = type === 'checkbox' ? checked : value === 'true';
        return {
          ...form,
          include_description: include,
          layout_config: normalizeLayoutConfig(form.layout_config, form.parts_per_label, include),
          field_formats: prepareFieldFormatPayload(form.field_formats, form.parts_per_label, include),
        };
      }
      return {
        ...form,
        [name]: value,
      };
    });
  }

  function handleFieldFormatChange(event) {
    const { name, value } = event.target;
    setTemplateForm((form) => ({
      ...form,
      field_formats: {
        ...form.field_formats,
        [name]: value,
      },
    }));
  }

  function handleLabelChange(event) {
    const { name, value } = event.target;
    setLabelForm((form) => ({
      ...form,
      [name]: value,
    }));
  }

  function handleImageFileChange(side, file) {
    if (side === 'left') {
      setImageFileLeft(file);
    } else {
      setImageFileRight(file);
    }
  }

  async function uploadImage(file) {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(`${API_BASE}/api/uploads`, {
      method: 'POST',
      body: formData,
    });
    if (!response.ok) {
      let messageText = 'Failed to upload image';
      try {
        const data = await response.json();
        if (data?.error) {
          messageText = data.error;
        }
      } catch (parseError) {
        // ignore parse errors
      }
      throw new Error(messageText);
    }
    return response.json();
  }

  async function submitTemplate(event) {
    event.preventDefault();
    setSubmittingTemplate(true);
    setError('');
    try {
      const payload = {
        name: templateForm.name.trim(),
        description: templateForm.description.trim(),
        image_position: templateForm.image_position,
        accent_color: templateForm.accent_color,
        text_align: templateForm.text_align,
        include_description: templateForm.include_description,
        parts_per_label: templateForm.parts_per_label,
        layout_config: templateForm.layout_config,
        field_formats: templateForm.field_formats,
      };
      if (!payload.name) {
        throw new Error('Template name is required');
      }
      const method = editingTemplateId ? 'PUT' : 'POST';
      const path = editingTemplateId ? `/api/templates/${editingTemplateId}` : '/api/templates';
      await fetchJson(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      setMessage(editingTemplateId ? 'Template updated.' : 'Template created.');
      await loadAll();
      resetTemplateForm();
    } catch (submitError) {
      console.error(submitError);
      setError(submitError.message || 'Failed to save template');
    } finally {
      setSubmittingTemplate(false);
    }
  }

  function editTemplate(template) {
    setActiveTab('templates');
    setEditingTemplateId(template.id);
    setTemplateForm({
      name: template.name ?? '',
      description: template.description ?? '',
      image_position: template.image_position ?? 'left',
      accent_color: template.accent_color ?? '#0a3d62',
      text_align: template.text_align ?? 'left',
      include_description: !!template.include_description,
      parts_per_label: template.parts_per_label ?? 1,
      layout_config: normalizeLayoutConfig(
        template.layout_config,
        template.parts_per_label ?? 1,
        !!template.include_description,
      ),
      field_formats: normalizeFieldFormats(template.field_formats),
    });
  }

  async function deleteTemplate(templateId) {
    if (!window.confirm('Delete this template?')) {
      return;
    }
    setError('');
    try {
      await fetchJson(`/api/templates/${templateId}`, { method: 'DELETE' });
      setMessage('Template deleted.');
      await loadAll();
      if (editingTemplateId === templateId) {
        resetTemplateForm();
      }
      if (Number(labelForm.template_id) === templateId) {
        resetLabelForm();
      }
    } catch (deleteError) {
      console.error(deleteError);
      setError(deleteError.message || 'Failed to delete template');
    }
  }
  async function submitLabel(event) {
    event.preventDefault();
    if (!selectedTemplate) {
      setError('Select a template for the label.');
      return;
    }
    if (!labelForm.manufacturer.trim() || !labelForm.part_number.trim()) {
      setError('Manufacturer and part number are required.');
      return;
    }
    if (requiresDualParts) {
      if (!labelForm.manufacturer_right.trim() || !labelForm.part_number_right.trim()) {
        setError('Right-side manufacturer and part number are required.');
        return;
      }
    }

    setSubmittingLabel(true);
    setError('');
    try {
      const payload = {
        template_id: Number(labelForm.template_id),
        manufacturer: labelForm.manufacturer.trim(),
        part_number: labelForm.part_number.trim(),
        description: labelForm.description.trim(),
        stock_quantity: labelForm.stock_quantity ? Number(labelForm.stock_quantity) : 0,
        bin_location: labelForm.bin_location.trim(),
        image_url: labelForm.image_url.trim(),
        notes: labelForm.notes.trim(),
        default_copies: labelForm.default_copies ? Number(labelForm.default_copies) : 1,
        manufacturer_right: labelForm.manufacturer_right.trim(),
        part_number_right: labelForm.part_number_right.trim(),
        description_right: labelForm.description_right.trim(),
        stock_quantity_right: labelForm.stock_quantity_right
          ? Number(labelForm.stock_quantity_right)
          : 0,
        bin_location_right: labelForm.bin_location_right.trim(),
        image_url_right: labelForm.image_url_right.trim(),
        notes_right: labelForm.notes_right.trim(),
      };

      if (imageFileLeft) {
        const upload = await uploadImage(imageFileLeft);
        payload.image_url = upload.path || upload.url || payload.image_url;
      }
      if (imageFileRight) {
        const upload = await uploadImage(imageFileRight);
        payload.image_url_right = upload.path || upload.url || payload.image_url_right;
      }

      const method = editingLabelId ? 'PUT' : 'POST';
      const path = editingLabelId ? `/api/labels/${editingLabelId}` : '/api/labels';
      await fetchJson(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      setMessage(editingLabelId ? 'Label updated.' : 'Label created.');
      await loadAll();
      resetLabelForm();
    } catch (submitError) {
      console.error(submitError);
      setError(submitError.message || 'Failed to save label');
    } finally {
      setSubmittingLabel(false);
    }
  }

  function editLabel(label) {
    setActiveTab('new-label');
    setEditingLabelId(label.id);
    setLabelForm({
      template_id: String(label.template_id ?? ''),
      default_copies: label.default_copies ?? 1,
      manufacturer: label.manufacturer ?? '',
      part_number: label.part_number ?? '',
      description: label.description ?? '',
      stock_quantity: label.stock_quantity ?? '',
      bin_location: label.bin_location ?? '',
      image_url: label.image_url ?? '',
      notes: label.notes ?? '',
      manufacturer_right: label.manufacturer_right ?? '',
      part_number_right: label.part_number_right ?? '',
      description_right: label.description_right ?? '',
      stock_quantity_right: label.stock_quantity_right ?? '',
      bin_location_right: label.bin_location_right ?? '',
      image_url_right: label.image_url_right ?? '',
      notes_right: label.notes_right ?? '',
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
    try {
      await fetchJson(`/api/labels/${labelId}`, { method: 'DELETE' });
      setMessage('Label deleted.');
      await loadAll();
      if (editingLabelId === labelId) {
        resetLabelForm();
      }
    } catch (deleteError) {
      console.error(deleteError);
      setError(deleteError.message || 'Failed to delete label');
    }
  }

  function toggleLabelSelection(label) {
    setPrintSelection((selection) => {
      const current = selection[label.id];
      if (current?.selected) {
        const { [label.id]: _removed, ...rest } = selection;
        return rest;
      }
      return {
        ...selection,
        [label.id]: {
          selected: true,
          copies: current?.copies || label.default_copies || 1,
        },
      };
    });
  }

  function updateLabelCopies(labelId, value) {
    const numeric = Math.max(1, Number(value) || 1);
    setPrintSelection((selection) => {
      const current = selection[labelId];
      if (!current?.selected) {
        return selection;
      }
      return {
        ...selection,
        [labelId]: {
          ...current,
          copies: numeric,
        },
      };
    });
  }
  async function downloadPdf() {
    if (!queueItems.length) {
      return;
    }
    setDownloadingPdf(true);
    setError('');
    try {
      const payload = {
        items: queueItems.map(({ label, copies }) => ({
          label_id: label.id,
          copies,
        })),
      };
      const response = await fetch(`${API_BASE}/api/labels/print`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        let messageText = 'Failed to generate PDF';
        try {
          const data = await response.json();
          if (data?.error) {
            messageText = data.error;
          }
        } catch (parseError) {
          // ignore parse errors
        }
        throw new Error(messageText);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'labels.pdf';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setMessage('PDF downloaded.');
    } catch (downloadError) {
      console.error(downloadError);
      setError(downloadError.message || 'Failed to download PDF');
    } finally {
      setDownloadingPdf(false);
    }
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

      <nav className="tab-bar">
        {[
          { key: 'new-label', label: 'New label' },
          { key: 'templates', label: 'Templates' },
          { key: 'print-queue', label: 'Print queue' },
        ].map((tab) => {
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
        })}
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
            {descriptionEnabled && (
              <label>
                {`Description${leftSideSuffix}`}
                <input name="description" value={labelForm.description} onChange={handleLabelChange} />
              </label>
            )}
            <label className="full">
              {`Notes${leftSideSuffix}`}
              <textarea name="notes" value={labelForm.notes} onChange={handleLabelChange} rows={3} />
            </label>
            {requiresDualParts && (
              <>
                <div className="form-divider">Right side details</div>
                <label>
                  Manufacturer (right)
                  <input
                    name="manufacturer_right"
                    value={labelForm.manufacturer_right}
                    onChange={handleLabelChange}
                    required
                  />
                </label>
                <label>
                  Part number (right)
                  <input
                    name="part_number_right"
                    value={labelForm.part_number_right}
                    onChange={handleLabelChange}
                    required
                  />
                </label>
                <label>
                  Quantity on hand (right)
                  <input
                    name="stock_quantity_right"
                    type="number"
                    min="0"
                    value={labelForm.stock_quantity_right}
                    onChange={handleLabelChange}
                  />
                </label>
                <label>
                  Bin location (right)
                  <input name="bin_location_right" value={labelForm.bin_location_right} onChange={handleLabelChange} />
                </label>
                <label>
                  Image URL (right)
                  <input name="image_url_right" value={labelForm.image_url_right} onChange={handleLabelChange} />
                </label>
                <label>
                  Upload image (right)
                  <input
                    type="file"
                    accept="image/*"
                    ref={rightImageInputRef}
                    onChange={(event) =>
                      handleImageFileChange(
                        'right',
                        event.target.files && event.target.files[0] ? event.target.files[0] : null,
                      )
                    }
                  />
                  <span className="form-subtext">
                    {imageFileRight
                      ? `Selected file: ${imageFileRight.name}`
                      : labelForm.image_url_right
                      ? 'Existing image will be reused unless you pick a new file.'
                      : 'Upload an image for the right side or provide a URL.'}
                  </span>
                </label>
                {descriptionEnabled && (
                  <label>
                    Description (right)
                    <input name="description_right" value={labelForm.description_right} onChange={handleLabelChange} />
                  </label>
                )}
                <label className="full">
                  Notes (right)
                  <textarea
                    name="notes_right"
                    value={labelForm.notes_right}
                    onChange={handleLabelChange}
                    rows={3}
                  />
                </label>
              </>
            )}
            <button type="submit" className="primary" disabled={submittingLabel}>
              {submittingLabel ? 'Saving…' : editingLabelId ? 'Update label' : 'Create label'}
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
                fieldFormats={templateFieldFormats}
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

            <button type="submit" className="primary" disabled={submittingTemplate}>
              {submittingTemplate ? 'Saving…' : editingTemplateId ? 'Update template' : 'Create template'}
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
          <button type="button" className="primary" onClick={downloadPdf} disabled={!selectedLabels.length || downloadingPdf}>
            {downloadingPdf ? 'Preparing…' : 'Download selected as PDF'}
          </button>
        </section>
      )}
    </div>
  );
}

export default App;
