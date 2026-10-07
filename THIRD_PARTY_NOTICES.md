# Third-party notices

Eli-Eye is licensed under the GNU General Public License v3.0 or later (see
`LICENSE`). It uses the following third-party software, each under its own
license, which is compatible with the GPL.

| Component | Used for | License |
| --- | --- | --- |
| [Electron](https://www.electronjs.org/) | Desktop app runtime | MIT |
| [MediaPipe Tasks Vision](https://github.com/google-ai-edge/mediapipe) (`@mediapipe/tasks-vision`) | Running the segmentation and face models | Apache License 2.0 |
| MediaPipe models: Selfie Segmenter, Selfie Multiclass Segmenter, Face Landmarker | Backdrops and face effects | Apache License 2.0 |
| [Inter](https://rsms.me/inter/) (via `@fontsource/inter`) | Interface font | SIL Open Font License 1.1 |

The models are not stored in this repository. `npm install` downloads them from
Google's official MediaPipe model storage.

Full license texts are included with each package under `node_modules/`.
