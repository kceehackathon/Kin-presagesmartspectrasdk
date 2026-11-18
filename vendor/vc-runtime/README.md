# Microsoft Visual C++ runtime (x64)

These DLLs are the Microsoft Visual C++ 2015–2022 Redistributable runtime
files that the SmartSpectra native library links against:

- `msvcp140.dll`
- `msvcp140_atomic_wait.dll`
- `msvcp140_codecvt_ids.dll`
- `vcruntime140.dll`
- `vcruntime140_1.dll`
- `vcruntime140_threads.dll`
- `concrt140.dll`

They were extracted from Microsoft's official
[`vc_redist.x64.exe`](https://aka.ms/vs/17/release/vc_redist.x64.exe), version
14.42.34430, using the payload CABs embedded in that bootstrapper. No files
were modified.

Windows 11 does not include the desktop VC++ runtime by default. The
`scripts/prepare-native.cjs` postinstall step copies these DLLs next to
`smartspectra_capi.dll` so the SDK loads without a system-wide install. They
are redistributable Microsoft runtime files; see the Microsoft Visual Studio
license terms for redistribution terms. If you prefer not to ship them,
install the official redistributable instead and delete this folder.

Source: <https://aka.ms/vs/17/release/vc_redist.x64.exe>
