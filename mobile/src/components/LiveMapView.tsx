/**
 * LiveMapView.tsx  (mobile/src/components/)
 * ─────────────────────────────────────────────────────────────────────────────
 * COMPLETE REWRITE — replaces broken Mappls SDK with Mapbox GL JS served
 * inside a React Native WebView. All functionality preserved, API identical.
 *
 * Token: EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN (from mobile/.env)
 * ─────────────────────────────────────────────────────────────────────────────
 * Navigation features (Features 2-6):
 * - Camera follow with heading-up + 3D pitch (Feature 3)
 * - Off-route detection via haversine segment distance (Feature 2)
 * - Turn-by-turn current step detection + instruction posting (Feature 4)
 * - Waypoint-passed detection (Feature 2)
 * - Route progress calculation (Feature 5)
 */

import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import { getMapboxPublicToken, mapboxTokenConfigError } from "../lib/mapboxPublicToken";

// ─── Types (public API — unchanged from original) ─────────────────────────────

export type MapPoint  = { lat: number; lng: number };
export type MapMember = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  speed: number;
  color: string;
  status?: string;
};
export type MapPin    = { id: string; label: string; lat: number; lng: number; color?: string };
export type UserGeo   = {
  lat: number;
  lng: number;
  accuracyM?: number;
  headingDeg?: number | null;
  speedMps?: number | null;
};

export type RouteStep = {
  instruction: string;
  type: string;
  modifier: string;
  distance: number;
  duration: number;
  bannerInstructions: Array<{
    primary: { text: string; type: string; components: Array<{ text: string; type: string }> };
  }>;
  geometry: { coordinates: [number, number][] };
};

type Props = {
  dark:           boolean;
  route:          MapPoint[];
  start:          MapPoint | null;
  end:            MapPoint | null;
  members:        MapMember[];
  pins:           MapPin[];
  /** Highlight next-leg segment (e.g. to upcoming checkpoint) */
  activeRouteSegment?: MapPoint[] | null;
  fitTick?:       number;
  recenterPoint?: MapPoint | null;
  userGeo?:       UserGeo | null;
  /** Steps from Mapbox Directions API for turn-by-turn */
  steps?:         RouteStep[];
  /** All waypoints for progressive detection */
  waypoints?:     Array<{ lat: number; lng: number; name: string; type: string; id: string }>;
  onMapError?:    (message: string) => void;
  onReady?:       () => void;
  /** Called when WebView detects off-route condition */
  onOffRoute?:    (pos: { lat: number; lng: number }) => void;
  /** Called when WebView detects next waypoint passed */
  onWaypointPassed?: (waypointId: string) => void;
  /** Called when WebView finds current step instruction */
  onInstructionUpdate?: (instruction: { text: string; type: string; distanceToStep: number } | null) => void;
  /** Called with route progress info */
  onProgressUpdate?: (remainingDistance: number, remainingDuration: number, progressPct: number) => void;
  /** Reroute coords to send to WebView */
  rerouteCoords?: MapPoint[] | null;
  rerouteTick?: number;
};

export type LiveMapViewRef = {
  fitConvoy: () => void;
  recenter: (point?: MapPoint | null) => void;
  togglePitch: () => void;
  zoomBy: (delta: number) => void;
  resetNorth: () => void;
  /** Send a raw message to the WebView's Mapbox GL JS instance */
  postMessage: (msg: object) => void;
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

// ── Navigation state ──────────────────────────────────────────────────────────
let routeSteps = [];           // steps from backend (Mapbox Directions)
let waypointList = [];         // { lng, lat, id, name, type }
let nextWaypointIdx = 0;
let lastRerouteTime = 0;
let lastInstructionText = "";
let lastInstructionType = "";

// ── Haversine helpers ─────────────────────────────────────────────────────────
function toRad(d) { return d * Math.PI / 180; }
function haversineMeters(a, b) {
  const R = 6371000;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const la = toRad(a[1]), lb = toRad(b[1]);
  const h = Math.sin(dLat/2)**2 + Math.cos(la)*Math.cos(lb)*Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
function distToSegment(p, a, b) {
  const d = haversineMeters(a, b);
  if (d < 1) return haversineMeters(p, a);
  const t = Math.max(0, Math.min(1, (
    (p[0]-a[0])*(b[0]-a[0]) + (p[1]-a[1])*(b[1]-a[1])
  ) / (d*d)));
  const proj = [a[0] + t*(b[0]-a[0]), a[1] + t*(b[1]-a[1])];
  return haversineMeters(p, proj);
}
function distToPolyline(point, coords) {
  let min = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    min = Math.min(min, distToSegment(point, coords[i], coords[i+1]));
  }
  return min;
}
/** Sum haversine distance from index i to end of coord array */
function remainingDistanceAlongRoute(coords, fromIdx) {
  let total = 0;
  for (let i = Math.max(0, fromIdx); i < coords.length - 1; i++) {
    total += haversineMeters(coords[i], coords[i+1]);
  }
  return total;
}

function mkDot(color) {
  const el = document.createElement("div");
  el.className = "mb-pin";
  el.style.background = color || "#3b82f6";
  return el;
}
function mkMember(name, color) {
  const el = document.createElement("div");
  el.className = "mb-member";
  el.style.background = color || "#1a73e8";
  el.textContent = (name || "?").substring(0, 2).toUpperCase();
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

function upsertActiveSegment(coords) {
  if (!map || !map.isStyleLoaded() || !coords || coords.length < 2) {
    if (map && map.getLayer("active-seg")) {
      try { map.removeLayer("active-seg"); } catch {}
    }
    if (map && map.getSource("active-segment")) {
      try { map.removeSource("active-segment"); } catch {}
    }
    return;
  }
  const gj = { type:"Feature", properties:{}, geometry:{ type:"LineString", coordinates: coords } };
  if (!map.getSource("active-segment")) {
    map.addSource("active-segment", { type:"geojson", data: gj });
    map.addLayer({ id:"active-seg", type:"line", source:"active-segment",
      layout:{ "line-join":"round","line-cap":"round" },
      paint:{ "line-color":"#00E5B0","line-width":6,"line-opacity":0.95 }});
  } else {
    map.getSource("active-segment").setData(gj);
  }
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

  // Calculate remaining distance and duration, post progress
  const remDist = remainingDistanceAlongRoute(sourceRouteCoords, idx);
  const totalDist = sourceRouteCoords && sourceRouteCoords.length > 1
    ? remainingDistanceAlongRoute(sourceRouteCoords, 0) : 1;
  const progressPct = totalDist > 0 ? Math.min(100, ((totalDist - remDist) / totalDist) * 100) : 0;
  post({ type:"progress-update", remainingDistance: remDist, remainingDuration: 0, progressPct: Math.round(progressPct) });
}

/** Find the current step the user is on based on position */
function findCurrentStep(lng, lat) {
  if (!routeSteps || routeSteps.length === 0) return null;
  const point = [lng, lat];
  let bestStep = null;
  let bestDist = 50; // within 50m threshold
  for (const step of routeSteps) {
    const coords = step.geometry && step.geometry.coordinates;
    if (!coords || coords.length < 2) continue;
    const d = distToPolyline(point, coords);
    if (d < bestDist) {
      bestDist = d;
      bestStep = step;
    }
  }
  return bestStep;
}

/** Check if user is off-route */
function checkOffRoute(lng, lat) {
  if (sourceRouteCoords.length < 2) return false;
  const point = [lng, lat];
  const dist = distToPolyline(point, sourceRouteCoords);
  const OFF_ROUTE_THRESHOLD = 50; // meters
  const REROUTE_COOLDOWN = 10000; // ms
  const now = Date.now();
  if (dist > OFF_ROUTE_THRESHOLD && now - lastRerouteTime > REROUTE_COOLDOWN) {
    lastRerouteTime = now;
    return true;
  }
  return false;
}

/** Check if user passed the next waypoint */
function checkWaypointPassed(lng, lat) {
  if (!waypointList || waypointList.length === 0) return null;
  if (nextWaypointIdx >= waypointList.length) return null;
  const wp = waypointList[nextWaypointIdx];
  const dist = haversineMeters([lng, lat], [wp.lng, wp.lat]);
  if (dist < 100) {
    nextWaypointIdx++;
    return wp;
  }
  return null;
}

/** Get next waypoint for UI display */
function getNextWaypoint() {
  if (!waypointList || waypointList.length === 0) return null;
  if (nextWaypointIdx >= waypointList.length) return null;
  return waypointList[nextWaypointIdx];
}

function apply(data) {
  if (!map || !data) return;

  const routeCoords = (data.route || []).filter(p => {
    const la = Number(p?.lat); const ln = Number(p?.lng);
    return Number.isFinite(la) && Number.isFinite(ln);
  }).map(p => [Number(p.lng), Number(p.lat)]);
  upsertRouteLayers(routeCoords);

  // Store steps and waypoints
  if (data.steps && Array.isArray(data.steps)) {
    routeSteps = data.steps;
    // Post instruction for first step
    if (routeSteps.length > 0) {
      const first = routeSteps[0];
      post({ type:"instruction-update", text: first.instruction, maneuverType: first.type, distanceToStep: first.distance });
    }
  }
  if (data.waypoints && Array.isArray(data.waypoints)) {
    waypointList = data.waypoints.map(w => ({ lng: w.lng, lat: w.lat, id: w.id, name: w.name, type: w.type }));
    nextWaypointIdx = 0;
    // Post first waypoint info
    if (waypointList.length > 0) {
      post({ type:"waypoint-info", waypoint: waypointList[0] });
    }
  }

  const activeSeg = (data.activeRouteSegment || []).filter(p => {
    const la = Number(p?.lat); const ln = Number(p?.lng);
    return Number.isFinite(la) && Number.isFinite(ln);
  }).map(p => [Number(p.lng), Number(p.lat)]);
  upsertActiveSegment(activeSeg);

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
      } catch {}
    } else {
      const mm = new mapboxgl.Marker({ element: mkMember(m.name, m.color), anchor: "center" })
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
    const col = (p && p.color) ? String(p.color) : "#a78bfa";
    pinMarkers.push(new mapboxgl.Marker({ element: mkDot(col), anchor: "bottom" }).setLngLat([ln, la]).addTo(map));
  });
}

function fitAll(data) {
  if (!map || !data) return;
  apply(data);
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
function applyUserGeoPayload(ug) {
  if (!map || !ug) return;
  const lat = Number(ug.lat); const lng = Number(ug.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  const headingDeg = ug.headingDeg;
  
  // Update user marker
  if (!userMarker) {
    userMarker = new mapboxgl.Marker({ element: mkUserDot(headingDeg != null ? headingDeg : 0), anchor: "center" })
      .setLngLat([lng, lat])
      .addTo(map);
    try {
      const el = userMarker.getElement();
      if (el) el.style.zIndex = "25";
    } catch {}
  } else {
    userMarker.setLngLat([lng, lat]);
    try {
      const el = userMarker.getElement();
      if (el) el.style.zIndex = "25";
      const cone = el && el.querySelector(".mb-cone");
      if (cone && headingDeg != null) cone.style.transform = "rotate(" + headingDeg + "deg)";
    } catch {}
  }
  updateRouteProgress(lng, lat);

  // ── Feature 3: Camera follow (heading-up with pitch) ────────────────────────
  const bearing = headingDeg != null && Number.isFinite(headingDeg) ? headingDeg : map.getBearing() || 0;
  map.easeTo({
    center: [lng, lat],
    bearing: bearing,
    pitch: 45,
    zoom: 17,
    duration: 300,
  });

  // ── Feature 2: Off-route detection ──────────────────────────────────────────
  if (sourceRouteCoords.length >= 2) {
    const isOffRoute = checkOffRoute(lng, lat);
    if (isOffRoute) {
      post({ type:"reroute-needed", payload: { lat, lng } });
    }
  }

  // ── Feature 4: Current step detection ──────────────────────────────────────
  const currentStep = findCurrentStep(lng, lat);
  if (currentStep) {
    const text = currentStep.instruction || currentStep.bannerInstructions?.[0]?.primary?.text || "";
    if (text !== lastInstructionText) {
      lastInstructionText = text;
      lastInstructionType = currentStep.type;
      // Find distance from current position to next step geometry's start
      const stepCoords = currentStep.geometry?.coordinates;
      let distToStep = currentStep.distance || 0;
      if (stepCoords && stepCoords.length > 0) {
        distToStep = haversineMeters([lng, lat], stepCoords[0]);
      }
      post({
        type:"instruction-update",
        text: text,
        maneuverType: currentStep.type,
        distanceToStep: Math.round(distToStep),
      });
    }
  } else {
    if (lastInstructionText) {
      lastInstructionText = "";
      post({ type:"instruction-update", text: null, maneuverType: null, distanceToStep: 0 });
    }
  }

  // ── Feature 2: Waypoint detection ──────────────────────────────────────────
  const passedWp = checkWaypointPassed(lng, lat);
  if (passedWp) {
    post({ type:"waypoint-passed", waypointId: passedWp.id, name: passedWp.name });
    // Send next waypoint info
    const next = getNextWaypoint();
    if (next) {
      post({ type:"waypoint-info", waypoint: next });
    }
  }

  // Post speed from userGeo for speedometer
  if (ug.speedMps != null) {
    post({ type:"speed-update", speedKmh: Math.round(ug.speedMps * 3.6) });
  }
}

function onRNMessage(raw) {
  try {
    const msg = JSON.parse(raw || "{}");
    if (msg.type === "set-data") {
      applySetDataPayload(msg);
    } else if (msg.type === "update-user-geo" && msg.userGeo) {
      applyUserGeoPayload(msg.userGeo);
    } else if (msg.type === "set-steps") {
      if (msg.steps) routeSteps = msg.steps;
    } else if (msg.type === "set-waypoints") {
      if (msg.waypoints) {
        waypointList = msg.waypoints.map(w => ({ lng: w.lng, lat: w.lat, id: w.id, name: w.name, type: w.type }));
        nextWaypointIdx = 0;
      }
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
    } else if (msg.type === "set-route" && msg.coordinates) {
      // Re-route: set new route coordinates
      upsertRouteLayers(msg.coordinates);
      sourceRouteCoords = msg.coordinates;
      if (msg.steps) routeSteps = msg.steps;
      if (msg.waypoints) {
        waypointList = msg.waypoints.map(w => ({ lng: w.lng, lat: w.lat, id: w.id, name: w.name, type: w.type }));
        nextWaypointIdx = 0;
      }
    } else if (msg.type === "SET_ROUTE" && msg.payload) {
      // Handle SET_ROUTE with payload wrapper (from LiveTripScreen.handleOffRoute)
      const { coordinates, steps, waypoints, checkpoints } = msg.payload;
      console.log('[WebView] SET_ROUTE received, coords:', coordinates?.length);
      if (coordinates && coordinates.length >= 2) {
        upsertRouteLayers(coordinates);
        sourceRouteCoords = coordinates;
        if (steps) routeSteps = steps;
        if (waypoints) {
          waypointList = waypoints.map(w => ({ lng: w.lng, lat: w.lat, id: w.id, name: w.name, type: w.type }));
          nextWaypointIdx = 0;
        }
        console.log('[WebView] SET_ROUTE processed, segments:', coordinates.length);
      }
      // Render checkpoint markers
      if (window.checkpointMarkers) {
        window.checkpointMarkers.forEach(function(m) { try { m.remove(); } catch(e) {} });
      }
      window.checkpointMarkers = [];
      if (checkpoints && checkpoints.length > 0) {
        checkpoints.forEach(function(cp, i) {
          if (!cp.lat || !cp.lng) return;
          var el = document.createElement('div');
          el.style.cssText = 'width:32px;height:32px;background:#10b981;border:3px solid white;border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 2px 8px rgba(0,0,0,0.4);cursor:pointer;';
          var label = document.createElement('div');
          label.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) rotate(45deg);color:white;font-weight:bold;font-size:12px;';
          label.textContent = String(i + 1);
          el.appendChild(label);
          var marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
            .setLngLat([cp.lng, cp.lat])
            .setPopup(new mapboxgl.Popup({ offset: 25 }).setHTML('<strong>' + (cp.name || 'Checkpoint ' + (i+1)) + '</strong>'))
            .addTo(map);
          marker._passed = false;
          window.checkpointMarkers.push(marker);
        });
      }
      // Render destination marker
      if (waypoints && waypoints.length > 0) {
        var dest = waypoints[waypoints.length - 1];
        if (dest) {
          if (window._destMarker) { try { window._destMarker.remove(); } catch(e) {} }
          var destEl = document.createElement('div');
          destEl.style.cssText = 'width:20px;height:20px;background:#ef4444;border:3px solid white;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.4);';
          window._destMarker = new mapboxgl.Marker({ element: destEl }).setLngLat([dest.lng, dest.lat]).addTo(map);
        }
      }
      // Send back confirmation to RN
      post({ type: 'DEBUG', msg: 'SET_ROUTE received, coords: ' + (coordinates?.length ?? 'undefined') });
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
  activeRouteSegment = null,
  fitTick      = 0,
  recenterPoint = null,
  userGeo       = null,
  steps         = [],
  waypoints     = [],
  onMapError,
  onReady,
  onOffRoute,
  onWaypointPassed,
  onInstructionUpdate,
  onProgressUpdate,
  rerouteCoords = null,
  rerouteTick   = 0,
}: Props, ref) {
  const webRef             = useRef<WebView>(null);
  const [ready, setReady]  = useState(false);
  const latestRef           = useRef<object | null>(null);
  const memberVersionRef    = useRef(0);
  const prevFingerprintRef  = useRef("");
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

  // set-data only when member coords/status or route/pins changed (userGeo handled below)
  useEffect(() => {
    if (!ready) return;

    const memberFp = members
      .filter((m) => m.lat !== 0 && m.lng !== 0)
      .map((m) => `${m.id}:${(m.lat ?? 0).toFixed(5)},${(m.lng ?? 0).toFixed(5)},${m.status ?? ""}`)
      .sort()
      .join("|");
    const restFp = [JSON.stringify(route), JSON.stringify(start), JSON.stringify(end), JSON.stringify(pins), JSON.stringify(activeRouteSegment)].join("||");
    const full = `${restFp}::${memberFp}`;

    if (full === prevFingerprintRef.current) return;
    prevFingerprintRef.current = full;

    memberVersionRef.current += 1;
    const payload = {
      type: "set-data",
      version: memberVersionRef.current,
      route,
      start,
      end,
      members,
      pins,
      activeRouteSegment: activeRouteSegment ?? [],
      steps,
      waypoints,
    };
    latestRef.current = payload;
    post(payload);
    injectSetData(payload);
  }, [route, start, end, members, pins, activeRouteSegment, steps, waypoints, ready, injectSetData]);

  // Send userGeo updates to WebView
  useEffect(() => {
    if (!ready || !userGeo) return;
    post({ type: "update-user-geo", userGeo });
  }, [userGeo, ready]);

  // Steps / waypoints updates
  useEffect(() => {
    if (!ready) return;
    if (steps && steps.length > 0) post({ type: "set-steps", steps });
  }, [steps, ready]);

  useEffect(() => {
    if (!ready) return;
    if (waypoints && waypoints.length > 0) post({ type: "set-waypoints", waypoints });
  }, [waypoints, ready]);

  // Reroute coords
  useEffect(() => {
    if (!ready || !rerouteCoords || rerouteCoords.length < 2) return;
    const coords = rerouteCoords.map(p => [p.lng, p.lat]);
    post({ type: "set-route", coordinates: coords, steps, waypoints });
  }, [rerouteTick, ready]);

  // Fit bounds
  useEffect(() => {
    if (!fitTick) return;
    post({ type:"fit", route, start, end, members, pins, activeRouteSegment: activeRouteSegment ?? [], userGeo });
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
        post({ type:"fit", route, start, end, members, pins, activeRouteSegment: activeRouteSegment ?? [], userGeo });
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
      postMessage: (msg: object) => {
        post(msg);
      },
    }),
    [route, start, end, members, pins, activeRouteSegment, userGeo, recenterPoint],
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
            } else if (msg?.type === "reroute-needed") {
              onOffRoute?.(msg.payload);
            } else if (msg?.type === "waypoint-passed") {
              onWaypointPassed?.(msg.waypointId);
            } else if (msg?.type === "instruction-update") {
              if (msg.text) {
                onInstructionUpdate?.({ text: msg.text, type: msg.maneuverType, distanceToStep: msg.distanceToStep });
              } else {
                onInstructionUpdate?.(null);
              }
            } else if (msg?.type === "progress-update") {
              onProgressUpdate?.(msg.remainingDistance, msg.remainingDuration, msg.progressPct);
            } else if (msg?.type === "speed-update") {
              // handled via userGeo already
            } else if (msg?.type === "waypoint-info") {
              // available via remainingWaypoints state
            } else if (msg?.type === "DEBUG") {
              console.log('[WebView→RN DEBUG]', msg.msg);
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