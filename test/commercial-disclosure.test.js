// Native commercial disclosure (TT-988): the node sends the cross-network
// `paid_partnership` switch and the Facebook / Pinterest sponsor ids, and the
// switch is not cancelled by the explicit "false" the TikTok and YouTube
// toggles used to send. Runs the compiled node with a fake n8n context.
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
		getExecutionId: () => 'exec-1',
		continueOnFail: () => false,
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
	return calls[0].body;
};

const base = { resource: 'uploads', user: 'profile', title: 'Sponsored', uploadAsync: true };
const video = (extra) => run({ ...base, operation: 'uploadVideo', video: 'https://example.com/v.mp4', ...extra });
const text = (extra) => run({ ...base, operation: 'uploadText', ...extra });

test('paid partnership is sent only when ticked', async () => {
	const on = await text({ platform: ['x'], paidPartnership: true });
	assert.equal(on.get('paid_partnership'), 'true');
	const off = await text({ platform: ['x'], paidPartnership: false });
	assert.equal(off.get('paid_partnership'), null);
	const missing = await text({ platform: ['x'] });
	assert.equal(missing.get('paid_partnership'), null, 'a workflow saved before the field existed sends what it did');
});

test('an unticked TikTok / YouTube toggle no longer cancels the switch', async () => {
	const form = await video({ platform: ['tiktok', 'youtube'], paidPartnership: true });
	assert.equal(form.get('paid_partnership'), 'true');
	assert.equal(form.get('brand_content_toggle'), null);
	assert.equal(form.get('hasPaidProductPlacement'), null);
});

test('without the switch the toggles go as they always did, "false" included', async () => {
	const form = await video({ platform: ['tiktok', 'youtube'] });
	assert.equal(form.get('paid_partnership'), null);
	assert.equal(form.get('brand_content_toggle'), 'false');
	assert.equal(form.get('hasPaidProductPlacement'), 'false');
});

test('a ticked network toggle still goes with the switch on', async () => {
	const form = await video({
		platform: ['tiktok', 'youtube'],
		paidPartnership: true,
		brand_content_toggle: true,
		youtubeHasPaidProductPlacement: true,
	});
	assert.equal(form.get('brand_content_toggle'), 'true');
	assert.equal(form.get('hasPaidProductPlacement'), 'true');
});

test('Facebook sponsor id goes on text posts', async () => {
	const form = await text({ platform: ['facebook'], facebookPageId: '1', facebookSponsorId: '1234567890' });
	assert.equal(form.get('facebook_sponsor_id'), '1234567890');
	const without = await text({ platform: ['facebook'], facebookPageId: '1' });
	assert.equal(without.get('facebook_sponsor_id'), null);
});

test('Facebook sponsor id goes on videos', async () => {
	const form = await video({ platform: ['facebook'], facebookPageId: '1', facebookSponsorId: '42' });
	assert.equal(form.get('facebook_sponsor_id'), '42');
});

test('Pinterest sponsor id goes on video pins', async () => {
	const form = await video({ platform: ['pinterest'], pinterestBoardId: 'b1', pinterestSponsorId: '555' });
	assert.equal(form.get('pinterest_sponsor_id'), '555');
	const without = await video({ platform: ['pinterest'], pinterestBoardId: 'b1' });
	assert.equal(without.get('pinterest_sponsor_id'), null);
});
