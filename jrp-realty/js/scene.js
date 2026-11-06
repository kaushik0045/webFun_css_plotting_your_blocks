/* JRP Realty: 3D hero scene (Three.js r128).
   A city of towers that rise like a bar chart, a glowing growth line climbing
   through it, and particles of capital drifting upward. Falls back to the hero
   photo if WebGL is unavailable. */
(function () {
  var hosts = document.querySelectorAll('[data-scene]');
  if (!hosts.length || !window.THREE) return;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  hosts.forEach(init);

  function rng(seed) { return function () { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }
  function clamp(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function ease(t) { return 1 - Math.pow(1 - t, 3); }

  function init(host) {
    var renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); }
    catch (e) { return; }
    if (!renderer.getContext()) return;

    var mini = host.getAttribute('data-scene') === 'mini';
    var rand = rng(mini ? 7 : 42);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setClearColor(0x000000, 0);
    var canvas = renderer.domElement;
    canvas.className = 'scene-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    host.insertBefore(canvas, host.firstChild);
    host.classList.add('has-3d');

    var scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x050506, 20, 62);
    var camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);

    scene.add(new THREE.AmbientLight(0xffffff, 0.32));
    var key = new THREE.DirectionalLight(0xffffff, 0.75); key.position.set(12, 22, 8); scene.add(key);
    var rim = new THREE.DirectionalLight(0xe10600, 0.6); rim.position.set(-14, 6, -12); scene.add(rim);
    var glow = new THREE.PointLight(0xff1a0f, 2.4, 34); glow.position.set(0, 9, 0); scene.add(glow);

    // Floor: red-tinted grid fading into the fog
    var grid = new THREE.GridHelper(140, 70, 0xe10600, 0x26262b);
    grid.material.transparent = true; grid.material.opacity = 0.32;
    scene.add(grid);

    // City of towers, taller toward the centre and rising left to right like a chart
    var city = new THREE.Group(); scene.add(city);
    var N = mini ? 9 : 13, gap = 1.65;
    var boxGeo = new THREE.BoxGeometry(1, 1, 1); boxGeo.translate(0, 0.5, 0);
    var edgeGeo = new THREE.EdgesGeometry(boxGeo);
    var bodyMat = new THREE.MeshStandardMaterial({ color: 0x141418, metalness: 0.65, roughness: 0.32 });
    var hotMat = new THREE.MeshStandardMaterial({ color: 0x1c0d0c, metalness: 0.6, roughness: 0.3, emissive: 0x3a0300, emissiveIntensity: 0.6 });
    var redEdge = new THREE.LineBasicMaterial({ color: 0xff2a1f, transparent: true, opacity: 0.95 });
    var dimEdge = new THREE.LineBasicMaterial({ color: 0x6a6a74, transparent: true, opacity: 0.45 });
    var towers = [];
    for (var i = 0; i < N; i++) {
      for (var j = 0; j < N; j++) {
        var x = (i - (N - 1) / 2) * gap, z = (j - (N - 1) / 2) * gap;
        var d = Math.sqrt(x * x + z * z);
        if (rand() < 0.16 || d > N * gap * 0.62) continue;
        var trend = (x + N * gap / 2) / (N * gap);           // 0 → 1 left to right
        var h = (0.5 + rand() * 1.1) * (1 + Math.max(0, 8.5 - d) * 0.5) * (0.55 + trend * 0.9);
        var w = 0.85 + rand() * 0.35;
        var hot = h > 6.2;
        var m = new THREE.Mesh(boxGeo, hot ? hotMat : bodyMat);
        m.position.set(x, 0, z);
        m.scale.set(w, 0.001, w);
        m.add(new THREE.LineSegments(edgeGeo, hot ? redEdge : dimEdge));
        city.add(m);
        towers.push({ m: m, h: h, delay: 0.15 + d * 0.07 + rand() * 0.25 });
      }
    }

    // Growth line: a rising curve weaving through the skyline
    var pts = [];
    for (var k = 0; k <= 12; k++) {
      var t = k / 12;
      pts.push(new THREE.Vector3(-12 + 24 * t, 1.2 + t * t * 10 + Math.sin(t * 10) * 0.7, 5 - t * 9 + Math.sin(t * 6) * 1.6));
    }
    var curve = new THREE.CatmullRomCurve3(pts);
    var tubeGeo = new THREE.TubeGeometry(curve, 240, 0.075, 8, false);
    var tube = new THREE.Mesh(tubeGeo, new THREE.MeshBasicMaterial({ color: 0xff2a1f }));
    var haloGeo = new THREE.TubeGeometry(curve, 240, 0.32, 10, false);
    var halo = new THREE.Mesh(haloGeo, new THREE.MeshBasicMaterial({ color: 0xff2a1f, transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false }));
    scene.add(tube); scene.add(halo);
    var tubeCount = tubeGeo.index.count, haloCount = haloGeo.index.count;

    // Pulse travelling along the line
    var orb = new THREE.Mesh(new THREE.SphereGeometry(0.24, 20, 20), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    var orbHalo = new THREE.Mesh(new THREE.SphereGeometry(0.6, 20, 20), new THREE.MeshBasicMaterial({ color: 0xff2a1f, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
    orb.add(orbHalo);
    var orbLight = new THREE.PointLight(0xff3a2a, 1.6, 9); orb.add(orbLight);
    scene.add(orb);

    // Rising particles (capital flow)
    var P = mini ? 260 : 520;
    var pos = new Float32Array(P * 3), speed = new Float32Array(P);
    for (var p = 0; p < P; p++) {
      pos[p * 3] = (rand() - 0.5) * 34; pos[p * 3 + 1] = rand() * 18; pos[p * 3 + 2] = (rand() - 0.5) * 34;
      speed[p] = 0.6 + rand() * 1.6;
    }
    var pGeo = new THREE.BufferGeometry(); pGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    var particles = new THREE.Points(pGeo, new THREE.PointsMaterial({ color: 0xff4a3d, size: 0.07, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }));
    scene.add(particles);

    // Floating rings: like coins / targets hovering over the skyline
    var rings = [];
    for (var r = 0; r < (mini ? 2 : 4); r++) {
      var ring = new THREE.Mesh(new THREE.TorusGeometry(0.9 + r * 0.25, 0.05, 12, 64),
        new THREE.MeshStandardMaterial({ color: 0xff2a1f, emissive: 0x7a0500, emissiveIntensity: 0.8, metalness: 0.8, roughness: 0.25 }));
      ring.position.set(-6 + r * 4.5, 9 + r * 1.6, -3 + (r % 2) * 4);
      scene.add(ring); rings.push(ring);
    }

    // Sizing
    function resize() {
      var w = host.clientWidth, h = host.clientHeight;
      renderer.setSize(w, h, false);
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
      camera.aspect = w / h;
      camera.fov = w < 700 ? 58 : 42;
      camera.updateProjectionMatrix();
      if (!running) frame(reduce ? 99 : last);
    }

    // Mouse / touch parallax
    var mx = 0, my = 0, tx = 0, ty = 0;
    host.addEventListener('pointermove', function (e) {
      var b = host.getBoundingClientRect();
      tx = ((e.clientX - b.left) / b.width - 0.5) * 2;
      ty = ((e.clientY - b.top) / b.height - 0.5) * 2;
    });
    host.addEventListener('pointerleave', function () { tx = 0; ty = 0; });

    var last = 0;
    function frame(t) {
      last = t;
      // towers grow
      for (var i = 0; i < towers.length; i++) {
        var o = towers[i], g = ease(clamp((t - o.delay) / 1.6));
        o.m.scale.y = Math.max(0.001, o.h * g);
      }
      // line draws itself
      var lp = ease(clamp((t - 1.0) / 2.6));
      tubeGeo.setDrawRange(0, Math.floor(tubeCount * lp / 3) * 3);
      haloGeo.setDrawRange(0, Math.floor(haloCount * lp / 3) * 3);
      // pulse
      var u = lp < 1 ? lp : (0.0 + ((t - 3.6) * 0.09) % 1);
      orb.position.copy(curve.getPointAt(clamp(u)));
      orb.visible = lp > 0.02;
      orbHalo.scale.setScalar(1 + Math.sin(t * 4) * 0.18);
      // particles rise
      var a = pGeo.attributes.position.array;
      for (var p = 0; p < P; p++) {
        a[p * 3 + 1] += speed[p] * 0.016;
        if (a[p * 3 + 1] > 18) a[p * 3 + 1] = 0;
      }
      pGeo.attributes.position.needsUpdate = true;
      // rings spin and bob
      for (var r = 0; r < rings.length; r++) {
        rings[r].rotation.y = t * (0.6 + r * 0.15);
        rings[r].rotation.x = Math.sin(t * 0.5 + r) * 0.5;
        rings[r].position.y += Math.sin(t * 1.2 + r * 2) * 0.004;
      }
      glow.intensity = 2.1 + Math.sin(t * 1.7) * 0.4;
      // camera orbit + parallax
      mx += (tx - mx) * 0.05; my += (ty - my) * 0.05;
      var R = mini ? 25 : 23;
      var ang = 0.65 + t * 0.045 + mx * 0.25;
      camera.position.set(Math.sin(ang) * R, (mini ? 11 : 8.5) - my * 2.2, Math.cos(ang) * R);
      camera.lookAt(0, mini ? 3.2 : 4.2, 0);
      renderer.render(scene, camera);
    }

    var running = false, start = null, rafId = 0;
    function loop(now) {
      if (start === null) start = now - last * 1000;   // resume where we paused
      frame((now - start) / 1000);
      if (running) rafId = requestAnimationFrame(loop);
    }
    function play() { if (running || reduce) return; running = true; start = null; rafId = requestAnimationFrame(loop); }
    function pause() { running = false; cancelAnimationFrame(rafId); }

    if ('ResizeObserver' in window) new ResizeObserver(resize).observe(host); else window.addEventListener('resize', resize);
    resize();
    if (reduce) { frame(99); return; }
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) { es[0].isIntersecting ? play() : pause(); }, { threshold: 0.01 }).observe(host);
    } else play();
    document.addEventListener('visibilitychange', function () { document.hidden ? pause() : play(); });
  }
})();
