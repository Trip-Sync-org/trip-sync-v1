/**
 * RoutePreviewMap.tsx  (frontend/src/components/)
 * ─────────────────────────────────────────────────────────────────────────────
 * Lightweight static route summary card — no map SDK required.
 * Used in read-only contexts (e.g. trip detail header) where a full
 * interactive map is overkill. For a real rendered map use MapboxRouteMap.
 * ─────────────────────────────────────────────────────────────────────────────
 */

type LatLng = { lat: number; lng: number };

type RoutePreviewProps = {
  start?:    LatLng | null;
  end?:      LatLng | null;
  /** Distance in km (from route calculation) */
  distKm?:   number | null;
  /** Duration in minutes */
  durationMin?: number | null;
  className?: string;
};

function fmtCoord(p?: LatLng | null): string {
  if (!p) return "—";
  return `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`;
}

export default function RoutePreviewMap({
  start, end, distKm, durationMin, className,
}: RoutePreviewProps) {
  const hasRoute = start && end;

  return (
    <div
      className={className}
      style={{
        minHeight: 120,
        borderRadius: 14,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "linear-gradient(135deg,rgba(26,115,232,0.08) 0%,rgba(10,10,20,0.6) 100%)",
        padding: "16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
        <span style={{ fontSize:16 }}>🛣️</span>
        <span style={{ color:"rgba(255,255,255,0.85)", fontWeight:700, fontSize:13 }}>
          Route Preview
        </span>
        {distKm != null && durationMin != null && (
          <span style={{
            marginLeft:"auto",
            background:"rgba(66,133,244,0.15)", border:"1px solid rgba(66,133,244,0.3)",
            borderRadius:20, padding:"3px 10px",
            color:"#4fc3f7", fontSize:11, fontWeight:700,
          }}>
            {distKm.toFixed(1)} km · ~{durationMin} min
          </span>
        )}
      </div>

      {/* Points */}
      <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
        <Point icon="🟢" label="Start" value={fmtCoord(start)} />
        {hasRoute && <Connector />}
        <Point icon="🔴" label="End"   value={fmtCoord(end)} />
      </div>

      {/* Placeholder hint */}
      {!hasRoute && (
        <p style={{ color:"rgba(255,255,255,0.3)", fontSize:11, margin:0 }}>
          Set origin and destination to see route details.
        </p>
      )}
    </div>
  );
}

function Point({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
      <span style={{ fontSize:12 }}>{icon}</span>
      <span style={{ color:"rgba(255,255,255,0.35)", fontSize:10, width:32 }}>{label}</span>
      <span style={{ color:"rgba(255,255,255,0.65)", fontSize:11, fontFamily:"monospace" }}>{value}</span>
    </div>
  );
}

function Connector() {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
      <div style={{ width:12, display:"flex", justifyContent:"center" }}>
        <div style={{ width:1, height:14, background:"rgba(66,133,244,0.4)" }} />
      </div>
    </div>
  );
}