import { z } from 'zod';
import { timeSchema, trackSchema } from '../schema';
import type { PublishedTemplateParam } from './templateTypes';

/** The `.tfvetemplate` format version this editor reads and writes. */
export const TEMPLATE_FORMAT_VERSION = 1;

/** The `tfve_type` marker written into every template file. */
export const TEMPLATE_FILE_TYPE = 'motion_template';

const publishedParamSchema = z.object({
	id: z.string().min(1),
	name: z.string(),
	type: z.enum(['text', 'color', 'font', 'number']),
	targetClipId: z.string().min(1),
	targetProperty: z.enum([
		'text.content',
		'text.fontFamily',
		'text.fontSize',
		'text.fill',
		'text.stroke',
		'text.accentBarColor',
		'shape.fill',
		'shape.stroke',
		'shape.gradient',
		'solid.color',
		'transform.scale',
		'transform.opacity'
	]),
	defaultValue: z.unknown(),
	min: z.number().optional(),
	max: z.number().optional(),
	step: z.number().optional()
}) as unknown as z.ZodType<PublishedTemplateParam>;

/**
 * Shape of a `.tfvetemplate` file. Tracks reuse the project's own track schema so a template can
 * never hold anything a project could not. Unknown top-level fields are kept, not stripped.
 */
export const templateSchema = z.looseObject({
	$schema: z.string().optional(),
	tfve_type: z.string().optional(),
	version: z.number().optional(),
	id: z.string().min(1).optional(),
	name: z.string({ error: 'Template name is required.' }),
	category: z.string().optional(),
	description: z.string().optional(),
	author: z.string().optional(),
	createdAt: z.number().optional(),
	duration: timeSchema.positive(),
	responsiveTiming: z
		.object({ introDuration: timeSchema.nonnegative(), outroDuration: timeSchema.nonnegative() })
		.optional(),
	bounds: z
		.object({
			width: z.number().positive(),
			height: z.number().positive(),
			originX: z.number(),
			originY: z.number()
		})
		.optional(),
	tracks: z.array(trackSchema),
	publishedParams: z.array(publishedParamSchema).optional(),
	previewThumbnail: z.string().optional(),
	resources: z
		.object({
			fonts: z
				.array(z.object({ family: z.string().min(1), fileName: z.string().min(1), data: z.string() }))
				.optional(),
			assets: z
				.array(
					z.object({
						id: z.string().min(1),
						name: z.string(),
						mimeType: z.string(),
						data: z.string()
					})
				)
				.optional()
		})
		.optional()
});

export type TemplateFile = z.infer<typeof templateSchema>;

/** One line per problem, with the path to the offending field. */
export function describeTemplateIssues(error: z.ZodError): string {
	return error.issues
		.slice(0, 5)
		.map(
			(issue) => `${issue.path.length > 0 ? issue.path.join('.') : 'template'}: ${issue.message}`
		)
		.join('; ');
}
