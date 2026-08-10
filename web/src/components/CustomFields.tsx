import { useState } from 'react';
import { api } from '../api';
import type { CustomField } from '../types';

interface Props {
  serverId: number;
  initialFields: CustomField[];
}

/**
 * Editor for a server's custom embed fields — shown on the dashboard card
 * and appended to the Discord status embed. "message" is a plain text line;
 * "link" renders as a single-line markdown link (title + URL).
 */
export default function CustomFields({ serverId, initialFields }: Props) {
  const [fields, setFields] = useState<CustomField[]>(initialFields);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const addField = () => {
    setFields([...fields, { type: 'message', title: '', content: '' }]);
  };

  const updateField = (i: number, patch: Partial<CustomField>) => {
    setFields(fields.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  };

  const removeField = (i: number) => {
    setFields(fields.filter((_, idx) => idx !== i));
  };

  const save = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const r = await api.setCustomFields(serverId, fields.filter((f) => f.content.trim()));
      setFields(r.fields);
      setNotice('✅ Saved');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h2>Custom Embed Fields</h2>
      <p className="hint">
        Extra lines shown on the dashboard card and in the Discord status embed — e.g. a download link for a
        config file, or a note for players. A message is plain text; a link shows its title as a clickable line.
      </p>
      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-ok">{notice}</div>}

      {fields.length === 0 && <p className="muted">No custom fields yet.</p>}
      {fields.map((f, i) => (
        <div key={i} className="custom-field-row">
          <select value={f.type} onChange={(e) => updateField(i, { type: e.target.value as CustomField['type'] })}>
            <option value="message">Message</option>
            <option value="link">Link</option>
          </select>
          {f.type === 'link' ? (
            <>
              <input
                value={f.title}
                onChange={(e) => updateField(i, { title: e.target.value })}
                placeholder="Link title (e.g. Download Realmlist)"
              />
              <input
                value={f.content}
                onChange={(e) => updateField(i, { content: e.target.value })}
                placeholder="https://…"
              />
            </>
          ) : (
            <input
              value={f.content}
              onChange={(e) => updateField(i, { content: e.target.value })}
              placeholder="Message text"
              className="span-2"
            />
          )}
          <button type="button" className="btn btn-small btn-danger-outline" onClick={() => removeField(i)}>
            Remove
          </button>
        </div>
      ))}

      <div className="btn-row" style={{ marginTop: 10 }}>
        <button type="button" className="btn" onClick={addField}>+ Add field</button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>
          {busy ? 'Saving…' : 'Save fields'}
        </button>
      </div>
    </div>
  );
}
