import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, AppState, KeyboardAvoidingView, Linking, Platform,
  Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { supabase, configured } from './src/supabase';
import {
  checkPermissions, requestPermissions, startTracking, stopTracking, isTracking, openSettings, isAndroid,
} from './src/tracking';
import { getUploadStatus, flushQueue } from './src/locationTask';

const C = {
  brand: '#0F3D6E', accent: '#2563EB', bg: '#F4F6F9', card: '#FFFFFF', text: '#16202C',
  muted: '#64748B', line: '#E2E8F0', live: '#16A34A', warn: '#D97706', bad: '#DC2626',
  pickup: '#0E7490', delivery: '#7C3AED',
};

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Root />
    </SafeAreaProvider>
  );
}

function Root() {
  const [session, setSession] = useState(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (!configured) {
    return <Centered><Text style={s.h1}>Setup needed</Text><Text style={s.muted}>Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to driver-app/.env and rebuild.</Text></Centered>;
  }
  if (session === undefined) return <Centered><ActivityIndicator /></Centered>;
  if (!session) return <Auth />;
  return <Home session={session} />;
}

function Centered({ children }) {
  return <SafeAreaView style={[s.screen, s.center]}>{children}</SafeAreaView>;
}

// ───────────────────────── sign in / sign up ─────────────────────────
function Auth() {
  const [mode, setMode] = useState('signin');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    const res = mode === 'signin'
      ? await supabase.auth.signInWithPassword({ email: email.trim(), password })
      : await supabase.auth.signUp({ email: email.trim(), password, options: { data: { full_name: name.trim(), phone: phone.trim() } } });
    setBusy(false);
    if (res.error) Alert.alert('Could not continue', res.error.message);
    else if (mode === 'signup' && !res.data.session) Alert.alert('Check your email', 'Tap the link we sent you, then come back and sign in.');
  }

  return (
    <SafeAreaView style={[s.screen, { backgroundColor: C.brand }]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.authWrap}>
        <Text style={s.logo}>HS Logistics</Text>
        <Text style={s.logoSub}>Driver</Text>
        <View style={s.authCard}>
          {mode === 'signup' && (
            <>
              <Field label="Full name" value={name} onChangeText={setName} />
              <Field label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
            </>
          )}
          <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
          <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry />
          <Btn title={busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'} onPress={submit} disabled={busy || !email || !password || (mode === 'signup' && !name)} />
          <Pressable onPress={() => setMode(mode === 'signin' ? 'signup' : 'signin')} style={{ marginTop: 14 }}>
            <Text style={s.link}>{mode === 'signin' ? 'New driver? Create account' : 'Have an account? Sign in'}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({ label, ...props }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput style={s.input} placeholderTextColor={C.muted} {...props} />
    </View>
  );
}

function Btn({ title, onPress, disabled, color = C.accent, outline }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        s.btn,
        outline ? { borderColor: color, borderWidth: 2, backgroundColor: 'transparent' } : { backgroundColor: color },
        (pressed || disabled) && { opacity: 0.6 },
      ]}
    >
      <Text style={[s.btnText, outline && { color }]}>{title}</Text>
    </Pressable>
  );
}

// ───────────────────────── home ─────────────────────────
function Home({ session }) {
  const userId = session.user.id;
  const [profile, setProfile] = useState(null);
  const [loads, setLoads] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [perm, setPerm] = useState(null);
  const [tracking, setTracking] = useState(false);
  const [upload, setUpload] = useState(null);

  const loadData = useCallback(async () => {
    const [{ data: p }, { data: l }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).single(),
      supabase.from('loads').select('*, stops(*)').eq('driver_id', userId).in('status', ['assigned', 'in_transit']).order('created_at'),
    ]);
    setProfile(p);
    for (const x of l || []) x.stops.sort((a, b) => a.seq - b.seq);
    setLoads(l || []);
  }, [userId]);

  // Make sure tracking is running whenever the app is opened.
  const ensureTracking = useCallback(async () => {
    const p = await checkPermissions();
    setPerm(p);
    if (p === 'ok') {
      const r = await startTracking();
      setPerm(r);
    }
    setTracking(await isTracking());
    setUpload(await getUploadStatus());
  }, []);

  useEffect(() => {
    loadData();
    ensureTracking();
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') { loadData(); ensureTracking(); flushQueue(); }
    });
    const channel = supabase
      .channel(`driver-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'loads', filter: `driver_id=eq.${userId}` }, loadData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stops' }, loadData)
      .subscribe();
    const t = setInterval(async () => setUpload(await getUploadStatus()), 15000);
    return () => { sub.remove(); supabase.removeChannel(channel); clearInterval(t); };
  }, [loadData, ensureTracking, userId]);

  async function onRefresh() {
    setRefreshing(true);
    await Promise.all([loadData(), ensureTracking(), flushQueue()]);
    setRefreshing(false);
  }

  async function askPermission() {
    const r = await requestPermissions();
    if (r !== 'ok') {
      Alert.alert(
        'Location “Allow all the time” needed',
        isAndroid
          ? 'Open Settings → Permissions → Location and choose “Allow all the time”.'
          : 'Open Settings → Location and choose “Always”, and turn on Precise Location.',
        [{ text: 'Not now' }, { text: 'Open Settings', onPress: openSettings }],
      );
    }
    await ensureTracking();
  }

  async function signOut() {
    Alert.alert('Sign out?', 'Dispatch will stop seeing your location.', [
      { text: 'Cancel' },
      { text: 'Sign out', style: 'destructive', onPress: async () => { await stopTracking(); await supabase.auth.signOut(); } },
    ]);
  }

  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <View style={s.header}>
        <View>
          <Text style={s.headerTitle}>HS Logistics</Text>
          <Text style={s.headerSub}>{profile?.full_name || session.user.email}{profile?.truck_number ? ` · Truck ${profile.truck_number}` : ''}</Text>
        </View>
        <Pressable onPress={signOut}><Text style={s.headerLink}>Sign out</Text></Pressable>
      </View>
      <ScrollView contentContainerStyle={s.body} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        <TrackingCard perm={perm} tracking={tracking} upload={upload} onFix={askPermission} />
        {loads.length === 0 ? (
          <View style={s.card}><Text style={s.h2}>No load assigned</Text><Text style={s.muted}>New loads from dispatch show up here automatically. Pull down to refresh.</Text></View>
        ) : (
          loads.map((l) => <LoadCard key={l.id} load={l} onChange={loadData} />)
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function TrackingCard({ perm, tracking, upload, onFix }) {
  if (perm === null) return null;
  if (perm !== 'ok' || !tracking) {
    const msg = {
      'services-off': 'Location is turned off on this phone. Turn it on in Settings.',
      'foreground-denied': 'Dispatch can’t see your location. Allow location access.',
      'background-denied': 'Location must be set to “Allow all the time” so dispatch can see you while the app is closed.',
    }[perm] || 'Location sharing is not running.';
    return (
      <View style={[s.card, { borderLeftColor: C.bad, borderLeftWidth: 5 }]}>
        <Text style={[s.h2, { color: C.bad }]}>Location sharing OFF</Text>
        <Text style={s.muted}>{msg}</Text>
        <View style={{ height: 10 }} />
        <Btn title={perm === 'services-off' ? 'Open Settings' : 'Turn on location sharing'} onPress={perm === 'services-off' ? openSettings : onFix} color={C.bad} />
      </View>
    );
  }
  const ago = upload?.at ? Math.round((Date.now() - upload.at) / 60000) : null;
  const pending = upload?.pending || 0;
  return (
    <View style={[s.card, { borderLeftColor: C.live, borderLeftWidth: 5 }]}>
      <Text style={[s.h2, { color: C.live }]}>● Location sharing ON</Text>
      <Text style={s.muted}>
        {upload?.ok === false && pending ? `No signal — ${pending} points saved, will send when you’re back in coverage.`
          : ago == null ? 'Starting…' : ago < 1 ? 'Last sent just now.' : `Last sent ${ago} min ago.`}
      </Text>
      {isAndroid && (
        <Pressable onPress={openSettings}><Text style={[s.link, { marginTop: 6, textAlign: 'left' }]}>Tip: set Battery to “Unrestricted” for this app so tracking never stops.</Text></Pressable>
      )}
    </View>
  );
}

function LoadCard({ load, onChange }) {
  const [busyId, setBusyId] = useState(null);
  const nextIdx = load.stops.findIndex((x) => x.status !== 'departed');

  async function mark(stop, status) {
    setBusyId(stop.id);
    const patch = status === 'arrived' ? { status, arrived_at: new Date().toISOString() } : { status, departed_at: new Date().toISOString() };
    const { error } = await supabase.from('stops').update(patch).eq('id', stop.id);
    if (!error) {
      const isLast = load.stops[load.stops.length - 1].id === stop.id;
      const loadStatus = status === 'departed' && isLast ? 'delivered' : 'in_transit';
      if (loadStatus !== load.status) await supabase.from('loads').update({ status: loadStatus }).eq('id', load.id);
    } else {
      Alert.alert('Could not update', error.message);
    }
    setBusyId(null);
    onChange();
  }

  return (
    <View style={s.card}>
      <View style={s.rowBetween}>
        <Text style={s.h2}>Load {load.load_number || ''}</Text>
        <Text style={[s.badge, load.status === 'in_transit' ? { backgroundColor: '#DCFCE7', color: '#166534' } : null]}>
          {load.status === 'in_transit' ? 'In transit' : 'Assigned'}
        </Text>
      </View>
      {load.driver_notes ? <Text style={s.notes}>📝 {load.driver_notes}</Text> : null}
      {load.stops.map((st, i) => {
        const color = st.type === 'pickup' ? C.pickup : C.delivery;
        const isNext = i === nextIdx;
        return (
          <View key={st.id} style={[s.stop, { borderLeftColor: color }, st.status === 'departed' && { opacity: 0.5 }]}>
            <Text style={[s.stopType, { color }]}>{st.type === 'pickup' ? 'PICKUP' : 'DELIVERY'} {i + 1}{st.status !== 'pending' ? ` · ${st.status.toUpperCase()}` : ''}</Text>
            {st.facility_name ? <Text style={s.stopName}>{st.facility_name}</Text> : null}
            <Pressable onPress={() => openMaps(st.address)}>
              <Text style={s.address}>{st.address}</Text>
              <Text style={s.navLink}>Navigate ›</Text>
            </Pressable>
            {st.appointment ? <InfoRow label="Appointment" value={st.appointment} /> : null}
            {st.pickup_number ? <InfoRow label={st.type === 'pickup' ? 'PU #' : 'Ref #'} value={st.pickup_number} big /> : null}
            {isNext && (
              <View style={{ marginTop: 10 }}>
                {st.status === 'pending' && <Btn title={busyId === st.id ? '…' : 'I’ve arrived'} onPress={() => mark(st, 'arrived')} disabled={!!busyId} color={color} />}
                {st.status === 'arrived' && <Btn title={busyId === st.id ? '…' : st.type === 'pickup' ? 'Loaded — leaving' : 'Unloaded — leaving'} onPress={() => mark(st, 'departed')} disabled={!!busyId} color={color} />}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

function InfoRow({ label, value, big }) {
  return (
    <View style={s.infoRow}>
      <Text style={s.infoLabel}>{label}</Text>
      <Text selectable style={[s.infoValue, big && { fontSize: 18, fontWeight: '700' }]}>{value}</Text>
    </View>
  );
}

function openMaps(address) {
  const q = encodeURIComponent(address || '');
  const url = Platform.OS === 'ios' ? `http://maps.apple.com/?daddr=${q}` : `google.navigation:q=${q}`;
  Linking.openURL(url).catch(() => Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${q}`));
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  center: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  h1: { fontSize: 22, fontWeight: '700', color: C.text, marginBottom: 8 },
  h2: { fontSize: 18, fontWeight: '700', color: C.text, marginBottom: 4 },
  muted: { color: C.muted, fontSize: 15, lineHeight: 21 },
  link: { color: C.accent, fontSize: 15, textAlign: 'center' },
  label: { color: C.muted, fontSize: 13, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: C.line, borderRadius: 8, padding: 12, fontSize: 16, color: C.text, backgroundColor: '#fff' },
  btn: { paddingVertical: 14, borderRadius: 10, alignItems: 'center' },
  btnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  authWrap: { flex: 1, justifyContent: 'center', padding: 24 },
  logo: { color: '#fff', fontSize: 32, fontWeight: '800', textAlign: 'center' },
  logoSub: { color: '#BFDBFE', fontSize: 16, textAlign: 'center', marginBottom: 24 },
  authCard: { backgroundColor: '#fff', borderRadius: 14, padding: 20 },
  header: { backgroundColor: C.brand, paddingHorizontal: 18, paddingVertical: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: '800' },
  headerSub: { color: '#BFDBFE', fontSize: 14, marginTop: 2 },
  headerLink: { color: '#BFDBFE', fontSize: 15 },
  body: { padding: 14, gap: 14, paddingBottom: 40 },
  card: { backgroundColor: C.card, borderRadius: 12, padding: 16, borderLeftWidth: 0 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  badge: { backgroundColor: '#DBEAFE', color: '#1E40AF', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10, overflow: 'hidden', fontSize: 13, fontWeight: '600' },
  notes: { backgroundColor: '#FEF9C3', padding: 10, borderRadius: 8, marginTop: 8, color: C.text, fontSize: 15 },
  stop: { borderLeftWidth: 4, paddingLeft: 12, marginTop: 16 },
  stopType: { fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
  stopName: { fontSize: 17, fontWeight: '700', color: C.text, marginTop: 2 },
  address: { fontSize: 16, color: C.text, marginTop: 2 },
  navLink: { color: C.accent, fontSize: 15, fontWeight: '600', marginTop: 2 },
  infoRow: { flexDirection: 'row', marginTop: 8, alignItems: 'baseline', flexWrap: 'wrap' },
  infoLabel: { width: 110, color: C.muted, fontSize: 14 },
  infoValue: { flex: 1, color: C.text, fontSize: 16 },
});
