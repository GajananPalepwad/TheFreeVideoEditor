import type { MotionGraphicTemplate } from './templateTypes';
import { deserializeTemplate, getCustomTemplates } from './templateService';

/**
 * The shipped `.grafree` files. The files are the source of truth, so the same read path
 * serves them and any template a user imports. `example.grafree` is a sample for template
 * authors and is not part of the library.
 */
const TEMPLATE_FILES = import.meta.glob(
	['../../../../public/templates/*.grafree', '!../../../../public/templates/example.grafree'],
	{ query: '?raw', import: 'default', eager: true }
) as Record<string, string>;

/**
 * Built-in Motion Graphic Templates (.grafree), in file-name order.
 */
export const BUILTIN_MOTION_TEMPLATES: MotionGraphicTemplate[] = Object.entries(TEMPLATE_FILES)
	.sort(([a], [b]) => a.localeCompare(b))
	.map(([path, text]) => {
		try {
			return deserializeTemplate(text);
		} catch (error) {
			throw new Error(`Built-in template ${path} is invalid: ${(error as Error).message}`, {
				cause: error
			});
		}
	});

const BUILTIN_MAP = new Map<string, MotionGraphicTemplate>();
for (const tpl of BUILTIN_MOTION_TEMPLATES) {
	BUILTIN_MAP.set(tpl.id, tpl);
}

/**
 * Returns a built-in Motion Graphic Template by ID.
 */
export function getBuiltinMotionTemplate(id: string): MotionGraphicTemplate | undefined {
	return BUILTIN_MAP.get(id);
}

/**
 * Resolves a template id against the built-in library, then the user's saved custom templates.
 * Returns undefined for an unknown id so callers never silently substitute a different template.
 */
export function resolveMotionTemplate(id: string): MotionGraphicTemplate | undefined {
	return BUILTIN_MAP.get(id) ?? getCustomTemplates().find((template) => template.id === id);
}

/**
 * Filters built-in templates by category and search query.
 */
export function filterBuiltinTemplates(
	category: string = 'all',
	searchQuery: string = ''
): MotionGraphicTemplate[] {
	const query = searchQuery.toLowerCase().trim();
	const catLower = category.toLowerCase();

	return BUILTIN_MOTION_TEMPLATES.filter((tpl) => {
		if (catLower !== 'all') {
			const tplCat = tpl.category.toLowerCase();
			if (catLower === 'titles' && tplCat !== 'titles') return false;
			if (catLower === 'lower-third' || catLower === 'lower thirds') {
				if (tplCat !== 'lower thirds') return false;
			} else if (catLower === 'badge' || catLower === 'badges') {
				if (tplCat !== 'badges') return false;
			} else if (catLower === 'kinetic' && tplCat !== 'kinetic') return false;
			else if (catLower === 'callouts' && tplCat !== 'callouts') return false;
			else if (catLower === 'social' && tplCat !== 'social') return false;
			else if (tplCat !== catLower) return false;
		}

		if (!query) return true;

		return (
			tpl.name.toLowerCase().includes(query) ||
			(tpl.description && tpl.description.toLowerCase().includes(query)) ||
			tpl.publishedParams.some(
				(p) => typeof p.defaultValue === 'string' && p.defaultValue.toLowerCase().includes(query)
			)
		);
	});
}

/**
 * The category ids that should get a tab: "all" and every category at least one built-in template
 * belongs to, so the tab strip never shows a category that is always empty.
 */
export function populatedCategoryIds(categoryIds: readonly string[]): string[] {
	return categoryIds.filter((id) => id === 'all' || filterBuiltinTemplates(id).length > 0);
}
