import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	submitFeedback,
	FEEDBACK_CATEGORIES,
	FEEDBACK_ENDPOINT,
	type FeedbackCategory,
	type FeedbackPayload,
	type FeedbackResponse
} from './feedback';
import { getSessionId, _resetSessionForTest } from './activityTracking';

describe('feedback service', () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		_resetSessionForTest();
		vi.restoreAllMocks();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	describe('FEEDBACK_CATEGORIES', () => {
		it('contains all 7 required categories with labels and descriptions', () => {
			const expectedCategories: { id: FeedbackCategory; description: string }[] = [
				{ id: 'general', description: 'Overall experience' },
				{ id: 'bug', description: 'Report bugs' },
				{ id: 'feature_request', description: 'Suggest new features' },
				{ id: 'ui_ux', description: 'Interface improvements' },
				{ id: 'performance', description: 'Speed and performance' },
				{ id: 'export', description: 'Export-related feedback' },
				{ id: 'other', description: 'Anything else' }
			];

			expect(FEEDBACK_CATEGORIES.length).toBe(7);
			for (const expected of expectedCategories) {
				const found = FEEDBACK_CATEGORIES.find((c) => c.id === expected.id);
				expect(found).toBeDefined();
				expect(found?.description).toBe(expected.description);
			}
		});
	});

	describe('submitFeedback', () => {
		it('submits valid feedback payload with defaults and parses success response', async () => {
			const mockResponse: FeedbackResponse = {
				success: true,
				message: 'Thank you for your feedback!',
				id: 123
			};

			let capturedUrl = '';
			let capturedOptions: RequestInit | undefined;

			globalThis.fetch = vi.fn().mockImplementation(async (url, options) => {
				capturedUrl = String(url);
				capturedOptions = options;
				return {
					ok: true,
					json: async () => mockResponse
				};
			});

			const result = await submitFeedback({
				category: 'feature_request',
				rating: 5,
				message: 'Please add support for custom video transitions.',
				page: '/editor'
			});

			expect(capturedUrl).toBe(FEEDBACK_ENDPOINT);
			expect(capturedOptions?.method).toBe('POST');
			expect(capturedOptions?.headers).toEqual({
				'Content-Type': 'application/json'
			});

			const body = JSON.parse(String(capturedOptions?.body)) as FeedbackPayload;
			expect(body.category).toBe('feature_request');
			expect(body.rating).toBe(5);
			expect(body.message).toBe('Please add support for custom video transitions.');
			expect(body.page).toBe('/editor');
			expect(body.session_id).toBe(getSessionId());

			expect(result.success).toBe(true);
			expect(result.message).toBe('Thank you for your feedback!');
			expect(result.id).toBe(123);
		});

		it('uses explicitly provided session_id when given', async () => {
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({ success: true, message: 'Thank you for your feedback!', id: 1 })
			});

			await submitFeedback({
				session_id: 'session_custom456',
				category: 'export',
				rating: 4,
				message: 'Export was fast!',
				page: '/editor'
			});

			const call = vi.mocked(globalThis.fetch).mock.calls[0];
			const payload = JSON.parse(String(call?.[1]?.body)) as FeedbackPayload;
			expect(payload.session_id).toBe('session_custom456');
		});

		it('allows submitting rating with empty message (empty review out of 5)', async () => {
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({ success: true, message: 'Thank you for your feedback!', id: 2 })
			});

			const result = await submitFeedback({
				category: 'general',
				rating: 5,
				message: ''
			});

			const call = vi.mocked(globalThis.fetch).mock.calls[0];
			const payload = JSON.parse(String(call?.[1]?.body)) as FeedbackPayload;
			expect(payload.rating).toBe(5);
			expect(payload.message).toBe('');
			expect(result.success).toBe(true);
		});

		it('allows submitting message with unselected rating (defaults rating to 5 for backend)', async () => {
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({ success: true, message: 'Thank you for your feedback!', id: 3 })
			});

			const result = await submitFeedback({
				category: 'bug',
				rating: 0,
				message: 'Found an audio timeline bug'
			});

			const call = vi.mocked(globalThis.fetch).mock.calls[0];
			const payload = JSON.parse(String(call?.[1]?.body)) as FeedbackPayload;
			expect(payload.rating).toBe(5);
			expect(payload.message).toBe('Found an audio timeline bug');
			expect(result.success).toBe(true);
		});

		it('rejects when both rating and message are empty', async () => {
			globalThis.fetch = vi.fn();

			await expect(
				submitFeedback({
					category: 'ui_ux',
					rating: 0,
					message: '   '
				})
			).rejects.toThrow('Please provide a rating or a feedback message');

			expect(globalThis.fetch).not.toHaveBeenCalled();
		});

		it('validates rating is not greater than 5', async () => {
			globalThis.fetch = vi.fn();

			await expect(
				submitFeedback({
					category: 'bug',
					rating: 6,
					message: 'Broken button'
				})
			).rejects.toThrow('Rating must be an integer between 1 and 5');

			expect(globalThis.fetch).not.toHaveBeenCalled();
		});

		it('handles API error responses cleanly', async () => {
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: false,
				status: 400,
				json: async () => ({ success: false, message: 'Invalid session ID' })
			});

			await expect(
				submitFeedback({
					category: 'general',
					rating: 3,
					message: 'Average experience'
				})
			).rejects.toThrow('Invalid session ID');
		});

		it('handles network failure gracefully', async () => {
			globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

			await expect(
				submitFeedback({
					category: 'performance',
					rating: 2,
					message: 'Timeline lag on 4K'
				})
			).rejects.toThrow('Network error');
		});
	});
});
