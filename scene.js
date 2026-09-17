import * as THREE from "three";

const canvas = document.getElementById("scene");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
camera.position.set(0, 0.15, 6.2);

const ambient = new THREE.AmbientLight(0xcebd9c, 0.55);
const key = new THREE.DirectionalLight(0xfff2df, 1.35);
key.position.set(3.4, 4.2, 5);
const rim = new THREE.DirectionalLight(0xc9a962, 0.85);
rim.position.set(-4, -1.5, -2);
scene.add(ambient, key, rim);

const ribbons = [];
const ribbonColors = [0x5c382a, 0x8b5a3c, 0xc9a962, 0xcebd9c, 0x3d2519];

function createRibbon(index) {
  const width = 0.42 + (index % 3) * 0.08;
  const length = 9.5;
  const segments = 90;
  const geometry = new THREE.PlaneGeometry(width, length, 1, segments);
  const material = new THREE.MeshStandardMaterial({
    color: ribbonColors[index % ribbonColors.length],
    metalness: 0.35,
    roughness: 0.42,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.88,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.z = (index - 2) * 0.28;
  mesh.rotation.x = -0.55;
  mesh.position.set((index - 2) * 1.05, 0.2, -1.2 - index * 0.15);

  const baseX = Float32Array.from(geometry.attributes.position.array.filter((_, i) => i % 3 === 0));
  mesh.userData = {
    phase: index * 0.9,
    speed: 0.55 + index * 0.08,
    amplitude: 0.28 + (index % 2) * 0.12,
    baseX,
  };
  scene.add(mesh);
  ribbons.push(mesh);
}

for (let i = 0; i < 5; i += 1) createRibbon(i);

const dustGeo = new THREE.BufferGeometry();
const dustCount = 160;
const dustPos = new Float32Array(dustCount * 3);
for (let i = 0; i < dustCount; i += 1) {
  dustPos[i * 3] = (Math.random() - 0.5) * 12;
  dustPos[i * 3 + 1] = (Math.random() - 0.5) * 8;
  dustPos[i * 3 + 2] = (Math.random() - 0.5) * 6 - 1;
}
dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
const dust = new THREE.Points(
  dustGeo,
  new THREE.PointsMaterial({
    color: 0xcebd9c,
    size: 0.025,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  }),
);
scene.add(dust);

const pointer = { x: 0, y: 0, tx: 0, ty: 0 };

function onPointerMove(event) {
  const x = event.touches ? event.touches[0].clientX : event.clientX;
  const y = event.touches ? event.touches[0].clientY : event.clientY;
  pointer.tx = (x / window.innerWidth) * 2 - 1;
  pointer.ty = (y / window.innerHeight) * 2 - 1;
}

window.addEventListener("pointermove", onPointerMove, { passive: true });

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}

window.addEventListener("resize", resize);
resize();

const clock = new THREE.Clock();

function deformRibbon(mesh, time) {
  const { phase, speed, amplitude, baseX } = mesh.userData;
  const pos = mesh.geometry.attributes.position;
  const half = Math.max((pos.count - 1) / 2, 1);

  for (let i = 0; i < pos.count; i += 1) {
    const y = pos.getY(i);
    const t = y / half;
    const wave =
      Math.sin(t * 3.2 + time * speed + phase) * amplitude +
      Math.sin(t * 7.1 - time * speed * 0.7 + phase) * (amplitude * 0.35);
    pos.setZ(i, wave);
    pos.setX(i, baseX[i] + Math.sin(t * 2.4 + time * 0.4 + phase) * 0.05);
  }
  pos.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
}

function frame() {
  const t = clock.getElapsedTime();
  pointer.x += (pointer.tx - pointer.x) * 0.05;
  pointer.y += (pointer.ty - pointer.y) * 0.05;

  if (!reduceMotion) {
    for (const ribbon of ribbons) {
      deformRibbon(ribbon, t);
      ribbon.rotation.y = pointer.x * 0.18 + Math.sin(t * 0.2 + ribbon.userData.phase) * 0.04;
      ribbon.position.y = 0.15 + Math.sin(t * 0.45 + ribbon.userData.phase) * 0.08;
    }
    dust.rotation.y = t * 0.03;
    dust.position.x = pointer.x * 0.25;
    dust.position.y = -pointer.y * 0.2;
  }

  camera.position.x = pointer.x * 0.35;
  camera.position.y = 0.15 - pointer.y * 0.2;
  camera.lookAt(0, 0, -1);

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
