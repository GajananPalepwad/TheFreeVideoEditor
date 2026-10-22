import { parseCubeLut, type ParsedLut3D } from '../../core/lut';
import type { Asset, ProjectId } from '../../core';
import { getMediaFile } from '../storage/opfs';
import { BUILTIN_LUTS, findBuiltinLut, isBuiltinLutId, type BuiltinLut } from '../../core/luts/builtinLuts';

const lutCache = new Map<string, ParsedLut3D>();
const inFlightLoads = new Map<string, Promise<ParsedLut3D | null>>();

export function storeParsedLut(id: string, lut: ParsedLut3D): void {
	lutCache.set(id, lut);
}

export function getParsedLut(id: string): ParsedLut3D | null {
	const direct = lutCache.get(id);
	if (direct) return direct;
	const builtin = findBuiltinLut(id);
	if (builtin) {
		return (
			lutCache.get(builtin.id) ??
			lutCache.get(builtin.filename) ??
			lutCache.get(builtin.name) ??
			null
		);
	}
	return null;
}

export function clearParsedLuts(): void {
	lutCache.clear();
	inFlightLoads.clear();
}

/**
 * Ensures a built-in LUT (.cube) is fetched, parsed, and cached in memory.
 */
export async function ensureBuiltinLutLoaded(idOrName: string): Promise<ParsedLut3D | null> {
	const builtin = findBuiltinLut(idOrName);
	if (!builtin) return null;

	const cacheKey = builtin.id;
	if (lutCache.has(cacheKey)) {
		return lutCache.get(cacheKey)!;
	}
	if (inFlightLoads.has(cacheKey)) {
		return inFlightLoads.get(cacheKey)!;
	}

	const loadPromise = (async () => {
		try {
			let text = '';
			// In Node test environments, read from filesystem if URL starts with /
			const isNodeEnv =
				typeof window === 'undefined' &&
				typeof process !== 'undefined' &&
				typeof process.cwd === 'function';

			if (isNodeEnv) {
				try {
					const fs = await import('fs');
					const path = await import('path');
					const relPath = builtin.url.replace(/^\//, '');
					const fullPath = path.join(process.cwd(), 'public', relPath);
					text = fs.readFileSync(fullPath, 'utf-8');
				} catch {
					const res = await fetch(builtin.url);
					if (!res.ok) throw new Error(`HTTP ${res.status} fetching LUT ${builtin.url}`);
					text = await res.text();
				}
			} else {
				const res = await fetch(builtin.url);
				if (!res.ok) throw new Error(`HTTP ${res.status} fetching LUT ${builtin.url}`);
				text = await res.text();
			}

			const parsed = parseCubeLut(text);
			storeParsedLut(builtin.id, parsed);
			storeParsedLut(builtin.filename, parsed);
			storeParsedLut(builtin.name, parsed);
			return parsed;
		} catch (error) {
			console.warn(`Failed to load or parse built-in LUT "${builtin.name}":`, error);
			return null;
		} finally {
			inFlightLoads.delete(cacheKey);
		}
	})();

	inFlightLoads.set(cacheKey, loadPromise);
	return loadPromise;
}

export async function ensureLutLoaded(
	projectId: ProjectId,
	asset: Asset,
	getFile?: (projectId: ProjectId, asset: Asset) => Promise<File>
): Promise<ParsedLut3D | null> {
	if (lutCache.has(asset.id)) {
		return lutCache.get(asset.id)!;
	}
	if (asset.kind !== 'lut' || asset.offline) return null;
	if (inFlightLoads.has(asset.id)) {
		return inFlightLoads.get(asset.id)!;
	}

	const loadPromise = (async () => {
		try {
			const file = getFile ? await getFile(projectId, asset) : await getMediaFile(projectId, asset);
			const text = await file.text();
			const parsed = parseCubeLut(text);
			storeParsedLut(asset.id, parsed);
			return parsed;
		} catch (error) {
			console.warn(`Failed to load or parse LUT "${asset.name}":`, error);
			return null;
		} finally {
			inFlightLoads.delete(asset.id);
		}
	})();

	inFlightLoads.set(asset.id, loadPromise);
	return loadPromise;
}

export { BUILTIN_LUTS, findBuiltinLut, isBuiltinLutId, type BuiltinLut };
