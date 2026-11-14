// Runs the compiled node's execute() with a fake n8n context and checks the
// HTTP request each new operation sends: endpoint, method, query and body.
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
		getNode: () => ({ name: 'Upload Post', type: 'uploadPost', typeVersion: 1 }),
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

const API = 'https://api.upload-post.com/api';

test('list webhook deliveries sends the filters as query params', async () => {
	const req = await run({
		resource: 'users',
		operation: 'listWebhookDeliveries',
		webhookDeliveriesEvent: 'upload_completed',
		webhookDeliveriesStatus: 'failed',
		webhookDeliveriesRequestId: 'req1',
		webhookDeliveriesLimit: 10,
		webhookDeliveriesPage: 2,
		webhookDeliveriesIncludePayload: true,
	});
	assert.equal(req.method, 'GET');
	assert.equal(req.url, `${API}/uploadposts/webhooks/deliveries`);
	assert.deepEqual(req.qs, {
		event: 'upload_completed',
		status: 'failed',
		request_id: 'req1',
		limit: 10,
		page: 2,
		include_payload: 'true',
	});
});

test('get and redeliver a webhook delivery', async () => {
	const get = await run({ resource: 'users', operation: 'getWebhookDelivery', webhookDeliveryId: ' abc123 ' });
	assert.equal(get.method, 'GET');
	assert.equal(get.url, `${API}/uploadposts/webhooks/deliveries/abc123`);
	const redeliver = await run({ resource: 'users', operation: 'redeliverWebhook', webhookDeliveryId: 'abc123' });
	assert.equal(redeliver.method, 'POST');
	assert.equal(redeliver.url, `${API}/uploadposts/webhooks/deliveries/abc123/redeliver`);
});

test('create an account-wide AutoDM rule', async () => {
	const req = await run({
		resource: 'instagram',
		operation: 'createAutodmRule',
		autodmRuleProfile: 'my-profile',
		autodmRuleReplyMessage: 'Here is the guide',
		autodmRuleTriggers: ['comment', 'dm_keyword'],
		autodmRuleKeywords: 'guide, info ,',
		autodmRuleButtons: { button: [{ title: 'Open', url: 'https://example.com' }, { title: '', url: '' }] },
		autodmRuleCooldownHours: 48,
	});
	assert.equal(req.method, 'POST');
	assert.equal(req.url, `${API}/uploadposts/autodms/rules`);
	assert.deepEqual(req.body, {
		profile_username: 'my-profile',
		reply_message: 'Here is the guide',
		triggers: ['comment', 'dm_keyword'],
		trigger_keywords: ['guide', 'info'],
		buttons: [{ title: 'Open', url: 'https://example.com' }],
		per_user_cooldown_hours: 48,
	});
});

test('dm_keyword without keywords and a fractional cooldown are refused before calling the API', async () => {
	await assert.rejects(
		run({
			resource: 'instagram',
			operation: 'createAutodmRule',
			autodmRuleProfile: 'p',
			autodmRuleReplyMessage: 'hi',
			autodmRuleTriggers: ['dm_keyword'],
			autodmRuleKeywords: '  ',
		}),
		/Trigger Keyword/,
	);
	await assert.rejects(
		run({
			resource: 'instagram',
			operation: 'createAutodmRule',
			autodmRuleProfile: 'p',
			autodmRuleReplyMessage: 'hi',
			autodmRuleCooldownHours: 1.5,
		}),
		/whole number/,
	);
});

test('list, pause, resume and delete AutoDM rules', async () => {
	const list = await run({ resource: 'instagram', operation: 'listAutodmRules', autodmRulesListProfile: 'p1' });
	assert.equal(list.method, 'GET');
	assert.equal(list.url, `${API}/uploadposts/autodms/rules`);
	assert.deepEqual(list.qs, { profile_username: 'p1' });
	for (const [operation, action] of [['pauseAutodmRule', 'pause'], ['resumeAutodmRule', 'resume'], ['deleteAutodmRule', 'delete']]) {
		const req = await run({ resource: 'instagram', operation, autodmRuleId: 'rule_1' });
		assert.equal(req.method, 'POST');
		assert.equal(req.url, `${API}/uploadposts/autodms/rules/${action}`);
		assert.deepEqual(req.body, { rule_id: 'rule_1' });
	}
});

test('send a Bluesky DM by handle, sharing a post', async () => {
	const req = await run({
		resource: 'dms',
		operation: 'sendDm',
		dmUser: 'p',
		dmPlatform: 'bluesky',
		dmRecipientId: 'alice.bsky.social',
		dmMessage: 'look',
		dmBlueskySharePostUrl: 'https://bsky.app/profile/alice.bsky.social/post/3l5',
	});
	assert.equal(req.method, 'POST');
	assert.equal(req.url, `${API}/uploadposts/dms/send`);
	assert.deepEqual(req.body, {
		platform: 'bluesky',
		user: 'p',
		recipient_id: 'alice.bsky.social',
		message: 'look',
		attachments: { type: 'post', url: 'https://bsky.app/profile/alice.bsky.social/post/3l5' },
	});
});

test('a Bluesky reaction needs no message and goes to the conversation', async () => {
	const req = await run({
		resource: 'dms',
		operation: 'sendDm',
		dmUser: 'p',
		dmPlatform: 'bluesky',
		dmConversationId: 'convo1',
		dmBlueskySenderAction: 'react',
		dmMessageId: 'm1',
		dmReaction: '🔥',
	});
	assert.deepEqual(req.body, {
		platform: 'bluesky',
		user: 'p',
		conversation_id: 'convo1',
		sender_action: 'react',
		message_id: 'm1',
		reaction: '🔥',
	});
	await assert.rejects(
		run({ resource: 'dms', operation: 'sendDm', dmUser: 'p', dmPlatform: 'bluesky', dmConversationId: 'c', dmBlueskySenderAction: 'react' }),
		/Message ID is required/,
	);
	await assert.rejects(
		run({ resource: 'dms', operation: 'sendDm', dmUser: 'p', dmPlatform: 'bluesky', dmRecipientId: 'alice.bsky.social' }),
		/Message is required/,
	);
});

test('an Instagram DM merges buttons and the extra JSON fields, never a Bluesky conversation', async () => {
	const req = await run({
		resource: 'dms',
		operation: 'sendDm',
		dmUser: 'p',
		dmPlatform: 'instagram',
		dmRecipientId: '1784',
		dmConversationId: 'ignored',
		dmMessage: 'hi',
		dmButtons: { button: [{ title: 'Site', url: 'https://example.com' }] },
		dmExtraFields: '{"quick_replies": [{"title": "Yes", "payload": "Y"}]}',
	});
	assert.deepEqual(req.body, {
		platform: 'instagram',
		user: 'p',
		recipient_id: '1784',
		message: 'hi',
		buttons: [{ title: 'Site', url: 'https://example.com' }],
		quick_replies: [{ title: 'Yes', payload: 'Y' }],
	});
	await assert.rejects(
		run({ resource: 'dms', operation: 'sendDm', dmUser: 'p', dmPlatform: 'instagram', dmRecipientId: '1', dmMessage: 'x', dmExtraFields: '[1]' }),
		/JSON object/,
	);
});

test('list Bluesky DM conversations with the Bluesky-only filters', async () => {
	const req = await run({
		resource: 'dms',
		operation: 'listDmConversations',
		dmUser: 'p',
		dmPlatform: 'bluesky',
		dmLimit: 25,
		dmMessagesLimit: 1,
		dmConversationFilterId: 'c1',
		dmMessagesCursor: 'mc',
		dmStatus: 'request',
		dmReadState: 'unread',
	});
	assert.equal(req.method, 'GET');
	assert.equal(req.url, `${API}/uploadposts/dms/conversations`);
	assert.deepEqual(req.qs, {
		platform: 'bluesky',
		user: 'p',
		limit: 25,
		messages_limit: 1,
		conversation_id: 'c1',
		messages_cursor: 'mc',
		status: 'request',
		read_state: 'unread',
	});
	const ig = await run({ resource: 'dms', operation: 'listDmConversations', dmUser: 'p', dmPlatform: 'instagram', dmStatus: 'request' });
	assert.deepEqual(ig.qs, { platform: 'instagram', user: 'p' });
});

test('comment replies send comment_id, limit and after', async () => {
	const req = await run({
		resource: 'instagram',
		operation: 'getPostComments',
		instagramUser: 'p',
		commentPlatform: 'linkedin',
		instagramPostId: 'urn:li:share:1',
		commentsCommentId: 'urn:li:comment:(urn:li:activity:1,2)',
		commentsLimit: 10,
		commentsAfter: '10',
	});
	assert.equal(req.url, `${API}/uploadposts/comments`);
	assert.deepEqual(req.qs, {
		platform: 'linkedin',
		user: 'p',
		post_id: 'urn:li:share:1',
		comment_id: 'urn:li:comment:(urn:li:activity:1,2)',
		limit: 10,
		after: '10',
	});
	const plain = await run({ resource: 'instagram', operation: 'getPostComments', instagramUser: 'p', commentPlatform: 'facebook', instagramPostId: '1_2' });
	assert.deepEqual(plain.qs, { platform: 'facebook', user: 'p', post_id: '1_2' });
});

test('resolve a LinkedIn organization', async () => {
	const req = await run({
		resource: 'monitoring',
		operation: 'resolveLinkedinOrganization',
		linkedinResolveProfile: 'p',
		linkedinResolveUrl: ' https://www.linkedin.com/company/linkedin/ ',
	});
	assert.equal(req.method, 'GET');
	assert.equal(req.url, `${API}/uploadposts/linkedin/resolve-organization`);
	assert.deepEqual(req.qs, { user: 'p', url: 'https://www.linkedin.com/company/linkedin/' });
});
