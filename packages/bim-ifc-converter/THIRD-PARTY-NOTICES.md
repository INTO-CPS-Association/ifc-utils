# Third Party Notices

This package redistributes third party code in binary form. The notices below
are required by the licences of that code and are shipped inside the published
tarball, so a recipient has them without going back to the repository.

## web-ifc

- Version: 0.0.77
- Licence: Mozilla Public License 2.0 (MPL-2.0)
- Source: <https://github.com/ThatOpen/engine_web-ifc>
- Licence text: <https://github.com/ThatOpen/engine_web-ifc/blob/main/LICENSE>

`dist/generated/wasm.js` contains `web-ifc.wasm` from that release, unmodified,
encoded as base64. It is inlined so that a consumer installs one package and
serves no extra file, which is what lets the conversion run in the browser of
whoever is looking at the model.

MPL-2.0 is a file level licence. It covers `web-ifc.wasm` and the files it was
built from, and it does not extend to this package's own source, which stays
under the licence in `LICENSE.md`. Section 3.2 requires that the Source Code
Form be available to anyone who receives the Executable Form: it is, at the
address above, and this package makes no modification to it.

No other third party code is redistributed here. `three` is a peer dependency,
so it is installed by the consumer and is not part of this tarball.
