import { useEffect, useRef, useState } from 'react';
import { ExportFeedbackCard } from '../export/ExportFeedbackCard';
import './editor-feedback-dialog.css';

interface EditorFeedbackDialogProps {
	isOpen: boolean;
	onClose: () => void;
}

export default function EditorFeedbackDialog({ isOpen, onClose }: EditorFeedbackDialogProps) {
	const dialogRef = useRef<HTMLDialogElement>(null);
	const [submitted, setSubmitted] = useState(false);

	useEffect(() => {
		const dialog = dialogRef.current;
		if (!dialog) return;

		if (isOpen && !dialog.open) {
			setSubmitted(false);
			dialog.showModal();
		} else if (!isOpen && dialog.open) {
			dialog.close();
		}
	}, [isOpen]);

	if (!isOpen) return null;

	const handleBackdropClick = (e: React.MouseEvent<HTMLDialogElement>) => {
		if (e.target === dialogRef.current) {
			onClose();
		}
	};

	return (
		<dialog
			ref={dialogRef}
			className="editor-feedback-modal-dialog"
			aria-label="Feedback"
			onCancel={onClose}
			onClick={handleBackdropClick}
		>
			<div className="editor-feedback-modal-container">
				{!submitted && (
					<button
						type="button"
						className="editor-feedback-close-btn"
						onClick={onClose}
						aria-label="Close feedback dialog"
					>
						<svg
							viewBox="0 0 16 16"
							width="14"
							height="14"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
							aria-hidden="true"
						>
							<line x1="3" y1="3" x2="13" y2="13" />
							<line x1="13" y1="3" x2="3" y2="13" />
						</svg>
					</button>
				)}

				<ExportFeedbackCard
					title="Share Your Feedback"
					subtitle="Have an idea for a feature, spotted a bug, or want to share your experience?"
					defaultCategory="general"
					page="/editor"
					onClose={onClose}
					onSubmitted={() => setSubmitted(true)}
				/>
			</div>
		</dialog>
	);
}
