import { openDB, type IDBPDatabase } from 'idb';

export interface BundledFontVariant {
	url: string;
	weight?: string;
	style?: string;
}

export interface BundledFont {
	family: string;
	displayName: string;
	category: 'sans' | 'display' | 'serif' | 'mono' | 'handwriting' | 'condensed';
	url: string;
	license: string;
	variants?: readonly BundledFontVariant[];
}

export interface CustomFont {
	family: string;
	displayName: string;
	fileName: string;
	data?: ArrayBuffer;
	url?: string;
	dateAdded?: number;
}

export const BUNDLED_FONTS: readonly BundledFont[] = [
	{
		family: 'Inter',
		displayName: 'Inter (Sans)',
		category: 'sans',
		url: '/fonts/Inter-VariableFont_opsz,wght.ttf',
		license: 'OFL-1.1'
	},
	{
		family: 'Montserrat',
		displayName: 'Montserrat (Display Sans)',
		category: 'display',
		url: '/fonts/Montserrat-VariableFont_wght.ttf',
		license: 'OFL-1.1'
	},
	{
		family: 'Playfair Display',
		displayName: 'Playfair Display (Serif)',
		category: 'serif',
		url: '/fonts/PlayfairDisplay-VariableFont_wght.ttf',
		license: 'OFL-1.1'
	},
	{
		family: 'Roboto Mono',
		displayName: 'Roboto Mono (Monospace)',
		category: 'mono',
		url: '/fonts/RobotoMono-VariableFont_wght.ttf',
		license: 'Apache-2.0'
	},
	{
		family: 'Caveat',
		displayName: 'Caveat (Handwriting)',
		category: 'handwriting',
		url: '/fonts/Caveat-VariableFont_wght.ttf',
		license: 'OFL-1.1'
	},
	{
		family: 'Bebas Neue',
		displayName: 'Bebas Neue (Condensed Bold)',
		category: 'condensed',
		url: '/fonts/BebasNeue-Regular.ttf',
		license: 'OFL-1.1'
	},
	{
		family: 'Kanit',
		displayName: 'Kanit (Geometric Display)',
		category: 'display',
		url: '/fonts/Kanit-Regular.ttf',
		license: 'OFL-1.1',
		variants: [
			{ url: '/fonts/Kanit-Regular.ttf', weight: '400', style: 'normal' },
			{ url: '/fonts/Kanit-MediumItalic.ttf', weight: '500', style: 'italic' },
			{ url: '/fonts/Kanit-BlackItalic.ttf', weight: '900', style: 'italic' }
		]
	}
];

export const SYSTEM_FALLBACK_FONTS = new Set([
	'sans-serif',
	'serif',
	'monospace',
	'cursive',
	'fantasy',
	'system-ui',
	'arial',
	'helvetica',
	'times new roman',
	'courier new',
	'georgia',
	'verdana'
]);

const loadedFonts = new Set<string>();
const failedFonts = new Set<string>();
const loadingPromises = new Map<string, Promise<boolean>>();
const customFonts = new Map<string, CustomFont>();

export type FontLoadListener = (family: string) => void;
const fontLoadListeners = new Set<FontLoadListener>();

export function onFontLoaded(listener: FontLoadListener): () => void {
	fontLoadListeners.add(listener);
	return () => fontLoadListeners.delete(listener);
}

export function notifyFontLoaded(family: string): void {
	for (const listener of fontLoadListeners) {
		try {
			listener(family);
		} catch (err) {
			console.error('Error in onFontLoaded listener:', err);
		}
	}
}

// Auto-listen to document.fonts in browser window environments so web fonts (e.g. Google Fonts)
// automatically notify subscribers the moment they finish downloading
if (typeof document !== 'undefined' && document.fonts) {
	void document.fonts.ready.then(() => {
		try {
			for (const face of document.fonts) {
				if (face.status === 'loaded') {
					const clean = face.family.replace(/^['"]|['"]$/g, '');
					loadedFonts.add(clean);
				}
			}
		} catch {
			// ignore
		}
		notifyFontLoaded('*');
	});

	try {
		document.fonts.addEventListener('loadingdone', (event: Event) => {
			const fontEvent = event as unknown as { fontfaces?: FontFace[] };
			if (fontEvent.fontfaces) {
				for (const face of fontEvent.fontfaces) {
					const clean = face.family.replace(/^['"]|['"]$/g, '');
					loadedFonts.add(clean);
				}
			}
			notifyFontLoaded('*');
		});
	} catch {
		// ignore
	}
}

const CUSTOM_FONTS_DB_NAME = 'tfve-custom-fonts';
const CUSTOM_FONTS_DB_VERSION = 1;
const CUSTOM_FONTS_STORE = 'fonts';

interface CustomFontRecord {
	family: string;
	displayName: string;
	fileName: string;
	data: ArrayBuffer;
	dateAdded: number;
}

export interface CustomFontsDatabase {
	fonts: {
		key: string;
		value: CustomFontRecord;
	};
}

let customFontsDbPromise: Promise<IDBPDatabase<CustomFontsDatabase>> | null = null;
function getCustomFontsDb(): Promise<IDBPDatabase<CustomFontsDatabase>> | null {
	if (typeof indexedDB === 'undefined') return null;
	if (!customFontsDbPromise) {
		customFontsDbPromise = openDB<CustomFontsDatabase>(
			CUSTOM_FONTS_DB_NAME,
			CUSTOM_FONTS_DB_VERSION,
			{
				upgrade(db) {
					if (!db.objectStoreNames.contains(CUSTOM_FONTS_STORE)) {
						db.createObjectStore(CUSTOM_FONTS_STORE, { keyPath: 'family' });
					}
				}
			}
		);
	}
	return customFontsDbPromise;
}

function getFontMime(fileName: string): string {
	const ext = fileName.split('.').pop()?.toLowerCase();
	switch (ext) {
		case 'woff2':
			return 'font/woff2';
		case 'woff':
			return 'font/woff';
		case 'otf':
			return 'font/otf';
		case 'ttf':
		default:
			return 'font/ttf';
	}
}

/**
 * Returns all currently registered in-memory custom fonts.
 */
export function getCustomFonts(): CustomFont[] {
	return Array.from(customFonts.values());
}

/**
 * Registers a custom font in-memory and in document.fonts / worker fonts.
 */
export async function registerCustomFont(font: CustomFont): Promise<boolean> {
	try {
		if (font.data && !font.url && typeof URL !== 'undefined') {
			const blob = new Blob([font.data], { type: getFontMime(font.fileName) });
			font.url = URL.createObjectURL(blob);
		}

		if (typeof FontFace !== 'undefined') {
			interface WithFonts {
				fonts?: FontFaceSet;
			}
			const globalFonts =
				typeof document !== 'undefined' ? document.fonts : (self as unknown as WithFonts).fonts;

			const source = font.data ? font.data : font.url ? `url(${font.url})` : null;
			if (source) {
				const fontFace =
					typeof source === 'string'
						? new FontFace(font.family, source)
						: new FontFace(font.family, source);
				const loadedFace = await fontFace.load();
				if (globalFonts) {
					globalFonts.add(loadedFace);
				}
			}
		}

		loadedFonts.add(font.family);
		failedFonts.delete(font.family.toLowerCase());
		customFonts.set(font.family.toLowerCase(), font);
		notifyFontLoaded(font.family);
		return true;
	} catch (err) {
		console.warn('Failed to register custom font:', font.family, err);
		return false;
	}
}

/**
 * Unregisters a custom font from memory and revokes any created Object URL.
 */
export function unregisterCustomFont(family: string): void {
	const lower = family.toLowerCase();
	const existing = customFonts.get(lower);
	if (existing?.url && typeof URL !== 'undefined') {
		try {
			URL.revokeObjectURL(existing.url);
		} catch {
			// ignore
		}
	}
	customFonts.delete(lower);
	loadedFonts.delete(family);
	failedFonts.delete(lower);
}

/**
 * Saves a custom font to IndexedDB and registers it with the FontFace API.
 */
export async function saveCustomFont(font: {
	family: string;
	displayName?: string;
	fileName: string;
	data: ArrayBuffer;
}): Promise<CustomFont> {
	const custom: CustomFont = {
		family: font.family,
		displayName: font.displayName || font.family,
		fileName: font.fileName,
		data: font.data,
		dateAdded: Date.now()
	};
	await registerCustomFont(custom);

	try {
		const db = await getCustomFontsDb();
		if (db) {
			await db.put(CUSTOM_FONTS_STORE, {
				family: custom.family,
				displayName: custom.displayName,
				fileName: custom.fileName,
				data: custom.data,
				dateAdded: custom.dateAdded
			});
		}
	} catch (err) {
		console.warn('Failed to persist custom font to IndexedDB:', err);
	}

	return custom;
}

/**
 * Loads all saved custom fonts from IndexedDB and registers them.
 */
export async function loadSavedCustomFonts(): Promise<CustomFont[]> {
	try {
		const db = await getCustomFontsDb();
		if (!db) return Array.from(customFonts.values());
		const records: CustomFontRecord[] = await db.getAll(CUSTOM_FONTS_STORE);
		const results: CustomFont[] = [];
		for (const rec of records) {
			const font: CustomFont = {
				family: rec.family,
				displayName: rec.displayName,
				fileName: rec.fileName,
				data: rec.data,
				dateAdded: rec.dateAdded
			};
			await registerCustomFont(font);
			results.push(font);
		}
		return results;
	} catch (err) {
		console.warn('Failed to load custom fonts from IndexedDB:', err);
		return Array.from(customFonts.values());
	}
}

/**
 * Deletes a custom font from IndexedDB and unregisters it.
 */
export async function deleteCustomFont(family: string): Promise<void> {
	unregisterCustomFont(family);
	try {
		const db = await getCustomFontsDb();
		if (db) {
			await db.delete(CUSTOM_FONTS_STORE, family);
		}
	} catch (err) {
		console.warn('Failed to delete custom font from IndexedDB:', err);
	}
}

/**
 * Ensures a font family is loaded via FontFace or document.fonts.
 * Works in Window and DedicatedWorker contexts where FontFace is available.
 */
export async function ensureFontLoaded(family: string, url?: string): Promise<boolean> {
	if (!family) return true;
	const clean = family.trim().replace(/^['"]|['"]$/g, '');
	const lower = clean.toLowerCase();

	if (SYSTEM_FALLBACK_FONTS.has(lower)) {
		loadedFonts.add(clean);
		return true;
	}
	if (loadedFonts.has(clean)) return true;
	if (failedFonts.has(lower)) return false;
	if (loadingPromises.has(clean)) return loadingPromises.get(clean)!;

	const loadPromise = (async () => {
		try {
			if (typeof FontFace === 'undefined') {
				loadedFonts.add(clean);
				return true;
			}

			// If font is bundled or custom url is given
			const fontInfo = BUNDLED_FONTS.find((f) => f.family.toLowerCase() === lower);
			let fontUrl = url || fontInfo?.url;

			// Map common PostScript font names / weights
			if (!fontUrl) {
				if (lower === 'kanit-blackitalic' || lower === 'kanit black italic') {
					fontUrl = '/fonts/Kanit-BlackItalic.ttf';
				} else if (lower === 'kanit-mediumitalic' || lower === 'kanit medium italic') {
					fontUrl = '/fonts/Kanit-MediumItalic.ttf';
				}
			}

			// Check custom fonts registry
			const custom = customFonts.get(lower);
			let fontSource: string | ArrayBuffer | undefined = fontUrl;
			if (!fontSource && custom) {
				fontSource = custom.data || (custom.url ? `url(${custom.url})` : undefined);
			}

			// If font is already available and loaded in document.fonts
			if (!fontSource && typeof document !== 'undefined' && document.fonts) {
				try {
					const isFaceLoaded = Array.from(document.fonts).some(
						(f) =>
							f.family.replace(/^['"]|['"]$/g, '').toLowerCase() === lower &&
							f.status === 'loaded'
					);
					if (isFaceLoaded) {
						loadedFonts.add(clean);
						notifyFontLoaded(clean);
						return true;
					}

					// If document fonts are actively loading stylesheets, wait briefly for document.fonts.ready
					if (document.fonts.status === 'loading') {
						await Promise.race([
							document.fonts.ready,
							new Promise((r) => setTimeout(r, 1500))
						]);
						const isLoadedAfterWait = Array.from(document.fonts).some(
							(f) =>
								f.family.replace(/^['"]|['"]$/g, '').toLowerCase() === lower &&
								f.status === 'loaded'
						);
						if (isLoadedAfterWait) {
							loadedFonts.add(clean);
							notifyFontLoaded(clean);
							return true;
						}
					}
				} catch {
					// Fall through to manual FontFace / URL loading
				}
			}
			if (!fontSource && custom) {
				fontSource = custom.data || (custom.url ? `url(${custom.url})` : undefined);
			}

			// If not in memory and DB is available, check DB
			if (!fontSource && typeof indexedDB !== 'undefined') {
				try {
					const db = await getCustomFontsDb();
					if (db) {
						const rec: CustomFontRecord | undefined = await db.get(CUSTOM_FONTS_STORE, clean);
						if (rec) {
							await registerCustomFont({
								family: rec.family,
								displayName: rec.displayName,
								fileName: rec.fileName,
								data: rec.data,
								dateAdded: rec.dateAdded
							});
							notifyFontLoaded(clean);
							return true;
						}
					}
				} catch {
					// ignore
				}
			}

			// If it's a web font (e.g. Google Font) not yet loaded, inject link tag and await load
			if (!fontSource && typeof document !== 'undefined') {
				try {
					const tagId = `tfve-font-${lower.replace(/[^a-z0-9]/g, '-')}`;
					if (!document.getElementById(tagId)) {
						const link = document.createElement('link');
						link.id = tagId;
						link.rel = 'stylesheet';
						link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(clean.replace(/ /g, '+'))}:ital,wght@0,300..900;1,300..900&display=swap`;
						document.head.appendChild(link);
					}

					const startWait = Date.now();
					while (Date.now() - startWait < 2500) {
						await new Promise((r) => setTimeout(r, 60));
						try {
							const list = await document.fonts.load(`16px "${clean}"`);
							if (list.length > 0 || document.fonts.check(`16px "${clean}"`)) {
								loadedFonts.add(clean);
								notifyFontLoaded(clean);
								return true;
							}
						} catch {
							// continue waiting
						}
					}
				} catch {
					// ignore
				}
			}

			if (!fontSource) {
				failedFonts.add(lower);
				return false;
			}

			interface WithFonts {
				fonts?: FontFaceSet;
			}
			const globalFonts =
				typeof document !== 'undefined' ? document.fonts : (self as unknown as WithFonts).fonts;

			const fontFace =
				typeof fontSource === 'string'
					? new FontFace(clean, fontSource.startsWith('url(') ? fontSource : `url(${fontSource})`)
					: new FontFace(clean, fontSource);
			const loadedFace = await fontFace.load();

			if (globalFonts) {
				globalFonts.add(loadedFace);

				// Load any defined font variants (e.g. weights, italics) into the same family
				if (fontInfo?.variants) {
					for (const variant of fontInfo.variants) {
						try {
							const variantFace = new FontFace(clean, `url(${variant.url})`, {
								weight: variant.weight,
								style: variant.style
							});
							const loadedVariant = await variantFace.load();
							globalFonts.add(loadedVariant);
						} catch {
							// continue if optional variant fails
						}
					}
				}
			}

			loadedFonts.add(clean);
			notifyFontLoaded(clean);
			return true;
		} catch {
			failedFonts.add(lower);
			return false;
		} finally {
			loadingPromises.delete(clean);
		}
	})();

	loadingPromises.set(clean, loadPromise);
	return loadPromise;
}

/**
 * Synchronous check whether font is already loaded.
 */
export function isFontLoaded(family: string): boolean {
	if (!family) return true;
	const clean = family.trim().replace(/^['"]|['"]$/g, '');
	const lower = clean.toLowerCase();

	if (SYSTEM_FALLBACK_FONTS.has(lower)) {
		return true;
	}
	if (loadedFonts.has(clean)) {
		return true;
	}
	if (typeof document !== 'undefined' && document.fonts?.check?.(`16px "${clean}"`)) {
		loadedFonts.add(clean);
		return true;
	}
	return false;
}

