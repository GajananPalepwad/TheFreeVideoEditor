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
	const match = url.trim().match(/(?:watch\?v=|shorts\/|embed\/|v\/|live\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
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
		'Access-Control-Expose-Headers': 'Content-Length, Content-Disposition, X-Video-Title, X-File-Type'
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
interface InstagramMediaItem {
	caption?: { text?: string };
	user?: { username?: string; full_name?: string };
	video_duration?: number;
	video_versions?: Array<{ url: string; width?: number; height?: number }>;
	image_versions2?: { candidates?: Array<{ url: string; width?: number; height?: number }> };
}

interface InstagramGraphQLResponse {
	data?: {
		xdt_api__v1__media__shortcode__web_info?: {
			items?: InstagramMediaItem[];
		};
	};
}

interface InstagramDetails {
	id: string;
	title: string;
	uploader: string;
	duration: number;
	thumbnail: string;
	mediaType: 'video' | 'image';
	videoVersions: Array<{ url: string; width?: number; height?: number }>;
	imageCandidates: Array<{ url: string; width?: number; height?: number }>;
	availableQualities: number[];
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

async function fetchInstagramDetails(shortcode: string): Promise<InstagramDetails> {
	const cached = instagramCache.get(shortcode);
	if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
		return cached.details;
	}

	const variables = JSON.stringify({ shortcode });
	const encoded_variables = encodeURIComponent(variables);
	const payload = `av=0&__d=www&__user=0&__a=1&__req=u&__hs=20371.HYP%3Ainstagram_web_pkg.2.1...0&dpr=1&__ccg=GOOD&__rev=1028249517&__s=ywybjm%3Aq4co81%3Adplvd8&__hsi=7559456450740095677&__dyn=7xeUjG1mxu1syUbFp41twpUnwgU7SbzEdF8aUco2qwJw5ux609vCwjE1EE2Cw8G11wBz81s8hwGxu786a3a1YwBgao6C0Mo2swtUd8-U2zxe2GewGw9a361qw8Xxm16wa-0raazo7u3C2u2J0bS1LwTwKG0WE8oC1Iwqo5p0OwUQp1yU426V89F8uwm8jwhUaE4e1tyVrx60gm5oswFwtF85i5E&__csr=geIAaiFliZllsBav4trBuTJ-KJ5WhnQyAnxeEWpBCC-hJADG9AgG4qpQ8zat5BypWy9eaRgBaJ2Xx2p6WgymmGDzQjJo8JJ4iKi8xObCjx50FzLF4-8DiwxDyGqoydV-ESQ9DLAB_GdDzFEsyUSeG8xmF9oymWyqyVFF84q5ooHohwuE5a0CU01kUUb81CE12E5V08m0WFA0ei80n2bLwjp42TOw2J-0rq04tUKp06PwEhy1u1ig4Dgy9wdW0D8n80rl0UxGtw53hEx2E1yPUy7U1J9Q0JFvc0cXwpyG4B6B2US01IAw2Bo0K215w0YEwj8&__hsdp=gaQbh9gple4i4WuA2XCG7RVt5m8DxGU4K32awCF0GBcq1AyH40uWxe3AwboK5-0FE8UbkkU4-4o11XwQCyE9UswZweC4U6iq6UOewJyEhwBwjQ2259o1oE1E85u0km5Unw7Pwaau1CwMwkEeU1v82ew2rA0LoW0W8aO0Ewc6&__hblp=0nE20wpGx6vxy2i1ryE9Gg6q1hwkE9WwkocUso4O2vDyof98K7o4-48hDwyLBx61HwkGg8VoGqawDxCGBwQxG6S0I8jwywXBCxKczEqxaax62m1FDxim1nw4axq0oC362m0iu7ohBxu11wEwfm0AE421xDwhEvwxzEvG2-3K0nO0zE1MUK0DA1DwgEizEW0Qp-2Awa8nxyi1fwRBwFwau68bE&__comet_req=7&lsd=AdGtgRvhyjc&jazoest=21085&__spin_r=1028249517&__spin_b=trunk&__spin_t=1760073111&__crn=comet.igweb.PolarisLoggedOutDesktopPostRouteNext&fb_api_caller_class=RelayModern&fb_api_req_friendly_name=PolarisPostRootQuery&server_timestamps=true&variables=${encoded_variables}&doc_id=24368985919464652`;

	const headers = {
		accept: '*/*',
		'content-type': 'application/x-www-form-urlencoded',
		'user-agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
		'x-csrftoken': 'YuvV-QRvpR2Ggzgk0cTg1T',
		'x-ig-app-id': '936619743392459',
		Cookie: 'csrftoken=YuvV-QRvpR2Ggzgk0cTg1T; mid=aOia4gALAAHSq3em2E34YEIFkMCC'
	};

	const res = await fetch('https://www.instagram.com/graphql/query', {
		method: 'POST',
		headers,
		body: payload
	});

	if (!res.ok) {
		throw new Error(`Instagram query failed with HTTP ${res.status}`);
	}

	const json = (await res.json()) as InstagramGraphQLResponse;
	const items = json?.data?.xdt_api__v1__media__shortcode__web_info?.items;
	if (!items || items.length === 0) {
		throw new Error('Could not find media details. Please make sure the post or reel is public.');
	}

	const item = items[0];
	const caption = item.caption?.text?.trim() || '';
	const uploader = item.user?.username || item.user?.full_name || '';
	const duration = item.video_duration || 0;
	const videoVersions = item.video_versions || [];
	const imageCandidates = item.image_versions2?.candidates || [];
	const isVideo = videoVersions.length > 0;

	const thumbnail =
		(imageCandidates.length > 0 ? imageCandidates[0].url : '') ||
		(videoVersions.length > 0 ? videoVersions[0].url : '');

	const title = caption.slice(0, 80) || (isVideo ? 'Instagram Reel' : 'Instagram Photo');

	const availableHeights = Array.from(
		new Set(
			videoVersions
				.map((v) => v.height)
				.filter((h): h is number => typeof h === 'number' && h > 0)
		)
	).sort((a, b) => b - a);

	const details: InstagramDetails = {
		id: shortcode,
		title,
		uploader,
		duration,
		thumbnail,
		mediaType: isVideo ? 'video' : 'image',
		videoVersions,
		imageCandidates,
		availableQualities: availableHeights
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

		const details = await fetchInstagramDetails(shortcode);

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

		const details = await fetchInstagramDetails(shortcode);
		const safeTitle = sanitizeFilename(details.title, 'instagram_media');
		const asciiFilename =
			safeTitle
				.replace(/[^a-zA-Z0-9_.\- ]/g, ' ')
				.replace(/\s+/g, ' ')
				.trim() || 'instagram_media';

		if (details.mediaType === 'image') {
			const candidates = details.imageCandidates || [];
			if (!candidates.length) {
				return jsonResponse({ error: 'No image streams found for this Instagram post.' }, 400);
			}
			const imgUrl = candidates[0].url;
			const imgFetch = await fetch(imgUrl);
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
			return jsonResponse({ error: 'No video stream found for this Instagram reel/post.' }, 400);
		}

		let selectedVersion = versions[0];
		if (quality && quality !== 'best') {
			const targetHeight = parseInt(quality, 10);
			const matched = versions.find((v) => v.height && v.height <= targetHeight);
			if (matched) selectedVersion = matched;
		}

		const vidFetch = await fetch(selectedVersion.url);
		if (!vidFetch.ok || !vidFetch.body) {
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
							const h = parseInt((s.qualityLabel || s.resolution || '0').replace(/[^0-9]/g, ''), 10);
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
		hostname === 'localhost' ||
		hostname === '127.0.0.1' ||
		hostname.endsWith('.local');

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
		if (url.pathname === '/api/youtube-info') {
			return handleYoutubeInfo(request);
		}
		if (url.pathname === '/api/download-youtube') {
			return handleYoutubeDownload(request);
		}
		if (url.pathname === '/api/instagram-info') {
			return handleInstagramInfo(request);
		}
		if (url.pathname === '/api/download-instagram') {
			return handleInstagramDownload(request);
		}

		// Fallback to Cloudflare Static Assets
		return env.ASSETS.fetch(request);
	}
};

