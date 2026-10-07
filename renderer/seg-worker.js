// Person segmentation off the UI thread, so the preview keeps its full frame rate.
import { FilesetResolver, ImageSegmenter } from 'app://bundle/node_modules/@mediapipe/tasks-vision/vision_bundle.mjs';

const BASE = 'app://bundle/node_modules/@mediapipe/tasks-vision';
const MODELS = 'app://bundle/models';

let segmenter = null;
let delegate = 'GPU';

async function init(model) {
  // useModule: the worker is an ES module, so load the module build of the runtime.
  const fileset = await FilesetResolver.forVisionTasks(`${BASE}/wasm`, true);
  const options = (delegate) => ({
    baseOptions: { modelAssetPath: `${MODELS}/${model}`, delegate },
    runningMode: 'VIDEO',
    outputCategoryMask: false,
    outputConfidenceMasks: true,
  });
  try {
    segmenter = await ImageSegmenter.createFromOptions(fileset, options('GPU'));
  } catch (err) {
    console.warn('segmenter: GPU delegate failed, using CPU', err);
    delegate = 'CPU';
    segmenter = await ImageSegmenter.createFromOptions(fileset, options('CPU'));
  }
}

self.onmessage = async ({ data }) => {
  if (data.type === 'init') {
    try {
      await init(data.model);
      self.postMessage({ type: 'ready', delegate });
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err?.message || err) });
    }
    return;
  }

  if (data.type === 'frame') {
    const { bitmap, ts } = data;
    let out = null;
    const t0 = performance.now();
    try {
      segmenter.segmentForVideo(bitmap, ts, (res) => {
        const masks = res.confidenceMasks;
        if (!masks?.length) return;
        // Multiclass models put background in channel 0: person = 1 - background.
        const inverted = masks.length > 1;
        const m = masks[0];
        const f = m.getAsFloat32Array();
        const person = new Float32Array(f.length);
        for (let i = 0; i < f.length; i++) person[i] = inverted ? 1 - f[i] : f[i];
        out = { w: m.width, h: m.height, data: person };
      });
    } catch (err) {
      console.error(err);
    } finally {
      bitmap.close();
    }
    if (out) out.ms = performance.now() - t0;
    if (out) self.postMessage({ type: 'mask', ...out }, [out.data.buffer]);
    else self.postMessage({ type: 'mask', data: null });
  }
};
