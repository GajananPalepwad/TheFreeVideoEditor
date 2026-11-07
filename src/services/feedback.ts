/**
 * Service for collecting user feedback and submitting it to the feedback API.
 */

import { getSessionId } from './activityTracking';

export const FEEDBACK_ENDPOINT = 'https://sggsapp.co.in/video_editor/submit_feedback.php';

export type FeedbackCategory =
	'general' | 'bug' | 'feature_request' | 'ui_ux' | 'performance' | 'export' | 'other';

export interface FeedbackCategoryOption {
	id: FeedbackCategory;
	label: string;
	description: string;
}

export const FEEDBACK_CATEGORIES: readonly FeedbackCategoryOption[] = [
	{ id: 'general', label: 'General', description: 'Overall experience' },
	{ id: 'bug', label: 'Bug Report', description: 'Report bugs' },
	{ id: 'feature_request', label: 'Feature Request', description: 'Suggest new features' },
	{ id: 'ui_ux', label: 'UI / UX', description: 'Interface improvements' },
	{ id: 'performance', label: 'Performance', description: 'Speed and performance' },
	{ id: 'export', label: 'Export', description: 'Export-related feedback' },
	{ id: 'other', label: 'Other', description: 'Anything else' }
] as const;

export interface FeedbackPayload {
	session_id: string;
	category: FeedbackCategory;
	rating: number;
	message: string;
	page: string;
}

export interface FeedbackResponse {
	success: boolean;
	message: string;
	id?: number;
}

export class FeedbackError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'FeedbackError';
	}
}

export interface SubmitFeedbackInput {
	category: FeedbackCategory;
	rating?: number;
	message?: string;
	page?: string;
	session_id?: string;
}

/**
 * Submits feedback to the remote feedback endpoint.
 * Allows sending a rating without a text review ("empty review out of 5"),
 * or a text review without selecting a rating (defaults to 5 for the backend).
 */
export async function submitFeedback(input: SubmitFeedbackInput): Promise<FeedbackResponse> {
	const trimmedMessage = (input.message ?? '').trim();
	const rawRating = typeof input.rating === 'number' ? Math.round(input.rating) : 0;

	// Require at least a rating or a feedback message
	if (rawRating === 0 && !trimmedMessage) {
		throw new FeedbackError('Please provide a rating or a feedback message');
	}

	// If rating was left empty (0) but a message was written, default rating to 5 for the backend
	const rating = rawRating > 0 ? rawRating : 5;
	if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
		throw new FeedbackError('Rating must be an integer between 1 and 5');
	}

	const category = input.category;
	const isValidCategory = FEEDBACK_CATEGORIES.some((c) => c.id === category);
	if (!isValidCategory) {
		throw new FeedbackError(`Invalid category: ${category}`);
	}

	const page =
		input.page ||
		(typeof window !== 'undefined' && window.location?.pathname ? window.location.pathname : '/');

	const sessionId = input.session_id || getSessionId();

	const payload: FeedbackPayload = {
		session_id: sessionId,
		category,
		rating,
		message: trimmedMessage,
		page
	};

	let res: Response;
	try {
		res = await fetch(FEEDBACK_ENDPOINT, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(payload)
		});
	} catch (error) {
		throw new FeedbackError(
			error instanceof Error ? error.message : 'Network error submitting feedback',
			{
				cause: error
			}
		);
	}

	let data: unknown;
	try {
		data = await res.json();
	} catch (error) {
		throw new FeedbackError('Failed to parse response from feedback server', { cause: error });
	}

	if (
		typeof data === 'object' &&
		data !== null &&
		'success' in data &&
		(data as { success: unknown }).success === true
	) {
		const result = data as FeedbackResponse;
		return {
			success: true,
			message: typeof result.message === 'string' ? result.message : 'Thank you for your feedback!',
			id: typeof result.id === 'number' ? result.id : undefined
		};
	}

	const errorMessage =
		typeof data === 'object' &&
		data !== null &&
		'message' in data &&
		typeof (data as { message: unknown }).message === 'string'
			? (data as { message: string }).message
			: 'Feedback submission failed';

	throw new FeedbackError(errorMessage);
}
