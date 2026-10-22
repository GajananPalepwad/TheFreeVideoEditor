import type { EffectInstance } from '../../core/types';
import { openProjectDatabase } from './projectDb';

export interface EffectPreset {
	id: string;
	name: string;
	builtIn: boolean;
	effect: {
		type: string;
		params: Record<string, unknown>;
	};
}

export const BUILT_IN_PRESETS: EffectPreset[] = [
	{
		id: 'preset:lut-35mm-portrait',
		name: 'LUT · 35mm Portrait',
		builtIn: true,
		effect: {
			type: 'lut3d',
			params: {
				lutAssetId: 'builtin:35mm-portrait',
				intensity: 1,
				mix: 1
			}
		}
	},
	{
		id: 'preset:lut-classic-chrome',
		name: 'LUT · Classic Chrome',
		builtIn: true,
		effect: {
			type: 'lut3d',
			params: {
				lutAssetId: 'builtin:classic-chrome',
				intensity: 1,
				mix: 1
			}
		}
	},
	{
		id: 'preset:lut-filmic',
		name: 'LUT · Filmic',
		builtIn: true,
		effect: {
			type: 'lut3d',
			params: {
				lutAssetId: 'builtin:filmic',
				intensity: 1,
				mix: 1
			}
		}
	},
	{
		id: 'preset:lut-moody-film',
		name: 'LUT · Moody Film',
		builtIn: true,
		effect: {
			type: 'lut3d',
			params: {
				lutAssetId: 'builtin:moody-film',
				intensity: 1,
				mix: 1
			}
		}
	},
	{
		id: 'preset:lut-moody-stock',
		name: 'LUT · Moody Stock',
		builtIn: true,
		effect: {
			type: 'lut3d',
			params: {
				lutAssetId: 'builtin:moody-stock',
				intensity: 1,
				mix: 1
			}
		}
	},
	{
		id: 'preset:lut-sunset',
		name: 'LUT · Sunset',
		builtIn: true,
		effect: {
			type: 'lut3d',
			params: {
				lutAssetId: 'builtin:sunset',
				intensity: 1,
				mix: 1
			}
		}
	},
	{
		id: 'preset:lut-twilight',
		name: 'LUT · Twilight',
		builtIn: true,
		effect: {
			type: 'lut3d',
			params: {
				lutAssetId: 'builtin:twilight',
				intensity: 1,
				mix: 1
			}
		}
	},
	{
		id: 'preset:warm-cinematic',
		name: 'Warm Cinematic',
		builtIn: true,
		effect: {
			type: 'colorCorrection',
			params: {
				temperature: 0.25,
				contrast: 0.15,
				exposure: 0.1,
				saturation: 0.1,
				mix: 1
			}
		}
	},
	{
		id: 'preset:cool-bleach',
		name: 'Cool Bleach',
		builtIn: true,
		effect: {
			type: 'colorCorrection',
			params: {
				temperature: -0.2,
				contrast: 0.3,
				saturation: -0.35,
				mix: 1
			}
		}
	},
	{
		id: 'preset:pop-colors',
		name: 'Pop Colors',
		builtIn: true,
		effect: {
			type: 'colorCorrection',
			params: {
				vibrance: 0.4,
				contrast: 0.1,
				saturation: 0.2,
				mix: 1
			}
		}
	},
	{
		id: 'preset:vintage-film',
		name: 'Vintage Film Grain',
		builtIn: true,
		effect: {
			type: 'filmGrain',
			params: {
				amount: 0.45,
				speed: 1.5,
				mix: 1
			}
		}
	},
	{
		id: 'preset:subtle-sharpen',
		name: 'Subtle Sharpen',
		builtIn: true,
		effect: {
			type: 'sharpen',
			params: {
				amount: 25,
				radius: 1,
				mix: 1
			}
		}
	},
	{
		id: 'preset:heavy-vignette',
		name: 'Heavy Vignette',
		builtIn: true,
		effect: {
			type: 'vignette',
			params: {
				amount: 0.65,
				radius: 0.7,
				softness: 0.4,
				mix: 1
			}
		}
	},
	{
		id: 'preset:dream-glow',
		name: 'Dream Glow',
		builtIn: true,
		effect: {
			type: 'glow',
			params: {
				threshold: 0.6,
				radius: 18,
				intensity: 1.2,
				mix: 1
			}
		}
	},
	{
		id: 'preset:cyberpunk-glitch',
		name: 'Cyberpunk RGB Glitch',
		builtIn: true,
		effect: {
			type: 'rgbSplit',
			params: {
				amount: 18,
				angle: 45,
				mix: 1
			}
		}
	},
	{
		id: 'preset:retro-vhs',
		name: 'Retro VHS Scanlines',
		builtIn: true,
		effect: {
			type: 'scanlines',
			params: {
				count: 360,
				intensity: 0.45,
				speed: 1.2,
				mix: 1
			}
		}
	},
	{
		id: 'preset:action-zoom',
		name: 'Action Impact Zoom',
		builtIn: true,
		effect: {
			type: 'zoomBlur',
			params: {
				strength: 0.35,
				center: [0.5, 0.5],
				mix: 1
			}
		}
	},
	{
		id: 'preset:neon-cyan',
		name: 'Neon Cyan Outline',
		builtIn: true,
		effect: {
			type: 'neonEdges',
			params: {
				color: [0, 0.9, 1],
				threshold: 0.12,
				brightness: 2.5,
				mix: 1
			}
		}
	},
	{
		id: 'preset:sunset-duotone',
		name: 'Sunset Duotone',
		builtIn: true,
		effect: {
			type: 'duotone',
			params: {
				shadowColor: [0.15, 0.05, 0.25],
				highlightColor: [1, 0.8, 0.4],
				contrast: 0.2,
				mix: 1
			}
		}
	},
	{
		id: 'preset:water-ripples',
		name: 'Underwater Waves',
		builtIn: true,
		effect: {
			type: 'waveDistort',
			params: {
				amplitude: 20,
				frequency: 25,
				speed: 2,
				mix: 1
			}
		}
	},
	{
		id: 'preset:warm-sepia',
		name: 'Warm Nostalgia Sepia',
		builtIn: true,
		effect: {
			type: 'sepia',
			params: {
				amount: 0.85,
				mix: 1
			}
		}
	}
];

const PRESETS_META_KEY = 'user_effect_presets';

export async function listUserPresets(): Promise<EffectPreset[]> {
	try {
		const db = await openProjectDatabase();
		const record = await db.get('meta', PRESETS_META_KEY);
		if (record && Array.isArray(record.value)) {
			return record.value as EffectPreset[];
		}
	} catch (e) {
		console.warn('Could not load user presets from database:', e);
	}
	return [];
}

export async function saveUserPreset(name: string, effect: EffectInstance): Promise<EffectPreset> {
	const params: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(effect.params)) {
		params[k] = structuredClone(v);
	}

	const newPreset: EffectPreset = {
		id: `user:${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
		name: name.trim(),
		builtIn: false,
		effect: {
			type: effect.type,
			params
		}
	};

	try {
		const db = await openProjectDatabase();
		const existing = await listUserPresets();
		existing.push(newPreset);
		await db.put('meta', { key: PRESETS_META_KEY, value: existing });
	} catch (e) {
		console.warn('Could not save user preset to database:', e);
	}

	return newPreset;
}

export async function deleteUserPreset(id: string): Promise<void> {
	try {
		const db = await openProjectDatabase();
		const existing = await listUserPresets();
		const filtered = existing.filter((p) => p.id !== id);
		await db.put('meta', { key: PRESETS_META_KEY, value: filtered });
	} catch (e) {
		console.warn('Could not delete user preset:', e);
	}
}
