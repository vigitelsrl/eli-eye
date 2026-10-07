// MediaPipe person segmentation (backdrops, in a worker) and face landmarks
// (face effects), loaded lazily the first time an effect needs them.

const BASE = 'app://bundle/node_modules/@mediapipe/tasks-vision';
const MODELS = 'app://bundle/models';

let modulePromise;
const loadModule = () => (modulePromise ??= import(`${BASE}/vision_bundle.mjs`));

const KEYS = ['eyeL', 'eyeR', 'nose', 'mouth', 'cheekL', 'cheekR', 'faceC', 'headTop', 'faceL', 'faceR'];

const avg = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

export class Vision {
  constructor() {
    this.worker = null;
    this.segReady = false;
    this.segBusy = false;
    this.landmarker = null;
    this.pending = {};
    this.failed = {};
    this.lastTs = -1;

    // The multiclass model separates hair/face/body/clothes and gives much
    // cleaner outlines than the small selfie model.
    this.segModel = 'selfie_multiclass_256x256.tflite';

    this.mask = null; // Uint8Array, low resolution (the model's native detail)
    this.maskW = 0;
    this.maskH = 0;
    this.maskVersion = 0;
    this.prevMask = null;

    this.face = null;
    this.missed = 0;
  }

  async fileset() {
    const m = await loadModule();
    this._fileset ??= await m.FilesetResolver.forVisionTasks(`${BASE}/wasm`);
    return this._fileset;
  }

  async create(kind, factory, options) {
    const fileset = await this.fileset();
    try {
      return await factory.createFromOptions(fileset, { ...options, baseOptions: { ...options.baseOptions, delegate: 'GPU' } });
    } catch (err) {
      console.warn(`${kind}: GPU delegate failed, using CPU`, err);
      return factory.createFromOptions(fileset, { ...options, baseOptions: { ...options.baseOptions, delegate: 'CPU' } });
    }
  }

  // Segmentation runs in a worker; the newest mask is used whenever it arrives.
  ensureSegmenter() {
    if (this.worker || this.failed.seg) return;
    this.worker = new Worker(new URL('./seg-worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = ({ data }) => {
      if (data.type === 'ready') {
        this.segReady = true;
        this.segDelegate = data.delegate;
      }
      else if (data.type === 'error') {
        this.failed.seg = true;
        console.error('Segmentation unavailable', data.message);
      } else if (data.type === 'mask') {
        this.segBusy = false;
        if (data.data) this.takeMask(data.data, data.w, data.h);
        this.segMs = data.ms;
        // Keep the model busy: start on the current camera frame right away.
        if (this.wantMask && this.video) this.sendFrame(this.video, this.nextTs());
      }
    };
    this.worker.onerror = (err) => {
      this.failed.seg = true;
      console.error('Segmentation worker failed', err.message);
    };
    this.worker.postMessage({ type: 'init', model: this.segModel });
  }

  sendFrame(video, ts) {
    // The model only sees ~256px anyway; a small frame keeps its output at
    // native resolution and makes the transfer cheap.
    const h = 144;
    const w = Math.round((h * video.videoWidth) / video.videoHeight);
    this.segBusy = true;
    createImageBitmap(video, { resizeWidth: w, resizeHeight: h, resizeQuality: 'medium' })
      .then((bitmap) => this.worker.postMessage({ type: 'frame', bitmap, ts }, [bitmap]))
      .catch((err) => {
        this.segBusy = false;
        console.error(err);
      });
  }

  ensureLandmarker() {
    if (this.landmarker || this.pending.face || this.failed.face) return;
    this.pending.face = loadModule()
      .then((m) => this.create('landmarker', m.FaceLandmarker, {
        baseOptions: { modelAssetPath: `${MODELS}/face_landmarker.task` },
        runningMode: 'VIDEO',
        numFaces: 1,
      }))
      .then((l) => { this.landmarker = l; })
      .catch((err) => { this.failed.face = true; console.error('Face tracking unavailable', err); });
  }

  get hasMask() {
    return !!this.mask;
  }

  nextTs() {
    let ts = performance.now();
    if (ts <= this.lastTs) ts = this.lastTs + 0.01;
    this.lastTs = ts;
    return ts;
  }

  process(video, need) {
    const ts = this.nextTs();
    this.video = video;
    this.wantMask = need.mask;

    if (need.mask) {
      this.ensureSegmenter();
      if (this.segReady && !this.segBusy) this.sendFrame(video, ts);
    }
    if (need.face) {
      this.ensureLandmarker();
      if (this.landmarker) {
        try {
          this.takeFace(this.landmarker.detectForVideo(video, ts));
        } catch (err) {
          console.error(err);
        }
      }
    } else {
      this.face = null;
    }
  }

  // f: person confidence (W×H floats) from the worker.
  takeMask(f, W, H) {
    // Should already be ~256px wide; box-average down if a larger mask comes back.
    // The GPU refinement pass rebuilds a smooth, image-aligned full-size edge.
    const step = Math.max(1, Math.round(W / 256));
    const w = Math.floor(W / step), h = Math.floor(H / step);
    const n = w * h;
    if (!this.mask || this.mask.length !== n) {
      this.mask = new Uint8Array(n);
      this.prevMask = null;
    }
    const cur = new Float32Array(n);
    const inv = 1 / (step * step);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0;
        for (let dy = 0; dy < step; dy++) {
          const row = (y * step + dy) * W + x * step;
          for (let dx = 0; dx < step; dx++) sum += f[row + dx];
        }
        const v = sum * inv;
        cur[y * w + x] = v;
      }
    }

    const prev = this.prevMask;
    const out = this.mask;
    for (let i = 0; i < n; i++) {
      // Smooth flicker, but follow real movement immediately to avoid ghosting.
      const c = cur[i];
      const v = prev && Math.abs(c - prev[i]) < 0.25 ? prev[i] * 0.3 + c * 0.7 : c;
      cur[i] = v;
      out[i] = v * 255;
    }
    this.prevMask = cur;
    this.maskW = w;
    this.maskH = h;
    this.maskVersion++;
  }

  takeFace(res) {
    const lm = res.faceLandmarks?.[0];
    if (!lm) {
      if (++this.missed > 8) this.face = null;
      return;
    }
    this.missed = 0;
    const P = (i) => [lm[i].x, lm[i].y];
    const iris = lm.length > 473;
    const headTop = P(10), chin = P(152);
    const next = {
      eyeL: iris ? P(468) : avg(P(33), P(133)),
      eyeR: iris ? P(473) : avg(P(362), P(263)),
      nose: P(1),
      mouth: avg(P(13), P(14)),
      cheekL: P(205),
      cheekR: P(425),
      faceC: avg(headTop, chin),
      headTop,
      faceL: P(234),
      faceR: P(454),
    };
    if (!this.face) {
      this.face = next;
      return;
    }
    const a = 0.55;
    for (const k of KEYS) {
      const p = this.face[k], q = next[k];
      p[0] += (q[0] - p[0]) * a;
      p[1] += (q[1] - p[1]) * a;
    }
  }
}
