import {
  useEffect,
  useRef,
  useCallback,
  useLayoutEffect,
  useState,
  forwardRef,
  useImperativeHandle,
} from "react";
import mapboxgl from "mapbox-gl";
import { bearing as turfBearing, circle as turfCircle } from "@turf/turf";

type LngLat = { lat: number; lng: number };

const MAPBOX_PUBLIC_TOKEN_RAW = import.meta.env.VITE_MAPBOX_PUBLIC_TOKEN;
const MAPBOX_PUBLIC_TOKEN =
  typeof MAPBOX_PUBLIC_TOKEN_RAW === "string" && MAPBOX_PUBLIC_TOKEN_RAW.trim()
    ? MAPBOX_PUBLIC_TOKEN_RAW.trim()
    : undefined;
if (MAPBOX_PUBLIC_TOKEN) {
  mapboxgl.accessToken = MAPBOX_PUBLIC_TOKEN;
}

const MAP_STYLES = {
  light: "mapbox://styles/mapbox/streets-v12",
  dark: "mapbox://styles/mapbox/dark-v11",
} as const;
export type MapTheme = keyof typeof MAP_STYLES;

const MAP_THEME_KEY = "trip-sync-live-map-theme";

/** Read persisted basemap theme (shared with LiveTripPage controls). */
export function readLiveMapStoredTheme(): MapTheme {
  if (typeof window === "undefined") return "light";
  return window.localStorage.getItem(MAP_THEME_KEY) === "dark" ? "dark" : "light";
}

function readStoredMapTheme(): MapTheme {
  return readLiveMapStoredTheme();
}

export type LiveUserGeo = {
  lat: number;
  lng: number;
  accuracyM?: number;
  /** Degrees 0–360, clockwise from north */
  headingDeg?: number | null;
  /** m/s from Geolocation API */
  speedMps?: number | null;
};

export type LiveTripMapRef = {
  flyTo: (opts: { lat: number; lng: number; zoom?: number }) => void;
  togglePitch: () => void;
  /** Fit route geometry + all convoy riders + pins/checkpoints */
  fitConvoy: () => void;
  recenterOnUser: (at?: { lat: number; lng: number }) => void;
  toggleHeadingUp: () => void;
  toggleTraffic: () => void;
  setTrafficVisible: (visible: boolean) => void;
  zoomBy: (delta: number) => void;
  resetNorth: () => void;
  getBearing: () => number;
  getFollowUser: () => boolean;
};

export type LiveMapRider = {
  id: string;
  lat: number;
  lng: number;
  name: string;
  avatar: string;
  role: string;
  speed: number;
  distanceCovered: number;
  checkpoints: number;
  xpGained: number;
  /** Convoy / race status for HUD + marker */
  memberStatus?: "arrived" | "on-way" | "absent";
};

export type LiveMapPin = {
  id: string;
  type: string;
  lat: number;
  lng: number;
  label: string;
  addedBy: string;
};

export type LiveMapCheckpoint = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  reached: boolean;
  badge: string;
};

type Props = {
  className?: string;
  start?: LngLat | null;
  end?: LngLat | null;
  riders: LiveMapRider[];
  pins: LiveMapPin[];
  checkpoints: LiveMapCheckpoint[];
  selectedRiderId: string | null;
  onSelectRider: (id: string | null) => void;
  /** Hide arcade HUD / corners for a clean “Strava-style” full-bleed map. */
  minimalChrome?: boolean;
  /** Controlled basemap theme (optional). */
  mapTheme?: MapTheme;
  onMapThemeChange?: (t: MapTheme) => void;
  /** Throttled local GPS fix for Google-style user dot + accuracy ring */
  userGeo?: LiveUserGeo | null;
  /** When false, skip user location overlay */
  showUserLocation?: boolean;
  /** Weekly heatmap overlay */
  heatmapVisible?: boolean;
  heatmapPoints?: { lat: number; lng: number; weight?: number }[];
};

function valid(p?: LngLat | null): p is LngLat {
  return !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng);
}

const ROUTE_SOURCE = "live-trip-route-src";
const ROUTE_LAYER = "live-trip-route-layer";
const ROUTE_CASING_LAYER = "live-trip-route-casing";
const TRAILS_SOURCE = "live-rider-trails-src";
const TRAILS_LAYER = "live-rider-trails-layer";
const USER_ACCURACY_SOURCE = "live-user-accuracy-src";
const USER_ACCURACY_LAYER = "live-user-accuracy-fill";
const TRAFFIC_SOURCE_ID = "mapbox-traffic-v1";
const TRAFFIC_LAYER_ID = "live-traffic-congestion";
const HEATMAP_SOURCE = "live-heatmap-src";
const HEATMAP_LAYER = "live-heatmap-layer";
const DEM_SOURCE = "mapbox-dem";
const GOOGLE_BLUE = "#4285F4";

function lineStringCoords(geom: { type: string; coordinates: unknown }): [number, number][] {
  if (geom.type === "LineString") return geom.coordinates as [number, number][];
  if (geom.type === "MultiLineString") return (geom.coordinates as [number, number][][]).flat();
  return [];
}

/** Rank colors — arcade racing palette */
const RANK_COLORS = ["#fde047", "#94a3b8", "#fb923c", "#22d3ee", "#a78bfa", "#f472b6", "#4ade80", "#fbbf24"];

function rankRiders(riders: LiveMapRider[]): { rider: LiveMapRider; rank: number }[] {
  const sorted = [...riders].sort((a, b) => b.distanceCovered - a.distanceCovered);
  return sorted.map((rider, i) => ({ rider, rank: i + 1 }));
}

function statusLabel(s?: LiveMapRider["memberStatus"]) {
  if (s === "arrived") return { text: "IN CONVOY", color: "#4ade80", pulse: true };
  if (s === "on-way") return { text: "EN ROUTE", color: "#fbbf24", pulse: true };
  return { text: "TRACKING", color: "#94a3b8", pulse: false };
}

function pinEmoji(t: string) {
  const m: Record<string, string> = {
    parking: "🅿️",
    fuel: "⛽",
    attraction: "📸",
    hazard: "⚠️",
    "road-damage": "🚧",
  };
  return m[t] || "📍";
}

function borderForRole(role: string) {
  if (role === "organizer") return "#fbbf24";
  if (role === "co-admin") return "#60a5fa";
  return "rgba(255,255,255,0.45)";
}

function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

const LiveTripMap = forwardRef<LiveTripMapRef, Props>(function LiveTripMap(
  {
    className,
    start,
    end,
    riders,
    pins,
    checkpoints,
    selectedRiderId,
    onSelectRider,
    minimalChrome = false,
    mapTheme: mapThemeProp,
    onMapThemeChange,
    userGeo = null,
    showUserLocation = false,
    heatmapVisible = false,
    heatmapPoints = [],
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const pitchTiltRef = useRef(0);
  const routeCoordsRef = useRef<[number, number][]>([]);
  const trafficLayersAddedRef = useRef(false);
  const userMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const followUserRef = useRef(true);
  const headingUpRef = useRef(true);
  const trafficVisibleRef = useRef(false);
  const displayLngLatRef = useRef<{ lng: number; lat: number } | null>(null);
  const targetLngLatRef = useRef<{ lng: number; lat: number } | null>(null);
  const lastGpsRef = useRef<{ lng: number; lat: number } | null>(null);
  const priorGpsRef = useRef<{ lng: number; lat: number } | null>(null);
  const userGeoRef = useRef<LiveUserGeo | null | undefined>(null);
  const rafFollowRef = useRef<number | null>(null);
  const lastFollowTickRef = useRef(0);
  const anchorStartRef = useRef<mapboxgl.Marker | null>(null);
  const anchorEndRef = useRef<mapboxgl.Marker | null>(null);
  const riderMarkersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const pinMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const cpMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const trailHistoryRef = useRef<Map<string, [number, number][]>>(new Map());
  /** Markers must not call addTo() until map 'load' — otherwise Mapbox throws (lng of undefined). */
  const [mapReady, setMapReady] = useState(false);
  const [uncontrolledTheme, setUncontrolledTheme] = useState<MapTheme>(readStoredMapTheme);
  const mapTheme = mapThemeProp !== undefined ? mapThemeProp : uncontrolledTheme;

  const setTheme = useCallback(
    (next: MapTheme) => {
      try {
        window.localStorage.setItem(MAP_THEME_KEY, next);
      } catch {
        /* ignore */
      }
      onMapThemeChange?.(next);
      if (mapThemeProp === undefined) setUncontrolledTheme(next);
    },
    [mapThemeProp, onMapThemeChange],
  );
  /** Bumps after each style load so trail/route layers re-sync when switching dark ↔ light */
  const [styleEpoch, setStyleEpoch] = useState(0);
  const skipNextThemeSync = useRef(true);
  const selectedRef = useRef(selectedRiderId);
  const onSelectRef = useRef(onSelectRider);
  useLayoutEffect(() => {
    selectedRef.current = selectedRiderId;
    onSelectRef.current = onSelectRider;
  });
  useLayoutEffect(() => {
    userGeoRef.current = userGeo ?? null;
  }, [userGeo]);

  /** Fit map to route anchors and static overlays (not every rider GPS tick). */
  const fitToAnchors = useCallback(
    (map: mapboxgl.Map) => {
      const coords: [number, number][] = [];
      if (valid(start)) coords.push([start.lng, start.lat]);
      if (valid(end)) coords.push([end.lng, end.lat]);
      pins.forEach((p) => {
        if (Number.isFinite(p.lat) && Number.isFinite(p.lng)) coords.push([p.lng, p.lat]);
      });
      checkpoints.forEach((c) => {
        if (Number.isFinite(c.lat) && Number.isFinite(c.lng)) coords.push([c.lng, c.lat]);
      });
      if (coords.length >= 2) {
        const b = new mapboxgl.LngLatBounds(coords[0], coords[0]);
        coords.forEach((c) => b.extend(c));
        map.fitBounds(b, { padding: { top: 100, bottom: 80, left: 80, right: 80 }, maxZoom: 14, duration: 800 });
      } else if (coords.length === 1) {
        map.flyTo({ center: coords[0], zoom: 12, duration: 600 });
      }
    },
    [start, end, pins, checkpoints],
  );

  /** Fit computed route polyline + convoy riders + pins/checkpoints (Google “expand” / overview). */
  const fitConvoy = useCallback(() => {
    const map = mapRef.current;
    if (!map?.loaded()) return;
    const coords: [number, number][] = [];
    routeCoordsRef.current.forEach((c) => coords.push(c));
    if (valid(start)) coords.push([start.lng, start.lat]);
    if (valid(end)) coords.push([end.lng, end.lat]);
    riders.forEach((r) => {
      if (Number.isFinite(r.lat) && Number.isFinite(r.lng)) coords.push([r.lng, r.lat]);
    });
    pins.forEach((p) => {
      if (Number.isFinite(p.lat) && Number.isFinite(p.lng)) coords.push([p.lng, p.lat]);
    });
    checkpoints.forEach((c) => {
      if (Number.isFinite(c.lat) && Number.isFinite(c.lng)) coords.push([c.lng, c.lat]);
    });
    if (coords.length === 0) return;
    const b = new mapboxgl.LngLatBounds(coords[0], coords[0]);
    coords.forEach((c) => b.extend(c));
    map.fitBounds(b, {
      padding: { top: 96, bottom: 112, left: 72, right: 72 },
      maxZoom: 15,
      duration: 950,
      easing: (t) => 1 - Math.pow(1 - t, 2),
    });
  }, [start, end, riders, pins, checkpoints]);

  // Map instance
  useEffect(() => {
    if (!containerRef.current || !MAPBOX_PUBLIC_TOKEN) return;
    if (mapRef.current) return;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: MAP_STYLES[readStoredMapTheme()],
      center: valid(start) ? [start.lng, start.lat] : [78.9629, 20.5937],
      zoom: valid(start) ? 12 : 4,
      attributionControl: true,
      failIfMajorPerformanceCaveat: false,
      maxPitch: 85,
      pitch: 0,
      bearing: 0,
      // @ts-expect-error Mapbox GL v3 terrain rendering hint
      optimizeForTerrain: true,
    });
    mapRef.current = map;

    map.dragRotate.enable();
    map.touchZoomRotate.enableRotation();
    try {
      map.touchPitch.enable();
    } catch {
      /* optional in some builds */
    }

    let styleRetried = false;
    map.on("error", (e: { error?: Error }) => {
      const msg = e?.error?.message || "";
      if (!styleRetried && /style|fetch|Failed to load/i.test(msg)) {
        styleRetried = true;
        try {
          map.setStyle(MAP_STYLES.light);
        } catch {
          /* noop */
        }
      }
    });

    const onMapLoad = () => {
      setStyleEpoch((n) => n + 1);
      try {
        if (!map.getSource(DEM_SOURCE)) {
          map.addSource(DEM_SOURCE, {
            type: "raster-dem",
            url: "mapbox://mapbox.mapbox-terrain-dem-v1",
            tileSize: 512,
            maxzoom: 14,
          });
          map.setTerrain({ source: DEM_SOURCE, exaggeration: 1.12 });
        }
      } catch {
        /* terrain unavailable in some environments */
      }

      const layers = map.getStyle().layers ?? [];
      const beforeSymbol = layers.find((l) => l.type === "symbol")?.id;

      if (!map.getSource(TRAILS_SOURCE)) {
        map.addSource(TRAILS_SOURCE, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        map.addLayer({
          id: TRAILS_LAYER,
          type: "line",
          source: TRAILS_SOURCE,
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": ["get", "color"],
            "line-width": 4,
            "line-opacity": 0.62,
          },
        });
      }

      if (!map.getSource(USER_ACCURACY_SOURCE)) {
        map.addSource(USER_ACCURACY_SOURCE, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        map.addLayer(
          {
            id: USER_ACCURACY_LAYER,
            type: "fill",
            source: USER_ACCURACY_SOURCE,
            paint: {
              "fill-color": GOOGLE_BLUE,
              "fill-opacity": 0.14,
            },
          },
          beforeSymbol,
        );
      }

      try {
        if (!map.getLayer("live-3d-buildings")) {
          map.addLayer(
            {
              id: "live-3d-buildings",
              source: "composite",
              "source-layer": "building",
              filter: ["==", ["get", "extrude"], "true"],
              type: "fill-extrusion",
              minzoom: 15,
              paint: {
                "fill-extrusion-color": "#c4c9d4",
                "fill-extrusion-height": ["coalesce", ["get", "height"], 0],
                "fill-extrusion-base": ["coalesce", ["get", "min_height"], 0],
                "fill-extrusion-opacity": 0.72,
              },
            },
            beforeSymbol,
          );
        }
      } catch {
        /* building layer may not apply to all styles */
      }

      map.on("dragstart", () => {
        followUserRef.current = false;
      });

      requestAnimationFrame(() => {
        map.resize();
        requestAnimationFrame(() => map.resize());
      });
      setTimeout(() => map.resize(), 120);
      setMapReady(true);
    };

    map.on("load", onMapLoad);

    const clearSelection = () => onSelectRef.current(null);
    map.on("click", clearSelection);

    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current);

    return () => {
      setMapReady(false);
      map.off("load", onMapLoad);
      map.off("click", clearSelection);
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      riderMarkersRef.current.clear();
      pinMarkersRef.current = [];
      cpMarkersRef.current = [];
    };
  }, []);

  // Dark / light basemap toggle (re-fires `load` → trails + styleEpoch refresh)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (skipNextThemeSync.current) {
      skipNextThemeSync.current = false;
      return;
    }
    // diff:false skips partial style diff (avoids "setSprite" console warning when switching themes)
    map.setStyle(MAP_STYLES[mapTheme], { diff: false } as Parameters<mapboxgl.Map["setStyle"]>[1]);
  }, [mapTheme]);

  // Route line (start/end only)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const cleanupRoute = () => {
      try {
        if (map.getLayer(ROUTE_LAYER)) map.removeLayer(ROUTE_LAYER);
        if (map.getLayer(ROUTE_CASING_LAYER)) map.removeLayer(ROUTE_CASING_LAYER);
        if (map.getSource(ROUTE_SOURCE)) map.removeSource(ROUTE_SOURCE);
      } catch {
        /* strict mode teardown */
      }
    };

    const apply = () => {
      if (!valid(start) || !valid(end)) {
        cleanupRoute();
        routeCoordsRef.current = [];
        return;
      }

      (async () => {
        try {
          const response = await fetch("/api/maps/route", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              origin: start,
              destination: end,
              profile: "driving",
            }),
          });
          if (!response.ok) {
            cleanupRoute();
            return;
          }
          const data = await response.json();
          const geometry = data?.routes?.[0]?.geometry as { type: string; coordinates: unknown } | undefined;
          if (!geometry) {
            cleanupRoute();
            routeCoordsRef.current = [];
            return;
          }

          const add = () => {
            cleanupRoute();
            routeCoordsRef.current = lineStringCoords(geometry);
            map.addSource(ROUTE_SOURCE, {
              type: "geojson",
              data: { type: "Feature", geometry: geometry as never, properties: {} },
            });
            map.addLayer({
              id: ROUTE_CASING_LAYER,
              type: "line",
              source: ROUTE_SOURCE,
              layout: { "line-join": "round", "line-cap": "round" },
              paint: {
                "line-color": "#ffffff",
                "line-width": 9,
                "line-opacity": 0.95,
              },
            });
            map.addLayer({
              id: ROUTE_LAYER,
              type: "line",
              source: ROUTE_SOURCE,
              layout: { "line-join": "round", "line-cap": "round" },
              paint: {
                "line-color": GOOGLE_BLUE,
                "line-width": 5,
                "line-opacity": 1,
              },
            });
          };

          if (map.loaded()) add();
          else map.once("load", add);
        } catch {
          cleanupRoute();
        }
      })();
    };

    if (map.loaded()) apply();
    else map.once("load", apply);
  }, [start?.lat, start?.lng, end?.lat, end?.lng, mapTheme]);

  // Fit bounds when trip anchors + static overlays change (not on rider simulation ticks)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !map.loaded()) return;
    const t = window.setTimeout(() => fitToAnchors(map), 400);
    return () => clearTimeout(t);
  }, [mapReady, start?.lat, start?.lng, end?.lat, end?.lng, pins, checkpoints, fitToAnchors]);

  // Neon trail polylines (per-rider “race line” behind each peer)
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map?.loaded()) return;
    const src = map.getSource(TRAILS_SOURCE) as mapboxgl.GeoJSONSource | undefined;
    if (!src) return;

    const ranked = rankRiders(riders);
    const ids = new Set(riders.map((r) => r.id));
    for (const k of trailHistoryRef.current.keys()) {
      if (!ids.has(k)) trailHistoryRef.current.delete(k);
    }

    ranked.forEach(({ rider, rank }) => {
      const pt: [number, number] = [rider.lng, rider.lat];
      let hist = trailHistoryRef.current.get(rider.id) ?? [];
      const last = hist[hist.length - 1];
      if (
        !last ||
        Math.abs(last[0] - pt[0]) > 1e-7 ||
        Math.abs(last[1] - pt[1]) > 1e-7
      ) {
        hist = [...hist, pt].slice(-50);
        trailHistoryRef.current.set(rider.id, hist);
      }
    });

    const colorAt = (rank: number) => RANK_COLORS[(rank - 1) % RANK_COLORS.length];
    const features = ranked
      .map(({ rider, rank }) => {
        const coords = trailHistoryRef.current.get(rider.id) ?? [];
        if (coords.length < 2) return null;
        return {
          type: "Feature" as const,
          properties: { color: colorAt(rank), id: rider.id, rank },
          geometry: { type: "LineString" as const, coordinates: coords },
        };
      })
      .filter((f): f is NonNullable<typeof f> => f != null);

    src.setData({ type: "FeatureCollection", features });
  }, [mapReady, riders, styleEpoch]);

  // Rider markers (update positions smoothly)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !map.loaded() || !map.isStyleLoaded()) return;

    const pool = riderMarkersRef.current;
    const seen = new Set<string>();
    const ranked = rankRiders(riders);
    const rankById = new Map(ranked.map(({ rider, rank }) => [rider.id, rank]));
    const colorById = new Map(
      ranked.map(({ rider, rank }) => [rider.id, RANK_COLORS[(rank - 1) % RANK_COLORS.length]]),
    );

    const upsertRiderMarker = (r: LiveMapRider) => {
      if (!Number.isFinite(r.lat) || !Number.isFinite(r.lng)) return;
      seen.add(r.id);

      const isSel = selectedRiderId === r.id;
      const rank = rankById.get(r.id) ?? 0;
      const raceColor = colorById.get(r.id) ?? "#22d3ee";
      const border = borderForRole(r.role);
      const ring = isSel
        ? `0 0 0 3px rgba(255,255,255,0.95), 0 0 24px ${raceColor}`
        : `0 0 18px ${raceColor}88`;
      const st = statusLabel(r.memberStatus);

      let marker = pool.get(r.id);
      if (!marker) {
        const wrap = document.createElement("div");
        wrap.className = "live-rider-pin";
        wrap.style.cursor = "pointer";
        const rid = r.id;
        wrap.addEventListener("click", (e) => {
          e.stopPropagation();
          const cur = selectedRef.current;
          onSelectRef.current(cur === rid ? null : rid);
        });
        const inner = document.createElement("div");
        inner.className = "live-rider-pin-inner";
        wrap.appendChild(inner);
        marker = new mapboxgl.Marker({ element: wrap, anchor: "bottom" })
          .setLngLat([r.lng, r.lat])
          .addTo(map);
        pool.set(r.id, marker);
      }

      const inner = marker.getElement().querySelector(".live-rider-pin-inner");
      if (inner) {
        inner.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;pointer-events:none;filter:drop-shadow(0 4px 8px rgba(0,0,0,0.65));">
          <div style="display:flex;align-items:center;gap:4px;margin-bottom:4px;">
            <span style="font-size:10px;font-weight:900;font-family:ui-monospace,monospace;background:${raceColor}33;border:1px solid ${raceColor};color:${raceColor};border-radius:6px;padding:1px 6px;min-width:22px;text-align:center;">#${rank}</span>
            <span style="font-size:8px;font-weight:800;letter-spacing:0.06em;background:rgba(0,0,0,0.75);border:1px solid ${st.color}55;color:${st.color};border-radius:999px;padding:2px 6px;">${st.text}</span>
          </div>
          ${
            r.speed > 0
              ? `<div style="font-size:10px;font-weight:800;font-family:ui-monospace,monospace;background:rgba(0,0,0,0.88);border:1px solid ${raceColor}66;border-radius:999px;padding:3px 8px;margin-bottom:5px;white-space:nowrap;color:#ecfeff;text-shadow:0 0 12px ${raceColor};">${Math.round(r.speed)} <span style="opacity:0.75;font-size:8px;">KM/H</span></div>`
              : ""
          }
          <div style="position:relative;width:44px;height:44px;border-radius:999px;overflow:hidden;border:2px solid ${border};box-shadow:${ring};background:linear-gradient(145deg,${raceColor}22,transparent);">
            <div style="position:absolute;inset:0;pointer-events:none;border-radius:999px;box-shadow:inset 0 0 12px ${raceColor}55;"></div>
            <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(r.avatar)}" alt="" width="44" height="44" style="display:block;width:100%;height:100%;object-fit:cover;" />
          </div>
          <div style="width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-top:9px solid ${border};margin-top:-1px;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.5));"></div>
        </div>`;
      }
      marker.setLngLat([r.lng, r.lat]);
    };

    riders.forEach(upsertRiderMarker);

    for (const id of pool.keys()) {
      if (!seen.has(id)) {
        pool.get(id)?.remove();
        pool.delete(id);
      }
    }
  }, [mapReady, riders, selectedRiderId, styleEpoch]);

  // Pins & checkpoints (recreate on change — low frequency)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !map.loaded() || !map.isStyleLoaded()) return;

    pinMarkersRef.current.forEach((m) => m.remove());
    pinMarkersRef.current = [];
    cpMarkersRef.current.forEach((m) => m.remove());
    cpMarkersRef.current = [];

    pins.forEach((p) => {
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return;
      const el = document.createElement("div");
      el.innerHTML = `<div title="${p.label.replace(/"/g, "&quot;")}" style="width:34px;height:34px;border-radius:999px;background:rgba(0,0,0,0.78);border:1px solid rgba(255,255,255,0.18);display:flex;align-items:center;justify-content:center;font-size:15px;">${pinEmoji(p.type)}</div>`;
      const marker = new mapboxgl.Marker({ element: el, anchor: "center" })
        .setLngLat([p.lng, p.lat])
        .addTo(map);
      pinMarkersRef.current.push(marker);
    });

    checkpoints.forEach((cp) => {
      if (!Number.isFinite(cp.lat) || !Number.isFinite(cp.lng)) return;
      const el = document.createElement("div");
      el.innerHTML = `<div title="${cp.name.replace(/"/g, "&quot;")}" style="width:38px;height:38px;border-radius:999px;border:2px solid ${
        cp.reached ? "#34d399" : "rgba(255,255,255,0.28)"
      };background:rgba(0,0,0,0.65);display:flex;align-items:center;justify-content:center;font-size:17px;">${cp.badge}</div>`;
      const marker = new mapboxgl.Marker({ element: el, anchor: "bottom" })
        .setLngLat([cp.lng, cp.lat])
        .addTo(map);
      cpMarkersRef.current.push(marker);
    });
  }, [mapReady, pins, checkpoints, styleEpoch]);

  // Start / end pins (Google-style green / red)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !map.loaded()) return;

    anchorStartRef.current?.remove();
    anchorEndRef.current?.remove();
    anchorStartRef.current = null;
    anchorEndRef.current = null;

    if (valid(start)) {
      const el = document.createElement("div");
      el.innerHTML =
        '<div style="width:28px;height:28px;border-radius:999px;background:#22c55e;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.35);" title="Start"></div>';
      anchorStartRef.current = new mapboxgl.Marker({ element: el, anchor: "bottom" })
        .setLngLat([start.lng, start.lat])
        .addTo(map);
    }
    if (valid(end)) {
      const el = document.createElement("div");
      el.innerHTML =
        '<div style="width:28px;height:28px;border-radius:999px;background:#ea4335;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.35);" title="Destination"></div>';
      anchorEndRef.current = new mapboxgl.Marker({ element: el, anchor: "bottom" })
        .setLngLat([end.lng, end.lat])
        .addTo(map);
    }
  }, [mapReady, start?.lat, start?.lng, end?.lat, end?.lng, styleEpoch]);

  const ensureTrafficLayers = useCallback((map: mapboxgl.Map) => {
    if (trafficLayersAddedRef.current || !map.loaded()) return;
    try {
      if (!map.getSource(TRAFFIC_SOURCE_ID)) {
        map.addSource(TRAFFIC_SOURCE_ID, {
          type: "vector",
          url: "mapbox://mapbox.mapbox-traffic-v1",
        });
      }
      if (!map.getLayer(TRAFFIC_LAYER_ID)) {
        map.addLayer({
          id: TRAFFIC_LAYER_ID,
          type: "line",
          source: TRAFFIC_SOURCE_ID,
          "source-layer": "traffic",
          paint: {
            "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.2, 14, 3.5, 18, 6],
            "line-color": [
              "match",
              ["get", "congestion"],
              "low",
              "#34a853",
              "moderate",
              "#fbbc04",
              "heavy",
              "#fa903e",
              "severe",
              "#ea4335",
              "#34a853",
            ],
            "line-opacity": 0.92,
          },
        });
      }
      trafficLayersAddedRef.current = true;
    } catch {
      /* traffic source may fail without token */
    }
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !map.loaded()) return;
    ensureTrafficLayers(map);
    if (map.getLayer(TRAFFIC_LAYER_ID)) {
      map.setLayoutProperty(TRAFFIC_LAYER_ID, "visibility", trafficVisibleRef.current ? "visible" : "none");
    }
  }, [mapReady, styleEpoch, ensureTrafficLayers]);

  // Weekly heatmap (trip history points — warm ramp)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !map.loaded()) return;

    if (!heatmapVisible) {
      if (map.getLayer(HEATMAP_LAYER)) map.setLayoutProperty(HEATMAP_LAYER, "visibility", "none");
      return;
    }

    const features = heatmapPoints.map((p, i) => ({
      type: "Feature" as const,
      properties: { w: p.weight ?? 1 },
      geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
    }));

    if (!map.getSource(HEATMAP_SOURCE)) {
      map.addSource(HEATMAP_SOURCE, {
        type: "geojson",
        data: { type: "FeatureCollection", features },
      });
      map.addLayer({
        id: HEATMAP_LAYER,
        type: "heatmap",
        source: HEATMAP_SOURCE,
        paint: {
          "heatmap-weight": ["interpolate", ["linear"], ["get", "w"], 0, 0, 6, 1],
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 10, 1, 15, 3],
          "heatmap-color": [
            "interpolate",
            ["linear"],
            ["heatmap-density"],
            0,
            "rgba(33,102,172,0)",
            0.25,
            "rgb(103,169,207)",
            0.5,
            "rgb(209,229,240)",
            0.7,
            "rgb(253,219,199)",
            0.85,
            "rgb(239,138,98)",
            1,
            "rgb(178,24,43)",
          ],
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 10, 12, 15, 25],
          "heatmap-opacity": 0.78,
        },
      });
    } else {
      const src = map.getSource(HEATMAP_SOURCE) as mapboxgl.GeoJSONSource;
      src.setData({ type: "FeatureCollection", features });
      map.setLayoutProperty(HEATMAP_LAYER, "visibility", "visible");
    }
  }, [mapReady, heatmapVisible, heatmapPoints, styleEpoch]);

  // Throttled GPS fixes from parent (~1 Hz) — chain prior → last for bearing fallback
  useEffect(() => {
    if (!userGeo || !Number.isFinite(userGeo.lat) || !Number.isFinite(userGeo.lng)) return;
    priorGpsRef.current = lastGpsRef.current;
    lastGpsRef.current = { lng: userGeo.lng, lat: userGeo.lat };
    targetLngLatRef.current = lastGpsRef.current;
    if (!displayLngLatRef.current) displayLngLatRef.current = { ...lastGpsRef.current };
  }, [userGeo]);

  // Google-style user dot, accuracy polygon, heading cone, smooth follow + heading-up
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !map.loaded() || !showUserLocation) {
      if (userMarkerRef.current) {
        userMarkerRef.current.remove();
        userMarkerRef.current = null;
      }
      displayLngLatRef.current = null;
      targetLngLatRef.current = null;
      if (rafFollowRef.current != null) {
        cancelAnimationFrame(rafFollowRef.current);
        rafFollowRef.current = null;
      }
      return;
    }

    const ensureMarker = () => {
      if (userMarkerRef.current || !userGeoRef.current) return;
      const wrap = document.createElement("div");
      wrap.className = "live-map-user-marker-inner";
      wrap.innerHTML = `
        <div class="live-map-user-pulse-ring" aria-hidden="true"></div>
        <div class="live-map-user-cone" data-cone="1" style="opacity:0"></div>
        <div class="live-map-user-core" aria-hidden="true"></div>
      `;
      userMarkerRef.current = new mapboxgl.Marker({ element: wrap, anchor: "center" }).addTo(map);
    };

    let cancelled = false;

    const tick = () => {
      if (cancelled || !mapRef.current) return;
      ensureMarker();
      if (!userGeoRef.current) {
        rafFollowRef.current = requestAnimationFrame(tick);
        return;
      }

      const cur = displayLngLatRef.current;
      const tgt = targetLngLatRef.current;
      if (cur && tgt) {
        const t = 0.22;
        const lng = cur.lng + (tgt.lng - cur.lng) * t;
        const lat = cur.lat + (tgt.lat - cur.lat) * t;
        displayLngLatRef.current = { lng, lat };
      }

      if (displayLngLatRef.current && userMarkerRef.current) {
        userMarkerRef.current.setLngLat([displayLngLatRef.current.lng, displayLngLatRef.current.lat]);
      }

      const g = userGeoRef.current;
      if (g && Number.isFinite(g.lat) && map.getSource(USER_ACCURACY_SOURCE)) {
        const acc = Math.min(Math.max(g.accuracyM ?? 32, 10), 400);
        const km = acc / 1000;
        const poly = turfCircle([g.lng, g.lat], km, { steps: 64, units: "kilometers" });
        (map.getSource(USER_ACCURACY_SOURCE) as mapboxgl.GeoJSONSource).setData(poly as never);
      }

      if (g && displayLngLatRef.current && followUserRef.current) {
        const now = performance.now();
        if (now - lastFollowTickRef.current > 180) {
          lastFollowTickRef.current = now;
          let bearing: number | undefined;
          if (headingUpRef.current) {
            let h = g.headingDeg ?? null;
            if (h == null || Number.isNaN(h)) {
              const prev = priorGpsRef.current;
              if (prev && lastGpsRef.current && (g.speedMps ?? 0) > 1.5) {
                const b = turfBearing([prev.lng, prev.lat], [lastGpsRef.current.lng, lastGpsRef.current.lat]);
                h = b < 0 ? b + 360 : b;
              }
            } else if (h < 0) {
              h = h + 360;
            }
            if (h != null && !Number.isNaN(h)) bearing = h;
          }
          const navPitch = pitchTiltRef.current > 20 ? pitchTiltRef.current : 52;
          map.easeTo({
            center: [displayLngLatRef.current.lng, displayLngLatRef.current.lat],
            bearing: bearing ?? map.getBearing(),
            pitch: headingUpRef.current ? navPitch : map.getPitch(),
            duration: 220,
            easing: (x) => x,
            essential: true,
          });
        }
      }

      if (g && userMarkerRef.current) {
        const cone = userMarkerRef.current.getElement().querySelector("[data-cone]") as HTMLElement | null;
        const fast = (g.speedMps ?? 0) > 1.4;
        if (cone) {
          cone.style.opacity = fast ? "1" : "0";
          let rot = 0;
          if (g.headingDeg != null && !Number.isNaN(g.headingDeg)) {
            rot = g.headingDeg - map.getBearing();
          } else if (priorGpsRef.current && lastGpsRef.current && (g.speedMps ?? 0) > 1.5) {
            const b = turfBearing(
              [priorGpsRef.current.lng, priorGpsRef.current.lat],
              [lastGpsRef.current.lng, lastGpsRef.current.lat],
            );
            rot = b - map.getBearing();
          }
          cone.style.transform = `rotate(${rot}deg)`;
        }
      }

      rafFollowRef.current = requestAnimationFrame(tick);
    };

    rafFollowRef.current = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      if (rafFollowRef.current != null) cancelAnimationFrame(rafFollowRef.current);
      rafFollowRef.current = null;
    };
  }, [mapReady, showUserLocation, styleEpoch]);

  const rankedHud = rankRiders(riders);
  const isDarkBasemap = mapTheme === "dark";

  const toggleMapTheme = () => {
    setTheme(mapTheme === "light" ? "dark" : "light");
  };

  useImperativeHandle(
    ref,
    () => ({
      flyTo: ({ lat, lng, zoom = 14 }) => {
        const map = mapRef.current;
        if (!map || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
        map.flyTo({ center: [lng, lat], zoom, duration: 1100, essential: true });
      },
      togglePitch: () => {
        const map = mapRef.current;
        if (!map) return;
        const next = pitchTiltRef.current > 25 ? 0 : 56;
        pitchTiltRef.current = next;
        map.easeTo({ pitch: next, duration: 650, essential: true });
      },
      fitConvoy,
      recenterOnUser: (at?: { lat: number; lng: number }) => {
        followUserRef.current = true;
        headingUpRef.current = true;
        const map = mapRef.current;
        if (!map) return;
        const g = at ?? userGeoRef.current;
        if (!g || !Number.isFinite(g.lat)) return;
        map.easeTo({
          center: [g.lng, g.lat],
          zoom: Math.max(map.getZoom(), 15),
          pitch: pitchTiltRef.current > 20 ? pitchTiltRef.current : 52,
          duration: 600,
          essential: true,
        });
      },
      toggleHeadingUp: () => {
        headingUpRef.current = !headingUpRef.current;
      },
      toggleTraffic: () => {
        const map = mapRef.current;
        if (!map?.loaded()) return;
        ensureTrafficLayers(map);
        trafficVisibleRef.current = !trafficVisibleRef.current;
        if (map.getLayer(TRAFFIC_LAYER_ID)) {
          map.setLayoutProperty(TRAFFIC_LAYER_ID, "visibility", trafficVisibleRef.current ? "visible" : "none");
        }
      },
      setTrafficVisible: (visible: boolean) => {
        const map = mapRef.current;
        if (!map?.loaded()) return;
        ensureTrafficLayers(map);
        trafficVisibleRef.current = visible;
        if (map.getLayer(TRAFFIC_LAYER_ID)) {
          map.setLayoutProperty(TRAFFIC_LAYER_ID, "visibility", visible ? "visible" : "none");
        }
      },
      zoomBy: (delta: number) => {
        const map = mapRef.current;
        if (!map) return;
        map.easeTo({ zoom: map.getZoom() + delta, duration: 280, essential: true });
      },
      resetNorth: () => {
        const map = mapRef.current;
        if (!map) return;
        map.easeTo({ bearing: 0, duration: 450, essential: true });
      },
      getBearing: () => mapRef.current?.getBearing() ?? 0,
      getFollowUser: () => followUserRef.current,
    }),
    [fitConvoy, ensureTrafficLayers],
  );

  if (!MAPBOX_PUBLIC_TOKEN) {
    return (
      <div
        className={
          className ??
          "absolute inset-0 flex min-h-[240px] flex-col items-center justify-center bg-[#0a1628] px-6 text-center text-sm text-amber-200/90"
        }
      >
        <p className="mb-2 font-bold text-amber-400">Mapbox token missing</p>
        <p className="mb-3 max-w-md text-xs text-white/60">
          Add <code className="rounded bg-white/10 px-1.5 py-0.5 text-amber-100">VITE_MAPBOX_PUBLIC_TOKEN</code> to{" "}
          <code className="rounded bg-white/10 px-1.5 py-0.5">.env</code> in the project root, then restart{" "}
          <code className="rounded bg-white/10 px-1.5 py-0.5">npm run dev</code> (Vite only reads env at startup).
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative h-full min-h-0 w-full overflow-hidden",
        minimalChrome && "[&_.mapboxgl-ctrl-top-right]:hidden",
        className,
      )}
    >
      <div ref={containerRef} className="absolute inset-0 h-full min-h-[200px] w-full" />
      {!minimalChrome && (
        <>
          {/* Scanlines + vignette — stronger on dark basemap for arcade feel */}
          <div
            className={cn("pointer-events-none absolute inset-0 z-[1]", isDarkBasemap ? "opacity-[0.09]" : "opacity-[0.05]")}
            style={{
              backgroundImage:
                "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(34,211,238,0.07) 2px, rgba(34,211,238,0.07) 3px)",
            }}
          />
          <div
            className={cn(
              "pointer-events-none absolute inset-0 z-[1]",
              isDarkBasemap ? "shadow-[inset_0_0_160px_rgba(0,0,0,0.72)]" : "shadow-[inset_0_0_140px_rgba(0,0,0,0.22)]",
            )}
          />

          {/* Arcade HUD frame corners */}
          <div className="pointer-events-none absolute inset-2 z-[4] sm:inset-3">
            <div className="absolute left-0 top-0 h-5 w-5 border-l-2 border-t-2 border-cyan-400/60 shadow-[0_0_14px_rgba(34,211,238,0.35)]" />
            <div className="absolute right-0 top-0 h-5 w-5 border-r-2 border-t-2 border-cyan-400/60 shadow-[0_0_14px_rgba(34,211,238,0.35)]" />
            <div className="absolute bottom-0 left-0 h-5 w-5 border-b-2 border-l-2 border-fuchsia-500/50 shadow-[0_0_14px_rgba(217,70,239,0.25)]" />
            <div className="absolute bottom-0 right-0 h-5 w-5 border-b-2 border-r-2 border-fuchsia-500/50 shadow-[0_0_14px_rgba(217,70,239,0.25)]" />
          </div>

          {/* Dark / light map — bottom on mobile (clears top HUD), top-right on md+ */}
          <div className="pointer-events-none absolute bottom-24 right-2 z-[25] md:bottom-auto md:right-4 md:top-[4.5rem]">
            <button
              type="button"
              onClick={toggleMapTheme}
              title={mapTheme === "light" ? "Switch to dark map" : "Switch to light map"}
              className="pointer-events-auto flex min-h-11 items-center gap-2 rounded-xl border border-white/20 bg-black/75 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-white shadow-lg backdrop-blur-md transition hover:border-cyan-400/40 hover:bg-black/90 active:opacity-90"
            >
              <span className="text-base leading-none" aria-hidden>
                {mapTheme === "light" ? "🌙" : "☀️"}
              </span>
              <span className="hidden min-[380px]:inline">{mapTheme === "light" ? "Dark" : "Light"}</span>
            </button>
          </div>
        </>
      )}

      {/* Racing HUD — stack on narrow screens; theme control is bottom-right on mobile */}
      <div
        className={cn(
          "pointer-events-none absolute left-0 right-0 top-0 z-[5] flex flex-col gap-2 p-2 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-2 sm:p-3 md:pr-[7rem]",
          minimalChrome && "hidden",
        )}
      >
        <div className="rounded-lg border border-cyan-400/35 bg-black/80 px-2.5 py-2 shadow-[0_0_20px_rgba(34,211,238,0.15)] backdrop-blur-md sm:px-3">
          <p className="flex items-center gap-2 font-mono text-[9px] font-black uppercase tracking-[0.35em] text-cyan-300/90">
            <span
              className="inline-block h-2 w-2 animate-pulse rounded-full bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.9)]"
              aria-hidden
            />
            Live <span className="text-white/50">Convoy</span>
          </p>
          <p className="mt-0.5 text-[8px] text-white/35">Arcade grid · Boost trails · Podium</p>
        </div>

        <div className="max-h-[min(28vh,220px)] w-full overflow-hidden rounded-lg border border-white/10 bg-black/82 shadow-xl backdrop-blur-md sm:max-h-[min(42vh,320px)] sm:w-auto sm:max-w-[min(100%,380px)]">
          <div className="border-b border-white/10 bg-gradient-to-r from-fuchsia-600/25 via-cyan-600/15 to-violet-600/20 px-3 py-1.5">
            <p className="text-center font-mono text-[9px] font-black uppercase tracking-[0.25em] text-white/90">
              Race grid — distance
            </p>
          </div>
          <div className="max-h-[260px] overflow-y-auto px-2 py-2">
            {rankedHud.length === 0 ? (
              <p className="py-4 text-center text-[10px] text-white/35">Waiting for riders…</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {rankedHud.map(({ rider, rank }) => {
                  const c = RANK_COLORS[(rank - 1) % RANK_COLORS.length];
                  const st = statusLabel(rider.memberStatus);
                  return (
                    <li
                      key={rider.id}
                      className={cn(
                        "flex items-center gap-2 rounded-md border px-2 py-1.5 text-[10px] transition-shadow",
                        rank === 1 &&
                          "border-amber-400/40 bg-gradient-to-r from-amber-500/15 to-transparent shadow-[0_0_16px_rgba(251,191,36,0.12)]",
                        rank === 2 && "border-slate-300/30 bg-white/[0.05]",
                        rank === 3 && "border-orange-500/35 bg-orange-500/[0.08]",
                        rank > 3 && "border-white/5 bg-white/[0.03]",
                      )}
                    >
                      <span
                        className="flex h-6 min-w-[1.75rem] items-center justify-center rounded font-mono text-[11px] font-black"
                        style={{ background: `${c}22`, color: c, border: `1px solid ${c}55` }}
                      >
                        {rank}
                      </span>
                      <span className="max-w-[100px] truncate font-semibold text-white/95">{rider.name}</span>
                      <span
                        className="hidden rounded px-1.5 py-0.5 text-[8px] font-bold uppercase sm:inline"
                        style={{ color: st.color, border: `1px solid ${st.color}44`, background: `${st.color}15` }}
                      >
                        {st.text}
                      </span>
                      <span className="ml-auto font-mono text-cyan-300/95">{Math.round(rider.speed)}</span>
                      <span className="font-mono text-[9px] text-white/40">km/h</span>
                      <span className="font-mono text-amber-300/90">{rider.distanceCovered.toFixed(1)} km</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

export default LiveTripMap;
