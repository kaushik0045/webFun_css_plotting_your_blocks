import * as Location from 'expo-location';
import { Linking, Platform } from 'react-native';
import { LOCATION_TASK, flushQueue, clearLocalTracking, enqueueLocations } from './locationTask';
import { supabase } from './supabase';

// Returns 'ok' | 'foreground-denied' | 'background-denied' | 'services-off'
export async function checkPermissions() {
  if (!(await Location.hasServicesEnabledAsync())) return 'services-off';
  const fg = await Location.getForegroundPermissionsAsync();
  if (fg.status !== 'granted') return 'foreground-denied';
  const bg = await Location.getBackgroundPermissionsAsync();
  if (bg.status !== 'granted') return 'background-denied';
  return 'ok';
}

// Asks for "While using" first, then "Allow all the time". Both are required.
export async function requestPermissions() {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return 'foreground-denied';
  const bg = await Location.requestBackgroundPermissionsAsync();
  if (bg.status !== 'granted') return 'background-denied';
  return 'ok';
}

export async function isTracking() {
  try {
    return await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
  } catch {
    return false;
  }
}

export async function startTracking() {
  const perm = await checkPermissions();
  if (perm !== 'ok') return perm;
  if (!(await isTracking())) {
    await Location.startLocationUpdatesAsync(LOCATION_TASK, {
      accuracy: Location.Accuracy.High,
      timeInterval: 30000,         // Android: about every 30 s
      distanceInterval: 0,         // keep reporting while parked so dispatch knows the phone is alive
      deferredUpdatesInterval: 30000,
      activityType: Location.ActivityType.AutomotiveNavigation,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'HS Logistics',
        notificationBody: 'Sharing your location with dispatch',
        notificationColor: '#0F3D6E',
        killServiceOnDestroy: false,
      },
    });
  }
  // Send a first point right away so the map updates immediately.
  try {
    const now = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    await enqueueLocations([now]);
  } catch {}
  flushQueue();
  return 'ok';
}

export async function stopTracking() {
  if (await isTracking()) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  await flushQueue();
  try { await supabase.rpc('set_tracking', { p_on: false }); } catch {}
  await clearLocalTracking();
}

export function openSettings() {
  return Linking.openSettings();
}

export const isAndroid = Platform.OS === 'android';
