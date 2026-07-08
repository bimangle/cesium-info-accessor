# cesium-info-accessor

A Cesium plugin for automatically loading and displaying component property data from BimAngle-exported 3D Tiles datasets.

## Installation

### NPM

```bash
npm install @bimangle/cesium-info-accessor
```

### CDN

```html
<!-- Cesium must be loaded first -->
<script src="https://cesium.com/downloads/cesiumjs/releases/1.120/Build/Cesium/Cesium.js"></script>

<!-- Then include cesium-info-accessor -->
<script src="https://unpkg.com/@bimangle/cesium-info-accessor/dist/cesium-info-accessor.js"></script>
```

---

## Quick Start

```html
<!DOCTYPE html>
<html>
<head>
  <script src="https://cesium.com/downloads/cesiumjs/releases/1.120/Build/Cesium/Cesium.js"></script>
  <link href="https://cesium.com/downloads/cesiumjs/releases/1.120/Build/Cesium/Widgets/widgets.css" rel="stylesheet">
  <script src="https://unpkg.com/@bimangle/cesium-info-accessor/dist/cesium-info-accessor.js"></script>
</head>
<body>
  <div id="cesiumContainer" style="width:100%;height:100vh;"></div>
  <script type="module">
    const viewer = new Cesium.Viewer('cesiumContainer');

    // Attach the plugin to the viewer (autoAttach: true by default)
    viewer.extend(InfoAccessorMixin);

    // Load a BimAngle 3D Tiles dataset
    const tileset = await Cesium.Cesium3DTileset.fromUrl('./tileset.json');
    viewer.scene.primitives.add(tileset);

    // The plugin auto-detects BimAngle tilesets and enables pick-to-select.
    // You can also attach manually:
    viewer.infoAccessor.attach(tileset);
  </script>
</body>
</html>
```

---

## Features

- **Auto-detect** BimAngle 3D Tiles datasets added to the scene
- **Hover highlight** — move the mouse over a feature to highlight it
- **Click to select** — left-click selects a feature and displays its properties in Cesium's info box
- **Right-click to zoom** — right-click a feature to fly to its bounding sphere
- **Parent-node selection** — selecting a group node colors all descendant features
- **Public event** `selectionChanged` — subscribe to react when the selected feature changes (e.g. to drive a scene tree)
- **Bilingual UI** — automatically uses Simplified Chinese or English based on `navigator.language`
- Compatible with **Cesium ≥ 1.110.0**

---

## API Reference

### `InfoAccessorMixin(viewer, options?)`

Mixin function to be called via `viewer.extend(InfoAccessorMixin, options)`.  
Attaches `viewer.infoAccessor` (`InfoAccessor`) and `viewer.infoAccessorX` (`InfoAccessorX`) to the viewer.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `autoAttach` | `boolean` | `true` | Automatically attach any BimAngle tileset added to the scene |
| `highlightColor` | `Cesium.Color` | `Cesium.Color.YELLOW` | Feature color on mouse hover |
| `selectedColor` | `Cesium.Color` | `Cesium.Color.LIME` | Feature color when selected |

---

### `viewer.infoAccessor` — `InfoAccessor`

#### Methods

##### `attach(tileset) → boolean`

Manually register a tileset with the plugin.  
Returns `true` if successfully attached, `false` if the argument is not a valid `Cesium3DTileset`.

```javascript
const ok = viewer.infoAccessor.attach(tileset);
```

---

##### `select(tileset, dbId, options?) → void`

Programmatically select a component by its `dbId`.  
Opens the info box and applies the selection color to matching features.

```javascript
viewer.infoAccessor.select(tileset, dbId);

// With options (e.g. from a scene tree)
viewer.infoAccessor.select(tileset, dbId, {
  feature:     cesiumFeature,   // direct Cesium3DTileFeature (leaf node)
  repFeature:  anyDescFeature,  // representative feature for base-path derivation (group node)
  descendants: [dbId1, dbId2],  // descendant dbIds for batch coloring (group node)
  name:        'Column A-1',    // override info box title
});
```

| Option | Type | Description |
|--------|------|-------------|
| `feature` | `Cesium3DTileFeature` | The direct feature to color (leaf node) |
| `repFeature` | `Cesium3DTileFeature` | A representative descendant feature used only for property path derivation (group node) |
| `descendants` | `number[]` | List of descendant `dbId`s for batch color application when there is no direct feature |
| `name` | `string` | Override the info box title |

---

##### `clearSelection() → void`

Deselect the current component and close the info box.  
Also fires `selectionChanged` with `{ tileset: null, dbId: -1 }`.

```javascript
viewer.infoAccessor.clearSelection();
```

---

##### `highlight(tileset, dbId, options?) → void`

Programmatically apply the hover highlight color to a component.

```javascript
viewer.infoAccessor.highlight(tileset, dbId);

// With descendant batch highlight
viewer.infoAccessor.highlight(tileset, dbId, { descendants: [dbId1, dbId2] });
```

---

##### `clearHighlight() → void`

Remove the current hover highlight.

```javascript
viewer.infoAccessor.clearHighlight();
```

---

##### `showProps(node) → void`

Render a property table in the Cesium info box from a property data node object.

```javascript
viewer.infoAccessor.showProps(propsNode);
```

---

##### `getTilesetBasePath(tileset) → string`

Derive the base directory path from a tileset's URL (strips the trailing `/tileset.json` segment).

```javascript
const basePath = viewer.infoAccessor.getTilesetBasePath(tileset);
// e.g. "https://example.com/data/model"
```

---

#### Properties (read-only)

| Property | Type | Description |
|----------|------|-------------|
| `selectedDbId` | `number` | Currently selected component `dbId`, or `-1` if none |
| `selectedTileset` | `Cesium.Cesium3DTileset \| null` | The tileset owning the currently selected component |
| `highlightedDbId` | `number` | Currently hovered `dbId`, or `-1` if none |
| `highlightColor` | `Cesium.Color` | Hover highlight color (writable) |
| `selectedColor` | `Cesium.Color` | Selection color (writable) |

---

#### Events

##### `selectionChanged` — `Cesium.Event`

Fired whenever the selected component changes (including when selection is cleared).  
Listener receives `{ tileset, dbId }` where `dbId` is `-1` when cleared.

```javascript
viewer.infoAccessor.selectionChanged.addEventListener(({ tileset, dbId }) => {
  if (dbId < 0) {
    console.log('Selection cleared');
  } else {
    console.log('Selected dbId:', dbId, 'in tileset:', tileset);
  }
});
```

This event is the recommended integration point for external plugins (such as `cesium-scene-tree`) that need to react to user picks without relying on internal state.

---

### `viewer.infoAccessorX` — `InfoAccessorX`

Provides **model-level** (tileset-level) information display, as opposed to the component-level display of `InfoAccessor`.

```javascript
// Display model-level info when the tileset is clicked
viewer.infoAccessorX.attachTilesetX(tileset, 'Project Title', 'Description text');
```

---

## Integration with `cesium-scene-tree`

`cesium-info-accessor` v2.0 is designed to work alongside [`cesium-scene-tree`](https://www.npmjs.com/package/@bimangle/cesium-scene-tree).  
The scene tree listens to `infoAccessor.selectionChanged` to highlight the corresponding tree node when a component is picked in the Cesium viewport.

```javascript
// Both plugins share the same viewer instance
viewer.extend(InfoAccessorMixin, { autoAttach: true });
viewer.extend(SceneTreeMixin,    { showInfoNodes: false });

// No extra wiring needed — the scene tree subscribes to selectionChanged automatically.
```

---

## Changelog

### v2.0.0
- **New public API**: `select()`, `clearSelection()`, `highlight()`, `clearHighlight()`, `showProps()`, `getTilesetBasePath()`
- **New public event**: `selectionChanged` (`Cesium.Event`) — replaces the need to observe internal state
- **New read-only getters**: `selectedDbId`, `selectedTileset`, `highlightedDbId`
- `select()` no longer requires a direct `Cesium3DTileFeature`; supports group/parent nodes via `descendants` batch coloring
- **Bilingual UI**: property table boolean values and loading text now follow `navigator.language` (Simplified Chinese / English)
- Fixed `_unloadFeature` array index lookup

### v1.0.1
- Initial public release

---

## License

MIT
