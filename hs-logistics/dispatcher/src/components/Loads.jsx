import { useMemo, useState } from 'react';
import { supabase } from '../supabase.js';
import { LOAD_STATUS_LABEL } from '../lib/format.js';
import LoadEditor from './LoadEditor.jsx';

const FILTERS = [
  { id: 'active', label: 'Active', match: (l) => ['draft', 'assigned', 'in_transit'].includes(l.status) },
  { id: 'delivered', label: 'Delivered', match: (l) => l.status === 'delivered' },
  { id: 'all', label: 'All', match: () => true },
];

export default function Loads({ loads, drivers, reloadLoads }) {
  const [filter, setFilter] = useState('active');
  const [editing, setEditing] = useState(null); // null | 'new' | load object

  const driverName = useMemo(() => Object.fromEntries(drivers.map((d) => [d.id, d.full_name || 'Unnamed'])), [drivers]);
  const shown = loads.filter(FILTERS.find((f) => f.id === filter).match);

  if (editing) {
    return (
      <LoadEditor
        load={editing === 'new' ? null : editing}
        drivers={drivers}
        onClose={() => { setEditing(null); reloadLoads(); }}
      />
    );
  }

  async function setStatus(load, status) {
    if (status === 'cancelled' && !confirm('Cancel this load? The driver will no longer see it as active.')) return;
    await supabase.from('loads').update({ status }).eq('id', load.id);
    reloadLoads();
  }

  return (
    <div className="page">
      <div className="page-head">
        <h2>Loads</h2>
        <div className="seg">
          {FILTERS.map((f) => (
            <button key={f.id} className={filter === f.id ? 'active' : ''} onClick={() => setFilter(f.id)}>{f.label}</button>
          ))}
        </div>
        <button className="primary" onClick={() => setEditing('new')}>+ New load from rate con</button>
      </div>

      {shown.length === 0 && <p className="muted">No loads here yet.</p>}

      <div className="load-grid">
        {shown.map((l) => (
          <div key={l.id} className="load-card">
            <div className="load-card-head">
              <strong>Load {l.load_number || '—'}</strong>
              <span className={`badge badge-${l.status}`}>{LOAD_STATUS_LABEL[l.status]}</span>
            </div>
            <div className="muted small">{l.broker_name || 'Broker not set'} · Driver: {l.driver_id ? driverName[l.driver_id] : <em>unassigned</em>}</div>
            <ol className="stops">
              {l.stops.map((s) => (
                <li key={s.id} className={`stop stop-${s.type}`}>
                  <span className="stop-tag">{s.type === 'pickup' ? 'PU' : 'DEL'}</span>
                  <div>
                    <div>{s.facility_name || '—'} {s.status !== 'pending' && <span className="muted small">({s.status})</span>}</div>
                    <div className="muted small">{s.address}</div>
                    <div className="small">{s.appointment}{s.pickup_number && ` · ${s.pickup_number}`}</div>
                  </div>
                </li>
              ))}
            </ol>
            <div className="card-actions">
              <button onClick={() => setEditing(l)}>Edit</button>
              {l.status === 'draft' && <button onClick={() => setStatus(l, 'assigned')} disabled={!l.driver_id}>Send to driver</button>}
              {['assigned', 'in_transit'].includes(l.status) && <button onClick={() => setStatus(l, 'delivered')}>Mark delivered</button>}
              {l.status !== 'cancelled' && l.status !== 'delivered' && <button className="danger" onClick={() => setStatus(l, 'cancelled')}>Cancel</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
