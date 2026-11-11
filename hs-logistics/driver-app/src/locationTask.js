// Background GPS task. Runs even when the app is closed or the screen is off.
//
// Each batch of GPS points is thinned out (one point every 30 s or every 150 m),
// added to an on-phone queue, and the queue is uploaded to Supabase. If the truck
// is in a dead zone the upload fails and the points stay queued until signal returns,
// so the dispatcher still gets the full trail.
import * as TaskManager from 'expo-task-manager';
import * as Battery from 'expo-battery';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

export const LOCATION_TASK = 'hs-location-task';

const QUEUE_KEY = 'hs.locationQueue';
const LAST_KEY = 'hs.lastSavedPoint';
const STATUS_KEY = 'hs.lastUpload';
const MAX_QUEUE = 20000;      // about 7 days at one point per 30 s
const MIN_SECONDS = 30;
const MIN_METERS = 150;
const BATCH = 500;

let flushing = false;

function metersBetween(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function readJson(key, fallback) {
  try {
    const v = await AsyncStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}

export async function enqueueLocations(locations) {
  let battery = null;
  try {
    const level = await Battery.getBatteryLevelAsync();
    if (level >= 0) battery = level;
  } catch {}

  let last = await readJson(LAST_KEY, null);
  const fresh = [];
  for (const loc of [...locations].sort((a, b) => a.timestamp - b.timestamp)) {
    const p = {
      lat: loc.coords.latitude,
      lng: loc.coords.longitude,
      speed_mps: loc.coords.speed ?? null,
      heading: loc.coords.heading ?? null,
      accuracy_m: loc.coords.accuracy ?? null,
      battery,
      recorded_at: new Date(loc.timestamp).toISOString(),
    };
    if (p.accuracy_m != null && p.accuracy_m > 500) continue; // junk fix
    if (last) {
      const secs = (loc.timestamp - new Date(last.recorded_at).getTime()) / 1000;
      if (secs < 0) continue;
      if (secs < MIN_SECONDS && metersBetween(last, p) < MIN_METERS) continue;
    }
    fresh.push(p);
    last = p;
  }
  if (!fresh.length) return;
  await AsyncStorage.setItem(LAST_KEY, JSON.stringify(last));
  const queue = await readJson(QUEUE_KEY, []);
  const merged = queue.concat(fresh).slice(-MAX_QUEUE);
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(merged));
}

export async function flushQueue() {
  if (flushing) return;
  flushing = true;
  try {
    const { data } = await supabase.auth.getSession(); // refreshes an expired token
    const userId = data.session?.user?.id;
    if (!userId) return;
    let queue = await readJson(QUEUE_KEY, []);
    while (queue.length) {
      const batch = queue.slice(0, BATCH).map((p) => ({ ...p, driver_id: userId }));
      const { error } = await supabase.from('location_history').insert(batch);
      if (error) {
        await AsyncStorage.setItem(STATUS_KEY, JSON.stringify({ ok: false, at: Date.now(), error: error.message }));
        return;
      }
      // Re-read in case new points were queued while uploading.
      const current = await readJson(QUEUE_KEY, []);
      queue = current.slice(batch.length);
      await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
      await AsyncStorage.setItem(STATUS_KEY, JSON.stringify({ ok: true, at: Date.now() }));
    }
  } catch (e) {
    await AsyncStorage.setItem(STATUS_KEY, JSON.stringify({ ok: false, at: Date.now(), error: String(e?.message || e) }));
  } finally {
    flushing = false;
  }
}

export async function getUploadStatus() {
  const [status, queue] = await Promise.all([readJson(STATUS_KEY, null), readJson(QUEUE_KEY, [])]);
  return { ...(status || {}), pending: queue.length };
}

export async function clearLocalTracking() {
  await AsyncStorage.multiRemove([QUEUE_KEY, LAST_KEY, STATUS_KEY]);
}

TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;
  await enqueueLocations(data.locations);
  await flushQueue();
});
