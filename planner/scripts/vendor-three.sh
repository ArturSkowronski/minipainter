#!/usr/bin/env bash
# Re-create ui/vendor/ from the pinned Three.js npm tarball. The result is committed: the app never
# loads code from a CDN at runtime.
set -euo pipefail
VERSION="0.170.0"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

(cd "$TMP" && npm pack --silent "three@$VERSION" >/dev/null && tar -xzf three-*.tgz)
SRC="$TMP/package"
DEST="$ROOT/ui/vendor"
rm -rf "$DEST"
mkdir -p "$DEST/addons/controls" "$DEST/addons/loaders" "$DEST/addons/utils"
cp "$SRC/build/three.module.js" "$DEST/"
if [ -f "$SRC/build/three.core.js" ]; then cp "$SRC/build/three.core.js" "$DEST/"; fi
cp "$SRC/examples/jsm/controls/OrbitControls.js" "$DEST/addons/controls/"
cp "$SRC/examples/jsm/loaders/GLTFLoader.js" "$DEST/addons/loaders/"
cp "$SRC/examples/jsm/utils/BufferGeometryUtils.js" "$DEST/addons/utils/"
cp "$SRC/LICENSE" "$DEST/LICENSE.three"
echo "$VERSION" > "$DEST/VERSION"
echo "vendored three@$VERSION into ui/vendor"
