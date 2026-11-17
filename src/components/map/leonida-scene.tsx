"use client";

import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { MapControls } from "@react-three/drei";
import * as THREE from "three";
import type { MapControls as MapControlsImpl } from "three-stdlib";
import { MAP_HEIGHT, MAP_WIDTH } from "@/data/regions";
import type { MapLocation, Property, RegionId } from "@/lib/types";
import type { MapView } from "./geometry";
import { ISLAND_VIEW, REGION_FOCUS } from "./tiles";
import { cityPlan, type BuildingStyle } from "./city-plan";
import { MAP_COLORS, renderBaseLayer, renderDetailLayers, type MapLayer } from "./map-texture";

/* ------------------------------------------------------------- coordinates */

const CX = MAP_WIDTH / 2;
const CZ = MAP_HEIGHT / 2;
/** Map-world (x east, y south) -> scene (X east, Z south, Y up). */
export const toScene = (x: number, y: number) => new THREE.Vector3(x - CX, 0, y - CZ);

const FOV = 35;
const TAN_HALF = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
const PHI_2D = 0.001;
const PHI_3D = 0.86;
const MAX_PHI_3D = 1.36;
const BOUNDS = {
  minX: ISLAND_VIEW.x - 60 - CX,
  maxX: ISLAND_VIEW.x + ISLAND_VIEW.w + 60 - CX,
  minZ: ISLAND_VIEW.y - 60 - CZ,
  maxZ: ISLAND_VIEW.y + ISLAND_VIEW.h + 60 - CZ,
};
/** Scene position the home view looks at: the middle of the island. */
const HOME_TARGET = toScene(ISLAND_VIEW.x + ISLAND_VIEW.w / 2, ISLAND_VIEW.y + ISLAND_VIEW.h / 2);

export type ViewMode = "2d" | "3d";
export interface Insets {
  right: number;
  bottom: number;
}

export interface RigApi {
  focus(location: MapLocation, insets: Insets): void;
  flyToRegion(id: RegionId): void;
  reset(): void;
  zoomBy(factor: number): void;
  rotateBy(radians: number): void;
  northUp(): void;
  /** Pan by a screen-space amount in pixels. */
  panBy(dxPx: number, dyPx: number): void;
}

interface ViewState {
  target: THREE.Vector3;
  r: number;
  phi: number;
  theta: number;
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
function shortestAngle(from: number, to: number) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/* ----------------------------------------------------------------- ground */

interface GroundLayer {
  texture: THREE.CanvasTexture;
  view: MapView;
}

/**
 * The painted map: one base layer for the whole island plus high-resolution layers over
 * Vice City (drawn on top with a polygon offset), so close zooms stay sharp.
 */
export function MapGround({ onReady }: { onReady: () => void }) {
  const gl = useThree((s) => s.gl);
  const [layers, setLayers] = useState<GroundLayer[]>([]);
  const [sea, setSea] = useState<string>(MAP_COLORS.ocean);

  useEffect(() => {
    let cancelled = false;
    const made: THREE.CanvasTexture[] = [];
    const max = gl.capabilities.maxTextureSize;
    const mobile = window.matchMedia("(max-width: 768px)").matches;
    const toLayer = ({ canvas, view }: MapLayer): GroundLayer => {
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = gl.capabilities.getMaxAnisotropy();
      texture.generateMipmaps = true;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      made.push(texture);
      return { texture, view };
    };

    (async () => {
      try {
        const base = await renderBaseLayer(Math.min(max, mobile ? 3072 : 4096));
        if (cancelled) return;
        setLayers([toLayer(base)]);
        if (base.edgeColor) setSea(base.edgeColor);
        onReady();
        const details = await renderDetailLayers(max, mobile ? 0.5 : 1);
        if (cancelled) return;
        setLayers((current) => [...current, ...details.map(toLayer)]);
      } catch (err) {
        console.error("Map texture failed to render", err);
        if (!cancelled) onReady();
      }
    })();

    return () => {
      cancelled = true;
      made.forEach((t) => t.dispose());
    };
  }, [gl, onReady]);

  return (
    <group>
      {/* Endless ocean */}
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.5, 0]}>
        <planeGeometry args={[60000, 60000]} />
        <meshBasicMaterial color={sea} />
      </mesh>
      {layers.map(({ texture, view }, i) => {
        const centre = toScene(view.x + view.w / 2, view.y + view.h / 2);
        return (
          <mesh key={texture.uuid} rotation-x={-Math.PI / 2} position={[centre.x, 0, centre.z]} renderOrder={i}>
            <planeGeometry args={[view.w, view.h]} />
            <meshBasicMaterial
              map={texture}
              polygonOffset={i > 0}
              polygonOffsetFactor={-1 - i}
              polygonOffsetUnits={-4 - 4 * i}
            />
          </mesh>
        );
      })}
    </group>
  );
}

/* -------------------------------------------------------------- buildings */

const STYLE_ID: Record<BuildingStyle, number> = {
  house: 0,
  office: 1,
  tower: 2,
  glass: 3,
  deco: 4,
  warehouse: 5,
  terminal: 6,
};

const FACADE_VERTEX_HEAD = /* glsl */ `#include <common>
attribute vec3 aRoof;
attribute vec4 aDims;
attribute float aStyle;
varying vec3 vRoof;
varying vec3 vFacade;
varying vec3 vBoxNormal;
varying float vStyle;`;

const FACADE_VERTEX_BODY = /* glsl */ `#include <begin_vertex>
vRoof = aRoof;
vStyle = aStyle;
vBoxNormal = normal;
vFacade = vec3(position.x * aDims.x, position.y * aDims.y + aDims.w, position.z * aDims.z);`;

const FACADE_FRAGMENT_HEAD = /* glsl */ `#include <common>
varying vec3 vRoof;
varying vec3 vFacade;
varying vec3 vBoxNormal;
varying float vStyle;
float bHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }`;

const FACADE_FRAGMENT_BODY = /* glsl */ `#include <color_fragment>
{
  vec3 n = normalize(vBoxNormal);
  if (n.y > 0.5) {
    diffuseColor.rgb = vRoof;
  } else if (n.y > -0.5) {
    float u = abs(n.x) > 0.5 ? vFacade.z : vFacade.x;
    float v = vFacade.y;
    int style = int(vStyle + 0.5);
    vec3 sky = mix(vec3(0.16, 0.22, 0.32), vec3(0.62, 0.72, 0.84), clamp(v / 70.0, 0.0, 1.0));
    if (style == 1 || style == 2) {
      float fh = style == 2 ? 0.55 : 0.62;
      float cw = style == 2 ? 0.5 : 0.7;
      vec2 cell = vec2(floor(u / cw), floor(v / fh));
      float fu = fract(u / cw);
      float fv = fract(v / fh);
      float win = step(0.2, fu) * step(fu, 0.8) * step(0.28, fv) * step(fv, 0.84) * step(0.9, v);
      vec3 glass = sky * (0.8 + 0.4 * bHash(cell));
      diffuseColor.rgb = mix(diffuseColor.rgb, glass, win * 0.85);
    } else if (style == 3) {
      float fu = fract(u / 0.9);
      float fv = fract(v / 0.55);
      float frame = max(step(fu, 0.05), step(fv, 0.08));
      vec3 glass = mix(diffuseColor.rgb * 0.75, sky, 0.45) * (0.9 + 0.2 * bHash(vec2(floor(u / 0.9), floor(v / 2.2))));
      diffuseColor.rgb = mix(glass, diffuseColor.rgb * 1.08, frame * 0.7);
    } else if (style == 4 || style == 6) {
      float fv = fract(v / 0.7);
      float band = step(0.36, fv) * step(fv, 0.72) * step(0.6, v);
      vec3 glass = mix(vec3(0.18, 0.32, 0.38), sky, 0.5);
      diffuseColor.rgb = mix(diffuseColor.rgb, glass, band * 0.8);
    } else if (style == 5) {
      diffuseColor.rgb *= 0.94 + 0.06 * step(0.5, fract(u / 0.35));
    }
    diffuseColor.rgb *= mix(0.6, 1.0, clamp(v / 2.2, 0.0, 1.0));
  }
}`;

/**
 * Lambert material with facade detail drawn in the shader from each instance's real size,
 * so windows stay the same size on every building: punched windows on offices, curtain-wall
 * glass on towers, ribbon windows on Art Deco hotels, roof colour on top faces and a little
 * ambient occlusion at street level.
 */
function makeBuildingMaterial() {
  const material = new THREE.MeshLambertMaterial();
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", FACADE_VERTEX_HEAD)
      .replace("#include <begin_vertex>", FACADE_VERTEX_BODY);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", FACADE_FRAGMENT_HEAD)
      .replace("#include <color_fragment>", FACADE_FRAGMENT_BODY);
  };
  material.customProgramCacheKey = () => "dynasty8-buildings-v1";
  return material;
}

export function Buildings({ visible }: { visible: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const footprints = useMemo(() => cityPlan().footprints, []);
  const material = useMemo(() => makeBuildingMaterial(), []);
  const geometry = useMemo(() => {
    const g = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const n = footprints.length;
    const roof = new Float32Array(n * 3);
    const dims = new Float32Array(n * 4);
    const style = new Float32Array(n);
    const c = new THREE.Color();
    footprints.forEach((f, i) => {
      c.set(f.roof);
      roof.set([c.r, c.g, c.b], i * 3);
      dims.set([f.w, f.top - f.base, f.h, f.base], i * 4);
      style[i] = STYLE_ID[f.style];
    });
    g.setAttribute("aRoof", new THREE.InstancedBufferAttribute(roof, 3));
    g.setAttribute("aDims", new THREE.InstancedBufferAttribute(dims, 4));
    g.setAttribute("aStyle", new THREE.InstancedBufferAttribute(style, 1));
    return g;
  }, [footprints]);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const color = new THREE.Color();
    footprints.forEach((f, i) => {
      const p = toScene(f.x + f.w / 2, f.y + f.h / 2);
      p.y = f.base;
      // Map y grows south (= scene +Z), so a clockwise map rotation is a negative turn about +Y.
      q.setFromAxisAngle(up, f.rot ? (-f.rot * Math.PI) / 180 : 0);
      m.compose(p, q, new THREE.Vector3(f.w, f.top - f.base, f.h));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, color.set(f.wall));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [footprints]);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  return (
    <instancedMesh
      ref={ref}
      args={[geometry, material, footprints.length]}
      visible={visible}
      frustumCulled={false}
    />
  );
}

/* ---------------------------------------------------------------- markers */

function Beacon({ location }: { location: MapLocation }) {
  const ring = useRef<THREE.Mesh>(null);
  const p = toScene(location.x, location.y);
  useFrame(({ clock }) => {
    const mesh = ring.current;
    if (!mesh) return;
    const t = (clock.getElapsedTime() % 1.6) / 1.6;
    mesh.scale.setScalar(1 + t * 3);
    (mesh.material as THREE.MeshBasicMaterial).opacity = 0.75 * (1 - t);
  });
  return (
    <group position={p}>
      <mesh ref={ring} rotation-x={-Math.PI / 2} position-y={0.6}>
        <ringGeometry args={[5, 7, 40]} />
        <meshBasicMaterial color="#ff6b9d" transparent depthWrite={false} />
      </mesh>
      <mesh position-y={70}>
        <cylinderGeometry args={[1.6, 1.6, 140, 12, 1, true]} />
        <meshBasicMaterial color="#ff6b9d" transparent opacity={0.35} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
    </group>
  );
}

/** Pulsing ring + light beam under the selected property. */
export function SelectionBeacon({ location }: { location: MapLocation | null }) {
  if (!location) return null;
  return <Beacon location={location} />;
}

/** Space (px) the hover card needs above a pin before it flips below it; half its width. */
const HOVER_CARD_CLEARANCE = 170;
const HOVER_CARD_HALF_W = 130;

export interface PinCluster {
  id: string;
  /** Member slugs, in a stable order (the fan-out uses it for petal angles). */
  slugs: string[];
}

/** Screen distance (px) under which pins merge into a cluster. */
const CLUSTER_RADIUS = 34;

/** Angle between neighbouring petals in a fan (about 45°, so pin heads just clear each other). */
const PETAL_STEP = 0.78;
/** Fan-out animation: each petal starts at the top and sweeps round to its place. */
const PETAL_MS = 380;
const PETAL_STAGGER_MS = 45;

/**
 * Petal layout for a fanned-out cluster: angle around the centre and tip distance from it.
 * Up to six pins fan out in an arc over the top of the badge; bigger groups go all the way
 * round, starting from the top.
 */
export function petalLayout(index: number, count: number) {
  const fan = PETAL_STEP * (count - 1) <= Math.PI * 1.4;
  const step = fan ? PETAL_STEP : (Math.PI * 2) / count;
  const angle = -Math.PI / 2 + (index - (fan ? (count - 1) / 2 : 0)) * step;
  const tip = fan ? 16 : Math.max(18, count * 6.5);
  return { angle, tip, rotation: angle + Math.PI / 2 };
}

/**
 * Projects each pin's map position to screen space every frame and moves the matching DOM
 * element (rendered by LeonidaMap). Pins that crowd together on screen are grouped into
 * clusters: their own elements hide and the cluster badge shows instead, unless that cluster
 * is fanned out, in which case its pins are laid out as petals around the badge.
 */
export function PinProjector({
  properties,
  pinEls,
  clusterEls,
  selectedRef,
  expandedRef,
  expandedAtRef,
  onClusters,
}: {
  properties: Property[];
  pinEls: RefObject<Map<string, HTMLElement>>;
  clusterEls: RefObject<Map<string, HTMLElement>>;
  selectedRef: RefObject<string | null>;
  expandedRef: RefObject<string | null>;
  /** performance.now() when the current cluster was fanned out (drives the sweep animation). */
  expandedAtRef: RefObject<number>;
  onClusters: (clusters: PinCluster[]) => void;
}) {
  const points = useMemo(
    () =>
      properties
        .filter((p) => p.location)
        .map((p) => ({ slug: p.slug, v: toScene(p.location!.x, p.location!.y) }))
        .sort((a, b) => a.slug.localeCompare(b.slug)),
    [properties],
  );
  const tmp = useMemo(() => new THREE.Vector3(), []);
  const lastSignature = useRef("");
  const reduceMotion = useMemo(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  useFrame(({ camera, size }) => {
    const els = pinEls.current;
    if (!els) return;
    // The camera rig moves the camera earlier in this frame; its world matrix is normally only
    // refreshed at render time, so update it now or pins trail the map by a frame while it flies.
    camera.updateMatrixWorld();

    const screen = points.map(({ slug, v }) => {
      tmp.copy(v).project(camera);
      return {
        slug,
        v,
        visible: tmp.z < 1 && Math.abs(tmp.x) < 1.3 && Math.abs(tmp.y) < 1.3,
        x: ((tmp.x + 1) / 2) * size.width,
        y: ((1 - tmp.y) / 2) * size.height,
      };
    });

    // Greedy clustering in screen space; the selected pin always stands alone.
    const clusterOf = new Map<string, { id: string; index: number; count: number; cx: number; cy: number }>();
    const clusters: PinCluster[] = [];
    const centres = new Map<string, [number, number]>();
    const taken = new Set<string>();
    for (const a of screen) {
      if (!a.visible || taken.has(a.slug) || a.slug === selectedRef.current) continue;
      const members = screen.filter(
        (b) =>
          b.visible &&
          !taken.has(b.slug) &&
          b.slug !== selectedRef.current &&
          Math.hypot(b.x - a.x, b.y - a.y) < CLUSTER_RADIUS,
      );
      if (members.length < 2) continue;
      members.forEach((m) => taken.add(m.slug));
      const id = members.map((m) => m.slug).join("|");
      const cx = members.reduce((s, m) => s + m.x, 0) / members.length;
      const cy = members.reduce((s, m) => s + m.y, 0) / members.length;
      clusters.push({ id, slugs: members.map((m) => m.slug) });
      centres.set(id, [cx, cy]);
      members.forEach((m, index) => clusterOf.set(m.slug, { id, index, count: members.length, cx, cy }));
    }

    const signature = clusters.map((c) => c.id).join(",");
    if (signature !== lastSignature.current) {
      lastSignature.current = signature;
      onClusters(clusters);
    }

    for (const p of screen) {
      const el = els.get(p.slug);
      if (!el) continue;
      // Let the hover card flip below / shift inward when the pin is near an edge of the map.
      el.dataset.flip = p.y < HOVER_CARD_CLEARANCE ? "1" : "";
      el.dataset.edge = p.x < HOVER_CARD_HALF_W ? "l" : p.x > size.width - HOVER_CARD_HALF_W ? "r" : "";
      const c = clusterOf.get(p.slug);
      if (!p.visible || (c && expandedRef.current !== c.id)) {
        el.style.display = "none";
        continue;
      }
      el.style.display = "";
      if (c) {
        const final = petalLayout(c.index, c.count);
        const elapsed = performance.now() - expandedAtRef.current - c.index * PETAL_STAGGER_MS;
        const t = reduceMotion ? 1 : 1 - Math.pow(1 - clamp(elapsed / PETAL_MS, 0, 1), 3);
        // Start at the top (-90°) and sweep round to the final angle.
        const angle = -Math.PI / 2 + (final.angle + Math.PI / 2) * t;
        const tip = final.tip * (0.3 + 0.7 * t);
        el.style.transform = `translate3d(${(c.cx + Math.cos(angle) * tip).toFixed(1)}px, ${(c.cy + Math.sin(angle) * tip).toFixed(1)}px, 0)`;
        el.style.setProperty("--petal-rotation", `${(angle + Math.PI / 2).toFixed(3)}rad`);
        el.style.opacity = t >= 1 ? "" : Math.min(1, t * 2.5).toFixed(2);
        el.style.zIndex = String(200000 + c.index);
        continue;
      }
      el.style.opacity = "";
      el.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0)`;
      // Nearer pins on top. Hovered/selected pins are lifted above everything by CSS in LeonidaMap.
      el.style.zIndex = String(Math.max(0, 50000 - Math.round(p.v.distanceTo(camera.position))));
    }

    const cEls = clusterEls.current;
    if (!cEls) return;
    // Badges for clusters that no longer exist are unmounted by LeonidaMap on the next render.
    for (const [id, centre] of centres) {
      const el = cEls.get(id);
      if (!el) continue;
      el.style.display = "";
      el.style.transform = `translate3d(${centre[0].toFixed(1)}px, ${centre[1].toFixed(1)}px, 0)`;
    }
  });

  return null;
}

/* ------------------------------------------------------------- camera rig */

interface CameraRigProps {
  ref?: Ref<RigApi>;
  mode: ViewMode;
  /** True once the map texture is ready — triggers the intro fly-in. */
  introReady: boolean;
  compassRef: RefObject<HTMLElement | null>;
  /** If set when the intro plays, fly to this location instead of the overview. */
  introFocusRef: RefObject<{ location: MapLocation; insets: Insets } | null>;
  onZoomBand: (near: boolean) => void;
  onInteract: () => void;
}

export function CameraRig({ ref, mode, introReady, compassRef, introFocusRef, onZoomBand, onInteract }: CameraRigProps) {
  const controls = useRef<MapControlsImpl>(null);
  const get = useThree((s) => s.get);
  const size = useThree((s) => s.size);
  const cam = () => get().camera as THREE.PerspectiveCamera;
  const tween = useRef<{ from: ViewState; to: ViewState; t0: number; dur: number; done?: () => void } | null>(null);
  const interacted = useRef(false);
  const lastBand = useRef<boolean | null>(null);
  const introPlayed = useRef(false);
  const modeRef = useRef(mode);

  const homeRadius = useMemo(() => {
    const aspect = size.width / Math.max(1, size.height);
    return Math.max((ISLAND_VIEW.h * 0.53) / TAN_HALF, (ISLAND_VIEW.w * 0.56) / (TAN_HALF * aspect));
  }, [size.width, size.height]);

  const home = (m: ViewMode): ViewState =>
    m === "2d"
      ? { target: HOME_TARGET.clone(), r: homeRadius, phi: PHI_2D, theta: 0 }
      : { target: HOME_TARGET.clone().add(new THREE.Vector3(0, 0, 90)), r: homeRadius * 0.8, phi: PHI_3D, theta: 0 };

  const read = (): ViewState => {
    const c = controls.current!;
    const offset = cam().position.clone().sub(c.target);
    const s = new THREE.Spherical().setFromVector3(offset);
    return { target: c.target.clone(), r: s.radius, phi: s.phi, theta: s.theta };
  };

  /** Camera state that frames `location`, offset so it sits in the area not covered by overlays. */
  const focusView = (location: MapLocation, insets: Insets, from: ViewState): ViewState => {
    const r = Math.min(from.r, homeRadius * 0.3);
    const target = toScene(location.x, location.y);
    const wpp = (2 * r * TAN_HALF) / Math.max(1, size.height);
    const right = new THREE.Vector3(Math.cos(from.theta), 0, -Math.sin(from.theta));
    const up = new THREE.Vector3(-Math.sin(from.theta), 0, -Math.cos(from.theta));
    const verticalStretch = Math.min(2, 1 / Math.max(0.35, Math.cos(from.phi)));
    target.addScaledVector(right, (insets.right / 2) * wpp);
    target.addScaledVector(up, -(insets.bottom / 2) * wpp * verticalStretch);
    return { target, r, phi: from.phi, theta: from.theta };
  };

  const write = (v: ViewState) => {
    const c = controls.current!;
    const camera = cam();
    c.target.copy(v.target);
    camera.position.copy(v.target).add(new THREE.Vector3().setFromSphericalCoords(v.r, v.phi, v.theta));
    camera.lookAt(v.target);
  };

  const applyConstraints = (m: ViewMode, permissive = false) => {
    const c = controls.current;
    if (!c) return;
    c.minDistance = 60;
    c.maxDistance = homeRadius * 1.6;
    if (permissive) {
      c.minPolarAngle = 0;
      c.maxPolarAngle = MAX_PHI_3D;
      c.minAzimuthAngle = -Infinity;
      c.maxAzimuthAngle = Infinity;
      return;
    }
    if (m === "2d") {
      c.minPolarAngle = 0;
      c.maxPolarAngle = PHI_2D;
      c.minAzimuthAngle = 0;
      c.maxAzimuthAngle = 0;
      c.enableRotate = false;
    } else {
      c.minPolarAngle = 0;
      c.maxPolarAngle = MAX_PHI_3D;
      c.minAzimuthAngle = -Infinity;
      c.maxAzimuthAngle = Infinity;
      c.enableRotate = true;
    }
  };

  const flyTo = (to: ViewState, dur = 900, done?: () => void) => {
    if (!controls.current) return;
    applyConstraints(modeRef.current, true);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    tween.current = {
      from: read(),
      to,
      t0: performance.now(),
      dur: reduce ? 1 : dur,
      done: () => {
        applyConstraints(modeRef.current);
        done?.();
      },
    };
  };

  // Mode changes: tilt / flatten in place.
  useEffect(() => {
    modeRef.current = mode;
    if (!controls.current || !introPlayed.current) {
      applyConstraints(mode);
      return;
    }
    const v = read();
    flyTo({
      target: v.target,
      r: mode === "3d" ? v.r * 0.85 : v.r / 0.85,
      phi: mode === "3d" ? PHI_3D : PHI_2D,
      theta: mode === "3d" ? v.theta : 0,
    }, 800);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Initial framing, refitted on resize until the user moves the camera.
  useEffect(() => {
    if (!controls.current) return;
    if (!introPlayed.current || !interacted.current) {
      write(introPlayed.current ? home(modeRef.current) : modeRef.current === "2d" ? { ...home("2d"), r: homeRadius * 1.5 } : { ...home(modeRef.current), r: homeRadius * 1.5, phi: 0.25, theta: -0.6 });
      applyConstraints(modeRef.current);
      controls.current.update();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [homeRadius]);

  // Intro fly-in once the map is painted.
  useEffect(() => {
    if (!introReady || introPlayed.current || !controls.current) return;
    introPlayed.current = true;
    const pending = introFocusRef.current;
    if (pending) {
      interacted.current = true;
      flyTo(focusView(pending.location, pending.insets, home(modeRef.current)), 2200);
    } else {
      flyTo(home(modeRef.current), 2200);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [introReady]);

  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const onStart = () => {
      tween.current = null;
      applyConstraints(modeRef.current);
      interacted.current = true;
      onInteract();
    };
    c.addEventListener("start", onStart);
    return () => c.removeEventListener("start", onStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onInteract]);

  useImperativeHandle(ref, () => ({
    focus(location, insets) {
      if (!controls.current) return;
      interacted.current = true;
      flyTo(focusView(location, insets, read()));
    },
    flyToRegion(id) {
      if (!controls.current) return;
      interacted.current = true;
      const f = REGION_FOCUS[id];
      const aspect = size.width / Math.max(1, size.height);
      const r = Math.max(f.span / 2 / TAN_HALF, f.span / 2 / (TAN_HALF * aspect)) * (modeRef.current === "3d" ? 0.85 : 1.05);
      const v = read();
      flyTo({ target: toScene(f.x, f.y), r, phi: v.phi, theta: v.theta }, 1100);
    },
    reset() {
      interacted.current = false;
      flyTo(home(modeRef.current), 1000);
    },
    zoomBy(factor) {
      if (!controls.current) return;
      interacted.current = true;
      const v = read();
      flyTo({ ...v, r: clamp(v.r * factor, 60, homeRadius * 1.6) }, 320);
    },
    rotateBy(radians) {
      if (!controls.current || modeRef.current === "2d") return;
      interacted.current = true;
      const v = read();
      flyTo({ ...v, theta: v.theta + radians }, 450);
    },
    northUp() {
      if (!controls.current) return;
      const v = read();
      flyTo({ ...v, theta: 0 }, 600);
    },
    panBy(dxPx, dyPx) {
      if (!controls.current) return;
      interacted.current = true;
      const v = read();
      const wpp = (2 * v.r * TAN_HALF) / Math.max(1, size.height);
      const right = new THREE.Vector3(Math.cos(v.theta), 0, -Math.sin(v.theta));
      const up = new THREE.Vector3(-Math.sin(v.theta), 0, -Math.cos(v.theta));
      const target = v.target.clone().addScaledVector(right, dxPx * wpp).addScaledVector(up, -dyPx * wpp);
      flyTo({ ...v, target }, 220);
    },
  }));

  useFrame(({ camera: frameCamera, scene }) => {
    const c = controls.current;
    if (!c) return;
    const camera = frameCamera as THREE.PerspectiveCamera;

    const tw = tween.current;
    if (tw) {
      const t = clamp((performance.now() - tw.t0) / tw.dur, 0, 1);
      const e = ease(t);
      write({
        target: tw.from.target.clone().lerp(tw.to.target, e),
        r: Math.exp(Math.log(tw.from.r) + (Math.log(tw.to.r) - Math.log(tw.from.r)) * e),
        phi: tw.from.phi + (tw.to.phi - tw.from.phi) * e,
        theta: tw.from.theta + shortestAngle(tw.from.theta, tw.to.theta) * e,
      });
      if (t >= 1) {
        tween.current = null;
        tw.done?.();
      }
    }

    // Keep the map in reach.
    const t = c.target;
    const dx = clamp(t.x, BOUNDS.minX, BOUNDS.maxX) - t.x;
    const dz = clamp(t.z, BOUNDS.minZ, BOUNDS.maxZ) - t.z;
    if (dx || dz) {
      t.x += dx;
      t.z += dz;
      camera.position.x += dx;
      camera.position.z += dz;
    }

    const r = camera.position.distanceTo(t);
    camera.near = Math.max(1, r / 200);
    camera.far = r * 8 + 2000;
    camera.updateProjectionMatrix();
    if (scene.fog instanceof THREE.Fog) {
      scene.fog.near = r * 1.4;
      scene.fog.far = r * 5;
    }

    const near = r < homeRadius * 0.42;
    if (near !== lastBand.current) {
      lastBand.current = near;
      onZoomBand(near);
    }

    if (compassRef.current) {
      const theta = new THREE.Spherical().setFromVector3(camera.position.clone().sub(t)).theta;
      compassRef.current.style.transform = `rotate(${theta}rad)`;
    }
  });

  return (
    <MapControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.12}
      zoomToCursor
      screenSpacePanning={false}
      rotateSpeed={0.6}
      zoomSpeed={1.1}
    />
  );
}
