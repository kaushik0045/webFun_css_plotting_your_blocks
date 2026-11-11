// Demo only: a phone-sized preview of the HS Driver app, sharing the demo data
// with the boss dashboard. Assign a load on the Loads tab and it shows up here;
// tap "I've arrived" here and the Loads tab updates.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabase.js';
import { mapsLink } from '../lib/format.js';

export default function DriverPreview({ drivers, locations }) {
  const list = drivers.filter((d) => d.role === 'driver' && d.active);
  const [driverId, setDriverId] = useState('d-raj');
  const me = list.find((d) => d.id === driverId) || list[0];
  const [loads, setLoads] = useState([]);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    if (!me) return;
    const { data } = await supabase.from('loads').select('*, stops(*)').eq('driver_id', me.id).in('status', ['assigned', 'in_transit']).order('created_at', { ascending: true });
    for (const l of data || []) l.stops.sort((a, b) => a.seq - b.seq);
    setLoads(data || []);
  }, [me]);

  useEffect(() => {
    load();
    const ch = supabase.channel('driver-preview')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'loads' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stops' }, load)
      .subscribe();
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => { supabase.removeChannel(ch); clearInterval(t); };
  }, [load]);

  async function mark(l, stop, status) {
    const patch = status === 'arrived' ? { status, arrived_at: new Date().toISOString() } : { status, departed_at: new Date().toISOString() };
    await supabase.from('stops').update(patch).eq('id', stop.id);
    const isLast = l.stops[l.stops.length - 1].id === stop.id;
    const next = status === 'departed' && isLast ? 'delivered' : 'in_transit';
    if (next !== l.status) await supabase.from('loads').update({ status: next }).eq('id', l.id);
    load();
  }

  if (!me) return <div className="page"><p className="muted">No active drivers.</p></div>;
  const loc = locations[me.id];
  const tracking = loc && loc.tracking_on !== false && now - new Date(loc.recorded_at).getTime() < 5 * 60000;
  const secs = loc ? Math.max(0, Math.round((now - new Date(loc.recorded_at).getTime()) / 1000)) : null;

  return (
    <div className="page driver-preview">
      <div className="dp-side">
        <h2>Driver phone preview</h2>
        <p className="muted">This is what a driver sees in the HS Driver app. The real app runs on the phone and sends GPS in the background.</p>
        <label>Pretend to be
          <select value={me.id} onChange={(e) => setDriverId(e.target.value)}>
            {list.map((d) => <option key={d.id} value={d.id}>{d.full_name}{d.truck_number ? ` (Truck ${d.truck_number})` : ''}</option>)}
          </select>
        </label>
        <div className="note">
          <strong>Try this:</strong>
          <ol>
            <li>Tap <em>I’ve arrived</em> on the phone, then open <em>Loads</em>: the stop shows “arrived”.</li>
            <li>On <em>Loads</em>, assign draft load CH-90311 to this driver and send it: it appears here instantly.</li>
            <li>Notice the phone never shows the rate.</li>
          </ol>
        </div>
      </div>

      <div className="phone">
        <div className="phone-notch" />
        <div className="phone-screen">
          <div className="ph-header">
            <div>
              <div className="ph-title">HS Logistics</div>
              <div className="ph-sub">{me.full_name}{me.truck_number ? ` · Truck ${me.truck_number}` : ''}</div>
            </div>
            <span className="ph-link">Sign out</span>
          </div>
          <div className="ph-body">
            {tracking ? (
              <div className="ph-card ph-ok">
                <div className="ph-h2" style={{ color: '#16A34A' }}>● Location sharing ON</div>
                <div className="ph-muted">Last sent {secs < 5 ? 'just now' : `${secs}s ago`}.</div>
              </div>
            ) : (
              <div className="ph-card ph-bad">
                <div className="ph-h2" style={{ color: '#DC2626' }}>Location sharing OFF</div>
                <div className="ph-muted">{loc?.tracking_on === false ? 'Signed out — dispatch can’t see you.' : 'No signal. Points are saved and sent when coverage returns.'}</div>
                <button className="ph-btn" style={{ background: '#DC2626' }}>Turn on location sharing</button>
              </div>
            )}

            {loads.length === 0 && (
              <div className="ph-card"><div className="ph-h2">No load assigned</div><div className="ph-muted">New loads from dispatch show up here automatically.</div></div>
            )}

            {loads.map((l) => {
              const nextIdx = l.stops.findIndex((s) => s.status !== 'departed');
              return (
                <div key={l.id} className="ph-card">
                  <div className="ph-row">
                    <div className="ph-h2">Load {l.load_number || ''}</div>
                    <span className={l.status === 'in_transit' ? 'ph-badge ph-badge-go' : 'ph-badge'}>{l.status === 'in_transit' ? 'In transit' : 'Assigned'}</span>
                  </div>
                  {l.driver_notes && <div className="ph-notes">📝 {l.driver_notes}</div>}
                  {l.stops.map((s, i) => {
                    const color = s.type === 'pickup' ? '#0E7490' : '#7C3AED';
                    return (
                      <div key={s.id} className="ph-stop" style={{ borderLeftColor: color, opacity: s.status === 'departed' ? 0.5 : 1 }}>
                        <div className="ph-stop-type" style={{ color }}>{s.type === 'pickup' ? 'PICKUP' : 'DELIVERY'} {i + 1}{s.status !== 'pending' ? ` · ${s.status.toUpperCase()}` : ''}</div>
                        {s.facility_name && <div className="ph-stop-name">{s.facility_name}</div>}
                        <a className="ph-address" href={mapsLink(s.address)} target="_blank" rel="noreferrer">{s.address}<div className="ph-nav">Navigate ›</div></a>
                        {s.appointment && <div className="ph-info"><span>Appointment</span><b>{s.appointment}</b></div>}
                        {s.pickup_number && <div className="ph-info"><span>{s.type === 'pickup' ? 'PU #' : 'Ref #'}</span><b className="ph-big">{s.pickup_number}</b></div>}
                        {i === nextIdx && s.status === 'pending' && <button className="ph-btn" style={{ background: color }} onClick={() => mark(l, s, 'arrived')}>I’ve arrived</button>}
                        {i === nextIdx && s.status === 'arrived' && <button className="ph-btn" style={{ background: color }} onClick={() => mark(l, s, 'departed')}>{s.type === 'pickup' ? 'Loaded — leaving' : 'Unloaded — leaving'}</button>}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
