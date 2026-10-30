// @ts-nocheck
// Export benchmark: times real exports in headless Chromium against the dev server.
//
// Usage: npx astro dev --background, then
//   node scripts/bench-export.mjs [--scenarios plain,titled,layered] [--runs 3] [--format webm]
//          [--width 1280 --height 720] [--clips 3] [--json out.json] [--check] [--frames]
//          [--channel chrome] [--browser firefox] [--detail]
//
// --frames skips encoding and hashes the pixels of every decoded layer of every export frame. Use it to
// compare two versions of the frame reading code in browsers whose encoders are not deterministic.
// --detail adds each frame's hash to the --frames output.
// --check exports each scenario once and prints only its output hash. Run it on two versions of the
// code: the same hash means the same frames. Besides plain, titled and layered there are scenarios
// that stress frame lookup: reverse, slow, speed2x, trimmed, split, freeze, ramp, offsets (a layer
// at 2x over a layer at 1x) and offsets-reverse (a reversed layer over a forward one).
//
// Each scenario is exported on the worker path (wall time) and on the main-thread path with a
// per-stage profile. Numbers depend on the machine and on the browser's codecs; compare runs made
// on the same machine, before and after a change.
import { chromium, firefox } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(
	process.argv.slice(2).reduce((pairs, value, index, all) => {
		if (value.startsWith('--')) pairs.push([value.slice(2), all[index + 1]]);
		return pairs;
	}, [])
);
const baseUrl = args['base-url'] ?? 'http://localhost:4321';
const scenarios = (args.scenarios ?? 'plain,titled,layered').split(',');
const runs = Number(args.runs ?? 3);
const format = args.format ?? 'webm';
const width = Number(args.width ?? 1280);
const height = Number(args.height ?? 720);
const clips = Number(args.clips ?? 3);
const channel = args.channel;
const useFirefox = args.browser === 'firefox';
const framesOnly = process.argv.includes('--frames');
const detail = process.argv.includes('--detail');
const check = 'check' in args || process.argv.includes('--check');
const fixture = path.resolve('tests/fixtures/stock-1080p25-noaudio.mp4');

const log = (...values) => console.error('[bench]', ...values);
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

async function gotoEditor(page) {
	for (let attempt = 0; ; attempt += 1) {
		try {
			await page.goto(`${baseUrl}/editor/`);
			return;
		} catch (error) {
			if (attempt >= 3 || !String(error).includes('interrupted by another navigation')) throw error;
			await page.waitForLoadState('load');
		}
	}
}

async function openEditor(page) {
	// The first load after a source change can make Vite re-optimise and reload the page mid-script.
	for (let attempt = 0; ; attempt += 1) {
		try {
			await gotoEditor(page);
			await page.evaluate(async () => {
				const load = (name) => import(/* @vite-ignore */ `/src/editor/${name}`);
				await load('services/export/exporter.ts');
				await load('core/templates/builtinTemplates.ts');
			});
			break;
		} catch (error) {
			if (attempt >= 3 || !String(error).includes('Execution context was destroyed')) throw error;
			await page.waitForLoadState('load');
		}
	}
	await page.waitForLoadState('load');
	await gotoEditor(page);
	const manager = page.locator('.project-manager-dialog');
	await manager.waitFor({ state: 'visible', timeout: 15_000 });
	await manager.getByRole('button', { name: 'New project' }).click();
	const create = page.getByRole('dialog', { name: 'Create a Project' });
	await create.getByRole('textbox', { name: 'Project name' }).fill('Export benchmark');
	await create.getByRole('button', { name: 'Create project' }).click();
	await page.waitForFunction(() => Boolean(window.__TFVE_STORE__));
	await page.locator('input[name="media-files"]').setInputFiles(fixture);
	await page.getByRole('listbox', { name: 'Project media' }).getByRole('option').first().waitFor();
}

/** Builds a scenario's timeline in the open project and returns its duration in seconds. */
function buildScenario(page, name) {
	return page.evaluate(
		async ({ scenario, clips }) => {
			const { getBuiltinMotionTemplate } = await import(
				/* @vite-ignore */ '/src/editor/core/templates/builtinTemplates.ts'
			);
			const state = () => window.__TFVE_STORE__.getState();
			const asset = Object.values(state().project.assets)[0];
			const track = state().project.tracks.find((item) => item.kind === 'video');
			const clipUs = asset.duration;
			for (let index = 0; index < clips; index += 1) {
				state().addAssetToTimeline(asset.id, track.id, index * clipUs);
			}
			const baseClips = () => state().project.tracks.find((item) => item.id === track.id).clips;
			if (scenario === 'reverse') state().reverseClips([baseClips()[0].id]);
			if (scenario === 'slow') state().setClipSpeed([baseClips()[0].id], 0.5, { ripple: true });
			if (scenario === 'speed2x') state().setClipSpeed([baseClips()[1].id], 2, { ripple: true });
			if (scenario === 'trimmed') {
				const third = baseClips()[2];
				state().trimClip(third.id, 'start', third.start + 1_000_000);
			}
			if (scenario === 'split') state().splitClipAt(baseClips()[0].id, 1_000_000);
			if (scenario === 'freeze') {
				state().setPlayhead(1_000_000);
				state().addFreezeFrame(baseClips()[0].id, 1_000_000);
			}
			if (scenario === 'ramp') {
				const id = baseClips()[0].id;
				state().enableTimeRemap(id);
				state().setClipTimeRemap(id, {
					keyframes: [
						{ time: 0, value: 1.0, interpolation: 'linear' },
						{ time: 2_000_000, value: 3.0, interpolation: 'linear' }
					]
				});
			}
			if (scenario === 'offsets' || scenario === 'offsets-reverse') {
				state().addAssetOnNewTrack(asset.id, 'video', 0);
				const overlay = state().project.tracks.find(
					(item) => item.kind === 'video' && item.id !== track.id
				);
				const overlayId = overlay.clips[0].id;
				if (scenario === 'offsets') state().setClipSpeed([overlayId], 2);
				else state().reverseClips([overlayId]);
				state().reorderTimelineTrack(overlay.id, 0);
			}
			if (scenario === 'layered') {
				state().addAssetOnNewTrack(asset.id, 'video', clipUs);
				const overlay = state().project.tracks.find(
					(item) => item.kind === 'video' && item.id !== track.id
				);
				state().reorderTimelineTrack(overlay.id, 0);
			}
			if (scenario === 'titled' || scenario === 'layered') {
				state().instantiateTemplate(getBuiltinMotionTemplate('cinematic-blockbuster'));
			}
			return (clips * clipUs) / 1_000_000;
		},
		{ scenario: name, clips }
	);
}

function hashFrames(page) {
	return page.evaluate(
		async ({ width, height, includeDetail }) => {
			const load = (name) => import(/* @vite-ignore */ `/src/editor/${name}`);
			const { resolveFrame } = await load('core/index.ts');
			const { buildExportPlan } = await load('services/export/plan.ts');
			const { ExportFrameProvider } = await load('services/export/frameProvider.ts');
			const project = structuredClone(window.__TFVE_STORE__.getState().project);
			const plan = buildExportPlan(project, {
				format: 'webm',
				width,
				height,
				fps: 30,
				videoBitrate: 8_000_000,
				audio: false,
				audioBitrate: 128_000,
				filename: 'frames.webm',
				range: 'timeline'
			});
			const provider = new ExportFrameProvider(project);
			const canvas = new OffscreenCanvas(1, 1);
			const context = canvas.getContext('2d', { willReadFrequently: true });
			const hex = (buffer) =>
				[...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
			const perFrame = [];
			try {
				for (let frame = 0; frame < plan.totalFrames; frame += 1) {
					const resolved = resolveFrame(project, plan.timestamp(frame));
					await provider.prepare(resolved.videoLayers);
					const parts = [];
					for (const layer of resolved.videoLayers) {
						const image = provider.getFrame(layer);
						if (!image) {
							parts.push('none');
							continue;
						}
						canvas.width = image.width;
						canvas.height = image.height;
						context.drawImage(image, 0, 0);
						const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
						parts.push(hex(await crypto.subtle.digest('SHA-256', pixels)).slice(0, 12));
					}
					perFrame.push(parts.join('+'));
				}
			} finally {
				await provider.dispose();
			}
			const digest = await crypto.subtle.digest(
				'SHA-256',
				new TextEncoder().encode(perFrame.join('|'))
			);
			return {
				frames: plan.totalFrames,
				framesHash: hex(digest).slice(0, 16),
				...(includeDetail ? { perFrame } : {})
			};
		},
		{ width, height, includeDetail: detail }
	);
}

function runExport(page, { mainThread, profile }) {
	return page.evaluate(
		async ({ mainThread, profile, format, width, height }) => {
			const load = (name) => import(/* @vite-ignore */ `/src/editor/${name}`);
			const { exportTimeline } = await load('services/export/exporter.ts');
			const { createExportSinkForTarget } = await load('services/export/sink.ts');
			const { createStageProfile } = await load('services/export/stageProfile.ts');
			const project = window.__TFVE_STORE__.getState().project;
			const stages = profile ? createStageProfile() : undefined;
			const started = performance.now();
			const result = await exportTimeline(
				project,
				{
					format,
					width,
					height,
					fps: 30,
					videoBitrate: 8_000_000,
					audio: false,
					audioBitrate: 128_000,
					filename: `bench.${format}`,
					range: 'timeline'
				},
				{
					sink: createExportSinkForTarget(format, null),
					forceMainThread: mainThread,
					profile: stages
				}
			);
			const wallMs = performance.now() - started;
			const digest = await crypto.subtle.digest('SHA-256', await result.blob.arrayBuffer());
			const hash = [...new Uint8Array(digest)]
				.slice(0, 8)
				.map((byte) => byte.toString(16).padStart(2, '0'))
				.join('');
			return {
				wallMs,
				frames: result.plan.totalFrames,
				path: result.path ?? 'main-webcodecs',
				renderer: result.renderer ?? null,
				bytes: result.blob?.size ?? 0,
				hash,
				stages
			};
		},
		{ mainThread, profile, format, width, height }
	);
}

const browser = useFirefox
	? await firefox.launch({ headless: true })
	: await chromium.launch({
			headless: true,
			...(channel ? { channel } : {}),
			args: ['--use-gl=angle', '--enable-gpu-rasterization']
		});
const report = [];
try {
	for (const scenario of scenarios) {
		const page = await browser.newPage();
		page.on('console', (message) => {
			if (message.type() === 'error') log('console error:', message.text().slice(0, 300));
		});
		page.on('pageerror', (error) => log('page error:', error.message.slice(0, 300)));
		page.on('crash', () => log('PAGE CRASHED'));
		await page.addInitScript(() => {
			Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined });
			Object.defineProperty(window, 'showOpenFilePicker', { configurable: true, value: undefined });
		});
		log(scenario, 'opening editor');
		await openEditor(page);
		log(scenario, 'building timeline');
		const seconds = await buildScenario(page, scenario);
		if (framesOnly) {
			const result = await hashFrames(page);
			console.log(JSON.stringify({ scenario, ...result }));
			await page.close();
			continue;
		}
		if (check) {
			const once = await runExport(page, { mainThread: true, profile: false });
			console.log(
				JSON.stringify({ scenario, frames: once.frames, bytes: once.bytes, hash: once.hash })
			);
			await page.close();
			continue;
		}
		log(scenario, 'warm-up export');
		await runExport(page, { mainThread: true, profile: false });

		const worker = [];
		const main = [];
		for (let run = 0; run < runs; run += 1) {
			log(scenario, 'run', run + 1, 'worker');
			worker.push(await runExport(page, { mainThread: false, profile: false }));
			log(scenario, 'run', run + 1, 'main-thread');
			main.push(await runExport(page, { mainThread: true, profile: true }));
		}
		const mid = main.sort((a, b) => a.wallMs - b.wallMs)[Math.floor(main.length / 2)];
		const row = {
			scenario,
			seconds,
			frames: mid.frames,
			renderer: mid.renderer,
			workerPath: worker[0].path,
			workerMs: Math.round(median(worker.map((item) => item.wallMs))),
			mainMs: Math.round(median(main.map((item) => item.wallMs))),
			workerFps: +(mid.frames / (median(worker.map((item) => item.wallMs)) / 1000)).toFixed(1),
			mainFps: +(mid.frames / (median(main.map((item) => item.wallMs)) / 1000)).toFixed(1),
			stageMs: Object.fromEntries(
				Object.entries(mid.stages.ms).map(([stage, ms]) => [stage, Math.round(ms)])
			),
			bytes: mid.bytes,
			hash: mid.hash
		};
		report.push(row);
		console.log(JSON.stringify(row));
		await page.close();
	}
} finally {
	await browser.close();
}

if (!check)
	console.table(
		report.map(({ stageMs, ...row }) => ({
			...row,
			...Object.fromEntries(Object.entries(stageMs))
		}))
	);
if (args.json && !check) writeFileSync(args.json, JSON.stringify(report, null, 2));
