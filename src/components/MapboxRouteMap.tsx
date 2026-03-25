import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";

type LatLng = { lat: number; lng: number };

type MapboxRouteMapProps = {
  start?: LatLng | null;
  end?: LatLng | null;
  className?: string;
};

const MAPBOX_PUBLIC_TOKEN = import.meta.env.VITE_MAPBOX_PUBLIC_TOKEN as
  | string
  | undefined;

if (MAPBOX_PUBLIC_TOKEN) {
  mapboxgl.accessToken = MAPBOX_PUBLIC_TOKEN;
}

function isValidPoint(point?: LatLng | null): point is LatLng {
  return !!point && Number.isFinite(point.lat) && Number.isFinite(point.lng);
}

export default function MapboxRouteMap({
  start,
  end,
  className,
}: MapboxRouteMapProps) {
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current || !MAPBOX_PUBLIC_TOKEN || mapRef.current) return;

    mapRef.current = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: [78.9629, 20.5937],
      zoom: 3.5,
    });

    mapRef.current.addControl(new mapboxgl.NavigationControl(), "top-right");

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isValidPoint(start)) return;

    const markers: mapboxgl.Marker[] = [];
    const startMarker = new mapboxgl.Marker({ color: "#10b981" })
      .setLngLat([start.lng, start.lat])
      .addTo(map);
    markers.push(startMarker);

    if (isValidPoint(end)) {
      const endMarker = new mapboxgl.Marker({ color: "#ffffff" })
        .setLngLat([end.lng, end.lat])
        .addTo(map);
      markers.push(endMarker);
    }

    const fitBounds = () => {
      if (isValidPoint(end)) {
        const bounds = new mapboxgl.LngLatBounds(
          [start.lng, start.lat],
          [end.lng, end.lat]
        );
        map.fitBounds(bounds, { padding: 80, duration: 500 });
      } else {
        map.flyTo({ center: [start.lng, start.lat], zoom: 12, duration: 500 });
      }
    };

    if (map.loaded()) fitBounds();
    else map.once("load", fitBounds);

    const routeSourceId = "trip-route-source";
    const routeLayerId = "trip-route-layer";

    const drawRoute = async () => {
      if (!isValidPoint(end)) return;
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
        if (!response.ok) return;
        const data = await response.json();
        const route = data?.routes?.[0]?.geometry;
        if (!route) return;

        const addOrUpdateRoute = () => {
          const source = map.getSource(routeSourceId) as mapboxgl.GeoJSONSource | undefined;
          if (source) {
            source.setData({
              type: "Feature",
              geometry: route,
              properties: {},
            });
            return;
          }

          map.addSource(routeSourceId, {
            type: "geojson",
            data: {
              type: "Feature",
              geometry: route,
              properties: {},
            },
          });
          map.addLayer({
            id: routeLayerId,
            type: "line",
            source: routeSourceId,
            layout: {
              "line-join": "round",
              "line-cap": "round",
            },
            paint: {
              "line-color": "#22d3ee",
              "line-width": 4,
              "line-opacity": 0.9,
            },
          });
        };

        if (map.loaded()) addOrUpdateRoute();
        else map.once("load", addOrUpdateRoute);
      } catch {
        // non-blocking visual enhancement
      }
    };

    drawRoute();

    return () => {
      markers.forEach((marker) => marker.remove());
      if (!map) return;
      try {
        if (map.getLayer(routeLayerId)) map.removeLayer(routeLayerId);
        if (map.getSource(routeSourceId)) map.removeSource(routeSourceId);
      } catch {
        // Map may already be tearing down (React StrictMode double-invoke).
      }
    };
  }, [start?.lat, start?.lng, end?.lat, end?.lng]);

  if (!MAPBOX_PUBLIC_TOKEN) {
    return (
      <div
        className={
          className ??
          "h-52 rounded-2xl border border-white/10 bg-black/40 flex items-center justify-center text-xs text-white/40"
        }
      >
        Mapbox public token not configured (`VITE_MAPBOX_PUBLIC_TOKEN`)
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={className ?? "h-52 rounded-2xl border border-white/10"}
    />
  );
}
