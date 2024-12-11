/*!
 * BimAngle 3D Tiles Helper Lib v1.0.1
 * 
 * Copyright 2018-2025 BimAngle
 * All rights reserved.
 */

"use strict";

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

	_setHighlighted(tileset, dbId) {

		if (tileset === this._tileset && dbId === this._highlightedDbId) return;

		this._clearHighlighted();
		this._tileset = tileset;
		this._highlightedDbId = dbId;

		if (this._highlightedDbId === this._selectedDbId || this._highlightedDbId < 0) {
			return;
		}

		const targetColor = this.highlightColor;
		const dbIdToFeatures = this._tilesets.get(tileset).dbIdToFeatures;
		const features = dbIdToFeatures[dbId];
		for (let feature of features) {
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

		if (tileset === this._tileset && dbId === this._selectedDbId) return;

		if (this._highlightedDbId >= 0) {
			this._clearHighlighted();
		}

		this._clearSelected();
		this._tileset = tileset;
		this._selectedDbId = dbId;

		if (this._selectedDbId < 0) {
			return;
		}

		// console.log(`Selected dbId: ${dbId}`);

		this._selectedEntity.name = `Load info for node ${dbId}`;
		this._selectedEntity.description = 'Loading <div class="cesium-infoBox-loading"></div>';
		
		// const sphere = this._getFeatureBoundingSphere(feature);
		// this._selectedEntity.position = sphere.center;
		// this._selectedEntity.ellipsoid = {
		// 	radii: new Cesium.Cartesian3(sphere.radius, sphere.radius, sphere.radius)
		// };
		// this._selectedEntity.boundingSphere = sphere;

		// const heading = Cesium.Math.toRadians(135);
		// const pitch = 0;
		// const roll = 0;
		// const hpr = new Cesium.HeadingPitchRoll(heading, pitch, roll);

		// const hpr = new Cesium.HeadingPitchRange(0, -0.5, 0)
		// const orientation = Cesium.Transforms.headingPitchRollQuaternion(sphere.center, hpr);
		// this._selectedEntity.orientation = orientation;

		this._viewer.selectedEntity = this._selectedEntity;

		//var tilesetUrl = tileset.url || tileset.resource.url;
		const tilesetUrl = this._getTilesetBaseUrl(feature.content.tile);
		const lastIndex = tilesetUrl.lastIndexOf('/');
		const basePath = lastIndex === -1 ? "." : tilesetUrl.substr(0, lastIndex);

        const propsData = feature && feature.getProperty("Props");
        if (propsData) {
            //加载嵌入的属性数据
            this._showProps(propsData);
        } else {
            //从json中加载属性数据
            fetch(`${basePath}/info/${parseInt(dbId / 100)}.json`).then(function (response) {
                return response.json();
            }).then((json) => {
                if (this._selectedDbId !== dbId) return;

                const node = json.data[dbId + ''];

                this._showProps(node);
            }).catch((err) => {
                if (this._selectedDbId !== dbId) return;

                this._selectedEntity.description = err;
            });
        }
		
		const dbIdToFeatures = this._tilesets.get(tileset).dbIdToFeatures;
		const features = dbIdToFeatures[dbId];
		for (let feature of features) {
			this._selected.push({
				feature: feature,
				originalColor: Cesium.Color.clone(feature.color)
			});
			feature.color = Cesium.Color.clone(this.selectedColor, feature.color);
		}
	}

	_showProps(node){
		if (typeof node === 'string') {
			node = JSON.parse(node);
		}

		this._selectedEntity.name = node.name || "<null>";

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
					value = value ? 'Yes' : 'No';
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
		features.splice(features.findIndex(item => item.feature === feature), 1);

		if (dbId === this._selectedDbId) {
			this._selected.splice(this._selected.findIndex(item => item.feature === feature), 1);
		}

		if (dbId === this._highlightedDbId) {
			this._highlighted.splice(this._highlighted.findIndex(item => item.feature === feature), 1);
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