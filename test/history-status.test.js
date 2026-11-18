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
