/** Open-Meteo — no API key (https://open-meteo.com). */

export type WeatherNow = {
  tempC: number;
  windKmh: number;
  code: number;
  label: string;
};

const WMO: Record<number, string> = {
  0: "Clear",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Fog",
  51: "Drizzle",
  61: "Rain",
  80: "Showers",
  95: "Thunderstorm",
};

export async function fetchWeatherNow(lat: number, lng: number): Promise<WeatherNow | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code,wind_speed_10m&wind_speed_unit=kmh`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const j = (await res.json()) as {
      current?: { temperature_2m?: number; weather_code?: number; wind_speed_10m?: number };
    };
    const c = j.current;
    if (!c) return null;
    const code = Number(c.weather_code ?? 0);
    return {
      tempC: Math.round(Number(c.temperature_2m ?? 0) * 10) / 10,
      windKmh: Math.round(Number(c.wind_speed_10m ?? 0)),
      code,
      label: WMO[code] ?? "Weather",
    };
  } catch {
    return null;
  }
}
