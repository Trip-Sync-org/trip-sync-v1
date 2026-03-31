type LatLng = { lat: number; lng: number };

type RoutePreviewProps = {
  start?: LatLng | null;
  end?: LatLng | null;
  className?: string;
};

function fmt(p?: LatLng | null): string {
  if (!p) return "—";
  return `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`;
}

export default function RoutePreview({ start, end, className }: RoutePreviewProps) {
  return (
    <div
      className={
        className ??
        "h-52 rounded-2xl border border-white/10 bg-black/40 p-4 text-xs text-white/70 flex flex-col justify-center gap-2"
      }
    >
      <p className="font-semibold text-white/90">Route Preview</p>
      <p>Start: {fmt(start)}</p>
      <p>End: {fmt(end)}</p>
      <p className="text-white/40">Map provider removed from web preview.</p>
    </div>
  );
}
