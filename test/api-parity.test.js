const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'nodes/UploadPost/UploadPost.node.ts'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('package version is 0.14.0', () => {
	assert.equal(pkg.version, '0.14.0');
});

test('upload platforms include the credential channels from the current API', () => {
	assert.match(source, /uploadPhotos: \[[^\]]*'mastodon'/);
	assert.match(source, /uploadPhotos: \[[^\]]*'lemmy'/);
	assert.match(source, /uploadPhotos: \[[^\]]*'wordpress'/);
	assert.match(source, /uploadVideo: \[[^\]]*'mastodon'/);
	assert.match(source, /uploadVideo: \[[^\]]*'wordpress'/);
	assert.match(source, /uploadText: \[[^\]]*'slack'/);
	assert.match(source, /uploadText: \[[^\]]*'nostr'/);
	assert.match(source, /uploadText: \[[^\]]*'devto'/);
	assert.match(source, /uploadText: \[[^\]]*'hashnode'/);
	assert.match(source, /uploadText: \[[^\]]*'whop'/);
	assert.match(source, /uploadText: \[[^\]]*'listmonk'/);
});

test('sends credential-platform fields the SDK allowlists', () => {
	for (const field of [
		'mastodon_visibility',
		'wordpress_status',
		'lemmy_community',
		'slack_blocks',
		'nostr_kind',
		'devto_tags',
		'hashnode_body',
		'whop_body',
		'listmonk_lists',
		'discord_thread_id',
		'telegram_parse_mode',
		'bluesky_alt_text',
		'reply_to_id',
		'first_comment_media[]',
		'youtube_notify_subscribers',
		'youtube_publish_at',
		'instagram_alt_text',
		'linkedin_disable_reshare',
		'tiktok_is_ads_only',
		'bluesky_gallery',
	]) {
		assert.match(source, new RegExp(field.replace(/[[\]]/g, '\\$&')));
	}
});

test('exposes current API operations', () => {
	for (const operation of [
		'retryPost',
		'unpublishPost',
		'editPost',
		'repostPost',
		'savePin',
		'createComment',
		'deleteComment',
		'getMedia',
		'getGoogleBusinessLocations',
		'getTiktokTrendingMusic',
		'searchTiktokMusic',
		'getTiktokLocations',
		'getTiktokSettings',
		'testNotifications',
		'listWebhookDeliveries',
		'getWebhookDelivery',
		'redeliverWebhook',
		'createAutodmRule',
		'listAutodmRules',
		'pauseAutodmRule',
		'resumeAutodmRule',
		'deleteAutodmRule',
		'sendDm',
		'listDmConversations',
		'resolveLinkedinOrganization',
		'dm_received',
		'comment_received',
	]) {
		assert.match(source, new RegExp(`value: '${operation}'`));
	}
});

test('compiled node description includes the new operations', () => {
	const compiledPath = path.join(root, 'dist/nodes/UploadPost/UploadPost.node.js');
	assert.equal(fs.existsSync(compiledPath), true, 'dist node is missing; build did not run');
	const compiled = fs.readFileSync(compiledPath, 'utf8');
	assert.match(compiled, /retryPost/);
	assert.match(compiled, /uploadposts\/posts\/retry/);
	assert.match(compiled, /uploadposts\/comments\/create/);
	assert.match(compiled, /uploadposts\/tiktok\/music\/search/);
	assert.match(compiled, /uploadposts\/google-business\/locations/);
	assert.match(compiled, /uploadposts\/webhooks\/deliveries/);
	assert.match(compiled, /uploadposts\/autodms\/rules/);
	assert.match(compiled, /uploadposts\/dms\/send/);
	assert.match(compiled, /uploadposts\/linkedin\/resolve-organization/);
});

test('exposes the best time, queue, Telegram, Bluesky and Google Business operations', () => {
	const network = fs.readFileSync(path.join(root, 'nodes/UploadPost/NetworkOperations.ts'), 'utf8');
	for (const operation of [
		'getBestTimes', 'getQueueSettings', 'updateQueueSettings', 'getQueuePreview', 'getNextQueueSlot',
		'getTelegramChatInfo', 'updateTelegramChatInfo', 'moderateTelegramMember', 'createTelegramInviteLink',
		'getTelegramBotProfile', 'setTelegramBotCommands',
		'getBlueskyProfile', 'getBlueskyNotifications', 'searchBlueskyPosts', 'createBlueskyDraft',
		'listGbpPosts', 'getGbpPost', 'listGbpReviews', 'getGbpPerformance', 'getGbpLocationInfo', 'updateGbpLocationInfo',
	]) {
		assert.match(network, new RegExp(`value: '${operation}'`));
	}
	for (const field of ['telegram_poll', 'telegram_reply_markup', 'bluesky_tags', 'bluesky_captions', 'gbp_recurrence', 'gbp_scheduled_time']) {
		assert.match(network, new RegExp(`'${field}'`));
	}
	assert.match(source, /paid_partnership|applyNetworkUploadOptions/);
	assert.match(source, /delete_all_messages/);
	// Nothing that is switched off in the API is offered. Telegram paid
	// broadcasts are on (since 16-nov-2026) and offered.
	assert.doesNotMatch(network, /bluesky\/graph|\/youtube\//);
	assert.match(network, /'telegram_allow_paid_broadcast'/);
	const youtube = fs.readFileSync(path.join(root, 'nodes/UploadPost/YouTubeOperations.ts'), 'utf8');
	// YouTube Analytics queries, Reporting and push notifications are not offered.
	assert.doesNotMatch(youtube, /analytics\/query|reporting|\/push/i);;
});

test('Bluesky gallery is documented with the current 10-image limit', () => {
	assert.match(source, /up to 10 images as a Bluesky gallery/);
	assert.doesNotMatch(source, /up to 20 images/i);
});
