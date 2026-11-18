// The Idempotency-Key the node derives for an upload: different for every pass
// of a loop (Loop Over Items runs the node again in the same execution, always
// with item 0), the same when n8n retries the same request (Retry On Fail).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { UploadPost } = require(path.join(__dirname, '..', 'dist/nodes/UploadPost/UploadPost.node.js'));

const run = async (params, { runIndex = 0, items = [{ json: {} }], buffers = {}, proxy = true } = {}) => {
	const calls = [];
	const ctx = {
		getInputData: () => items,
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
			getBinaryDataBuffer: async (_itemIndex, property) => buffers[property] ?? Buffer.from(''),
		},
	};
	if (proxy) ctx.getWorkflowDataProxy = () => ({ $thisRunIndex: runIndex });
	await new UploadPost().execute.call(ctx);
	assert.equal(calls.length, 1);
	return calls[0].headers['Idempotency-Key'];
};

const text = (title, extra = {}) => ({
	resource: 'uploads',
	operation: 'uploadText',
	user: 'acme',
	platform: ['x'],
	title,
	uploadAsync: true,
	waitForCompletion: false,
	...extra,
});

test('each pass of a loop over items gets its own key', async () => {
	const first = await run(text('Post 1'), { runIndex: 0 });
	const second = await run(text('Post 2'), { runIndex: 1 });
	assert.notEqual(first, second);
});

test('the same content run twice by the loop is still two posts', async () => {
	const first = await run(text('Same'), { runIndex: 0 });
	const second = await run(text('Same'), { runIndex: 1 });
	assert.notEqual(first, second);
});

test('different content with the same run index (no run index available) gets different keys', async () => {
	const first = await run(text('Post 1'), { proxy: false });
	const second = await run(text('Post 2'), { proxy: false });
	assert.notEqual(first, second);
});

test('a retry of the same request keeps the same key', async () => {
	const first = await run(text('Post 1'), { runIndex: 3 });
	const retry = await run(text('Post 1'), { runIndex: 3 });
	assert.equal(first, retry);
	assert.match(first, /^n8n:exec-1:node-1:/);
});

test('files count by name and size: another photo is another key', async () => {
	const photo = (fileName, bytes) => ({
		items: [{ json: {}, binary: { data: { fileName, mimeType: 'image/png' } } }],
		buffers: { data: Buffer.alloc(bytes) },
	});
	const params = text('', { operation: 'uploadPhotos', platform: ['x'], photos: 'data', title: 'Photo' });
	const a = await run(params, photo('a.png', 10));
	const aAgain = await run(params, photo('a.png', 10));
	const b = await run(params, photo('b.png', 10));
	const bigger = await run(params, photo('a.png', 11));
	assert.equal(a, aAgain);
	assert.notEqual(a, b);
	assert.notEqual(a, bigger);
});

test('an explicit Idempotency Key is sent as is', async () => {
	const key = await run(text('Post 1', { idempotencyKey: ' my-key ' }), { runIndex: 2 });
	assert.equal(key, 'my-key');
});
