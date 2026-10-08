/* ==========================================================================
   shaders.js — Donanım Gücüne Duyarlı WebGL GLSL Shader Motoru
   - Tier Matrisi (Low: Kapalı (0 CPU/GPU) | Mid: 0.5x DPR | Ultra: 1.0x-2.0x DPR)
   - 1. Hacimsel Gaz Vorteks Shader'ı (2D Simplex Noise & Renk Değişimi)
   - 2. Dinamik Sıvı & Yağmur Dalgası Shader'ı (Konsantrik Kırılma Dalgaları)
   - 3. Acil Durum Glitch Pass (Kromatik Sapma & Namlu Distorsiyonu)
   - WebGL Context & rAF Yaşam Döngüsü Yönetimi
   ========================================================================== */

(function () {
  'use strict';

  window.App = window.App || {};

  let isInitialized = false;
  let rafId = null;
  let isPaused = false;
  let startTime = performance.now();

  // State / Uniform Lerp Hedefleri
  const shaderState = {
    ppm: 0.0,
    targetPpm: 0.0,
    danger: 0.0,
    targetDanger: 0.0,
    wet: 0.0,
    targetWet: 0.0,
    emergencyGlitch: 0.0,
    targetEmergencyGlitch: 0.0
  };

  // Pipeline nesneleri
  let gasRenderer = null;
  let rainRenderer = null;
  let glitchRenderer = null;

  /* ----------------------------------------------------------- Vertex Shader */
  const VS_SOURCE = `
    attribute vec2 a_position;
    varying vec2 v_uv;
    void main() {
      v_uv = (a_position + 1.0) * 0.5;
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

  /* ------------------------------------------- 1. Gaz Vorteks Fragment Shader */
  const FS_GAS_SOURCE = `
    precision mediump float;
    varying vec2 v_uv;
    uniform float u_time;
    uniform float u_ppm;
    uniform float u_danger;
    uniform vec2 u_resolution;
    uniform float u_tier;

    // 2D Simplex/Perlin tipi pürüzsüz gürültü fonksiyonu
    vec2 hash2(vec2 p) {
      p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
      return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
    }

    float noise(vec2 p) {
      const float K1 = 0.366025404; // (sqrt(3)-1)/2
      const float K2 = 0.211324865; // (3-sqrt(3))/6
      vec2 i = floor(p + (p.x + p.y) * K1);
      vec2 a = p - i + (i.x + i.y) * K2;
      vec2 o = (a.x > a.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
      vec2 b = a - o + K2;
      vec2 c = a - 1.0 + 2.0 * K2;
      vec3 h = max(0.5 - vec3(dot(a, a), dot(b, b), dot(c, c)), 0.0);
      vec3 n = h * h * h * h * vec3(dot(a, hash2(i)), dot(b, hash2(i + o)), dot(c, hash2(i + 1.0)));
      return dot(n, vec3(70.0));
    }

    void main() {
      vec2 uv = (gl_FragCoord.xy * 2.0 - u_resolution.xy) / min(u_resolution.x, u_resolution.y);
      float dist = length(uv);

      // Gaz arttıkça girdap hızı ve dalgalanma frekansı artar
      float speed = 0.6 + u_ppm * 2.5 + u_danger * 1.5;
      float t = u_time * speed;

      // Vorteks dönüşü
      float angle = atan(uv.y, uv.x) + (1.2 / (dist + 0.35)) * (0.8 + u_ppm * 1.2);
      vec2 vortexUv = vec2(cos(angle), sin(angle)) * dist;

      // Katmanlı gürültü
      float n1 = noise(vortexUv * 2.2 - vec2(t * 0.3, t * 0.2));
      float n2 = 0.0;
      if (u_tier > 0.5) {
        n2 = noise(vortexUv * 4.5 + vec2(t * 0.4, -t * 0.5)) * 0.5;
      }
      float n = clamp(n1 + n2, -1.0, 1.0) * 0.5 + 0.5;

      // Renk geçişi: Turkuaz -> Kehribar Sarısı -> Kor Kırmızı
      vec3 colorCyan   = vec3(0.0, 0.88, 1.0);
      vec3 colorAmber  = vec3(0.98, 0.68, 0.12);
      vec3 colorRed    = vec3(0.96, 0.16, 0.16);

      vec3 baseCol;
      if (u_ppm < 0.5) {
        float f = u_ppm * 2.0;
        baseCol = mix(colorCyan, colorAmber, f);
      } else {
        float f = (u_ppm - 0.5) * 2.0;
        baseCol = mix(colorAmber, colorRed, f);
      }
      baseCol = mix(baseCol, colorRed, u_danger);

      // Duman yoğunluğu ve radyal solma
      float density = smoothstep(1.3, 0.1, dist) * (0.35 + u_ppm * 0.65);
      float alpha = clamp(n * density * (0.4 + u_ppm * 0.5), 0.0, 0.85);

      // Parlak kor çekirdek
      vec3 finalCol = baseCol * (0.7 + n * 0.6) + vec3(1.0, 0.9, 0.8) * pow(n, 4.0) * (0.2 + u_ppm * 0.6);
      gl_FragColor = vec4(finalCol, alpha);
    }
  `;

  /* ------------------------------------- 2. Sıvı & Yağmur Dalgası Fragment Shader */
  const FS_RAIN_SOURCE = `
    precision mediump float;
    varying vec2 v_uv;
    uniform float u_time;
    uniform float u_wet;
    uniform vec2 u_resolution;

    void main() {
      vec2 uv = gl_FragCoord.xy / u_resolution.xy;
      vec2 c1 = vec2(0.35, 0.45);
      vec2 c2 = vec2(0.68, 0.60);
      vec2 c3 = vec2(0.50, 0.25);

      float t = u_time * 2.2;
      float d1 = length(uv - c1);
      float d2 = length(uv - c2);
      float d3 = length(uv - c3);

      // Konsantrik dalgalar (concentric ripples)
      float wave1 = sin(d1 * 40.0 - t * 3.5) * exp(-d1 * 3.5);
      float wave2 = sin(d2 * 32.0 - t * 4.0) * exp(-d2 * 4.0);
      float wave3 = sin(d3 * 48.0 - t * 3.0) * exp(-d3 * 3.8);

      float totalWave = (wave1 + wave2 + wave3) * u_wet;

      // Kırılma ve parlaklık
      vec3 waterColor = vec3(0.08, 0.45, 0.85);
      vec3 foamColor = vec3(0.65, 0.90, 1.0);
      vec3 finalColor = mix(waterColor, foamColor, clamp(totalWave * 1.5, 0.0, 1.0));

      float alpha = clamp(abs(totalWave) * 1.8 * u_wet, 0.0, 0.7);
      gl_FragColor = vec4(finalColor, alpha);
    }
  `;

  /* --------------------------------- 3. Acil Durum Glitch Pass Fragment Shader */
  const FS_GLITCH_SOURCE = `
    precision mediump float;
    varying vec2 v_uv;
    uniform float u_time;
    uniform float u_active;
    uniform vec2 u_resolution;

    void main() {
      if (u_active < 0.01) {
        gl_FragColor = vec4(0.0);
        return;
      }

      vec2 uv = v_uv;
      // Hafif Namlu Distorsiyonu (Barrel Distortion)
      vec2 centered = uv - 0.5;
      float r2 = dot(centered, centered);
      uv = 0.5 + centered * (1.0 + 0.15 * r2 * u_active);

      // Kromatik Sapma & RGB Glitch ayrımı
      float glitchOffset = (0.012 * sin(u_time * 18.0) + 0.006 * cos(uv.y * 30.0)) * u_active;

      // Siber tarama çizgileri (scanlines)
      float scanline = sin(gl_FragCoord.y * 1.4) * 0.5 + 0.5;

      vec3 tint = vec3(1.0, 0.08, 0.08); // Kırmızı alarm tonu
      float vignette = smoothstep(0.4, 0.9, length(centered));

      float alpha = (vignette * 0.35 + scanline * 0.08 + abs(glitchOffset) * 4.0) * u_active;
      gl_FragColor = vec4(tint, clamp(alpha, 0.0, 0.55));
    }
  `;

  /* -------------------------------------------------------- WebGL Yardımcıları */

  function createGLContext(canvas, options) {
    const opts = Object.assign({
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: 'low-power'
    }, options);

    canvas.addEventListener('webglcontextlost', function (e) {
      e.preventDefault();
      stopLoop();
      console.warn('[shaders] WebGL context lost.');
    }, false);

    canvas.addEventListener('webglcontextrestored', function () {
      console.info('[shaders] WebGL context restored, recreating pipeline.');
      init();
    }, false);

    return canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
  }

  function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn('[shaders] GLSL Derleme Hatası:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  function createProgram(gl, vsSource, fsSource) {
    const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
    if (!vs || !fs) return null;

    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);

    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn('[shaders] Program Bağlama Hatası:', gl.getProgramInfoLog(prog));
      gl.deleteProgram(prog);
      return null;
    }

    return { program: prog, vs: vs, fs: fs };
  }

  function createQuadBuffer(gl) {
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    const quad = new Float32Array([
      -1.0, -1.0,
       1.0, -1.0,
      -1.0,  1.0,
      -1.0,  1.0,
       1.0, -1.0,
       1.0,  1.0
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    return buf;
  }

  /* ---------------------------------------------------- Tekil Render Modülleri */

  function initGasShader(canvas) {
    if (!canvas) return null;
    const gl = createGLContext(canvas);
    if (!gl) return null;

    const progObj = createProgram(gl, VS_SOURCE, FS_GAS_SOURCE);
    if (!progObj) return null;

    const prog = progObj.program;
    const quadBuf = createQuadBuffer(gl);

    const posLoc = gl.getAttribLocation(prog, 'a_position');
    const uTime = gl.getUniformLocation(prog, 'u_time');
    const uPpm = gl.getUniformLocation(prog, 'u_ppm');
    const uDanger = gl.getUniformLocation(prog, 'u_danger');
    const uRes = gl.getUniformLocation(prog, 'u_resolution');
    const uTier = gl.getUniformLocation(prog, 'u_tier');

    return {
      canvas: canvas,
      gl: gl,
      progObj: progObj,
      quadBuf: quadBuf,
      render: function (elapsed, dprScale) {
        if (gl.isContextLost()) return;
        const width = canvas.clientWidth || 300;
        const height = canvas.clientHeight || 200;
        const cw = Math.max(1, Math.round(width * dprScale));
        const ch = Math.max(1, Math.round(height * dprScale));

        if (canvas.width !== cw || canvas.height !== ch) {
          canvas.width = cw;
          canvas.height = ch;
        }

        gl.viewport(0, 0, cw, ch);
        gl.useProgram(prog);

        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

        gl.uniform1f(uTime, elapsed * 0.001);
        gl.uniform1f(uPpm, shaderState.ppm);
        gl.uniform1f(uDanger, shaderState.danger);
        gl.uniform2f(uRes, cw, ch);
        gl.uniform1f(uTier, (window.App.Tier && window.App.Tier.isUltra()) ? 1.0 : 0.0);

        gl.drawArrays(gl.TRIANGLES, 0, 6);
      },
      destroy: function () {
        try {
          if (quadBuf) gl.deleteBuffer(quadBuf);
          if (progObj) {
            gl.deleteShader(progObj.vs);
            gl.deleteShader(progObj.fs);
            gl.deleteProgram(progObj.program);
          }
          const lose = gl.getExtension('WEBGL_lose_context');
          if (lose) lose.loseContext();
        } catch (e) {}
      }
    };
  }

  function initRainShader(canvas) {
    if (!canvas) return null;
    const gl = createGLContext(canvas);
    if (!gl) return null;

    const progObj = createProgram(gl, VS_SOURCE, FS_RAIN_SOURCE);
    if (!progObj) return null;

    const prog = progObj.program;
    const quadBuf = createQuadBuffer(gl);

    const posLoc = gl.getAttribLocation(prog, 'a_position');
    const uTime = gl.getUniformLocation(prog, 'u_time');
    const uWet = gl.getUniformLocation(prog, 'u_wet');
    const uRes = gl.getUniformLocation(prog, 'u_resolution');

    return {
      canvas: canvas,
      gl: gl,
      progObj: progObj,
      quadBuf: quadBuf,
      render: function (elapsed, dprScale) {
        if (gl.isContextLost()) return;
        // Eğer ıslak değilse gereksiz çizim yapma
        if (shaderState.wet < 0.01) {
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT);
          return;
        }

        const width = canvas.clientWidth || 300;
        const height = canvas.clientHeight || 200;
        const cw = Math.max(1, Math.round(width * dprScale));
        const ch = Math.max(1, Math.round(height * dprScale));

        if (canvas.width !== cw || canvas.height !== ch) {
          canvas.width = cw;
          canvas.height = ch;
        }

        gl.viewport(0, 0, cw, ch);
        gl.useProgram(prog);

        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

        gl.uniform1f(uTime, elapsed * 0.001);
        gl.uniform1f(uWet, shaderState.wet);
        gl.uniform2f(uRes, cw, ch);

        gl.drawArrays(gl.TRIANGLES, 0, 6);
      },
      destroy: function () {
        try {
          if (quadBuf) gl.deleteBuffer(quadBuf);
          if (progObj) {
            gl.deleteShader(progObj.vs);
            gl.deleteShader(progObj.fs);
            gl.deleteProgram(progObj.program);
          }
          const lose = gl.getExtension('WEBGL_lose_context');
          if (lose) lose.loseContext();
        } catch (e) {}
      }
    };
  }

  function initGlitchShader(canvas) {
    if (!canvas) return null;
    const gl = createGLContext(canvas);
    if (!gl) return null;

    const progObj = createProgram(gl, VS_SOURCE, FS_GLITCH_SOURCE);
    if (!progObj) return null;

    const prog = progObj.program;
    const quadBuf = createQuadBuffer(gl);

    const posLoc = gl.getAttribLocation(prog, 'a_position');
    const uTime = gl.getUniformLocation(prog, 'u_time');
    const uActive = gl.getUniformLocation(prog, 'u_active');
    const uRes = gl.getUniformLocation(prog, 'u_resolution');

    return {
      canvas: canvas,
      gl: gl,
      progObj: progObj,
      quadBuf: quadBuf,
      render: function (elapsed, dprScale) {
        if (gl.isContextLost()) return;
        if (shaderState.emergencyGlitch < 0.01) {
          canvas.style.opacity = '0';
          return;
        }
        canvas.style.opacity = '1';

        const cw = Math.max(1, Math.round(window.innerWidth * dprScale));
        const ch = Math.max(1, Math.round(window.innerHeight * dprScale));

        if (canvas.width !== cw || canvas.height !== ch) {
          canvas.width = cw;
          canvas.height = ch;
        }

        gl.viewport(0, 0, cw, ch);
        gl.useProgram(prog);

        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

        gl.uniform1f(uTime, elapsed * 0.001);
        gl.uniform1f(uActive, shaderState.emergencyGlitch);
        gl.uniform2f(uRes, cw, ch);

        gl.drawArrays(gl.TRIANGLES, 0, 6);
      },
      destroy: function () {
        try {
          if (quadBuf) gl.deleteBuffer(quadBuf);
          if (progObj) {
            gl.deleteShader(progObj.vs);
            gl.deleteShader(progObj.fs);
            gl.deleteProgram(progObj.program);
          }
          const lose = gl.getExtension('WEBGL_lose_context');
          if (lose) lose.loseContext();
        } catch (e) {}
      }
    };
  }

  /* ------------------------------------------------- DOM & Canvas Entegrasyonu */

  function ensureCanvas(containerId, canvasId, className) {
    const container = document.getElementById(containerId);
    if (!container) return null;

    let cv = document.getElementById(canvasId);
    if (!cv) {
      cv = document.createElement('canvas');
      cv.id = canvasId;
      cv.className = 'shader-canvas ' + (className || '');
      cv.setAttribute('aria-hidden', 'true');
      container.style.position = 'relative';
      container.prepend(cv);
    }
    return cv;
  }

  function ensureGlitchCanvas() {
    let cv = document.getElementById('emergencyGlitchCanvas');
    if (!cv) {
      cv = document.createElement('canvas');
      cv.id = 'emergencyGlitchCanvas';
      cv.className = 'shader-canvas emergency-glitch-canvas';
      cv.setAttribute('aria-hidden', 'true');
      document.body.appendChild(cv);
    }
    return cv;
  }

  /* ---------------------------------------------------------- rAF Render Loop */

  function renderLoop(time) {
    if (isPaused) {
      rafId = null;
      return;
    }

    const elapsed = time - startTime;

    // Smooth Lerp geçişleri (60 FPS'te akıcı filtreleme)
    shaderState.ppm += (shaderState.targetPpm - shaderState.ppm) * 0.08;
    shaderState.danger += (shaderState.targetDanger - shaderState.danger) * 0.08;
    shaderState.wet += (shaderState.targetWet - shaderState.wet) * 0.08;
    shaderState.emergencyGlitch += (shaderState.targetEmergencyGlitch - shaderState.emergencyGlitch) * 0.1;

    const tier = (window.App.Tier && window.App.Tier.get()) || 'mid';
    const isUltra = tier === 'ultra';
    const dprScale = isUltra ? Math.min(window.devicePixelRatio || 1, 1.8) : 0.5;

    if (gasRenderer) gasRenderer.render(elapsed, dprScale);
    if (rainRenderer) rainRenderer.render(elapsed, dprScale);
    if (glitchRenderer) glitchRenderer.render(elapsed, isUltra ? 1.0 : 0.5);

    rafId = requestAnimationFrame(renderLoop);
  }

  function startLoop() {
    if (rafId) cancelAnimationFrame(rafId);
    isPaused = false;
    rafId = requestAnimationFrame(renderLoop);
  }

  function stopLoop() {
    isPaused = true;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  /* ------------------------------------------------------------- Yaşam Döngüsü */

  function init(tierOverride) {
    destroy();

    const tier = tierOverride || (window.App.Tier && window.App.Tier.get()) || 'mid';
    const reducedMotion = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Tier Low: KESİNLİKLE WebGL BAŞLATILMAZ (Sıfır GPU/CPU Yükü)
    if (tier === 'low' || reducedMotion) {
      console.info('[shaders] Donanım kademesi (low/reduced) nedeniyle WebGL motoru uyutuldu.');
      return;
    }

    const gasCv = ensureCanvas('gasCard', 'gasVortexCanvas', 'gas-shader-canvas');
    const rainCv = ensureCanvas('rainCard', 'rainWaveCanvas', 'rain-shader-canvas');
    const glitchCv = ensureGlitchCanvas();

    if (gasCv) gasRenderer = initGasShader(gasCv);
    if (rainCv) rainRenderer = initRainShader(rainCv);
    if (glitchCv) glitchRenderer = initGlitchShader(glitchCv);

    if (gasRenderer || rainRenderer || glitchRenderer) {
      isInitialized = true;
      startLoop();
      console.info('[shaders] WebGL Shaders devrede — Kademe:', tier);
    }
  }

  function destroy() {
    stopLoop();

    if (gasRenderer) { gasRenderer.destroy(); gasRenderer = null; }
    if (rainRenderer) { rainRenderer.destroy(); rainRenderer = null; }
    if (glitchRenderer) { glitchRenderer.destroy(); glitchRenderer = null; }

    ['gasVortexCanvas', 'rainWaveCanvas', 'emergencyGlitchCanvas'].forEach(function (id) {
      const el = document.getElementById(id);
      if (el) el.remove();
    });

    isInitialized = false;
  }

  function update(data) {
    if (!data) return;

    // Normalize PPM (0.0 .. 1.0)
    const ppm = Number(data.gasPpm) || 0;
    const dangerTh = (typeof data.gasDanger === 'number') ? data.gasDanger : 400;
    shaderState.targetPpm = Math.max(0, Math.min(1.0, ppm / Math.max(dangerTh * 1.25, 100)));

    // Tehlike durumu (0.0 - 1.0)
    const isDanger = (data.state === 'danger' || ppm >= dangerTh);
    shaderState.targetDanger = isDanger ? 1.0 : (data.state === 'warning' ? 0.45 : 0.0);

    // Islaklık durumu (0.0 - 1.0)
    shaderState.targetWet = data.rain ? 1.0 : 0.0;

    // Acil durum glitch geçişi
    shaderState.targetEmergencyGlitch = isDanger ? 1.0 : 0.0;
  }

  /* Sekme Görünürlük Koruması */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      stopLoop();
    } else {
      if (isInitialized && (!window.App.Tier || !window.App.Tier.isLow())) {
        startLoop();
      }
    }
  });

  /* Donanım Kademesi Değişimi */
  if (window.App.Tier && window.App.Tier.onChange) {
    window.App.Tier.onChange(function (newTier) {
      if (newTier === 'low') {
        destroy();
      } else if (!isInitialized) {
        init(newTier);
      }
    });
  }

  window.App.Shaders = {
    init: init,
    destroy: destroy,
    update: update,
    isAvailable: function () { return isInitialized; }
  };
})();
