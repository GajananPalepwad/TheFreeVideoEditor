/**
 * Discord Community Server Automated Provisioner
 * Uses Discord's Official REST API v10 (100% ToS Compliant).
 *
 * Usage:
 *   DISCORD_BOT_TOKEN="your_bot_token" GUILD_ID="your_guild_id" node scripts/setup-discord-server.mjs
 */

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID || '1562381370427183207';

if (!BOT_TOKEN) {
	console.error('❌ Error: DISCORD_BOT_TOKEN environment variable is required.');
	console.error('Usage: DISCORD_BOT_TOKEN="your_token" GUILD_ID="1562381370427183207" node scripts/setup-discord-server.mjs');
	process.exit(1);
}

const API_BASE = 'https://discord.com/api/v10';
const headers = {
	Authorization: `Bot ${BOT_TOKEN}`,
	'Content-Type': 'application/json',
	'User-Agent': 'TheFreeVideoEditor-SetupBot/1.0'
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(endpoint, options = {}) {
	const res = await fetch(`${API_BASE}${endpoint}`, {
		...options,
		headers: { ...headers, ...(options.headers || {}) }
	});

	if (res.status === 429) {
		const retryAfter = parseFloat(res.headers.get('retry-after') || '1') * 1000;
		console.log(`⏳ Rate limited. Retrying after ${retryAfter}ms...`);
		await delay(retryAfter + 200);
		return api(endpoint, options);
	}

	if (!res.ok) {
		const text = await res.text();
		throw new Error(`API ${options.method || 'GET'} ${endpoint} failed (${res.status}): ${text}`);
	}

	if (res.status === 204) return null;
	return res.json();
}

async function getExistingChannels() {
	return await api(`/guilds/${GUILD_ID}/channels`);
}

async function createChannel(name, type, parentId = null, topic = null) {
	const payload = {
		name,
		type // 0 = text, 2 = voice, 4 = category
	};
	if (parentId) payload.parent_id = parentId;
	if (topic) payload.topic = topic;

	const channel = await api(`/guilds/${GUILD_ID}/channels`, {
		method: 'POST',
		body: JSON.stringify(payload)
	});
	console.log(`  ✓ Created [${type === 4 ? 'Category' : type === 2 ? 'Voice' : 'Text'}]: ${name}`);
	await delay(350); // Be respectful to Discord API rate limits
	return channel;
}

async function sendMessage(channelId, content) {
	await api(`/channels/${channelId}/messages`, {
		method: 'POST',
		body: JSON.stringify({ content })
	});
	console.log(`  💬 Sent announcement message to channel`);
	await delay(300);
}

async function createPermanentInvite(channelId) {
	const invite = await api(`/channels/${channelId}/invites`, {
		method: 'POST',
		body: JSON.stringify({
			max_age: 0, // never expire
			max_uses: 0, // unlimited
			unique: true
		})
	});
	return `https://discord.gg/${invite.code}`;
}

async function main() {
	console.log(`🚀 Connecting to Discord Guild: ${GUILD_ID}...`);

	const guild = await api(`/guilds/${GUILD_ID}`);
	console.log(`🏰 Found Guild: "${guild.name}"`);

	const existing = await getExistingChannels();
	const existingByName = new Map(existing.map((c) => [c.name.toLowerCase(), c]));

	// Server Architecture Definition
	const ARCHITECTURE = [
		{
			category: '📁 WELCOME & ANNOUNCEMENTS',
			channels: [
				{
					name: 'welcome',
					type: 0,
					topic: 'Welcome to The Free Video Editor community! Links, resources, and getting started.',
					message: `👋 **Welcome to The Free Video Editor Community!**\n\nThe Free Video Editor (TFVE) is a modern, privacy-first, in-browser video editor built with WebCodecs, WebGL2, and the Web Audio API. 100% on-device, zero telemetry.\n\n🔗 **GitHub Repository**: https://github.com/GajananPalepwad/TheFreeVideoEditor\n🔗 **Documentation**: Check out our guides in the repo!\n\n👉 Check out <#rules-and-faq> to get started, or drop into <#dev-general> to introduce yourself!`
				},
				{
					name: 'rules-and-faq',
					type: 0,
					topic: 'Community guidelines, code of conduct, and FAQ.',
					message: `📜 **Community Rules & Guidelines**\n\n1. **Be Respectful & Welcoming**: Harassment, hate speech, and toxicity will not be tolerated.\n2. **Keep Topics in Their Channels**: Engineering in <#dev-general>, exported video clips in <#showcase>, bugs in <#bug-reports>.\n3. **Open Source & Privacy First**: TFVE is strictly on-device with zero telemetry. Do not post or promote tracking/analytics tools or cloud data collection.\n4. **No Spam or Self-Promotion**: Unsolicited advertisements, affiliate links, and bot invites are not allowed.\n5. **Bug Reporting**: Before opening an issue, check existing GitHub issues or post in <#bug-reports> with your browser version and OS.`
				},
				{
					name: 'announcements',
					type: 0,
					topic: 'Official project announcements and release notes.'
				},
				{
					name: 'roles',
					type: 0,
					topic: 'Information on community roles (Core Dev, Contributor, Creator, Beta Tester).'
				}
			]
		},
		{
			category: '📁 DEVELOPMENT & GITHUB',
			channels: [
				{
					name: 'github-feed',
					type: 0,
					topic: 'Automated live feed for GitHub commits, pull requests, issues, and releases.'
				},
				{
					name: 'dev-general',
					type: 0,
					topic: 'General engineering discussion (Astro, React, TypeScript, Vite, Tailwind).'
				},
				{
					name: 'good-first-issues',
					type: 0,
					topic: 'Mentorship and guidance for contributors working on beginner-friendly issues.'
				},
				{
					name: 'bug-reports',
					type: 0,
					topic: 'Reproduction steps, console logs, and bug discussion before opening GitHub issues.'
				}
			]
		},
		{
			category: '📁 CREATORS & SHOWCASE',
			channels: [
				{
					name: 'showcase',
					type: 0,
					topic: 'Share your exported videos, edits, motion templates, and creations.'
				},
				{
					name: 'feature-requests',
					type: 0,
					topic: 'Ideas, feedback, and user experience proposals for the editor.'
				},
				{
					name: 'help-and-support',
					type: 0,
					topic: 'Troubleshooting export, codec support, timelines, and editing workflows.'
				}
			]
		},
		{
			category: '📁 SPECIALIZED LABS',
			channels: [
				{
					name: 'audio-and-dsp',
					type: 0,
					topic: 'Web Audio API, Fairlight mixer, WSOLA pitch stretch, biquad EQ, dynamics DSP.'
				},
				{
					name: 'ai-and-transcription',
					type: 0,
					topic: 'Whisper speech-to-text ONNX, silence trimming, and take alignment algorithms.'
				},
				{
					name: 'graphics-and-motion',
					type: 0,
					topic: 'WebGL2 shaders, motion templates (.grafree), vector masks, and keyframing.'
				}
			]
		},
		{
			category: '🔊 VOICE CHANNELS',
			channels: [
				{ name: 'Community Lounge', type: 2 },
				{ name: 'Pair Programming 1', type: 2 },
				{ name: 'Pair Programming 2', type: 2 },
				{ name: 'Town Hall / Stage', type: 2 }
			]
		}
	];

	let inviteChannelId = null;

	for (const cat of ARCHITECTURE) {
		console.log(`\n📂 Setting up: ${cat.category}`);
		let categoryNode = existingByName.get(cat.category.toLowerCase());
		if (!categoryNode || categoryNode.type !== 4) {
			categoryNode = await createChannel(cat.category, 4);
		} else {
			console.log(`  ℹ Category already exists: ${cat.category}`);
		}

		for (const ch of cat.channels) {
			let channelNode = existingByName.get(ch.name.toLowerCase());
			if (!channelNode) {
				channelNode = await createChannel(ch.name, ch.type, categoryNode.id, ch.topic);
				if (ch.message) {
					await sendMessage(channelNode.id, ch.message);
				}
			} else {
				console.log(`  ℹ Channel already exists: ${ch.name}`);
			}

			if (!inviteChannelId && ch.name === 'welcome') {
				inviteChannelId = channelNode.id;
			}
		}
	}

	console.log('\n🔗 Generating permanent invite link...');
	if (inviteChannelId) {
		try {
			const inviteUrl = await createPermanentInvite(inviteChannelId);
			console.log(`\n🎉 Discord Server Setup Complete!`);
			console.log(`🌟 Permanent Invite Link: ${inviteUrl}\n`);
		} catch (err) {
			console.log(`⚠️ Could not auto-generate invite: ${err.message}`);
		}
	} else {
		console.log(`🎉 Discord Server Setup Complete!`);
	}
}

main().catch((err) => {
	console.error('❌ Fatal error:', err);
	process.exit(1);
});
