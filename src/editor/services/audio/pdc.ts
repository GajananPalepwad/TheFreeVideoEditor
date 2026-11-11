import type { Project } from '../../core/types';
import { audioEffectRegistry } from '../../core/audio/effects';

export interface PathLatencyResult {
	trackLatencies: Map<string, number>; // trackId -> total latency in samples
	busLatencies: Map<string, number>; // busId -> latency in samples
	masterLatency: number; // master rack latency in samples
	maxPathLatency: number; // max latency across all paths to master
	trackCompensations: Map<string, number>; // compensation delay to add per track
	busCompensations: Map<string, number>; // compensation delay to add per bus
}

/**
 * Computes plugin delay compensation (PDC) across tracks, buses, and master.
 */
export function computeGraphPdc(project: Project): PathLatencyResult {
	const trackLatencies = new Map<string, number>();
	const busLatencies = new Map<string, number>();

	// 1. Compute intrinsic rack latency for each track
	for (const track of project.tracks) {
		if (track.kind !== 'audio') continue;
		let lat = 0;
		for (const fx of track.audio?.effects ?? []) {
			if (!fx || fx.enabled === false || fx.bypass === true) continue;
			const def = audioEffectRegistry.get(fx.type);
			if (def) lat += def.latencySamples(fx.params);
		}
		trackLatencies.set(track.id, lat);
	}

	// 2. Compute intrinsic rack latency for each bus
	for (const bus of project.audioBuses ?? []) {
		let lat = 0;
		for (const fx of bus.effects ?? []) {
			if (!fx || fx.enabled === false || fx.bypass === true) continue;
			const def = audioEffectRegistry.get(fx.type);
			if (def) lat += def.latencySamples(fx.params);
		}
		busLatencies.set(bus.id, lat);
	}

	// 3. Compute master rack latency
	let masterLatency = 0;
	for (const fx of project.masterAudio?.effects ?? []) {
		if (!fx || fx.enabled === false || fx.bypass === true) continue;
		const def = audioEffectRegistry.get(fx.type);
		if (def) masterLatency += def.latencySamples(fx.params);
	}

	// 4. Compute cumulative latency from each node to master
	const busCumulative = new Map<string, number>();
	const getBusCumulative = (busId: string, visited = new Set<string>()): number => {
		if (visited.has(busId)) return 0; // Prevent cycle
		if (busCumulative.has(busId)) return busCumulative.get(busId)!;
		visited.add(busId);

		const bus = project.audioBuses?.find((b) => b.id === busId);
		if (!bus) return 0;
		const own = busLatencies.get(busId) ?? 0;
		const down = bus.output === 'master' ? 0 : getBusCumulative(bus.output, visited);
		const total = own + down;
		busCumulative.set(busId, total);
		return total;
	};

	let maxPathLatency = 0;
	const trackTotalPaths = new Map<string, number>();

	for (const track of project.tracks) {
		if (track.kind !== 'audio') continue;
		const trackOwn = trackLatencies.get(track.id) ?? 0;
		const out = track.audio?.output ?? 'master';
		const downstream = out === 'master' ? 0 : getBusCumulative(out);
		const total = trackOwn + downstream;
		trackTotalPaths.set(track.id, total);
		if (total > maxPathLatency) {
			maxPathLatency = total;
		}
	}

	// 5. Calculate delay compensation to apply per track and bus
	const trackCompensations = new Map<string, number>();
	for (const [trackId, pathLat] of trackTotalPaths) {
		trackCompensations.set(trackId, maxPathLatency - pathLat);
	}

	const busCompensations = new Map<string, number>();
	for (const bus of project.audioBuses ?? []) {
		const busPath = getBusCumulative(bus.id);
		busCompensations.set(bus.id, Math.max(0, maxPathLatency - busPath));
	}

	return {
		trackLatencies,
		busLatencies,
		masterLatency,
		maxPathLatency,
		trackCompensations,
		busCompensations
	};
}
