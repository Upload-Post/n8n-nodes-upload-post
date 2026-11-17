// Runs the compiled Upload Post Trigger with a fake n8n context: the webhook
// lifecycle (checkExists / create / delete) against a fake API, and webhook()
// with signed and forged deliveries.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');

const { UploadPostTrigger } = require(
	path.join(__dirname, '..', 'dist/nodes/UploadPostTrigger/UploadPostTrigger.node.js'),
);

const API = 'https://api.upload-post.com/api';
const SUBS = `${API}/uploadposts/webhooks/subscriptions`;
const URL = 'https://n8n.example.com/webhook/abc-123/webhook';
const SECRET = 'whsec_test_secret';

const subscription = (overrides = {}) => ({
	id: 'whsub_000000000000000000000001',
	url: URL,
	events: ['upload_completed'],
	profile_username: null,
	source: 'n8n',
	name: 'My flow',
	status: 'active',
	...overrides,
});

// routes: { 'GET /path': (options) => ({ statusCode, body }) }
const hookContext = ({ params = {}, routes = {}, staticData = {}, workflowName = 'My flow' } = {}) => {
	const calls = [];
	const logs = [];
	const ctx = {
		calls,
		logs,
		staticData,
		getNodeParameter: (name, fallback) =>
			Object.prototype.hasOwnProperty.call(params, name) ? params[name] : fallback,
		getNodeWebhookUrl: () => URL,
		getWorkflowStaticData: () => staticData,
		getWorkflow: () => ({ id: 'wf1', name: workflowName, active: true }),
		getNode: () => ({ name: 'Upload Post Trigger', type: 'uploadPostTrigger', typeVersion: 1 }),
		logger: {
			warn: (m) => logs.push(['warn', m]),
			error: (m) => logs.push(['error', m]),
			info: () => {},
			debug: () => {},
		},
		helpers: {
			httpRequestWithAuthentication: async (credential, options) => {
				assert.equal(credential, 'uploadPostApi');
				assert.equal(options.ignoreHttpStatusErrors, true);
				assert.equal(options.returnFullResponse, true);
				calls.push(options);
				const key = `${options.method} ${options.url.replace(API, '')}`;
				const route = routes[key];
				if (!route) return { statusCode: 404, body: { success: false, reason: 'not_found' } };
				return route(options);
			},
			returnJsonArray: (data) => (Array.isArray(data) ? data : [data]).map((json) => ({ json })),
		},
	};
	return ctx;
};

const node = new UploadPostTrigger();
const hooks = node.webhookMethods.default;

// ---------------------------------------------------------------- checkExists

test('checkExists asks for active subscriptions on this exact URL', async () => {
	const ctx = hookContext({
		params: { events: ['upload_completed'] },
		routes: { 'GET /uploadposts/webhooks/subscriptions': () => ({ statusCode: 200, body: { subscriptions: [] } }) },
	});
	await hooks.checkExists.call(ctx);
	assert.equal(ctx.calls.length, 1);
	assert.equal(ctx.calls[0].url, SUBS);
	assert.deepEqual(ctx.calls[0].qs, { url: URL, status: 'active' });
});

test('checkExists is true for an active subscription with the same events and profile', async () => {
	const ctx = hookContext({
		params: { events: ['comment_received', 'upload_completed'], profileUsername: 'brand' },
		routes: {
			'GET /uploadposts/webhooks/subscriptions': () => ({
				statusCode: 200,
				body: {
					subscriptions: [
						subscription({ id: 'whsub_a', events: ['upload_completed', 'comment_received'], profile_username: 'brand' }),
					],
				},
			}),
		},
	});
	assert.equal(await hooks.checkExists.call(ctx), true);
	assert.equal(ctx.staticData.subscriptionId, 'whsub_a');
});

test('checkExists is false for a disabled subscription', async () => {
	// The API filters by status=active, but a disabled row must never count
	// even if it came back.
	const ctx = hookContext({
		params: { events: ['upload_completed'] },
		routes: {
			'GET /uploadposts/webhooks/subscriptions': () => ({
				statusCode: 200,
				body: { subscriptions: [subscription({ status: 'disabled', disabled_reason: 'endpoint_gone' })] },
			}),
		},
	});
	assert.equal(await hooks.checkExists.call(ctx), false);
	assert.equal(ctx.staticData.subscriptionId, undefined);
});

test('checkExists is false when there is no subscription', async () => {
	const ctx = hookContext({
		params: { events: ['upload_completed'] },
		routes: { 'GET /uploadposts/webhooks/subscriptions': () => ({ statusCode: 200, body: { subscriptions: [] } }) },
	});
	assert.equal(await hooks.checkExists.call(ctx), false);
});

test('checkExists is false when events or profile differ', async () => {
	const rows = [
		subscription({ events: ['upload_completed', 'dm_received'] }),
		subscription({ profile_username: 'other' }),
	];
	const ctx = hookContext({
		params: { events: ['upload_completed'], profileUsername: '' },
		routes: { 'GET /uploadposts/webhooks/subscriptions': () => ({ statusCode: 200, body: { subscriptions: rows } }) },
	});
	assert.equal(await hooks.checkExists.call(ctx), false);
});

test('checkExists surfaces a disabled feature as a clear error', async () => {
	const ctx = hookContext({
		params: { events: ['upload_completed'] },
		routes: {
			'GET /uploadposts/webhooks/subscriptions': () => ({
				statusCode: 503,
				body: { success: false, reason: 'webhook_subscriptions_disabled', message: 'Webhook subscriptions are disabled' },
			}),
		},
	});
	await assert.rejects(hooks.checkExists.call(ctx), /not available on Upload-Post/);
});

// --------------------------------------------------------------------- create

const createRoutes = (state) => ({
	'POST /uploadposts/webhooks/subscriptions': (options) => {
		state.posts.push(options.body);
		const first = state.posts.length === 1;
		return {
			statusCode: first ? 201 : 200,
			body: { success: true, created: first, reactivated: false, subscription: subscription({ id: 'whsub_same' }) },
		};
	},
	'GET /uploadposts/webhooks/subscriptions': () => ({
		statusCode: 200,
		body: { subscriptions: state.listed },
	}),
	'DELETE /uploadposts/webhooks/subscriptions/whsub_old': () => {
		state.deleted.push('whsub_old');
		return { statusCode: 200, body: { deleted: true, id: 'whsub_old' } };
	},
	'GET /uploadposts/users/notifications': () => ({
		statusCode: 200,
		body: { success: true, notifications: { webhook_secret: SECRET } },
	}),
});

test('create posts url, events, profile, source n8n and the workflow name', async () => {
	const state = { posts: [], listed: [], deleted: [] };
	const ctx = hookContext({
		params: { events: ['upload_completed', 'comment_received'], profileUsername: 'brand' },
		routes: createRoutes(state),
		workflowName: 'Notify on publish',
	});
	assert.equal(await hooks.create.call(ctx), true);
	assert.deepEqual(state.posts[0], {
		url: URL,
		events: ['comment_received', 'upload_completed'],
		profile_username: 'brand',
		source: 'n8n',
		name: 'Notify on publish',
	});
	assert.equal(ctx.staticData.subscriptionId, 'whsub_same');
	assert.equal(ctx.staticData.webhookSecret, SECRET);
});

test('create is idempotent: a second call keeps the same subscription id', async () => {
	const state = { posts: [], listed: [], deleted: [] };
	const staticData = {};
	const params = { events: ['upload_completed'] };
	await hooks.create.call(hookContext({ params, routes: createRoutes(state), staticData }));
	await hooks.create.call(hookContext({ params, routes: createRoutes(state), staticData }));
	assert.equal(state.posts.length, 2);
	assert.deepEqual(state.posts[0], state.posts[1]);
	assert.equal(staticData.subscriptionId, 'whsub_same');
	assert.equal(state.posts[0].profile_username, undefined);
});

test('create removes an older active subscription left on the same URL', async () => {
	const state = {
		posts: [],
		listed: [subscription({ id: 'whsub_same' }), subscription({ id: 'whsub_old', events: ['dm_received'] })],
		deleted: [],
	};
	const ctx = hookContext({ params: { events: ['upload_completed'] }, routes: createRoutes(state) });
	await hooks.create.call(ctx);
	assert.deepEqual(state.deleted, ['whsub_old']);
});

test('create explains why a local n8n URL is refused', async () => {
	const ctx = hookContext({
		params: { events: ['upload_completed'] },
		routes: {
			'POST /uploadposts/webhooks/subscriptions': () => ({
				statusCode: 400,
				body: { success: false, reason: 'invalid_url', message: 'url must be https' },
			}),
		},
	});
	await assert.rejects(hooks.create.call(ctx), (error) => {
		assert.match(error.message, /public HTTPS URL/);
		assert.match(error.description, /WEBHOOK_URL/);
		assert.equal(error.httpCode, '400');
		return true;
	});
	assert.equal(ctx.staticData.subscriptionId, undefined);
});

test('create names the events Upload-Post refuses (400 invalid_events)', async () => {
	const ctx = hookContext({
		params: { events: ['upload_completed', 'youtube_video_published', 'post_approved'] },
		routes: {
			'POST /uploadposts/webhooks/subscriptions': () => ({
				statusCode: 400,
				body: {
					success: false,
					reason: 'invalid_events',
					message: 'Unknown webhook events: youtube_video_published, post_approved',
					allowed_events: ['upload_completed', 'comment_received'],
				},
			}),
		},
	});
	await assert.rejects(hooks.create.call(ctx), (error) => {
		assert.match(error.message, /not available on this Upload-Post account: post_approved, youtube_video_published/);
		assert.match(error.description, /accepts now: upload_completed, comment_received/);
		return true;
	});
});

test('invalid_events without allowed_events falls back to the API message', async () => {
	const ctx = hookContext({
		params: { events: ['upload_completed', 'post_rejected'] },
		routes: {
			'POST /uploadposts/webhooks/subscriptions': () => ({
				statusCode: 400,
				body: { success: false, reason: 'invalid_events', message: 'Unknown webhook events: post_rejected' },
			}),
		},
	});
	await assert.rejects(hooks.create.call(ctx), /not available on this Upload-Post account: post_rejected\./);
});

test('create cuts the workflow name to 100 characters', async () => {
	const state = { posts: [], listed: [], deleted: [] };
	const ctx = hookContext({ params: { events: ['upload_completed'] }, routes: createRoutes(state), workflowName: 'x'.repeat(150) });
	await hooks.create.call(ctx);
	assert.equal(state.posts[0].name.length, 100);
});

// --------------------------------------------------------------------- delete

test('delete treats a 404 as already deleted', async () => {
	const staticData = { subscriptionId: 'whsub_gone', webhookSecret: SECRET, webhookSecretFetchedAt: 1 };
	const ctx = hookContext({
		staticData,
		routes: {
			'DELETE /uploadposts/webhooks/subscriptions/whsub_gone': () => ({
				statusCode: 404,
				body: { success: false, reason: 'not_found' },
			}),
		},
	});
	assert.equal(await hooks.delete.call(ctx), true);
	assert.equal(ctx.calls[0].method, 'DELETE');
	assert.deepEqual(staticData, {});
});

test('delete succeeds on 200 and fails (keeping the id) on a server error', async () => {
	const ok = hookContext({
		staticData: { subscriptionId: 'whsub_a' },
		routes: { 'DELETE /uploadposts/webhooks/subscriptions/whsub_a': () => ({ statusCode: 200, body: { deleted: true } }) },
	});
	assert.equal(await hooks.delete.call(ok), true);
	assert.equal(ok.staticData.subscriptionId, undefined);

	const broken = hookContext({
		staticData: { subscriptionId: 'whsub_a' },
		routes: { 'DELETE /uploadposts/webhooks/subscriptions/whsub_a': () => ({ statusCode: 500, body: {} }) },
	});
	assert.equal(await hooks.delete.call(broken), false);
	assert.equal(broken.staticData.subscriptionId, 'whsub_a');
	assert.equal(broken.logs[0][0], 'error');
});

test('delete without a stored id does nothing', async () => {
	const ctx = hookContext({});
	assert.equal(await hooks.delete.call(ctx), true);
	assert.equal(ctx.calls.length, 0);
});

// -------------------------------------------------------------------- webhook

const sign = (secret, timestamp, raw) =>
	'sha256=' + crypto.createHmac('sha256', secret).update(`${timestamp}.`).update(raw).digest('hex');

const delivery = ({ body = { event: 'upload_completed', success: true }, secret = SECRET, timestamp, signature, headers = {} } = {}) => {
	const raw = Buffer.from(JSON.stringify(body));
	const ts = timestamp ?? String(Math.floor(Date.now() / 1000));
	return {
		body,
		raw,
		headers: {
			'x-upload-post-event': body.event,
			'x-upload-post-timestamp': ts,
			'x-upload-post-delivery': 'dlv_1',
			'x-upload-post-attempt': '2',
			'x-upload-post-subscription': 'whsub_same',
			'x-upload-post-signature': signature ?? sign(secret, ts, raw),
			...headers,
		},
	};
};

const webhookContext = (request, { params = {}, staticData = { webhookSecret: SECRET, webhookSecretFetchedAt: Date.now() }, routes = {} } = {}) => {
	const ctx = hookContext({ params: { events: ['upload_completed'], verifySignature: true, ...params }, staticData, routes });
	ctx.response = { status: null, payload: null };
	ctx.getRequestObject = () => ({ rawBody: request.raw, body: request.body });
	ctx.getHeaderData = () => request.headers;
	ctx.getBodyData = () => request.body;
	ctx.getResponseObject = () => {
		const res = {
			status: (code) => {
				ctx.response.status = code;
				return res;
			},
			json: (payload) => {
				ctx.response.payload = payload;
				return res;
			},
			end: () => res,
		};
		return res;
	};
	return ctx;
};

test('a correctly signed delivery runs the workflow with body and delivery headers', async () => {
	const ctx = webhookContext(delivery());
	const result = await node.webhook.call(ctx);
	assert.equal(ctx.response.status, null);
	const item = result.workflowData[0][0].json;
	assert.equal(item.event, 'upload_completed');
	assert.equal(item.success, true);
	assert.equal(item.uploadPostDelivery.event, 'upload_completed');
	assert.equal(item.uploadPostDelivery.deliveryId, 'dlv_1');
	assert.equal(item.uploadPostDelivery.attempt, 2);
	assert.equal(item.uploadPostDelivery.subscriptionId, 'whsub_same');
});

test('a forged signature is rejected with 401', async () => {
	const ctx = webhookContext(delivery({ secret: 'whsec_wrong' }));
	const result = await node.webhook.call(ctx);
	assert.equal(result.noWebhookResponse, true);
	assert.equal(result.workflowData, undefined);
	assert.equal(ctx.response.status, 401);
	// The cached secret is fresh, so a forged request does not hit the API.
	assert.equal(ctx.calls.length, 0);
});

test('a body changed after signing is rejected', async () => {
	const request = delivery();
	request.raw = Buffer.from(JSON.stringify({ event: 'upload_completed', success: false }));
	const ctx = webhookContext(request);
	const result = await node.webhook.call(ctx);
	assert.equal(ctx.response.status, 401);
	assert.equal(result.workflowData, undefined);
});

test('a delivery older than 5 minutes is rejected even with a valid signature', async () => {
	const old = String(Math.floor(Date.now() / 1000) - 301);
	const ctx = webhookContext(delivery({ timestamp: old }));
	const result = await node.webhook.call(ctx);
	assert.equal(ctx.response.status, 401);
	assert.equal(result.workflowData, undefined);
});

test('a delivery without signature is rejected', async () => {
	const ctx = webhookContext(delivery({ headers: { 'x-upload-post-signature': undefined } }));
	await node.webhook.call(ctx);
	assert.equal(ctx.response.status, 401);
});

test('a rotated secret is read again once and the delivery accepted', async () => {
	const rotated = 'whsec_rotated';
	const ctx = webhookContext(delivery({ secret: rotated }), {
		staticData: { webhookSecret: SECRET, webhookSecretFetchedAt: Date.now() - 120_000 },
		routes: {
			'GET /uploadposts/users/notifications': () => ({ statusCode: 200, body: { notifications: { webhook_secret: rotated } } }),
		},
	});
	const result = await node.webhook.call(ctx);
	assert.equal(ctx.calls.length, 1);
	assert.equal(ctx.staticData.webhookSecret, rotated);
	assert.ok(result.workflowData);
});

test('a valid signature with extra characters appended is rejected', async () => {
	const request = delivery();
	request.headers['x-upload-post-signature'] += '00';
	const ctx = webhookContext(request);
	await node.webhook.call(ctx);
	assert.equal(ctx.response.status, 401);
});

test('with Verify Signature off an unsigned delivery runs the workflow', async () => {
	const ctx = webhookContext(delivery({ headers: { 'x-upload-post-signature': undefined } }), {
		params: { verifySignature: false },
	});
	const result = await node.webhook.call(ctx);
	assert.ok(result.workflowData);
});

test('an event the node did not select is acknowledged without running the workflow', async () => {
	const ctx = webhookContext(delivery({ body: { event: 'dm_received' } }));
	const result = await node.webhook.call(ctx);
	assert.equal(result.workflowData, undefined);
	assert.equal(result.webhookResponse.ignored, true);
});

// ---------------------------------------------------------------- description

test('the trigger is registered and its events are exactly the API catalog', () => {
	const pkg = require(path.join(__dirname, '..', 'package.json'));
	assert.ok(pkg.n8n.nodes.includes('dist/nodes/UploadPostTrigger/UploadPostTrigger.node.js'));
	// Versioned copy of components.schemas.WebhookEventName from the API spec.
	const catalog = require(path.join(__dirname, 'fixtures', 'webhook-event-names.json')).events;
	const events = node.description.properties.find((p) => p.name === 'events').options.map((o) => o.value);
	assert.deepEqual([...events].sort(), [...catalog].sort());
	assert.equal(new Set(events).size, events.length);
	const verify = node.description.properties.find((p) => p.name === 'verifySignature');
	assert.equal(verify.default, true);
	assert.deepEqual(node.description.inputs, []);
	assert.equal(node.description.credentials[0].name, 'uploadPostApi');
});

test('events gated by an account feature say so in their description', () => {
	const options = node.description.properties.find((p) => p.name === 'events').options;
	for (const option of options) {
		if (/^(youtube_video_|post_approval_|post_approved|post_rejected)/.test(option.value)) {
			assert.match(option.description, /Needs .* turned on/, option.value);
		}
	}
});
