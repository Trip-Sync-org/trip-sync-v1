/**
 * MapboxRouteMap.tsx  (frontend/src/components/)
 * ─────────────────────────────────────────────────────────────────────────────
 * Compact route preview map. Fetches route from /api/maps/route, draws it,
 * and fits bounds. Used in trip detail / create-event screens.
 *
 * Token: VITE_MAPBOX_PUBLIC_TOKEN
 * NO Google Maps / googleapis.com
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

type LatLng = { lat: number; lng: number };

type Props = {
  start?:      LatLng | null;
  end?:        LatLng | null;
  className?:  string;
  style?:      React.CSSProperties;
  /** Override zoom used after fitBounds (default 14) */
  maxZoom?:    number;
  interactive?: boolean;
};

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_PUBLIC_TOKEN as string;

export default function MapboxRouteMap({
  start, end,
  className, style,
  maxZoom = 14,
  interactive = false,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<mapboxgl.Map | null>(null);
  const startMkRef   = useRef<mapboxgl.Marker | null>(null);
  const endMkRef     = useRef<mapboxgl.Marker | null>(null);
  const [status, setStatus] = useState<"idle"|"loading"|"ok"|"error">("idle");
  const [info, setInfo]     = useState<{ km: number; min: number } | null>(null);

  // Init map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    mapboxgl.accessToken = MAPBOX_TOKEN;
    const map = new mapboxgl.Map({
      container:        containerRef.current,
      style:            "mapbox://styles/mapbox/navigation-night-v1",
      center:           [78.9629, 20.5937],
      zoom:             4,
      interactive,
      attributionControl: false,
    });
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Draw route whenever start/end change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Remove old markers
    startMkRef.current?.remove(); startMkRef.current = null;
    endMkRef.current?.remove();   endMkRef.current   = null;

    if (!start || !end) {
      setStatus("idle");
      setInfo(null);
      return;
    }

    // Place start/end markers immediately — route loads async
    startMkRef.current = new mapboxgl.Marker({ color:"#34A853" }).setLngLat([start.lng, start.lat]).addTo(map);
    endMkRef.current   = new mapboxgl.Marker({ color:"#EA4335" }).setLngLat([end.lng,   end.lat]).addTo(map);

    setStatus("loading");

    const draw = async () => {
      try {
        const res = await fetch("/api/maps/route", {
          method:"POST",
          headers:{ "Content-Type":"application/json" },
          body: JSON.stringify({
            origin:      { lat:start.lat, lng:start.lng },
            destination: { lat:end.lat,   lng:end.lng   },
            profile:     "driving",
          }),
        });
        if (!res.ok) throw new Error(`Route API ${res.status}`);
        const data = await res.json();
        if (!data.routes?.length) throw new Error("No routes returned");

        const { geometry, distance, duration } = data.routes[0] as {
          geometry: GeoJSON.LineString;
          distance: number;
          duration: number;
        };
        const coords = geometry.coordinates as [number,number][];

        const gj: GeoJSON.Feature<GeoJSON.LineString> = {
          type:"Feature", properties:{}, geometry:{ type:"LineString", coordinates:coords }
        };

        const waitLoad = () => new Promise<void>((resolve) => {
          if (map.isStyleLoaded()) resolve();
          else map.once("load", () => resolve());
        });
        await waitLoad();

        if (map.getSource("preview-route")) {
          (map.getSource("preview-route") as mapboxgl.GeoJSONSource).setData(gj);
        } else {
          map.addSource("preview-route", { type:"geojson", data:gj });
          map.addLayer({
            id:"preview-route-casing", type:"line", source:"preview-route",
            layout:{ "line-join":"round","line-cap":"round" },
            paint:{ "line-color":"#ffffff","line-width":8,"line-opacity":0.8 },
          });
          map.addLayer({
            id:"preview-route-line", type:"line", source:"preview-route",
            layout:{ "line-join":"round","line-cap":"round" },
            paint:{ "line-color":"#4285F4","line-width":4 },
          });
        }

        // Fit bounds
        const bounds = coords.reduce(
          (b,c) => b.extend(c as mapboxgl.LngLatLike),
          new mapboxgl.LngLatBounds(coords[0], coords[0])
        );
        map.fitBounds(bounds, { padding:40, maxZoom, duration:800 });

        setInfo({ km: distance/1000, min: Math.round(duration/60) });
        setStatus("ok");
      } catch (err) {
        console.error("MapboxRouteMap route error:", err);
        // Fallback: just fit start+end
        const bounds = new mapboxgl.LngLatBounds([start.lng,start.lat],[end.lng,end.lat]);
        map.fitBounds(bounds, { padding:40, maxZoom, duration:800 });
        setStatus("error");
      }
    };

    void draw();
  }, [start?.lat, start?.lng, end?.lat, end?.lng, maxZoom]);

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        borderRadius: 12,
        background: "#0b1220",
        ...style,
      }}
      className={className}
    >
      <div ref={containerRef} style={{ width:"100%", height:"100%" }} />

      {/* Status overlay */}
      {status === "loading" && (
        <div style={{
          position:"absolute", inset:0, display:"flex",
          alignItems:"center", justifyContent:"center",
          background:"rgba(0,0,0,0.4)", pointerEvents:"none",
        }}>
          <span style={{ color:"rgba(255,255,255,0.5)", fontSize:12 }}>Loading route…</span>
        </div>
      )}

      {/* Route info chip */}
      {status === "ok" && info && (
        <div style={{
          position:"absolute", bottom:10, left:"50%", transform:"translateX(-50%)",
          background:"rgba(10,10,20,0.85)", backdropFilter:"blur(8px)",
          border:"1px solid rgba(255,255,255,0.12)", borderRadius:20,
          padding:"5px 14px", display:"flex", gap:10, alignItems:"center",
          pointerEvents:"none",
        }}>
          <span style={{ color:"#4fc3f7", fontWeight:700, fontSize:12 }}>
            {info.km.toFixed(1)} km
          </span>
          <span style={{ color:"rgba(255,255,255,0.3)", fontSize:10 }}>·</span>
          <span style={{ color:"rgba(255,255,255,0.65)", fontWeight:600, fontSize:12 }}>
            ~{info.min} min
          </span>
        </div>
      )}

      {status === "idle" && !start && !end && (
        <div style={{
          position:"absolute", inset:0, display:"flex", flexDirection:"column",
          alignItems:"center", justifyContent:"center", gap:8, pointerEvents:"none",
        }}>
          <span style={{ fontSize:24 }}>🗺</span>
          <span style={{ color:"rgba(255,255,255,0.3)", fontSize:12 }}>Set start &amp; end to preview route</span>
        </div>
      )}
    </div>
  );
}