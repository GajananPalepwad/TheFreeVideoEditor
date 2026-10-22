import type {
	Clip,
	PublishedPropertyType,
	PublishedTemplateParam,
	Time,
	Track
} from '../types';

export { type PublishedPropertyType, type PublishedTemplateParam };

export type TemplateCategory =
	| 'Titles'
	| 'Lower Thirds'
	| 'Callouts'
	| 'Social'
	| 'Transitions'
	| 'Kinetic'
	| 'Badges'
	| 'Custom';

export interface ClipsBoundingBox {
	width: number;
	height: number;
	originX: number;
	originY: number;
}

/** Fonts and media a template file carries so it renders the same on another machine. */
export interface TemplateResources {
	fonts?: Array<{ family: string; fileName: string; /** Base64 of the font file. */ data: string }>;
	assets?: Array<{ id: string; name: string; mimeType: string; /** Base64 of the media file. */ data: string }>;
}

export interface MotionGraphicTemplate {
	version: 1;
	id: string;
	name: string;
	category: TemplateCategory;
	description?: string;
	author?: string;
	createdAt?: number;
	duration: Time; // in microseconds
	responsiveTiming?: {
		introDuration: Time;
		outroDuration: Time;
	};
	bounds?: ClipsBoundingBox;
	tracks: Track[];
	publishedParams: PublishedTemplateParam[];
	previewThumbnail?: string;
	resources?: TemplateResources;
}

export function isMotionTemplateClip(clip: Clip | null | undefined): boolean {
	if (!clip || clip.source?.type !== 'sequence') return false;
	return Boolean(clip.source.templateId || clip.source.publishedParams?.length);
}

export function getClipPublishedParams(clip: Clip | null | undefined): PublishedTemplateParam[] {
	if (!clip || clip.source?.type !== 'sequence') return [];
	return clip.source.publishedParams ?? [];
}

export function getClipParamOverrides(clip: Clip | null | undefined): Record<string, any> {
	if (!clip || clip.source?.type !== 'sequence') return {};
	return clip.source.paramOverrides ?? {};
}
