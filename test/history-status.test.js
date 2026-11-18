// Get Upload History only sends the limits the API accepts (10, 20, 50, 100;
// page >= 1), and the status polling of an upload survives a 404 and a 429.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { UploadPost } = require(path.join(__dirname, '..', 'dist/nodes/UploadPost/UploadPost.node.js'));

const API = 'https://api.upload-post.com/api';

const baseCtx = (params, request) => ({
	getInputData: () => [{ json: {} }],
	getNodeParameter: (name, _itemIndex, fallback) => {
		if (Object.prototype.hasOwnProperty.call(params, name)) return params[name];
		if (fallback !== undefined) return fallback;
		throw new Error(`missing parameter ${name}`);
	},
	getNode: () => ({ id: 'node-1', name: 'Upload Post', type: 'uploadPost', typeVersion: 1 }),
	getExecutionId: () => 'exec-1',
	getWorkflowDataProxy: () => ({ $thisRunIndex: 0 }),
	helpers: {
		httpRequestWithAuthentication: async (_credential, options) => request(options),
	},
});

const history = async (extra) => {
	const calls = [];
	const ctx = baseCtx({ resource: 'monitoring', operation: 'getHistory', ...extra }, async (options) => {
		calls.push(options);
		return { success: true };
	});
	await new UploadPost().execute.call(ctx);
	assert.equal(calls.length, 1);
	assert.equal(calls[0].url, `${API}/uploadposts/history`);
	return calls[0].qs;
};

test('history limit: the valid values go as they are', async () => {
	for (const limit of [10, 20, 50, 100]) {
		assert.deepEqual(await history({ historyPage: 2, historyLimit: limit }), { page: 2, limit });
	}
});

test('history limit: a saved workflow with another number gets the closest valid one', async () => {
	assert.equal((await history({ historyLimit: 30 })).limit, 20);
	assert.equal((await history({ historyLimit: 45 })).limit, 50);
	assert.equal((await history({ historyLimit: 500 })).limit, 100);
	assert.equal((await history({ historyLimit: 1 })).limit, 10);
	assert.equal((await history({ historyLimit: '50' })).limit, 50);
	assert.equal((await history({})).limit, 20);
});

test('history page below 1 is sent as 1', async () => {
	assert.equal((await history({ historyPage: 0 })).page, 1);
	assert.equal((await history({ historyPage: -3 })).page, 1);
	assert.equal((await history({ historyPage: 2.7 })).page, 2);
});

test('the history limit is a list of the valid values', () => {
	const prop = new UploadPost().description.properties.find((p) => p.name === 'historyLimit');
	assert.equal(prop.type, 'options');
	assert.deepEqual(prop.options.map((o) => o.value), [10, 20, 50, 100]);
	assert.equal(prop.default, 20);
});

// Status polling. The fake behaves like n8n's helper: a status >= 400 throws
// unless ignoreHttpStatusErrors, and returnFullResponse gives status + headers.
const { mock } = require('node:test');

const pollUpload = async (statusAnswers, { pollInterval = 1, pollTimeout = 120 } = {}) => {
	const statusCalls = [];
	const ctx = baseCtx({
		resource: 'uploads',
		operation: 'uploadText',
		user: 'acme',
		platform: ['x'],
		title: 'Hello',
		uploadAsync: true,
		waitForCompletion: true,
		pollInterval,
		pollTimeout,
	}, async (options) => {
		if (options.method === 'POST') return { success: true, request_id: 'req-1' };
		statusCalls.push(Date.now());
		const answer = statusAnswers[Math.min(statusCalls.length - 1, statusAnswers.length - 1)];
		const full = { statusCode: answer.code, headers: answer.headers ?? {}, body: answer.body };
		if (answer.code >= 400 && !options.ignoreHttpStatusErrors) {
			const err = new Error(`Request failed with status code ${answer.code}`);
			err.httpCode = String(answer.code);
			throw err;
		}
		return options.returnFullResponse ? full : full.body;
	});
	mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
	try {
		let settled = false;
		const result = new UploadPost().execute.call(ctx).then(
			(value) => { settled = true; return { value }; },
			(error) => { settled = true; return { error }; },
		);
		for (let i = 0; i < 2000 && !settled; i++) {
			await new Promise((resolve) => setImmediate(resolve));
			mock.timers.tick(500);
		}
		assert.ok(settled, 'polling never finished');
		return { ...(await result), statusCalls };
	} finally {
		mock.timers.reset();
	}
};

const completed = { code: 200, body: { success: true, status: 'completed', request_id: 'req-1' } };
const notFound = { code: 404, body: { success: false, status: 'not_found', request_id: 'req-1' } };

test('polling waits out a 429 (Retry-After) and goes on', async () => {
	const { value, error, statusCalls } = await pollUpload([
		{ code: 429, headers: { 'retry-after': '7' }, body: { success: false, message: 'Too many requests' } },
		completed,
	]);
	assert.equal(error, undefined);
	assert.equal(value[0][0].json.status, 'completed');
	assert.equal(statusCalls.length, 2);
	assert.ok(statusCalls[1] - statusCalls[0] >= 7000, `waited ${statusCalls[1] - statusCalls[0]} ms`);
});

test('polling a 429 stays inside the timeout', async () => {
	const { value, error, statusCalls } = await pollUpload(
		[{ code: 429, headers: { 'retry-after': '3600' }, body: {} }],
		{ pollTimeout: 30 },
	);
	assert.equal(error, undefined);
	assert.equal(value[0][0].json.message, 'Polling timed out');
	assert.ok(statusCalls.every((t) => t <= 31000), String(statusCalls));
});

test('a not_found answer (404) is read and polling goes on', async () => {
	const { value, error } = await pollUpload([notFound, completed]);
	assert.equal(error, undefined);
	assert.equal(value[0][0].json.status, 'completed');
});

test('a 404 that does not go away ends in a clear error, not a loop', async () => {
	const { error, statusCalls } = await pollUpload([notFound], { pollTimeout: 600 });
	assert.ok(error, 'expected an error');
	assert.match(error.message, /req-1/);
	assert.match(error.message, /not_found|not found/i);
	assert.ok(statusCalls.length <= 8, `${statusCalls.length} status calls`);
	assert.ok(statusCalls[statusCalls.length - 1] <= 75000, `last check at ${statusCalls[statusCalls.length - 1]} ms`);
});

test('another error status during polling still fails the node', async () => {
	const { error } = await pollUpload([{ code: 401, body: { success: false, message: 'Invalid API key' } }]);
	assert.ok(error, 'expected an error');
});
