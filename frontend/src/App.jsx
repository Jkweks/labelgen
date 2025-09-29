import { useEffect, useMemo, useState } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5000';

const emptyTemplateForm = {
  name: '',
  description: '',
  image_position: 'left',
  accent_color: '#0a3d62',
  text_align: 'left',
  include_description: true,
};

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
};

function App() {
  const [templates, setTemplates] = useState([]);
  const [labels, setLabels] = useState([]);
  const [templateForm, setTemplateForm] = useState(emptyTemplateForm);
  const [labelForm, setLabelForm] = useState(emptyLabelForm);
  const [editingTemplateId, setEditingTemplateId] = useState(null);
  const [editingLabelId, setEditingLabelId] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [printSelection, setPrintSelection] = useState({});

  const selectedLabels = useMemo(
    () =>
      Object.entries(printSelection)
        .filter(([, value]) => value?.selected)
        .map(([id, value]) => ({ id: Number(id), copies: value.copies || 1 })),
    [printSelection],
  );

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
    setTemplates(data);
  }

  async function loadLabels() {
    const response = await fetch(`${API_BASE}/api/labels`);
    if (!response.ok) {
      throw new Error('Failed to load labels');
    }
    const data = await response.json();
    setLabels(data);
  }

  function resetTemplateForm() {
    setTemplateForm(emptyTemplateForm);
    setEditingTemplateId(null);
  }

  function resetLabelForm() {
    setLabelForm(emptyLabelForm);
    setEditingLabelId(null);
  }

  function handleTemplateChange(event) {
    const { name, value, type, checked } = event.target;
    setTemplateForm((form) => ({
      ...form,
      [name]: type === 'checkbox' ? checked : value,
    }));
  }

  function handleLabelChange(event) {
    const { name, value } = event.target;
    setLabelForm((form) => ({
      ...form,
      [name]: name === 'stock_quantity' || name === 'default_copies' ? Number(value) : value,
    }));
  }

  async function submitTemplate(event) {
    event.preventDefault();
    setError('');
    const method = editingTemplateId ? 'PUT' : 'POST';
    const url = editingTemplateId
      ? `${API_BASE}/api/templates/${editingTemplateId}`
      : `${API_BASE}/api/templates`;

    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(templateForm),
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

    const payload = {
      ...labelForm,
      template_id: Number(labelForm.template_id),
    };

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
    });
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
          <label className="checkbox">
            <input
              type="checkbox"
              name="include_description"
              checked={templateForm.include_description}
              onChange={handleTemplateChange}
            />
            Include description on labels
          </label>
          <button type="submit" className="primary">
            {editingTemplateId ? 'Update template' : 'Create template'}
          </button>
        </form>

        <h3>Templates</h3>
        <div className="table">
          <div className="table-row table-head">
            <span>Name</span>
            <span>Accent</span>
            <span>Image</span>
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
              <span>{template.image_position}</span>
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
            Manufacturer
            <input name="manufacturer" value={labelForm.manufacturer} onChange={handleLabelChange} required />
          </label>
          <label>
            Part number
            <input name="part_number" value={labelForm.part_number} onChange={handleLabelChange} required />
          </label>
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
            Quantity on hand
            <input
              name="stock_quantity"
              type="number"
              min="0"
              value={labelForm.stock_quantity}
              onChange={handleLabelChange}
            />
          </label>
          <label>
            Bin location
            <input name="bin_location" value={labelForm.bin_location} onChange={handleLabelChange} />
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
          <label>
            Image URL
            <input name="image_url" value={labelForm.image_url} onChange={handleLabelChange} />
          </label>
          <label>
            Description
            <input name="description" value={labelForm.description} onChange={handleLabelChange} />
          </label>
          <label className="full">
            Notes
            <textarea name="notes" value={labelForm.notes} onChange={handleLabelChange} rows={3} />
          </label>
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
              <span>{label.manufacturer}</span>
              <span>{label.part_number}</span>
              <span>{label.template?.name || '—'}</span>
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
