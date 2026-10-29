// Una escena de la película de "El mundo gira al revés" parada sobre su ilustración.
// Marco del ancla: ancho de la ilustración = 1, Y hacia arriba de la página, Z saliendo del papel.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

export async function buildScene(page) {
  const group = new THREE.Group();
  group.add(new THREE.HemisphereLight(0xfff4e2, 0x6d5f50, 2.4));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(.6, -.8, 1.6); group.add(sun);

  const gltf = await loader.loadAsync(`models/${page.scene}.glb`);
  const model = gltf.scene;
  const mixer = new THREE.AnimationMixer(model);
  const clips = gltf.animations;
  const dur = Math.max(0.001, ...clips.map(c => c.duration));
  clips.forEach(c => { const a = mixer.clipAction(c); a.play(); });
  mixer.setTime(0);
  model.updateMatrixWorld(true);
  model.traverse(o => { if (o.isMesh) o.frustumCulled = false; });

  // Tapa: el elenco en semicírculo en vez de una fila larga
  if (page.layout === 'arc') {
    // en glTF las mallas con piel no cuelgan del esqueleto: se agrupan por el nodo raíz de sus huesos
    const top = o => { while (o.parent && o.parent !== model) o = o.parent; return o; };
    const boxes = new Map();
    model.traverse(o => {
      if (!o.isSkinnedMesh) return;
      const k = top(o.skeleton.bones[0]);
      if (!boxes.has(k)) boxes.set(k, new THREE.Box3());
      boxes.get(k).expandByObject(o, true);
    });
    const kids = [...boxes].map(([k, b]) => ({ k, x: b.getCenter(new THREE.Vector3()).x })).sort((a, b) => a.x - b.x);
    const R = 2.4, n = kids.length;
    kids.forEach(({ k, x }, i) => {
      const a = Math.PI * (0.15 + 0.7 * i / Math.max(n - 1, 1));
      k.position.x += -Math.cos(a) * R - x;
      k.position.z += -Math.sin(a) * R * .55;
      k.rotation.y += (Math.PI / 2 - a) * .6;
    });
    model.updateMatrixWorld(true);
  }

  // Orientar el diorama como lo filmó la cámara de la película: el lector mira desde el borde inferior de la página
  if (page.camFwd && page.layout !== 'arc') {
    const [fx, , fz] = page.camFwd;
    model.rotation.y = Math.atan2(fx, -fz);
    model.updateMatrixWorld(true);
  }

  // Decorado colgado de la pared (ventanas, lámparas): en el aire queda raro, se oculta
  const floorY = new THREE.Box3().setFromObject(model, true).min.y;
  model.traverse(o => {
    if (o.isMesh && !o.isSkinnedMesh) {
      const b = new THREE.Box3().setFromObject(o, true);
      if (b.min.y - floorY > .7) o.visible = false;
    }
  });

  // Medir la escena en su primer cuadro (con huesos) y entrarla en la página
  // Encuadre: los personajes (mallas con piel) a lo largo de toda la animación; el decorado acompaña
  const chars = new THREE.Box3(), all = new THREE.Box3();
  for (let k = 0; k <= 8; k++) {            // muestrear 9 instantes de la animación
    mixer.setTime(dur * k / 8); model.updateMatrixWorld(true);
    model.traverse(o => {
      if (!o.isMesh || !o.visible) return;
      all.expandByObject(o, true);
      if (o.isSkinnedMesh) chars.expandByObject(o, true);
    });
  }
  mixer.setTime(0); model.updateMatrixWorld(true);
  let box = all;
  if (!chars.isEmpty()) {
    const cs = chars.getSize(new THREE.Vector3()), cc = chars.getCenter(new THREE.Vector3());
    const reach = Math.max(cs.x, cs.z, 1.2) * .5 + 1.2;   // hasta 1,2 m alrededor de los personajes
    box = chars.clone();
    model.traverse(o => {
      if (!o.isMesh || o.isSkinnedMesh || !o.visible) return;
      const b = new THREE.Box3().setFromObject(o, true), c = b.getCenter(new THREE.Vector3());
      if (Math.hypot(c.x - cc.x, c.z - cc.z) > reach) o.visible = false; else box.union(b);
    });
  }
  const size = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3());
  const footprint = Math.max(size.x, size.z, 1e-3);
  const s = Math.min(.82 / footprint, .55 / Math.max(size.y, 1e-3));
  const stand = new THREE.Group();          // Y del modelo -> Z de la página
  stand.rotation.x = Math.PI / 2;
  const holder = new THREE.Group(); holder.scale.setScalar(s);
  model.position.set(-ctr.x, -box.min.y, -ctr.z);
  holder.add(model); stand.add(holder);
  // "lean": inclina el diorama hacia el lector cuando mira desde arriba (efecto libro pop-up)
  const lean = new THREE.Group();
  lean.position.set(0, -page.aspect * .12, 0);
  lean.add(stand);
  group.add(lean);
  const qTarget = new THREE.Quaternion(), axis = new THREE.Vector3();

  // sombra de contacto
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'), gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(40,28,16,.38)'); gr.addColorStop(1, 'rgba(40,28,16,0)'); x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
  const sh = new THREE.Mesh(new THREE.PlaneGeometry(footprint * s * 1.3, size.z * s * 1.3 + .1),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  sh.position.set(0, -page.aspect * .12, .002); group.add(sh);

  let t0 = null;
  return {
    group,
    onShow() { t0 = null; },
    update(t, dt, cam) {
      if (t0 === null) t0 = t;
      if (cam) {   // cam = posición de la cámara en coordenadas de la página
        const dx = cam.x - lean.position.x, dy = cam.y - lean.position.y, h = Math.hypot(dx, dy);
        const alpha = Math.atan2(h, Math.max(cam.z, 1e-3));          // 0 = mirando desde arriba
        const amt = alpha < 1.1 ? (1 - alpha / 1.1) * .84 : 0;     // hasta ~48°
        const ux = h > .05 ? dx / h : 0, uy = h > .05 ? dy / h : -1; // hacia el lector (o el borde inferior)
        axis.set(-uy, ux, 0).normalize();
        qTarget.setFromAxisAngle(axis, amt);
        lean.quaternion.slerp(qTarget, Math.min(1, dt * 4));
      }
      const HOLD = 1.2, FADE = .35, cycle = dur + HOLD;
      const lt = t - t0, n = Math.floor(lt / cycle), u = lt - n * cycle;
      // entrada con rebote la primera vez; en cada vuelta, se encoge y vuelve a crecer
      let sc = 1;
      if (n === 0 && u < .7) { const k = u / .7; sc = 1 - Math.pow(1 - k, 3); }
      else if (n > 0 && u < FADE) { const k = u / FADE; sc = .6 + .4 * (1 - Math.pow(1 - k, 3)); }
      if (u > cycle - FADE) { const k = (cycle - u) / FADE; sc = .6 + .4 * k; }
      stand.scale.setScalar(Math.max(sc, .001));
      mixer.setTime(Math.min(u, dur - 1e-3));
    }
  };
}
