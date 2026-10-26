import { useEffect, useMemo, useRef, useState } from 'react';
import {
	buildCheatSheet,
	detectShortcutPlatform,
	type ShortcutEntry
} from '../../services/keyboard/registry';

interface KeyboardShortcutsDialogProps {
	entries: readonly ShortcutEntry[];
	onClose: () => void;
}

export default function KeyboardShortcutsDialog({
	entries,
	onClose
}: KeyboardShortcutsDialogProps) {
	const dialogRef = useRef<HTMLDialogElement>(null);
	const searchRef = useRef<HTMLInputElement>(null);
	const [query, setQuery] = useState('');
	const platform = detectShortcutPlatform();
	const items = useMemo(() => buildCheatSheet(entries, platform), [entries, platform]);
	const filtered = items.filter((item) =>
		`${item.label} ${item.keys} ${item.group}`
			.toLocaleLowerCase()
			.includes(query.trim().toLowerCase())
	);
	const groups = [...new Set(filtered.map((item) => item.group))];

	useEffect(() => {
		const dialog = dialogRef.current;
		if (!dialog) return;
		const previousFocus =
			document.activeElement instanceof HTMLElement ? document.activeElement : null;
		dialog.showModal();
		searchRef.current?.focus();
		return () => {
			if (dialog.open) dialog.close();
			if (previousFocus?.isConnected) previousFocus.focus();
		};
	}, []);

	return (
		<dialog
			ref={dialogRef}
			className="editor-dialog shortcut-dialog"
			aria-labelledby="shortcut-dialog-title"
			onCancel={(event) => {
				event.preventDefault();
				onClose();
			}}
		>
			<div className="dialog-content">
				<div className="dialog-heading">
					<div>
						<p className="dialog-eyebrow">HELP</p>
						<h2 id="shortcut-dialog-title">Keyboard Shortcuts</h2>
					</div>
					<button
						className="icon-button dialog-close"
						type="button"
						aria-label="Close shortcuts dialog"
						onClick={onClose}
					>
						✕
					</button>
				</div>
				<label htmlFor="shortcut-search">Search shortcuts</label>
				<input
					ref={searchRef}
					id="shortcut-search"
					name="shortcut-search"
					type="search"
					autoComplete="off"
					value={query}
					onChange={(event) => setQuery(event.currentTarget.value)}
				/>
				<div className="shortcut-list" aria-live="polite">
					{groups.length === 0 && <p>No shortcuts match your search.</p>}
					{groups.map((group) => (
						<section key={group} aria-labelledby={`shortcut-group-${group.toLowerCase()}`}>
							<h3 id={`shortcut-group-${group.toLowerCase()}`}>{group}</h3>
							{filtered
								.filter((item) => item.group === group)
								.map((item) => (
									<div
										className={`shortcut-row${item.enabled ? '' : 'is-disabled'}`}
										key={item.id}
										aria-disabled={!item.enabled}
									>
										<span>{item.label}</span>
										<kbd>{item.keys}</kbd>
										{!item.enabled && <span className="shortcut-coming-soon">Coming soon</span>}
									</div>
								))}
						</section>
					))}
				</div>
				<div
					className="dialog-actions"
					style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
				>
					<a
						href="/guides/"
						target="_blank"
						rel="noopener noreferrer"
						style={{ color: 'var(--color-link)', fontSize: '0.85rem', textDecoration: 'none' }}
					>
						📖 View Detailed Tool Guides & Tutorials &rarr;
					</a>
					<button className="secondary-button" type="button" onClick={onClose}>
						Close
					</button>
				</div>
			</div>
		</dialog>
	);
}
