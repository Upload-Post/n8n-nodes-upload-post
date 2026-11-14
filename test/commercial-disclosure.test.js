// Native commercial disclosure (TT-988): the cross-network "Paid Partnership"
// switch and the Facebook / Pinterest sponsor ids. Runs the compiled node's
// execute() with a fake n8n context and reads the multipart form it sends.
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
	const entries = [...calls[0].body.entries()];
	const fields = Object.fromEntries(entries);
	return { url: calls[0].url, fields, entries };
};

const base = {
	resource: 'uploads',
	user: 'my-profile',
	title: 'Sponsored',
	uploadAsync: true,
	idempotencyKey: 'test-key',
};
const video = { ...base, operation: 'uploadVideo', video: 'https://cdn.example.com/v.mp4' };

test('Paid Partnership on: paid_partnership is sent and unticked network fields stay out of its way', async () => {
	const { url, fields } = await run({
		...video,
		platform: ['tiktok', 'youtube'],
		paidPartnership: true,
	});
	assert.equal(url, 'https://api.upload-post.com/api/upload');
	assert.equal(fields.paid_partnership, 'true');
	// The API lets a network field beat the switch even when it is "false".
	assert.equal('brand_content_toggle' in fields, false);
	assert.equal('hasPaidProductPlacement' in fields, false);
});

test('Paid Partnership on: a ticked network field is still sent next to it', async () => {
	const { fields } = await run({
		...video,
		platform: ['tiktok', 'youtube'],
		paidPartnership: true,
		brand_content_toggle: true,
		youtubeHasPaidProductPlacement: true,
	});
	assert.equal(fields.paid_partnership, 'true');
	assert.equal(fields.brand_content_toggle, 'true');
	assert.equal(fields.hasPaidProductPlacement, 'true');
});

test('Paid Partnership off: the request is exactly what it was before', async () => {
	const { fields } = await run({ ...video, platform: ['tiktok', 'youtube'] });
	assert.equal('paid_partnership' in fields, false);
	assert.equal(fields.brand_content_toggle, 'false');
	assert.equal(fields.hasPaidProductPlacement, 'false');
});

test('Paid Partnership works on photos and text, and TikTok photos keep the same rule', async () => {
	const photos = await run({
		...base,
		operation: 'uploadPhotos',
		photos: 'https://cdn.example.com/a.jpg',
		platform: ['tiktok'],
		paidPartnership: true,
	});
	assert.equal(photos.fields.paid_partnership, 'true');
	assert.equal('brand_content_toggle' in photos.fields, false);

	const text = await run({ ...base, operation: 'uploadText', platform: ['x'], paidPartnership: true });
	assert.equal(text.url, 'https://api.upload-post.com/api/upload_text');
	assert.equal(text.fields.paid_partnership, 'true');
});

test('Facebook Sponsor ID is trimmed and sent on video, photo and text posts', async () => {
	for (const operation of ['uploadVideo', 'uploadPhotos', 'uploadText']) {
		const { fields } = await run({
			...video,
			operation,
			platform: ['facebook'],
			facebookPageId: '111',
			facebookSponsorId: ' 1234567890 ',
		});
		assert.equal(fields.facebook_sponsor_id, '1234567890', operation);
	}
});

test('Pinterest Sponsor ID is trimmed and sent', async () => {
	const { fields } = await run({
		...video,
		platform: ['pinterest'],
		pinterestBoardId: 'board1',
		pinterestSponsorId: ' 987654321 ',
	});
	assert.equal(fields.pinterest_sponsor_id, '987654321');
});

test('blank sponsor ids are not sent', async () => {
	const { fields } = await run({
		...video,
		platform: ['facebook', 'pinterest'],
		facebookPageId: '111',
		pinterestBoardId: 'board1',
		facebookSponsorId: '   ',
		pinterestSponsorId: '',
	});
	assert.equal('facebook_sponsor_id' in fields, false);
	assert.equal('pinterest_sponsor_id' in fields, false);
});

test('the node exposes the three new properties', () => {
	const names = new UploadPost().description.properties.map((p) => p.name);
	for (const name of ['paidPartnership', 'facebookSponsorId', 'pinterestSponsorId']) {
		assert.ok(names.includes(name), `${name} property is missing`);
	}
});
