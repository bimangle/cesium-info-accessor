# cesium-info-accessor

A Cesium plugin for automatically loading and displaying component property data from BimAngle-exported 3D Tiles datasets.

## Installation

### NPM
bash
npm install @bimangle/cesium-info-accessor

### CDN

You can also include it directly in your HTML:
html
<!-- Make sure to include Cesium first -->
<script src="https://cesium.com/downloads/cesiumjs/releases/1.110/Build/Cesium/Cesium.js"></script>
<!-- Then include cesium-info-accessor -->
<script src="https://unpkg.com/@bimangle/cesium-info-accessor@1.0.1/dist/cesium-info-accessor.js"></script>


## Usage

### Browser
html
<!DOCTYPE html>
<html>
<head>
<script src="https://cesium.com/downloads/cesiumjs/releases/1.110/Build/Cesium/Cesium.js"></script>
<script src="https://unpkg.com/@bimangle/cesium-info-accessor@1.0.1/dist/cesium-info-accessor.js"></script>
</head>
<body>
<div id="cesiumContainer"></div>
<script>
const viewer = new Cesium.Viewer('cesiumContainer');
// Method 1: Use mixin to add infoAccessor to viewer
viewer.extend(InfoAccessorMixin);
viewer.infoAccessor.attach(tileset);
// Method 2: Use helper functions
attachTileset(viewer, tileset); // For component-level info
attachTilesetX(viewer, tileset, "Model Title", "Model Description"); // For model-level info
</script>
</body>
</html>
### NPM / ES Modules
javascript
import { InfoAccessorMixin } from '@bimangle/cesium-info-accessor';
import as Cesium from 'cesium';
const viewer = new Cesium.Viewer('cesiumContainer');
// Method 1: Use mixin
viewer.extend(InfoAccessorMixin);
viewer.infoAccessor.attach(tileset);
// Method 2: Use helper functions
attachTileset(viewer, tileset); // For component-level info
attachTilesetX(viewer, tileset, "Model Title", "Model Description"); // For model-level info

## Features

- Highlight and select 3D Tiles features
- Display feature properties in Cesium's info box
- Support both component-level and model-level information display
- Automatically load and display component properties from BimAngle-exported 3D Tiles
- Compatible with Cesium 1.110.0 and above


## License

MIT
