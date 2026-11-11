// Demo mode: an in-browser stand-in for Supabase with sample drivers and loads.
// Trucks drive along real interstate routes so the live map can be tried
// without setting anything up. Nothing is saved — a page reload starts over.

const MIN = 60000;
const now = () => Date.now();
const iso = (t) => new Date(t).toISOString();
const uid = () => crypto.randomUUID();

// Waypoints [lat, lng] roughly along the interstates.
const ROUTES = {
  fresnoPhoenix: [[36.74, -119.79], [35.37, -119.02], [34.90, -117.02], [34.85, -114.60], [34.48, -114.32], [33.45, -112.07]],
  dallasAtlanta: [[32.78, -96.80], [32.50, -93.75], [32.30, -90.18], [33.52, -86.80], [33.75, -84.39]],
  chicagoIndy: [[41.88, -87.63], [41.59, -87.35], [40.42, -86.89], [39.77, -86.16]],
  memphisNashville: [[35.15, -90.05], [35.61, -88.81], [36.16, -86.78]],
};

const DISPATCHER = 'demo-dispatcher';

function km(a, b) {
  const R = 6371, r = (d) => (d * Math.PI) / 180;
  const dLat = r(b[0] - a[0]), dLng = r(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function bearing(a, b) {
  const r = (d) => (d * Math.PI) / 180;
  const y = Math.sin(r(b[1] - a[1])) * Math.cos(r(b[0]));
  const x = Math.cos(r(a[0])) * Math.sin(r(b[0])) - Math.sin(r(a[0])) * Math.cos(r(b[0])) * Math.cos(r(b[1] - a[1]));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
// Point at distance d (km) along a route, plus heading.
function along(route, d) {
  for (let i = 0; i < route.length - 1; i++) {
    const seg = km(route[i], route[i + 1]);
    if (d <= seg) {
      const f = d / seg;
      return {
        lat: route[i][0] + (route[i + 1][0] - route[i][0]) * f,
        lng: route[i][1] + (route[i + 1][1] - route[i][1]) * f,
        heading: bearing(route[i], route[i + 1]),
      };
    }
    d -= seg;
  }
  const last = route[route.length - 1];
  return { lat: last[0], lng: last[1], heading: 0 };
}
const routeLength = (route) => route.slice(1).reduce((s, p, i) => s + km(route[i], p), 0);

function seed() {
  const db = { profiles: [], loads: [], stops: [], driver_locations: [], location_history: [] };
  db.profiles.push({ id: DISPATCHER, full_name: 'HS Dispatch (demo)', role: 'dispatcher', active: true, phone: '', truck_number: '' });

  const drivers = [
    { id: 'd-raj', full_name: 'Raj Singh', truck_number: '101', phone: '559-555-0101', route: 'fresnoPhoenix', start: 0.35, battery: 0.82 },
    { id: 'd-maria', full_name: 'Maria Lopez', truck_number: '102', phone: '214-555-0144', route: 'dallasAtlanta', start: 0.55, battery: 0.64 },
    { id: 'd-james', full_name: 'James Carter', truck_number: '103', phone: '312-555-0190', route: 'chicagoIndy', start: 0.2, battery: 0.91 },
    { id: 'd-aman', full_name: 'Amandeep Gill', truck_number: '104', phone: '901-555-0123', route: 'memphisNashville', start: 0.6, battery: 0.47 },
    { id: 'd-tom', full_name: 'Tom Becker', truck_number: '105', phone: '801-555-0177', parked: [40.76, -111.89], battery: 0.38 },
    { id: 'd-luis', full_name: 'Luis Ortega', truck_number: '106', phone: '303-555-0112', stale: [39.74, -104.99], battery: 0.09 },
    { id: 'd-kevin', full_name: 'Kevin Brooks', truck_number: '107', phone: '816-555-0165', off: [39.10, -94.58], battery: 0.73 },
  ];

  const sim = [];
  for (const d of drivers) {
    db.profiles.push({ id: d.id, full_name: d.full_name, truck_number: d.truck_number, phone: d.phone, role: 'driver', active: true });
    if (d.route) {
      const route = ROUTES[d.route];
      const total = routeLength(route);
      const s = { id: d.id, route, total, dist: total * d.start, battery: d.battery };
      sim.push(s);
      // 12 hours of trail behind the truck, one point every ~2 min.
      for (let k = 360; k >= 1; k--) {
        const back = s.dist - k * 3;
        if (back < 0) continue;
        const p = along(route, back);
        db.location_history.push({ id: db.location_history.length + 1, driver_id: d.id, lat: p.lat, lng: p.lng, recorded_at: iso(now() - k * 2 * MIN) });
      }
      const p = along(route, s.dist);
      db.driver_locations.push({ driver_id: d.id, lat: p.lat, lng: p.lng, heading: p.heading, speed_mps: 29, accuracy_m: 8, battery: d.battery, recorded_at: iso(now() - 20000), tracking_on: true });
    } else {
      const [lat, lng] = d.parked || d.stale || d.off;
      db.driver_locations.push({
        driver_id: d.id, lat, lng, heading: 0, speed_mps: 0, accuracy_m: 12, battery: d.battery,
        recorded_at: iso(d.parked ? now() - 40000 : d.stale ? now() - 47 * MIN : now() - 3 * 60 * MIN),
        tracking_on: !d.off,
      });
      if (d.parked) sim.push({ id: d.id, parked: true, battery: d.battery });
    }
  }

  const addLoad = (load, stops) => {
    const id = uid();
    db.loads.push({ id, broker_name: null, driver_notes: null, created_at: iso(now() - db.loads.length * 3600000), updated_at: iso(now()), created_by: DISPATCHER, ...load });
    stops.forEach((s, i) => db.stops.push({ id: uid(), load_id: id, seq: i + 1, status: 'pending', arrived_at: null, departed_at: null, ...s }));
  };
  addLoad({ load_number: 'SFB-204551', broker_name: 'Summit Freight Brokerage LLC', driver_id: 'd-raj', status: 'in_transit', driver_notes: '2 load bars required. Call receiver 1 hr out.' }, [
    { type: 'pickup', facility_name: 'Golden Valley Foods', address: '1450 Industrial Pkwy, Fresno, CA 93725', appointment: '11/12/2026 08:00 - 10:00', pickup_number: 'PU# 4471823, BOL# 99812', status: 'departed' },
    { type: 'delivery', facility_name: 'Kroger DC #014', address: '2200 Distribution Way, Tolleson, AZ 85353', appointment: '11/13/2026 06:00', pickup_number: 'DEL# DK-55120, PO# 7781203' },
  ]);
  addLoad({ load_number: '8812044', broker_name: 'Ridgeline Logistics Inc.', driver_id: 'd-maria', status: 'in_transit' }, [
    { type: 'pickup', facility_name: 'Lone Star Paper', address: '500 Commerce St, Dallas, TX 75202', appointment: '11/11/2026 07:00 - 15:00 (FCFS)', pickup_number: 'RELEASE# REL-30022', status: 'departed' },
    { type: 'delivery', facility_name: 'Publix DC', address: '18001 Fulton Industrial Blvd, Atlanta, GA 30336', appointment: '11/12/2026 13:30', pickup_number: 'SO# 4410098, 4410099' },
  ]);
  addLoad({ load_number: 'BRT-77', broker_name: 'Big River Transport Co.', driver_id: 'd-james', status: 'in_transit' }, [
    { type: 'pickup', facility_name: 'Prairie Grain Co', address: '88 Elevator Ln, Chicago, IL 60609', appointment: 'Nov 11, 2026 9:00 AM', pickup_number: 'PU# PG-1182', status: 'departed' },
    { type: 'delivery', facility_name: 'Midwest Mills', address: '12 Mill St, Lafayette, IN 47901', appointment: '11/11/2026 by appointment', pickup_number: 'DEL# MM-901' },
    { type: 'delivery', facility_name: 'Heartland Bakery', address: '4500 Oven Ave, Indianapolis, IN 46201', appointment: '11/12/2026 10:00', pickup_number: 'PO# HB-3321' },
  ]);
  addLoad({ load_number: 'TQ-55190', broker_name: 'TransQuick Logistics', driver_id: 'd-tom', status: 'assigned' }, [
    { type: 'pickup', facility_name: 'Wasatch Beverage', address: '2100 S 5370 W, Salt Lake City, UT 84104', appointment: '11/11/2026 14:00', pickup_number: 'PU# WB-7781' },
    { type: 'delivery', facility_name: 'Costco Depot 1290', address: '18001 Hwy 99, Tracy, CA 95304', appointment: '11/12/2026 22:00', pickup_number: 'PO# 55120931' },
  ]);
  addLoad({ load_number: 'CH-90311', broker_name: 'Crossroads Freight Inc.', driver_id: null, status: 'draft' }, [
    { type: 'pickup', facility_name: 'Mid-South Plastics', address: '3400 Democrat Rd, Memphis, TN 38118', appointment: '11/14/2026 06:00 - 12:00', pickup_number: 'PU# MSP-2201' },
    { type: 'delivery', facility_name: 'Target DC 3810', address: '1100 Logistics Way, Lebanon, TN 37090', appointment: '11/14/2026 18:00', pickup_number: 'PO# 3810-44791' },
  ]);
  addLoad({ load_number: 'SFB-203990', broker_name: 'Summit Freight Brokerage LLC', driver_id: 'd-raj', status: 'delivered' }, [
    { type: 'pickup', facility_name: 'Sun Valley Produce', address: '700 Ag Way, Bakersfield, CA 93307', appointment: '11/08/2026 05:00', pickup_number: 'PU# 4470012', status: 'departed' },
    { type: 'delivery', facility_name: 'Safeway DC', address: '16900 W Schulte Rd, Tracy, CA 95377', appointment: '11/08/2026 14:00', pickup_number: 'DEL# 88123', status: 'departed' },
  ]);

  return { db, sim };
}

export function createDemoClient() {
  const { db, sim } = seed();
  const listeners = []; // { table, cb }

  const emit = (table, eventType, row) => {
    for (const l of listeners) if (l.table === table) l.cb({ eventType, new: { ...row } });
  };

  // Move the trucks every 2 seconds (sped up so you can see them move).
  setInterval(() => {
    for (const s of sim) {
      const loc = db.driver_locations.find((l) => l.driver_id === s.id);
      if (s.parked) {
        Object.assign(loc, { recorded_at: iso(now()) });
      } else {
        s.dist += 1.2;
        if (s.dist > s.total) s.dist = 0; // loop the demo route
        const p = along(s.route, s.dist);
        s.battery = Math.max(0.05, s.battery - 0.0002);
        Object.assign(loc, { lat: p.lat, lng: p.lng, heading: p.heading, speed_mps: 27 + Math.random() * 4, battery: s.battery, recorded_at: iso(now()) });
        db.location_history.push({ id: db.location_history.length + 1, driver_id: s.id, lat: p.lat, lng: p.lng, recorded_at: loc.recorded_at });
      }
      emit('driver_locations', 'UPDATE', loc);
    }
  }, 2000);

  class Query {
    constructor(table) {
      this.table = table;
      this.filters = [];
      this.op = 'select';
      this.embedStops = false;
      this.orderBy = null;
      this.max = null;
      this.one = false;
    }
    select(cols = '*') {
      if (this.op === 'select') this.op = 'select';
      else this.returning = true;
      this.embedStops = /stops\(/.test(cols);
      return this;
    }
    eq(c, v) { this.filters.push((r) => r[c] === v); return this; }
    in(c, vs) { this.filters.push((r) => vs.includes(r[c])); return this; }
    gte(c, v) { this.filters.push((r) => r[c] >= v); return this; }
    order(c, { ascending = true } = {}) { this.orderBy = { c, ascending }; return this; }
    limit(n) { this.max = n; return this; }
    single() { this.one = true; return this; }
    insert(rows) { this.op = 'insert'; this.rows = [].concat(rows); return this; }
    update(patch) { this.op = 'update'; this.patch = patch; return this; }
    upsert(rows) { this.op = 'upsert'; this.rows = [].concat(rows); return this; }
    delete() { this.op = 'delete'; return this; }

    run() {
      const table = db[this.table];
      const match = (r) => this.filters.every((f) => f(r));
      let out = [];
      if (this.op === 'insert') {
        for (const r of this.rows) {
          const row = { id: uid(), created_at: iso(now()), updated_at: iso(now()), created_by: DISPATCHER, ...r };
          table.push(row);
          out.push(row);
          emit(this.table, 'INSERT', row);
        }
      } else if (this.op === 'upsert') {
        for (const r of this.rows) {
          const existing = table.find((x) => x.id === r.id);
          if (existing) Object.assign(existing, r); else table.push({ ...r });
          out.push(existing || r);
          emit(this.table, existing ? 'UPDATE' : 'INSERT', existing || r);
        }
      } else if (this.op === 'update') {
        for (const r of table.filter(match)) {
          Object.assign(r, this.patch, this.table === 'loads' ? { updated_at: iso(now()) } : {});
          out.push(r);
          emit(this.table, 'UPDATE', r);
        }
      } else if (this.op === 'delete') {
        for (let i = table.length - 1; i >= 0; i--) {
          if (match(table[i])) {
            const [r] = table.splice(i, 1);
            if (this.table === 'loads') db.stops = db.stops.filter((s) => s.load_id !== r.id);
            out.push(r);
            emit(this.table, 'DELETE', r);
          }
        }
      } else {
        out = table.filter(match).map((r) => ({ ...r }));
        if (this.embedStops) for (const r of out) r.stops = db.stops.filter((s) => s.load_id === r.id).map((s) => ({ ...s }));
        if (this.orderBy) {
          const { c, ascending } = this.orderBy;
          out.sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (ascending ? 1 : -1));
        }
        if (this.max) out = out.slice(0, this.max);
      }
      out = out.map((r) => ({ ...r }));
      return { data: this.one ? out[0] ?? null : out, error: null };
    }
    then(resolve, reject) {
      try { resolve(this.run()); } catch (e) { reject ? reject(e) : resolve({ data: null, error: { message: e.message } }); }
    }
  }

  const session = { user: { id: DISPATCHER, email: 'demo@hslogistics.test' } };
  const authListeners = [];
  let signedIn = true;

  return {
    from: (t) => new Query(t),
    rpc: async () => ({ data: null, error: null }),
    channel() {
      const ch = {
        on(_type, { table }, cb) { listeners.push({ table, cb, ch }); return ch; },
        subscribe() { return ch; },
      };
      return ch;
    },
    removeChannel(ch) {
      for (let i = listeners.length - 1; i >= 0; i--) if (listeners[i].ch === ch) listeners.splice(i, 1);
    },
    auth: {
      getSession: async () => ({ data: { session: signedIn ? session : null } }),
      onAuthStateChange(cb) {
        authListeners.push(cb);
        return { data: { subscription: { unsubscribe: () => authListeners.splice(authListeners.indexOf(cb), 1) } } };
      },
      async signInWithPassword() { signedIn = true; authListeners.forEach((cb) => cb('SIGNED_IN', session)); return { error: null }; },
      async signOut() { signedIn = false; authListeners.forEach((cb) => cb('SIGNED_OUT', null)); return { error: null }; },
    },
  };
}
