// Options for the API features switched on in production on 2026-11-25, and a
// guard that nothing that is off there reaches the node. Runs the
// compiled node's execute() with a fake n8n context and checks the request.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { UploadPost } = require(path.join(__dirname, '..', 'dist/nodes/UploadPost/UploadPost.node.js'));

const run = async (params) => {
	const calls = [];
	const ctx = {
		getInputData: () => [{ json: {} }],
		getNodeParameter: (name, _itemIndex, fallback) => {
			if (Object.prototype.hasOwnProperty.call(params, name)) return params[name];
			if (fallback !== undefined) return fallback;
			throw new Error(`missing parameter ${name}`);
		},
		getNode: () => ({ id: 'node-1', name: 'Upload Post', type: 'uploadPost', typeVersion: 1 }),
		getExecutionId: () => 'exec-1',
		helpers: {
			httpRequestWithAuthentication: async (_credential, options) => {
				calls.push(options);
				return { success: true };
			},
			httpRequest: async (options) => {
				calls.push(options);
				return { success: true };
			},
		},
	};
	await new UploadPost().execute.call(ctx);
	assert.equal(calls.length, 1);
	return calls[0];
};

const formFields = (req) => {
	const out = {};
	for (const [key, value] of req.body.entries()) {
		if (key in out) out[key] = [].concat(out[key], value);
		else out[key] = value;
	}
	return out;
};

const upload = (operation, extra) => ({
	resource: 'uploads',
	operation,
	user: 'acme',
	title: 'Hello',
	uploadAsync: false,
	...(operation === 'uploadVideo' ? { video: 'https://example.com/v.mp4' } : {}),
	...(operation === 'uploadPhotos' ? { photos: 'https://example.com/a.jpg' } : {}),
	...extra,
});


const fs = require('node:fs');
const SOURCES = ['nodes/UploadPost/UploadPost.node.ts', 'nodes/UploadPost/NetworkOperations.ts', 'README.md']
	.map((f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')).join('\n');

test('nothing that is off in production is offered', () => {
	for (const marker of [
		'/ads/meta', '/ads/tiktok', 'reposts_of_me', 'instagram_connection', 'instagram_audio_id', 'instagram_paid_partnership',
		'instagram_poll', 'instagram_product_tags', 'threads_location_id', 'threads_enable_reply_approvals',
		'threads_allowlisted_country_codes', 'threads_share_to_instagram', 'facebook_tags', 'linkedin/reactions',
		'participant_ids', 'include_users', 'Not Generally Available Yet', 'whatsapp/flows', 'visitor-posts',
	]) {
		assert.ok(!SOURCES.includes(marker), marker);
	}
});

test('Threads options, each only where the API reads it', async () => {
	const options = { gifId: 'g1', ghostPost: true, spoilerMedia: true, textSpoilers: '[{"offset": 0, "length": 5}]' };
	const text = formFields(await run(upload('uploadText', { platform: ['threads'], threadsPostOptions: options })));
	assert.equal(text.threads_gif_id, 'g1');
	assert.equal(text.threads_ghost_post, 'true');
	assert.equal(text.threads_spoiler_media, undefined);
	assert.equal(text.threads_text_spoilers, '[{"offset":0,"length":5}]');
	const photos = formFields(await run(upload('uploadPhotos', { platform: ['threads'], threadsPostOptions: options })));
	assert.equal(photos.threads_spoiler_media, 'true');
	assert.equal(photos.threads_gif_id, undefined);
	assert.equal(photos.threads_ghost_post, undefined);
});

test('Facebook text options: backdating', async () => {
	const f = formFields(await run(upload('uploadText', {
		platform: ['facebook'],
		facebookPageId: 'page-1',
		facebookTextOptions: { backdatedTime: '2020-01-01T00:00:00Z', backdatedTimeGranularity: 'day' },
	})));
	assert.equal(f.facebook_backdated_time, '2020-01-01T00:00:00Z');
	assert.equal(f.facebook_backdated_time_granularity, 'day');
});

test('Instagram: a single video through Upload Photos takes the Reel fields', async () => {
	const f = formFields(await run(upload('uploadPhotos', {
		platform: ['instagram'],
		instagramPhotoVideoOptions: { coverUrl: 'https://e.com/c.jpg', thumbOffset: '1500', shareToFeed: false, audioName: 'Song' },
	})));
	assert.equal(f.cover_url, 'https://e.com/c.jpg');
	assert.equal(f.thumb_offset, '1500');
	assert.equal(f.share_to_feed, 'false');
	assert.equal(f.audio_name, 'Song');
});

test('without the new options no new field is sent', async () => {
	const f = formFields(await run(upload('uploadText', { platform: ['threads', 'facebook'], facebookPageId: 'page-1' })));
	for (const key of Object.keys(f)) {
		assert.ok(!/^(threads_(gif|ghost|spoiler|text_spoilers)|facebook_backdated)/.test(key), key);
	}
});

test('options of a network that is not selected are not sent', async () => {
	const f = formFields(await run(upload('uploadText', { platform: ['bluesky'], threadsPostOptions: { gifId: 'g1' } })));
	assert.equal(f.threads_gif_id, undefined);
});

test('create comment: image URL on TikTok only', async () => {
	const base = { resource: 'instagram', operation: 'createComment', instagramUser: 'acme', createCommentMessage: 'Hi', createCommentPostId: 'v1', createCommentImageUrl: 'https://e.com/a.jpg' };
	const tiktok = await run({ ...base, commentPlatform: 'tiktok' });
	assert.equal(tiktok.body.image_url, 'https://e.com/a.jpg');
	const facebook = await run({ ...base, commentPlatform: 'facebook' });
	assert.equal(facebook.body.image_url, undefined);
});

test('suggestions: trending with personalized', async () => {
	const req = await run({ resource: 'insights', operation: 'getSuggestions', insightsUser: 'acme', insightsPlatform: 'tiktok', suggestionsType: 'trending', suggestionsPersonalized: true });
	assert.equal(req.qs.type, 'trending');
	assert.equal(req.qs.personalized, 'true');
	const plain = await run({ resource: 'insights', operation: 'getSuggestions', insightsUser: 'acme', insightsPlatform: 'tiktok', suggestionsType: 'hashtags', suggestionsQuery: 'cats' });
	assert.equal(plain.qs.personalized, undefined);
});
