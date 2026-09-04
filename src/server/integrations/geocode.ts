/**
 * Reverse geocoding for photo captions.
 *
 * Nominatim (OpenStreetMap): keyless, one request per photo upload — far
 * inside its usage policy. The caption convention is Jamie's own — "Falcon
 * Heights, MN" at home, "Barcelona, Spain" abroad — and the formatter
 * follows it: city plus state code in the US, city plus country elsewhere.
 *
 * Until 2026-09-03 the recorded decision was coordinates-only ("a wrong
 * place name in print is worse than none"). Jamie changed the intent: the
 * field should read as a place. The name stays editable and a failed or
 * empty geocode falls back to the coordinates, so a wrong name never has
 * to survive review.
 */

interface NominatimAddress {
  city?: string;
  town?: string;
  village?: string;
  hamlet?: string;
  municipality?: string;
  state?: string;
  country?: string;
  country_code?: string;
  'ISO3166-2-lvl4'?: string;
}

/** "Falcon Heights, MN" / "Barcelona, Spain". Null when there is no name. */
export function formatPlace(a: NominatimAddress): string | null {
  const city = a.city ?? a.town ?? a.village ?? a.hamlet ?? a.municipality;
  if (a.country_code === 'us') {
    const state = a['ISO3166-2-lvl4']?.split('-')[1] ?? a.state;
    if (city && state) return `${city}, ${state}`;
    return city ?? a.state ?? null;
  }
  const parts = [city, a.country].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

/**
 * The place a "lat, lon" string names, or null: on malformed input, network
 * failure, or an answer with no usable name. Never throws — a photo upload
 * must not be hostage to OpenStreetMap.
 */
export async function placeName(coordinates: string): Promise<string | null> {
  const m = /^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/.exec(coordinates.trim());
  if (!m) return null;
  try {
    const url = new URL('https://nominatim.openstreetmap.org/reverse');
    url.searchParams.set('lat', m[1]!);
    url.searchParams.set('lon', m[2]!);
    url.searchParams.set('format', 'jsonv2');
    const res = await fetch(url, {
      // Nominatim's policy requires an identifying agent.
      headers: {
        'User-Agent': 'wt-builder/0.1 (https://weekly.thingelstad.com)',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { address?: NominatimAddress };
    return body.address ? formatPlace(body.address) : null;
  } catch {
    return null;
  }
}
