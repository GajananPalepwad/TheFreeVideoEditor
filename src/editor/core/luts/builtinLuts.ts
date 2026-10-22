export interface BuiltinLut {
	readonly id: string;
	readonly name: string;
	readonly category: string;
	readonly description: string;
	readonly filename: string;
	readonly size: number;
	readonly url: string;
}

export const BUILTIN_LUTS: readonly BuiltinLut[] = [
	{
		id: 'builtin:35mm-portrait',
		name: '35mm Portrait',
		category: 'Portrait & Skin',
		description: 'Warm analog 35mm film emulation with flattering skin tones and gentle shadow rolloff.',
		filename: 'Presetpro - 35mm Portrait.cube',
		size: 32,
		url: '/luts/Presetpro - 35mm Portrait.cube'
	},
	{
		id: 'builtin:classic-chrome',
		name: 'Classic Chrome',
		category: 'Street & Documentary',
		description: 'Subtle saturation with deep, rich contrast reminiscent of classic slide film.',
		filename: 'Presetpro - Classic Chrome.cube',
		size: 32,
		url: '/luts/Presetpro - Classic Chrome.cube'
	},
	{
		id: 'builtin:filmic',
		name: 'Filmic',
		category: 'Cinematic',
		description: 'Hollywood cinema look with broad dynamic range and gentle highlight compression.',
		filename: 'Presetpro - Filmic.cube',
		size: 64,
		url: '/luts/Presetpro - Filmic.cube'
	},
	{
		id: 'builtin:moody-film',
		name: 'Moody Film',
		category: 'Moody & Indie',
		description: 'Atmospheric lifted blacks and cool shadow tones for an evocative indie film aesthetic.',
		filename: 'Presetpro - Moody Film.cube',
		size: 32,
		url: '/luts/Presetpro - Moody Film.cube'
	},
	{
		id: 'builtin:moody-stock',
		name: 'Moody Stock',
		category: 'Moody & Vintage',
		description: 'High-contrast vintage film stock with rich greens and moody ambient shadow tones.',
		filename: 'Presetpro - Moody Stock.cube',
		size: 32,
		url: '/luts/Presetpro - Moody Stock.cube'
	},
	{
		id: 'builtin:sunset',
		name: 'Sunset',
		category: 'Golden Hour & Warmth',
		description: 'Golden hour warmth with rich amber highlights and glowing evening atmosphere.',
		filename: 'Presetpro - Sunset.cube',
		size: 32,
		url: '/luts/Presetpro - Sunset.cube'
	},
	{
		id: 'builtin:twilight',
		name: 'Twilight',
		category: 'Night & Blue Hour',
		description: 'Deep indigo blue-hour midtones with magenta dusk highlights for cinematic night scenes.',
		filename: 'Presetpro - Twilight.cube',
		size: 64,
		url: '/luts/Presetpro - Twilight.cube'
	}
] as const;

export function findBuiltinLut(idOrName?: string | null): BuiltinLut | undefined {
	if (!idOrName) return undefined;
	const lower = idOrName.toLowerCase().trim();
	return BUILTIN_LUTS.find((lut) => {
		if (lut.id.toLowerCase() === lower) return true;
		if (lut.name.toLowerCase() === lower) return true;
		if (lut.filename.toLowerCase() === lower) return true;
		if (lut.id.replace('builtin:', '').toLowerCase() === lower) return true;
		if (lut.name.replace(/\s+/g, '-').toLowerCase() === lower) return true;
		if (lut.filename.replace(/\.cube$/i, '').toLowerCase() === lower) return true;
		return false;
	});
}

export function isBuiltinLutId(idOrName?: string | null): boolean {
	if (!idOrName) return false;
	return Boolean(findBuiltinLut(idOrName));
}
