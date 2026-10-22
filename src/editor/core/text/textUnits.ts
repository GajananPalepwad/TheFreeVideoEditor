import { getGraphemes } from './layout';

/** The span of one unit in a line of text, in the line's own code unit indices. */
export interface TextUnit {
	start: number;
	end: number;
}

export type TextUnitKind = 'char' | 'word' | 'line';

/**
 * The characters, words or whole line of `text` that text animation moves on their own. Spaces are
 * not units: they draw nothing, so they do not take a turn in the stagger.
 */
export function textUnits(text: string, kind: TextUnitKind): TextUnit[] {
	if (kind === 'line') {
		const trimmed = text.trim();
		if (trimmed.length === 0) return [];
		const start = text.indexOf(trimmed);
		return [{ start, end: start + trimmed.length }];
	}
	if (kind === 'word') {
		return [...text.matchAll(/\S+/g)].map((match) => ({
			start: match.index!,
			end: match.index! + match[0].length
		}));
	}
	const units: TextUnit[] = [];
	let offset = 0;
	for (const grapheme of getGraphemes(text)) {
		if (grapheme.trim().length > 0) units.push({ start: offset, end: offset + grapheme.length });
		offset += grapheme.length;
	}
	return units;
}

export interface ChunkUnit extends TextUnit {
	/** Place of the unit in the list the chunk was cut from. */
	index: number;
}

/** The part of each unit that lies inside `[chunkStart, chunkEnd)`, for drawing a piece of a line. */
export function chunkUnits(units: TextUnit[], chunkStart: number, chunkEnd: number): ChunkUnit[] {
	const inside: ChunkUnit[] = [];
	units.forEach((unit, index) => {
		const start = Math.max(unit.start, chunkStart);
		const end = Math.min(unit.end, chunkEnd);
		if (start < end) inside.push({ index, start, end });
	});
	return inside;
}
