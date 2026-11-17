"use client";

import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { MapControls } from "@react-three/drei";
import * as THREE from "three";
import type { MapControls as MapControlsImpl } from "three-stdlib";
import { MAP_HEIGHT, MAP_WIDTH } from "@/data/regions";
import type { MapLocation, Property, RegionId } from "@/lib/types";
import { DOWNTOWN, REGION_FOCUS, TEXTURE_AREA, URBAN_AREAS, urbanBlocks } from "./geometry";
import { MAP_COLORS, renderMapCanvas } from "./map-texture";

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
const BOUNDS = { minX: -50 - CX, maxX: MAP_WIDTH + 50 - CX, minZ: -50 - CZ, maxZ: MAP_HEIGHT + 50 - CZ };

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

export function MapGround({ onReady }: { onReady: () => void }) {
  const gl = useThree((s) => s.gl);
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);

  useEffect(() => {
    let cancelled = false;
    let made: THREE.CanvasTexture | null = null;
    const max = gl.capabilities.maxTextureSize;
    const mobile = window.matchMedia("(max-width: 768px)").matches;
    const height = Math.min(max, mobile ? 3072 : 4096);
    renderMapCanvas(height)
      .then((canvas) => {
        if (cancelled) return;
        made = new THREE.CanvasTexture(canvas);
        made.colorSpace = THREE.SRGBColorSpace;
        made.anisotropy = gl.capabilities.getMaxAnisotropy();
        made.generateMipmaps = true;
        made.minFilter = THREE.LinearMipmapLinearFilter;
        setTexture(made);
        onReady();
      })
      .catch((err) => {
        console.error("Map texture failed to render", err);
        onReady();
      });
    return () => {
      cancelled = true;
      made?.dispose();
    };
  }, [gl, onReady]);

  const A = TEXTURE_AREA;
  const centre = toScene(A.x + A.w / 2, A.y + A.h / 2);

  return (
    <group>
      {/* Endless ocean */}
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.5, 0]}>
        <planeGeometry args={[60000, 60000]} />
        <meshBasicMaterial color={MAP_COLORS.ocean} />
      </mesh>
      {texture && (
        <mesh rotation-x={-Math.PI / 2} position={[centre.x, 0, centre.z]}>
          <planeGeometry args={[A.w, A.h]} />
          <meshBasicMaterial map={texture} />
        </mesh>
      )}
    </group>
  );
}

/* -------------------------------------------------------------- buildings */

const BUILDING_TONES = {
  base: new THREE.Color("#e3e0ea"),
  alt: new THREE.Color("#d2cde0"),
  glass: new THREE.Color("#b9c8ea"),
  pastelPink: new THREE.Color("#f6c3d5"),
  pastelMint: new THREE.Color("#bfe9df"),
  pastelPeach: new THREE.Color("#ffd9b8"),
};

export function Buildings({ visible }: { visible: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const blocks = useMemo(
    () => URBAN_AREAS.flatMap((area) => urbanBlocks(area).map((b) => ({ ...b, area: area.id }))),
    [],
  );
  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), []);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    blocks.forEach((b, i) => {
      const p = toScene(b.x + b.w / 2, b.y + b.h / 2);
      m.compose(p, q, new THREE.Vector3(b.w, b.height, b.h));
      mesh.setMatrixAt(i, m);
      const nearDowntown = Math.hypot(b.x - DOWNTOWN.x, b.y - DOWNTOWN.y) < DOWNTOWN.r;
      let color = b.tone > 0.55 ? BUILDING_TONES.base : BUILDING_TONES.alt;
      if (b.area === "ocean-beach") {
        color = [BUILDING_TONES.pastelPink, BUILDING_TONES.pastelMint, BUILDING_TONES.pastelPeach, BUILDING_TONES.base][
          Math.floor(b.tone * 4)
        ];
      } else if (nearDowntown && b.height > 25) {
        color = BUILDING_TONES.glass;
      }
      mesh.setColorAt(i, color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [blocks]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <instancedMesh ref={ref} args={[geometry, undefined, blocks.length]} visible={visible} frustumCulled={false}>
      <meshLambertMaterial />
    </instancedMesh>
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

/**
 * Projects each pin's map position to screen space every frame and moves the
 * matching DOM element (rendered by LeonidaMap). One React tree, no per-pin roots.
 */
export function PinProjector({
  properties,
  pinEls,
}: {
  properties: Property[];
  pinEls: RefObject<Map<string, HTMLElement>>;
}) {
  const points = useMemo(
    () =>
      properties
        .filter((p) => p.location)
        .map((p) => ({ slug: p.slug, v: toScene(p.location!.x, p.location!.y) })),
    [properties],
  );
  const tmp = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ camera, size }) => {
    const els = pinEls.current;
    if (!els) return;
    for (const { slug, v } of points) {
      const el = els.get(slug);
      if (!el) continue;
      tmp.copy(v).project(camera);
      const visible = tmp.z < 1 && Math.abs(tmp.x) < 1.3 && Math.abs(tmp.y) < 1.3;
      el.style.display = visible ? "" : "none";
      if (!visible) continue;
      const x = ((tmp.x + 1) / 2) * size.width;
      const y = ((1 - tmp.y) / 2) * size.height;
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      // Nearer pins on top; hovered/selected pins above everything.
      const boost = el.dataset.state === "default" ? 0 : 100000;
      el.style.zIndex = String(boost + Math.max(0, 50000 - Math.round(v.distanceTo(camera.position))));
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
    return Math.max((MAP_HEIGHT * 0.53) / TAN_HALF, (MAP_WIDTH * 0.56) / (TAN_HALF * aspect));
  }, [size.width, size.height]);

  const home = (m: ViewMode): ViewState =>
    m === "2d"
      ? { target: new THREE.Vector3(0, 0, 0), r: homeRadius, phi: PHI_2D, theta: 0 }
      : { target: new THREE.Vector3(0, 0, 90), r: homeRadius * 0.8, phi: PHI_3D, theta: 0 };

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
      write(introPlayed.current ? home(modeRef.current) : { ...home(modeRef.current), r: homeRadius * 1.5, phi: 0.25, theta: -0.6 });
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
