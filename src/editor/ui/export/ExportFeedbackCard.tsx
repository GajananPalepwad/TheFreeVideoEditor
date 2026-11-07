import { useState } from 'react';
import {
	submitFeedback,
	FEEDBACK_CATEGORIES,
	type FeedbackCategory
} from '../../../services/feedback';
import './export-complete-dialog.css';

const RATING_LABELS: Record<number, string> = {
	1: 'Needs Work',
	2: 'Fair',
	3: 'Good',
	4: 'Very Good',
	5: 'Excellent'
};

function renderCategoryIcon(category: FeedbackCategory) {
	switch (category) {
		case 'export':
			return (
				<svg
					width="13"
					height="13"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden="true"
				>
					<rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
					<line x1="7" y1="2" x2="7" y2="22" />
					<line x1="17" y1="2" x2="17" y2="22" />
					<line x1="2" y1="12" x2="22" y2="12" />
				</svg>
			);
		case 'bug':
			return (
				<svg
					width="13"
					height="13"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden="true"
				>
					<rect width="8" height="14" x="8" y="6" rx="4" />
					<path d="m19 7-3 2" />
					<path d="m5 7 3 2" />
					<path d="m19 19-3-2" />
					<path d="m5 19 3-2" />
					<path d="M20 13h-4" />
					<path d="M4 13h4" />
					<path d="m10 4 1 2" />
					<path d="m14 4-1 2" />
				</svg>
			);
		case 'feature_request':
			return (
				<svg
					width="13"
					height="13"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden="true"
				>
					<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" />
					<path d="M9 18h6" />
					<path d="M10 22h4" />
				</svg>
			);
		case 'ui_ux':
			return (
				<svg
					width="13"
					height="13"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden="true"
				>
					<rect x="3" y="3" width="18" height="18" rx="2" />
					<path d="M3 9h18" />
					<path d="M9 21V9" />
				</svg>
			);
		case 'performance':
			return (
				<svg
					width="13"
					height="13"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden="true"
				>
					<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
				</svg>
			);
		case 'general':
			return (
				<svg
					width="13"
					height="13"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden="true"
				>
					<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
				</svg>
			);
		case 'other':
			return (
				<svg
					width="13"
					height="13"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden="true"
				>
					<path d="M12 20h9" />
					<path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
				</svg>
			);
	}
}

export interface ExportFeedbackCardProps {
	title?: string;
	subtitle?: string;
	defaultCategory?: FeedbackCategory;
	page?: string;
	onClose?: () => void;
	onSubmitted?: () => void;
}

/**
 * Reusable feedback card component.
 * Uses interactive toggle chips for categories and starts with empty stars.
 * Allows sending an empty review out of 5 (message is optional when rated).
 */
export function ExportFeedbackCard({
	title = 'Rate your export experience',
	subtitle = 'How was the export speed and output video quality?',
	defaultCategory = 'export',
	page = '/editor',
	onClose,
	onSubmitted
}: ExportFeedbackCardProps = {}) {
	// Stars start EMPTY at the beginning (0)
	const [rating, setRating] = useState<number>(0);
	const [hoverRating, setHoverRating] = useState<number | null>(null);
	const [category, setCategory] = useState<FeedbackCategory>(defaultCategory);
	const [message, setMessage] = useState<string>('');
	const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
	const [isSubmitted, setIsSubmitted] = useState<boolean>(false);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);

	const activeRating = hoverRating ?? rating;
	const canSubmit = !isSubmitting && (rating > 0 || message.trim().length > 0);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (isSubmitting) return;

		const trimmed = message.trim();
		if (rating === 0 && !trimmed) {
			setErrorMessage('Please select a star rating or write a message');
			return;
		}

		setIsSubmitting(true);
		setErrorMessage(null);

		try {
			await submitFeedback({
				category,
				rating,
				message: trimmed,
				page
			});
			setIsSubmitted(true);
			onSubmitted?.();
		} catch (err) {
			setErrorMessage(
				err instanceof Error ? err.message : 'Failed to send feedback. Please try again.'
			);
		} finally {
			setIsSubmitting(false);
		}
	};

	if (isSubmitted) {
		return (
			<div className="export-complete-feedback-card export-feedback-submitted" role="status">
				<div className="export-feedback-success-badge" aria-hidden="true">
					<svg viewBox="0 0 20 20" width="22" height="22" fill="currentColor">
						<path
							fillRule="evenodd"
							d="M16.707 5.293a1 1 0 0 1 0 1.414l-8 8a1 1 0 0 1-1.414 0l-4-4a1 1 0 0 1 1.414-1.414L8 12.586l7.293-7.293a1 1 0 0 1 1.414 0z"
							clipRule="evenodd"
						/>
					</svg>
				</div>
				<div className="export-feedback-success-text">
					<span className="export-feedback-success-title">Thank you for your feedback!</span>
					<span className="export-feedback-success-desc">
						Your feedback directly helps shape and improve The Free Video Editor.
					</span>
				</div>
				{onClose && (
					<button type="button" className="export-feedback-done-btn" onClick={onClose}>
						Done
					</button>
				)}
			</div>
		);
	}

	return (
		<form className="export-complete-feedback-card" onSubmit={handleSubmit}>
			{/* Header with Title and Rating */}
			<div className="export-feedback-header">
				<div className="export-feedback-title-group">
					<div className="export-feedback-title-row">
						<span className="export-feedback-title">{title}</span>
						<span className={`export-feedback-rating-hint ${activeRating === 0 ? 'is-empty' : ''}`}>
							{activeRating > 0
								? `${activeRating} · ${RATING_LABELS[activeRating]}`
								: 'Tap to rate'}
						</span>
					</div>
					<span className="export-feedback-subtitle">{subtitle}</span>
				</div>

				{/* Stars start empty at beginning */}
				<div
					className="export-feedback-stars"
					role="radiogroup"
					aria-label="Rating from 1 to 5 stars"
				>
					{[1, 2, 3, 4, 5].map((star) => {
						const isFilled = star <= activeRating;
						return (
							<button
								key={star}
								type="button"
								data-star={star}
								className={`export-feedback-star-btn ${isFilled ? 'is-active' : 'is-empty'}`}
								onClick={() => {
									setRating(star);
									setErrorMessage(null);
								}}
								onMouseEnter={() => setHoverRating(star)}
								onMouseLeave={() => setHoverRating(null)}
								aria-label={`${star} star${star > 1 ? 's' : ''}`}
								aria-checked={star === rating}
								role="radio"
							>
								{isFilled ? (
									<svg
										viewBox="0 0 24 24"
										width="24"
										height="24"
										fill="currentColor"
										stroke="currentColor"
										strokeWidth="1.5"
										strokeLinecap="round"
										strokeLinejoin="round"
										aria-hidden="true"
									>
										<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
									</svg>
								) : (
									<svg
										viewBox="0 0 24 24"
										width="24"
										height="24"
										fill="none"
										stroke="currentColor"
										strokeWidth="1.6"
										strokeLinecap="round"
										strokeLinejoin="round"
										aria-hidden="true"
									>
										<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
									</svg>
								)}
							</button>
						);
					})}
				</div>
			</div>

			{/* Category Toggle Options */}
			<div className="export-feedback-category-section">
				<div className="export-feedback-category-header">
					<span className="export-feedback-category-title">Feedback Topic</span>
					<span className="export-feedback-category-hint">Select a category</span>
				</div>
				<div
					className="export-feedback-category-toggles"
					role="radiogroup"
					aria-label="Feedback category"
				>
					{FEEDBACK_CATEGORIES.map((cat) => {
						const isActive = category === cat.id;
						return (
							<button
								key={cat.id}
								type="button"
								data-category={cat.id}
								className={`export-feedback-toggle-chip ${isActive ? 'is-active' : ''}`}
								onClick={() => setCategory(cat.id)}
								role="radio"
								aria-checked={isActive}
								title={cat.description}
							>
								<span className="export-toggle-icon" aria-hidden="true">
									{renderCategoryIcon(cat.id)}
								</span>
								<span className="export-toggle-label">{cat.label}</span>
							</button>
						);
					})}
				</div>
			</div>

			{/* Message Area & Action Footer */}
			<div className="export-feedback-input-container">
				<textarea
					className="export-feedback-input export-feedback-textarea"
					placeholder="Share what you liked, report an issue, or suggest a new feature... (optional)"
					rows={3}
					value={message}
					onChange={(e) => {
						setMessage(e.target.value);
						if (errorMessage) setErrorMessage(null);
					}}
					maxLength={1000}
					disabled={isSubmitting}
				/>
				<div className="export-feedback-footer">
					<span className="export-feedback-privacy">
						<svg
							width="12"
							height="12"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
							aria-hidden="true"
						>
							<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
						</svg>
						Private & anonymous · On-device session
					</span>
					<button
						type="submit"
						className="export-feedback-submit-btn"
						disabled={!canSubmit}
						aria-label="Submit feedback"
					>
						{isSubmitting ? (
							<span className="export-feedback-spinner" aria-hidden="true" />
						) : (
							<svg
								viewBox="0 0 24 24"
								width="13"
								height="13"
								fill="none"
								stroke="currentColor"
								strokeWidth="2.5"
								strokeLinecap="round"
								strokeLinejoin="round"
								aria-hidden="true"
							>
								<line x1="22" y1="2" x2="11" y2="13" />
								<polygon points="22 2 15 22 11 13 2 9 22 2" />
							</svg>
						)}
						<span>Send Feedback</span>
					</button>
				</div>
			</div>

			{errorMessage && (
				<p className="export-feedback-error" role="alert">
					<svg
						width="12"
						height="12"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
					>
						<circle cx="12" cy="12" r="10" />
						<line x1="12" y1="8" x2="12" y2="12" />
						<line x1="12" y1="16" x2="12.01" y2="16" />
					</svg>
					<span>{errorMessage}</span>
				</p>
			)}
		</form>
	);
}
