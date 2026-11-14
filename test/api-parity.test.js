const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'nodes/UploadPost/UploadPost.node.ts'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('package version is 0.7.0', () => {
	assert.equal(pkg.version, '0.7.0');
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

test('Bluesky gallery is documented with the current 10-image limit', () => {
	assert.match(source, /up to 10 images as a Bluesky gallery/);
	assert.doesNotMatch(source, /up to 20 images/i);
});

test('paid partnership and sponsor ids reach the API form', () => {
	// Cross-network flag: only sent when on, for photos, videos and text.
	assert.match(source, /name: 'paidPartnership'[\s\S]{0,1500}operation: \['uploadPhotos','uploadVideo','uploadText'\]/);
	assert.match(source, /getNodeParameter\('paidPartnership', ctx\.itemIndex, false\) as boolean;\s+if \(paidPartnership\) \{\s+formData\.paid_partnership = 'true';/);
	// Facebook and Pinterest need the sponsor's id.
	assert.match(source, /name: 'facebookSponsorId'[\s\S]{0,900}operation: \['uploadPhotos', 'uploadVideo', 'uploadText'\]/);
	assert.match(source, /formData\.facebook_sponsor_id = facebookSponsorId/);
	assert.match(source, /name: 'pinterestSponsorId'[\s\S]{0,600}operation: \['uploadPhotos', 'uploadVideo'\]/);
	assert.match(source, /formData\.pinterest_sponsor_id = pinterestSponsorId/);
});

test('paid partnership is never sent unless it is switched on', () => {
	assert.doesNotMatch(source, /formData\.paid_partnership = String\(/);
	assert.doesNotMatch(source, /formData\.paid_partnership = 'false'/);
});
