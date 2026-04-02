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
import { StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN ?? "";

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
}
if (!window.mapboxgl) post({ type:"map-error", message:"Mapbox GL JS failed to load in WebView" });

let map = null;
let latestData = null;
let userMarker = null;
let routeLayerReady = false;
let traveledLayerReady = false;
let sourceRouteCoords = [];
const memberMarkers = {};
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
  el.innerHTML = (name || "?").substring(0,2).toUpperCase();
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

  const routeCoords = (data.route || []).filter(p => Number.isFinite(p?.lat) && Number.isFinite(p?.lng)).map(p => [p.lng, p.lat]);
  upsertRouteLayers(routeCoords);

  if (startMarker) { startMarker.remove(); startMarker = null; }
  if (endMarker) { endMarker.remove(); endMarker = null; }
  if (data.start && Number.isFinite(data.start.lat) && Number.isFinite(data.start.lng)) {
    startMarker = new mapboxgl.Marker({ element: mkDot("#22c55e") }).setLngLat([data.start.lng, data.start.lat]).addTo(map);
  }
  if (data.end && Number.isFinite(data.end.lat) && Number.isFinite(data.end.lng)) {
    endMarker = new mapboxgl.Marker({ element: mkDot("#ef4444") }).setLngLat([data.end.lng, data.end.lat]).addTo(map);
  }

  const seen = new Set();
  (data.members || []).forEach((m) => {
    if (!Number.isFinite(m?.lat) || !Number.isFinite(m?.lng)) return;
    seen.add(String(m.id));
    const ex = memberMarkers[m.id];
    if (ex) {
      ex.setLngLat([m.lng, m.lat]);
    } else {
      memberMarkers[m.id] = new mapboxgl.Marker({ element: mkMember(m.name, m.color, m.speed), anchor:"center" })
        .setLngLat([m.lng, m.lat]).addTo(map);
    }
  });
  Object.keys(memberMarkers).forEach((id) => { if (!seen.has(id)) { memberMarkers[id].remove(); delete memberMarkers[id]; } });

  clearPins();
  (data.pins || []).forEach((p) => {
    if (!Number.isFinite(p?.lat) || !Number.isFinite(p?.lng)) return;
    pinMarkers.push(new mapboxgl.Marker({ element: mkDot("#a78bfa"), anchor: "bottom" }).setLngLat([p.lng, p.lat]).addTo(map));
  });

  if (data.userGeo && Number.isFinite(data.userGeo.lat) && Number.isFinite(data.userGeo.lng)) {
    const { lat, lng, headingDeg } = data.userGeo;
    if (!userMarker) {
      userMarker = new mapboxgl.Marker({ element: mkUserDot(headingDeg), anchor:"center" }).setLngLat([lng, lat]).addTo(map);
    } else {
      userMarker.setLngLat([lng, lat]);
      const cone = userMarker.getElement().querySelector(".mb-cone");
      if (cone && headingDeg != null) cone.style.transform = "rotate(" + headingDeg + "deg)";
    }
    updateRouteProgress(lng, lat);
  }
}

function fitAll(data) {
  if (!map || !data) return;
  const pts = [];
  (data.route || []).forEach((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng) && pts.push([p.lng, p.lat]));
  if (data.start) pts.push([data.start.lng, data.start.lat]);
  if (data.end) pts.push([data.end.lng, data.end.lat]);
  (data.members || []).forEach((m) => Number.isFinite(m?.lat) && Number.isFinite(m?.lng) && pts.push([m.lng, m.lat]));
  (data.pins || []).forEach((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng) && pts.push([p.lng, p.lat]));
  if (data.userGeo) pts.push([data.userGeo.lng, data.userGeo.lat]);
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

function onRNMessage(raw) {
  try {
    const msg = JSON.parse(raw || "{}");
    if (msg.type === "set-data") {
      latestData = msg;
      if (map && map.isStyleLoaded()) apply(latestData);
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

// Timeout guard
setTimeout(() => {
  if (!map || !map.loaded()) {
    post({ type:"map-error", message:"Mapbox GL JS failed to load within 10 seconds" });
  }
}, 10000);
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

  // Rebuild HTML only when dark mode changes
  const html = useMemo(() => buildHtml(dark, MAPBOX_TOKEN), [dark]);

  const post = (payload: unknown) =>
    webRef.current?.postMessage(JSON.stringify(payload));

  // Push data whenever any prop changes
  useEffect(() => {
    const payload = { type:"set-data", route, start, end, members, pins, userGeo };
    latestRef.current = payload;
    if (ready) post(payload);
  }, [route, start, end, members, pins, userGeo, ready]);

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
              if (latestRef.current) post(latestRef.current);
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
});