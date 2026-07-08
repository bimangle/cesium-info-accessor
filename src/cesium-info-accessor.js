/*!
 * BimAngle 3D Tiles Helper Lib v2.0.0
 * 
 * Copyright 2018-2025 BimAngle
 * All rights reserved.
 */

"use strict";

// ---------------------------------------------------------------------------
// i18n — detect browser language once at load time
// ---------------------------------------------------------------------------
const _IA_ZH = (function () {
    if (typeof navigator === 'undefined') return false;
    const lang = (navigator.language || navigator.userLanguage || '').toLowerCase();
    return lang.startsWith('zh');
})();

const _IA_STRINGS = {
    zh: {
        loading:  '加载中...',
        yes:      '是',
        no:       '否',
        null_name: '<无名称>',
    },
    en: {
        loading:  'Loading...',
        yes:      'Yes',
        no:       'No',
        null_name: '<null>',
    },
};

function _iat(key) {
    return _IA_ZH ? _IA_STRINGS.zh[key] : _IA_STRINGS.en[key];
}

function InfoAccessorMixin(viewer, options){
    
    if (viewer.hasOwnProperty("infoAccessor") || 
        viewer.hasOwnProperty("infoAccessorX")) {
        return;
    }
    
    const infoAccessor = new InfoAccessor(viewer, options);
    const infoAccessorX = new InfoAccessorX(viewer, options);

    Object.defineProperties(viewer, {
        infoAccessor: {
            get: function () {
                return infoAccessor;
            },
        },
        infoAccessorX: {
            get: function () {
                return infoAccessorX;
            },
        },
    });
}

/**
 * 将属性信息绑定到模型构件
 *
 * v2.0 新增公开 API：
 *   select(tileset, dbId, options?)   — 选中构件（解除 feature 必选依赖）
 *   clearSelection()                  — 取消选中
 *   highlight(tileset, dbId)          — 高亮构件（悬停）
 *   clearHighlight()                  — 清除高亮
 *   showProps(node)                   — 在信息框渲染属性表格
 *   getTilesetBasePath(tileset)       — 从 tileset URL 推导基础路径
 *   selectedDbId  (getter)            — 当前选中的 dbId（-1 表示无）
 *   selectedTileset (getter)          — 当前选中的 tileset
 *   highlightedDbId (getter)          — 当前悬停高亮的 dbId
 *   selectionChanged (Cesium.Event)   — 选中状态变化事件 {tileset, dbId}
 */
class InfoAccessor {

    _tilesets = new WeakMap();
    _tileset = null;
    _picking = true;

    _selected = [];
    _selectedDbId = -1;
    _highlighted = [];
    _highlightedDbId = -1;

    _leftDown = false;
    _middleDown = false;
    _rightDown = false;
    _pinchStart = false;

    _selectedEntity = new Cesium.Entity();

    // ---------------------------------------------------------------------------
    // Public read-only state
    // ---------------------------------------------------------------------------
    get selectedDbId()    { return this._selectedDbId; }
    get selectedTileset() { return this._tileset; }
    get highlightedDbId() { return this._highlightedDbId; }

    constructor(viewer, options){

        const defaults = {
            autoAttach: true,
            highlightColor: Cesium.Color.YELLOW,
            selectedColor: Cesium.Color.LIME
        };

        this._viewer = viewer;
        this._config = Object.assign({}, defaults, options || {});

        this.highlightColor = this._config.highlightColor;
        this.selectedColor = this._config.selectedColor;

        // Public event — fires whenever selection changes
        this.selectionChanged = new Cesium.Event();

        this._loadFeatureBind = this._loadFeature.bind(this);
        this._unloadFeatureBind = this._unloadFeature.bind(this);

        this._setupScreenSpaceEventHandler();
    }

    attach(tileset){
        if(!this._isTileset(tileset)) return false;
        if(this._tilesets.has(tileset)) return true;

        //const hasInfo = tileset.asset?.extras?.engine?.info;
        //if(!hasInfo) return false;

        this._setupTileset(tileset);
        return true;
    }

    // ---------------------------------------------------------------------------
    // Public API — v2.0
    // ---------------------------------------------------------------------------

    /**
     * 选中指定构件，可选支持父节点（无直接 feature）场景。
     * @param {Cesium.Cesium3DTileset} tileset
     * @param {number} dbId
     * @param {object} [options]
     * @param {Cesium.Cesium3DTileFeature} [options.feature]      — 直接 feature（叶节点）
     * @param {Cesium.Cesium3DTileFeature} [options.repFeature]   — 代表 feature（父节点，仅用于 basePath 推导）
     * @param {number[]} [options.descendants]                    — 子孙 dbId 列表（用于批量着色）
     * @param {string}  [options.name]                            — 覆盖信息框标题
     */
    select(tileset, dbId, options) {
        const opts = options || {};

        if (tileset === this._tileset && dbId === this._selectedDbId) return;

        if (this._highlightedDbId >= 0) this._clearHighlighted();
        this._clearSelected();

        this._tileset      = tileset;
        this._selectedDbId = dbId;

        if (dbId < 0) {
            this.selectionChanged.raiseEvent({ tileset: null, dbId: -1 });
            return;
        }

        // Ensure tileset is registered
        if (!this._tilesets.has(tileset)) this._setupTileset(tileset);

        // Show info box with loading placeholder
        const displayName = opts.name || `${dbId}`;
        this._selectedEntity.name        = displayName;
        this._selectedEntity.description = `${_iat('loading')}<div class="cesium-infoBox-loading"></div>`;
        this._viewer.selectedEntity = this._selectedEntity;

        // Resolve basePath: prefer feature/repFeature → tile recursive; fallback → tileset URL
        const anchorFeature = opts.feature || opts.repFeature || null;
        let basePath = this.getTilesetBasePath(tileset);
        if (anchorFeature) {
            try {
                const tilesetUrl = this._getTilesetBaseUrl(anchorFeature.content.tile);
                const lastSlash  = tilesetUrl.lastIndexOf('/');
                basePath = lastSlash === -1 ? '.' : tilesetUrl.substring(0, lastSlash);
            } catch (_) { /* fallback to tileset URL already set */ }
        }

        // Load properties
        const propsData = anchorFeature && anchorFeature.getProperty && anchorFeature.getProperty('Props');
        if (propsData) {
            this.showProps(propsData);
        } else {
            fetch(`${basePath}/info/${Math.floor(parseInt(dbId, 10) / 100)}.json`)
                .then((r) => {
                    if (!r.ok) throw new Error(`HTTP ${r.status}`);
                    return r.json();
                })
                .then((json) => {
                    if (this._selectedDbId !== dbId) return;
                    const node = json.data[dbId + ''];
                    if (opts.name && node) node.name = opts.name;
                    this.showProps(node);
                })
                .catch((err) => {
                    if (this._selectedDbId !== dbId) return;
                    this._selectedEntity.description = String(err);
                });
        }

        // Apply selection color to features
        // Priority: opts.feature > dbIdToFeatures[dbId] (direct) > opts.descendants (batch)
        const tilesetInfo  = this._tilesets.get(tileset);
        const d2f          = tilesetInfo ? tilesetInfo.dbIdToFeatures : {};
        const directFeatures = d2f[dbId];

        const colorTargets = [];
        if (opts.feature) {
            colorTargets.push(opts.feature);
        } else if (directFeatures && directFeatures.length > 0) {
            colorTargets.push(...directFeatures);
        } else if (opts.descendants && opts.descendants.length > 0) {
            for (const did of opts.descendants) {
                const df = d2f[did];
                if (df) colorTargets.push(...df);
            }
        }

        for (const f of colorTargets) {
            this._selected.push({
                feature: f,
                originalColor: Cesium.Color.clone(f.color)
            });
            f.color = Cesium.Color.clone(this.selectedColor, f.color);
        }

        this.selectionChanged.raiseEvent({ tileset, dbId });
    }

    /** 取消当前选中 */
    clearSelection() {
        const hadSelection = this._selectedDbId >= 0;
        this._clearSelected();
        if (hadSelection) {
            this.selectionChanged.raiseEvent({ tileset: null, dbId: -1 });
        }
    }

    /**
     * 高亮指定构件（悬停效果），支持子孙批量高亮。
     * @param {Cesium.Cesium3DTileset} tileset
     * @param {number} dbId
     * @param {object} [options]
     * @param {number[]} [options.descendants] — 子孙 dbId 列表
     */
    highlight(tileset, dbId, options) {
        this._setHighlighted(tileset, dbId, options);
    }

    /** 清除悬停高亮 */
    clearHighlight() {
        this._clearHighlighted();
    }

    /**
     * 在 Cesium 信息框中渲染属性表格。
     * @param {object|string} node — 属性数据节点
     */
    showProps(node) {
        this._showProps(node);
    }

    /**
     * 从 tileset URL 直接推导基础路径（去掉最后一段 /tileset.json）。
     * @param {Cesium.Cesium3DTileset} tileset
     * @returns {string}
     */
    getTilesetBasePath(tileset) {
        const url      = tileset.resource?.url || tileset.url || '';
        const cleanUrl = url.includes('?') ? url.split('?')[0] : url;
        const last     = cleanUrl.lastIndexOf('/');
        return last >= 0 ? cleanUrl.substring(0, last) : '.';
    }
    
    _setupScreenSpaceEventHandler(){
        const viewer = this._viewer;
        
        if(this._config.autoAttach){
            viewer.scene.primitives.primitiveAdded?.addEventListener(this._onPrimitivesAdded.bind(this));
        }
        viewer.scene.primitives.primitiveRemoved?.addEventListener(this._onPrimitivesRemoved.bind(this));
        
        this._handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
        this._handler.setInputAction(this._onMouseMove.bind(this), Cesium.ScreenSpaceEventType.MOUSE_MOVE);
        this._handler.setInputAction(this._onLeftClick.bind(this), Cesium.ScreenSpaceEventType.LEFT_CLICK);
        this._handler.setInputAction(this._onLeftUp.bind(this), Cesium.ScreenSpaceEventType.LEFT_UP);
        this._handler.setInputAction(this._onLeftDown.bind(this), Cesium.ScreenSpaceEventType.LEFT_DOWN);
        this._handler.setInputAction(this._onMiddleUp.bind(this), Cesium.ScreenSpaceEventType.MIDDLE_UP);
        this._handler.setInputAction(this._onMiddleDown.bind(this), Cesium.ScreenSpaceEventType.MIDDLE_DOWN);
        this._handler.setInputAction(this._onRightClick.bind(this), Cesium.ScreenSpaceEventType.RIGHT_CLICK);
        this._handler.setInputAction(this._onRightUp.bind(this), Cesium.ScreenSpaceEventType.RIGHT_UP);
        this._handler.setInputAction(this._onRightDown.bind(this), Cesium.ScreenSpaceEventType.RIGHT_DOWN);
        this._handler.setInputAction(this._onPinchStart.bind(this), Cesium.ScreenSpaceEventType.PINCH_START);
        this._handler.setInputAction(this._onPinchEnd.bind(this), Cesium.ScreenSpaceEventType.PINCH_END);
    }
    
    _setupTileset(tileset){

        let tilesetInfo = {
            dbIdToFeatures: {},
            hiddenDbIds: []
        };

        this._tilesets.set(tileset, tilesetInfo);
        
        tileset.colorBlendMode = Cesium.Cesium3DTileColorBlendMode.REPLACE;
        tileset.tileLoad.addEventListener(this._onTileLoad.bind(this));
        tileset.tileUnload.addEventListener(this._onTileUnload.bind(this));    
    }
    
    _onPrimitivesAdded(primitive){
        if (this._isTileset(primitive)) {
            const hasInfo = primitive.asset?.extras?.engine?.info;
            if(hasInfo){
                this._setupTileset(primitive);
            }
        }
    }
    
    _onPrimitivesRemoved(primitive){
        this._tilesets.delete(primitive);
    }
    
    _onMouseMove(e){
        if (!this._picking) return;
        if (this._leftDown || this._middleDown || this._rightDown || this._pinchStart) return;

        const pickedFeature = this._viewer.scene.pick(e.endPosition);
        if (this._checkPickedFeature(pickedFeature)) {
            const tileset = pickedFeature.tileset;
            const dbId = this._getFeatureDbId(pickedFeature);
            this._setHighlighted(tileset, dbId);
        } else {
            this._clearHighlighted();
        }
    }
    
    _onLeftClick(e){
        if (!this._picking) return;

        const pickedFeature = this._viewer.scene.pick(e.position);
        if (this._checkPickedFeature(pickedFeature)) {
            const tileset = pickedFeature.tileset;
            const dbId = this._getFeatureDbId(pickedFeature);
            if (dbId === this._selectedDbId) {
                this._clearSelected();
            } else {
                this._setSelected(tileset, dbId, pickedFeature);
            }
        } else {
            this._clearSelected();
        }
    }
    
    _onLeftUp(e){this._leftDown = false;}
    _onLeftDown(e){this._leftDown = true;}
    
    _onMiddleUp(e){this._middleDown = false;}
    _onMiddleDown(e){this._middleDown = true;}
    
    _onRightClick(e){
        if (!this._picking) return;

        const pickedFeature = this._viewer.scene.pick(e.position);
        if (this._checkPickedFeature(pickedFeature)) {
            const sphere = this._getFeatureBoundingSphere(pickedFeature);
            const camera = this._viewer.scene.camera;
            const offset = new Cesium.HeadingPitchRange(camera.heading, camera.pitch, 0);
            camera.flyToBoundingSphere(sphere, {offset: offset});
        } else {
            this._clearSelected();
        }
    }

    _onRightUp(e){this._rightDown = false;}
    _onRightDown(e){this._rightDown = true;}
    
    _onPinchStart(e){this._pinchStart = true;}
    _onPinchEnd(e){this._pinchStart = false;}
    
    _onTileLoad(tile){
        this._processTileFeatures(tile, this._loadFeatureBind);
    }
    
    _onTileUnload(tile){
        this._processTileFeatures(tile, this._unloadFeatureBind);
    }

    _isTileset(primitive) {
        return primitive && primitive instanceof Cesium.Cesium3DTileset;
    }

    _checkPickedFeature(pickedFeature){
        if(!Cesium.defined(pickedFeature)) return;

        return pickedFeature instanceof Cesium.Cesium3DTileFeature &&
            this._tilesets.has(pickedFeature.tileset);
    }

    _getFeatureDbId(feature) {
        if (Cesium.defined(feature) && Cesium.defined(feature.getProperty)) {
            return parseInt(feature.getProperty('DbId'), 10);
        }
        return -1;
    }

    _getFeatureBoundingSphere(feature){
        const minX = feature.getProperty('MinX');
        const minY = feature.getProperty('MinY');
        const minZ = feature.getProperty('MinZ');
        const maxX = feature.getProperty('MaxX');
        const maxY = feature.getProperty('MaxY');
        const maxZ = feature.getProperty('MaxZ');

        const transform = this._getTilesetTransform(feature.content.tile);

        const sphere = Cesium.BoundingSphere.transform(
            Cesium.BoundingSphere.fromCornerPoints(new Cesium.Cartesian3(minX, minY, minZ), new Cesium.Cartesian3(maxX, maxY, maxZ)), 
            transform, //tileset.root.computedTransform,  //tileset.modelMatrix, 
            new Cesium.BoundingSphere()
        );

        return sphere;
    }

    _setHighlighted(tileset, dbId, options) {

        if (tileset === this._tileset && dbId === this._highlightedDbId) return;

        this._clearHighlighted();
        this._tileset        = tileset;
        this._highlightedDbId = dbId;

        if (this._highlightedDbId === this._selectedDbId || this._highlightedDbId < 0) {
            return;
        }

        const targetColor    = this.highlightColor;
        const tilesetInfo    = this._tilesets.get(tileset);
        if (!tilesetInfo) return;
        const dbIdToFeatures = tilesetInfo.dbIdToFeatures;

        // Collect direct features + optional descendants
        const colorTargets = [];
        const direct = dbIdToFeatures[dbId];
        if (direct && direct.length > 0) {
            colorTargets.push(...direct);
        } else if (options && options.descendants) {
            for (const did of options.descendants) {
                const df = dbIdToFeatures[did];
                if (df) colorTargets.push(...df);
            }
        }

        for (const feature of colorTargets) {
            this._highlighted.push({
                feature: feature,
                originalColor: Cesium.Color.clone(feature.color)
            });
            feature.color = Cesium.Color.clone(targetColor, feature.color);
        }
    }

    _getTilesetTransform(tile){
        if(tile.parent === undefined){
            //直接获取 tileset 的 transform
            return tile.computedTransform;
        }
        
        if(tile.parent.content instanceof Cesium.Tileset3DTileContent){
            //获取 tile 所在的子 tileset 的 transform
            return tile.computedTransform;
        }
        
        //继续递归查找
        return this._getTilesetTransform(tile.parent);
    }

    _getTilesetBaseUrl(tile){
        if(tile.parent === undefined){
            //直接获取 tileset 的 url
            return tile.tileset.url || tile.tileset.resource.url;
        }
        
        if(tile.parent.content instanceof Cesium.Tileset3DTileContent){
            //获取 tile 所在的子 tileset 的 url
            return tile.parent._contentResource._url;
        }
        
        //继续递归查找
        return this._getTilesetBaseUrl(tile.parent);
    }

    _setSelected(tileset, dbId, feature) {
        // Backward-compatible shim — delegates to the new public select() API
        this.select(tileset, dbId, { feature });
    }

    _showProps(node){
        if (typeof node === 'string') {
            node = JSON.parse(node);
        }

        this._selectedEntity.name = node.name || _iat('null_name');

        let strings = [];
        strings.push('<table class="cesium-infoBox-defaultTable"><tbody>');

        for (let category of node.categories) {
            const props = category.props;
            const propCount = category.count;
            let haveTitle = false;
            for (let i = 0; i < propCount; i++) {
                if (props.flags[i]) continue;

                if (!haveTitle) {
                    haveTitle = true;
                    strings.push(`<tr><th colspan=2>${category.name}</th></tr>`);
                }

                let value = props.values[i];
                switch (props.types[i]) {
                case 'boolean':
                    value = value ? _iat('yes') : _iat('no');
                    break;
                case 'double':
                    value = props.units[i] ? `${value.toFixed(3)} ${props.units[i]}` : `${value.toFixed(3)}`;
                    break;
                default:
                    value = value + '';
                    break;
                }

                strings.push(`<tr><th>${props.names[i]}</th><td>${value}</td></tr>`);
            }
        }

        strings.push('</tbody></table>');

        this._selectedEntity.description = strings.join('');
    }

    _clearHighlighted() {
        if (this._highlightedDbId < 0) return;

        if (this._highlighted.length > 0) {
            for (let item of this._highlighted) {
                item.feature.color = item.originalColor;
            }
            this._highlighted = [];
        }

        this._highlightedDbId = -1;
    }

    _clearSelected() {
        if (this._selected.length > 0) {
            for (let item of this._selected) {
                item.feature.color = item.originalColor;
            }
            this._selected = [];
        }

        this._selectedDbId = -1;

        if(this._viewer.selectedEntity === this._selectedEntity){
            this._viewer.selectedEntity = null;
        }
    }

    _unloadFeature(feature) {
        const dbId = this._getFeatureDbId(feature);

        const dbIdToFeatures = this._tilesets.get(feature.tileset).dbIdToFeatures;
        const features = dbIdToFeatures[dbId];
        if (features) {
            const idx = features.indexOf(feature);
            if (idx > -1) features.splice(idx, 1);
        }

        if (dbId === this._selectedDbId) {
            const si = this._selected.findIndex(item => item.feature === feature);
            if (si > -1) this._selected.splice(si, 1);
        }

        if (dbId === this._highlightedDbId) {
            const hi = this._highlighted.findIndex(item => item.feature === feature);
            if (hi > -1) this._highlighted.splice(hi, 1);
        }
    }

    _loadFeature(feature) {
        const dbId = this._getFeatureDbId(feature);

        const tilesetInfo = this._tilesets.get(feature.tileset);
        const dbIdToFeatures = tilesetInfo.dbIdToFeatures;
        let features = dbIdToFeatures[dbId];
        if (!Cesium.defined(features)) {
            dbIdToFeatures[dbId] = features = [];
        }
        features.push(feature);

        const hiddenDbIds = tilesetInfo.hiddenDbIds;
        if (hiddenDbIds.indexOf(dbId) > -1) {
            feature.show = false;
        }
    }

    _processContentFeatures(content, callback) {
        const featuresLength = content.featuresLength;
        for (let i = 0; i < featuresLength; ++i) {
            const feature = content.getFeature(i);
            callback(feature);
        }
    }

    _processTileFeatures(tile, callback) {
        const content = tile.content;
        const innerContents = content.innerContents;
        if (Cesium.defined(innerContents)) {
            const length = innerContents.length;
            for (let i = 0; i < length; ++i) {
                this._processContentFeatures(innerContents[i], callback);
            }
        } else {
            this._processContentFeatures(content, callback);
        }
    }
}

/**
 * 将模型作为一个整体绑定标题和描述信息
 */
class InfoAccessorX {
    
    _tilesets = new WeakMap();
    _picking = true;

    _selectedTileset = null;
    _highlightedTileset = null;

    _leftDown = false;
    _middleDown = false;
    _rightDown = false;
    _pinchStart = false;

    _selectedEntity = new Cesium.Entity();
    
    constructor(viewer, options){
        
        const defaults = {
            highlightColor: Cesium.Color.YELLOW,
            selectedColor: Cesium.Color.LIME
        };
        
        this._viewer = viewer;
        this._config = Object.assign({}, defaults, options || {});
        
        this.highlightColor = this._config.highlightColor;
        this.selectedColor = this._config.selectedColor;
        
        this._setupScreenSpaceEventHandler();
    }

    attach(tileset, options){
        if(!this._isTileset(tileset)) return false;
        if(this._tilesets.has(tileset)) return true;

        const infoDefaults = {
            title: "Model",
            description: "Model description."
        };
        const info = Object.assign({}, infoDefaults, options || {});

        this._setupTileset(tileset, info);
        return true;
    }
    
    _setupScreenSpaceEventHandler(){
        const viewer = this._viewer;
            
        viewer.scene.primitives.primitiveRemoved?.addEventListener(this._onPrimitivesRemoved.bind(this));

        this._handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
        this._handler.setInputAction(this._onMouseMove.bind(this), Cesium.ScreenSpaceEventType.MOUSE_MOVE);
        this._handler.setInputAction(this._onLeftClick.bind(this), Cesium.ScreenSpaceEventType.LEFT_CLICK);
        this._handler.setInputAction(this._onLeftUp.bind(this), Cesium.ScreenSpaceEventType.LEFT_UP);
        this._handler.setInputAction(this._onLeftDown.bind(this), Cesium.ScreenSpaceEventType.LEFT_DOWN);
        this._handler.setInputAction(this._onMiddleUp.bind(this), Cesium.ScreenSpaceEventType.MIDDLE_UP);
        this._handler.setInputAction(this._onMiddleDown.bind(this), Cesium.ScreenSpaceEventType.MIDDLE_DOWN);
        this._handler.setInputAction(this._onRightClick.bind(this), Cesium.ScreenSpaceEventType.RIGHT_CLICK);
        this._handler.setInputAction(this._onRightUp.bind(this), Cesium.ScreenSpaceEventType.RIGHT_UP);
        this._handler.setInputAction(this._onRightDown.bind(this), Cesium.ScreenSpaceEventType.RIGHT_DOWN);
        this._handler.setInputAction(this._onPinchStart.bind(this), Cesium.ScreenSpaceEventType.PINCH_START);
        this._handler.setInputAction(this._onPinchEnd.bind(this), Cesium.ScreenSpaceEventType.PINCH_END);
    }
    
    _setupTileset(tileset, info){

        let tilesetInfo = {
            tiles: [],
            info: info
        };

        this._tilesets.set(tileset, tilesetInfo);
        
        tileset.colorBlendMode = Cesium.Cesium3DTileColorBlendMode.REPLACE;
        tileset.tileLoad.addEventListener(this._onTileLoad.bind(this));
        tileset.tileUnload.addEventListener(this._onTileUnload.bind(this));    
    }    
    
    _onPrimitivesRemoved(primitive){
        this._tilesets.delete(primitive);
    }
    
    _onMouseMove(e){
        if (!this._picking) return;
        if (this._leftDown || this._middleDown || this._rightDown || this._pinchStart) return;

        const pickedFeature = this._viewer.scene.pick(e.endPosition);
        if (this._checkPickedFeature(pickedFeature)) {
            const tileset = pickedFeature.tileset;
            this._setHighlighted(tileset);
        } else {
            this._clearHighlighted();
        }
    }
    
    _onLeftClick(e){
        if (!this._picking) return;

        const pickedFeature = this._viewer.scene.pick(e.position);
        if (this._checkPickedFeature(pickedFeature)) {
            const tileset = pickedFeature.tileset;
            this._setSelected(tileset);
        } else {
            this._clearSelected();
        }
    }
    
    _onLeftUp(e){this._leftDown = false;}
    _onLeftDown(e){this._leftDown = true;}
    
    _onMiddleUp(e){this._middleDown = false;}
    _onMiddleDown(e){this._middleDown = true;}
    
    _onRightClick(e){
        if (!this._picking) return;

        const pickedFeature = this._viewer.scene.pick(e.position);
        if (this._checkPickedFeature(pickedFeature)) {
            const tileset = pickedFeature.tileset;
            const camera = this._viewer.scene.camera;
            const offset = new Cesium.HeadingPitchRange(camera.heading, camera.pitch, 0);
            camera.flyTo(tileset, {offset: offset});
        } else {
            this._clearSelected();
        }
    }

    _onRightUp(e){this._rightDown = false;}
    _onRightDown(e){this._rightDown = true;}
    
    _onPinchStart(e){this._pinchStart = true;}
    _onPinchEnd(e){this._pinchStart = false;}
    
    _onTileLoad(tile){
        const tileset = tile.tileset;
        const tilesetInfo = this._tilesets.get(tileset);
        const tiles = tilesetInfo.tiles;
        tiles.push(tile);
    }
    
    _onTileUnload(tile){
        const tileset = tile.tileset;
        const tilesetInfo = this._tilesets.get(tileset);
        const tiles = tilesetInfo.tiles;
        tiles.splice(tiles.findIndex(item => item === tile), 1);
    }

    _isTileset(primitive) {
        return primitive && primitive instanceof Cesium.Cesium3DTileset;
    }

    _checkPickedFeature(pickedFeature){
        if(!Cesium.defined(pickedFeature)) return;

        return pickedFeature instanceof Cesium.Cesium3DTileFeature &&
            this._tilesets.has(pickedFeature.tileset);
    }

    _setHighlighted(tileset, dbId) {

        if (tileset === this._highlightedTileset) return;

        this._clearHighlighted();
        if(tileset === this._selectedTileset) return;

        this._highlightedTileset = tileset;
        this._setTilesColor(tileset, this.highlightColor);
    }

    _setSelected(tileset) {

        if (tileset === this._selectedTileset) return;

        this._clearHighlighted();
        this._clearSelected();
        this._selectedTileset = tileset;

        const tilesetInfo = this._tilesets.get(tileset);
        const info = tilesetInfo.info;

        this._selectedEntity.name = info.title;
        this._selectedEntity.description = info.description; //'Loading <div class="cesium-infoBox-loading"></div>';
        this._viewer.selectedEntity = this._selectedEntity;

        this._setTilesColor(tileset, this.selectedColor);
    }

    _clearHighlighted() {
        if (this._highlightedTileset){
            this._restoreTilesColor(this._highlightedTileset);
            this._highlightedTileset = null;
        }
    }

    _clearSelected() {
        if (this._selectedTileset) {
            this._restoreTilesColor(this._selectedTileset);
            this._selectedTileset = null;
            this._highlightedTileset = null;
        }
        
        if(this._viewer.selectedEntity === this._selectedEntity){
            this._viewer.selectedEntity = null;
        }
    }

    _setTilesColor(tileset, color){
        const tilesetInfo = this._tilesets.get(tileset);
        const tiles = tilesetInfo.tiles;

        for (let tile of tiles) {
            tile.originalColor = Cesium.Color.clone(tile.color);
            tile.color = color;
        }
    }

    _restoreTilesColor(tileset){
        const tilesetInfo = this._tilesets.get(tileset);
        const tiles = tilesetInfo.tiles;
        
        for (let tile of tiles) {
            if(tile.originalColor){
                tile.color = tile.originalColor;
            }
        }
    }
}

//将属性信息绑定到模型构件(用于兼容2024年12月之前的旧版本数据)
function attachTileset(viewer, tileset){
    viewer.extend(InfoAccessorMixin);
    viewer.infoAccessor.attach(tileset);
}

//将模型作为一个整体绑定标题和描述信息(用于兼容2024年12月之前的旧版本数据)
function attachTilesetX(viewer, tileset, title, description){
    const options = {
        title: title, 
        description: description
    };
    
    viewer.extend(InfoAccessorMixin);
    viewer.infoAccessorX.attach(tileset, options);
}

//重定位 3D Tiles 数据集的位置（仅适用于地理配准方式为站心坐标或暂不配准的情况）
function relocationTileset(tileset, longitude, latitude, height, rotation) {

    var modelMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(Cesium.Cartesian3.fromDegrees(longitude, latitude, height));
    Cesium.Matrix4.multiplyByMatrix3(modelMatrix, Cesium.Matrix3.fromRotationZ(Cesium.Math.toRadians(rotation)), modelMatrix);

    tileset.readyPromise.then(function(tileset) {
        tileset.root.transform = modelMatrix;
    });
}

if (typeof window !== 'undefined') {
    window.InfoAccessor = InfoAccessor;
    window.InfoAccessorX = InfoAccessorX;
    window.InfoAccessorMixin = InfoAccessorMixin;
    window.attachTileset = attachTileset;
    window.attachTilesetX = attachTilesetX;
    window.relocationTileset = relocationTileset;
}

export { 
    InfoAccessor, 
    InfoAccessorX, 
    InfoAccessorMixin, 
    attachTileset, 
    attachTilesetX, 
    relocationTileset 
}; 
