import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { supabase } from '../supabase.js';
import { freshness, FRESHNESS_LABEL, mph, timeAgo, LOAD_STATUS_LABEL } from '../lib/format.js';

const TRAIL_HOURS = 12;

function truckIcon(state, label, heading) {
  const arrow = heading != null && heading >= 0
    ? `<span class="pin-arrow" style="transform: rotate(${Math.round(heading)}deg)">▲</span>`
    : '';
  return L.divIcon({
    className: '',
    html: `<div class="pin pin-${state}">${arrow}<span class="pin-label">${label}</span></div>`,
    iconSize: [0, 0],
  });
}

export default function LiveMap({ drivers, locations, loads }) {
  const mapEl = useRef(null);
  const map = useRef(null);
  const markers = useRef({});
  const trail = useRef(null);
  const fitted = useRef(false);
  const [selected, setSelected] = useState(null);
  const [now, setNow] = useState(Date.now());

  // Re-render "x min ago" labels and colors every 15 s.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);

  const driverList = useMemo(() => drivers.filter((d) => d.role === 'driver' && d.active), [drivers]);

  const activeLoadByDriver = useMemo(() => {
    const m = {};
    for (const l of loads) {
      if (!l.driver_id || !['assigned', 'in_transit'].includes(l.status)) continue;
      if (!m[l.driver_id] || l.status === 'in_transit') m[l.driver_id] = l;
    }
    return m;
  }, [loads]);

  useEffect(() => {
    map.current = L.map(mapEl.current, { zoomControl: true }).setView([39.5, -98.35], 4);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map.current);
    return () => { map.current.remove(); map.current = null; markers.current = {}; fitted.current = false; };
  }, []);

  // Keep one marker per driver in sync with the latest location.
  useEffect(() => {
    if (!map.current) return;
    const seen = new Set();
    for (const d of driverList) {
      const loc = locations[d.id];
      if (!loc) continue;
      seen.add(d.id);
      const label = d.truck_number ? `#${d.truck_number}` : (d.full_name || 'Driver').split(' ')[0];
      const icon = truckIcon(freshness(loc, now), label, loc.speed_mps > 1 ? loc.heading : null);
      let m = markers.current[d.id];
      if (!m) {
        m = L.marker([loc.lat, loc.lng], { icon }).addTo(map.current);
        m.on('click', () => setSelected(d.id));
        markers.current[d.id] = m;
      } else {
        m.setLatLng([loc.lat, loc.lng]);
        m.setIcon(icon);
      }
      m.bindTooltip(`${d.full_name || 'Driver'} — ${timeAgo(loc.recorded_at, now)}`);
    }
    for (const id of Object.keys(markers.current)) {
      if (!seen.has(id)) { markers.current[id].remove(); delete markers.current[id]; }
    }
    // First time we have positions, zoom to show every truck.
    const pts = Object.values(markers.current).map((m) => m.getLatLng());
    if (!fitted.current && pts.length) {
      map.current.fitBounds(L.latLngBounds(pts).pad(0.3), { maxZoom: 10 });
      fitted.current = true;
    }
  }, [driverList, locations, now]);

  // Trail for the selected driver.
  useEffect(() => {
    if (trail.current) { trail.current.remove(); trail.current = null; }
    if (!selected || !map.current) return;
    let cancelled = false;
    const since = new Date(Date.now() - TRAIL_HOURS * 3600 * 1000).toISOString();
    supabase
      .from('location_history')
      .select('lat,lng,recorded_at')
      .eq('driver_id', selected)
      .gte('recorded_at', since)
      .order('recorded_at')
      .limit(5000)
      .then(({ data }) => {
        if (cancelled || !data?.length || !map.current) return;
        trail.current = L.polyline(data.map((p) => [p.lat, p.lng]), { color: '#2563eb', weight: 4, opacity: 0.6 }).addTo(map.current);
      });
    const loc = locations[selected];
    if (loc) map.current.setView([loc.lat, loc.lng], Math.max(map.current.getZoom(), 9));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const counts = useMemo(() => {
    const c = { live: 0, recent: 0, stale: 0, off: 0, none: 0 };
    for (const d of driverList) c[freshness(locations[d.id], now)]++;
    return c;
  }, [driverList, locations, now]);

  return (
    <div className="map-layout">
      <aside className="map-side">
        <div className="side-summary">
          <span className="dot dot-live" /> {counts.live} live
          <span className="dot dot-recent" /> {counts.recent} delayed
          <span className="dot dot-stale" /> {counts.stale + counts.off + counts.none} offline
        </div>
        {driverList.length === 0 && (
          <p className="muted pad">No drivers yet. Drivers appear here once they sign up in the HS Driver app.</p>
        )}
        <ul className="driver-list">
          {driverList.map((d) => {
            const loc = locations[d.id];
            const state = freshness(loc, now);
            const load = activeLoadByDriver[d.id];
            const next = load?.stops.find((s) => s.status !== 'departed');
            const speed = loc ? mph(loc.speed_mps) : null;
            return (
              <li key={d.id} className={selected === d.id ? 'driver selected' : 'driver'} onClick={() => setSelected(selected === d.id ? null : d.id)}>
                <div className="driver-top">
                  <span className={`dot dot-${state}`} />
                  <strong>{d.full_name || 'Unnamed driver'}</strong>
                  {d.truck_number && <span className="muted"> · Truck {d.truck_number}</span>}
                </div>
                <div className="driver-meta">
                  {FRESHNESS_LABEL[state]}{loc && ` · ${timeAgo(loc.recorded_at, now)}`}
                  {speed != null && state === 'live' && ` · ${speed} mph`}
                  {loc?.battery != null && ` · 🔋${Math.round(loc.battery * 100)}%`}
                </div>
                {load ? (
                  <div className="driver-load">
                    Load {load.load_number || '—'} · {LOAD_STATUS_LABEL[load.status]}
                    {next && <div className="muted">Next: {next.type === 'pickup' ? 'PU' : 'DEL'} {next.facility_name || next.address} {next.appointment && `· ${next.appointment}`}</div>}
                  </div>
                ) : (
                  <div className="driver-load muted">No active load</div>
                )}
              </li>
            );
          })}
        </ul>
        {selected && <p className="muted pad small">Blue line = last {TRAIL_HOURS} hours of travel.</p>}
      </aside>
      <div ref={mapEl} className="map" />
    </div>
  );
}
