import { useState } from 'react';
import { supabase } from '../supabase.js';
import { freshness, FRESHNESS_LABEL, timeAgo } from '../lib/format.js';

export default function Drivers({ drivers, locations, reloadDrivers }) {
  const [error, setError] = useState('');

  async function update(id, patch) {
    setError('');
    const { error } = await supabase.from('profiles').update(patch).eq('id', id);
    if (error) setError(error.message);
    reloadDrivers();
  }

  return (
    <div className="page">
      <div className="page-head"><h2>Drivers</h2></div>
      <div className="note">
        <strong>Adding a driver:</strong> have them install the <em>HS Driver</em> app and tap “Create account”.
        They show up here right away. Set their truck number, and switch off anyone who no longer drives for you.
      </div>
      {error && <div className="error">{error}</div>}
      <table className="table">
        <thead>
          <tr><th>Name</th><th>Phone</th><th>Truck #</th><th>Role</th><th>Location</th><th>Active</th></tr>
        </thead>
        <tbody>
          {drivers.map((d) => {
            const loc = locations[d.id];
            const state = freshness(loc);
            return (
              <tr key={d.id} className={d.active ? '' : 'inactive'}>
                <td><input defaultValue={d.full_name || ''} onBlur={(e) => e.target.value !== (d.full_name || '') && update(d.id, { full_name: e.target.value })} /></td>
                <td><input defaultValue={d.phone || ''} onBlur={(e) => e.target.value !== (d.phone || '') && update(d.id, { phone: e.target.value })} /></td>
                <td><input className="narrow" defaultValue={d.truck_number || ''} onBlur={(e) => e.target.value !== (d.truck_number || '') && update(d.id, { truck_number: e.target.value })} /></td>
                <td>
                  <select value={d.role} onChange={(e) => update(d.id, { role: e.target.value })}>
                    <option value="driver">Driver</option>
                    <option value="dispatcher">Dispatcher</option>
                  </select>
                </td>
                <td>{d.role === 'driver' ? <><span className={`dot dot-${state}`} /> {FRESHNESS_LABEL[state]}{loc && <span className="muted small"> · {timeAgo(loc.recorded_at)}</span>}</> : <span className="muted">—</span>}</td>
                <td><input type="checkbox" checked={d.active} onChange={(e) => update(d.id, { active: e.target.checked })} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
