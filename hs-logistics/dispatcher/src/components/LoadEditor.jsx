import { useState } from 'react';
import { supabase } from '../supabase.js';
import { pdfToLines } from '../lib/pdfText.js';
import { parseRateCon } from '../lib/rateconParser.js';

const blankStop = (type) => ({
  id: crypto.randomUUID(),
  type,
  facility_name: '',
  address: '',
  appointment: '',
  pickup_number: '',
  status: 'pending',
});

export default function LoadEditor({ load, drivers, onClose }) {
  const isNew = !load;
  const [form, setForm] = useState(() => ({
    load_number: load?.load_number ?? '',
    broker_name: load?.broker_name ?? '',
    driver_id: load?.driver_id ?? '',
    driver_notes: load?.driver_notes ?? '',
    status: load?.status ?? 'assigned',
  }));
  const [stops, setStops] = useState(() =>
    load?.stops?.length ? load.stops.map((s) => ({ ...s })) : [blankStop('pickup'), blankStop('delivery')],
  );
  const [parseNote, setParseNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const activeDrivers = drivers.filter((d) => d.role === 'driver' && d.active);

  async function onPdf(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setError('');
    setParseNote('');
    try {
      const lines = await pdfToLines(file);
      if (!lines.join('').trim()) {
        setParseNote('This PDF has no readable text (it is probably a scanned image). Please type the stops in below.');
        return;
      }
      const r = parseRateCon(lines);
      setForm((f) => ({
        ...f,
        load_number: r.loadNumber || f.load_number,
        broker_name: r.brokerName || f.broker_name,
      }));
      if (r.stops.length) {
        setStops(r.stops.map((s) => ({ ...blankStop(s.type), ...s })));
        setParseNote(`Found ${r.stops.filter((s) => s.type === 'pickup').length} pickup(s) and ${r.stops.filter((s) => s.type === 'delivery').length} delivery(ies) in “${file.name}”. Check every field before saving — the rate was not read or saved.`);
      } else {
        setParseNote(`Couldn't find stops in “${file.name}”. This broker's layout isn't recognised yet — please type the stops in below.`);
      }
    } catch (err) {
      setError(`Could not read PDF: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  const setStop = (i, patch) => setStops((all) => all.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i, dir) => setStops((all) => {
    const j = i + dir;
    if (j < 0 || j >= all.length) return all;
    const copy = [...all];
    [copy[i], copy[j]] = [copy[j], copy[i]];
    return copy;
  });
  const remove = (i) => setStops((all) => all.filter((_, j) => j !== i));

  async function save(asDraft) {
    setError('');
    if (!stops.length) return setError('Add at least one stop.');
    if (stops.some((s) => !s.address.trim())) return setError('Every stop needs an address.');
    if (stops.some((s) => /\$\s?\d/.test(Object.values(s).join(' '))) || /\$\s?\d/.test(form.driver_notes)) {
      return setError('Remove dollar amounts — drivers must not see the rate.');
    }
    const status = asDraft ? 'draft' : form.status === 'draft' ? 'assigned' : form.status;
    if (!asDraft && !form.driver_id) return setError('Pick a driver, or save as draft.');

    setBusy(true);
    try {
      const row = {
        load_number: form.load_number.trim() || null,
        broker_name: form.broker_name.trim() || null,
        driver_id: form.driver_id || null,
        driver_notes: form.driver_notes.trim() || null,
        status,
      };
      let loadId = load?.id;
      if (isNew) {
        const { data, error } = await supabase.from('loads').insert(row).select('id').single();
        if (error) throw error;
        loadId = data.id;
      } else {
        const { error } = await supabase.from('loads').update(row).eq('id', loadId);
        if (error) throw error;
      }

      const keep = stops.map((s, i) => ({
        id: s.id,
        load_id: loadId,
        seq: i + 1,
        type: s.type,
        facility_name: s.facility_name.trim() || null,
        address: s.address.trim(),
        appointment: s.appointment.trim() || null,
        pickup_number: s.pickup_number.trim() || null,
        status: s.status || 'pending',
      }));
      if (!isNew) {
        const removed = (load.stops || []).map((s) => s.id).filter((id) => !keep.some((k) => k.id === id));
        if (removed.length) {
          const { error } = await supabase.from('stops').delete().in('id', removed);
          if (error) throw error;
        }
      }
      const { error } = await supabase.from('stops').upsert(keep);
      if (error) throw error;
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page editor">
      <div className="page-head">
        <h2>{isNew ? 'New load' : `Edit load ${load.load_number || ''}`}</h2>
        <button onClick={onClose}>← Back</button>
      </div>

      <section className="upload">
        <label className="upload-btn">
          {busy ? 'Reading…' : '📄 Upload rate confirmation (PDF)'}
          <input type="file" accept="application/pdf" onChange={onPdf} disabled={busy} hidden />
        </label>
        <p className="muted small">The PDF is read on this computer only. It is not uploaded and the rate is never saved. Drivers see only stops, appointment times and PU numbers.</p>
        {parseNote && <div className="note">{parseNote}</div>}
      </section>

      <section className="grid2">
        <label>Load #<input value={form.load_number} onChange={(e) => setForm({ ...form, load_number: e.target.value })} /></label>
        <label>Broker<input value={form.broker_name} onChange={(e) => setForm({ ...form, broker_name: e.target.value })} /></label>
        <label>Driver
          <select value={form.driver_id} onChange={(e) => setForm({ ...form, driver_id: e.target.value })}>
            <option value="">— Choose driver —</option>
            {activeDrivers.map((d) => <option key={d.id} value={d.id}>{d.full_name || 'Unnamed'}{d.truck_number ? ` (Truck ${d.truck_number})` : ''}</option>)}
          </select>
        </label>
        <label>Notes for driver (no rates)
          <input value={form.driver_notes} onChange={(e) => setForm({ ...form, driver_notes: e.target.value })} placeholder="e.g. 2 load bars, call 1 hr out" />
        </label>
      </section>

      <h3>Stops</h3>
      {stops.map((s, i) => (
        <div key={s.id} className={`stop-edit stop-${s.type}`}>
          <div className="stop-edit-head">
            <strong>Stop {i + 1}</strong>
            <select value={s.type} onChange={(e) => setStop(i, { type: e.target.value })}>
              <option value="pickup">Pickup</option>
              <option value="delivery">Delivery</option>
            </select>
            <span className="spacer" />
            <button onClick={() => move(i, -1)} disabled={i === 0} title="Move up">↑</button>
            <button onClick={() => move(i, 1)} disabled={i === stops.length - 1} title="Move down">↓</button>
            <button className="danger" onClick={() => remove(i)} title="Remove stop">✕</button>
          </div>
          <div className="grid2">
            <label>Facility / company<input value={s.facility_name} onChange={(e) => setStop(i, { facility_name: e.target.value })} /></label>
            <label>Address<input value={s.address} onChange={(e) => setStop(i, { address: e.target.value })} placeholder="Street, City, ST ZIP" /></label>
            <label>Appointment<input value={s.appointment} onChange={(e) => setStop(i, { appointment: e.target.value })} placeholder="11/12/2026 08:00-10:00 or FCFS" /></label>
            <label>{s.type === 'pickup' ? 'PU # / reference #s' : 'Delivery # / PO #s'}<input value={s.pickup_number} onChange={(e) => setStop(i, { pickup_number: e.target.value })} /></label>
          </div>
        </div>
      ))}
      <div className="row">
        <button onClick={() => setStops([...stops, blankStop('pickup')])}>+ Pickup</button>
        <button onClick={() => setStops([...stops, blankStop('delivery')])}>+ Delivery</button>
      </div>

      {error && <div className="error">{error}</div>}
      <div className="row end">
        <button onClick={() => save(true)} disabled={busy}>Save as draft</button>
        <button className="primary" onClick={() => save(false)} disabled={busy}>{isNew ? 'Save & send to driver' : 'Save'}</button>
      </div>
    </div>
  );
}
