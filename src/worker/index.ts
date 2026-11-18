/**
 * Cloudflare Worker for TheFreeVideoEditor (Production API & Static Assets)
 * Handles /api/* endpoints natively at the edge without requiring external backend servers.
 */

interface Env {
	ASSETS: {
		fetch: typeof fetch;
	};
}

const YOUTUBE_REGEX =
	/^(https?:\/\/)?(www\.|m\.)?(youtube\.com\/(watch\?v=|shorts\/|embed\/|v\/|live\/)|youtu\.be\/)[a-zA-Z0-9_-]{11}/;

const INSTAGRAM_REGEX =
	/(?:https?:\/\/)?(?:www\.|m\.)?(?:instagram\.com|instagr\.am)\/(?:[^\/]+\/)?(?:p|reel|reels|tv|share\/reel|share\/p)\/([A-Za-z0-9_-]+)/i;

export function isYoutubeUrl(url: string | null | undefined): boolean {
	if (!url || typeof url !== 'string') return false;
	return YOUTUBE_REGEX.test(url.trim());
}

export function isInstagramUrl(url: string | null | undefined): boolean {
	if (!url || typeof url !== 'string') return false;
	return INSTAGRAM_REGEX.test(url.trim());
}

export function extractShortcode(url: string | null | undefined): string | null {
	if (!url || typeof url !== 'string') return null;
	const match = url.trim().match(INSTAGRAM_REGEX);
	return match ? match[1] : null;
}

export function extractYoutubeId(url: string | null | undefined): string | null {
	if (!url || typeof url !== 'string') return null;
	const match = url
		.trim()
		.match(/(?:watch\?v=|shorts\/|embed\/|v\/|live\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
	return match ? match[1] : null;
}

function sanitizeFilename(name: string | null | undefined, fallback: string): string {
	if (!name || typeof name !== 'string') return fallback;
	const singleLine = name.replace(/[\r\n\t]+/g, ' ').trim();
	const safe = singleLine
		.replace(/[/\\?%*:|"<>]/g, '_')
		.replace(/\s+/g, ' ')
		.trim();
	return safe.slice(0, 60) || fallback;
}

function corsHeaders(): Record<string, string> {
	return {
		'Access-Control-Allow-Origin': '*',
		'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
		'Access-Control-Expose-Headers':
			'Content-Length, Content-Disposition, X-Video-Title, X-File-Type'
	};
}

function jsonResponse(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			'Content-Type': 'application/json',
			...corsHeaders()
		}
	});
}

// In-memory cache for Instagram details on warm isolates
export interface InstagramDetails {
	id: string;
	title: string;
	uploader: string;
	duration: number;
	thumbnail: string;
	mediaType: 'video' | 'image';
	videoVersions: Array<{ url: string; backupUrl?: string; width?: number; height?: number }>;
	imageCandidates: Array<{ url: string; width?: number; height?: number }>;
	availableQualities: number[];
}

export function decodeSnapApp(args: string[]): string {
	const [h, , n, t, e] = args;
	const tNum = Number(t);
	const eNum = Number(e);
	function decode(d: string, baseSrc: number, baseDst: number) {
		const g = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+/'.split('');
		const hArr = g.slice(0, baseSrc);
		const iArr = g.slice(0, baseDst);
		const j = d
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

export function getEncodedSnapApp(data: string): string[] | null {
	const splitA = data.split('decodeURIComponent(escape(r))}(');
	if (splitA.length < 2) return null;
	const splitB = splitA[1].split('))');
	if (splitB.length < 1) return null;
	return splitB[0].split(',').map((v) => v.replace(/"/g, '').trim());
}

export function decodeBase64Json<T = unknown>(b64: string): T | null {
	try {
		let normalized = b64.replace(/-/g, '+').replace(/_/g, '/');
		while (normalized.length % 4) {
			normalized += '=';
		}
		if (typeof atob === 'function') {
			const binary = atob(normalized);
			const bytes = new Uint8Array(binary.length);
			for (let i = 0; i < binary.length; i++) {
				bytes[i] = binary.charCodeAt(i);
			}
			const text = new TextDecoder().decode(bytes);
			return JSON.parse(text) as T;
		}
	} catch {
		// ignore
	}
	return null;
}

interface OembedResponse {
	title?: string;
	author_name?: string;
	thumbnail_url?: string;
}

interface InvidiousResponse {
	title?: string;
	author?: string;
	lengthSeconds?: number;
	formatStreams?: Array<{
		url?: string;
		resolution?: string;
		qualityLabel?: string;
		itag?: number;
		size?: string;
		container?: string;
	}>;
}

const instagramCache = new Map<string, { details: InstagramDetails; timestamp: number }>();
const CACHE_TTL_MS = 15 * 60 * 1000;

export async function fetchInstagramDetails(
	shortcode: string,
	targetUrl?: string | null
): Promise<InstagramDetails> {
	const cached = instagramCache.get(shortcode);
	if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
		return cached.details;
	}

	const isPhotoPost = Boolean(targetUrl && /(?:\/p\/|\/share\/p\/)/i.test(targetUrl));
	const canonicalUrl = isPhotoPost
		? `https://www.instagram.com/p/${shortcode}/`
		: `https://www.instagram.com/reel/${shortcode}/`;

	let title = isPhotoPost ? 'Instagram Photo' : 'Instagram Reel';
	let uploader = '';
	let thumbnail = '';
	const duration = 0;

	// 1. Official Instagram oEmbed metadata (fast, unauthenticated, never 401s)
	try {
		const oembedRes = await fetch(
			`https://www.instagram.com/api/v1/oembed/?url=${encodeURIComponent(`https://www.instagram.com/p/${shortcode}/`)}`,
			{
				headers: {
					'User-Agent':
						'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36'
				},
				signal: AbortSignal.timeout(3500)
			}
		);
		if (oembedRes.ok) {
			const oembed = (await oembedRes.json()) as OembedResponse;
			if (oembed.title) title = oembed.title;
			if (oembed.author_name) uploader = oembed.author_name;
			if (oembed.thumbnail_url) thumbnail = oembed.thumbnail_url;
		}
	} catch {
		// Proceed to media extractors
	}

	// 2. SnapSave stream extraction (pure JS decryption of direct CDN stream & backup proxy)
	const videoVersions: Array<{
		url: string;
		backupUrl?: string;
		width?: number;
		height?: number;
	}> = [];
	const imageCandidates: Array<{ url: string; width?: number; height?: number }> = [];

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
			signal: AbortSignal.timeout(5000)
		});

		if (snapRes.ok) {
			const text = await snapRes.text();
			let unescaped = text;
			const encoded = getEncodedSnapApp(text);
			if (encoded) {
				try {
					const decoded = decodeSnapApp(encoded);
					if (decoded) {
						unescaped = decoded.replace(/\\"/g, '"').replace(/\\/g, '');
					}
				} catch {
					unescaped = text;
				}
			}

			const tokenMatches =
				unescaped.match(/https:\/\/d\.rapidcdn\.app\/v2\?token=([A-Za-z0-9_.-]+)/g) || [];

			for (const tokenUrl of tokenMatches) {
				const token = tokenUrl.split('token=')[1];
				const payload = decodeBase64Json<{ url?: string; filename?: string }>(token.split('.')[1]);
				if (payload?.url) {
					videoVersions.push({
						url: payload.url,
						backupUrl: tokenUrl,
						width: 1080,
						height: 1920
					});
				} else {
					videoVersions.push({
						url: tokenUrl,
						backupUrl: tokenUrl
					});
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
		// Proceed
	}

	if (thumbnail) {
		imageCandidates.push({ url: thumbnail, width: 480, height: 853 });
	}

	if (!title && !thumbnail && videoVersions.length === 0 && imageCandidates.length === 0) {
		throw new Error('Could not find media details. Please make sure the post or reel is public.');
	}

	const isVideo = !isPhotoPost || videoVersions.length > 0;
	const details: InstagramDetails = {
		id: shortcode,
		title: title.slice(0, 80) || (isVideo ? 'Instagram Reel' : 'Instagram Photo'),
		uploader,
		duration,
		thumbnail: thumbnail || (videoVersions.length > 0 ? videoVersions[0].url : ''),
		mediaType: isVideo ? 'video' : 'image',
		videoVersions,
		imageCandidates,
		availableQualities: [1080, 720, 480]
	};

	instagramCache.set(shortcode, { details, timestamp: Date.now() });
	return details;
}

export async function handleInstagramInfo(request: Request): Promise<Response> {
	try {
		const parsedUrl = new URL(request.url);
		let targetUrl = parsedUrl.searchParams.get('url');

		if (!targetUrl && request.method === 'POST') {
			const body = (await request.json().catch(() => ({}))) as { url?: string };
			targetUrl = body.url ?? null;
		}

		if (!targetUrl || !isInstagramUrl(targetUrl)) {
			return jsonResponse({ error: 'Please enter a valid Instagram Reel or Post link.' }, 400);
		}

		const shortcode = extractShortcode(targetUrl);
		if (!shortcode) {
			return jsonResponse({ error: 'Could not extract shortcode from Instagram link.' }, 400);
		}

		const details = await fetchInstagramDetails(shortcode, targetUrl);

		return jsonResponse({
			id: details.id,
			title: details.title,
			duration: details.duration,
			thumbnail: details.thumbnail,
			uploader: details.uploader,
			mediaType: details.mediaType,
			availableQualities: details.availableQualities
		});
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : 'Failed to fetch Instagram details.';
		return jsonResponse({ error: msg }, 400);
	}
}

export async function handleInstagramDownload(request: Request): Promise<Response> {
	try {
		const parsedUrl = new URL(request.url);
		let targetUrl = parsedUrl.searchParams.get('url');
		let formatType = parsedUrl.searchParams.get('formatType') || 'video';
		let quality = parsedUrl.searchParams.get('quality') || 'best';

		if (request.method === 'POST') {
			const body = (await request.json().catch(() => ({}))) as {
				url?: string;
				formatType?: string;
				quality?: string;
			};
			if (body.url) targetUrl = body.url;
			if (body.formatType) formatType = body.formatType;
			if (body.quality) quality = body.quality;
		}

		if (!targetUrl || !isInstagramUrl(targetUrl)) {
			return jsonResponse({ error: 'Please enter a valid Instagram Reel or Post link.' }, 400);
		}

		const shortcode = extractShortcode(targetUrl);
		if (!shortcode) {
			return jsonResponse({ error: 'Could not extract shortcode from Instagram link.' }, 400);
		}

		const details = await fetchInstagramDetails(shortcode, targetUrl);
		const safeTitle = sanitizeFilename(details.title, 'instagram_media');
		const asciiFilename =
			safeTitle
				.replace(/[^a-zA-Z0-9_.\- ]/g, ' ')
				.replace(/\s+/g, ' ')
				.trim() || 'instagram_media';

		const browserHeaders = {
			'User-Agent':
				'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36'
		};

		if (details.mediaType === 'image') {
			const candidates = details.imageCandidates || [];
			if (!candidates.length && !details.thumbnail) {
				return jsonResponse({ error: 'No image streams found for this Instagram post.' }, 400);
			}
			const imgUrl = candidates[0]?.url || details.thumbnail;
			const imgFetch = await fetch(imgUrl, { headers: browserHeaders });
			if (!imgFetch.ok || !imgFetch.body) {
				return jsonResponse({ error: 'Failed to download photo from Instagram CDN.' }, 400);
			}

			const encodedTitle = encodeURIComponent(`${safeTitle}.jpg`);
			const responseHeaders: Record<string, string> = {
				'Content-Type': 'image/jpeg',
				'Content-Disposition': `attachment; filename="${asciiFilename}.jpg"; filename*=UTF-8''${encodedTitle}`,
				'X-Video-Title': encodeURIComponent(safeTitle),
				'X-File-Type': 'jpg',
				...corsHeaders()
			};
			const contentLength = imgFetch.headers.get('content-length');
			if (contentLength) {
				responseHeaders['Content-Length'] = contentLength;
			}

			return new Response(imgFetch.body, {
				status: 200,
				headers: responseHeaders
			});
		}

		// Video / Reel download
		const versions = details.videoVersions || [];
		if (!versions.length) {
			return jsonResponse(
				{
					error:
						'Could not extract direct video stream for this reel. Please make sure the post or reel is public.'
				},
				400
			);
		}

		let selectedVersion = versions[0];
		if (quality && quality !== 'best') {
			const targetHeight = parseInt(quality, 10);
			const matched = versions.find((v) => v.height && v.height <= targetHeight);
			if (matched) selectedVersion = matched;
		}

		let vidFetch = await fetch(selectedVersion.url, { headers: browserHeaders }).catch(() => null);
		if ((!vidFetch || !vidFetch.ok || !vidFetch.body) && selectedVersion.backupUrl) {
			vidFetch = await fetch(selectedVersion.backupUrl, { headers: browserHeaders }).catch(
				() => null
			);
		}

		if (!vidFetch || !vidFetch.ok || !vidFetch.body) {
			return jsonResponse({ error: 'Failed to fetch video stream from Instagram CDN.' }, 400);
		}

		const fileExt = formatType === 'audio' ? 'm4a' : 'mp4';
		const contentType = formatType === 'audio' ? 'audio/mp4' : 'video/mp4';
		const encodedTitle = encodeURIComponent(`${safeTitle}.${fileExt}`);

		const responseHeaders: Record<string, string> = {
			'Content-Type': contentType,
			'Content-Disposition': `attachment; filename="${asciiFilename}.${fileExt}"; filename*=UTF-8''${encodedTitle}`,
			'X-Video-Title': encodeURIComponent(safeTitle),
			'X-File-Type': fileExt,
			...corsHeaders()
		};
		const contentLength = vidFetch.headers.get('content-length');
		if (contentLength) {
			responseHeaders['Content-Length'] = contentLength;
		}

		return new Response(vidFetch.body, {
			status: 200,
			headers: responseHeaders
		});
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : 'Download failed.';
		return jsonResponse({ error: msg }, 400);
	}
}

export async function handleYoutubeInfo(request: Request): Promise<Response> {
	try {
		const parsedUrl = new URL(request.url);
		let targetUrl = parsedUrl.searchParams.get('url');

		if (!targetUrl && request.method === 'POST') {
			const body = (await request.json().catch(() => ({}))) as { url?: string };
			targetUrl = body.url ?? null;
		}

		if (!targetUrl || !isYoutubeUrl(targetUrl)) {
			return jsonResponse({ error: 'Please enter a valid YouTube URL.' }, 400);
		}

		const videoId = extractYoutubeId(targetUrl) || '';

		// 1. Fetch official oEmbed metadata (reliable, unblocked, fast)
		const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(targetUrl)}&format=json`;
		const oembedRes = await fetch(oembedUrl);

		let title = 'YouTube Video';
		let uploader = '';
		let thumbnail = videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : '';

		if (oembedRes.ok) {
			const oembedData = (await oembedRes.json()) as OembedResponse;
			if (oembedData.title) title = oembedData.title;
			if (oembedData.author_name) uploader = oembedData.author_name;
			if (oembedData.thumbnail_url) thumbnail = oembedData.thumbnail_url;
		}

		// 2. Fetch duration & qualities via public Invidious instances if available
		let duration = 0;
		const availableQualities = [1080, 720, 480, 360];

		if (videoId) {
			try {
				const invRes = await fetch(`https://invidious.f5.si/api/v1/videos/${videoId}`, {
					signal: AbortSignal.timeout(2500)
				});
				if (invRes.ok) {
					const invData = (await invRes.json()) as InvidiousResponse;
					if (typeof invData.lengthSeconds === 'number') {
						duration = invData.lengthSeconds;
					}
					if (invData.title && title === 'YouTube Video') {
						title = invData.title;
					}
					if (invData.author && !uploader) {
						uploader = invData.author;
					}
				}
			} catch {
				// oEmbed already provided metadata
			}
		}

		return jsonResponse({
			id: videoId,
			title,
			duration,
			thumbnail,
			uploader,
			availableQualities
		});
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : 'Failed to fetch YouTube video info.';
		return jsonResponse({ error: msg }, 400);
	}
}

export async function handleYoutubeDownload(request: Request): Promise<Response> {
	try {
		const parsedUrl = new URL(request.url);
		let targetUrl = parsedUrl.searchParams.get('url');
		let formatType = parsedUrl.searchParams.get('formatType') || 'video';
		let quality = parsedUrl.searchParams.get('quality') || 'best';

		if (request.method === 'POST') {
			const body = (await request.json().catch(() => ({}))) as {
				url?: string;
				formatType?: string;
				quality?: string;
			};
			if (body.url) targetUrl = body.url;
			if (body.formatType) formatType = body.formatType;
			if (body.quality) quality = body.quality;
		}

		if (!targetUrl || !isYoutubeUrl(targetUrl)) {
			return jsonResponse({ error: 'Please enter a valid YouTube URL.' }, 400);
		}

		const videoId = extractYoutubeId(targetUrl);
		if (!videoId) {
			return jsonResponse({ error: 'Could not extract YouTube video ID.' }, 400);
		}

		// Fetch basic info for clean filename
		let title = 'youtube_video';
		try {
			const oembedRes = await fetch(
				`https://www.youtube.com/oembed?url=${encodeURIComponent(targetUrl)}&format=json`,
				{ signal: AbortSignal.timeout(2000) }
			);
			if (oembedRes.ok) {
				const oembedData = (await oembedRes.json()) as OembedResponse;
				if (oembedData.title) title = oembedData.title;
			}
		} catch {
			// fallback title
		}

		const safeTitle = sanitizeFilename(title, 'youtube_video');
		const asciiFilename =
			safeTitle
				.replace(/[^a-zA-Z0-9_.\- ]/g, ' ')
				.replace(/\s+/g, ' ')
				.trim() || 'youtube_video';

		// Attempt to resolve video/audio stream through public Invidious instance
		try {
			const invRes = await fetch(`https://invidious.f5.si/api/v1/videos/${videoId}`, {
				signal: AbortSignal.timeout(4000)
			});
			if (invRes.ok) {
				const invData = (await invRes.json()) as InvidiousResponse;
				const streams = invData.formatStreams || [];
				if (streams.length > 0) {
					// Quality selection: sort descending to prioritize highest/best quality matching the requested quality
					const validStreams = streams.filter((s) => Boolean(s.url));
					validStreams.sort((a, b) => {
						const resA =
							parseInt((a.qualityLabel || a.resolution || '360').replace(/[^0-9]/g, ''), 10) || 360;
						const resB =
							parseInt((b.qualityLabel || b.resolution || '360').replace(/[^0-9]/g, ''), 10) || 360;
						return resB - resA;
					});

					let selectedStream = validStreams[0];
					if (quality && quality !== 'best') {
						const targetHeight = parseInt(quality, 10);
						const matched = validStreams.find((s) => {
							const h = parseInt(
								(s.qualityLabel || s.resolution || '0').replace(/[^0-9]/g, ''),
								10
							);
							return h > 0 && h <= targetHeight;
						});
						if (matched) selectedStream = matched;
					}
					if (selectedStream && selectedStream.url) {
						const streamUrl = selectedStream.url;
						const streamFetch = await fetch(streamUrl, {
							signal: AbortSignal.timeout(10000)
						});
						if (streamFetch.ok && streamFetch.body) {
							const ext = formatType === 'audio' ? 'm4a' : 'mp4';
							const cType = formatType === 'audio' ? 'audio/mp4' : 'video/mp4';
							const encodedTitle = encodeURIComponent(`${safeTitle}.${ext}`);
							const streamHeaders: Record<string, string> = {
								'Content-Type': cType,
								'Content-Disposition': `attachment; filename="${asciiFilename}.${ext}"; filename*=UTF-8''${encodedTitle}`,
								'X-Video-Title': encodeURIComponent(safeTitle),
								'X-File-Type': ext,
								...corsHeaders()
							};
							const cl = streamFetch.headers.get('content-length');
							if (cl) {
								streamHeaders['Content-Length'] = cl;
							}

							return new Response(streamFetch.body, {
								status: 200,
								headers: streamHeaders
							});
						}
					}
				}
			}
		} catch {
			// fallback error message
		}

		return jsonResponse(
			{
				error:
					'Direct YouTube cloud download is currently restricted by YouTube bot protection. Please download the file or import directly using the "Computer" tab.'
			},
			400
		);
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : 'Download failed.';
		return jsonResponse({ error: msg }, 400);
	}
}

/**
 * Computes canonical 301 redirect target URL:
 * 1. Enforces HTTPS on public domains.
 * 2. Redirects www.thefreevideoeditor.com to apex domain thefreevideoeditor.com.
 * 3. Enforces trailing slashes on non-asset page routes (matching sitemap and Cloudflare Assets).
 * 4. Preserves query parameters.
 */
export function getCanonicalRedirect(url: URL): string | null {
	let changed = false;
	let protocol = url.protocol;
	let hostname = url.hostname;
	let pathname = url.pathname;

	const isLocal =
		hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.local');

	// Enforce HTTPS
	if (protocol === 'http:' && !isLocal) {
		protocol = 'https:';
		changed = true;
	}

	// Strip www. prefix
	if (hostname.startsWith('www.')) {
		hostname = hostname.replace(/^www\./, '');
		changed = true;
	}

	// Enforce trailing slash on page/directory paths
	// Do not add trailing slashes to API endpoints, _astro bundles, or files with an extension (.txt, .xml, .png, etc.)
	const isApi = pathname.startsWith('/api/');
	const isAstroAsset = pathname.startsWith('/_astro/');
	const hasFileExtension = /\.[a-zA-Z0-9]+$/.test(pathname);

	if (!isApi && !isAstroAsset && !hasFileExtension && !pathname.endsWith('/')) {
		pathname = `${pathname}/`;
		changed = true;
	}

	if (changed) {
		return `${protocol}//${hostname}${pathname}${url.search}`;
	}

	return null;
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		// Handle canonical 301 SEO redirects
		const canonicalRedirect = getCanonicalRedirect(url);
		if (canonicalRedirect && (request.method === 'GET' || request.method === 'HEAD')) {
			return new Response(null, {
				status: 301,
				headers: {
					Location: canonicalRedirect,
					'Cache-Control': 'public, max-age=86400'
				}
			});
		}

		// Handle CORS preflight
		if (request.method === 'OPTIONS') {
			return new Response(null, {
				status: 204,
				headers: corsHeaders()
			});
		}

		// Cloudflare Workers Native API Routing
		const pathname = url.pathname.replace(/\/+$/, '') || '/';
		if (pathname === '/api/youtube-info') {
			return handleYoutubeInfo(request);
		}
		if (pathname === '/api/download-youtube') {
			return handleYoutubeDownload(request);
		}
		if (pathname === '/api/instagram-info') {
			return handleInstagramInfo(request);
		}
		if (pathname === '/api/download-instagram') {
			return handleInstagramDownload(request);
		}

		// Fallback to Cloudflare Static Assets
		return env.ASSETS.fetch(request);
	}
};
