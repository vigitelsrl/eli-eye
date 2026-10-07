# Eli-Eye

A camera app for Linux with live effects, face filters and backdrops, in the
spirit of the classic Photo Booth.

- **Live preview** with still, 4-up and movie modes
- **3-2-1 countdown** with screen flash and shutter sound
- **Five pages of effects** in a live 3×3 grid:
  - Color: Sepia, Black & White, Glow, Comic Book, Colored Pencil, Thermal Camera, X-Ray, Pop Art
  - Distortion: Bulge, Dent, Twirl, Squeeze, Mirror, Light Tunnel, Fish Eye, Stretch
  - Face-tracked: Bug Out, Chipmunk, Lovestruck, Dizzy, Nose Twirl, Frog, Blockhead, Pinhead
  - Backdrops: Clouds, Color Dots, Sunset, Earth, Moon, Fish, Aurora, Rainbow
  - Your own backdrops: drag any image onto an empty slot
- **Library strip** with view, share, export, flip, delete and undo
- **Fully offline and private.** Everything runs on your machine. The app blocks
  all network access, including MediaPipe's built-in usage logging.

## Install and run

Requires Node.js 18 or newer, a webcam, and a GPU with WebGL2 (effects still
work without one, just slower).

    npm install        # installs dependencies and downloads the AI models (~20 MB)
    ./eli-eye.sh       # run
    ./install.sh       # add Eli-Eye to your desktop's app launcher

Photos and movies are saved to `~/Pictures/Eli-Eye Library/Pictures`.

### Hyprland

On a tiling window manager, add a rule so Eli-Eye floats at its intended size:

```lua
o.window("^eli-eye$", { float = true, center = true, size = { 860, 662 } })
```

## Keyboard shortcuts

| Action | Shortcut |
| --- | --- |
| Take photo / start-stop recording | Enter or Ctrl+T |
| Skip the countdown / skip the flash | Alt / Shift with Enter or a click on the shutter |
| Show / hide the effects grid | Esc |
| Pick an effect on the current page (5 = Normal) | 1–9 |
| Effects pages | ← → (Ctrl+← → from anywhere) |
| Export / Copy / Flip photo | Ctrl+E / Ctrl+C / Ctrl+F |
| Delete / Undo delete | Delete / Ctrl+Z |
| Full screen | F11 or the green button |
| Menus (Eli-Eye, File, Edit, View, Camera) | Right-click |

## How it works

Electron app with plain HTML/CSS/JavaScript. Effects are WebGL2 shaders. Person
segmentation (MediaPipe Selfie Multiclass) runs in a Web Worker and is refined
on the GPU with a camera-guided filter for clean edges. Face effects use
MediaPipe Face Landmarker.

## License

Copyright (C) 2026 Vigitel SRL

Eli-Eye is free software: you can redistribute it and/or modify it under the
terms of the GNU General Public License as published by the Free Software
Foundation, either version 3 of the License, or (at your option) any later
version. See [`LICENSE`](LICENSE).

Third-party components are listed in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

Eli-Eye is an independent project and is not affiliated with or endorsed by Apple.
