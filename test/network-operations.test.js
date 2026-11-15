// Runs the compiled node's execute() with a fake n8n context and checks the HTTP
// request of the best time / queue / Telegram / Bluesky / Google Business
// operations and of the new upload options.
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

const API = 'https://api.upload-post.com/api';

test('get best times sends the query and only the page id of its network', async () => {
	const req = await run({
		resource: 'queue',
		operation: 'getBestTimes',
		networkProfile: 'acme',
		bestTimesPlatform: 'linkedin',
		queueTimezone: 'Europe/Madrid',
		bestTimesTop: 3,
		queueRefresh: true,
		bestTimesPageUrn: 'urn:li:organization:1',
		bestTimesFacebookPageId: '999',
	});
	assert.equal(req.method, 'GET');
	assert.equal(req.url, `${API}/uploadposts/best-times`);
	assert.deepEqual(req.qs, {
		profile_username: 'acme',
		platform: 'linkedin',
		timezone: 'Europe/Madrid',
		top: 3,
		refresh: 'true',
		page_urn: 'urn:li:organization:1',
	});
});

test('update queue settings: automatic slots', async () => {
	const req = await run({
		resource: 'queue',
		operation: 'updateQueueSettings',
		networkProfile: 'acme',
		queueSlotsMode: 'auto',
		queueAutoSlotsCount: 3,
		queueAutoPlatforms: ['instagram', 'tiktok'],
		queueTimezone: 'Europe/Madrid',
		queueDaysOfWeek: '0, 1,2',
	});
	assert.equal(req.method, 'POST');
	assert.equal(req.url, `${API}/uploadposts/queue/settings`);
	assert.deepEqual(req.body, {
		profile_username: 'acme',
		timezone: 'Europe/Madrid',
		slots_mode: 'auto',
		auto_slots_count: 3,
		auto_platforms: ['instagram', 'tiktok'],
		days_of_week: [0, 1, 2],
	});
});

test('update queue settings: fixed slots, and nothing to update is refused', async () => {
	const req = await run({
		resource: 'queue',
		operation: 'updateQueueSettings',
		networkProfile: 'acme',
		queueSlotsMode: 'fixed',
		queueSlots: '[{"hour": 9, "minute": 0}]',
	});
	assert.deepEqual(req.body, { profile_username: 'acme', slots: [{ hour: 9, minute: 0 }] });
	const back = await run({ resource: 'queue', operation: 'updateQueueSettings', networkProfile: 'acme', queueSlotsMode: 'fixed' });
	assert.deepEqual(back.body, { profile_username: 'acme', slots_mode: 'fixed' });
	await assert.rejects(
		run({ resource: 'queue', operation: 'updateQueueSettings', networkProfile: 'acme' }),
		/Nothing to update/,
	);
	await assert.rejects(
		run({ resource: 'queue', operation: 'updateQueueSettings', networkProfile: 'acme', queueDaysOfWeek: '7' }),
		/Days of Week/,
	);
});

test('queue reads', async () => {
	const preview = await run({ resource: 'queue', operation: 'getQueuePreview', networkProfile: 'acme', queuePreviewCount: 5 });
	assert.equal(preview.url, `${API}/uploadposts/queue/preview`);
	assert.deepEqual(preview.qs, { profile_username: 'acme', count: 5 });
	const next = await run({ resource: 'queue', operation: 'getNextQueueSlot', networkProfile: 'acme' });
	assert.equal(next.url, `${API}/uploadposts/queue/next-slot`);
	const settings = await run({ resource: 'queue', operation: 'getQueueSettings', networkProfile: 'acme' });
	assert.equal(settings.method, 'GET');
	assert.deepEqual(settings.qs, { profile_username: 'acme' });
});

test('telegram chat, members and invite links', async () => {
	const info = await run({ resource: 'telegram', operation: 'getTelegramChatInfo', networkProfile: 'acme' });
	assert.equal(info.url, `${API}/uploadposts/telegram/chat-info`);
	assert.deepEqual(info.qs, { user: 'acme' });
	const noAdmins = await run({ resource: 'telegram', operation: 'getTelegramChatInfo', networkProfile: 'acme', telegramIncludeAdministrators: false });
	assert.deepEqual(noAdmins.qs, { user: 'acme', include_administrators: 'false' });

	const update = await run({
		resource: 'telegram',
		operation: 'updateTelegramChatInfo',
		networkProfile: 'acme',
		telegramChatTitle: 'My Channel',
		telegramExtraFields: '{"permissions": {"can_send_messages": false}}',
	});
	assert.equal(update.method, 'PATCH');
	assert.deepEqual(update.body, { user: 'acme', title: 'My Channel', permissions: { can_send_messages: false } });

	const ban = await run({
		resource: 'telegram',
		operation: 'moderateTelegramMember',
		networkProfile: 'acme',
		telegramMemberAction: 'ban',
		telegramUserId: '42',
		telegramConfirm: true,
	});
	assert.equal(ban.url, `${API}/uploadposts/telegram/members`);
	assert.deepEqual(ban.body, { user: 'acme', action: 'ban', user_id: '42', confirm: true });

	const link = await run({
		resource: 'telegram',
		operation: 'createTelegramInviteLink',
		networkProfile: 'acme',
		telegramInviteName: 'Launch',
		telegramInviteMemberLimit: 10,
	});
	assert.deepEqual(link.body, { user: 'acme', name: 'Launch', member_limit: 10 });

	const revoke = await run({
		resource: 'telegram',
		operation: 'revokeTelegramInviteLink',
		networkProfile: 'acme',
		telegramInviteLink: 'https://t.me/+abc',
	});
	assert.equal(revoke.method, 'DELETE');
	assert.deepEqual(revoke.body, { user: 'acme', invite_link: 'https://t.me/+abc' });
});

test('telegram bot commands and profile', async () => {
	const set = await run({
		resource: 'telegram',
		operation: 'setTelegramBotCommands',
		networkProfile: 'acme',
		telegramCommands: { command: [{ command: '/start', description: 'Start' }, { command: '', description: '' }] },
		telegramLanguageCode: 'es',
	});
	assert.equal(set.url, `${API}/uploadposts/telegram/bot-commands`);
	assert.deepEqual(set.body, { user: 'acme', commands: [{ command: 'start', description: 'Start' }], language_code: 'es' });
	await assert.rejects(
		run({ resource: 'telegram', operation: 'setTelegramBotCommands', networkProfile: 'acme', telegramCommands: {} }),
		/at least one command/,
	);
	const profile = await run({
		resource: 'telegram',
		operation: 'updateTelegramBotProfile',
		networkProfile: 'acme',
		telegramBotShortDescription: 'News bot',
	});
	assert.equal(profile.method, 'PATCH');
	assert.deepEqual(profile.body, { user: 'acme', short_description: 'News bot' });
});

test('bluesky reads and drafts', async () => {
	const search = await run({
		resource: 'bluesky',
		operation: 'searchBlueskyPosts',
		networkProfile: 'acme',
		blueskyQuery: 'upload-post',
		blueskySort: 'latest',
		blueskyPageSize: 25,
	});
	assert.equal(search.url, `${API}/uploadposts/bluesky/search/posts`);
	assert.deepEqual(search.qs, { user: 'acme', q: 'upload-post', sort: 'latest', limit: 25 });

	const notifications = await run({
		resource: 'bluesky',
		operation: 'getBlueskyNotifications',
		networkProfile: 'acme',
		blueskyReasons: ['reply', 'mention'],
	});
	assert.equal(notifications.url, `${API}/uploadposts/bluesky/notifications`);
	assert.deepEqual(notifications.qs, { user: 'acme', reasons: 'reply,mention' });

	const profile = await run({ resource: 'bluesky', operation: 'getBlueskyProfile', networkProfile: 'acme', blueskyActor: 'alice.bsky.social' });
	assert.deepEqual(profile.qs, { user: 'acme', actor: 'alice.bsky.social' });

	const draft = await run({
		resource: 'bluesky',
		operation: 'createBlueskyDraft',
		networkProfile: 'acme',
		blueskyDraftText: 'Launch day',
		blueskyDraftLangs: 'en',
	});
	assert.equal(draft.method, 'POST');
	assert.equal(draft.url, `${API}/uploadposts/bluesky/drafts`);
	assert.deepEqual(draft.body, { user: 'acme', text: 'Launch day', langs: 'en' });

	const remove = await run({
		resource: 'bluesky',
		operation: 'deleteBlueskyDraft',
		networkProfile: 'acme',
		blueskyDraftId: '3lbq',
		blueskyConfirm: true,
	});
	assert.equal(remove.method, 'DELETE');
	assert.equal(remove.url, `${API}/uploadposts/bluesky/drafts/3lbq`);
	assert.deepEqual(remove.body, { user: 'acme', confirm: true });
});

test('google business posts, reviews, performance and location info', async () => {
	const posts = await run({
		resource: 'googleBusiness',
		operation: 'listGbpPosts',
		networkProfile: 'acme',
		gbpApiLocationId: 'locations/1',
		gbpApiPageSize: 10,
	});
	assert.equal(posts.url, `${API}/uploadposts/google-business/posts`);
	assert.deepEqual(posts.qs, { user: 'acme', location_id: 'locations/1', page_size: 10 });

	const post = await run({ resource: 'googleBusiness', operation: 'getGbpPost', networkProfile: 'acme', gbpApiPostId: 'accounts/1/locations/2/localPosts/3' });
	assert.equal(post.url, `${API}/uploadposts/google-business/posts/get`);
	assert.deepEqual(post.qs, { user: 'acme', post_id: 'accounts/1/locations/2/localPosts/3' });

	const reviews = await run({ resource: 'googleBusiness', operation: 'listGbpReviews', networkProfile: 'acme', gbpApiOrderBy: 'rating' });
	assert.deepEqual(reviews.qs, { user: 'acme', order_by: 'rating' });

	const review = await run({ resource: 'googleBusiness', operation: 'getGbpReview', networkProfile: 'acme', gbpApiReviewName: 'accounts/1/locations/2/reviews/9' });
	assert.equal(review.url, `${API}/uploadposts/google-business/reviews/get`);

	const perf = await run({
		resource: 'googleBusiness',
		operation: 'getGbpPerformance',
		networkProfile: 'acme',
		gbpApiMetrics: 'CALL_CLICKS',
		gbpApiStartDate: '2026-10-01',
	});
	assert.equal(perf.url, `${API}/uploadposts/google-business/performance`);
	assert.deepEqual(perf.qs, { user: 'acme', metrics: 'CALL_CLICKS', start_date: '2026-10-01' });

	const keywords = await run({ resource: 'googleBusiness', operation: 'getGbpSearchKeywords', networkProfile: 'acme', gbpApiStartMonth: '2026-09' });
	assert.equal(keywords.url, `${API}/uploadposts/google-business/performance/keywords`);

	const legacy = await run({
		resource: 'googleBusiness',
		operation: 'updateGbpLocationInfo',
		networkProfile: 'acme',
		gbpApiDescription: 'Best coffee',
		gbpApiDryRun: true,
		googleBusinessConfirm: true,
	});
	assert.equal(legacy.method, 'PATCH');
	assert.equal(legacy.url, `${API}/uploadposts/google-business/location-info`);
	// dry_run and confirm only exist in strict mode
	assert.deepEqual(legacy.body, { user: 'acme', edit_mode: 'legacy', description: 'Best coffee' });

	const strict = await run({
		resource: 'googleBusiness',
		operation: 'updateGbpLocationInfo',
		networkProfile: 'acme',
		gbpApiEditMode: 'strict',
		gbpApiDryRun: true,
		googleBusinessExtraFields: '{"open_status": "OPEN"}',
	});
	assert.deepEqual(strict.body, { user: 'acme', edit_mode: 'strict', dry_run: true, open_status: 'OPEN' });
	await assert.rejects(
		run({ resource: 'googleBusiness', operation: 'updateGbpLocationInfo', networkProfile: 'acme', googleBusinessExtraFields: '[1]' }),
		/must be a JSON object/,
	);
});

test('telegram post actions: edit, forward/copy, delete all messages', async () => {
	const edit = await run({
		resource: 'postActions',
		operation: 'editPost',
		postActionPlatform: 'telegram',
		postActionUser: 'acme',
		postActionPostId: '812',
		postActionMessage: 'Fixed',
		telegramEditAction: 'pin',
	});
	assert.equal(edit.url, `${API}/uploadposts/posts/edit`);
	assert.deepEqual(edit.body, { platform: 'telegram', user: 'acme', post_id: '812', text: 'Fixed', action: 'pin' });

	const copy = await run({
		resource: 'postActions',
		operation: 'repostPost',
		repostPlatform: 'telegram',
		postActionUser: 'acme',
		postActionPostId: '812',
		postActionMessage: 'Now here too',
		telegramRepostMode: 'copy',
		telegramRepostTargetChatId: '@other',
	});
	assert.deepEqual(copy.body, {
		platform: 'telegram',
		user: 'acme',
		post_id: '812',
		mode: 'copy',
		target_chat_id: '@other',
		caption: 'Now here too',
	});

	const forward = await run({ resource: 'postActions', operation: 'repostPost', repostPlatform: 'telegram', postActionUser: 'acme', postActionPostId: '812' });
	assert.deepEqual(forward.body, { platform: 'telegram', user: 'acme', post_id: '812', mode: 'forward' });

	const unpublish = await run({
		resource: 'postActions',
		operation: 'unpublishPost',
		postActionPlatform: 'telegram',
		postActionUser: 'acme',
		postActionPostId: '812',
		telegramDeleteAllMessages: true,
	});
	assert.deepEqual(unpublish.body, { platform: 'telegram', user: 'acme', post_id: '812', delete_all_messages: true });
});

test('existing post actions send exactly what they sent before', async () => {
	const edit = await run({ resource: 'postActions', operation: 'editPost', postActionPlatform: 'facebook', postActionUser: 'acme', postActionPostId: '1', postActionMessage: 'Hi', telegramEditAction: 'pin' });
	assert.deepEqual(edit.body, { platform: 'facebook', user: 'acme', post_id: '1', message: 'Hi' });
	const repost = await run({ resource: 'postActions', operation: 'repostPost', repostPlatform: 'linkedin', postActionUser: 'acme', postActionPostId: '1', postActionMessage: 'Look' });
	assert.deepEqual(repost.body, { platform: 'linkedin', user: 'acme', post_id: '1', commentary: 'Look' });
	const unpublish = await run({ resource: 'postActions', operation: 'unpublishPost', postActionPlatform: 'x', postActionUser: 'acme', postActionPostId: '1', telegramDeleteAllMessages: true });
	assert.deepEqual(unpublish.body, { platform: 'x', user: 'acme', post_id: '1' });
	const gbp = await run({ resource: 'postActions', operation: 'editPost', postActionPlatform: 'google_business', postActionUser: 'acme', postActionPostId: 'accounts/1/locations/2/localPosts/3', postActionMessage: 'New summary' });
	assert.deepEqual(gbp.body, { platform: 'google_business', user: 'acme', post_id: 'accounts/1/locations/2/localPosts/3', summary: 'New summary' });
});

const textUpload = (extra) => ({
	resource: 'uploads',
	operation: 'uploadText',
	user: 'acme',
	title: 'Hello',
	uploadAsync: false,
	...extra,
});

test('upload text: paid partnership and the Telegram, Bluesky and Google Business options', async () => {
	const req = await run(textUpload({
		platform: ['telegram', 'bluesky', 'google_business', 'facebook'],
		facebookPageId: 'page-1',
		paidPartnership: true,
		facebookSponsorId: '123',
		pinterestSponsorId: '9',
		telegramOptions: {
			poll: '{"options": ["a", "b"]}',
			pin: true,
			firstCommentAsReply: false,
			replyToMessageId: 7,
			telegramTitle: 'Texto',
		},
		blueskyOptions: { tags: 'a,b', threadOverflow: true, createdAt: '2024-05-01T10:30:00Z' },
		gbpOptions: { recurrence: 'WEEKLY', recurrenceDays: 'MON,THU', multiMedia: true },
	}));
	assert.equal(req.url, `${API}/upload_text`);
	const f = formFields(req);
	assert.equal(f.paid_partnership, 'true');
	assert.equal(f.facebook_sponsor_id, '123');
	assert.equal(f.pinterest_sponsor_id, undefined);
	assert.equal(f.telegram_poll, '{"options":["a","b"]}');
	assert.equal(f.telegram_pin, 'true');
	assert.equal(f.telegram_first_comment_as_reply, 'false');
	assert.equal(f.telegram_reply_to_message_id, '7');
	assert.equal(f.telegram_title, 'Texto');
	assert.equal(f.bluesky_tags, 'a,b');
	assert.equal(f.bluesky_thread_overflow, 'true');
	assert.equal(f.bluesky_created_at, '2024-05-01T10:30:00Z');
	assert.equal(f.gbp_recurrence, 'WEEKLY');
	assert.equal(f.gbp_recurrence_days, 'MON,THU');
	assert.equal(f.gbp_multi_media, 'true');
});

test('upload text without the new options sends none of the new fields', async () => {
	const req = await run(textUpload({ platform: ['telegram', 'bluesky', 'google_business', 'facebook'], facebookPageId: 'page-1' }));
	const keys = Object.keys(formFields(req));
	for (const key of keys) {
		assert.ok(!/^(paid_partnership|facebook_sponsor_id|pinterest_sponsor_id|telegram_(poll|pin|title|first_comment_as_reply)|bluesky_(tags|created_at|thread_overflow)|gbp_(recurrence|multi_media|alert_type|scheduled_time))/.test(key), key);
	}
});

test('upload text: options of a network that is not selected are not sent', async () => {
	const req = await run(textUpload({
		platform: ['x'],
		telegramOptions: { pin: true },
		blueskyOptions: { tags: 'a' },
		facebookSponsorId: '123',
	}));
	const f = formFields(req);
	assert.equal(f.telegram_pin, undefined);
	assert.equal(f.bluesky_tags, undefined);
	assert.equal(f.facebook_sponsor_id, undefined);
});

test('upload text: invalid JSON in a Telegram option is refused before calling the API', async () => {
	await assert.rejects(run(textUpload({ platform: ['telegram'], telegramOptions: { poll: '{nope' } })), /not valid JSON/);
});

test('upload document accepts Telegram with Send As', async () => {
	const req = await run({
		resource: 'uploads',
		operation: 'uploadDocument',
		user: 'acme',
		title: 'Episode 12',
		uploadAsync: false,
		platform: ['telegram'],
		document: 'https://example.com/episode.mp3',
		telegramOptions: { sendAs: 'audio', performer: 'My Podcast' },
	});
	assert.equal(req.url, `${API}/upload_document`);
	const f = formFields(req);
	assert.equal(f.document, 'https://example.com/episode.mp3');
	assert.equal(f.telegram_send_as, 'audio');
	assert.equal(f.telegram_performer, 'My Podcast');
	assert.deepEqual(f['platform[]'], 'telegram');
});
