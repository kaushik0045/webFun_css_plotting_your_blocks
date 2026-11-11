import { useCallback, useEffect, useState } from 'react';
import { supabase, configured } from './supabase.js';
import Login from './components/Login.jsx';
import LiveMap from './components/LiveMap.jsx';
import Loads from './components/Loads.jsx';
import Drivers from './components/Drivers.jsx';

const TABS = [
  { id: 'map', label: 'Live map' },
  { id: 'loads', label: 'Loads' },
  { id: 'drivers', label: 'Drivers' },
];

export default function App() {
  const [session, setSession] = useState(undefined);
  const [me, setMe] = useState(null);
  const [tab, setTab] = useState('map');

  useEffect(() => {
    if (!configured) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setMe(null); return; }
    supabase.from('profiles').select('*').eq('id', session.user.id).single()
      .then(({ data }) => setMe(data ?? { role: 'unknown' }));
  }, [session]);

  if (!configured) {
    return (
      <div className="center-card">
        <h1>HS Logistics Dispatch</h1>
        <p>Supabase is not connected yet. Copy <code>.env.example</code> to <code>.env</code>, fill in your project URL and anon key, then restart <code>npm run dev</code>.</p>
      </div>
    );
  }
  if (session === undefined) return <div className="center-card">Loading…</div>;
  if (!session) return <Login />;
  if (!me) return <div className="center-card">Loading…</div>;
  if (me.role !== 'dispatcher') {
    return (
      <div className="center-card">
        <h1>No dispatcher access</h1>
        <p>This account is set up as a driver. Ask the owner to make it a dispatcher (see the README), then sign in again.</p>
        <button onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>
    );
  }

  return <Dashboard tab={tab} setTab={setTab} me={me} />;
}

function Dashboard({ tab, setTab, me }) {
  const data = useDispatchData();
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">HS Logistics</div>
        <nav>
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? 'tab active' : 'tab'} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="who">
          <span>{me.full_name || 'Dispatcher'}</span>
          <button className="link" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </header>
      <main className={tab === 'map' ? 'main main-map' : 'main'}>
        {data.error && <div className="error">{data.error}</div>}
        {tab === 'map' && <LiveMap {...data} />}
        {tab === 'loads' && <Loads {...data} />}
        {tab === 'drivers' && <Drivers {...data} />}
      </main>
    </div>
  );
}

// Loads everything the dashboard needs and keeps it live with Supabase Realtime.
function useDispatchData() {
  const [drivers, setDrivers] = useState([]);
  const [locations, setLocations] = useState({});
  const [loads, setLoads] = useState([]);
  const [error, setError] = useState('');

  const reloadDrivers = useCallback(async () => {
    const { data, error } = await supabase.from('profiles').select('*').order('full_name');
    if (error) setError(error.message); else setDrivers(data);
  }, []);

  const reloadLoads = useCallback(async () => {
    const { data, error } = await supabase
      .from('loads')
      .select('*, stops(*)')
      .order('created_at', { ascending: false })
      .limit(300);
    if (error) { setError(error.message); return; }
    for (const l of data) l.stops.sort((a, b) => a.seq - b.seq);
    setLoads(data);
  }, []);

  const reloadLocations = useCallback(async () => {
    const { data, error } = await supabase.from('driver_locations').select('*');
    if (error) { setError(error.message); return; }
    setLocations(Object.fromEntries(data.map((l) => [l.driver_id, l])));
  }, []);

  useEffect(() => {
    reloadDrivers();
    reloadLoads();
    reloadLocations();

    const channel = supabase
      .channel('dispatch')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_locations' }, (p) => {
        if (p.eventType === 'DELETE') return;
        setLocations((prev) => ({ ...prev, [p.new.driver_id]: p.new }));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'loads' }, () => reloadLoads())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stops' }, () => reloadLoads())
      .subscribe();

    // Safety net in case the realtime socket drops (laptop sleep, Wi-Fi change).
    const poll = setInterval(reloadLocations, 60000);
    return () => { clearInterval(poll); supabase.removeChannel(channel); };
  }, [reloadDrivers, reloadLoads, reloadLocations]);

  return { drivers, locations, loads, error, reloadDrivers, reloadLoads };
}
