import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const state = {
  data: null,
  frameIndex: 0,
  fieldName: "",
  viewMode: "particles",
  playing: false,
  lastAdvance: 0,
};

const PLAYBACK_FRAME_MS = 520;
const STAR_COUNT = 720;
const STAR_RADIUS_MIN = 6.2;
const STAR_RADIUS_MAX = 9.8;
const GIZMO_SIZE = 96;
const GIZMO_PADDING = 18;

const elements = {
  canvas: document.querySelector("#scene-canvas"),
  frameSlider: document.querySelector("#frame-slider"),
  frameLabel: document.querySelector("#frame-label"),
  shockLabel: document.querySelector("#shock-label"),
  tracerLabel: document.querySelector("#tracer-label"),
  viewMode: document.querySelector("#view-mode"),
  loadingIndicator: document.querySelector("#loading-indicator"),
  previousFrame: document.querySelector("#previous-frame"),
  playToggle: document.querySelector("#play-toggle"),
  nextFrame: document.querySelector("#next-frame"),
};

const scene = new THREE.Scene();
scene.background = new THREE.Color("#06070a");

const renderer = new THREE.WebGLRenderer({
  canvas: elements.canvas,
  antialias: true,
  alpha: false,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.autoClear = false;
let renderRequested = false;

const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 20);
camera.position.set(1.7, -2.15, 1.25);

const controls = new OrbitControls(camera, elements.canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 0.55;
controls.maxDistance = 5.2;
controls.target.set(0, 0, 0);

const root = new THREE.Group();
scene.add(root);

const raymarchGroup = new THREE.Group();
const sliceGroup = new THREE.Group();
const volumeGroup = new THREE.Group();
const tracerGroup = new THREE.Group();
const shellGroup = new THREE.Group();
root.add(raymarchGroup, sliceGroup, volumeGroup, tracerGroup, shellGroup);

scene.add(new THREE.AmbientLight("#f1e4cf", 1.7));
scene.add(makeStarField());
const softDiscTexture = makeSoftDiscTexture("#ffffff", 96);
const shockDiscTexture = makeSoftDiscTexture("#f4d8a6", 96);
const volumeTextures = new Map();
let raymarchMaterial = null;

const gizmoScene = new THREE.Scene();
const gizmoCamera = new THREE.OrthographicCamera(-1.2, 1.2, 1.2, -1.2, 0.1, 10);
gizmoCamera.position.set(0, 0, 4);
const gizmoRoot = makeAxisGizmo();
gizmoScene.add(gizmoRoot);

/** Resize the WebGL renderer to match the displayed canvas. */
function resizeRenderer() {
  const { clientWidth, clientHeight } = elements.canvas;
  const width = Math.max(clientWidth, 1);
  const height = Math.max(clientHeight, 1);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

/** Return a stable pseudo-random value in the [0, 1) interval. */
function seededRandom(index) {
  const value = Math.sin(index * 127.1 + 311.7) * 43758.5453123;
  return value - Math.floor(value);
}

/** Build a sparse star field that stays behind the interactive volume. */
function makeStarField() {
  const positions = new Float32Array(STAR_COUNT * 3);
  const colors = new Float32Array(STAR_COUNT * 3);
  const cool = new THREE.Color("#9fd3df");
  const warm = new THREE.Color("#f5dfbb");

  for (let index = 0; index < STAR_COUNT; index += 1) {
    const z = seededRandom(index + 1) * 2 - 1;
    const theta = seededRandom(index + 97) * Math.PI * 2;
    const radius = THREE.MathUtils.lerp(STAR_RADIUS_MIN, STAR_RADIUS_MAX, seededRandom(index + 193));
    const xy = Math.sqrt(Math.max(1 - z * z, 0));
    const offset = index * 3;
    positions[offset] = Math.cos(theta) * xy * radius;
    positions[offset + 1] = Math.sin(theta) * xy * radius;
    positions[offset + 2] = z * radius;

    const color = cool.clone().lerp(warm, seededRandom(index + 389));
    const intensity = THREE.MathUtils.lerp(0.34, 0.86, seededRandom(index + 521));
    colors[offset] = color.r * intensity;
    colors[offset + 1] = color.g * intensity;
    colors[offset + 2] = color.b * intensity;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    size: 1.55,
    sizeAttenuation: false,
    map: makeSoftDiscTexture("#ffffff", 48),
    vertexColors: true,
    transparent: true,
    opacity: 0.82,
    alphaTest: 0.03,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  return new THREE.Points(geometry, material);
}

/** Make a compact text sprite for one axis label. */
function makeAxisLabel(text, colorValue) {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.font = "700 34px Libre Baskerville, Georgia, serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.shadowColor = "rgba(0, 0, 0, 0.72)";
  context.shadowBlur = 8;
  context.fillStyle = colorValue;
  context.fillText(text, 32, 32);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
  });
  return new THREE.Sprite(material);
}

/** Build a minimal XYZ orientation gizmo for the lower-left viewport corner. */
function makeAxisGizmo() {
  const group = new THREE.Group();
  const axes = [
    { label: "X", color: "#ff7b5c", direction: new THREE.Vector3(1, 0, 0), rotation: [0, 0, -Math.PI / 2] },
    { label: "Y", color: "#82d47c", direction: new THREE.Vector3(0, 1, 0), rotation: [0, 0, 0] },
    { label: "Z", color: "#79c6d9", direction: new THREE.Vector3(0, 0, 1), rotation: [Math.PI / 2, 0, 0] },
  ];

  for (const axis of axes) {
    const material = new THREE.MeshBasicMaterial({
      color: axis.color,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    const line = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.66, 16), material);
    line.position.copy(axis.direction.clone().multiplyScalar(0.33));
    line.rotation.set(...axis.rotation);
    group.add(line);

    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.16, 20), material.clone());
    cone.position.copy(axis.direction.clone().multiplyScalar(0.72));
    cone.rotation.set(...axis.rotation);
    group.add(cone);

    const label = makeAxisLabel(axis.label, axis.color);
    label.position.copy(axis.direction.clone().multiplyScalar(0.94));
    label.scale.setScalar(0.27);
    group.add(label);
  }

  const centerMaterial = new THREE.MeshBasicMaterial({
    color: "#fff2cf",
    transparent: true,
    opacity: 0.86,
    depthWrite: false,
  });
  group.add(new THREE.Mesh(new THREE.SphereGeometry(0.055, 20, 12), centerMaterial));
  return group;
}

/** Map a normalized scalar value to the viewer transfer-function color. */
function colorMap(value) {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  const stops = [
    [0.0, new THREE.Color("#07080c")],
    [0.18, new THREE.Color("#241236")],
    [0.4, new THREE.Color("#66255b")],
    [0.64, new THREE.Color("#c24a33")],
    [0.84, new THREE.Color("#f0a33a")],
    [1.0, new THREE.Color("#fff0bc")],
  ];
  for (let index = 1; index < stops.length; index += 1) {
    const [position, color] = stops[index];
    const [previousPosition, previousColor] = stops[index - 1];
    if (t <= position) {
      const localT = (t - previousPosition) / Math.max(position - previousPosition, 0.0001);
      return previousColor.clone().lerp(color, localT);
    }
  }
  return stops.at(-1)[1].clone();
}

/** Map plume intensity to warm presentation colors without black endpoints. */
function plumeColorMap(value) {
  const t = THREE.MathUtils.clamp(THREE.MathUtils.smoothstep(value, 0.12, 0.98), 0, 1);
  const stops = [
    [0.0, new THREE.Color("#431663")],
    [0.28, new THREE.Color("#912080")],
    [0.54, new THREE.Color("#e33a4a")],
    [0.78, new THREE.Color("#ffad2f")],
    [1.0, new THREE.Color("#fff2a8")],
  ];
  for (let index = 1; index < stops.length; index += 1) {
    const [position, color] = stops[index];
    const [previousPosition, previousColor] = stops[index - 1];
    if (t <= position) {
      const localT = (t - previousPosition) / Math.max(position - previousPosition, 0.0001);
      return previousColor.clone().lerp(color, localT);
    }
  }
  return stops.at(-1)[1].clone();
}

/** Build a reusable circular alpha texture for point sprites. */
function makeSoftDiscTexture(colorValue, size) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  const center = size / 2;
  const gradient = context.createRadialGradient(center, center, 0, center, center, center);
  gradient.addColorStop(0.0, colorValue);
  gradient.addColorStop(0.48, colorValue);
  gradient.addColorStop(0.78, "rgba(255, 255, 255, 0.22)");
  gradient.addColorStop(1.0, "rgba(255, 255, 255, 0)");
  context.clearRect(0, 0, size, size);
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

/** Decode a base64 string into browser texture bytes. */
function decodeBase64Bytes(encoded) {
  const binary = window.atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** Build or reuse the 3D texture for the selected frame. */
function volumeTextureForFrame(frame) {
  if (!frame.volumeTexture?.values) return null;
  if (volumeTextures.has(frame.source)) return volumeTextures.get(frame.source);

  const size = frame.volumeTexture.size;
  const texture = new THREE.Data3DTexture(decodeBase64Bytes(frame.volumeTexture.values), size, size, size);
  texture.format = THREE.RedFormat;
  texture.type = THREE.UnsignedByteType;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  volumeTextures.set(frame.source, texture);
  return texture;
}

/** Create the shader material that raymarches the exported 3D volume. */
function makeVolumeMaterial(texture, nextTexture) {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      volumeMap: { value: texture },
      nextVolumeMap: { value: nextTexture },
      frameBlend: { value: 0.0 },
      steps: { value: 104 },
      alphaScale: { value: 0.078 },
      threshold: { value: 0.018 },
    },
    vertexShader: `
      out vec3 vWorldPosition;

      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      precision highp float;
      precision highp sampler3D;

      uniform sampler3D volumeMap;
      uniform sampler3D nextVolumeMap;
      uniform float frameBlend;
      uniform int steps;
      uniform float alphaScale;
      uniform float threshold;
      in vec3 vWorldPosition;
      out vec4 outColor;

      vec2 hitBox(vec3 origin, vec3 direction) {
        vec3 boxMin = vec3(-1.0);
        vec3 boxMax = vec3(1.0);
        vec3 invDir = 1.0 / direction;
        vec3 tMinTemp = (boxMin - origin) * invDir;
        vec3 tMaxTemp = (boxMax - origin) * invDir;
        vec3 tMin = min(tMinTemp, tMaxTemp);
        vec3 tMax = max(tMinTemp, tMaxTemp);
        float t0 = max(max(tMin.x, tMin.y), tMin.z);
        float t1 = min(min(tMax.x, tMax.y), tMax.z);
        return vec2(t0, t1);
      }

      vec3 palette(float value) {
        vec3 deep = vec3(0.07, 0.02, 0.15);
        vec3 violet = vec3(0.42, 0.1, 0.62);
        vec3 magenta = vec3(0.78, 0.12, 0.48);
        vec3 ember = vec3(1.0, 0.26, 0.11);
        vec3 gold = vec3(1.0, 0.64, 0.14);
        vec3 cream = vec3(1.0, 0.93, 0.62);
        if (value < 0.36) {
          return mix(deep, violet, smoothstep(0.0, 0.36, value));
        }
        if (value < 0.58) {
          return mix(violet, magenta, smoothstep(0.36, 0.58, value));
        }
        if (value < 0.76) {
          return mix(magenta, ember, smoothstep(0.58, 0.76, value));
        }
        if (value < 0.9) {
          return mix(ember, gold, smoothstep(0.76, 0.9, value));
        }
        return mix(gold, cream, smoothstep(0.9, 1.0, value));
      }

      float hash13(vec3 point) {
        point = fract(point * 0.1031);
        point += dot(point, point.yzx + 33.33);
        return fract((point.x + point.y) * point.z);
      }

      void main() {
        vec3 rayDirection = normalize(vWorldPosition - cameraPosition);
        vec2 bounds = hitBox(cameraPosition, rayDirection);
        if (bounds.x > bounds.y) discard;
        bounds.x = max(bounds.x, 0.0);

        vec3 position = cameraPosition + bounds.x * rayDirection;
        vec3 stepVector = rayDirection * ((bounds.y - bounds.x) / float(steps));
        position += stepVector * hash13(vec3(gl_FragCoord.xy, float(steps)));
        vec4 accumulated = vec4(0.0);
        float coverage = 0.0;

        for (int i = 0; i < 160; i++) {
          if (i >= steps || accumulated.a > 0.96) break;
          vec3 uvw = position * 0.5 + 0.5;
          float density = mix(texture(volumeMap, uvw).r, texture(nextVolumeMap, uvw).r, frameBlend);
          float signal = smoothstep(threshold, 0.82, density);
          float alpha = pow(signal, 1.35) * alphaScale;
          coverage += smoothstep(0.08, 0.62, signal) / float(steps);
          float radial = length(uvw - vec3(0.5)) * 2.0;
          vec3 color = palette(signal) * (0.42 + 1.78 * signal);
          color *= 0.82 + 0.28 * smoothstep(0.18, 0.86, radial);
          color += vec3(0.2, 0.08, 0.42) * smoothstep(0.58, 0.98, radial) * (0.2 + signal) * 0.28;
          accumulated.rgb += (1.0 - accumulated.a) * alpha * color;
          accumulated.a += (1.0 - accumulated.a) * alpha;
          position += stepVector;
        }

        if (accumulated.a < 0.015) discard;
        accumulated.a = max(accumulated.a, 0.985 * smoothstep(0.015, 0.12, coverage));
        outColor = vec4(accumulated.rgb, accumulated.a);
      }
    `,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
}

/** Dispose all GPU resources held by a Three.js group and remove its children. */
function clearGroup(group) {
  if (group === raymarchGroup) {
    raymarchMaterial = null;
  }
  for (const child of group.children) {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        if (material.map && !material.userData.keepMap) material.map.dispose();
        material.dispose();
      }
    }
  }
  group.clear();
}

/** Refresh the raymarched volume layer for the current frame. */
function updateRaymarchedVolume(frame) {
  clearGroup(raymarchGroup);
  raymarchGroup.visible = renderer.capabilities.isWebGL2;
  if (!raymarchGroup.visible) return;

  const texture = volumeTextureForFrame(frame);
  const nextTexture = volumeTextureForFrame(nextFrame());
  if (!texture) return;
  const geometry = new THREE.BoxGeometry(2, 2, 2);
  raymarchMaterial = makeVolumeMaterial(texture, nextTexture ?? texture);
  raymarchGroup.add(new THREE.Mesh(geometry, raymarchMaterial));
}

/** Convert an exported scalar slice into a transparent canvas texture. */
function makeSliceTexture(slice) {
  const canvas = document.createElement("canvas");
  canvas.width = slice.width;
  canvas.height = slice.height;
  const context = canvas.getContext("2d");
  const image = context.createImageData(slice.width, slice.height);
  for (let index = 0; index < slice.values.length; index += 1) {
    const value = slice.values[index];
    const color = colorMap(value);
    const alpha = value <= 0.08 ? 0 : Math.round(205 * value ** 1.35);
    const offset = index * 4;
    image.data[offset] = Math.round(color.r * 255);
    image.data[offset + 1] = Math.round(color.g * 255);
    image.data[offset + 2] = Math.round(color.b * 255);
    image.data[offset + 3] = alpha;
  }
  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

/** Build a textured plane mesh for one orthogonal scalar slice. */
function makeSliceMesh(planeName, slice) {
  const geometry = new THREE.PlaneGeometry(2, 2);
  const material = new THREE.MeshBasicMaterial({
    map: makeSliceTexture(slice),
    transparent: true,
    opacity: 0.78,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = planeName;
  if (planeName === "xz") {
    mesh.rotation.x = Math.PI / 2;
  } else if (planeName === "yz") {
    mesh.rotation.y = Math.PI / 2;
  }
  return mesh;
}

/** Refresh slice geometry for the current frame and field selection. */
function updateSlices(frame) {
  clearGroup(sliceGroup);
  sliceGroup.visible = state.viewMode === "slices";
  const fieldSlices = frame.slices[state.fieldName] ?? {};
  for (const planeName of Object.keys(fieldSlices)) {
    if (fieldSlices[planeName]) {
      sliceGroup.add(makeSliceMesh(planeName, fieldSlices[planeName]));
    }
  }
}

/** Refresh sparse plume-volume geometry for the current frame. */
function updateVolume(frame) {
  clearGroup(volumeGroup);
  volumeGroup.visible = state.viewMode === "particles";
  if (!frame.volumePoints?.length) return;

  const positions = new Float32Array(frame.volumePoints.length * 3);
  const colors = new Float32Array(frame.volumePoints.length * 3);
  for (let index = 0; index < frame.volumePoints.length; index += 1) {
    const point = frame.volumePoints[index];
    positions.set([point[0], point[1], point[2]], index * 3);
    const color = plumeColorMap(point[3]);
    colors.set([color.r, color.g, color.b], index * 3);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    size: renderer.capabilities.isWebGL2 ? 0.009 : 0.018,
    map: softDiscTexture,
    vertexColors: true,
    transparent: true,
    opacity: renderer.capabilities.isWebGL2 ? 0.42 : 0.84,
    alphaTest: 0.04,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  material.userData.keepMap = true;
  volumeGroup.add(new THREE.Points(geometry, material));
}

/** Refresh tracer particle geometry for the current frame. */
function updateTracers(frame) {
  clearGroup(tracerGroup);
  tracerGroup.visible = state.viewMode === "tracers";
  if (!frame.tracers.length) return;

  const visibleTracers = frame.tracers.filter((position) => {
    const radius = Math.hypot(position[0], position[1], position[2]);
    return radius > 0.06 && radius < 0.92;
  });
  if (!visibleTracers.length) return;

  const positions = new Float32Array(visibleTracers.length * 3);
  const colors = new Float32Array(visibleTracers.length * 3);
  for (let index = 0; index < visibleTracers.length; index += 1) {
    const position = visibleTracers[index];
    const radius = Math.hypot(position[0], position[1], position[2]);
    positions.set(position, index * 3);
    const color = colorMap(THREE.MathUtils.smoothstep(radius, 0.1, 0.9));
    colors.set([color.r, color.g, color.b], index * 3);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    size: 0.0045,
    map: softDiscTexture,
    vertexColors: true,
    transparent: true,
    opacity: 0.48,
    alphaTest: 0.04,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  material.userData.keepMap = true;
  tracerGroup.add(new THREE.Points(geometry, material));
}

/** Refresh the wireframe shock-radius shell for the current frame. */
function updateShell(frame) {
  clearGroup(shellGroup);
  shellGroup.visible = !renderer.capabilities.isWebGL2;
  if (frame.shockMesh?.vertices?.length && frame.shockMesh?.indices?.length) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(frame.shockMesh.vertices), 3)
    );
    geometry.setIndex(frame.shockMesh.indices);
    geometry.computeVertexNormals();

    const surfaceMaterial = new THREE.MeshBasicMaterial({
      color: "#6b578f",
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    shellGroup.add(new THREE.Mesh(geometry, surfaceMaterial));

    const wireMaterial = new THREE.MeshBasicMaterial({
      color: "#f4d8a6",
      wireframe: true,
      transparent: true,
      opacity: 0.1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    shellGroup.add(new THREE.Mesh(geometry.clone(), wireMaterial));
    return;
  }

  if (frame.shellPoints?.length) {
    const positions = new Float32Array(frame.shellPoints.length * 3);
    for (let index = 0; index < frame.shellPoints.length; index += 1) {
      positions.set(frame.shellPoints[index], index * 3);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      size: 0.011,
      map: shockDiscTexture,
      color: "#f4d8a6",
      transparent: true,
      opacity: 0.42,
      alphaTest: 0.04,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    material.userData.keepMap = true;
    shellGroup.add(new THREE.Points(geometry, material));
    return;
  }

  if (frame.shockRadius <= 0) return;
  const geometry = new THREE.SphereGeometry(frame.shockRadius, 48, 24);
  const material = new THREE.MeshBasicMaterial({
    color: "#87cfee",
    wireframe: true,
    transparent: true,
    opacity: 0.28,
  });
  shellGroup.add(new THREE.Mesh(geometry, material));
}

/** Count tracers that are inside the display domain rather than boundary-clamped. */
function visibleTracerCount(frame) {
  return frame.tracers.filter((position) => {
    const radius = Math.hypot(position[0], position[1], position[2]);
    return radius > 0.06 && radius < 0.92;
  }).length;
}

/** Update the compact viewport status labels. */
function updateLabels(frame) {
  elements.frameLabel.textContent = `step ${frame.step}`;
  elements.shockLabel.textContent = `shock radius ${frame.shockRadius.toFixed(3)}`;
  if (state.viewMode === "tracers") {
    elements.tracerLabel.textContent = `${visibleTracerCount(frame)} tracers`;
  } else if (state.viewMode === "particles") {
    elements.tracerLabel.textContent = `${frame.volumePoints.length} plume samples`;
  } else {
    elements.tracerLabel.textContent = "raymarched volume";
  }
}

/** Rebuild all visible scene primitives for the selected frame. */
function renderFrame() {
  const frame = state.data.frames[state.frameIndex];
  const upcomingFrame = nextFrame();
  const texturesReady = volumeTextures.has(frame.source) && volumeTextures.has(upcomingFrame.source);
  elements.loadingIndicator.classList.toggle("visible", !texturesReady);
  elements.frameSlider.value = String(state.frameIndex);
  updateRaymarchedVolume(frame);
  updateSlices(frame);
  updateVolume(frame);
  updateTracers(frame);
  updateShell(frame);
  updateLabels(frame);
  elements.loadingIndicator.classList.remove("visible");
  requestRender();
}

/** Return the frame after the current frame, wrapping around at the end. */
function nextFrame() {
  const frameCount = state.data.frames.length;
  return state.data.frames[(state.frameIndex + 1) % frameCount];
}

/** Change the selected frame, wrapping around the available frame sequence. */
function setFrame(index) {
  const frameCount = state.data.frames.length;
  state.frameIndex = (index + frameCount) % frameCount;
  renderFrame();
}

/** Update only the volume interpolation amount between two saved frames. */
function updateVolumeBlend(value) {
  if (!raymarchMaterial) return;
  raymarchMaterial.uniforms.frameBlend.value = THREE.MathUtils.clamp(value, 0, 1);
}

/** Queue a viewer redraw without keeping a permanent render loop alive. */
function requestRender() {
  if (renderRequested) return;
  renderRequested = true;
  requestAnimationFrame(animate);
}

/** Populate form controls from loaded viewer metadata. */
function populateControls() {
  const fields = state.data.metadata.sliceFields;
  state.fieldName = fields[0];
  elements.frameSlider.max = String(state.data.frames.length - 1);
}

/** Attach DOM event handlers for playback and display controls. */
function bindEvents() {
  elements.frameSlider.addEventListener("input", () => setFrame(Number(elements.frameSlider.value)));
  elements.viewMode.addEventListener("change", () => {
    state.viewMode = elements.viewMode.value;
    renderFrame();
  });
  elements.previousFrame.addEventListener("click", () => setFrame(state.frameIndex - 1));
  elements.nextFrame.addEventListener("click", () => setFrame(state.frameIndex + 1));
  elements.playToggle.addEventListener("click", () => {
    state.playing = !state.playing;
    state.lastAdvance = performance.now();
    updateVolumeBlend(0);
    elements.playToggle.textContent = state.playing ? "Pause" : "Play";
    elements.playToggle.classList.toggle("active", state.playing);
    requestRender();
  });
  controls.addEventListener("change", requestRender);
  window.addEventListener("resize", () => {
    resizeRenderer();
    requestRender();
  });
}

/** Render the orientation gizmo in a fixed viewport corner using the main camera rotation. */
function renderAxisGizmo() {
  const width = elements.canvas.clientWidth;
  const height = elements.canvas.clientHeight;
  const size = Math.min(GIZMO_SIZE, Math.max(64, Math.floor(Math.min(width, height) * 0.22)));
  const x = GIZMO_PADDING;
  const y = GIZMO_PADDING;

  gizmoRoot.quaternion.copy(camera.quaternion).invert();
  renderer.clearDepth();
  renderer.setScissorTest(true);
  renderer.setViewport(x, y, size, size);
  renderer.setScissor(x, y, size, size);
  renderer.render(gizmoScene, gizmoCamera);
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, width, height);
}

/** Render the viewer loop and advance playback when enabled. */
function animate(timestamp) {
  renderRequested = false;
  if (state.playing) {
    const elapsed = timestamp - state.lastAdvance;
    if (elapsed > PLAYBACK_FRAME_MS) {
      state.lastAdvance = timestamp;
      setFrame(state.frameIndex + 1);
    } else {
      updateVolumeBlend(elapsed / PLAYBACK_FRAME_MS);
    }
  } else {
    updateVolumeBlend(0);
  }
  const controlsChanged = controls.update();
  renderer.clear();
  renderer.render(scene, camera);
  renderAxisGizmo();
  if (state.playing || controlsChanged) {
    requestRender();
  }
}

/** Fetch the exported compact snapshot data file. */
async function loadData() {
  const response = await fetch("./data/viewer_data.json");
  if (!response.ok) {
    throw new Error(`Could not load viewer data: ${response.status}`);
  }
  state.data = await response.json();
  if (!state.data.frames?.length) {
    throw new Error("Viewer data has no frames.");
  }
}

/** Initialize controls, load data, and start rendering. */
async function main() {
  bindEvents();
  resizeRenderer();
  elements.loadingIndicator.classList.add("visible");
  try {
    await loadData();
    populateControls();
    renderFrame();
  } catch (error) {
    elements.frameLabel.textContent = "data missing";
    elements.shockLabel.textContent = "run exporter";
    elements.tracerLabel.textContent = error.message;
  }
  requestRender();
}

main();
