# Third-party notices

Kin’s original source is licensed under the MIT License (see `LICENSE`). The
following components keep their own terms.

## SmartSpectra SDK

- **Package:** `@smartspectra/node-sdk` 3.5.0
- **Copyright:** © Presage Technologies, Inc.
- **License:** Proprietary; see [`third_party/smartspectra/LICENSE`](third_party/smartspectra/LICENSE).
- **Notices:** [`third_party/smartspectra/NOTICE`](third_party/smartspectra/NOTICE),
  [`third_party/smartspectra/THIRD_PARTY_NOTICES.txt`](third_party/smartspectra/THIRD_PARTY_NOTICES.txt),
  and [`third_party/smartspectra/THIRD_PARTY_FFMPEG.md`](third_party/smartspectra/THIRD_PARTY_FFMPEG.md).
- **Use:** Kin uses the SDK under the terms of the Presage SmartSpectra SDK
  Challenge. The SDK is not MIT-licensed and is not relicensed by this
  repository.

The SDK’s native runtime is loaded in the Electron main process. It includes
FFmpeg and other third-party libraries; Presage’s notice file above contains
the complete list.

## Fonts

- **Fraunces** — © Undercase Type, designed by Phaedra Charles and Flavia
  Zimbru. Licensed under the SIL Open Font License 1.1. See
  `assets/fonts/OFL-Fraunces.txt`.
- **Inter** — © Rasmus Andersson. Licensed under the SIL Open Font License 1.1.
  See `assets/fonts/OFL-Inter.txt`.

## Microsoft Visual C++ runtime

The files in `vendor/vc-runtime/` were extracted from Microsoft’s official
`vc_redist.x64.exe` version 14.42.34430. They are redistributed under the
Microsoft Visual Studio license terms that accompany the redistributable.
See `vendor/vc-runtime/README.md` for provenance and the exact file list.

These DLLs exist because the SmartSpectra native runtime links against the
desktop VC++ runtime, which is not part of a default Windows install. They are
copied beside `smartspectra_capi.dll` by `scripts/prepare-native.cjs`.

## Build and runtime dependencies

These are installed from npm and are not vendored in this repository:

| Package | License | Link |
| --- | --- | --- |
| Electron | MIT | <https://github.com/electron/electron> |
| esbuild | MIT | <https://github.com/evanw/esbuild> |
| electron-builder | MIT | <https://github.com/electron-userland/electron-builder> |
| koffi | MIT | <https://github.com/Koromix/koffi> |
| protobufjs | BSD-3-Clause | <https://github.com/protobufjs/protobuf.js> |

Their full license texts are included in their npm packages under
`node_modules/` after `npm install`.

## Demo recording

The demo video is captured with a portable FFmpeg build. FFmpeg is a build
tool for the video, not a dependency of the Kin application, and is not
redistributed in this repository or in the Kin installers.
