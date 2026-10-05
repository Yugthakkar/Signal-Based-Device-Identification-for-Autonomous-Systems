import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type BusVerdict = 'idle' | 'normal' | 'suspicious';
export type CameraPreset = 'overview' | 'bus' | 'attacker' | 'detector';

export interface BusSceneHandle {
  /** Send one CAN frame onto the bus. Injected frames come from the attacker dongle. */
  emit: (frame: { id: string; injected: boolean }) => void;
  setAttack: (active: boolean) => void;
  setVerdict: (verdict: BusVerdict) => void;
  focus: (preset: CameraPreset) => void;
}

const C = {
  bg: 0x0b0d0f,
  amber: 0xf2b84b,
  amberDim: 0x6b5324,
  red: 0xe05252,
  green: 0x55b879,
  steel: 0x626a73,
  line: 0x2a3036,
  panel: 0x1d2227,
};

const BUS_Y = 0.34;
const BUS_X: [number, number] = [-1.75, 1.85];
const PACKET_SPEED = 4.2;
const MAX_PACKETS = 700;

// Placement is illustrative: HCRL does not publish which ECU owns which CAN ID.
const ECUS: { key: string; label: string; pos: [number, number, number] }[] = [
  { key: 'ecm', label: 'Engine ECU', pos: [1.55, 0.66, 0.0] },
  { key: 'abs', label: 'ABS / Brakes', pos: [1.22, 0.52, -0.52] },
  { key: 'tcu', label: 'Transmission', pos: [0.95, 0.52, 0.4] },
  { key: 'eps', label: 'Steering', pos: [0.68, 0.8, -0.4] },
  { key: 'ipc', label: 'Instrument cluster', pos: [0.4, 0.94, 0.4] },
  { key: 'acu', label: 'Airbag', pos: [-0.4, 0.52, -0.36] },
  { key: 'bcm', label: 'Body control', pos: [-1.05, 0.62, 0.45] },
];
// The two IDs whose role is documented by the dataset authors.
const KNOWN_ID_OWNER: Record<string, string> = { '0316': 'ecm', '043f': 'tcu' };

const IDS_POS = new THREE.Vector3(0.05, 2.0, 0);
const OBD_PORT = new THREE.Vector3(0.55, 0.42, 0.66);
const ATTACKER_POS = new THREE.Vector3(0.55, 0.85, 1.7);

const PRESETS: Record<CameraPreset, { pos: THREE.Vector3; target: THREE.Vector3 }> = {
  overview: { pos: new THREE.Vector3(5.0, 3.1, 6.0), target: new THREE.Vector3(0, 0.75, 0) },
  bus: { pos: new THREE.Vector3(0.6, 4.8, 3.9), target: new THREE.Vector3(0.2, 0.4, 0) },
  attacker: { pos: new THREE.Vector3(3.7, 3.0, 6.3), target: new THREE.Vector3(0.45, 0.55, 0.6) },
  detector: { pos: new THREE.Vector3(-3.4, 3.4, 4.6), target: new THREE.Vector3(0.05, 1.3, 0) },
};

type PathData = { pts: THREE.Vector3[]; cum: number[]; total: number };
type Packet = { active: boolean; path: PathData; dist: number; injected: boolean };

function makePath(pts: THREE.Vector3[]): PathData {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
  return { pts, cum, total: cum[cum.length - 1] };
}

function pointAt(path: PathData, dist: number, out: THREE.Vector3) {
  const { pts, cum } = path;
  let i = 1;
  while (i < cum.length - 1 && cum[i] < dist) i++;
  const span = cum[i] - cum[i - 1] || 1;
  out.lerpVectors(pts[i - 1], pts[i], (dist - cum[i - 1]) / span);
}

/** Stub from a node down to the backbone, then along it to one end. */
function busPaths(stub: THREE.Vector3[]): [PathData, PathData] {
  const junction = stub[stub.length - 1];
  return [
    makePath([...stub, new THREE.Vector3(BUS_X[0], BUS_Y, junction.z)]),
    makePath([...stub, new THREE.Vector3(BUS_X[1], BUS_Y, junction.z)]),
  ];
}

function buildCar(): { group: THREE.Group; edgeMaterial: THREE.LineBasicMaterial } {
  const group = new THREE.Group();

  const profile = new THREE.Shape();
  profile.moveTo(-2.3, 0.3);
  profile.lineTo(-2.3, 0.72);
  profile.lineTo(-1.8, 0.9);
  profile.lineTo(-1.1, 1.36);
  profile.lineTo(0.3, 1.4);
  profile.lineTo(1.0, 0.96);
  profile.lineTo(2.0, 0.82);
  profile.lineTo(2.3, 0.62);
  profile.lineTo(2.3, 0.3);
  profile.lineTo(1.8, 0.3);
  profile.absarc(1.4, 0.3, 0.4, 0, Math.PI, false);
  profile.lineTo(-1.0, 0.3);
  profile.absarc(-1.4, 0.3, 0.4, 0, Math.PI, false);
  profile.lineTo(-2.3, 0.3);

  const body = new THREE.ExtrudeGeometry(profile, {
    depth: 1.7,
    bevelEnabled: true,
    bevelSize: 0.05,
    bevelThickness: 0.05,
    bevelSegments: 2,
    curveSegments: 14,
  });
  body.translate(0, 0, -0.85);

  // X-ray shell: faint fill so the electronics inside stay readable.
  group.add(
    new THREE.Mesh(
      body,
      new THREE.MeshBasicMaterial({ color: C.panel, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide })
    )
  );
  const edgeMaterial = new THREE.LineBasicMaterial({ color: C.steel, transparent: true, opacity: 0.85 });
  group.add(new THREE.LineSegments(new THREE.EdgesGeometry(body, 28), edgeMaterial));

  // Side windows + B-pillar
  const glass = [
    [-1.2, 0.95], [-0.85, 1.27], [0.25, 1.31], [0.82, 0.97], [-1.2, 0.95],
  ];
  for (const z of [-0.91, 0.91]) {
    const pts = glass.map(([x, y]) => new THREE.Vector3(x, y, z));
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), edgeMaterial));
    group.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.25, 0.96, z), new THREE.Vector3(-0.22, 1.29, z)]),
        edgeMaterial
      )
    );
  }

  // Wheels
  const wheelGeo = new THREE.TorusGeometry(0.27, 0.1, 8, 22);
  const wheelMat = new THREE.MeshBasicMaterial({ color: 0x3a424a, wireframe: true });
  for (const x of [-1.4, 1.4]) {
    for (const z of [-0.84, 0.84]) {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.position.set(x, 0.37, z);
      group.add(wheel);
    }
  }

  // Head / tail lights
  const lampGeo = new THREE.BoxGeometry(0.05, 0.08, 0.34);
  for (const z of [-0.56, 0.56]) {
    const head = new THREE.Mesh(lampGeo, new THREE.MeshBasicMaterial({ color: C.amber }));
    head.position.set(2.34, 0.66, z);
    const tail = new THREE.Mesh(lampGeo, new THREE.MeshBasicMaterial({ color: C.red, transparent: true, opacity: 0.7 }));
    tail.position.set(-2.34, 0.74, z);
    group.add(head, tail);
  }

  return { group, edgeMaterial };
}

interface BusSceneProps {
  className?: string;
}

/**
 * 3D x-ray of a car's CAN network. ECUs broadcast frames along a shared two-wire bus,
 * an attacker can inject through the OBD-II port, and the detector taps the bus.
 * The page drives it with recorded frames; this component only draws them.
 */
export const BusScene = forwardRef<BusSceneHandle, BusSceneProps>(function BusScene({ className = '' }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<BusSceneHandle | null>(null);

  useImperativeHandle(ref, () => ({
    emit: (frame) => apiRef.current?.emit(frame),
    setAttack: (active) => apiRef.current?.setAttack(active),
    setVerdict: (verdict) => apiRef.current?.setVerdict(verdict),
    focus: (preset) => apiRef.current?.focus(preset),
  }));

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(C.bg, 1);
    container.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(C.bg, 10, 22);

    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 60);
    camera.position.copy(PRESETS.overview.pos);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(PRESETS.overview.target);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 3.5;
    controls.maxDistance = 13;
    controls.maxPolarAngle = Math.PI * 0.47;
    controls.autoRotate = !reducedMotion;
    controls.autoRotateSpeed = 0.55;

    // Ground
    const grid = new THREE.GridHelper(40, 80, C.line, 0x1a1e22);
    scene.add(grid);

    // Car
    const car = buildCar();
    scene.add(car.group);

    // CAN backbone: CAN-H / CAN-L pair
    const busMaterial = new THREE.LineBasicMaterial({ color: C.amberDim });
    for (const dy of [-0.018, 0.018]) {
      scene.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(BUS_X[0], BUS_Y + dy, 0),
            new THREE.Vector3(BUS_X[1], BUS_Y + dy, 0),
          ]),
          busMaterial
        )
      );
    }
    // Termination resistors at both ends
    const termGeo = new THREE.BoxGeometry(0.06, 0.12, 0.12);
    for (const x of BUS_X) {
      const term = new THREE.Mesh(termGeo, new THREE.MeshBasicMaterial({ color: C.amberDim }));
      term.position.set(x, BUS_Y, 0);
      scene.add(term);
    }

    const stubMaterial = new THREE.LineBasicMaterial({ color: C.line });
    const labelLayer = document.createElement('div');
    labelLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;';
    container.appendChild(labelLayer);

    type Label = { el: HTMLDivElement; pos: THREE.Vector3; alpha: () => number };
    const labels: Label[] = [];
    const addLabel = (text: string, pos: THREE.Vector3, color: string, alpha: () => number = () => 1) => {
      const el = document.createElement('div');
      el.textContent = text;
      el.style.cssText = `position:absolute;left:0;top:0;white-space:nowrap;font:500 10px 'JetBrains Mono',monospace;letter-spacing:.06em;text-transform:uppercase;color:${color};background:rgba(11,13,15,.78);border:1px solid rgba(255,255,255,.08);border-radius:4px;padding:2px 6px;will-change:transform;`;
      labelLayer.appendChild(el);
      labels.push({ el, pos, alpha });
    };

    // ECUs
    const ecuGeo = new THREE.BoxGeometry(0.26, 0.17, 0.26);
    const ecuEdges = new THREE.EdgesGeometry(ecuGeo);
    const ecuBase = new THREE.Color(0x2b2415);
    const ecuHot = new THREE.Color(C.amber);
    const ecus = ECUS.map((def) => {
      const pos = new THREE.Vector3(...def.pos);
      const material = new THREE.MeshBasicMaterial({ color: ecuBase.clone() });
      const mesh = new THREE.Mesh(ecuGeo, material);
      mesh.position.copy(pos);
      mesh.add(new THREE.LineSegments(ecuEdges, new THREE.LineBasicMaterial({ color: C.amber })));
      scene.add(mesh);

      const stub = [pos.clone(), new THREE.Vector3(pos.x, BUS_Y, pos.z), new THREE.Vector3(pos.x, BUS_Y, 0)];
      scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(stub), stubMaterial));
      addLabel(def.label, pos.clone().add(new THREE.Vector3(0, 0.2, 0)), '#929AA3');
      return { key: def.key, mesh, material, flash: 0, paths: busPaths(stub) };
    });

    // Attacker dongle on the OBD-II port
    const attacker = new THREE.Group();
    const dongle = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.2), new THREE.MeshBasicMaterial({ color: 0x3a1717 }));
    dongle.position.copy(ATTACKER_POS);
    dongle.add(
      new THREE.LineSegments(new THREE.EdgesGeometry(dongle.geometry), new THREE.LineBasicMaterial({ color: C.red }))
    );
    const attackerStub = [
      ATTACKER_POS.clone(),
      OBD_PORT.clone(),
      new THREE.Vector3(OBD_PORT.x, BUS_Y, OBD_PORT.z),
      new THREE.Vector3(OBD_PORT.x, BUS_Y, 0),
    ];
    attacker.add(dongle);
    attacker.add(
      new THREE.Line(new THREE.BufferGeometry().setFromPoints(attackerStub), new THREE.LineBasicMaterial({ color: C.red }))
    );
    const attackerHalo = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 16, 12),
      new THREE.MeshBasicMaterial({ color: C.red, transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    attackerHalo.position.copy(ATTACKER_POS);
    attacker.add(attackerHalo);
    attacker.visible = false;
    scene.add(attacker);
    const attackerPaths = busPaths(attackerStub);
    let attackOn = false;
    let attackLevel = 0;
    addLabel('Attacker · OBD-II', ATTACKER_POS.clone().add(new THREE.Vector3(0, 0.26, 0)), '#E05252', () => attackLevel);

    // OBD-II port marker (always present — it is a standard, physically exposed connector)
    const port = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.07, 0.07), new THREE.MeshBasicMaterial({ color: C.steel }));
    port.position.copy(OBD_PORT);
    scene.add(port);

    // Intrusion detector tapping the bus
    const idsColor = new THREE.Color(C.steel);
    const idsTarget = new THREE.Color(C.steel);
    const idsMaterial = new THREE.MeshBasicMaterial({ color: idsColor, wireframe: true });
    const ids = new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), idsMaterial);
    ids.position.copy(IDS_POS);
    const idsCoreMaterial = new THREE.MeshBasicMaterial({ color: idsColor, transparent: true, opacity: 0.35 });
    ids.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.11, 0), idsCoreMaterial));
    scene.add(ids);
    const ringMaterial = new THREE.MeshBasicMaterial({ color: idsColor });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.008, 6, 64), ringMaterial);
    ring.position.copy(IDS_POS);
    scene.add(ring);
    const tapMaterial = new THREE.LineDashedMaterial({ color: idsColor, dashSize: 0.07, gapSize: 0.05 });
    const tap = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([IDS_POS.clone(), new THREE.Vector3(IDS_POS.x, BUS_Y, 0)]),
      tapMaterial
    );
    tap.computeLineDistances();
    scene.add(tap);
    // Alert shockwave
    const waveMaterial = new THREE.MeshBasicMaterial({ color: C.red, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    const wave = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.37, 64), waveMaterial);
    wave.position.copy(IDS_POS);
    wave.rotation.x = -Math.PI / 2;
    scene.add(wave);
    let waveT = 1;
    addLabel('Intrusion detector', IDS_POS.clone().add(new THREE.Vector3(0, 0.32, 0)), '#E8EAED');

    // Packets (instanced: a bright core plus a soft additive halo)
    const coreGeo = new THREE.SphereGeometry(0.042, 10, 8);
    const core = new THREE.InstancedMesh(coreGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), MAX_PACKETS);
    const glow = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.095, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.1, depthWrite: false, blending: THREE.AdditiveBlending }),
      MAX_PACKETS
    );
    core.frustumCulled = false;
    glow.frustumCulled = false;
    core.count = 0;
    glow.count = 0;
    scene.add(core, glow);
    const amber = new THREE.Color(C.amber);
    const red = new THREE.Color(C.red);
    core.setColorAt(0, amber);
    glow.setColorAt(0, amber);

    const packets: Packet[] = Array.from({ length: MAX_PACKETS }, () => ({
      active: false,
      path: attackerPaths[0],
      dist: 0,
      injected: false,
    }));
    let cursor = 0;
    const spawn = (path: PathData, injected: boolean) => {
      for (let i = 0; i < MAX_PACKETS; i++) {
        const p = packets[(cursor + i) % MAX_PACKETS];
        if (!p.active) {
          p.active = true;
          p.path = path;
          p.dist = 0;
          p.injected = injected;
          cursor = (cursor + i + 1) % MAX_PACKETS;
          return;
        }
      }
    };

    // Verdict-driven tints
    let verdict: BusVerdict = 'idle';
    const busColor = new THREE.Color(C.amberDim);
    const busTarget = new THREE.Color(C.amberDim);
    const carColor = new THREE.Color(C.steel);
    const carTarget = new THREE.Color(C.steel);

    let goal: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;
    const clearGoal = () => {
      goal = null;
    };
    controls.addEventListener('start', clearGoal);

    apiRef.current = {
      emit: ({ id, injected }) => {
        if (injected) {
          spawn(attackerPaths[0], true);
          spawn(attackerPaths[1], true);
          return;
        }
        const owner = KNOWN_ID_OWNER[id];
        const ecu = owner ? ecus.find((e) => e.key === owner)! : ecus[parseInt(id, 16) % ecus.length];
        ecu.flash = 1;
        spawn(ecu.paths[0], false);
        spawn(ecu.paths[1], false);
      },
      setAttack: (active) => {
        attackOn = active;
        if (active) attacker.visible = true;
      },
      setVerdict: (next) => {
        if (next === 'suspicious' && verdict !== 'suspicious') waveT = 0;
        verdict = next;
        idsTarget.set(next === 'suspicious' ? C.red : next === 'normal' ? C.green : C.steel);
        busTarget.set(next === 'suspicious' ? 0x7a3232 : C.amberDim);
        carTarget.set(next === 'suspicious' ? 0x8a5a5a : C.steel);
      },
      focus: (preset) => {
        goal = { pos: PRESETS[preset].pos.clone(), target: PRESETS[preset].target.clone() };
      },
    };

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = container;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = `${w}px`;
      renderer.domElement.style.height = `${h}px`;
      camera.aspect = w / h;
      // Nudge the picture upward: the page overlays a caption along the bottom edge.
      camera.setViewOffset(w, h, 0, h * 0.1, w, h);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    const clock = new THREE.Clock();
    const dummy = new THREE.Object3D();
    const tmp = new THREE.Vector3();
    let raf = 0;

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(clock.getDelta(), 0.05);
      const ease = 1 - Math.exp(-dt * 5);

      // Packets
      let n = 0;
      for (const p of packets) {
        if (!p.active) continue;
        p.dist += PACKET_SPEED * dt;
        if (p.dist >= p.path.total) {
          p.active = false;
          continue;
        }
        pointAt(p.path, p.dist, tmp);
        dummy.position.copy(tmp);
        dummy.scale.setScalar(p.injected ? 1.4 : 1);
        dummy.updateMatrix();
        core.setMatrixAt(n, dummy.matrix);
        glow.setMatrixAt(n, dummy.matrix);
        const color = p.injected ? red : amber;
        core.setColorAt(n, color);
        glow.setColorAt(n, color);
        n++;
      }
      core.count = n;
      glow.count = n;
      core.instanceMatrix.needsUpdate = true;
      glow.instanceMatrix.needsUpdate = true;
      if (core.instanceColor) core.instanceColor.needsUpdate = true;
      if (glow.instanceColor) glow.instanceColor.needsUpdate = true;

      // ECU transmit flash
      for (const ecu of ecus) {
        if (ecu.flash > 0.001) {
          ecu.flash = Math.max(0, ecu.flash - dt * 7);
          ecu.material.color.copy(ecuBase).lerp(ecuHot, ecu.flash * 0.75);
          ecu.mesh.scale.setScalar(1 + ecu.flash * 0.18);
        }
      }

      // Attacker plug-in / unplug
      attackLevel += ((attackOn ? 1 : 0) - attackLevel) * ease;
      if (!attackOn && attackLevel < 0.02) attacker.visible = false;
      attacker.scale.setScalar(0.6 + attackLevel * 0.4);
      attackerHalo.scale.setScalar(1 + Math.sin(clock.elapsedTime * 6) * 0.15);

      // Detector
      idsColor.lerp(idsTarget, ease);
      idsMaterial.color.copy(idsColor);
      idsCoreMaterial.color.copy(idsColor);
      ringMaterial.color.copy(idsColor);
      tapMaterial.color.copy(idsColor);
      ids.rotation.y += dt * (verdict === 'suspicious' ? 2.6 : 0.8);
      ring.rotation.x += dt * 0.9;
      ring.rotation.y += dt * 0.6;
      if (verdict === 'suspicious' && waveT >= 1.1) waveT = 0;
      if (waveT < 1) {
        waveT += dt * 0.9;
        wave.scale.setScalar(1 + waveT * 7);
        waveMaterial.opacity = (1 - waveT) * 0.55;
      } else {
        waveMaterial.opacity = 0;
        if (verdict === 'suspicious') waveT += dt;
      }

      busColor.lerp(busTarget, ease);
      busMaterial.color.copy(busColor);
      carColor.lerp(carTarget, ease);
      car.edgeMaterial.color.copy(carColor);

      // Camera
      if (goal) {
        controls.autoRotate = false;
        camera.position.lerp(goal.pos, 1 - Math.exp(-dt * 2.4));
        controls.target.lerp(goal.target, 1 - Math.exp(-dt * 2.4));
        if (camera.position.distanceTo(goal.pos) < 0.04) goal = null;
      } else {
        controls.autoRotate = !reducedMotion;
      }
      controls.update();
      renderer.render(scene, camera);

      // Labels follow their anchors
      const w = container.clientWidth;
      const h = container.clientHeight;
      for (const label of labels) {
        tmp.copy(label.pos).project(camera);
        const visible = tmp.z < 1 ? label.alpha() : 0;
        label.el.style.opacity = String(visible);
        label.el.style.transform = `translate(-50%, -100%) translate(${((tmp.x + 1) / 2) * w}px, ${((1 - tmp.y) / 2) * h}px)`;
      }
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      controls.removeEventListener('start', clearGoal);
      controls.dispose();
      apiRef.current = null;
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        mesh.geometry?.dispose?.();
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material?.dispose?.();
      });
      renderer.dispose();
      renderer.domElement.remove();
      labelLayer.remove();
    };
  }, []);

  return <div ref={containerRef} className={`relative ${className}`} />;
});
