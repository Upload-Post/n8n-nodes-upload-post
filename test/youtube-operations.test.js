// Runs the compiled node's execute() for the YouTube operations and the new
// Upload Video fields, and checks the HTTP request each one sends.
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
			getBinaryDataBuffer: async () => Buffer.from(''),
		},
	};
	await new UploadPost().execute.call(ctx);
	assert.equal(calls.length, 1);
	return calls[0];
};

const API = 'https://api.upload-post.com/api/uploadposts/youtube';
const yt = (operation, extra = {}) => run({ resource: 'youtube', operation, youtubeProfile: 'acme', ...extra });

test('quota needs no profile', async () => {
	const req = await run({ resource: 'youtube', operation: 'getYoutubeQuota' });
	assert.equal(req.method, 'GET');
	assert.equal(req.url, `${API}/quota`);
	assert.deepEqual(req.qs, {});
});

test('videos need ids, chart or my rating', async () => {
	const req = await yt('getYoutubeVideos', { youtubeVideoIds: 'a,b', youtubeParts: 'snippet' });
	assert.equal(req.url, `${API}/videos`);
	assert.deepEqual(req.qs, { user: 'acme', ids: 'a,b', parts: 'snippet' });
	await assert.rejects(yt('getYoutubeVideos'), /Video IDs, Chart or My Rating/);
});

test('playlists: list, create, update, delete with confirm, items', async () => {
	const list = await yt('listYoutubePlaylists', { youtubeMaxResults: 25 });
	assert.deepEqual(list.qs, { user: 'acme', max_results: 25 });

	const create = await yt('createYoutubePlaylist', { youtubeTitle: 'Tutorials', youtubePrivacyStatus: 'unlisted', youtubeExtraFields: '{"default_language": "en"}' });
	assert.equal(create.method, 'POST');
	assert.equal(create.url, `${API}/playlists`);
	assert.deepEqual(create.body, { user: 'acme', title: 'Tutorials', privacy_status: 'unlisted', default_language: 'en' });

	const update = await yt('updateYoutubePlaylist', { youtubePlaylistId: 'PL1', youtubeDescription: 'New' });
	assert.equal(update.method, 'PATCH');
	assert.equal(update.url, `${API}/playlists/PL1`);
	assert.deepEqual(update.body, { user: 'acme', description: 'New' });
	await assert.rejects(yt('updateYoutubePlaylist', { youtubePlaylistId: 'PL1' }), /Nothing to update/);

	const noConfirm = await yt('deleteYoutubePlaylist', { youtubePlaylistId: 'PL1' });
	assert.equal(noConfirm.method, 'DELETE');
	assert.deepEqual(noConfirm.qs, { user: 'acme' });
	const del = await yt('deleteYoutubePlaylist', { youtubePlaylistId: 'PL1', youtubeConfirm: true });
	assert.deepEqual(del.qs, { user: 'acme', confirm: 'true' });

	const add = await yt('addYoutubePlaylistItem', { youtubePlaylistId: 'PL1', youtubeVideoId: 'vid', youtubePosition: 0 });
	assert.equal(add.url, `${API}/playlists/PL1/items`);
	assert.deepEqual(add.body, { user: 'acme', video_id: 'vid', position: 0 });
	const addEnd = await yt('addYoutubePlaylistItem', { youtubePlaylistId: 'PL1', youtubeVideoId: 'vid' });
	assert.deepEqual(addEnd.body, { user: 'acme', video_id: 'vid' });

	const remove = await yt('removeYoutubePlaylistItem', { youtubePlaylistId: 'PL1', youtubeItemId: 'IT9', youtubeConfirm: true });
	assert.equal(remove.url, `${API}/playlists/PL1/items/IT9`);
	assert.deepEqual(remove.qs, { user: 'acme', confirm: 'true' });
});

test('comments: threads, replies, reply, delete, moderate', async () => {
	const inbox = await yt('listYoutubeComments', { youtubeChannelScope: true, youtubeModerationStatus: 'heldForReview' });
	assert.deepEqual(inbox.qs, { user: 'acme', scope: 'channel', moderation_status: 'heldForReview' });
	await assert.rejects(yt('listYoutubeComments'), /Video ID or turn on Whole Channel/);

	const replies = await yt('listYoutubeCommentReplies', { youtubeParentId: 'c1' });
	assert.equal(replies.url, `${API}/comments/replies`);

	const reply = await yt('createYoutubeComment', { youtubeText: 'Thanks!', youtubeParentId: 'c1', youtubeVideoId: 'vid' });
	assert.deepEqual(reply.body, { user: 'acme', text: 'Thanks!', parent_id: 'c1' });

	const del = await yt('deleteYoutubeComment', { youtubeCommentId: 'c2' });
	assert.equal(del.url, `${API}/comments/c2`);
	assert.deepEqual(del.qs, { user: 'acme' });

	const reject = await yt('moderateYoutubeComments', { youtubeCommentIds: 'a, b', youtubeModerationAction: 'rejected', youtubeBanAuthor: true, youtubeConfirm: true });
	assert.equal(reject.url, `${API}/comments/moderate`);
	assert.deepEqual(reject.body, { user: 'acme', comment_ids: ['a', 'b'], status: 'rejected', ban_author: true, confirm: true });
	const approve = await yt('moderateYoutubeComments', { youtubeCommentIds: 'a', youtubeBanAuthor: true });
	assert.deepEqual(approve.body, { user: 'acme', comment_ids: ['a'], status: 'published' });
});

test('channel, search and live', async () => {
	const channel = await yt('updateYoutubeChannel', { youtubeKeywords: 'vlog "video editing"' });
	assert.equal(channel.method, 'PATCH');
	assert.deepEqual(channel.body, { user: 'acme', keywords: 'vlog "video editing"' });

	const search = await yt('searchYoutube', { youtubeForMine: true, youtubeChannelId: 'UC1', youtubeOrder: 'date' });
	assert.deepEqual(search.qs, { user: 'acme', type: 'video', for_mine: 'true', order: 'date' });
	await assert.rejects(yt('searchYoutube'), /Query, Only My Videos or Channel ID/);

	const live = await yt('createYoutubeBroadcast', {
		youtubeTitle: 'Launch',
		youtubeScheduledStartTime: '2026-12-01T18:00:00Z',
		youtubePrivacyStatus: 'public',
		youtubeCreateStream: true,
	});
	assert.equal(live.url, `${API}/live/broadcasts`);
	assert.deepEqual(live.body, { user: 'acme', title: 'Launch', scheduled_start_time: '2026-12-01T18:00:00Z', privacy_status: 'public', create_stream: true });
	await assert.rejects(yt('createYoutubeBroadcast', { youtubeTitle: 'x', youtubeScheduledStartTime: 'y' }), /Privacy Status/);
});

const formFields = (req) => {
	const out = {};
	for (const [key, value] of req.body.entries()) out[key] = value;
	return out;
};

test('upload video sends youtube_localizations and youtube_brand_partner only when filled', async () => {
	const base = {
		resource: 'uploads',
		operation: 'uploadVideo',
		user: 'acme',
		title: 'Hello',
		uploadAsync: false,
		platform: ['youtube'],
		video: 'https://example.com/v.mp4',
	};
	const req = await run({ ...base, youtubeLocalizations: '{"es": {"title": "Hola"}}', youtubeBrandPartner: 'UC123' });
	const f = formFields(req);
	assert.equal(f.youtube_localizations, '{"es":{"title":"Hola"}}');
	assert.equal(f.youtube_brand_partner, 'UC123');
	const plain = formFields(await run(base));
	assert.equal(plain.youtube_localizations, undefined);
	assert.equal(plain.youtube_brand_partner, undefined);
	await assert.rejects(run({ ...base, youtubeLocalizations: '[1]' }), /JSON object keyed by language/);
});
