import { VERT, REFINE_FRAG, fragmentFor } from './shaders.js';

const UNIFORMS = [
  'uCam', 'uMask', 'uBg', 'uRes', 'uTime', 'uMirror', 'uHasMask', 'uHasBg', 'uBgAspect',
  'uHasFace', 'uEyeL', 'uEyeR', 'uNose', 'uMouth', 'uCheekL', 'uCheekR', 'uFaceC', 'uHeadTop',
  'uFaceW', 'uFlipY',
];

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      preserveDrawingBuffer: true, antialias: false, alpha: false, premultipliedAlpha: false,
    });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.programs = new Map();
    this.vs = this.compile(gl.VERTEX_SHADER, VERT);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.camTex = this.makeTexture();
    this.maskTex = this.makeTexture();
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([255]));
    this.lowMaskTex = this.makeTexture();
    this.maskFbo = null;
    this.refineParams = { spread: 0.75, colorK: 60 };
    this.blackTex = this.makeTexture();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));

    this.width = canvas.width;
    this.height = canvas.height;
    this.hasMask = false;
    this.face = null;
    this.fbo = null;
  }

  compile(type, src) {
    const { gl } = this;
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error('Shader compile failed: ' + log);
    }
    return sh;
  }

  program(effect) {
    const key = effect.kind === 'user' ? 'user' : effect.id;
    let p = this.programs.get(key);
    if (p) return p;
    const { gl } = this;
    const prog = gl.createProgram();
    gl.attachShader(prog, this.vs);
    gl.attachShader(prog, this.compile(gl.FRAGMENT_SHADER, fragmentFor(effect)));
    gl.bindAttribLocation(prog, 0, 'aPos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(`Program link failed (${key}): ${gl.getProgramInfoLog(prog)}`);
    }
    const u = {};
    for (const name of UNIFORMS) u[name] = gl.getUniformLocation(prog, name);
    p = { prog, u };
    this.programs.set(key, p);
    return p;
  }

  makeTexture() {
    const { gl } = this;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  setSize(w, h) {
    this.canvas.width = this.width = w;
    this.canvas.height = this.height = h;
    if (this.fbo) {
      this.gl.deleteFramebuffer(this.fbo.fb);
      this.gl.deleteTexture(this.fbo.tex);
      this.fbo = null;
    }
  }

  uploadVideo(video) {
    const { gl } = this;
    gl.bindTexture(gl.TEXTURE_2D, this.camTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }

  // Low-resolution person-confidence mask, row 0 = top of the camera image.
  uploadMask(data, w, h) {
    const { gl } = this;
    gl.bindTexture(gl.TEXTURE_2D, this.lowMaskTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, data);
    this.lowSize = [w, h];
  }

  // Rebuilds the full mask from the low-res one, guided by the current camera frame.
  refineMask() {
    if (!this.lowSize) return;
    const { gl } = this;
    const W = Math.round(this.width / 2), H = Math.round(this.height / 2);
    if (!this.maskFbo || this.maskFbo.w !== W || this.maskFbo.h !== H) {
      if (this.maskFbo) gl.deleteFramebuffer(this.maskFbo.fb);
      gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, W, H, 0, gl.RED, gl.UNSIGNED_BYTE, null);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.maskTex, 0);
      this.maskFbo = { fb, w: W, h: H };
    }
    if (!this.refine) {
      const prog = gl.createProgram();
      gl.attachShader(prog, this.vs);
      gl.attachShader(prog, this.compile(gl.FRAGMENT_SHADER, REFINE_FRAG));
      gl.bindAttribLocation(prog, 0, 'aPos');
      gl.linkProgram(prog);
      const u = {};
      for (const n of ['uCam', 'uLow', 'uLowTexel', 'uSpread', 'uColorK', 'uFlipY']) u[n] = gl.getUniformLocation(prog, n);
      this.refine = { prog, u };
    }
    const { prog, u } = this.refine;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.maskFbo.fb);
    gl.viewport(0, 0, W, H);
    gl.useProgram(prog);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.camTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.lowMaskTex);
    gl.uniform1i(u.uCam, 0);
    gl.uniform1i(u.uLow, 1);
    gl.uniform2f(u.uLowTexel, 1 / this.lowSize[0], 1 / this.lowSize[1]);
    gl.uniform1f(u.uSpread, this.refineParams.spread);
    gl.uniform1f(u.uColorK, this.refineParams.colorK);
    gl.uniform1f(u.uFlipY, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  loadTexture(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const { gl } = this;
        const tex = this.makeTexture();
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        resolve({ tex, aspect: img.naturalWidth / img.naturalHeight });
      };
      img.onerror = () => reject(new Error('Could not load ' + url));
      img.src = url;
    });
  }

  deleteTexture(t) {
    if (t?.tex) this.gl.deleteTexture(t.tex);
  }

  draw(effect, x, y, w, h, opts) {
    const { gl } = this;
    const { prog, u } = this.program(effect);
    gl.useProgram(prog);
    gl.bindVertexArray(this.vao);
    gl.viewport(x, y, w, h);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.camTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, opts.bg?.tex || this.blackTex);
    gl.uniform1i(u.uCam, 0);
    gl.uniform1i(u.uMask, 1);
    gl.uniform1i(u.uBg, 2);

    const mirror = opts.mirror !== false;
    gl.uniform2f(u.uRes, w, h);
    gl.uniform1f(u.uTime, opts.time || 0);
    gl.uniform1f(u.uMirror, mirror ? 1 : 0);
    gl.uniform1f(u.uFlipY, opts.flipY ? 1 : 0);
    gl.uniform1f(u.uHasMask, this.hasMask ? 1 : 0);
    gl.uniform1f(u.uHasBg, opts.bg ? 1 : 0);
    gl.uniform1f(u.uBgAspect, opts.bg?.aspect || 1);

    const f = this.face;
    gl.uniform1f(u.uHasFace, f ? 1 : 0);
    if (f) {
      const map = (p) => [mirror ? 1 - p[0] : p[0], 1 - p[1]];
      gl.uniform2f(u.uEyeL, ...map(f.eyeL));
      gl.uniform2f(u.uEyeR, ...map(f.eyeR));
      gl.uniform2f(u.uNose, ...map(f.nose));
      gl.uniform2f(u.uMouth, ...map(f.mouth));
      gl.uniform2f(u.uCheekL, ...map(f.cheekL));
      gl.uniform2f(u.uCheekR, ...map(f.cheekR));
      gl.uniform2f(u.uFaceC, ...map(f.faceC));
      gl.uniform2f(u.uHeadTop, ...map(f.headTop));
      const aspect = this.width / this.height;
      const dx = (f.faceR[0] - f.faceL[0]) * aspect;
      const dy = f.faceR[1] - f.faceL[1];
      gl.uniform1f(u.uFaceW, Math.hypot(dx, dy));
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  render(effect, opts) {
    const { gl } = this;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.draw(effect, 0, 0, this.width, this.height, opts);
  }

  // cells: [{ effect, bg }] × 9, row-major from the top-left.
  renderGrid(cells, opts) {
    const { gl } = this;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const W = this.width, H = this.height;
    cells.forEach((cell, i) => {
      const col = i % 3, row = Math.floor(i / 3);
      const x0 = Math.round((col * W) / 3), x1 = Math.round(((col + 1) * W) / 3);
      const y0 = Math.round(((2 - row) * H) / 3), y1 = Math.round(((3 - row) * H) / 3);
      this.draw(cell.effect, x0, y0, x1 - x0, y1 - y0, { ...opts, bg: cell.bg });
    });
  }

  // Renders one frame offscreen at full camera resolution and returns a 2D canvas.
  capture(effect, opts) {
    const { gl } = this;
    const W = this.width, H = this.height;
    if (!this.fbo) {
      const tex = this.makeTexture();
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      this.fbo = { fb, tex };
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo.fb);
    this.draw(effect, 0, 0, W, H, { ...opts, flipY: true });
    const pixels = new Uint8ClampedArray(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const out = document.createElement('canvas');
    out.width = W;
    out.height = H;
    out.getContext('2d').putImageData(new ImageData(pixels, W, H), 0, 0);
    return out;
  }
}
