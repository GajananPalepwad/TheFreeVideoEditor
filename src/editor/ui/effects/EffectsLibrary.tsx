import { useState, useMemo, type DragEvent } from 'react';
import { EFFECT_DEFINITIONS } from '../../core/effects/registry';
import { TRANSITION_DEFINITIONS, type TransitionDefinition } from '../../core/transitionsRegistry';
import {
	audioEffectRegistry,
	BUILTIN_AUDIO_EFFECTS,
	type AudioEffectDefinition
} from '../../core/audio/effects';
import { isTransitionsEnabled } from '../../core/transitions';
import type { EffectDefinition } from '../../core/effects/types';
import { useEditorStore, useEditorStoreApi } from '../../state/EditorProvider';
import { setTransparentDragImage, startDragGhost, stopDragGhost } from '../drag/dragOverlayService';
import './effects.css';

type MainTab = 'video' | 'transitions' | 'audio';

const VIDEO_CATEGORIES: Array<{ id: string; label: string }> = [
	{ id: 'all', label: 'All' },
	{ id: 'blur', label: 'Blur' },
	{ id: 'color', label: 'Color' },
	{ id: 'stylize', label: 'Stylize' },
	{ id: 'keying', label: 'Keying' },
	{ id: 'distort', label: 'Distort' }
];

const TRANSITION_CATEGORIES: Array<{ id: string; label: string }> = [
	{ id: 'all', label: 'All' },
	{ id: 'dissolve', label: 'Dissolves' },
	{ id: 'wipe', label: 'Wipes' },
	{ id: 'motion', label: 'Motion' }
];

const AUDIO_CATEGORIES: Array<{ id: string; label: string }> = [
	{ id: 'all', label: 'All' },
	{ id: 'eq', label: 'EQ' },
	{ id: 'dynamics', label: 'Dynamics' },
	{ id: 'restoration', label: 'Restoration' },
	{ id: 'spatial', label: 'Spatial' },
	{ id: 'utility', label: 'Utility' }
];

const AUDIO_EFFECT_DESCRIPTIONS: Record<string, string> = {
	'gain-trim': 'Volume trim, phase inversion, and clip mute',
	'parametric-eq': '8-band parametric EQ with shelving and notch filters',
	compressor: 'Dynamic range compression with threshold, ratio, and attack/release',
	limiter: 'Lookahead peak limiter preventing digital clipping',
	'multiband-compressor': '4-band Linkwitz-Riley multiband dynamic compressor',
	'de-esser': 'Sibilance and high-frequency vocal harshness reduction',
	'de-hummer': '50Hz / 60Hz mains electrical hum & harmonic notch filter',
	'low-cut': 'High-pass filter removing low rumble, handling noise, and wind',
	reverb: 'Stereo room, chamber, and hall algorithmic diffuse reverb',
	delay: 'Stereo feedback echo and ping-pong delay',
	'pitch-shifter': 'Real-time pitch shifting +/- 12 semitones preserving duration',
	'noise-reduction': 'Spectral gate stationary background noise reduction'
};

export default function EffectsLibrary() {
	const store = useEditorStoreApi();
	const query = useEditorStore((state) => state.effectsUi.libraryQuery);
	const selectedClipIds = useEditorStore((state) => state.timeline.selection.clipIds);
	const transitionsEnabled = useMemo(() => isTransitionsEnabled(), []);

	const [mainTab, setMainTab] = useState<MainTab>('video');
	const [activeCategory, setActiveCategory] = useState<string>('all');
	const [announcement, setAnnouncement] = useState('');
	const [inlineAudioMessage, setInlineAudioMessage] = useState<string | null>(null);

	const allEffects = useMemo(() => Object.values(EFFECT_DEFINITIONS), []);
	const allTransitions = useMemo(
		() => (transitionsEnabled ? Object.values(TRANSITION_DEFINITIONS) : []),
		[transitionsEnabled]
	);
	const allAudioEffects = useMemo(() => {
		const list = audioEffectRegistry.list();
		return list.length > 0 ? list : BUILTIN_AUDIO_EFFECTS;
	}, []);

	const categories = useMemo(() => {
		if (mainTab === 'video') return VIDEO_CATEGORIES;
		if (mainTab === 'transitions') return TRANSITION_CATEGORIES;
		return AUDIO_CATEGORIES;
	}, [mainTab]);

	const filteredEffects = useMemo(() => {
		if (mainTab !== 'video') return [];
		const lowerQuery = query.toLowerCase().trim();
		return allEffects.filter((def) => {
			if (activeCategory !== 'all' && def.category !== activeCategory) {
				return false;
			}
			if (!lowerQuery) return true;
			return (
				def.name.toLowerCase().includes(lowerQuery) ||
				(def.description?.toLowerCase().includes(lowerQuery) ?? false) ||
				def.category.toLowerCase().includes(lowerQuery)
			);
		});
	}, [allEffects, query, activeCategory, mainTab]);

	const filteredTransitions = useMemo(() => {
		if (!transitionsEnabled || mainTab !== 'transitions') return [];
		const lowerQuery = query.toLowerCase().trim();
		return allTransitions.filter((def) => {
			if (activeCategory !== 'all' && def.category !== activeCategory) {
				return false;
			}
			if (!lowerQuery) return true;
			return (
				def.name.toLowerCase().includes(lowerQuery) ||
				def.description.toLowerCase().includes(lowerQuery)
			);
		});
	}, [allTransitions, query, activeCategory, mainTab, transitionsEnabled]);

	const filteredAudioEffects = useMemo(() => {
		if (mainTab !== 'audio') return [];
		const lowerQuery = query.toLowerCase().trim();
		return allAudioEffects.filter((def) => {
			if (activeCategory !== 'all' && def.category !== activeCategory) {
				return false;
			}
			if (!lowerQuery) return true;
			const desc = AUDIO_EFFECT_DESCRIPTIONS[def.id] ?? '';
			return (
				def.name.toLowerCase().includes(lowerQuery) ||
				desc.toLowerCase().includes(lowerQuery) ||
				def.category.toLowerCase().includes(lowerQuery)
			);
		});
	}, [allAudioEffects, query, activeCategory, mainTab]);

	const handleAddTransition = (def: TransitionDefinition) => {
		const applied = store.getState().applyDefaultTransition(def.id);
		if (applied) {
			setAnnouncement(`Applied ${def.name} transition.`);
		} else {
			setAnnouncement(`Select adjacent clips or a clip cut to apply ${def.name}.`);
		}
	};

	const handleAddEffect = (def: EffectDefinition) => {
		if (selectedClipIds.length === 0) {
			setAnnouncement(`Select a clip in the timeline to apply ${def.name}.`);
			return;
		}
		const clipId = selectedClipIds[0]!;
		store.getState().addEffect(clipId, def.id);
		setAnnouncement(`Added ${def.name} to selected clip.`);
	};

	const handleAddAudioEffect = (def: AudioEffectDefinition) => {
		const project = store.getState().project;
		if (!project) return;
		const curSelectedClipIds = store.getState().timeline.selection.clipIds;
		const curSelectedTrackId = store.getState().timeline.selection.trackId;

		if (curSelectedClipIds.length > 0) {
			const clipId = curSelectedClipIds[0]!;
			const clip = project.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
			if (clip) {
				const existing = clip.audioEffects ? [...clip.audioEffects] : [];
				const newFx = audioEffectRegistry.createDefaultInstance(def.id);
				newFx.managedBy = 'user';
				existing.push(newFx);
				store.getState().setClipAudioEffects(clipId, existing);
				store.getState().revealInspectorSection('audio');
				setAnnouncement(`Added ${def.name} audio effect to selected clip.`);
				setInlineAudioMessage(null);
				return;
			}
		}

		if (curSelectedTrackId) {
			const track = project.tracks.find((t) => t.id === curSelectedTrackId);
			if (track && track.kind === 'audio') {
				const existing = track.audio?.effects ? [...track.audio.effects] : [];
				const newFx = audioEffectRegistry.createDefaultInstance(def.id);
				newFx.managedBy = 'user';
				existing.push(newFx);
				store.getState().setTrackAudioEffects(track.id, existing);
				setAnnouncement(`Added ${def.name} audio effect to ${track.name}.`);
				setInlineAudioMessage(null);
				return;
			}
		}

		// Neither is selected
		const msg = 'Select an audio clip or track first';
		setInlineAudioMessage(msg);
		setAnnouncement(msg);
	};

	const handleDragStart = (e: DragEvent, def: EffectDefinition) => {
		setTransparentDragImage(e.dataTransfer);
		startDragGhost({
			title: def.name,
			kind: 'effect',
			badge: def.category
		});
		e.dataTransfer.setData('application/x-tfve-effect', def.id);
		e.dataTransfer.setData('application/x-tfve-effect-name', def.name);
		e.dataTransfer.setData('text/plain', def.id);
		e.dataTransfer.effectAllowed = 'copy';
	};

	const handleTabChange = (tab: MainTab) => {
		setMainTab(tab);
		setActiveCategory('all');
	};

	return (
		<div className="effects-library" aria-label="Effects Library">
			<div className="effects-library-header">
				<div className="effects-main-nav" role="tablist" aria-label="Effects Modes">
					<button
						type="button"
						role="tab"
						aria-selected={mainTab === 'video'}
						className={`effects-main-tab ${mainTab === 'video' ? 'is-active' : ''}`}
						onClick={() => handleTabChange('video')}
						data-testid="tab-video-effects"
						title="Video Effects"
					>
						<span className="effects-tab-label">Video</span>
						<span className="effects-tab-count">{allEffects.length}</span>
					</button>
					{transitionsEnabled && (
						<button
							type="button"
							role="tab"
							aria-selected={mainTab === 'transitions'}
							className={`effects-main-tab effects-cat-btn ${mainTab === 'transitions' ? 'is-active' : ''}`}
							onClick={() => handleTabChange('transitions')}
							data-testid="tab-transitions"
							title="Transitions"
						>
							<span className="effects-tab-label">Transitions</span>
							<span className="effects-tab-count">{allTransitions.length}</span>
						</button>
					)}
					<button
						type="button"
						role="tab"
						aria-selected={mainTab === 'audio'}
						className={`effects-main-tab ${mainTab === 'audio' ? 'is-active' : ''}`}
						onClick={() => handleTabChange('audio')}
						data-testid="tab-audio-effects"
						title="Audio Effects"
					>
						<span className="effects-tab-label">Audio</span>
						<span className="effects-tab-count">{allAudioEffects.length}</span>
					</button>
				</div>

				<input
					type="search"
					className="effects-search-input"
					placeholder={
						mainTab === 'video'
							? 'Search effects…'
							: mainTab === 'transitions'
								? 'Search transitions…'
								: 'Search audio effects…'
					}
					value={query}
					onChange={(e) => store.getState().setEffectsLibraryQuery(e.target.value)}
					aria-label="Search effects"
				/>

				<div className="effects-category-tabs" role="tablist" aria-label="Effect categories">
					{categories.map((cat) => (
						<button
							key={cat.id}
							type="button"
							role="tab"
							aria-selected={activeCategory === cat.id}
							className={`effects-cat-btn ${activeCategory === cat.id ? 'is-active' : ''}`}
							onClick={() => setActiveCategory(cat.id)}
						>
							{cat.label}
						</button>
					))}
				</div>
			</div>

			{inlineAudioMessage && (
				<div
					className="mx-3 my-1.5 flex items-center justify-between rounded border border-amber-500/50 bg-amber-950/70 px-3 py-1.5 text-xs text-amber-200 shadow-md"
					role="alert"
					data-testid="audio-effect-inline-message"
				>
					<span className="font-medium">{inlineAudioMessage}</span>
					<button
						type="button"
						onClick={() => setInlineAudioMessage(null)}
						className="ml-2 cursor-pointer text-amber-300 hover:text-white"
						title="Dismiss"
					>
						✕
					</button>
				</div>
			)}

			<div className="effects-list" role="list">
				{mainTab === 'video' &&
					(filteredEffects.length === 0 ? (
						<div className="effects-empty">No video effects found matching “{query}”.</div>
					) : (
						filteredEffects.map((def) => (
							<div
								key={def.id}
								className="effect-card"
								draggable
								onDragStart={(e) => handleDragStart(e, def)}
								onDragEnd={() => stopDragGhost()}
								onDoubleClick={() => handleAddEffect(def)}
								onKeyDown={(e) => {
									if (e.key === 'Enter') handleAddEffect(def);
								}}
								tabIndex={0}
								role="listitem"
								aria-label={`${def.name} effect, ${def.category}`}
							>
								<div className="effect-card-header">
									<span className="effect-card-title">{def.name}</span>
									<span className="effect-card-badge">{def.category}</span>
								</div>
								<p className="effect-card-desc">{def.description}</p>
								<button
									type="button"
									className="effect-card-add-btn"
									onClick={(e) => {
										e.stopPropagation();
										handleAddEffect(def);
									}}
								>
									Add to Clip
								</button>
							</div>
						))
					))}

				{mainTab === 'transitions' &&
					(filteredTransitions.length === 0 ? (
						<div className="effects-empty">No transitions found matching “{query}”.</div>
					) : (
						filteredTransitions.map((def) => (
							<div
								key={`trans-${def.id}`}
								className="effect-card"
								draggable
								onDragStart={(e) => {
									setTransparentDragImage(e.dataTransfer);
									startDragGhost({
										title: def.name,
										kind: 'transition',
										badge: 'TRANSITION'
									});
									e.dataTransfer.setData('application/x-tfve-transition', def.id);
									e.dataTransfer.setData('text/plain', def.id);
									e.dataTransfer.effectAllowed = 'copy';
								}}
								onDragEnd={() => stopDragGhost()}
								onDoubleClick={() => handleAddTransition(def)}
								onKeyDown={(e) => {
									if (e.key === 'Enter') handleAddTransition(def);
								}}
								tabIndex={0}
								role="listitem"
								aria-label={`${def.name} transition, ${def.category}`}
							>
								<div className="effect-card-header">
									<span className="effect-card-title">{def.name}</span>
									<span className="effect-card-badge">transition</span>
								</div>
								<p className="effect-card-desc">{def.description}</p>
								<button
									type="button"
									className="effect-card-add-btn"
									onClick={(e) => {
										e.stopPropagation();
										handleAddTransition(def);
									}}
								>
									Apply Transition
								</button>
							</div>
						))
					))}

				{mainTab === 'audio' &&
					(filteredAudioEffects.length === 0 ? (
						<div className="effects-empty">No audio effects found matching “{query}”.</div>
					) : (
						filteredAudioEffects.map((def) => (
							<div
								key={`audio-${def.id}`}
								className="effect-card"
								draggable
								onDragStart={(e) => {
									setTransparentDragImage(e.dataTransfer);
									startDragGhost({
										title: def.name,
										kind: 'effect',
										badge: 'AUDIO FX'
									});
									e.dataTransfer.setData('application/x-tfve-audio-effect', def.id);
									e.dataTransfer.setData('application/x-tfve-effect-name', def.name);
									e.dataTransfer.setData('text/plain', def.id);
									e.dataTransfer.effectAllowed = 'copy';
								}}
								onDragEnd={() => stopDragGhost()}
								onDoubleClick={() => handleAddAudioEffect(def)}
								onKeyDown={(e) => {
									if (e.key === 'Enter') handleAddAudioEffect(def);
								}}
								tabIndex={0}
								role="listitem"
								aria-label={`${def.name} audio effect, ${def.category}`}
							>
								<div className="effect-card-header">
									<span className="effect-card-title">{def.name}</span>
									<span className="effect-card-badge">{def.category}</span>
								</div>
								<p className="effect-card-desc">
									{AUDIO_EFFECT_DESCRIPTIONS[def.id] ?? 'Audio DSP processing filter'}
								</p>
								<button
									type="button"
									className="effect-card-add-btn"
									onClick={(e) => {
										e.stopPropagation();
										handleAddAudioEffect(def);
									}}
								>
									Add to Audio
								</button>
							</div>
						))
					))}
			</div>

			<div className="sr-only" role="status" aria-live="polite">
				{announcement}
			</div>
		</div>
	);
}
