export function timeAgo(iso, now = Date.now()) {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} hr ago`;
  return `${Math.round(h / 24)} days ago`;
}

// green = fresh, amber = a bit old, red = stale or tracking turned off
export function freshness(loc, now = Date.now()) {
  if (!loc) return 'none';
  if (loc.tracking_on === false) return 'off';
  const min = (now - new Date(loc.recorded_at).getTime()) / 60000;
  if (min <= 5) return 'live';
  if (min <= 30) return 'recent';
  return 'stale';
}

export const FRESHNESS_LABEL = {
  live: 'Live',
  recent: 'Delayed',
  stale: 'No signal',
  off: 'Tracking off',
  none: 'Never connected',
};

export function mph(speedMps) {
  if (speedMps == null || speedMps < 0) return null;
  return Math.round(speedMps * 2.23694);
}

export const LOAD_STATUS_LABEL = {
  draft: 'Draft',
  assigned: 'Assigned',
  in_transit: 'In transit',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

export function mapsLink(address) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address || '')}`;
}
