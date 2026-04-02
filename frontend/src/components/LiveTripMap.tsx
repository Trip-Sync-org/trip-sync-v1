/**
 * LiveTripMap.tsx  (frontend/src/components/)
 * ─────────────────────────────────────────────────────────────────────────────
 * All 9 map fixes applied. Token env var corrected to VITE_MAPBOX_PUBLIC_TOKEN.
 * Uses ONLY: mapbox-gl, turf.js, /api/maps/* backend routes.
 * NO Google Maps / googleapis.com / Mappls.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useCallback, useState } from "react";
import mapboxgl from "mapbox-gl";
import * as turf from "@turf/turf";
import "mapbox-gl/dist/mapbox-gl.css";

// ─── Types ────────────────────────────────────────────────────────────────────

export type MapTheme = "light" | "dark";
const MAP_THEME_KEY = "trip-sync-live-map-theme";

export function readLiveMapStoredTheme(): MapTheme {
  if (typeof window === "undefined") return "light";
  return window.localStorage.getItem(MAP_THEME_KEY) === "dark" ? "dark" : "light";
}

export type LiveUserGeo = {
  lat: number;
  lng: number;
  accuracyM?: number;
  headingDeg?: number | null;
  speedMps?: number | null;
};

export type LiveTripMapRef = {
  flyTo: (_opts: { lat: number; lng: number; zoom?: number }) => void;
  togglePitch: () => void;
  fitConvoy: () => void;
  recenterOnUser: (_at?: { lat: number; lng: number }) => void;
  toggleHeadingUp: () => void;
  toggleTraffic: () => void;
  setTrafficVisible: (_visible: boolean) => void;
  zoomBy: (_delta: number) => void;
  resetNorth: () => void;
  getBearing: () => number;
  getFollowUser: () => boolean;
};

export interface ConvoyMember {
  id: string;
  userId: number;
  name: string;
  avatar: string;
  status: "arrived" | "on-way" | "absent";
  role: "organizer" | "co-admin" | "moderator" | "member";
  muted: boolean;
  blocked: boolean;
  speed: number;
  distanceCovered: number;
  checkpoints: number;
  xpGained: number;
  lat: number;
  lng: number;
}

export interface TripCheckpoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
  reached: boolean;
  badge: string;
  xp: number;
}

export interface MapPin {
  id: string;
  type: "parking" | "fuel" | "attraction" | "hazard" | "road-damage";
  lat: number;
  lng: number;
  label: string;
  addedBy: string;
}

export interface LiveTripMapProps {
  tripId: number;
  userId: number;
  originLat?: number;
  originLng?: number;
  destinationLat?: number;
  destinationLng?: number;
  members?: ConvoyMember[];
  checkpoints?: TripCheckpoint[];
  mapPins?: MapPin[];
  onLocationUpdate?: (lat: number, lng: number, speed: number) => void;
  onDistanceUpdate?: (km: number) => void;
  className?: string;
  style?: React.CSSProperties;

  // Extra props used by the live screen; safe to ignore if unused.
  minimalChrome?: boolean;
  mapTheme?: MapTheme;
  onMapThemeChange?: (t: MapTheme) => void;
  userGeo?: LiveUserGeo | null;
  showUserLocation?: boolean;
  heatmapVisible?: boolean;
  heatmapPoints?: { lat: number; lng: number; weight?: number }[];
  start?: { lat: number; lng: number } | null;
  end?: { lat: number; lng: number } | null;
  riders?: Array<{ id: string; lat: number; lng: number }>;
  pins?: MapPin[];
  selectedRiderId?: string | null;
  onSelectRider?: (id: string | null) => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

// ✅ FIX: was VITE_MAPBOX_TOKEN — root .env exports VITE_MAPBOX_PUBLIC_TOKEN
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_PUBLIC_TOKEN as string;

const MAP_STYLES = {
  navNight: "mapbox://styles/mapbox/navigation-night-v1",
  navDay:   "mapbox://styles/mapbox/navigation-day-v1",
  satellite:"mapbox://styles/mapbox/satellite-streets-v12",
  streets:  "mapbox://styles/mapbox/streets-v12",
} as const;
type StyleKey = keyof typeof MAP_STYLES;

const PIN_ICONS: Record<MapPin["type"], string> = {
  parking:      "🅿️",
  fuel:         "⛽",
  attraction:   "📍",
  hazard:       "⚠️",
  "road-damage":"🚧",
};

// ─── One-time CSS injection ───────────────────────────────────────────────────

function injectGlobalStyles() {
  if (document.getElementById("live-trip-map-styles")) return;
  const s = document.createElement("style");
  s.id = "live-trip-map-styles";
  s.textContent = `
    @keyframes lm-pulse-ring {
      0%   { transform:scale(1);  opacity:.8; }
      100% { transform:scale(3);  opacity:0;  }
    }
    @keyframes lm-sos-flash {
      0%,100% { background:#EA4335; }
      50%      { background:#ff7c6e; box-shadow:0 0 16px 4px rgba(234,67,53,.7); }
    }
    .lm-user-marker{ position:relative; width:24px; height:24px; }
    .lm-pulse-ring{
      position:absolute; top:-4px; left:-4px; width:32px; height:32px;
      border-radius:50%; background:rgba(66,133,244,.25);
      animation:lm-pulse-ring 2s ease-out infinite; pointer-events:none;
    }
    .lm-heading-cone{
      position:absolute; width:0; height:0;
      border-left:7px solid transparent; border-right:7px solid transparent;
      border-bottom:18px solid rgba(66,133,244,.65);
      top:-18px; left:5px; transform-origin:bottom center;
      transition:transform .4s ease;
    }
    .lm-dot-outer{
      position:absolute; top:0; left:0; width:24px; height:24px;
      background:white; border-radius:50%;
      box-shadow:0 2px 8px rgba(0,0,0,.5);
      display:flex; align-items:center; justify-content:center;
    }
    .lm-dot-inner{ width:14px; height:14px; background:#4285F4; border-radius:50%; }
    .lm-convoy-marker{
      width:36px; height:36px; border-radius:50%;
      display:flex; align-items:center; justify-content:center;
      font-weight:700; font-size:12px; color:white;
      border:3px solid white; box-shadow:0 2px 8px rgba(0,0,0,.4);
      cursor:pointer; position:relative; transition:transform .2s ease;
    }
    .lm-convoy-marker:hover{ transform:scale(1.15); }
    .lm-convoy-marker.sos{ animation:lm-sos-flash .5s infinite; }
    .lm-speed-badge{
      position:absolute; bottom:-20px; left:50%; transform:translateX(-50%);
      background:rgba(0,0,0,.75); color:white;
      padding:2px 6px; border-radius:10px;
      font-size:10px; white-space:nowrap; font-weight:600;
    }
    .lm-checkpoint-marker{
      font-size:20px; cursor:pointer;
      filter:drop-shadow(0 2px 4px rgba(0,0,0,.5));
      transition:transform .2s ease;
    }
    .lm-checkpoint-marker:hover{ transform:scale(1.3); }
    .lm-checkpoint-marker.reached{ filter:grayscale(.4) drop-shadow(0 2px 4px rgba(0,0,0,.5)); }
    .lm-pin-marker{ font-size:18px; cursor:pointer; filter:drop-shadow(0 2px 3px rgba(0,0,0,.4)); }
    .lm-hud{
      position:absolute; bottom:24px; right:16px;
      display:flex; flex-direction:column; gap:8px; z-index:10;
    }
    .lm-hud-btn{
      width:44px; height:44px; border-radius:50%;
      background:rgba(10,10,20,.85); border:1.5px solid rgba(255,255,255,.15);
      color:white; font-size:18px;
      display:flex; align-items:center; justify-content:center;
      cursor:pointer; backdrop-filter:blur(8px);
      box-shadow:0 4px 16px rgba(0,0,0,.4);
      transition:background .2s,transform .15s; user-select:none;
    }
    .lm-hud-btn:hover{ background:rgba(30,30,50,.95); transform:scale(1.08); }
    .lm-hud-btn.active{ background:#1a73e8; border-color:#4285F4; }
    .lm-speed-hud{
      position:absolute; bottom:24px; left:16px;
      background:rgba(10,10,20,.85); border:1.5px solid rgba(255,255,255,.12);
      border-radius:14px; padding:10px 16px; backdrop-filter:blur(10px);
      color:white; text-align:center; box-shadow:0 4px 16px rgba(0,0,0,.4); z-index:10;
    }
    .lm-speed-val{
      font-size:28px; font-weight:800; line-height:1;
      font-variant-numeric:tabular-nums; color:#4fc3f7;
    }
    .lm-speed-unit{ font-size:11px; opacity:.6; margin-top:2px; letter-spacing:.08em; text-transform:uppercase; }
    .lm-style-selector{
      position:absolute; top:16px; right:16px;
      display:flex; gap:6px; z-index:10;
    }
    .lm-style-pill{
      padding:5px 11px; border-radius:20px; font-size:11px; font-weight:600;
      cursor:pointer; letter-spacing:.04em;
      background:rgba(10,10,20,.8); border:1.5px solid rgba(255,255,255,.12);
      color:rgba(255,255,255,.7); backdrop-filter:blur(8px);
      transition:all .2s; user-select:none;
    }
    .lm-style-pill.active{ background:#1a73e8; border-color:#4285F4; color:white; }
    .lm-style-pill:hover:not(.active){ background:rgba(30,30,50,.9); color:white; }
  `;
  document.head.appendChild(s);
}

// ─── Component ────────────────────────────────────────────────────────────────

const LiveTripMap = forwardRef<LiveTripMapRef, LiveTripMapProps>(function LiveTripMap(
{
  userId,
  originLat, originLng, destinationLat, destinationLng,
  members = [], checkpoints = [], mapPins = [],
  onLocationUpdate, onDistanceUpdate,
  className, style,
  mapTheme,
  onMapThemeChange,
}: LiveTripMapProps,
ref,
) {
  const containerRef    = useRef<HTMLDivElement>(null);
  const mapRef          = useRef<mapboxgl.Map | null>(null);
  const watchIdRef      = useRef<number | null>(null);
  const lastPositionRef = useRef<{ lng: number; lat: number } | null>(null);
  const lastAccuracyRef = useRef<number>(50);
  const totalDistRef    = useRef<number>(0);
  const followRef       = useRef<boolean>(true);
  const routeCoordsRef  = useRef<[number, number][]>([]);
  const userMarkerRef   = useRef<mapboxgl.Marker | null>(null);
  const markerElRef     = useRef<HTMLDivElement | null>(null);
  const convoyRef       = useRef<Record<string, { marker: mapboxgl.Marker; element: HTMLDivElement }>>({});
  const cpMarkersRef    = useRef<mapboxgl.Marker[]>([]);
  const pinMarkersRef   = useRef<mapboxgl.Marker[]>([]);

  const [currentStyle, setCurrentStyle] = useState<StyleKey>("navNight");
  const [speedKmh, setSpeedKmh]         = useState(0);
  const [following, setFollowing]       = useState(true);
  const [mapReady, setMapReady]         = useState(false);

  // ── FIX 3 — Accuracy circle ──────────────────────────────────────────────
  const updateAccuracyCircle = useCallback((lng: number, lat: number, acc: number) => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const circle = turf.circle([lng, lat], Math.max(acc, 5) / 1000, { steps: 64, units: "kilometers" });
    if (map.getSource("accuracy-circle")) {
      (map.getSource("accuracy-circle") as mapboxgl.GeoJSONSource).setData(circle);
    } else {
      map.addSource("accuracy-circle", { type: "geojson", data: circle });
      map.addLayer({ id:"accuracy-circle-fill", type:"fill", source:"accuracy-circle",
        paint:{ "fill-color":"#4285F4","fill-opacity":0.1 }});
      map.addLayer({ id:"accuracy-circle-border", type:"line", source:"accuracy-circle",
        paint:{ "line-color":"#4285F4","line-width":1.5,"line-opacity":0.35 }});
    }
  }, []);

  // ── FIX 2 — User dot ─────────────────────────────────────────────────────
  const createOrUpdateUserMarker = useCallback(
    (lng: number, lat: number, bearing: number | null, acc: number) => {
      const map = mapRef.current;
      if (!map) return;
      if (!markerElRef.current) {
        const el = document.createElement("div");
        el.className = "lm-user-marker";
        el.innerHTML = `<div class="lm-pulse-ring"></div><div class="lm-heading-cone"></div>
          <div class="lm-dot-outer"><div class="lm-dot-inner"></div></div>`;
        markerElRef.current = el;
      }
      const cone = markerElRef.current.querySelector<HTMLElement>(".lm-heading-cone");
      if (cone && bearing !== null) cone.style.transform = `rotate(${bearing}deg)`;
      if (!userMarkerRef.current) {
        userMarkerRef.current = new mapboxgl.Marker({ element: markerElRef.current, anchor: "center" })
          .setLngLat([lng, lat]).addTo(map);
      } else {
        userMarkerRef.current.setLngLat([lng, lat]);
      }
      updateAccuracyCircle(lng, lat, acc);
      lastAccuracyRef.current = acc;
    },
    [updateAccuracyCircle]
  );

  // ── FIX 6 — Route progress ───────────────────────────────────────────────
  const updateRouteProgress = useCallback((pos: [number, number]) => {
    const map    = mapRef.current;
    const coords = routeCoordsRef.current;
    if (!map || !map.isStyleLoaded() || coords.length < 2) return;
    const snapped = turf.nearestPointOnLine(turf.lineString(coords), turf.point(pos));
    const idx = snapped.properties?.index ?? 0;
    const traveled  = coords.slice(0, idx + 1);
    const remaining = coords.slice(idx);
    const upsert = (srcId: string, layerId: string, pts: [number,number][], color: string, opacity: number) => {
      const gj: GeoJSON.Feature<GeoJSON.LineString> = {
        type:"Feature", properties:{}, geometry:{ type:"LineString", coordinates:pts }
      };
      if (map.getSource(srcId)) {
        (map.getSource(srcId) as mapboxgl.GeoJSONSource).setData(gj);
      } else {
        map.addSource(srcId, { type:"geojson", data:gj });
        map.addLayer({ id:layerId, type:"line", source:srcId,
          layout:{ "line-join":"round","line-cap":"round" },
          paint:{ "line-color":color,"line-width":7,"line-opacity":opacity }});
      }
    };
    if (traveled.length  >= 2) upsert("route-traveled",  "route-traveled-line",  traveled,  "#1a73e8", 1);
    if (remaining.length >= 2) upsert("route-remaining", "route-remaining-line", remaining, "#a8c7fa", 0.8);
  }, []);

  // ── FIX 5 — Draw route ───────────────────────────────────────────────────
  const drawRoute = useCallback(async (oLng: number, oLat: number, dLng: number, dLat: number) => {
    const map = mapRef.current;
    if (!map) return;
    try {
      const res  = await fetch("/api/maps/route", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ origin:{ lat:oLat, lng:oLng }, destination:{ lat:dLat, lng:dLng }, profile:"driving" }),
      });
      if (!res.ok) throw new Error(`Route API ${res.status}`);
      const data = await res.json();
      if (!data.routes?.length) return;
      const coords = (data.routes[0].geometry as GeoJSON.LineString).coordinates as [number,number][];
      routeCoordsRef.current = coords;
      const gj: GeoJSON.Feature<GeoJSON.LineString> = {
        type:"Feature", properties:{}, geometry:{ type:"LineString", coordinates:coords }
      };
      const addLayer = (srcId: string, layerId: string, color: string, width: number) => {
        if (!map.getSource(srcId)) map.addSource(srcId, { type:"geojson", data:gj });
        else (map.getSource(srcId) as mapboxgl.GeoJSONSource).setData(gj);
        if (!map.getLayer(layerId)) map.addLayer({ id:layerId, type:"line", source:srcId,
          layout:{ "line-join":"round","line-cap":"round" },
          paint:{ "line-color":color,"line-width":width,"line-opacity":0.9 }});
      };
      addLayer("route-casing","route-casing","#ffffff",12);
      addLayer("route","route-line","#4285F4",7);
      new mapboxgl.Marker({ color:"#34A853" }).setLngLat(coords[0]).addTo(map);
      new mapboxgl.Marker({ color:"#EA4335" }).setLngLat(coords[coords.length-1]).addTo(map);
      const bounds = coords.reduce(
        (b,c) => b.extend(c as mapboxgl.LngLatLike),
        new mapboxgl.LngLatBounds(coords[0], coords[0])
      );
      map.fitBounds(bounds, { padding:80, pitch:0, duration:1500 });
      console.log("✅ Route drawn:", coords.length, "points");
    } catch (err) { console.error("❌ Route fetch failed:", err); }
  }, []);

  // ── FIX 7 — Convoy markers ───────────────────────────────────────────────
  const updateConvoyMarkers = useCallback((ms: ConvoyMember[]) => {
    const map = mapRef.current;
    if (!map) return;
    ms.forEach((m) => {
      if (!m.lat || !m.lng || m.userId === userId) return;
      const isSOS  = (m.status as string) === "sos";
      const color  = isSOS ? "#EA4335" : m.role === "organizer" ? "#e8a000" : "#1a73e8";
      const ex     = convoyRef.current[m.id];
      if (!ex) {
        const el = document.createElement("div");
        el.className = `lm-convoy-marker${isSOS ? " sos" : ""}`;
        el.style.background = color;
        el.innerHTML = `${m.name.substring(0,2).toUpperCase()}<div class="lm-speed-badge">${Math.round(m.speed)} km/h</div>`;
        const popup = new mapboxgl.Popup({ offset:25, closeButton:false })
          .setHTML(`<strong>${m.name}</strong><br/>${m.role} · ${Math.round(m.speed)} km/h`);
        const marker = new mapboxgl.Marker({ element:el, anchor:"center" })
          .setLngLat([m.lng, m.lat]).setPopup(popup).addTo(map);
        convoyRef.current[m.id] = { marker, element:el };
      } else {
        ex.marker.setLngLat([m.lng, m.lat]);
        const badge = ex.element.querySelector<HTMLElement>(".lm-speed-badge");
        if (badge) badge.textContent = `${Math.round(m.speed)} km/h`;
        if (isSOS) ex.element.classList.add("sos");
      }
    });
  }, [userId]);

  // ── Checkpoint markers ────────────────────────────────────────────────────
  const addCheckpointMarkers = useCallback((cps: TripCheckpoint[]) => {
    const map = mapRef.current;
    if (!map) return;
    cpMarkersRef.current.forEach((m) => m.remove());
    cpMarkersRef.current = [];
    cps.forEach((cp) => {
      if (!cp.lat || !cp.lng) return;
      const el = document.createElement("div");
      el.className = `lm-checkpoint-marker${cp.reached ? " reached" : ""}`;
      el.textContent = cp.badge;
      el.title = `${cp.name} (+${cp.xp} XP)`;
      cpMarkersRef.current.push(
        new mapboxgl.Marker({ element:el, anchor:"center" }).setLngLat([cp.lng,cp.lat]).addTo(map)
      );
    });
  }, []);

  // ── Pin markers ───────────────────────────────────────────────────────────
  const addPinMarkers = useCallback((pins: MapPin[]) => {
    const map = mapRef.current;
    if (!map) return;
    pinMarkersRef.current.forEach((m) => m.remove());
    pinMarkersRef.current = [];
    pins.forEach((pin) => {
      if (!pin.lat || !pin.lng) return;
      const el = document.createElement("div");
      el.className = "lm-pin-marker";
      el.textContent = PIN_ICONS[pin.type];
      el.title = `${pin.label} (by ${pin.addedBy})`;
      pinMarkersRef.current.push(
        new mapboxgl.Marker({ element:el, anchor:"bottom" }).setLngLat([pin.lng,pin.lat]).addTo(map)
      );
    });
  }, []);

  // ── FIX 8 — Restore layers after style switch ─────────────────────────────
  const restoreAllLayers = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const last   = lastPositionRef.current;
    if (last) updateAccuracyCircle(last.lng, last.lat, lastAccuracyRef.current);
    const coords = routeCoordsRef.current;
    if (coords.length >= 2) {
      const gj: GeoJSON.Feature<GeoJSON.LineString> = {
        type:"Feature", properties:{}, geometry:{ type:"LineString", coordinates:coords }
      };
      if (!map.getSource("route-casing")) {
        map.addSource("route-casing", { type:"geojson", data:gj });
        map.addLayer({ id:"route-casing", type:"line", source:"route-casing",
          layout:{"line-join":"round","line-cap":"round"},
          paint:{"line-color":"#ffffff","line-width":12,"line-opacity":0.9} });
      }
      if (!map.getSource("route")) {
        map.addSource("route", { type:"geojson", data:gj });
        map.addLayer({ id:"route-line", type:"line", source:"route",
          layout:{"line-join":"round","line-cap":"round"},
          paint:{"line-color":"#4285F4","line-width":7} });
      }
    }
  }, [updateAccuracyCircle]);

  // ── FIX 4 — GPS watcher ───────────────────────────────────────────────────
  const startLocationWatcher = useCallback(() => {
    if (watchIdRef.current !== null) return;
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const map = mapRef.current;
        if (!map) return;
        const { latitude:lat, longitude:lng, accuracy, heading, speed } = pos.coords;
        let bearing: number | null = heading ?? null;
        if (bearing === null && lastPositionRef.current) {
          bearing = turf.bearing(
            turf.point([lastPositionRef.current.lng, lastPositionRef.current.lat]),
            turf.point([lng, lat])
          );
        }
        createOrUpdateUserMarker(lng, lat, bearing, accuracy ?? 30);
        if (followRef.current) {
          map.easeTo({ center:[lng,lat], bearing:bearing??map.getBearing(), pitch:50, zoom:17, duration:1000 });
        }
        updateRouteProgress([lng, lat]);
        const kmh = speed !== null ? speed * 3.6 : 0;
        setSpeedKmh(Math.round(kmh));
        onLocationUpdate?.(lat, lng, kmh);
        if (lastPositionRef.current) {
          const d = turf.distance(
            turf.point([lastPositionRef.current.lng, lastPositionRef.current.lat]),
            turf.point([lng, lat]), { units:"kilometers" }
          );
          totalDistRef.current += d;
          onDistanceUpdate?.(totalDistRef.current);
        }
        lastPositionRef.current = { lng, lat };
      },
      (err) => console.error("❌ GPS watch error:", err.code, err.message),
      { enableHighAccuracy:true, maximumAge:1000, timeout:10000 }
    );
    console.log("✅ GPS watcher started:", watchIdRef.current);
  }, [createOrUpdateUserMarker, updateRouteProgress, onLocationUpdate, onDistanceUpdate]);

  // ── FIX 1 — Snap to GPS ───────────────────────────────────────────────────
  const initMapToUserLocation = useCallback(() => {
    const map = mapRef.current;
    if (!map || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      ({ coords:{ latitude, longitude, accuracy, heading } }) => {
        console.log("✅ GPS initial fix:", latitude, longitude);
        map.flyTo({ center:[longitude,latitude], zoom:16, pitch:50, bearing:heading??0, duration:1500, essential:true });
        createOrUpdateUserMarker(longitude, latitude, heading??null, accuracy??30);
        startLocationWatcher();
      },
      (err) => {
        console.error("GPS Error:", err.code, err.message);
        map.flyTo({ center:[78.9629,20.5937], zoom:10 });
      },
      { enableHighAccuracy:true, timeout:10000, maximumAge:0 }
    );
  }, [createOrUpdateUserMarker, startLocationWatcher]);

  // ── Map init (runs once) ──────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    injectGlobalStyles();
    mapboxgl.accessToken = MAPBOX_TOKEN;

    // FIX 9 — correct init defaults
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style:     MAP_STYLES.navNight,
      center:    [78.9629, 20.5937],   // India fallback — GPS overrides immediately
      zoom:      5,
      pitch:     0,
      bearing:   0,
      attributionControl: false,
      logoPosition: "bottom-left",
    });
    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl({ showCompass:true }), "top-left");

    map.on("dragstart", () => { followRef.current = false; setFollowing(false); });

    // FIX 8
    map.on("style.load", () => { console.log("🎨 Style loaded — restoring layers"); restoreAllLayers(); });

    // FIX 1 + FIX 5
    map.on("load", () => {
      setMapReady(true);
      initMapToUserLocation();
      if (originLng != null && originLat != null && destinationLng != null && destinationLat != null) {
        void drawRoute(originLng, originLat, destinationLng, destinationLat);
      }
    });

    return () => {
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!mapReady || originLng == null || originLat == null || destinationLng == null || destinationLat == null) return;
    void drawRoute(originLng, originLat, destinationLng, destinationLat);
  }, [mapReady, originLat, originLng, destinationLat, destinationLng, drawRoute]);

  useEffect(() => { if (mapReady) updateConvoyMarkers(members); }, [mapReady, members, updateConvoyMarkers]);
  useEffect(() => { if (mapReady) addCheckpointMarkers(checkpoints); }, [mapReady, checkpoints, addCheckpointMarkers]);
  useEffect(() => { if (mapReady) addPinMarkers(mapPins); }, [mapReady, mapPins, addPinMarkers]);

  const switchStyle = useCallback((key: StyleKey) => {
    mapRef.current?.setStyle(MAP_STYLES[key]);
    setCurrentStyle(key);
  }, []);

  // External theme control (from App live map toolbar)
  useEffect(() => {
    if (!mapTheme) return;
    const next: StyleKey = mapTheme === "light" ? "navDay" : "navNight";
    if (next !== currentStyle) switchStyle(next);
    try {
      window.localStorage.setItem(MAP_THEME_KEY, mapTheme);
    } catch {
      // ignore
    }
  }, [mapTheme, currentStyle, switchStyle]);

  const handleRecenter = useCallback(() => {
    const map  = mapRef.current;
    const last = lastPositionRef.current;
    if (!map) return;
    followRef.current = true;
    setFollowing(true);
    if (last) map.flyTo({ center:[last.lng, last.lat], zoom:17, pitch:50, duration:800 });
    else initMapToUserLocation();
  }, [initMapToUserLocation]);

  const handleTogglePitch = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({ pitch: map.getPitch() > 0 ? 0 : 50, duration:600 });
  }, []);

  const fitConvoy = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const pts: Array<[number, number]> = [];
    const last = lastPositionRef.current;
    if (last) pts.push([last.lng, last.lat]);
    members.forEach((m) => {
      if (Number.isFinite(m.lng) && Number.isFinite(m.lat)) pts.push([m.lng, m.lat]);
    });
    checkpoints.forEach((c) => {
      if (Number.isFinite(c.lng) && Number.isFinite(c.lat)) pts.push([c.lng, c.lat]);
    });
    mapPins.forEach((p) => {
      if (Number.isFinite(p.lng) && Number.isFinite(p.lat)) pts.push([p.lng, p.lat]);
    });
    if (pts.length === 0) return;
    const lats = pts.map((p) => p[1]);
    const lngs = pts.map((p) => p[0]);
    map.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding: 90, duration: 700 },
    );
  }, [members, checkpoints, mapPins]);

  useImperativeHandle(
    ref,
    () => ({
      flyTo: ({ lat, lng, zoom = 14 }) => {
        const map = mapRef.current;
        if (!map) return;
        map.flyTo({ center: [lng, lat], zoom, duration: 700 });
      },
      togglePitch: () => handleTogglePitch(),
      fitConvoy: () => fitConvoy(),
      recenterOnUser: () => handleRecenter(),
      toggleHeadingUp: () => undefined,
      toggleTraffic: () => undefined,
      setTrafficVisible: () => undefined,
      zoomBy: (delta) => {
        const map = mapRef.current;
        if (!map) return;
        map.easeTo({ zoom: map.getZoom() + delta, duration: 250 });
      },
      resetNorth: () => {
        const map = mapRef.current;
        if (!map) return;
        map.easeTo({ bearing: 0, duration: 450 });
      },
      getBearing: () => Number(mapRef.current?.getBearing() ?? 0),
      getFollowUser: () => followRef.current,
    }),
    [handleTogglePitch, fitConvoy, handleRecenter],
  );

  return (
    <div style={{ position:"relative", width:"100%", height:"100%", overflow:"hidden", borderRadius:16, ...style }} className={className}>
      <div ref={containerRef} style={{ width:"100%", height:"100%" }} />

      {/* Style switcher */}
      <div className="lm-style-selector">
        {(Object.keys(MAP_STYLES) as StyleKey[]).map((key) => (
          <div key={key} className={`lm-style-pill${currentStyle===key?" active":""}`} onClick={() => switchStyle(key)}>
            {key==="navNight"?"Night":key==="navDay"?"Day":key==="satellite"?"Sat":"Map"}
          </div>
        ))}
      </div>

      {/* Speed HUD */}
      <div className="lm-speed-hud">
        <div className="lm-speed-val">{speedKmh}</div>
        <div className="lm-speed-unit">km/h</div>
      </div>

      {/* Action buttons */}
      <div className="lm-hud">
        <div className={`lm-hud-btn${following?" active":""}`} onClick={handleRecenter} title="Re-center">🎯</div>
        <div className="lm-hud-btn" onClick={handleTogglePitch} title="Toggle 3D tilt">🏔</div>
      </div>
    </div>
  );
});

export default LiveTripMap;