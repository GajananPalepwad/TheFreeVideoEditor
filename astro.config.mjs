// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

import { fileURLToPath } from 'node:url';
import { youtubeDownloadPlugin } from './src/server/youtubeDownloader.mjs';
import { instagramDownloadPlugin } from './src/server/instagramDownloader.mjs';

// Plugin to prevent bundling the massive 26MB onnxruntime wasm files into dist assets
function externalizeOnnxWasmPlugin() {
	return {
		name: 'externalize-onnx-wasm',
		enforce: /** @type {const} */ ('pre'),
		/**
		 * @param {string} code
		 */
		transform(code) {
			if (code.includes('ort-wasm')) {
				return {
					code: code.replace(
						/new URL\(["']ort-wasm-simd-threaded[^\s"']*?\.wasm["'],\s*import\.meta\.url\)/gs,
						'new URL("https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.0-dev.20260914-8d85527a0/dist/ort-wasm-simd-threaded.asyncify.wasm")'
					),
					map: null
				};
			}
			return null;
		},
		closeBundle() {
			import('node:fs').then((fs) => {
				import('node:path').then((path) => {
					const astroDir = path.resolve('dist/_astro');
					if (fs.existsSync(astroDir)) {
						for (const file of fs.readdirSync(astroDir)) {
							if (file.endsWith('.wasm')) {
								fs.unlinkSync(path.join(astroDir, file));
							}
						}
					}
				});
			});
		}
	};
}

// https://astro.build/config
export default defineConfig({
	site: 'https://thefreevideoeditor.com',
	trailingSlash: 'always',
	integrations: [react()],
	vite: {
		plugins: [
			tailwindcss(),
			externalizeOnnxWasmPlugin(),
			youtubeDownloadPlugin(),
			instagramDownloadPlugin()
		],
		resolve: {
			alias: {
				'@huggingface/transformers': fileURLToPath(
					new URL(
						'./node_modules/@huggingface/transformers/dist/transformers.web.js',
						import.meta.url
					)
				)
			}
		},
		optimizeDeps: {
			include: [
				'react',
				'react/jsx-runtime',
				'react/jsx-dev-runtime',
				'react-dom',
				'react-dom/client',
				'mediabunny',
				'zustand',
				'zustand/middleware/immer',
				'zustand/vanilla',
				'immer',
				'idb',
				'zod',
				'fflate',
				'@huggingface/transformers'
			]
		},
		build: {
			chunkSizeWarningLimit: 2500
		}
	}
});
