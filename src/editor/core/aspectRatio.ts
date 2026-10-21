export interface AspectRatioPreset {
	id: string;
	label: string;
	width: number;
	height: number;
	aspectRatio: string;
}

export const ASPECT_RATIO_PRESETS: readonly AspectRatioPreset[] = [
	{
		id: '16:9-1080p',
		label: '16:9 Landscape (1920×1080)',
		width: 1920,
		height: 1080,
		aspectRatio: '16:9'
	},
	{
		id: '16:9-4k',
		label: '16:9 Landscape (3840×2160)',
		width: 3840,
		height: 2160,
		aspectRatio: '16:9'
	},
	{
		id: '9:16',
		label: '9:16 Vertical (1080×1920)',
		width: 1080,
		height: 1920,
		aspectRatio: '9:16'
	},
	{
		id: '1:1',
		label: '1:1 Square (1080×1080)',
		width: 1080,
		height: 1080,
		aspectRatio: '1:1'
	},
	{
		id: '4:5',
		label: '4:5 Social Portrait (1080×1350)',
		width: 1080,
		height: 1350,
		aspectRatio: '4:5'
	},
	{
		id: '21:9',
		label: '21:9 Ultrawide Cinema (2560×1080)',
		width: 2560,
		height: 1080,
		aspectRatio: '21:9'
	}
] as const;

export function findMatchingPreset(width: number, height: number): AspectRatioPreset | undefined {
	return ASPECT_RATIO_PRESETS.find((p) => p.width === width && p.height === height);
}

