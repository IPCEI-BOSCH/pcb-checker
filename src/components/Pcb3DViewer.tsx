import { useMemo, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import type { Layer, Primitive } from "@/lib/gerber/types";
import type { DrcIssue } from "@/lib/drc/engine";

/**
 * Vizualizator 3D PCB — stack-up real-time: substrat FR4 1.6 mm, cupru TOP/BOTTOM,
 * mască de lipire colorabilă, serigrafie, pastă de lipit 0.127 mm, găuri PTH/NPTH
 * și markere 3D pentru erorile DRC. Geometria vine din primitivele Gerber parsate.
 */

const FR4 = 1.6;
const CU = 0.035;
const MASK_T = 0.02;
const PASTE_T = 0.127;

const MASK_COLORS: { id: string; label: string; hex: string }[] = [
  { id: "cetti", label: "Verde CETTI", hex: "#0b6b3a" },
  { id: "blue", label: "Albastru", hex: "#1d4ed8" },
  { id: "red", label: "Roșu", hex: "#b91c1c" },
  { id: "black", label: "Negru mat", hex: "#171717" },
  { id: "violet", label: "Violet", hex: "#6d28d9" },
];

const COPPER = "#c9832e";
const GOLD = "#e8c766";
const SILK = "#f2f2f2";
const PASTE_C = "#9aa0a6";

interface Props {
  layers: Layer[];
  issues: DrcIssue[];
}

function boardOutline(layers: Layer[]): [number, number][] {
  const outline = layers.find((l) => l.kind === "outline");
  if (!outline) return [[0, 0], [40, 0], [40, 40], [0, 40]];
  const segs = outline.primitives.filter((p): p is Extract<Primitive, { t: "line" }> => p.t === "line" && !p.clear);
  if (segs.length < 3) return [[0, 0], [40, 0], [40, 40], [0, 40]];
  // Chain segments into the largest closed loop.
  const tol = 0.02;
  const key = (x: number, y: number) => `${Math.round(x / tol)},${Math.round(y / tol)}`;
  const adj = new Map<string, { x: number; y: number; to: string }[]>();
  const pts = new Map<string, [number, number]>();
  for (const s of segs) {
    const a = key(s.x1, s.y1), b = key(s.x2, s.y2);
    pts.set(a, [s.x1, s.y1]); pts.set(b, [s.x2, s.y2]);
    adj.set(a, [...(adj.get(a) ?? []), { x: s.x2, y: s.y2, to: b }]);
  }
  let best: [number, number][] = [];
  for (const start of adj.keys()) {
    const loop: [number, number][] = [];
    let cur = start;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const p = pts.get(cur)!;
      loop.push(p);
      const next = (adj.get(cur) ?? []).find((e) => !seen.has(e.to));
      cur = next?.to ?? "";
    }
    if (cur === start && loop.length > best.length) best = loop;
  }
  return best.length >= 3 ? best : [[0, 0], [40, 0], [40, 40], [0, 40]];
}

/** Păstrează doar valorile finite — geometria NaN omoară întreaga scenă (bounding sphere NaN). */
const fin = (...v: number[]) => v.every((x) => Number.isFinite(x));

function shapeFrom(pts: [number, number][], cx: number, cy: number): THREE.Shape {
  const s = new THREE.Shape();
  pts.filter(([x, y]) => fin(x, y)).forEach(([x, y], i) => (i ? s.lineTo(x - cx, y - cy) : s.moveTo(x - cx, y - cy)));
  s.closePath();
  return s;
}

type ViewName = "top" | "bottom" | "iso" | "side";

/** Expune o funcție de poziționare a camerei către butoanele din afara Canvas-ului. */
function CamSync({ apiRef }: { apiRef: React.MutableRefObject<((v: ViewName) => void) | null> }) {
  const { camera } = useThree();
  useMemo(() => {
    apiRef.current = (v: ViewName) => {
      const d = 70;
      if (v === "top") camera.position.set(0, 0, d);
      else if (v === "bottom") camera.position.set(0, 0, -d);
      else if (v === "side") camera.position.set(d, 0, 2);
      else camera.position.set(d * 0.6, -d * 0.6, d * 0.6);
      camera.up.set(0, v === "side" ? 0 : 1, v === "side" ? 1 : 0);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
    };
  }, [camera, apiRef]);
  return null;
}

export function Pcb3DViewer({ layers, issues }: Props) {
  const [maskColor, setMaskColor] = useState(MASK_COLORS[0]!.hex);
  const [explode, setExplode] = useState(0);
  const [showPins, setShowPins] = useState(true);
  const [finish, setFinish] = useState<"enig" | "hasl">("enig");
  const controlsRef = useRef(null);
  const camApi = useRef<((v: ViewName) => void) | null>(null);

  const geo = useMemo(() => {
    const outline = boardOutline(layers);
    const cx = outline.reduce((a, p) => a + p[0], 0) / outline.length;
    const cy = outline.reduce((a, p) => a + p[1], 0) / outline.length;
    const holes = layers.filter((l) => l.kind === "drill").flatMap((l) => l.holes);
    const L = (kind: string) => layers.find((l) => l.kind === kind);
    return { outline, cx, cy, holes, top: L("top_copper"), bottom: L("bottom_copper"), mask: L("top_mask"), silk: L("top_silk"), paste: L("top_paste") };
  }, [layers]);

  const { cx, cy } = geo;
  const P = (x: number, y: number) => [x - cx, y - cy] as const;
  const ex = explode * 2.2; // mm de separare pe nivel

  // Substrat FR4 cu găuri reale (ExtrudeGeometry suportă holes).
  const fr4Geo = useMemo(() => {
    const shape = shapeFrom(geo.outline, cx, cy);
    for (const h of geo.holes) {
      const path = new THREE.Path();
      path.absarc(h.x - cx, h.y - cy, Math.max(0.05, h.d / 2), 0, Math.PI * 2, true);
      shape.holes.push(path);
    }
    const g = new THREE.ExtrudeGeometry(shape, { depth: FR4, bevelEnabled: false, curveSegments: 24 });
    g.rotateX(-Math.PI / 2); // plan XY → XZ, grosime pe Y
    return g;
  }, [geo, cx, cy]);

  type CuItem = { kind: "line" | "flash" | "region"; p: Primitive };
  const copperItems = (layer?: Layer): CuItem[] =>
    (layer?.primitives ?? []).filter((p) => !p.clear).map((p) => ({ kind: p.t as CuItem["kind"], p }));

  const padFinish = finish === "enig" ? GOLD : "#c0c4c8";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold text-muted-foreground">Mască:</span>
        {MASK_COLORS.map((c) => (
          <button
            key={c.id}
            onClick={() => setMaskColor(c.hex)}
            title={c.label}
            aria-label={`Mască ${c.label}`}
            className={`h-5 w-5 rounded-full border-2 ${maskColor === c.hex ? "border-foreground" : "border-transparent"}`}
            style={{ background: c.hex }}
          />
        ))}
        <span className="mx-1 h-4 w-px bg-border" />
        <span className="font-semibold text-muted-foreground">Finisaj pad-uri:</span>
        <Button size="sm" variant={finish === "enig" ? "default" : "outline"} className="h-6 px-2 text-[10px]" onClick={() => setFinish("enig")}>ENIG (auriu)</Button>
        <Button size="sm" variant={finish === "hasl" ? "default" : "outline"} className="h-6 px-2 text-[10px]" onClick={() => setFinish("hasl")}>HASL (argintiu)</Button>
        <span className="mx-1 h-4 w-px bg-border" />
        <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => camApi.current?.("top")}>Top</Button>
        <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => camApi.current?.("bottom")}>Bottom</Button>
        <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => camApi.current?.("iso")}>Iso</Button>
        <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => camApi.current?.("side")}>Secțiune</Button>
        <label className="ml-auto flex items-center gap-1"><Switch checked={showPins} onCheckedChange={setShowPins} aria-label="Markere DRC 3D" />Markere DRC</label>
      </div>
      <div className="flex items-center gap-3 text-xs">
        <span className="text-muted-foreground">Exploded Stack-Up</span>
        <Slider value={[explode * 100]} min={0} max={100} step={5} onValueChange={([v]) => setExplode((v ?? 0) / 100)} className="max-w-64" aria-label="Explodare straturi" />
      </div>
      <div className="h-[560px] overflow-hidden rounded-md border border-border bg-[#0a0f0d]">
        <Canvas camera={{ position: [45, -45, 45], fov: 40, up: [0, 0, 1] }} gl={{ antialias: true }} data-scene-ready>
          <color attach="background" args={["#0a0f0d"]} />
          <ambientLight intensity={0.55} />
          <directionalLight position={[30, -20, 60]} intensity={1.4} />
          <directionalLight position={[-30, 30, -40]} intensity={0.4} />
          <CamSync apiRef={camApi} />
          <OrbitControls ref={controlsRef} makeDefault enableDamping dampingFactor={0.12} />

          {/* Substrat FR4 */}
          <mesh geometry={fr4Geo} position={[0, 0, -FR4 / 2]}>
            <meshStandardMaterial color="#1d4a2c" roughness={0.85} metalness={0.05} />
          </mesh>

          {/* Cupru TOP / BOTTOM */}
          {([["top", geo.top, FR4 / 2 + CU / 2 + ex], ["bottom", geo.bottom, -FR4 / 2 - CU / 2 - ex]] as const).map(([side, layer, z]) =>
            copperItems(layer).map((it, i) => {
              const p = it.p;
              if (p.t === "line") {
                if (!fin(p.x1, p.y1, p.x2, p.y2, p.w) || p.w <= 0) return null;
                const [x1, y1] = P(p.x1, p.y1);
                const [x2, y2] = P(p.x2, p.y2);
                const len = Math.hypot(x2 - x1, y2 - y1);
                if (len <= 0) return null;
                const ang = Math.atan2(y2 - y1, x2 - x1);
                return (
                  <mesh key={`${side}-${i}`} position={[(x1 + x2) / 2, (y1 + y2) / 2, z]} rotation={[0, 0, ang]}>
                    <boxGeometry args={[len, Math.max(0.03, p.w), CU]} />
                    <meshStandardMaterial color={COPPER} metalness={0.85} roughness={0.3} />
                  </mesh>
                );
              }
              if (p.t === "flash") {
                if (!fin(p.x, p.y, p.w, p.h) || p.w <= 0 || p.h <= 0) return null;
                const [x, y] = P(p.x, p.y);
                return (
                  <mesh key={`${side}-${i}`} position={[x, y, z]}>
                    {p.shape === "C" || p.shape === "P" ? <cylinderGeometry args={[p.w / 2, p.w / 2, CU, 24]} /> : <boxGeometry args={[p.w, p.h, CU]} />}
                    <meshStandardMaterial color={COPPER} metalness={0.85} roughness={0.3} />
                  </mesh>
                );
              }
              if (p.t === "region" && p.pts.length > 2) {
                const g = new THREE.ExtrudeGeometry(shapeFrom(p.pts, cx, cy), { depth: CU, bevelEnabled: false });
                return (
                  <mesh key={`${side}-${i}`} geometry={g} position={[0, 0, z - CU / 2]}>
                    <meshStandardMaterial color={COPPER} metalness={0.85} roughness={0.35} side={THREE.DoubleSide} />
                  </mesh>
                );
              }
              return null;
            }),
          )}

          {/* Masca de lipire TOP — placă subțire colorată peste substrat (deschiderile rămân pad-uri expuse) */}
          <mesh position={[0, 0, FR4 / 2 + CU + MASK_T / 2 + ex * 1.6]}>
            <extrudeGeometry args={[shapeFrom(geo.outline, cx, cy), { depth: MASK_T, bevelEnabled: false }]} />
            <meshStandardMaterial color={maskColor} roughness={0.55} metalness={0.1} transparent opacity={0.96} />
          </mesh>

          {/* Pad-uri expuse prin mască (finisaj ENIG/HASL) */}
          {(geo.mask?.primitives ?? []).filter((p) => p.t === "flash" && !p.clear).map((p, i) => {
            const f = p as Extract<Primitive, { t: "flash" }>;
            const [x, y] = P(f.x, f.y);
            return (
              <mesh key={`pad-${i}`} position={[x, y, FR4 / 2 + CU + MASK_T + 0.005 + ex * 1.6]}>
                {f.shape === "C" || f.shape === "P" ? <cylinderGeometry args={[f.w / 2, f.w / 2, 0.01, 20]} /> : <boxGeometry args={[f.w, f.h, 0.01]} />}
                <meshStandardMaterial color={padFinish} metalness={0.95} roughness={0.18} />
              </mesh>
            );
          })}

          {/* Serigrafie TOP */}
          {(geo.silk?.primitives ?? []).filter((p) => p.t === "line" && !p.clear).map((p, i) => {
            const l = p as Extract<Primitive, { t: "line" }>;
            const [x1, y1] = P(l.x1, l.y1);
            const [x2, y2] = P(l.x2, l.y2);
            const len = Math.hypot(x2 - x1, y2 - y1);
            const ang = Math.atan2(y2 - y1, x2 - x1);
            return (
              <mesh key={`silk-${i}`} position={[(x1 + x2) / 2, (y1 + y2) / 2, FR4 / 2 + CU + MASK_T + 0.008 + ex * 1.6]} rotation={[0, 0, ang]}>
                <boxGeometry args={[len, Math.max(0.05, l.w), 0.005]} />
                <meshStandardMaterial color={SILK} roughness={0.9} metalness={0} />
              </mesh>
            );
          })}

          {/* Pasta de lipit (volum 0.127 mm) */}
          {(geo.paste?.primitives ?? []).filter((p) => p.t === "flash" && !p.clear).map((p, i) => {
            const f = p as Extract<Primitive, { t: "flash" }>;
            const [x, y] = P(f.x, f.y);
            return (
              <mesh key={`paste-${i}`} position={[x, y, FR4 / 2 + CU + MASK_T + PASTE_T / 2 + ex * 2.4]}>
                {f.shape === "C" || f.shape === "P" ? <cylinderGeometry args={[f.w / 2, f.w / 2, PASTE_T, 20]} /> : <boxGeometry args={[f.w, f.h, PASTE_T]} />}
                <meshStandardMaterial color={PASTE_C} metalness={0.6} roughness={0.5} />
              </mesh>
            );
          })}

          {/* Găuri: PTH metalizate, NPTH ≥2.8 mm fibră FR4 */}
          {geo.holes.map((h, i) => {
            const [x, y] = P(h.x, h.y);
            const npth = h.d >= 2.8;
            return (
              <mesh key={`hole-${i}`} position={[x, y, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[h.d / 2, h.d / 2, FR4 + 0.02, 20, 1, true]} />
                <meshStandardMaterial color={npth ? "#2c2418" : "#d8a94e"} metalness={npth ? 0.05 : 0.9} roughness={npth ? 0.95 : 0.25} side={THREE.DoubleSide} />
              </mesh>
            );
          })}

          {/* Markere 3D pentru erorile DRC */}
          {showPins &&
            issues.filter((i2) => i2.x != null && i2.y != null).map((i2, idx) => {
              const [x, y] = P(i2.x!, i2.y!);
              const col = i2.severity === "blocking" ? "#ef4444" : i2.severity === "warning" ? "#f5b83d" : "#5aa9e6";
              return (
                <group key={`pin-${idx}`} position={[x, y, FR4 / 2 + 2.5 + ex * 2.4]}>
                  <mesh rotation={[Math.PI, 0, 0]}>
                    <coneGeometry args={[0.5, 1.6, 12]} />
                    <meshStandardMaterial color={col} emissive={col} emissiveIntensity={0.5} />
                  </mesh>
                  <mesh position={[0, 0, 1.2]}>
                    <sphereGeometry args={[0.45, 12, 12]} />
                    <meshStandardMaterial color={col} emissive={col} emissiveIntensity={0.5} />
                  </mesh>
                </group>
              );
            })}
        </Canvas>
      </div>
      <p className="text-xs text-muted-foreground">
        Trage = rotire · Rotița = zoom · Click-dreapta = pan. Sliderul separă straturile pe Z (Exploded Stack-Up). Pin-urile colorate marchează erorile DRC.
      </p>
    </div>
  );
}
