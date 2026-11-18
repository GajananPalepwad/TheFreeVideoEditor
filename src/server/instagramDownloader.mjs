import ffmpeg from '@ffmpeg-installer/ffmpeg';
import youtubedl from 'youtube-dl-exec';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const INSTAGRAM_REGEX =
	/(?:https?:\/\/)?(?:www\.|m\.)?(?:instagram\.com|instagr\.am)\/(?:[^\/]+\/)?(?:p|reel|reels|tv|share\/reel|share\/p)\/([A-Za-z0-9_-]+)/i;

export function isInstagramUrl(url) {
	if (!url || typeof url !== 'string') return false;
	return INSTAGRAM_REGEX.test(url.trim());
}

export function extractShortcode(url) {
	if (!url || typeof url !== 'string') return null;
	const match = url.trim().match(INSTAGRAM_REGEX);
	return match ? match[1] : null;
}

export function getCanonicalInstagramUrl(shortcode, url = '') {
	if (!shortcode) return '';
	const isPhotoPost = Boolean(url && /(?:\/p\/|\/share\/p\/)/i.test(url));
	return isPhotoPost
		? `https://www.instagram.com/p/${shortcode}/`
		: `https://www.instagram.com/reel/${shortcode}/`;
}

function sanitizeFilename(name) {
	if (!name || typeof name !== 'string') return 'instagram_media';
	const singleLine = name.replace(/[\r\n\t]+/g, ' ').trim();
	const safe = singleLine
		.replace(/[/\\?%*:|"<>]/g, '_')
		.replace(/\s+/g, ' ')
		.trim();
	return safe.slice(0, 60) || 'instagram_media';
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

// In-memory cache for Instagram media details to eliminate redundant Instagram queries
// Key: shortcode, Value: { details, timestamp }
const mediaDetailsCache = new Map();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

export function getCachedInstagramDetails(shortcode) {
	if (!shortcode) return null;
	const entry = mediaDetailsCache.get(shortcode);
	if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) {
		return entry.details;
	}
	if (entry) mediaDetailsCache.delete(shortcode);
	return null;
}

export function setCachedInstagramDetails(shortcode, details) {
	if (!shortcode || !details) return;
	if (mediaDetailsCache.size >= 100) {
		const firstKey = mediaDetailsCache.keys().next().value;
		if (firstKey) mediaDetailsCache.delete(firstKey);
	}
	mediaDetailsCache.set(shortcode, { details, timestamp: Date.now() });
}

export function clearInstagramCache() {
	mediaDetailsCache.clear();
}

export function decodeSnapApp(args) {
	const [h, , n, t, e] = args;
	const tNum = Number(t);
	const eNum = Number(e);
	function decode(d, baseSrc, baseDst) {
		const g = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+/'.split('');
		const hArr = g.slice(0, baseSrc);
		const iArr = g.slice(0, baseDst);
		let j = d
			.split('')
			.reverse()
			.reduce((a, b, c) => {
				const idx = hArr.indexOf(b);
				if (idx !== -1) return a + idx * Math.pow(baseSrc, c);
				return a;
			}, 0);
		let k = '';
		let remaining = j;
		while (remaining > 0) {
			k = iArr[remaining % baseDst] + k;
			remaining = Math.floor(remaining / baseDst);
		}
		return k || '0';
	}
	let result = '';
	for (let i = 0, len = h.length; i < len;) {
		let s = '';
		while (i < len && h[i] !== n[eNum]) {
			s += h[i];
			i++;
		}
		i++;
		for (let j = 0; j < n.length; j++) {
			s = s.replace(new RegExp(n[j], 'g'), j.toString());
		}
		result += String.fromCharCode(Number(decode(s, eNum, 10)) - tNum);
	}
	try {
		const bytes = new Uint8Array(result.split('').map((char) => char.charCodeAt(0)));
		return new TextDecoder('utf-8').decode(bytes);
	} catch {
		return result;
	}
}

export function getEncodedSnapApp(data) {
	if (!data || typeof data !== 'string') return null;
	const splitA = data.split('decodeURIComponent(escape(r))}(');
	if (splitA.length < 2) return null;
	const splitB = splitA[1].split('))');
	if (splitB.length < 1) return null;
	return splitB[0].split(',').map((v) => v.replace(/"/g, '').trim());
}

export function decodeBase64Json(b64) {
	try {
		let normalized = b64.replace(/-/g, '+').replace(/_/g, '/');
		while (normalized.length % 4) {
			normalized += '=';
		}
		const text = Buffer.from(normalized, 'base64').toString('utf-8');
		return JSON.parse(text);
	} catch {
		return null;
	}
}

export async function fetchInstagramDetails(shortcode, targetUrl) {
	// 0. Return cached details if available
	const cached = getCachedInstagramDetails(shortcode);
	if (cached) {
		return cached;
	}

	const canonicalUrl = getCanonicalInstagramUrl(shortcode, targetUrl);

	// 1. Official Instagram oEmbed metadata
	let title = 'Instagram Reel';
	let uploader = '';
	let thumbnail = '';
	try {
		const oembedRes = await fetch(
			`https://www.instagram.com/api/v1/oembed/?url=${encodeURIComponent(`https://www.instagram.com/p/${shortcode}/`)}`,
			{
				headers: {
					'User-Agent':
						'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36'
				},
				signal: AbortSignal.timeout(3000)
			}
		);
		if (oembedRes.ok) {
			const oembed = await oembedRes.json();
			if (oembed.title) title = oembed.title;
			if (oembed.author_name) uploader = oembed.author_name;
			if (oembed.thumbnail_url) thumbnail = oembed.thumbnail_url;
		}
	} catch {
		// proceed
	}

	// 2. SnapSave stream extraction
	const videoVersions = [];
	try {
		const formData = new URLSearchParams();
		formData.append('url', canonicalUrl);
		const snapRes = await fetch('https://snapsave.app/action.php?lang=en', {
			method: 'POST',
			headers: {
				accept: '*/*',
				'content-type': 'application/x-www-form-urlencoded',
				origin: 'https://snapsave.app',
				referer: 'https://snapsave.app/',
				'user-agent':
					'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36'
			},
			body: formData.toString(),
			signal: AbortSignal.timeout(4000)
		});
		if (snapRes.ok) {
			const text = await snapRes.text();
			let unescaped = text;
			const encoded = getEncodedSnapApp(text);
			if (encoded) {
				try {
					const decoded = decodeSnapApp(encoded);
					if (decoded) unescaped = decoded.replace(/\\"/g, '"').replace(/\\/g, '');
				} catch {
					unescaped = text;
				}
			}
			const tokenMatches =
				unescaped.match(/https:\/\/d\.rapidcdn\.app\/v2\?token=([A-Za-z0-9_.-]+)/g) || [];
			for (const tokenUrl of tokenMatches) {
				const token = tokenUrl.split('token=')[1];
				const payload = decodeBase64Json(token.split('.')[1]);
				if (payload?.url) {
					videoVersions.push({
						url: payload.url,
						backupUrl: tokenUrl,
						width: 1080,
						height: 1920
					});
				} else {
					videoVersions.push({ url: tokenUrl, backupUrl: tokenUrl });
				}
			}
			if (videoVersions.length === 0) {
				const directMp4 = unescaped.match(/https:\/\/[^"' <>\n\r]+\.mp4[^"' <>\n\r]*/g) || [];
				for (const dm of directMp4) {
					videoVersions.push({ url: dm });
				}
			}
			if (!thumbnail) {
				const thumbMatch = unescaped.match(/src="([^"]+)"/);
				if (thumbMatch && thumbMatch[1].startsWith('http')) {
					thumbnail = thumbMatch[1];
				}
			}
		}
	} catch {
		// proceed
	}

	if (videoVersions.length > 0) {
		const isVideo = true;
		const details = {
			id: shortcode,
			title,
			uploader,
			duration: 0,
			thumbnail: thumbnail || videoVersions[0].url,
			mediaType: isVideo ? 'video' : 'image',
			videoVersions,
			imageCandidates: thumbnail ? [{ url: thumbnail }] : [],
			availableQualities: [1080, 720, 480]
		};
		setCachedInstagramDetails(shortcode, details);
		return details;
	}

	// 2. Fallback to yt-dlp
	try {
		const canonicalUrl = getCanonicalInstagramUrl(shortcode, targetUrl);
		const info = await youtubedl(canonicalUrl, {
			dumpSingleJson: true,
			noWarnings: true,
			ffmpegLocation: ffmpeg.path
		});

		const availableHeights = Array.from(
			new Set(
				(info.formats || []).map((f) => f.height).filter((h) => typeof h === 'number' && h > 0)
			)
		).sort((a, b) => b - a);

		// Filter out audio-only formats
		const videoFormats = (info.formats || []).filter(
			(f) => f.vcodec !== 'none' && f.resolution !== 'audio only' && f.ext !== 'm4a' && f.url
		);

		const details = {
			id: info.id || shortcode,
			title: info.title || 'Instagram Media',
			uploader: info.uploader || '',
			duration: info.duration || 0,
			thumbnail: info.thumbnail || '',
			mediaType: 'video',
			availableQualities: availableHeights,
			videoVersions: videoFormats.map((f) => ({
				url: f.url,
				width: f.width,
				height: f.height
			})),
			imageCandidates: []
		};

		setCachedInstagramDetails(shortcode, details);
		return details;
	} catch (err) {
		const rawErr = (err && (err.stderr || err.message)) || '';
		let cleanErr =
			'Failed to fetch Instagram media details. Please make sure the post or reel is public and the URL is valid.';
		if (rawErr.includes('Instagram API is not granting access') || rawErr.includes('login')) {
			cleanErr =
				'Instagram is requesting authentication for this content. Please verify that this reel is public.';
		}
		throw new Error(cleanErr);
	}
}

export async function handleInstagramInfo(req, res) {
	try {
		const parsedUrl = new URL(req.url, 'http://localhost');
		let targetUrl = parsedUrl.searchParams.get('url');

		if (!targetUrl && req.method === 'POST') {
			const body = await parseBody(req);
			targetUrl = body.url;
		}

		if (!targetUrl || !isInstagramUrl(targetUrl)) {
			res.statusCode = 400;
			res.setHeader('Content-Type', 'application/json');
			res.end(JSON.stringify({ error: 'Please enter a valid Instagram Reel or Post link.' }));
			return;
		}

		const shortcode = extractShortcode(targetUrl);
		if (!shortcode) {
			res.statusCode = 400;
			res.setHeader('Content-Type', 'application/json');
			res.end(JSON.stringify({ error: 'Could not extract shortcode from Instagram link.' }));
			return;
		}

		const details = await fetchInstagramDetails(shortcode, targetUrl);

		res.statusCode = 200;
		res.setHeader('Content-Type', 'application/json');
		res.end(
			JSON.stringify({
				id: details.id,
				title: details.title,
				duration: details.duration,
				thumbnail: details.thumbnail,
				uploader: details.uploader,
				mediaType: details.mediaType,
				availableQualities: details.availableQualities
			})
		);
	} catch (err) {
		const message = (err && err.message) || 'Failed to fetch Instagram details.';
		res.statusCode = 400;
		res.setHeader('Content-Type', 'application/json');
		res.end(JSON.stringify({ error: message }));
	}
}

export async function handleInstagramDownload(req, res) {
	let tempBase = null;

	const cleanup = () => {
		if (!tempBase) return;
		try {
			const dir = path.dirname(tempBase);
			const base = path.basename(tempBase);
			const files = fs.readdirSync(dir).filter((f) => f.startsWith(base));
			for (const f of files) {
				try {
					const p = path.join(dir, f);
					if (fs.existsSync(p)) fs.unlinkSync(p);
				} catch {
					// ignore cleanup error
				}
			}
		} catch {
			// ignore cleanup error
		}
	};

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

		if (!targetUrl || !isInstagramUrl(targetUrl)) {
			res.statusCode = 400;
			res.setHeader('Content-Type', 'application/json');
			res.end(JSON.stringify({ error: 'Please enter a valid Instagram Reel or Post link.' }));
			return;
		}

		const shortcode = extractShortcode(targetUrl);
		if (!shortcode) {
			res.statusCode = 400;
			res.setHeader('Content-Type', 'application/json');
			res.end(JSON.stringify({ error: 'Could not extract shortcode from Instagram link.' }));
			return;
		}

		const details = await fetchInstagramDetails(shortcode, targetUrl);
		const safeTitle = sanitizeFilename(details.title);

		const asciiFilename =
			safeTitle
				.replace(/[^a-zA-Z0-9_.\- ]/g, ' ')
				.replace(/\s+/g, ' ')
				.trim() || 'instagram_media';

		if (details.mediaType === 'image') {
			// Photo post download
			const candidates = details.imageCandidates || [];
			if (!candidates.length) {
				throw new Error('No image streams found for this Instagram post.');
			}
			const imgUrl = candidates[0].url;
			const imgFetch = await fetch(imgUrl);
			if (!imgFetch.ok) {
				throw new Error(`Failed to download photo from Instagram CDN: ${imgFetch.statusText}`);
			}
			const arrayBuffer = await imgFetch.arrayBuffer();
			const buffer = Buffer.from(arrayBuffer);

			const encodedTitle = encodeURIComponent(`${safeTitle}.jpg`);

			res.statusCode = 200;
			res.setHeader('Content-Type', 'image/jpeg');
			res.setHeader('Content-Length', buffer.length);
			res.setHeader(
				'Content-Disposition',
				`attachment; filename="${asciiFilename}.jpg"; filename*=UTF-8''${encodedTitle}`
			);
			res.setHeader('X-Video-Title', encodeURIComponent(safeTitle));
			res.setHeader('X-File-Type', 'jpg');
			res.end(buffer);
			return;
		}

		// Video / Reel download using yt-dlp + ffmpeg
		const tempId = `ig_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
		tempBase = path.join(os.tmpdir(), tempId);
		const outPattern = `${tempBase}.%(ext)s`;

		const qualityMap = {
			1080: { height: 1920, width: 1080 },
			720: { height: 1280, width: 720 },
			480: { height: 854, width: 480 },
			360: { height: 640, width: 360 }
		};

		const limits = quality && quality !== 'best' && qualityMap[quality];
		const hFilter = limits ? `[height<=${limits.height}]` : '';
		const wFilter = limits ? `[width<=${limits.width}]` : '';

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
			dlFormat = limits
				? `bestvideo${wFilter}[ext=mp4]/bestvideo${hFilter}[ext=mp4]/bestvideo${hFilter}/bestvideo/best`
				: 'bestvideo[ext=mp4]/bestvideo/best';
			ext = 'mp4';
			contentType = 'video/mp4';
		} else {
			// Standard Video + Audio in user's requested quality (or best available)
			dlFormat = limits
				? `bestvideo${wFilter}[ext=mp4]+bestaudio[ext=m4a]/bestvideo${hFilter}[ext=mp4]+bestaudio/bestvideo${hFilter}+bestaudio/best${hFilter}[ext=mp4]/best`
				: 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best[ext=mp4]/best';
			mergeFormat = 'mp4';
			ext = 'mp4';
			contentType = 'video/mp4';
		}

		const dlOptions = {
			output: outPattern,
			format: dlFormat,
			ffmpegLocation: ffmpeg.path,
			noWarnings: true
		};

		if (mergeFormat) {
			dlOptions.mergeOutputFormat = mergeFormat;
		}
		if (extractAudio) {
			dlOptions.extractAudio = true;
			dlOptions.audioFormat = audioFormat;
		}

		try {
			const canonicalUrl = getCanonicalInstagramUrl(shortcode, targetUrl);
			await youtubedl(canonicalUrl, dlOptions);
		} catch (ytdlErr) {
			// If yt-dlp download failed, check if we have a direct progressive video URL from details
			const progressive = (details.videoVersions || []).find((v) => v.url);
			if (progressive && formatType !== 'audio') {
				const vidFetch = await fetch(progressive.url);
				if (vidFetch.ok) {
					const arrayBuf = await vidFetch.arrayBuffer();
					const buffer = Buffer.from(arrayBuf);
					const encodedTitle = encodeURIComponent(`${safeTitle}.mp4`);
					res.statusCode = 200;
					res.setHeader('Content-Type', 'video/mp4');
					res.setHeader('Content-Length', buffer.length);
					res.setHeader(
						'Content-Disposition',
						`attachment; filename="${asciiFilename}.mp4"; filename*=UTF-8''${encodedTitle}`
					);
					res.setHeader('X-Video-Title', encodeURIComponent(safeTitle));
					res.setHeader('X-File-Type', 'mp4');
					res.end(buffer);
					return;
				}
			}
			throw ytdlErr;
		}

		// Find the generated file
		const files = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith(tempId));
		if (!files.length) {
			throw new Error('Downloaded file could not be found on server.');
		}

		const targetFile = path.join(os.tmpdir(), files[0]);
		const stat = fs.statSync(targetFile);
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

		res.on('finish', () => {
			cleanup();
		});
		res.on('close', () => {
			cleanup();
		});
	} catch (err) {
		cleanup();
		const rawErr = (err && (err.stderr || err.message)) || 'Instagram download failed.';
		const cleanErr = rawErr.replace(/ERROR:\s*(\[[^\]]+\]\s*)?/i, '').split('\n')[0] || rawErr;
		if (!res.headersSent) {
			try {
				res.removeHeader('Content-Length');
				res.removeHeader('Content-Disposition');
				res.removeHeader('X-Video-Title');
				res.removeHeader('X-File-Type');
			} catch {
				// ignore header removal issues
			}
			res.statusCode = 400;
			res.setHeader('Content-Type', 'application/json');
			res.end(JSON.stringify({ error: cleanErr }));
		}
	}
}

export function instagramDownloadPlugin() {
	const middleware = (req, res, next) => {
		const parsedUrl = new URL(req.url || '/', 'http://localhost');
		const pathname = (parsedUrl.pathname || '').replace(/\/+$/, '');
		if (pathname === '/api/instagram-info') {
			void handleInstagramInfo(req, res);
		} else if (pathname === '/api/download-instagram') {
			void handleInstagramDownload(req, res);
		} else {
			next();
		}
	};

	return {
		name: 'vite-plugin-instagram-downloader',
		configureServer(server) {
			return () => {
				if (Array.isArray(server.middlewares?.stack)) {
					server.middlewares.stack.unshift({ route: '', handle: middleware });
				} else {
					server.middlewares.use(middleware);
				}
			};
		},
		configurePreviewServer(server) {
			return () => {
				if (Array.isArray(server.middlewares?.stack)) {
					server.middlewares.stack.unshift({ route: '', handle: middleware });
				} else {
					server.middlewares.use(middleware);
				}
			};
		}
	};
}
