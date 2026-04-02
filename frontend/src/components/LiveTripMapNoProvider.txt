import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";

type LngLat = { lat: number; lng: number };
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
  memberStatus?: "arrived" | "on-way" | "absent";
};

export type LiveMapPin = { id: string; type: string; lat: number; lng: number; label: string; addedBy: string };
export type LiveMapCheckpoint = { id: string; name: string; lat: number; lng: number; reached: boolean; badge: string };

type Props = {
  className?: string;
  start?: LngLat | null;
  end?: LngLat | null;
  riders: LiveMapRider[];
  pins: LiveMapPin[];
  checkpoints: LiveMapCheckpoint[];
  selectedRiderId: string | null;
  onSelectRider: (id: string | null) => void;
  minimalChrome?: boolean;
  mapTheme?: MapTheme;
  onMapThemeChange?: (t: MapTheme) => void;
  userGeo?: LiveUserGeo | null;
  showUserLocation?: boolean;
  heatmapVisible?: boolean;
  heatmapPoints?: { lat: number; lng: number; weight?: number }[];
};

function cn(...classes: (string | boolean | undefined | null)[]) {
  return classes.filter(Boolean).join(" ");
}

const MAPPLS_WEB_TOKEN =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_MAPPLS_MAP_TOKEN?.trim()) ||
  "ekxxaggusljbiffcwzwvrezpnjrlqymitetk";

declare global {
  interface Window {
    mappls?: any;
  }
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
    mapTheme,
    onMapThemeChange,
    userGeo,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const readyRef = useRef(false);
  const riderMarkersRef = useRef<Map<string, any>>(new Map());
  const pinMarkersRef = useRef<any[]>([]);
  const checkpointMarkersRef = useRef<any[]>([]);
  const startMarkerRef = useRef<any>(null);
  const endMarkerRef = useRef<any>(null);
  const userMarkerRef = useRef<any>(null);
  const routeLineRef = useRef<any>(null);
  const routeCasingRef = useRef<any>(null);
  const followUserRef = useRef(true);
  const headingUpRef = useRef(true);

  const allPoints = useMemo(() => {
    const out: Array<{ lat: number; lng: number }> = [];
    if (start) out.push(start);
    if (end) out.push(end);
    riders.forEach((r) => {
      if (Number.isFinite(r.lat) && Number.isFinite(r.lng)) out.push({ lat: r.lat, lng: r.lng });
    });
    pins.forEach((p) => {
      if (Number.isFinite(p.lat) && Number.isFinite(p.lng)) out.push({ lat: p.lat, lng: p.lng });
    });
    checkpoints.forEach((c) => {
      if (Number.isFinite(c.lat) && Number.isFinite(c.lng)) out.push({ lat: c.lat, lng: c.lng });
    });
    if (userGeo && Number.isFinite(userGeo.lat) && Number.isFinite(userGeo.lng)) out.push({ lat: userGeo.lat, lng: userGeo.lng });
    return out;
  }, [start, end, riders, pins, checkpoints, userGeo]);

  const fitAll = () => {
    const map = mapRef.current;
    if (!map || allPoints.length === 0) return;
    const lats = allPoints.map((p) => p.lat);
    const lngs = allPoints.map((p) => p.lng);
    if (typeof map.fitBounds === "function") {
      map.fitBounds(
        [
          [Math.min(...lngs), Math.min(...lats)],
          [Math.max(...lngs), Math.max(...lats)],
        ],
        { padding: 80 },
      );
    }
  };

  const clearRoute = () => {
    routeLineRef.current?.remove?.();
    routeCasingRef.current?.remove?.();
    routeLineRef.current = null;
    routeCasingRef.current = null;
  };

  const drawRoute = async () => {
    const map = mapRef.current;
    if (!map || !start || !end) {
      clearRoute();
      return;
    }
    try {
      const res = await fetch("/api/maps/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ origin: start, destination: end, profile: "driving" }),
      });
      if (!res.ok) {
        clearRoute();
        return;
      }
      const body = await res.json();
      const geom = body?.routes?.[0]?.geometry;
      const coordinates = Array.isArray(geom?.coordinates) ? geom.coordinates : [];
      const path = coordinates
        .flatMap((x: any) => (Array.isArray(x?.[0]) ? x : [x]))
        .filter((c: any) => Array.isArray(c) && c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]))
        .map((c: [number, number]) => ({ lng: c[0], lat: c[1] }));
      if (path.length < 2) {
        clearRoute();
        return;
      }
      clearRoute();
      routeCasingRef.current = new window.mappls.Polyline({
        map,
        fitbounds: false,
        path,
        strokeColor: "#ffffff",
        strokeOpacity: 0.95,
        strokeWeight: 9,
      });
      routeLineRef.current = new window.mappls.Polyline({
        map,
        fitbounds: false,
        path,
        strokeColor: "#4285F4",
        strokeOpacity: 1,
        strokeWeight: 5,
      });
    } catch {
      clearRoute();
    }
  };

  useEffect(() => {
    if (!containerRef.current || !MAPPLS_WEB_TOKEN) return;
    let cancelled = false;

    const mount = () => {
      if (cancelled || mapRef.current || !window.mappls || !containerRef.current) return;
      const map = new window.mappls.Map(containerRef.current, {
        center: start ? [start.lng, start.lat] : [78.9629, 20.5937],
        zoom: start ? 11 : 4,
        zoomControl: false,
        traffic: false,
        location: false,
        search: false,
      });
      mapRef.current = map;
      const onLoad = () => {
        readyRef.current = true;
        fitAll();
      };
      if (typeof map.on === "function") map.on("load", onLoad);
      else window.setTimeout(onLoad, 700);
      if (typeof map.on === "function") {
        map.on("dragstart", () => {
          followUserRef.current = false;
        });
      }
    };

    const existing = document.querySelector(`script[data-mappls="${MAPPLS_WEB_TOKEN}"]`) as HTMLScriptElement | null;
    if (existing) {
      const t = window.setInterval(() => {
        if (window.mappls) {
          window.clearInterval(t);
          mount();
        }
      }, 180);
      return () => {
        cancelled = true;
        window.clearInterval(t);
        mapRef.current?.remove?.();
        mapRef.current = null;
      };
    }

    const script = document.createElement("script");
    script.src = `https://apis.mappls.com/advancedmaps/v1/${MAPPLS_WEB_TOKEN}/map_load?v=3.0&autopan=true`;
    script.async = true;
    script.dataset.mappls = MAPPLS_WEB_TOKEN;
    script.onload = mount;
    document.body.appendChild(script);

    return () => {
      cancelled = true;
      mapRef.current?.remove?.();
      mapRef.current = null;
    };
  }, [start?.lat, start?.lng]);

  useEffect(() => {
    if (!readyRef.current || !mapRef.current) return;
    void drawRoute();
  }, [start?.lat, start?.lng, end?.lat, end?.lng]);

  useEffect(() => {
    const map = mapRef.current;
    if (!readyRef.current || !map || !window.mappls) return;
    riderMarkersRef.current.forEach((m) => m?.remove?.());
    riderMarkersRef.current.clear();
    riders.forEach((r) => {
      if (!Number.isFinite(r.lat) || !Number.isFinite(r.lng)) return;
      const wrap = document.createElement("button");
      wrap.type = "button";
      wrap.style.border = selectedRiderId === r.id ? "2px solid #22d3ee" : "2px solid #fff";
      wrap.style.background = "#3b82f6";
      wrap.style.width = "20px";
      wrap.style.height = "20px";
      wrap.style.borderRadius = "999px";
      wrap.style.boxShadow = "0 2px 8px rgba(0,0,0,.4)";
      wrap.title = r.name;
      wrap.onclick = (e) => {
        e.stopPropagation();
        onSelectRider(selectedRiderId === r.id ? null : r.id);
      };
      const marker = new window.mappls.Marker({
        map,
        fitbounds: false,
        position: { lat: r.lat, lng: r.lng },
        html: wrap,
      });
      riderMarkersRef.current.set(r.id, marker);
    });
  }, [riders, selectedRiderId, onSelectRider]);

  useEffect(() => {
    const map = mapRef.current;
    if (!readyRef.current || !map || !window.mappls) return;
    pinMarkersRef.current.forEach((m) => m?.remove?.());
    pinMarkersRef.current = [];
    checkpoints.forEach(() => undefined);
    pins.forEach((p) => {
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return;
      const el = document.createElement("div");
      el.style.width = "14px";
      el.style.height = "14px";
      el.style.border = "2px solid #fff";
      el.style.borderRadius = "999px";
      el.style.background = "#a78bfa";
      const marker = new window.mappls.Marker({
        map,
        fitbounds: false,
        position: { lat: p.lat, lng: p.lng },
        html: el,
      });
      pinMarkersRef.current.push(marker);
    });
  }, [pins, checkpoints]);

  useEffect(() => {
    const map = mapRef.current;
    if (!readyRef.current || !map || !window.mappls) return;
    checkpointMarkersRef.current.forEach((m) => m?.remove?.());
    checkpointMarkersRef.current = [];
    checkpoints.forEach((cp) => {
      if (!Number.isFinite(cp.lat) || !Number.isFinite(cp.lng)) return;
      const el = document.createElement("div");
      el.style.width = "18px";
      el.style.height = "18px";
      el.style.border = "2px solid #fff";
      el.style.borderRadius = "999px";
      el.style.background = cp.reached ? "#34d399" : "#94a3b8";
      const marker = new window.mappls.Marker({
        map,
        fitbounds: false,
        position: { lat: cp.lat, lng: cp.lng },
        html: el,
      });
      checkpointMarkersRef.current.push(marker);
    });
  }, [checkpoints]);

  useEffect(() => {
    const map = mapRef.current;
    if (!readyRef.current || !map || !window.mappls) return;
    startMarkerRef.current?.remove?.();
    endMarkerRef.current?.remove?.();
    startMarkerRef.current = null;
    endMarkerRef.current = null;
    if (start && Number.isFinite(start.lat) && Number.isFinite(start.lng)) {
      const el = document.createElement("div");
      el.style.width = "20px";
      el.style.height = "20px";
      el.style.border = "3px solid #fff";
      el.style.borderRadius = "999px";
      el.style.background = "#22c55e";
      startMarkerRef.current = new window.mappls.Marker({
        map,
        fitbounds: false,
        position: { lat: start.lat, lng: start.lng },
        html: el,
      });
    }
    if (end && Number.isFinite(end.lat) && Number.isFinite(end.lng)) {
      const el = document.createElement("div");
      el.style.width = "20px";
      el.style.height = "20px";
      el.style.border = "3px solid #fff";
      el.style.borderRadius = "999px";
      el.style.background = "#ef4444";
      endMarkerRef.current = new window.mappls.Marker({
        map,
        fitbounds: false,
        position: { lat: end.lat, lng: end.lng },
        html: el,
      });
    }
  }, [start?.lat, start?.lng, end?.lat, end?.lng]);

  useEffect(() => {
    const map = mapRef.current;
    if (!readyRef.current || !map || !window.mappls || !userGeo) return;
    if (!Number.isFinite(userGeo.lat) || !Number.isFinite(userGeo.lng)) return;
    if (!userMarkerRef.current) {
      const el = document.createElement("div");
      el.style.width = "16px";
      el.style.height = "16px";
      el.style.borderRadius = "999px";
      el.style.border = "3px solid #fff";
      el.style.background = "#4285F4";
      userMarkerRef.current = new window.mappls.Marker({
        map,
        fitbounds: false,
        position: { lat: userGeo.lat, lng: userGeo.lng },
        html: el,
      });
    } else {
      userMarkerRef.current.setPosition({ lat: userGeo.lat, lng: userGeo.lng });
    }

    if (followUserRef.current && typeof map.flyTo === "function") {
      const bearing = headingUpRef.current ? userGeo.headingDeg ?? 0 : map.getBearing?.() ?? 0;
      map.flyTo({ center: [userGeo.lng, userGeo.lat], zoom: 16, bearing, duration: 650 });
    }
  }, [userGeo?.lat, userGeo?.lng, userGeo?.headingDeg]);

  useEffect(() => {
    if (!readyRef.current || !mapRef.current) return;
    fitAll();
  }, [allPoints]);

  useImperativeHandle(
    ref,
    () => ({
      flyTo: ({ lat, lng, zoom = 14 }) => {
        const map = mapRef.current;
        if (!map || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
        map.flyTo?.({ center: [lng, lat], zoom, duration: 800 });
      },
      togglePitch: () => {
        const map = mapRef.current;
        if (!map) return;
        const current = Number(map.getPitch?.() ?? 0);
        map.easeTo?.({ pitch: current > 10 ? 0 : 50, duration: 500 });
      },
      fitConvoy: () => fitAll(),
      recenterOnUser: (at) => {
        const map = mapRef.current;
        const p = at ?? userGeo;
        if (!map || !p) return;
        followUserRef.current = true;
        map.flyTo?.({ center: [p.lng, p.lat], zoom: 16, duration: 600 });
      },
      toggleHeadingUp: () => {
        headingUpRef.current = !headingUpRef.current;
      },
      toggleTraffic: () => undefined,
      setTrafficVisible: () => undefined,
      zoomBy: (delta) => {
        const map = mapRef.current;
        if (!map) return;
        const z = Number(map.getZoom?.() ?? 10);
        map.easeTo?.({ zoom: z + delta, duration: 250 });
      },
      resetNorth: () => {
        const map = mapRef.current;
        if (!map) return;
        map.easeTo?.({ bearing: 0, duration: 450 });
      },
      getBearing: () => Number(mapRef.current?.getBearing?.() ?? 0),
      getFollowUser: () => followUserRef.current,
    }),
    [userGeo],
  );

  if (!MAPPLS_WEB_TOKEN) {
    return (
      <div className={cn("relative h-full w-full bg-[#0b1220] p-4 text-white/80", className)}>
        Map token missing. Add `VITE_MAPPLS_MAP_TOKEN` in `.env`.
      </div>
    );
  }

  return (
    <div className={cn("relative h-full w-full overflow-hidden bg-[#0b1220] text-white", className)}>
      <div ref={containerRef} className="absolute inset-0" />
      {!minimalChrome && (
        <div className="pointer-events-none absolute left-3 top-3 z-10 rounded-md border border-white/20 bg-black/60 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white/80">
          Mappls Live
        </div>
      )}
      {!minimalChrome && (
        <button
          type="button"
          onClick={() => onMapThemeChange?.(mapTheme === "dark" ? "light" : "dark")}
          className="absolute right-3 top-3 z-10 rounded-md border border-white/20 bg-black/70 px-2 py-1 text-xs text-white/90"
          title="Toggle theme"
        >
          {mapTheme === "dark" ? "Light" : "Dark"}
        </button>
      )}
    </div>
  );
});

export default LiveTripMap;
