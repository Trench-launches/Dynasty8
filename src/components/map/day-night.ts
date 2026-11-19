import * as THREE from "three";

/**
 * Day / night look for the map ground. The map tiles are daytime artwork; night is a shader
 * pass over them: land and buildings fall into a dusky blue-purple, water goes deep navy and
 * roads glow like sodium street lights. One shared uniform drives every ground material, so
 * the switch fades smoothly and never recompiles a shader.
 */

export type MapTime = "day" | "night";

/** Open sea at night (also the fog and the canvas backdrop). */
export const NIGHT_SEA = "#0f0d26";

/** 0 = day, 1 = night. Eased towards the target each frame by TileGround. */
export const NIGHT = { value: 0 };
const NIGHT_SEA_UNIFORM = { value: new THREE.Color(NIGHT_SEA) };

const NIGHT_FRAGMENT = /* glsl */ `#include <map_fragment>
{
  vec3 c = diffuseColor.rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float sat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
  // Water: blue clearly above red and green. Shallows are lighter, so they keep a faint teal.
  float water = smoothstep(0.06, 0.2, c.b - max(c.r, c.g));
  float shallow = smoothstep(0.2, 0.55, c.g);
  // Roads and plazas: near-white and unsaturated. City blocks (light grey) get a softer glow.
  float road = smoothstep(0.62, 0.95, l) * (1.0 - smoothstep(0.06, 0.2, sat));
  float block = smoothstep(0.35, 0.65, l) * (1.0 - smoothstep(0.05, 0.16, sat)) * (1.0 - road);

  vec3 land = c * vec3(0.2, 0.17, 0.3) + vec3(0.01, 0.008, 0.022);
  vec3 sea = mix(uNightSea, vec3(0.03, 0.09, 0.16), shallow * 0.8);
  vec3 night = mix(land, sea, water);
  night += block * vec3(0.10, 0.06, 0.12);
  night += road * vec3(1.0, 0.5, 0.16) * 0.75;
  diffuseColor.rgb = mix(c, night, uNight);
}`;

/** Adds the night pass to a ground material. Returns the same material. */
export function withNight<T extends THREE.Material>(material: T): T {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = NIGHT;
    shader.uniforms.uNightSea = NIGHT_SEA_UNIFORM;
    shader.fragmentShader =
      "uniform float uNight;\nuniform vec3 uNightSea;\n" +
      shader.fragmentShader.replace("#include <map_fragment>", NIGHT_FRAGMENT);
  };
  material.customProgramCacheKey = () => "map-night-v1";
  return material;
}
