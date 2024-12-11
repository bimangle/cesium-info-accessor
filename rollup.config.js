import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

export default {
  input: 'src/cesium-info-accessor.js',
  output: {
    file: 'dist/cesium-info-accessor.js',
    format: 'iife',
    name: 'CesiumInfoAccessor',
    globals: {
      cesium: 'Cesium'
    }
  },
  external: ['cesium'],
  plugins: [
    resolve(),
    commonjs()
  ]
}; 