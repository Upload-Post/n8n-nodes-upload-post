const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'nodes/UploadPost/UploadPost.node.ts'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('package version is 0.5.0', () => {
	assert.equal(pkg.version, '0.5.0');
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
});
