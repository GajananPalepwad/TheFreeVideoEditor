import youtubedl from 'youtube-dl-exec';
import ffmpeg from '@ffmpeg-installer/ffmpeg';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const YOUTUBE_REGEX =
	/^(https?:\/\/)?(www\.|m\.)?(youtube\.com\/(watch\?v=|shorts\/|embed\/|v\/|live\/)|youtu\.be\/)[a-zA-Z0-9_-]{11}/;

export function isYoutubeUrl(url) {
	if (!url || typeof url !== 'string') return false;
	const trimmed = url.trim();
	return YOUTUBE_REGEX.test(trimmed);
}

function sanitizeFilename(name) {
	if (!name || typeof name !== 'string') return 'youtube_video';
	const singleLine = name.replace(/[\r\n\t]+/g, ' ').trim();
	const safe = singleLine
		.replace(/[/\\?%*:|"<>]/g, '_')
		.replace(/\s+/g, ' ')
		.trim();
	return safe.slice(0, 60) || 'youtube_video';
}

async function parseBody(req) {
	return new Promise((resolve) => {
		let data = '';
		req.on('data', (chunk) => {
			data += chunk;
		});
		req.on('end', () => {
			try {
				resolve(data ? JSON.parse(data) : {});
			} catch {
				resolve({});
			}
		});
		req.on('error', () => resolve({}));
	});
}

export async function handleYoutubeInfo(req, res) {
	try {
		const parsedUrl = new URL(req.url, 'http://localhost');
		let targetUrl = parsedUrl.searchParams.get('url');

		if (!targetUrl && req.method === 'POST') {
			const body = await parseBody(req);
			targetUrl = body.url;
		}

		if (!targetUrl || !isYoutubeUrl(targetUrl)) {
			res.statusCode = 400;
			res.setHeader('Content-Type', 'application/json');
			res.end(JSON.stringify({ error: 'Please enter a valid YouTube URL.' }));
			return;
		}

		const info = await youtubedl(targetUrl, {
			dumpSingleJson: true,
			noWarnings: true,
			preferFreeFormats: true,
			ffmpegLocation: ffmpeg.path,
			extractorArgs: 'youtube:player_client=android'
		});

		const availableHeights = Array.from(
			new Set(
				(info.formats || []).map((f) => f.height).filter((h) => typeof h === 'number' && h > 0)
			)
		).sort((a, b) => b - a);

		res.statusCode = 200;
		res.setHeader('Content-Type', 'application/json');
		res.end(
			JSON.stringify({
				id: info.id,
				title: info.title || 'YouTube Video',
				duration: info.duration || 0,
				thumbnail: info.thumbnail || '',
				uploader: info.uploader || '',
				availableQualities: availableHeights
			})
		);
	} catch (err) {
		const rawErr = (err && (err.stderr || err.message)) || 'Failed to fetch YouTube video info.';
		const cleanErr = rawErr.replace(/ERROR:\s*(\[[^\]]+\]\s*)?/i, '').split('\n')[0] || rawErr;
		res.statusCode = 400;
		res.setHeader('Content-Type', 'application/json');
		res.end(JSON.stringify({ error: cleanErr }));
	}
}

export async function handleYoutubeDownload(req, res) {
	let tempBase = '';
	try {
		const parsedUrl = new URL(req.url, 'http://localhost');
		let targetUrl = parsedUrl.searchParams.get('url');
		let formatType = parsedUrl.searchParams.get('formatType') || 'video';
		let quality = parsedUrl.searchParams.get('quality') || 'best';

		if (req.method === 'POST') {
			const body = await parseBody(req);
			if (body.url) targetUrl = body.url;
			if (body.formatType) formatType = body.formatType;
			if (body.quality) quality = body.quality;
		}

		if (!targetUrl || !isYoutubeUrl(targetUrl)) {
			res.statusCode = 400;
			res.setHeader('Content-Type', 'application/json');
			res.end(JSON.stringify({ error: 'Please enter a valid YouTube URL.' }));
			return;
		}

		const tempId = `yt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
		tempBase = path.join(os.tmpdir(), tempId);
		const outPattern = `${tempBase}.%(ext)s`;

		// Fetch basic info first for safe title
		let title = 'youtube_video';
		try {
			const info = await youtubedl(targetUrl, {
				dumpSingleJson: true,
				noWarnings: true,
				ffmpegLocation: ffmpeg.path,
				extractorArgs: 'youtube:player_client=android'
			});
			if (info?.title) {
				title = info.title;
			}
		} catch {
			// fallback title if dumpSingleJson fails
		}

		let dlFormat = '';
		let mergeFormat = undefined;
		let extractAudio = undefined;
		let audioFormat = undefined;
		let ext = 'mp4';
		let contentType = 'video/mp4';

		if (formatType === 'audio') {
			dlFormat = 'bestaudio/best';
			extractAudio = true;
			audioFormat = 'mp3';
			ext = 'mp3';
			contentType = 'audio/mpeg';
		} else if (formatType === 'video_only') {
			const heightLimit = quality && quality !== 'best' ? `[height<=${quality}]` : '';
			dlFormat = `bestvideo${heightLimit}[ext=mp4]/bestvideo${heightLimit}/best`;
			ext = 'mp4';
			contentType = 'video/mp4';
		} else {
			// Standard Video + Audio in user's requested quality (or best available)
			const heightLimit = quality && quality !== 'best' ? `[height<=${quality}]` : '';
			dlFormat = `bestvideo${heightLimit}[ext=mp4]+bestaudio[ext=m4a]/bestvideo${heightLimit}+bestaudio/best${heightLimit}[ext=mp4]/best${heightLimit}/best`;
			mergeFormat = 'mp4';
			ext = 'mp4';
			contentType = 'video/mp4';
		}

		const dlOptions = {
			output: outPattern,
			format: dlFormat,
			ffmpegLocation: ffmpeg.path,
			noWarnings: true,
			extractorArgs: 'youtube:player_client=android'
		};

		if (mergeFormat) {
			dlOptions.mergeOutputFormat = mergeFormat;
		}
		if (extractAudio) {
			dlOptions.extractAudio = true;
			dlOptions.audioFormat = audioFormat;
		}

		await youtubedl(targetUrl, dlOptions);

		// Find the generated file
		const files = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith(tempId));
		if (!files.length) {
			throw new Error('Downloaded file could not be found on server.');
		}

		const targetFile = path.join(os.tmpdir(), files[0]);
		const stat = fs.statSync(targetFile);
		const safeTitle = sanitizeFilename(title);
		const asciiFilename =
			safeTitle
				.replace(/[^a-zA-Z0-9_.\- ]/g, ' ')
				.replace(/\s+/g, ' ')
				.trim() || 'youtube_video';
		const encodedTitle = encodeURIComponent(`${safeTitle}.${ext}`);

		res.statusCode = 200;
		res.setHeader('Content-Type', contentType);
		res.setHeader('Content-Length', stat.size);
		res.setHeader(
			'Content-Disposition',
			`attachment; filename="${asciiFilename}.${ext}"; filename*=UTF-8''${encodedTitle}`
		);
		res.setHeader('X-Video-Title', encodeURIComponent(safeTitle));
		res.setHeader('X-File-Type', ext);

		const readStream = fs.createReadStream(targetFile);
		readStream.pipe(res);

		const cleanup = () => {
			for (const f of files) {
				try {
					const p = path.join(os.tmpdir(), f);
					if (fs.existsSync(p)) fs.unlinkSync(p);
				} catch {
					// ignore cleanup error
				}
			}
		};

		res.on('finish', cleanup);
		res.on('close', cleanup);
		readStream.on('error', (err) => {
			cleanup();
			if (!res.headersSent) {
				res.statusCode = 500;
				res.setHeader('Content-Type', 'application/json');
				res.end(JSON.stringify({ error: err.message }));
			}
		});
	} catch (err) {
		if (tempBase) {
			const dir = os.tmpdir();
			const baseName = path.basename(tempBase);
			try {
				const files = fs.readdirSync(dir).filter((f) => f.startsWith(baseName));
				for (const f of files) {
					fs.unlinkSync(path.join(dir, f));
				}
			} catch {
				// ignore cleanup error
			}
		}

		const rawErr = (err && (err.stderr || err.message)) || 'Download failed.';
		const cleanErr = rawErr.replace(/ERROR:\s*(\[[^\]]+\]\s*)?/i, '').split('\n')[0] || rawErr;

		if (!res.headersSent) {
			res.statusCode = 400;
			res.setHeader('Content-Type', 'application/json');
			res.end(JSON.stringify({ error: cleanErr }));
		}
	}
}

export function youtubeDownloadPlugin() {
	const middleware = (req, res, next) => {
		const parsedUrl = new URL(req.url || '/', 'http://localhost');
		if (parsedUrl.pathname === '/api/youtube-info') {
			void handleYoutubeInfo(req, res);
		} else if (parsedUrl.pathname === '/api/download-youtube') {
			void handleYoutubeDownload(req, res);
		} else {
			next();
		}
	};

	return {
		name: 'vite-plugin-youtube-downloader',
		configureServer(server) {
			server.middlewares.use(middleware);
		},
		configurePreviewServer(server) {
			server.middlewares.use(middleware);
		}
	};
}
