// Runs the compiled node's execute() for the TikTok Ad operations and checks
// the HTTP request each one sends: the documented route and field names, the
// ad account choice, paused by default, and nothing deleted without Confirm Delete.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.join(__dirname, '..');
const { UploadPost } = require(path.join(root, 'dist/nodes/UploadPost/UploadPost.node.js'));

const run = async (params) => {
	const calls = [];
	const ctx = {
		getInputData: () => [{ json: {} }],
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
		},
	};
	await new UploadPost().execute.call(ctx);
	assert.equal(calls.length, 1);
	return calls[0];
};

const API = 'https://api.upload-post.com/api/uploadposts/ads/tiktok';
const ads = (operation, extra = {}) => run({ resource: 'tiktokAds', operation, ...extra });
const POST = { tiktokAdsIdentityId: '5f39abca-0000-4000-8000-000000000001', tiktokAdsPostId: '7311111111111111111' };

test('the resource and its operations are offered', () => {
	const props = new UploadPost().description.properties;
	const resource = props.find((p) => p.name === 'resource');
	assert.ok(resource.options.some((o) => o.value === 'tiktokAds'));
	const ops = props.find((p) => p.name === 'operation' && p.displayOptions.show.resource.includes('tiktokAds'));
	assert.equal(ops.options.length, 34);
	assert.ok(!ops.options.some((o) => /authoriz/i.test(o.value)), 'no Spark authorization of the own post');
});

test('boost: post of the linked TikTok account, budget, targeting, paused at every level by default', async () => {
	const req = await ads('boostPost', {
		...POST,
		tiktokAdsProfile: 'my-profile',
		tiktokAdsGoal: 'reach',
		tiktokAdsBudget: 20,
		tiktokAdsCountries: 'es, mx',
		tiktokAdsTargeting: { ageMin: 18, ageMax: 44, interestCategoryIds: '17, 1701' },
		tiktokAdsSchedule: { endDate: '2026-12-15' },
		tiktokAdsIdempotencyKey: 'boost-1',
	});
	assert.equal(req.method, 'POST');
	assert.equal(req.url, `${API}/boost`);
	assert.deepEqual(req.body, {
		profile_username: 'my-profile',
		goal: 'reach',
		identity_id: '5f39abca-0000-4000-8000-000000000001',
		post_id: '7311111111111111111',
		budget: { amount: 20, type: 'daily' },
		targeting: { countries: ['ES', 'MX'], age_min: 18, age_max: 44, interest_category_ids: ['17', '1701'] },
		schedule: { end_date: '2026-12-15' },
		status: 'paused',
		idempotency_key: 'boost-1',
		pause_all_levels: true,
	});
});

test('boost active sends no pause_all_levels; a button needs a landing page', async () => {
	const req = await ads('boostPost', { ...POST, tiktokAdsGoal: 'video_views', tiktokAdsCountries: 'ES', tiktokAdsStatus: 'active' });
	assert.equal(req.body.status, 'active');
	assert.equal(req.body.pause_all_levels, undefined);
	await assert.rejects(ads('boostPost', { ...POST, tiktokAdsCountries: 'ES', tiktokAdsCallToAction: 'SHOP_NOW' }), /needs a Landing Page URL/);
	await assert.rejects(
		ads('boostPost', { ...POST, tiktokAdsCountries: 'ES', tiktokAdsLandingPage: 'https://example.com', tiktokAdsCallToAction: 'VIEW_PROFILE' }),
		/only works with the Followers goal/,
	);
	await assert.rejects(ads('boostPost', { ...POST, tiktokAdsGoal: 'traffic', tiktokAdsCountries: 'ES' }), /Traffic goal needs a Landing Page URL/);
});

test('campaign, ad group and ad creates', async () => {
	const campaign = await ads('createCampaign', { tiktokAdsName: 'Summer', tiktokAdsGoal: 'video_views', tiktokAdsAdvertiserId: '7300' });
	assert.equal(campaign.url, `${API}/campaigns`);
	assert.deepEqual(campaign.body, { advertiser_id: '7300', name: 'Summer', goal: 'video_views', status: 'paused' });
	const adgroup = await ads('createAdgroup', {
		tiktokAdsCampaignId: 'c1', tiktokAdsName: 'ES', tiktokAdsGoal: 'reach', tiktokAdsBudget: 25, tiktokAdsCountries: 'ES',
		tiktokAdsFrequency: { frequency: 2, frequencySchedule: 7 },
	});
	assert.equal(adgroup.url, `${API}/adgroups`);
	assert.deepEqual(adgroup.body, {
		campaign_id: 'c1', name: 'ES', goal: 'reach', budget: { amount: 25, type: 'daily' }, targeting: { countries: ['ES'] },
		frequency: 2, frequency_schedule: 7, status: 'paused',
	});
	const ad = await ads('createAd', {
		...POST, tiktokAdsAdgroupId: 'g1', tiktokAdsName: 'Ad', tiktokAdsGoal: 'reach',
		tiktokAdsLandingPage: 'https://example.com', tiktokAdsCallToAction: 'SHOP_NOW',
	});
	assert.equal(ad.url, `${API}/ads`);
	assert.deepEqual(ad.body, {
		adgroup_id: 'g1', name: 'Ad', goal: 'reach', identity_id: POST.tiktokAdsIdentityId, post_id: POST.tiktokAdsPostId,
		landing_page_url: 'https://example.com', call_to_action: 'SHOP_NOW', status: 'paused',
	});
});

test('pause and resume; delete only with Confirm Delete', async () => {
	const pause = await ads('pauseCampaign', { tiktokAdsCampaignId: 'c1', tiktokAdsProfile: 'my-profile' });
	assert.equal(pause.url, `${API}/campaigns/c1/pause`);
	assert.deepEqual(pause.body, { profile_username: 'my-profile' });
	assert.equal((await ads('resumeAdgroup', { tiktokAdsAdgroupId: 'g1' })).url, `${API}/adgroups/g1/resume`);
	await assert.rejects(ads('deleteAd', { tiktokAdsAdId: 'a1' }), /Confirm Delete/);
	const del = await ads('deleteAd', { tiktokAdsAdId: 'a1', tiktokAdsConfirmDelete: true });
	assert.equal(del.url, `${API}/ads/a1/delete`);
	assert.deepEqual(del.body, { confirm: true });
	await assert.rejects(ads('deleteAudience', { tiktokAdsAudienceId: 'aud1' }), /Confirm Delete/);
});

test('updates are PATCH with only what changes', async () => {
	const group = await ads('updateAdgroup', { tiktokAdsAdgroupId: 'g1', tiktokAdsNewBudget: 40 });
	assert.equal(group.method, 'PATCH');
	assert.equal(group.url, `${API}/adgroups/g1`);
	assert.deepEqual(group.body, { budget: 40 });
	const ad = await ads('updateAd', { tiktokAdsAdId: 'a1', tiktokAdsOptionalName: 'New name' });
	assert.deepEqual(ad.body, { name: 'New name' });
	await assert.rejects(ads('updateCampaign', { tiktokAdsCampaignId: 'c1' }), /Nothing to change/);
});

test('reads: identities, posts, lists, report, countries', async () => {
	const posts = await ads('listPosts', { tiktokAdsIdentityId: 'id-1', tiktokAdsCursor: '1732700000000' });
	assert.equal(posts.method, 'GET');
	assert.equal(posts.url, `${API}/spark/posts`);
	assert.deepEqual(posts.qs, { identity_id: 'id-1', item_type: 'VIDEO', cursor: '1732700000000' });
	const list = await ads('listAds', { tiktokAdsFilterAdgroupIds: 'g1', tiktokAdsPageSize: 20 });
	assert.equal(list.url, `${API}/ads`);
	assert.deepEqual(list.qs, { adgroup_id: 'g1', page_size: 20 });
	const report = await ads('getReport', { tiktokAdsLevel: 'ad', tiktokAdsIds: 'a1,a2', tiktokAdsBreakdown: 'day', tiktokAdsStartDate: '2026-11-18' });
	assert.equal(report.url, `${API}/insights`);
	assert.deepEqual(report.qs, { level: 'ad', ids: 'a1,a2', start_date: '2026-11-18', breakdown: 'day' });
	await assert.rejects(ads('getReport', { tiktokAdsLevel: 'advertiser', tiktokAdsIds: 'a1' }), /Ad Account level/);
	const countries = await ads('listCountries', { tiktokAdsGoal: 'followers' });
	assert.deepEqual([countries.url, countries.qs], [`${API}/locations`, { goal: 'followers' }]);
});

test('connect link and disconnect', async () => {
	const link = await ads('getConnectLink', { tiktokAdsProfile: 'my-profile' });
	assert.deepEqual([link.method, link.url, link.body], ['POST', `${API}/connect`, { profile_username: 'my-profile' }]);
	const gone = await ads('disconnectAccount', { tiktokAdsDisconnectId: '7300', tiktokAdsUnlinkProfile: 'my-profile' });
	assert.equal(gone.method, 'DELETE');
	assert.equal(gone.url, `${API}/accounts/7300`);
	assert.deepEqual(gone.qs, { profile_username: 'my-profile' });
});

test('customer file audience sends the identifiers as a list', async () => {
	const req = await ads('createCustomerFileAudience', {
		tiktokAdsName: 'Newsletter', tiktokAdsIdentifiers: 'ana@example.com\nluis@example.com', tiktokAdsRetention: 30,
	});
	assert.equal(req.url, `${API}/audiences/customer-file`);
	assert.deepEqual(req.body, {
		name: 'Newsletter', identifier_type: 'email', identifiers: ['ana@example.com', 'luis@example.com'], retention_in_days: 30,
	});
});
