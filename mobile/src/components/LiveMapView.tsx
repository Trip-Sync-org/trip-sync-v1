/**
 * LiveMapView.tsx  (mobile/src/components/)
 * ─────────────────────────────────────────────────────────────────────────────
 * COMPLETE REWRITE — replaces broken Mappls SDK with Mapbox GL JS served
 * inside a React Native WebView. All functionality preserved, API identical.
 *
 * Token: EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN (from mobile/.env)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import { getMapboxPublicToken, mapboxTokenConfigError } from "../lib/mapboxPublicToken";

// ─── Types (public API — unchanged from original) ─────────────────────────────

export type MapPoint  = { lat: number; lng: number };
export type MapMember = { id: string; name: string; lat: number; lng: number; speed: number; color: string };
export type MapPin    = { id: string; label: string; lat: number; lng: number };
export type UserGeo   = {
  lat: number;
  lng: number;
  accuracyM?: number;
  headingDeg?: number | null;
  speedMps?: number | null;
};

type Props = {
  dark:           boolean;
  route:          MapPoint[];
  start:          MapPoint | null;
  end:            MapPoint | null;
  members:        MapMember[];
  pins:           MapPin[];
  fitTick?:       number;
  recenterPoint?: MapPoint | null;
  userGeo?:       UserGeo | null;
  onMapError?:    (message: string) => void;
  onReady?:       () => void;
};

export type LiveMapViewRef = {
  fitConvoy: () => void;
  recenter: (point?: MapPoint | null) => void;
  togglePitch: () => void;
  zoomBy: (delta: number) => void;
  resetNorth: () => void;
};

// ─── WebView HTML ─────────────────────────────────────────────────────────────

function buildHtml(dark: boolean, token: string): string {
  const style = dark
    ? "mapbox://styles/mapbox/navigation-night-v1"
    : "mapbox://styles/mapbox/navigation-day-v1";

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"/>
<link rel="stylesheet" href="https://api.mapbox.com/mapbox-gl-js/v2.15.0/mapbox-gl.css"/>
<style>
  html,body,#map { margin:0; padding:0; width:100%; height:100%; overflow:hidden; }
  body { background:${dark?"#0b1220":"#f0f2f5"}; }
  .mb-user-wrap { position:relative; width:24px; height:24px; }
  .mb-pulse {
    position:absolute; top:-4px; left:-4px; width:32px; height:32px;
    border-radius:50%; background:rgba(66,133,244,.3);
    animation:pulse 2s ease-out infinite; pointer-events:none;
  }
  .mb-cone {
    position:absolute; width:0; height:0;
    border-left:7px solid transparent; border-right:7px solid transparent;
    border-bottom:18px solid rgba(66,133,244,.7);
    top:-18px; left:5px; transform-origin:bottom center;
    transition:transform .4s ease;
  }
  .mb-dot-outer {
    position:absolute; top:0; left:0; width:24px; height:24px;
    background:#fff; border-radius:50%;
    box-shadow:0 2px 8px rgba(0,0,0,.5);
    display:flex; align-items:center; justify-content:center;
  }
  .mb-dot-inner { width:14px; height:14px; background:#4285F4; border-radius:50%; }
  .mb-member {
    width:32px; height:32px; border-radius:50%; border:2.5px solid #fff;
    display:flex; align-items:center; justify-content:center;
    font-weight:800; font-size:11px; color:#fff;
    box-shadow:0 2px 6px rgba(0,0,0,.4);
    position:relative;
  }
  .mb-spd {
    position:absolute; bottom:-18px; left:50%; transform:translateX(-50%);
    background:rgba(0,0,0,.75); color:#fff; padding:1px 5px;
    border-radius:8px; font-size:9px; white-space:nowrap; font-weight:700;
  }
  .mb-pin { width:12px; height:12px; border-radius:50%; border:2px solid #fff; box-shadow:0 1px 4px rgba(0,0,0,.4); }
  @keyframes pulse { 0%{transform:scale(1);opacity:.8}100%{transform:scale(3);opacity:0} }
</style>
</head>
<body>
<div id="map"></div>
<script src="https://api.mapbox.com/mapbox-gl-js/v2.15.0/mapbox-gl.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Turf.js/6.5.0/turf.min.js"></script>
<script>
const TOKEN = ${JSON.stringify(token)};
const post  = (m) => { try{ window.ReactNativeWebView?.postMessage(JSON.stringify(m)); }catch{} };
window.onerror = function(message, source, lineno, colno){
  post({ type:"map-error", message: String(message || "window.onerror") + " @ " + String(source || "inline") + ":" + String(lineno || 0) + ":" + String(colno || 0) });
  return false;
};

if (!TOKEN) {
  post({ type:"map-error", message:"EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN is not set" });
} else if (TOKEN.indexOf("sk.") === 0) {
  post({ type:"map-error", message:"Mapbox public token (pk.…) required, not secret (sk.…). Remove duplicate EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN lines in mobile/.env." });
}
if (!window.mapboxgl) post({ type:"map-error", message:"Mapbox GL JS failed to load in WebView" });

let map = null;
let latestData = null;
let userMarker = null;
let routeLayerReady = false;
let traveledLayerReady = false;
let sourceRouteCoords = [];
const memberMarkers = new Map();
let pinMarkers = [];
let startMarker = null;
let endMarker = null;

function mkDot(color) {
  const el = document.createElement("div");
  el.className = "mb-pin";
  el.style.background = color || "#3b82f6";
  return el;
}
function mkMember(name, color, speed) {
  const el = document.createElement("div");
  el.className = "mb-member";
  el.style.background = color || "#1a73e8";
  el.style.flexDirection = "column";
  el.style.alignItems = "center";
  el.style.justifyContent = "center";
  const initials = document.createElement("span");
  initials.textContent = (name || "?").substring(0, 2).toUpperCase();
  el.appendChild(initials);
  const spd = document.createElement("div");
  spd.className = "mb-spd";
  spd.textContent = Math.round(Number(speed) || 0) + " km/h";
  el.appendChild(spd);
  return el;
}
function mkUserDot(headingDeg) {
  const wrap = document.createElement("div");
  wrap.className = "mb-user-wrap";
  wrap.innerHTML = '<div class="mb-pulse"></div><div class="mb-cone" style="transform:rotate(' + (headingDeg||0) + 'deg)"></div><div class="mb-dot-outer"><div class="mb-dot-inner"></div></div>';
  return wrap;
}
function clearPins() { pinMarkers.forEach((m) => m && m.remove && m.remove()); pinMarkers = []; }

function upsertRouteLayers(coords) {
  if (!map || !map.isStyleLoaded() || !coords || coords.length < 2) return;
  sourceRouteCoords = coords;
  const route = { type:"Feature", properties:{}, geometry:{ type:"LineString", coordinates: coords } };
  if (!map.getSource("route")) {
    map.addSource("route", { type:"geojson", data: route });
    map.addLayer({ id:"route-casing", type:"line", source:"route",
      layout:{ "line-join":"round","line-cap":"round" },
      paint:{ "line-color":"#ffffff","line-width":10,"line-opacity":0.85 }});
    map.addLayer({ id:"route-line", type:"line", source:"route",
      layout:{ "line-join":"round","line-cap":"round" },
      paint:{ "line-color":"#4285F4","line-width":5 }});
  } else {
    map.getSource("route").setData(route);
  }
  routeLayerReady = true;
}

function updateRouteProgress(lng, lat) {
  if (!map || !map.isStyleLoaded() || sourceRouteCoords.length < 2 || !window.turf) return;
  const snapped = turf.nearestPointOnLine(turf.lineString(sourceRouteCoords), turf.point([lng, lat]));
  const idx = snapped.properties && typeof snapped.properties.index === "number" ? snapped.properties.index : 0;
  const traveled = sourceRouteCoords.slice(0, idx + 1);
  if (traveled.length < 2) return;
  const gj = { type:"Feature", properties:{}, geometry:{ type:"LineString", coordinates: traveled } };
  if (!map.getSource("route-traveled")) {
    map.addSource("route-traveled", { type:"geojson", data: gj });
    map.addLayer({ id:"route-traveled-line", type:"line", source:"route-traveled",
      layout:{ "line-join":"round","line-cap":"round" },
      paint:{ "line-color":"#1a73e8","line-width":6,"line-opacity":1 }});
  } else {
    map.getSource("route-traveled").setData(gj);
  }
  traveledLayerReady = true;
}

function apply(data) {
  if (!map || !data) return;

  const routeCoords = (data.route || []).filter(p => {
    const la = Number(p?.lat); const ln = Number(p?.lng);
    return Number.isFinite(la) && Number.isFinite(ln);
  }).map(p => [Number(p.lng), Number(p.lat)]);
  upsertRouteLayers(routeCoords);

  if (startMarker) { startMarker.remove(); startMarker = null; }
  if (endMarker) { endMarker.remove(); endMarker = null; }
  const sla = data.start ? Number(data.start.lat) : NaN;
  const sln = data.start ? Number(data.start.lng) : NaN;
  if (data.start && Number.isFinite(sla) && Number.isFinite(sln)) {
    startMarker = new mapboxgl.Marker({ element: mkDot("#22c55e") }).setLngLat([sln, sla]).addTo(map);
  }
  const ela = data.end ? Number(data.end.lat) : NaN;
  const eln = data.end ? Number(data.end.lng) : NaN;
  if (data.end && Number.isFinite(ela) && Number.isFinite(eln)) {
    endMarker = new mapboxgl.Marker({ element: mkDot("#ef4444") }).setLngLat([eln, ela]).addTo(map);
  }

  const seen = new Set();
  (data.members || []).forEach((m) => {
    const la = Number(m?.lat); const ln = Number(m?.lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) return;
    if (Math.abs(la) <= 1e-5 && Math.abs(ln) <= 1e-5) return;
    const mid = m.id != null && m.id !== "" ? String(m.id) : "";
    if (!mid) return;
    seen.add(mid);
    const existing = memberMarkers.get(mid);
    if (existing) {
      existing.setLngLat([ln, la]);
      try {
        const el = existing.getElement();
        if (el) el.style.zIndex = "15";
        const badge = el.querySelector(".mb-spd");
        if (badge) badge.textContent = Math.round(Number(m.speed) || 0) + " km/h";
      } catch {}
    } else {
      const mm = new mapboxgl.Marker({ element: mkMember(m.name, m.color, m.speed), anchor: "center" })
        .setLngLat([ln, la])
        .addTo(map);
      try {
        const el = mm.getElement();
        if (el) el.style.zIndex = "15";
      } catch {}
      memberMarkers.set(mid, mm);
    }
  });
  memberMarkers.forEach((marker, id) => {
    if (!seen.has(id)) {
      marker.remove();
      memberMarkers.delete(id);
    }
  });

  clearPins();
  (data.pins || []).forEach((p) => {
    const la = Number(p?.lat); const ln = Number(p?.lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) return;
    pinMarkers.push(new mapboxgl.Marker({ element: mkDot("#a78bfa"), anchor: "bottom" }).setLngLat([ln, la]).addTo(map));
  });

  if (data.userGeo) {
    const lat = Number(data.userGeo.lat); const lng = Number(data.userGeo.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      const { headingDeg } = data.userGeo;
      if (!userMarker) {
        userMarker = new mapboxgl.Marker({ element: mkUserDot(headingDeg), anchor:"center" }).setLngLat([lng, lat]).addTo(map);
        try {
          const el = userMarker.getElement();
          if (el) el.style.zIndex = "25";
        } catch {}
      } else {
        userMarker.setLngLat([lng, lat]);
        try {
          const el = userMarker.getElement();
          if (el) el.style.zIndex = "25";
        } catch {}
        const cone = userMarker.getElement().querySelector(".mb-cone");
        if (cone && headingDeg != null) cone.style.transform = "rotate(" + headingDeg + "deg)";
      }
      updateRouteProgress(lng, lat);
    }
  }
}

function fitAll(data) {
  if (!map || !data) return;
  const pts = [];
  (data.route || []).forEach((p) => {
    const la = Number(p?.lat); const ln = Number(p?.lng);
    if (Number.isFinite(la) && Number.isFinite(ln)) pts.push([ln, la]);
  });
  if (data.start) {
    const la = Number(data.start.lat); const ln = Number(data.start.lng);
    if (Number.isFinite(la) && Number.isFinite(ln)) pts.push([ln, la]);
  }
  if (data.end) {
    const la = Number(data.end.lat); const ln = Number(data.end.lng);
    if (Number.isFinite(la) && Number.isFinite(ln)) pts.push([ln, la]);
  }
  (data.members || []).forEach((m) => {
    const la = Number(m?.lat); const ln = Number(m?.lng);
    if (Number.isFinite(la) && Number.isFinite(ln)) pts.push([ln, la]);
  });
  (data.pins || []).forEach((p) => {
    const la = Number(p?.lat); const ln = Number(p?.lng);
    if (Number.isFinite(la) && Number.isFinite(ln)) pts.push([ln, la]);
  });
  if (data.userGeo) {
    const la = Number(data.userGeo.lat); const ln = Number(data.userGeo.lng);
    if (Number.isFinite(la) && Number.isFinite(ln)) pts.push([ln, la]);
  }
  if (pts.length < 1) return;
  if (pts.length === 1) {
    map.flyTo({ center: pts[0], zoom: 15, duration: 700 });
    return;
  }
  const lngs = pts.map((p) => p[0]); const lats = pts.map((p) => p[1]);
  map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 60, maxZoom: 16, duration: 800 });
}

function bootstrap() {
  if (!window.mapboxgl || !TOKEN) return false;
  try {
    if (typeof mapboxgl.supported === "function" && !mapboxgl.supported()) {
      post({ type:"map-error", message:"Mapbox GL not supported on this device WebView (WebGL unavailable)" });
      return false;
    }
    mapboxgl.accessToken = TOKEN;
    map = new mapboxgl.Map({
      container: "map",
      style: ${JSON.stringify(style)},
      center: [77.2090, 28.6139],
      zoom: 5,
      pitch: 0,
      bearing: 0,
      attributionControl: false,
    });
  } catch (e) {
    post({ type:"map-error", message:"Map init failed: " + String((e && e.message) || e || "unknown") });
    return false;
  }
  map.on("style.load", () => {
    if (sourceRouteCoords.length >= 2) upsertRouteLayers(sourceRouteCoords);
  });
  map.on("load", () => {
    post({ type: "map-ready" });
    if (latestData) { apply(latestData); fitAll(latestData); }
  });
  map.on("error", (e) => {
    post({ type: "map-error", message: (e && e.error && e.error.message) || "Mapbox GL error" });
  });
  return true;
}

if (!bootstrap()) {
  let tries = 0;
  const t = setInterval(() => {
    tries += 1;
    if (bootstrap()) clearInterval(t);
    if (tries > 30) {
      clearInterval(t);
      post({ type:"map-error", message:"Mapbox GL JS unavailable in mobile WebView" });
    }
  }, 200);
}

// ── message handler (RN → WebView) ───────────────────────────────────────────

function applySetDataPayload(msg) {
  if (!msg || msg.type !== "set-data") return;
  latestData = msg;
  if (map) apply(latestData);
}
function onRNMessage(raw) {
  try {
    const msg = JSON.parse(raw || "{}");
    if (msg.type === "set-data") {
      applySetDataPayload(msg);
    } else if (msg.type === "fit") {
      fitAll(msg);
    } else if (msg.type === "recenter" && msg.point) {
      if (map) map.flyTo({ center:[msg.point.lng, msg.point.lat], zoom:16, duration:700 });
    } else if (msg.type === "toggle-pitch") {
      if (!map) return;
      const current = Number(map.getPitch() || 0);
      map.easeTo({ pitch: current > 5 ? 0 : 50, duration: 500 });
    } else if (msg.type === "zoom-by") {
      if (!map) return;
      const dz = Number(msg.delta || 0);
      map.easeTo({ zoom: map.getZoom() + dz, duration: 250 });
    } else if (msg.type === "reset-north") {
      if (!map) return;
      map.easeTo({ bearing: 0, duration: 350 });
    }
  } catch {}
}
window.addEventListener("message", evt => onRNMessage(evt.data));
document.addEventListener("message", evt => onRNMessage(evt.data));
window.__tripSyncSetData = applySetDataPayload;

// Timeout guard (slow CDN / 4G can exceed 10s without being a hard failure)
setTimeout(() => {
  if (!map || !map.loaded()) {
    post({ type:"map-error", message:"Mapbox GL JS failed to load within 25 seconds" });
  }
}, 25000);
</script>
</body>
</html>`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const LiveMapView = forwardRef<LiveMapViewRef, Props>(function LiveMapView({
  dark,
  route,
  start,
  end,
  members,
  pins,
  fitTick      = 0,
  recenterPoint = null,
  userGeo       = null,
  onMapError,
  onReady,
}: Props, ref) {
  const webRef             = useRef<WebView>(null);
  const [ready, setReady]  = useState(false);
  const latestRef          = useRef<object | null>(null);
  const memberVersionRef   = useRef(0);
  const mapboxToken = getMapboxPublicToken();
  const tokenErr = useMemo(() => mapboxTokenConfigError(mapboxToken), [mapboxToken]);
  const tokenErrReported = useRef(false);

  useEffect(() => {
    if (!tokenErr || tokenErrReported.current) return;
    tokenErrReported.current = true;
    onMapError?.(tokenErr);
  }, [tokenErr, onMapError]);

  // Rebuild HTML only when dark mode / token changes
  const html = useMemo(() => buildHtml(dark, mapboxToken), [dark, mapboxToken]);

  const post = (payload: unknown) =>
    webRef.current?.postMessage(JSON.stringify(payload));

  /** Android WebView often drops native→page postMessage; injectApply mirrors set-data so peer markers reliably render. */
  const injectSetData = React.useCallback((payload: object) => {
    const w = webRef.current;
    if (!w) return;
    try {
      const s = JSON.stringify(payload);
      const js = `(function(){try{var p=JSON.parse(${JSON.stringify(s)});if(window.__tripSyncSetData)window.__tripSyncSetData(p);}catch(e){}true;})();`;
      w.injectJavaScript(js);
    } catch {
      /* ignore */
    }
  }, []);

  // Push data whenever any prop changes (version bumps so WebView always applies member moves)
  useEffect(() => {
    memberVersionRef.current += 1;
    const payload = {
      type: "set-data",
      version: memberVersionRef.current,
      route,
      start,
      end,
      members,
      pins,
      userGeo,
    };
    latestRef.current = payload;
    if (__DEV__) {
      console.log(
        "[LiveMapView] sending members to WebView:",
        members.map((m) => `${m.id}@${m.lat?.toFixed(4)},${m.lng?.toFixed(4)}`).join(" | "),
      );
    }
    if (ready) {
      post(payload);
      injectSetData(payload);
    }
  }, [route, start, end, members, pins, userGeo, ready, injectSetData]);

  // Fit bounds
  useEffect(() => {
    if (!fitTick) return;
    post({ type:"fit", route, start, end, members, pins, userGeo });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitTick]);

  // Recenter on user position
  useEffect(() => {
    if (!recenterPoint || !ready) return;
    post({ type:"recenter", point:recenterPoint });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recenterPoint, ready]);

  useImperativeHandle(
    ref,
    () => ({
      fitConvoy: () => {
        post({ type:"fit", route, start, end, members, pins, userGeo });
      },
      recenter: (point) => {
        const fallback = point ?? recenterPoint ?? userGeo ?? null;
        if (!fallback) return;
        post({ type: "recenter", point: { lat: fallback.lat, lng: fallback.lng } });
      },
      togglePitch: () => {
        post({ type: "toggle-pitch" });
      },
      zoomBy: (delta) => {
        post({ type: "zoom-by", delta });
      },
      resetNorth: () => {
        post({ type: "reset-north" });
      },
    }),
    [route, start, end, members, pins, userGeo, recenterPoint],
  );

  if (tokenErr) {
    return (
      <View style={[styles.wrap, styles.tokenErrPad]}>
        <Text style={styles.tokenErrText}>{tokenErr}</Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <WebView
        ref={webRef}
        originWhitelist={["*"]}
        source={{ html }}
        style={StyleSheet.absoluteFill}
        javaScriptEnabled
        domStorageEnabled
        mixedContentMode="always"
        allowsInlineMediaPlayback
        onMessage={(e) => {
          try {
            const msg = JSON.parse(e.nativeEvent.data);
            if (msg?.type === "map-ready") {
              setReady(true);
              if (latestRef.current) {
                post(latestRef.current);
                injectSetData(latestRef.current as object);
              }
              if (recenterPoint) post({ type: "recenter", point: recenterPoint });
              onReady?.();
            } else if (msg?.type === "map-error") {
              onMapError?.(String(msg?.message || "Map error"));
            }
          } catch { /* ignore */ }
        }}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { ...StyleSheet.absoluteFillObject, backgroundColor: "#0b1220" },
  tokenErrPad: { justifyContent: "center", padding: 20 },
  tokenErrText: { color: "#fecaca", fontSize: 13, lineHeight: 20 },
});