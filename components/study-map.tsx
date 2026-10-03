"use client";
import { useCallback, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Plus, Minus, RotateCcw, MapPin } from "lucide-react";
import type { StudyBundle } from "@/lib/model/contracts";
export default function StudyMap({
  bundle,
  onProject,
}: {
  bundle: StudyBundle;
  onProject: (id: string) => void;
}) {
  const [zoom, setZoom] = useState(1),
    [pan, setPan] = useState([0, 0]);
  const drag = useRef<{ x: number; y: number; pan: number[] } | null>(null);
  const point = useCallback(
    (c: number[]) => [
      (c[0] - bundle.center[0]) *
        111320 *
        Math.cos((bundle.center[1] * Math.PI) / 180) *
        0.105 +
        500,
      (bundle.center[1] - c[1]) * 111320 * 0.105 + 310,
    ],
    [bundle.center],
  );
  const roads = useMemo(
    () =>
      bundle.roads.features
        .filter((f) => f.geometry.type === "LineString")
        .map((f, i) => ({
          id: i,
          points: (f.geometry.coordinates as number[][])
            .map((c) => point(c).join(","))
            .join(" "),
          name: String(f.properties.name || ""),
          highway: String(f.properties.highway || ""),
        })),
    [bundle, point],
  );
  return (
    <div className="study-map">
      <svg
        viewBox="0 0 1000 620"
        aria-label="Rede OpenStreetMap e alvarás residenciais em um raio de 2 km"
        onPointerDown={(e) => {
          if ((e.target as Element).tagName === "circle") return;
          drag.current = { x: e.clientX, y: e.clientY, pan };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const s = 1000 / e.currentTarget.getBoundingClientRect().width;
          setPan([
            drag.current.pan[0] + (e.clientX - drag.current.x) * s,
            drag.current.pan[1] + (e.clientY - drag.current.y) * s,
          ]);
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        <defs>
          <pattern
            id="grid"
            width="35"
            height="35"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M35 0H0V35"
              fill="none"
              stroke="#dfe6ed"
              strokeWidth=".6"
            />
          </pattern>
        </defs>
        <rect width="1000" height="620" fill="#eef2f6" />
        <rect width="1000" height="620" fill="url(#grid)" />
        <g
          transform={`translate(${pan[0]} ${pan[1]}) translate(500 310) scale(${zoom}) translate(-500 -310)`}
        >
          <circle
            cx="500"
            cy="310"
            r="210"
            fill="#20a3b807"
            stroke="#5598ae"
            strokeDasharray="5 5"
          />
          {roads.map((r) => (
            <polyline
              key={r.id}
              points={r.points}
              fill="none"
              stroke={
                /Corifeu|Rio Pequeno/.test(r.name)
                  ? "#167a91"
                  : /primary|secondary|tertiary/.test(r.highway)
                    ? "#a7b5c5"
                    : "#c7d0db"
              }
              strokeWidth={
                /Corifeu|Rio Pequeno/.test(r.name)
                  ? 4
                  : /primary|secondary/.test(r.highway)
                    ? 2.5
                    : 1
              }
            >
              <title>{r.name || "Via sem nome"}</title>
            </polyline>
          ))}
          {bundle.projects.map((p) => {
            const [x, y] = point(p.coordinates);
            return (
              <circle
                key={p.id}
                cx={x}
                cy={y}
                r="5"
                fill="#e6a443"
                stroke="white"
                strokeWidth="1.5"
                role="button"
                tabIndex={0}
                aria-label={`Ver empreendimento ${p.address}`}
                onClick={() => onProject(p.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onProject(p.id);
                  }
                }}
              >
                <title>
                  {p.address} · {p.units ?? "Unidades desconhecidas"} · entrega
                  pendente
                </title>
              </circle>
            );
          })}
          <circle
            cx="500"
            cy="310"
            r="13"
            fill="#133247"
            stroke="white"
            strokeWidth="3"
          />
          <circle cx="500" cy="310" r="4" fill="#6ae3e5" />
          <text x="525" y="289" className="map-label">
            RIO PEQUENO × CORIFEU
          </text>
          <text x="520" y="328" className="map-label-sub">
            Cruzamento analisado
          </text>
          <text x="345" y="91" className="map-label-sub">
            RAIO DE 2 KM
          </text>
        </g>
      </svg>
      <div className="map-top">
        <span>
          <MapPin size={14} /> Rede viária real
        </span>
        <span>N ↑</span>
      </div>
      <div className="map-tools">
        <Button
          variant="outline"
          size="icon"
          aria-label="Ampliar mapa"
          onClick={() => setZoom((z) => Math.min(4, z * 1.25))}
        >
          <Plus />
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label="Reduzir mapa"
          onClick={() => setZoom((z) => Math.max(0.7, z / 1.25))}
        >
          <Minus />
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label="Restaurar mapa"
          onClick={() => {
            setZoom(1);
            setPan([0, 0]);
          }}
        >
          <RotateCcw />
        </Button>
      </div>
      <div className="map-legend">
        <span>
          <i style={{ background: "#167a91" }} /> Avenidas analisadas
        </span>
        <span>
          <i style={{ background: "#e6a443" }} /> Alvarás residenciais
        </span>
        <span>© OpenStreetMap contributors · ODbL</span>
      </div>
    </div>
  );
}
