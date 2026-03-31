import React, { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";
import { MAPPLS_MAP_TOKEN } from "../config";

export type MapPoint = { lat: number; lng: number };
export type MapMember = { id: string; name: string; lat: number; lng: number; speed: number; color: string };
export type MapPin = { id: string; label: string; lat: number; lng: number };
export type UserGeo = {
  lat: number;
  lng: number;
  accuracyM?: number;
  headingDeg?: number | null;
  speedMps?: number | null;
};

type Props = {
  dark: boolean;
  route: MapPoint[];
  start: MapPoint | null;
  end: MapPoint | null;
  members: MapMember[];
  pins: MapPin[];
  fitTick?: number;
  recenterPoint?: MapPoint | null;
  userGeo?: UserGeo | null;
  onMapError?: (message: string) => void;
  onReady?: () => void;
};

const mapHtml = (dark: boolean) => `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <link rel="stylesheet" href="https://apis.mappls.com/advancedmaps/api/${MAPPLS_MAP_TOKEN}/map_sdk_plugins" />
  <style>html,body,#map{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:${dark ? "#0b1220" : "#f0f2f5"};}.dot{width:14px;height:14px;border-radius:999px;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4)}.user{width:14px;height:14px;border-radius:999px;border:3px solid #fff;background:#4285F4;box-shadow:0 2px 8px rgba(0,0,0,.35)}</style>
</head>
<body>
  <div id="map"></div>
  <script src="https://apis.mappls.com/advancedmaps/v1/${MAPPLS_MAP_TOKEN}/map_load?v=3.0&autopan=true" onerror="window.__mapplsScriptError=true"></script>
  <script>
    let map = null;
    let routeLine = null;
    let startMarker = null;
    let endMarker = null;
    let userMarker = null;
    let memberMarkers = new Map();
    let pinMarkers = [];
    let latestData = null;

    const post = (m) => { try { window.ReactNativeWebView?.postMessage(JSON.stringify(m)); } catch {} };
    const showInlineError = (msg) => {
      const el = document.getElementById('map');
      if (!el) return;
      el.innerHTML = "<div style='padding:12px;color:#fecaca;background:#7f1d1d;font:12px sans-serif'>" + String(msg).replace(/</g,'&lt;') + "</div>";
    };

    function mkDot(color){
      const el = document.createElement('div');
      el.className = 'dot';
      el.style.background = color || '#3b82f6';
      return el;
    }

    function clearAllPins() {
      pinMarkers.forEach((m) => m?.remove?.());
      pinMarkers = [];
      if (startMarker) { startMarker.remove(); startMarker = null; }
      if (endMarker) { endMarker.remove(); endMarker = null; }
    }

    function drawRoute(route){
      if (!map || !window.mappls) return;
      if (routeLine?.remove) routeLine.remove();
      const path = (route || []).filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng)).map((p) => ({ lat:p.lat, lng:p.lng }));
      if (path.length < 2) return;
      routeLine = new window.mappls.Polyline({ map, fitbounds:false, path, strokeColor:"#4285F4", strokeOpacity:1, strokeWeight:5 });
    }

    function drawMarkers(data){
      if (!map || !window.mappls) return;
      clearAllPins();
      if (data.start && Number.isFinite(data.start.lat) && Number.isFinite(data.start.lng)) startMarker = new window.mappls.Marker({ map, fitbounds:false, position:{ lat:data.start.lat, lng:data.start.lng }, html:mkDot("#22c55e") });
      if (data.end && Number.isFinite(data.end.lat) && Number.isFinite(data.end.lng)) endMarker = new window.mappls.Marker({ map, fitbounds:false, position:{ lat:data.end.lat, lng:data.end.lng }, html:mkDot("#ef4444") });
      (data.pins || []).forEach((p) => {
        if (!Number.isFinite(p?.lat) || !Number.isFinite(p?.lng)) return;
        const m = new window.mappls.Marker({ map, fitbounds:false, position:{ lat:p.lat, lng:p.lng }, html:mkDot("#a78bfa") });
        pinMarkers.push(m);
      });
      const seen = new Set();
      (data.members || []).forEach((r) => {
        if (!Number.isFinite(r?.lat) || !Number.isFinite(r?.lng)) return;
        seen.add(r.id);
        const ex = memberMarkers.get(r.id);
        if (ex) ex.setPosition({ lat:r.lat, lng:r.lng });
        else memberMarkers.set(r.id, new window.mappls.Marker({ map, fitbounds:false, position:{ lat:r.lat, lng:r.lng }, html:mkDot(r.color) }));
      });
      [...memberMarkers.keys()].forEach((id) => {
        if (!seen.has(id)) { memberMarkers.get(id)?.remove?.(); memberMarkers.delete(id); }
      });
      if (data.userGeo && Number.isFinite(data.userGeo.lat) && Number.isFinite(data.userGeo.lng)) {
        if (!userMarker) {
          const el = document.createElement('div'); el.className = 'user';
          userMarker = new window.mappls.Marker({ map, fitbounds:false, position:{ lat:data.userGeo.lat, lng:data.userGeo.lng }, html:el });
        } else {
          userMarker.setPosition({ lat:data.userGeo.lat, lng:data.userGeo.lng });
        }
      }
    }

    function fit(data){
      if (!map) return;
      const pts = [];
      (data.route || []).forEach((p) => pts.push([p.lng,p.lat]));
      if (data.start) pts.push([data.start.lng,data.start.lat]);
      if (data.end) pts.push([data.end.lng,data.end.lat]);
      (data.members || []).forEach((m) => pts.push([m.lng,m.lat]));
      (data.pins || []).forEach((p) => pts.push([p.lng,p.lat]));
      if (data.userGeo) pts.push([data.userGeo.lng,data.userGeo.lat]);
      if (!pts.length) return;
      const lats = pts.map((p) => p[1]); const lngs = pts.map((p) => p[0]);
      map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 60 });
    }

    function apply(data){
      if (!map || !data) return;
      drawRoute(data.route || []);
      drawMarkers(data);
      fit(data);
    }

    function init(){
      if (window.__mapplsScriptError) {
        const msg = "Mappls SDK script failed to load";
        post({ type: "map-error", message: msg });
        showInlineError(msg);
        return;
      }
      if (!window.mappls) { setTimeout(init, 220); return; }
      map = new window.mappls.Map('map', { center:[77.2090, 28.6139], zoom:5, zoomControl:false, traffic:false, location:false, search:false });
      if (typeof map.on === 'function') {
        map.on('load', () => { if (latestData) apply(latestData); post({ type:'map-ready' }); });
      } else {
        setTimeout(() => { if (latestData) apply(latestData); post({ type:'map-ready' }); }, 900);
      }
    }
    init();
    setTimeout(() => {
      if (!map) {
        const msg = window.__mapplsScriptError
          ? "Mappls blocked loading script"
          : "Mappls SDK unavailable in WebView (token or policy issue)";
        post({ type: "map-error", message: msg });
        showInlineError(msg);
      }
    }, 7000);

    window.addEventListener('message', (evt) => {
      try {
        const msg = JSON.parse(evt.data || '{}');
        if (msg.type === 'set-data') { latestData = msg; apply(latestData); }
        else if (msg.type === 'fit') fit(msg);
        else if (msg.type === 'recenter' && msg.point && map) map.flyTo({ center:[msg.point.lng, msg.point.lat], zoom:16, duration:700 });
      } catch {}
    });
    window.onerror = (message) => { post({ type: "map-error", message: String(message || "Web map error") }); };
  </script>
</body>
</html>`;

export function LiveMapView({
  dark,
  route,
  start,
  end,
  members,
  pins,
  fitTick = 0,
  recenterPoint = null,
  userGeo = null,
  onMapError,
  onReady,
}: Props) {
  const webRef = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const html = useMemo(() => mapHtml(dark), [dark]);
  const latestPayloadRef = useRef<any>(null);

  const post = (payload: unknown) => webRef.current?.postMessage(JSON.stringify(payload));

  useEffect(() => {
    const payload = { type: "set-data", route, start, end, members, pins, userGeo };
    latestPayloadRef.current = payload;
    if (ready) post(payload);
  }, [route, start, end, members, pins, userGeo, ready]);

  useEffect(() => {
    if (!fitTick) return;
    post({ type: "fit", route, start, end, members, pins, userGeo });
  }, [fitTick, route, start, end, members, pins, userGeo]);

  useEffect(() => {
    if (!recenterPoint) return;
    post({ type: "recenter", point: recenterPoint });
  }, [recenterPoint]);

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
        onMessage={(e) => {
          try {
            const msg = JSON.parse(e.nativeEvent.data);
            if (msg?.type === "map-ready") {
              setReady(true);
              if (latestPayloadRef.current) post(latestPayloadRef.current);
              onReady?.();
            } else if (msg?.type === "map-error") {
              onMapError?.(String(msg?.message || "Map error"));
            }
          } catch {
            // ignore
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { ...StyleSheet.absoluteFillObject, backgroundColor: "#0b1220" },
});

