const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'nodes/UploadPost/UploadPost.node.ts'), 'utf8');

function block(name) {
	const start = source.indexOf(`name: '${name}'`);
	assert.ok(start > 0, `${name} exists`);
	return source.slice(start, source.indexOf('displayOptions', start));
}

test('cached post analytics can be filtered by X and Bluesky (both are cached)', () => {
	const platforms = block('cachedAnalyticsPlatform');
	assert.match(platforms, /value: 'x'/);
	assert.match(platforms, /value: 'bluesky'/);
	assert.doesNotMatch(platforms, /does not store it/);
});

test('post_analytics_updated can be subscribed to and filtered in the delivery log', () => {
	assert.match(block('webhookEvents'), /value: 'post_analytics_updated'/);
	assert.match(block('webhookDeliveriesEvent'), /value: 'post_analytics_updated'/);
	assert.doesNotMatch(
		source.slice(source.indexOf("name: 'webhookEvents'"), source.indexOf("name: 'webhookEvents'") + 3000),
		/default: \[[^\]]*post_analytics_updated/,
		'opt-in: not in the default selection',
	);
});
