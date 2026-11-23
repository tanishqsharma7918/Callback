/* Callback — "Cal", the 3D mascot. Procedural Three.js (r128) character: clearcoat shell, glass visor
 * with animated eyes painted onto the curved surface, headset + mic boom (he's always on a call),
 * floating hands, hover thruster, studio PMREM reflections and a contact shadow.
 * API: CB.Mascot.create(container, {onClick}) → {setState(name, ms?), say(), destroy()} | null */
(function () {
  'use strict';
  const CB = (window.CB = window.CB || {});
  let glOk = null;
  function available() {
    if (typeof THREE === 'undefined') return false;
    if (glOk === null) {
      try { const c = document.createElement('canvas'); glOk = !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { glOk = false; }
    }
    return glOk;
  }
  const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function radialTexture(inner, outer, size = 128) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gr.addColorStop(0, inner);
    gr.addColorStop(1, outer);
    g.fillStyle = gr;
    g.fillRect(0, 0, size, size);
    const t = new THREE.CanvasTexture(c);
    return t;
  }
  function badgeTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#12161e';
    g.fillRect(0, 0, 256, 256);
    g.save();
    g.translate(128, 132);
    g.transform(1, 0, -0.2, 1, 0, 0);
    g.fillStyle = '#ffd60a';
    g.fillRect(-84, -20, 168, 46);
    g.restore();
    g.fillStyle = '#ffffff';
    g.font = '800 150px "Bricolage Grotesque", "Avenir Next", system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('C', 128, 138);
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    return t;
  }

  function create(container, opts = {}) {
    if (!available()) return fallback(container, opts);
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch (e) { return fallback(container, opts); }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.setClearColor(0x000000, 0);
    const canvas = renderer.domElement;
    canvas.style.cssText = 'width:100%;height:100%;display:block;cursor:pointer;touch-action:manipulation';
    canvas.setAttribute('aria-label', 'Cal, your Callback assistant');
    canvas.setAttribute('role', 'img');
    container.appendChild(canvas);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(27, 1, 0.1, 60);
    camera.position.set(0, 0.22, 6.4);
    camera.lookAt(0, 0.02, 0);
    const disposables = [];
    const keep = (o) => (disposables.push(o), o);

    // ── studio environment for realistic reflections ──
    const pm = new THREE.PMREMGenerator(renderer);
    const env = new THREE.Scene();
    env.add(new THREE.Mesh(keep(new THREE.BoxGeometry(24, 24, 24)), keep(new THREE.MeshBasicMaterial({ color: 0x2a2f38, side: THREE.BackSide }))));
    const panel = (w, h, color, k, pos) => {
      const m = new THREE.Mesh(keep(new THREE.PlaneGeometry(w, h)), keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide })));
      m.position.set(pos[0], pos[1], pos[2]);
      m.lookAt(0, 0, 0);
      env.add(m);
    };
    panel(9, 6, '#ffffff', 5.0, [-6, 7, 7]);   // key softbox
    panel(7, 7, '#dbe6ff', 1.8, [9, 1.5, 3]);  // cool fill
    panel(8, 3, '#ffd84a', 2.6, [1, 4, -10]);  // warm brand rim
    panel(16, 3, '#ffffff', 1.1, [0, -8, 1]);  // floor bounce
    panel(3, 10, '#ffffff', 2.2, [-11, 0, -2]); // strip light
    const envRT = pm.fromScene(env, 0.035);
    scene.environment = envRT.texture;
    pm.dispose();

    scene.add(new THREE.HemisphereLight(0xffffff, 0x3a4250, 0.35));
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(-3, 4, 5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xffd36a, 0.7);
    rim.position.set(3, 2, -4);
    scene.add(rim);

    // ── materials ──
    const shell = keep(new THREE.MeshPhysicalMaterial({ color: 0xf3f4f6, roughness: 0.26, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.06, envMapIntensity: 1.15 }));
    const graphite = keep(new THREE.MeshPhysicalMaterial({ color: 0x2b303a, roughness: 0.34, metalness: 0.55, clearcoat: 0.6, clearcoatRoughness: 0.2, envMapIntensity: 1.2 }));
    const accent = keep(new THREE.MeshStandardMaterial({ color: 0xffd60a, emissive: 0xffc400, emissiveIntensity: 0.55, roughness: 0.3, metalness: 0.1 }));
    const glow = (col, s) => {
      const sm = keep(new THREE.SpriteMaterial({ map: keep(radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)')), color: col, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.9 }));
      const sp = new THREE.Sprite(sm);
      sp.scale.set(s, s, s);
      return sp;
    };

    // ── face canvas (emissive map on the visor) ──
    const fc = document.createElement('canvas');
    fc.width = 512; fc.height = 256;
    const fx = fc.getContext('2d');
    const faceTex = keep(new THREE.CanvasTexture(fc));
    faceTex.encoding = THREE.sRGBEncoding;
    faceTex.anisotropy = 4;

    // ── character ──
    const root = new THREE.Group();
    scene.add(root);
    // head
    const head = new THREE.Group();
    head.position.set(0, 0.36, 0);
    root.add(head);
    const headShell = new THREE.Mesh(keep(new THREE.SphereGeometry(0.6, 64, 48)), shell);
    headShell.scale.set(1.12, 0.93, 1.0);
    head.add(headShell);
    const visorGeo = keep(new THREE.SphereGeometry(0.606, 64, 40, Math.PI / 2 - 0.98, 1.96, Math.PI / 2 - 0.56, 1.06));
    const visorMat = keep(new THREE.MeshPhysicalMaterial({ color: 0x07090e, roughness: 0.1, metalness: 0.25, clearcoat: 1, clearcoatRoughness: 0.02, emissive: 0xffffff, emissiveMap: faceTex, emissiveIntensity: 1.55, envMapIntensity: 1.4 }));
    const visor = new THREE.Mesh(visorGeo, visorMat);
    visor.scale.set(1.12, 0.93, 1.0);
    head.add(visor);
    // visor rim (bezel)
    const bezelCurve = [];
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      bezelCurve.push(new THREE.Vector3(Math.cos(a) * 0.5, Math.sin(a) * 0.29, 0));
    }
    // headset: band + ear pods + mic
    const band = new THREE.Mesh(keep(new THREE.TorusGeometry(0.72, 0.045, 18, 72, Math.PI)), graphite);
    band.position.y = 0.02;
    band.rotation.y = Math.PI / 2 * 0; // in XY plane, arching over the head
    head.add(band);
    [-1, 1].forEach((s) => {
      const pod = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.19, 0.19, 0.14, 40)), graphite);
      pod.rotation.z = Math.PI / 2;
      pod.position.set(s * 0.69, 0.0, 0);
      head.add(pod);
      const cap = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.155, 0.155, 0.02, 40)), shell);
      cap.rotation.z = Math.PI / 2;
      cap.position.set(s * 0.77, 0.0, 0);
      head.add(cap);
      const ring = new THREE.Mesh(keep(new THREE.TorusGeometry(0.17, 0.018, 12, 48)), accent);
      ring.rotation.y = Math.PI / 2;
      ring.position.set(s * 0.765, 0, 0);
      head.add(ring);
    });
    const micCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(-0.74, -0.04, 0.06), new THREE.Vector3(-0.7, -0.3, 0.32), new THREE.Vector3(-0.46, -0.44, 0.56), new THREE.Vector3(-0.22, -0.43, 0.66)]);
    head.add(new THREE.Mesh(keep(new THREE.TubeGeometry(micCurve, 40, 0.022, 10, false)), graphite));
    const micTip = new THREE.Mesh(keep(new THREE.SphereGeometry(0.05, 24, 16)), graphite);
    micTip.position.copy(micCurve.getPoint(1));
    head.add(micTip);
    const micLed = new THREE.Mesh(keep(new THREE.SphereGeometry(0.018, 12, 8)), accent);
    micLed.position.copy(micCurve.getPoint(1)).add(new THREE.Vector3(0.02, 0.02, 0.04));
    head.add(micLed);
    // antenna
    const ant = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.014, 0.02, 0.32, 12)), graphite);
    ant.position.set(0.18, 0.66, -0.05);
    ant.rotation.z = -0.28;
    head.add(ant);
    const antTip = new THREE.Mesh(keep(new THREE.SphereGeometry(0.055, 24, 16)), accent);
    antTip.position.set(0.225, 0.83, -0.05);
    head.add(antTip);
    const antGlow = glow(0xffd84a, 0.42);
    antGlow.position.copy(antTip.position);
    head.add(antGlow);
    // neck + body
    const neck = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.15, 0.2, 0.12, 40)), graphite);
    neck.position.y = -0.2;
    root.add(neck);
    const body = new THREE.Group();
    root.add(body);
    const prof = new THREE.SplineCurve([
      new THREE.Vector2(0.001, -1.02), new THREE.Vector2(0.2, -1.0), new THREE.Vector2(0.33, -0.92), new THREE.Vector2(0.41, -0.79),
      new THREE.Vector2(0.45, -0.62), new THREE.Vector2(0.45, -0.47), new THREE.Vector2(0.41, -0.35), new THREE.Vector2(0.32, -0.26),
      new THREE.Vector2(0.18, -0.22), new THREE.Vector2(0.001, -0.21),
    ]).getPoints(48);
    const torso = new THREE.Mesh(keep(new THREE.LatheGeometry(prof, 64)), shell);
    body.add(torso);
    const waist = new THREE.Mesh(keep(new THREE.TorusGeometry(0.437, 0.016, 12, 72)), graphite);
    waist.rotation.x = Math.PI / 2;
    waist.position.y = -0.7;
    body.add(waist);
    const badgeTex = keep(badgeTexture());
    const badge = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.115, 0.115, 0.03, 48)), [graphite, keep(new THREE.MeshPhysicalMaterial({ map: badgeTex, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.05 })), graphite]);
    badge.rotation.x = Math.PI / 2;
    badge.position.set(0, -0.5, 0.445);
    body.add(badge);
    // thruster
    const thr = new THREE.Mesh(keep(new THREE.TorusGeometry(0.16, 0.026, 16, 56)), accent);
    thr.rotation.x = Math.PI / 2;
    thr.position.y = -1.0;
    body.add(thr);
    const coneMat = keep(new THREE.MeshBasicMaterial({ map: keep((() => { const c = document.createElement('canvas'); c.width = 4; c.height = 128; const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, 'rgba(255,214,10,0.0)'); gr.addColorStop(0.15, 'rgba(255,214,10,0.55)'); gr.addColorStop(1, 'rgba(255,214,10,0.0)'); g.fillStyle = gr; g.fillRect(0, 0, 4, 128); return new THREE.CanvasTexture(c); })()), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    const cone = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.15, 0.04, 0.5, 32, 1, true)), coneMat);
    cone.position.y = -1.27;
    body.add(cone);
    const thrGlow = glow(0xffc83a, 0.7);
    thrGlow.position.y = -1.04;
    body.add(thrGlow);
    // hands
    const hands = [-1, 1].map((s) => {
      const g = new THREE.Group();
      const h = new THREE.Mesh(keep(new THREE.SphereGeometry(0.115, 36, 28)), shell);
      h.scale.set(1, 1.12, 0.88);
      g.add(h);
      const cuff = new THREE.Mesh(keep(new THREE.TorusGeometry(0.075, 0.022, 12, 36)), graphite);
      cuff.rotation.x = Math.PI / 2;
      cuff.position.y = 0.11;
      g.add(cuff);
      g.userData = { side: s, base: new THREE.Vector3(s * 0.66, -0.55, 0.1) };
      g.position.copy(g.userData.base);
      root.add(g);
      return g;
    });
    // contact shadow
    const shadowMat = keep(new THREE.MeshBasicMaterial({ map: keep(radialTexture('rgba(0,0,0,0.55)', 'rgba(0,0,0,0)')), transparent: true, depthWrite: false }));
    const shadow = new THREE.Mesh(keep(new THREE.PlaneGeometry(1.5, 1.5)), shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -1.62;
    scene.add(shadow);

    // ── face drawing ──
    const F = { state: 'idle', blink: 1, nextBlink: 1.5, lookX: 0, lookY: 0, talk: 0, mouth: [0, 0, 0, 0, 0, 0, 0], dirty: true };
    const EYE = '#fff1a6', GLOW = '#ffcf1f';
    function pill(x, y, w, h) {
      const r = Math.min(w, h) / 2;
      fx.beginPath();
      fx.moveTo(x - w / 2 + r, y - h / 2);
      fx.arcTo(x + w / 2, y - h / 2, x + w / 2, y + h / 2, r);
      fx.arcTo(x + w / 2, y + h / 2, x - w / 2, y + h / 2, r);
      fx.arcTo(x - w / 2, y + h / 2, x - w / 2, y - h / 2, r);
      fx.arcTo(x - w / 2, y - h / 2, x + w / 2, y - h / 2, r);
      fx.closePath();
      fx.fill();
    }
    function drawFace(t) {
      fx.clearRect(0, 0, 512, 256);
      fx.fillStyle = '#000';
      fx.fillRect(0, 0, 512, 256);
      fx.shadowColor = GLOW;
      fx.shadowBlur = 26;
      fx.fillStyle = EYE;
      fx.strokeStyle = EYE;
      fx.lineCap = 'round';
      const cx = 256 + F.lookX * 22, cy = 118 - F.lookY * 16;
      const dx = 80;
      const st = F.state;
      if (st === 'happy' || st === 'wave') {
        fx.lineWidth = 17;
        [-1, 1].forEach((s) => {
          if (st === 'wave' && s === -1) { pill(cx + s * dx, cy, 46, 80 * F.blink); return; }
          fx.beginPath(); fx.arc(cx + s * dx, cy + 18, 30, Math.PI * 1.12, Math.PI * 1.88); fx.stroke();
        });
        fx.shadowBlur = 30; fx.fillStyle = 'rgba(255,120,140,.55)'; fx.shadowColor = 'rgba(255,90,120,.8)';
        [-1, 1].forEach((s) => { fx.beginPath(); fx.ellipse(cx + s * (dx + 34), cy + 52, 22, 11, 0, 0, Math.PI * 2); fx.fill(); });
      } else if (st === 'concerned') {
        [-1, 1].forEach((s) => pill(cx + s * dx, cy + 6, 46, 70 * F.blink));
        fx.shadowBlur = 0; fx.fillStyle = '#000';
        [-1, 1].forEach((s) => { fx.save(); fx.translate(cx + s * dx, cy - 36); fx.rotate(s * 0.42); fx.fillRect(-50, -40, 100, 40); fx.restore(); });
        fx.shadowBlur = 20; fx.strokeStyle = EYE; fx.lineWidth = 9;
        fx.beginPath(); fx.arc(cx, cy + 108, 24, Math.PI * 1.2, Math.PI * 1.8); fx.stroke();
      } else if (st === 'sleep') {
        fx.lineWidth = 12;
        [-1, 1].forEach((s) => { fx.beginPath(); fx.moveTo(cx + s * dx - 24, cy + 10); fx.lineTo(cx + s * dx + 24, cy + 10); fx.stroke(); });
      } else {
        let w = 46, h = 80;
        if (st === 'listening') { const p = 1 + Math.sin(t * 6) * 0.05; w *= 1.08 * p; h *= 1.06 * p; }
        if (st === 'thinking') { w = 44; h = 64; }
        [-1, 1].forEach((s) => pill(cx + s * dx + (st === 'thinking' ? 14 : 0), cy - (st === 'thinking' ? 10 : 0), w, Math.max(6, h * F.blink)));
        if (st === 'thinking') {
          for (let i = 0; i < 3; i++) {
            const a = 0.35 + 0.65 * Math.max(0, Math.sin(t * 5 - i * 0.7));
            fx.globalAlpha = a;
            fx.beginPath(); fx.arc(cx - 26 + i * 26, cy + 92, 8, 0, Math.PI * 2); fx.fill();
          }
          fx.globalAlpha = 1;
        }
        if (st === 'talking' || st === 'listening') {
          const n = F.mouth.length, bw = 10, gap = 8;
          const x0 = cx - ((n - 1) * (bw + gap)) / 2;
          for (let i = 0; i < n; i++) {
            const target = st === 'talking' ? 6 + Math.abs(Math.sin(t * 13 + i * 1.7) * Math.sin(t * 4.1 + i)) * 34 : 4 + Math.abs(Math.sin(t * 4 + i * 0.9)) * 8;
            F.mouth[i] += (target - F.mouth[i]) * 0.35;
            pill(x0 + i * (bw + gap), cy + 92, bw, Math.max(bw, F.mouth[i]));
          }
        } else if (st === 'idle') {
          fx.lineWidth = 8; fx.shadowBlur = 16;
          fx.beginPath(); fx.arc(cx, cy + 74, 20, Math.PI * 0.2, Math.PI * 0.8); fx.stroke();
        }
      }
      fx.shadowBlur = 0;
      faceTex.needsUpdate = true;
    }

    // ── state machine ──
    let base = 'idle', revertAt = 0;
    function setState(s, ms) {
      F.state = s;
      F.dirty = true;
      lastInteract = performance.now();
      if (ms) { revertAt = performance.now() + ms; } else { revertAt = 0; base = s; }
      kick();
    }
    // pointer look
    let lastInteract = performance.now();
    const look = { x: 0, y: 0 };
    const onMove = (e) => {
      const r = container.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height * 0.4;
      look.x = CB.clamp((e.clientX - cx) / (window.innerWidth * 0.5), -1, 1);
      look.y = CB.clamp(-(e.clientY - cy) / (window.innerHeight * 0.5), -1, 1);
      lastInteract = performance.now();
      kick();
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    const onEnter = () => { if (F.state === 'idle') setState('happy', 1200); };
    canvas.addEventListener('pointerenter', onEnter);
    canvas.addEventListener('click', () => opts.onClick && opts.onClick());

    // ── size / visibility ──
    function resize() {
      const w = Math.max(40, container.clientWidth), h = Math.max(40, container.clientHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, w < 160 ? 1.5 : 2));
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      // keep the character framed in tall and wide boxes alike
      const fitH = 3.35, fitW = 2.6;
      const distH = (fitH / 2) / Math.tan((camera.fov * Math.PI) / 360);
      const distW = (fitW / 2) / Math.tan((camera.fov * Math.PI) / 360) / camera.aspect;
      camera.position.z = Math.max(distH, distW);
      camera.updateProjectionMatrix();
      kick();
    }
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    let visible = true;
    const io = new IntersectionObserver((es) => { visible = es[0].isIntersecting; kick(); });
    io.observe(container);
    const onVis = () => kick();
    document.addEventListener('visibilitychange', onVis);

    // ── loop ──
    let raf = 0, last = performance.now(), t = 0, faceAcc = 0, running = false, destroyed = false;
    const tmpV = new THREE.Vector3();
    function kick() { if (!running && !destroyed) { running = true; last = performance.now(); raf = requestAnimationFrame(frame); } }
    function frame(now) {
      if (destroyed) return;
      if (!visible || document.hidden) { running = false; return; }
      // Battery/perf: 30 fps in the dock, 60 in the panel; drop to 15/30 after 6 s without interaction.
      const small = container.clientWidth < 160;
      const busy = F.state !== 'idle' || now - lastInteract < 6000;
      const interval = small ? (busy ? 33 : 66) : (busy ? 15 : 33);
      if (now - last < interval) { raf = requestAnimationFrame(frame); return; }
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      t += dt;
      const rm = reduceMotion();
      if (revertAt && now > revertAt) { revertAt = 0; F.state = base; F.dirty = true; }
      const st = F.state;
      // blink
      F.nextBlink -= dt;
      if (F.nextBlink <= 0) { F.blink = Math.max(0.06, F.blink - dt * 14); if (F.blink <= 0.06) F.nextBlink = 2.2 + Math.random() * 3.2; F.dirty = true; }
      else if (F.blink < 1) { F.blink = Math.min(1, F.blink + dt * 9); F.dirty = true; }
      // look
      const tx = st === 'thinking' ? 0.55 : look.x, ty = st === 'thinking' ? 0.6 : look.y;
      F.lookX += (tx - F.lookX) * 0.12;
      F.lookY += (ty - F.lookY) * 0.12;
      head.rotation.y += (F.lookX * 0.5 - head.rotation.y) * 0.08;
      head.rotation.x += (-F.lookY * 0.26 + (st === 'concerned' ? 0.12 : 0) - head.rotation.x) * 0.08;
      head.rotation.z += ((st === 'thinking' ? 0.12 : st === 'happy' ? Math.sin(t * 7) * 0.05 : 0) - head.rotation.z) * 0.08;
      body.rotation.y += (head.rotation.y * 0.35 - body.rotation.y) * 0.06;
      // hover
      const bob = rm ? 0 : Math.sin(t * (st === 'happy' ? 4 : 1.7)) * (st === 'happy' ? 0.07 : 0.045);
      root.position.y = bob;
      root.rotation.z = rm ? 0 : Math.sin(t * 0.9) * 0.025;
      shadow.scale.setScalar(1 - bob * 1.8);
      shadowMat.opacity = 0.75 - bob * 2;
      // hands
      hands.forEach((h, i) => {
        const s = h.userData.side;
        tmpV.copy(h.userData.base);
        if (!rm) tmpV.y += Math.sin(t * 1.7 + i * 1.3 - 0.6) * 0.035;
        if (st === 'talking' && !rm) { tmpV.y += Math.sin(t * 5 + i * Math.PI) * 0.05; tmpV.z += 0.05; }
        if (st === 'thinking' && s === 1) tmpV.set(0.3, -0.12, 0.55);
        if (st === 'happy') { tmpV.set(s * 0.6, -0.1 + (rm ? 0 : Math.abs(Math.sin(t * 7 + i)) * 0.08), 0.18); }
        if (st === 'wave' && s === 1) { tmpV.set(0.66 + (rm ? 0 : Math.sin(t * 10) * 0.07), 0.2, 0.12); }
        if (st === 'concerned') tmpV.set(s * 0.5, -0.62, 0.22);
        h.position.lerp(tmpV, 0.14);
        h.rotation.z += ((st === 'wave' && s === 1 ? Math.sin(t * 10) * 0.4 : 0) - h.rotation.z) * 0.2;
      });
      // lights
      const pulse = st === 'thinking' ? 0.5 + Math.abs(Math.sin(t * 8)) * 0.9 : 0.55 + Math.sin(t * 2) * 0.12;
      accent.emissiveIntensity = pulse;
      antGlow.material.opacity = 0.55 + pulse * 0.35;
      coneMat.opacity = 0.75 + Math.sin(t * 9) * 0.15;
      thrGlow.material.opacity = 0.6 + Math.sin(t * 9) * 0.2;
      // face at ~30fps when animated
      faceAcc += dt;
      const animated = st === 'talking' || st === 'thinking' || st === 'listening' || st === 'wave' || F.dirty || Math.abs(F.lookX - tx) > 0.01 || Math.abs(F.lookY - ty) > 0.01;
      if (animated && faceAcc > 0.033) { faceAcc = 0; drawFace(t); F.dirty = false; }
      renderer.render(scene, camera);
      // idle low-power: when nothing animates and motion is reduced, stop the loop
      if (rm && !animated && st === 'idle') { running = false; return; }
      raf = requestAnimationFrame(frame);
    }
    resize();
    drawFace(0);
    setState('wave', 2200);

    return {
      setState,
      get state() { return F.state; },
      canvas,
      destroy() {
        destroyed = true;
        cancelAnimationFrame(raf);
        ro.disconnect(); io.disconnect();
        window.removeEventListener('pointermove', onMove);
        document.removeEventListener('visibilitychange', onVis);
        disposables.forEach((d) => d.dispose && d.dispose());
        envRT.dispose();
        renderer.dispose();
        canvas.remove();
      },
    };
  }

  /** 2D fallback when WebGL is unavailable: same character, flat. */
  function fallback(container, opts) {
    const el = document.createElement('div');
    el.className = 'cal-2d';
    el.innerHTML = `<svg viewBox="0 0 120 140" width="100%" height="100%" aria-label="Cal, your Callback assistant" role="img">
      <ellipse cx="60" cy="134" rx="26" ry="4" fill="rgba(0,0,0,.18)"/>
      <path d="M38 78q22-8 44 0l-4 40q-18 8-36 0z" fill="#f3f4f6" stroke="#c9ccd3"/>
      <circle cx="60" cy="96" r="7" fill="#12161e"/><rect x="54" y="94" width="12" height="3" fill="#ffd60a"/>
      <ellipse cx="60" cy="50" rx="38" ry="32" fill="#f3f4f6" stroke="#c9ccd3"/>
      <rect x="30" y="34" width="60" height="32" rx="16" fill="#0b0f16"/>
      <g class="cal-eyes" fill="#ffe45c"><rect x="44" y="42" width="9" height="16" rx="4.5"/><rect x="67" y="42" width="9" height="16" rx="4.5"/></g>
      <rect x="18" y="42" width="8" height="16" rx="3" fill="#2b303a"/><rect x="94" y="42" width="8" height="16" rx="3" fill="#2b303a"/>
      <path d="M22 50q-2 18 18 22" stroke="#2b303a" stroke-width="2.5" fill="none"/><circle cx="72" cy="14" r="4" fill="#ffd60a"/><path d="M68 20l2-6" stroke="#2b303a" stroke-width="2"/>
    </svg>`;
    el.style.cssText = 'width:100%;height:100%;cursor:pointer';
    el.onclick = () => opts.onClick && opts.onClick();
    container.appendChild(el);
    return { setState(s) { el.dataset.state = s; }, get state() { return el.dataset.state || 'idle'; }, canvas: el, destroy() { el.remove(); } };
  }

  CB.Mascot = { available, create };
})();
