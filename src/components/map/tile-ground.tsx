"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { MAP_HEIGHT, MAP_WIDTH } from "@/data/regions";
import {
  BASE_IMAGE,
  MAX_ZOOM,
  MIN_DETAIL_ZOOM,
  TILED_AREA,
  TILE_RANGES,
  pixelsPerUnit,
  tileRect,
  tileUrl,
} from "./tiles";
import { NIGHT, NIGHT_SEA, withNight, type MapTime } from "./day-night";

/** Open-sea colour of the community map, used for the endless sea plane and the fog. */
export const LEONIDA_SEA = "#2c67a4";

const CX = MAP_WIDTH / 2;
const CZ = MAP_HEIGHT / 2;
const FOV_TAN_HALF = Math.tan(THREE.MathUtils.degToRad(35 / 2));
/** Loaded detail tiles kept in memory (each is a 256 px texture). */
const CACHE_LIMIT = 420;
/** Requests in flight at once, so a fast zoom does not queue hundreds of downloads. */
const MAX_INFLIGHT = 12;

interface Tile {
  key: string;
  z: number;
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  texture: THREE.Texture | null;
  state: "loading" | "ready" | "failed";
  used: number;
}

/** Ground layers draw under everything else and never fight over depth. */
const groundMaterial = (map: THREE.Texture | null) =>
  withNight(new THREE.MeshBasicMaterial({ map, depthTest: false, depthWrite: false, transparent: false }));

const DAY_FOG = new THREE.Color(LEONIDA_SEA);
const NIGHT_FOG = new THREE.Color(NIGHT_SEA);

function prepare(texture: THREE.Texture, gl: THREE.WebGLRenderer) {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = gl.capabilities.getMaxAnisotropy();
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
}

/**
 * The GTA VI map: one stitched low-resolution image of the whole map, with 256 px tiles
 * streamed in on top for whatever is on screen (up to 1 m per pixel) as the camera zooms in.
 */
export function TileGround({ onReady, time = "day" }: { onReady: () => void; time?: MapTime }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const size = useThree((s) => s.size);
  const group = useRef<THREE.Group>(null);
  const [base, setBase] = useState<THREE.Texture | null>(null);
  const tiles = useRef(new Map<string, Tile>());
  const inflight = useRef(0);
  const lastCheck = useRef(0);
  const plane = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const seaMaterial = useMemo(() => withNight(new THREE.MeshBasicMaterial({ color: LEONIDA_SEA, depthTest: false, depthWrite: false })), []);
  const baseMaterial = useMemo(() => (base ? groundMaterial(base) : null), [base]);

  // First paint starts in the chosen look; later switches fade (see useFrame).
  const timeRef = useRef(time);
  useEffect(() => {
    timeRef.current = time;
  }, [time]);
  useState(() => {
    NIGHT.value = time === "night" ? 1 : 0;
  });

  useEffect(() => () => seaMaterial.dispose(), [seaMaterial]);
  useEffect(() => () => baseMaterial?.dispose(), [baseMaterial]);

  useEffect(() => {
    let cancelled = false;
    let made: THREE.Texture | null = null;
    new THREE.TextureLoader().load(
      BASE_IMAGE,
      (t) => {
        if (cancelled) return t.dispose();
        prepare(t, gl);
        made = t;
        setBase(t);
        onReady();
      },
      undefined,
      (err) => {
        console.error("Map base image failed to load", err);
        if (!cancelled) onReady();
      },
    );
    return () => {
      cancelled = true;
      made?.dispose();
    };
  }, [gl, onReady]);

  // Dispose everything on unmount.
  useEffect(() => {
    const map = tiles.current;
    return () => {
      for (const t of map.values()) {
        t.texture?.dispose();
        t.material.dispose();
      }
      map.clear();
      plane.dispose();
    };
  }, [plane]);

  const request = (z: number, row: number, col: number, now: number): Tile => {
    const key = `${z}/${row}/${col}`;
    const hit = tiles.current.get(key);
    if (hit) {
      hit.used = now;
      return hit;
    }
    const r = tileRect(z, row, col);
    const material = groundMaterial(null);
    const mesh = new THREE.Mesh(plane, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.scale.set(r.w, r.h, 1);
    mesh.position.set(r.x + r.w / 2 - CX, 0, r.y + r.h / 2 - CZ);
    mesh.renderOrder = -20 + z;
    mesh.visible = false;
    mesh.frustumCulled = false;
    const tile: Tile = { key, z, mesh, material, texture: null, state: "loading", used: now };
    tiles.current.set(key, tile);
    inflight.current++;
    new THREE.TextureLoader().load(
      tileUrl(z, row, col),
      (texture) => {
        inflight.current--;
        if (!tiles.current.has(key)) return texture.dispose();
        prepare(texture, gl);
        tile.texture = texture;
        material.map = texture;
        material.needsUpdate = true;
        tile.state = "ready";
        group.current?.add(mesh);
      },
      undefined,
      () => {
        inflight.current--;
        tile.state = "failed";
      },
    );
    return tile;
  };

  useFrame(({ camera, controls }, delta) => {
    // Day / night fade, and the fog follows the sea colour so the horizon matches.
    const goal = timeRef.current === "night" ? 1 : 0;
    if (NIGHT.value !== goal) {
      const step = Math.min(1, delta * 3);
      NIGHT.value = Math.abs(goal - NIGHT.value) < 0.004 ? goal : NIGHT.value + (goal - NIGHT.value) * step;
    }
    if (scene.fog instanceof THREE.Fog) scene.fog.color.lerpColors(DAY_FOG, NIGHT_FOG, NIGHT.value);

    const now = performance.now();
    if (now - lastCheck.current < 120) return;
    lastCheck.current = now;
    const target = (controls as unknown as { target?: THREE.Vector3 } | null)?.target;
    if (!target) return;

    // Visible map rectangle (the 2D map looks straight down).
    const r = camera.position.distanceTo(target);
    const halfH = r * FOV_TAN_HALF * 1.25;
    const halfW = halfH * (size.width / Math.max(1, size.height));
    const view = { x0: target.x + CX - halfW, x1: target.x + CX + halfW, y0: target.z + CZ - halfH, y1: target.z + CZ + halfH };

    // Sharpest zoom worth loading: texture pixels per unit vs screen pixels per unit.
    const screenPpu = (size.height / (2 * r * FOV_TAN_HALF)) * Math.min(2, gl.getPixelRatio());
    let want = 0;
    for (let z = MIN_DETAIL_ZOOM; z <= MAX_ZOOM; z++) {
      want = z;
      if (pixelsPerUnit(z) >= screenPpu) break;
    }
    if (pixelsPerUnit(MIN_DETAIL_ZOOM - 1) >= screenPpu) want = 0;

    for (const t of tiles.current.values()) t.mesh.visible = false;
    if (want) {
      // Show any loaded tiles from coarser levels too, so zooming in never shows a blur gap.
      for (let z = MIN_DETAIL_ZOOM; z <= want; z++) {
        const [[c0, r0], [c1, r1]] = TILE_RANGES[z];
        const s = tileRect(z, 0, 0);
        const unit = s.w;
        const colA = Math.max(c0, Math.floor((view.x0 - s.x) / unit));
        const colB = Math.min(c1, Math.floor((view.x1 - s.x) / unit));
        const rowA = Math.max(r0, Math.floor((view.y0 - s.y) / unit));
        const rowB = Math.min(r1, Math.floor((view.y1 - s.y) / unit));
        for (let row = rowA; row <= rowB; row++) {
          for (let col = colA; col <= colB; col++) {
            const key = `${z}/${row}/${col}`;
            const existing = tiles.current.get(key);
            if (existing) {
              existing.used = now;
              if (existing.state === "ready") existing.mesh.visible = true;
            } else if (z === want && inflight.current < MAX_INFLIGHT) {
              request(z, row, col, now);
            }
          }
        }
      }
    }

    // Drop the least recently used tiles once the cache is full.
    if (tiles.current.size > CACHE_LIMIT) {
      const old = [...tiles.current.values()].filter((t) => !t.mesh.visible && t.state !== "loading").sort((a, b) => a.used - b.used);
      for (const t of old.slice(0, tiles.current.size - CACHE_LIMIT)) {
        group.current?.remove(t.mesh);
        t.texture?.dispose();
        t.material.dispose();
        tiles.current.delete(t.key);
      }
    }
  });

  const baseCentre = { x: TILED_AREA.x + TILED_AREA.w / 2 - CX, z: TILED_AREA.y + TILED_AREA.h / 2 - CZ };

  return (
    <group>
      {/* Endless sea */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0, 0]} renderOrder={-30}>
        <planeGeometry args={[60000, 60000]} />
        <primitive object={seaMaterial} attach="material" />
      </mesh>
      {baseMaterial && (
        <mesh rotation-x={-Math.PI / 2} position={[baseCentre.x, 0, baseCentre.z]} renderOrder={-25}>
          <planeGeometry args={[TILED_AREA.w, TILED_AREA.h]} />
          <primitive object={baseMaterial} attach="material" />
        </mesh>
      )}
      <group ref={group} />
    </group>
  );
}
