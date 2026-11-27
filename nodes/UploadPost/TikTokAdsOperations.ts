import { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { bool, fail, NetworkContext, NetworkRequest, param, putFilled, requireStr, str } from './NetworkOperations';

// TikTok Ads on the customer's own TikTok ad account (TikTok Marketing API):
// promote a post of the TikTok account linked to the ad account in one call
// (boost), campaigns, ad groups and ads, reports, targeting and audiences.
// TikTok charges the spend to that ad account; Upload-Post never does.
// Everything is created paused unless Status is Active.
// Not offered: Upload-Post generating the Spark code of the profile's own post
// (it needs a TikTok permission Upload-Post does not have).

const P = '/uploadposts/ads/tiktok';
const RESOURCE = 'tiktokAds';

const call = (method: NetworkRequest['method'], endpoint: string, payload: IDataObject): NetworkRequest => {
	const base = { endpoint, method, isUploadOperation: false, waitForCompletion: false };
	return method === 'GET' || method === 'DELETE' ? { ...base, qs: payload } : { ...base, body: payload };
};

const show = (operation: string[], extra: IDataObject = {}) => ({ show: { resource: [RESOURCE], operation, ...extra } });

const LEVELS = ['Campaign', 'Adgroup', 'Ad'];
const STATUS_OPS = LEVELS.flatMap((l) => [`pause${l}`, `resume${l}`, `delete${l}`]);
const CAMPAIGN_ID_OPS = ['pauseCampaign', 'resumeCampaign', 'deleteCampaign', 'updateCampaign', 'createAdgroup'];
const ADGROUP_ID_OPS = ['pauseAdgroup', 'resumeAdgroup', 'deleteAdgroup', 'updateAdgroup', 'createAd'];
const AD_ID_OPS = ['pauseAd', 'resumeAd', 'deleteAd', 'updateAd'];
const CREATE_OPS = ['boostPost', 'createCampaign', 'createAdgroup', 'createAd'];
const TARGETING_OPS = ['boostPost', 'createAdgroup'];
const POST_OPS = ['boostPost', 'createAd'];
const LIST_OPS = ['listCampaigns', 'listAdgroups', 'listAds'];
const NO_ACCOUNT_OPS = ['getConnectLink', 'listAccounts', 'disconnectAccount'];
const ALL_OPS = [
	'getConnectLink', 'listAccounts', 'getAccount', 'disconnectAccount', 'listIdentities', 'listPosts', 'boostPost',
	'listCampaigns', 'createCampaign', 'updateCampaign', 'listAdgroups', 'createAdgroup', 'updateAdgroup', 'listAds',
	'createAd', 'updateAd', ...STATUS_OPS, 'getReport', 'listCountries', 'listInterests', 'listAudiences',
	'createCustomerFileAudience', 'createLookalikeAudience', 'deleteAudience', 'uploadVideo', 'uploadImage',
];
const ACCOUNT_OPS = ALL_OPS.filter((op) => !NO_ACCOUNT_OPS.includes(op));
const GOALS = [
	{ name: 'Followers', value: 'followers' },
	{ name: 'Reach', value: 'reach' },
	{ name: 'Traffic (Website)', value: 'traffic' },
	{ name: 'Video Views', value: 'video_views' },
];
const CALLS_TO_ACTION = [
	'APPLY_NOW', 'BOOK_NOW', 'CALL_NOW', 'CHECK_AVAILABILITY', 'CONTACT_US', 'DOWNLOAD_NOW', 'EXPERIENCE_NOW', 'GET_QUOTE',
	'GET_SHOWTIMES', 'GET_TICKETS_NOW', 'INSTALL_NOW', 'INTERESTED', 'LEARN_MORE', 'LISTEN_NOW', 'ORDER_NOW', 'PLAY_GAME',
	'PREORDER_NOW', 'READ_MORE', 'SEND_MESSAGE', 'SHOP_NOW', 'SIGN_UP', 'SUBSCRIBE', 'VIEW_NOW', 'VIEW_PROFILE',
	'VISIT_STORE', 'WATCH_NOW',
];
const label = (value: string) => value.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export const tiktokAdsProperties: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		options: [
			{ name: 'Boost Post', value: 'boostPost', action: 'Promote a tiktok post in one call', description: 'Campaign, ad group and Spark Ad for a post of the TikTok account linked to the ad account. Created paused.' },
			{ name: 'Create Ad', value: 'createAd', action: 'Create a tiktok ad', description: 'An ad in an ad group that promotes a post of the linked TikTok account. Created paused.' },
			{ name: 'Create Ad Group', value: 'createAdgroup', action: 'Create a tiktok ad group', description: 'Budget, schedule and targeting under a campaign. Created paused.' },
			{ name: 'Create Campaign', value: 'createCampaign', action: 'Create a tiktok campaign', description: 'A campaign with a goal. Created paused.' },
			{ name: 'Create Customer File Audience', value: 'createCustomerFileAudience', action: 'Create a tiktok audience from emails or phones', description: 'Emails or phones, hashed with SHA-256 before they leave Upload-Post' },
			{ name: 'Create Lookalike Audience', value: 'createLookalikeAudience', action: 'Create a tiktok lookalike audience', description: 'People similar to an existing audience' },
			{ name: 'Delete Ad', value: 'deleteAd', action: 'Delete a tiktok ad', description: 'Cannot be undone: needs Confirm Delete' },
			{ name: 'Delete Ad Group', value: 'deleteAdgroup', action: 'Delete a tiktok ad group', description: 'Cannot be undone: needs Confirm Delete' },
			{ name: 'Delete Audience', value: 'deleteAudience', action: 'Delete a tiktok audience', description: 'Cannot be undone: needs Confirm Delete' },
			{ name: 'Delete Campaign', value: 'deleteCampaign', action: 'Delete a tiktok campaign', description: 'Cannot be undone: needs Confirm Delete' },
			{ name: 'Disconnect Account', value: 'disconnectAccount', action: 'Disconnect a tiktok ad account', description: 'Forget the ad account, or only unlink it from a profile. Its campaigns keep running in TikTok.' },
			{ name: 'Get Account', value: 'getAccount', action: 'Get a tiktok ad account', description: 'Live name, currency, time zone, status, balance and country' },
			{ name: 'Get Connect Link', value: 'getConnectLink', action: 'Get the link to connect a tiktok ad account', description: 'TikTok page where the ad account owner approves Upload-Post' },
			{ name: 'Get Report', value: 'getReport', action: 'Get a tiktok ads report', description: 'Spend, impressions, clicks, CTR, CPC, CPM, reach, video views and follows' },
			{ name: 'List Accounts', value: 'listAccounts', action: 'List connected tiktok ad accounts', description: 'Connected ad accounts with their linked profiles' },
			{ name: 'List Ad Groups', value: 'listAdgroups', action: 'List tiktok ad groups', description: 'As TikTok has them, also those made in TikTok Ads Manager' },
			{ name: 'List Ads', value: 'listAds', action: 'List tiktok ads', description: 'As TikTok has them, also those made in TikTok Ads Manager' },
			{ name: 'List Audiences', value: 'listAudiences', action: 'List tiktok audiences', description: 'Custom and lookalike audiences of the ad account' },
			{ name: 'List Campaigns', value: 'listCampaigns', action: 'List tiktok campaigns', description: 'As TikTok has them, also those made in TikTok Ads Manager' },
			{ name: 'List Countries', value: 'listCountries', action: 'List the countries tiktok delivers a goal to', description: 'Countries for Countries in targeting, per goal' },
			{ name: 'List Identities', value: 'listIdentities', action: 'List the tiktok accounts of the ad account', description: 'TikTok accounts the ad account can advertise as (Identity ID for Boost Post and Create Ad)' },
			{ name: 'List Interests', value: 'listInterests', action: 'List tiktok interest categories', description: 'Interest categories for targeting' },
			{ name: 'List Posts', value: 'listPosts', action: 'List the posts of a tiktok identity', description: 'Posts of a linked TikTok account (Post ID for Boost Post and Create Ad)' },
			{ name: 'Pause Ad', value: 'pauseAd', action: 'Pause a tiktok ad' },
			{ name: 'Pause Ad Group', value: 'pauseAdgroup', action: 'Pause a tiktok ad group' },
			{ name: 'Pause Campaign', value: 'pauseCampaign', action: 'Pause a tiktok campaign', description: 'Stops everything under it' },
			{ name: 'Resume Ad', value: 'resumeAd', action: 'Resume a tiktok ad', description: 'Can start spending right away' },
			{ name: 'Resume Ad Group', value: 'resumeAdgroup', action: 'Resume a tiktok ad group', description: 'Can start spending right away' },
			{ name: 'Resume Campaign', value: 'resumeCampaign', action: 'Resume a tiktok campaign', description: 'Can start spending right away' },
			{ name: 'Update Ad', value: 'updateAd', action: 'Rename a tiktok ad', description: 'The text of an ad made from a post is its caption and cannot be changed' },
			{ name: 'Update Ad Group', value: 'updateAdgroup', action: 'Update a tiktok ad group', description: 'Name or budget (at least 105% of what it already spent)' },
			{ name: 'Update Campaign', value: 'updateCampaign', action: 'Update a tiktok campaign', description: 'Name or budget (only a campaign with its own budget)' },
			{ name: 'Upload Image', value: 'uploadImage', action: 'Upload an image to the tiktok ad account', description: 'TikTok downloads it from a URL and returns image_id' },
			{ name: 'Upload Video', value: 'uploadVideo', action: 'Upload a video to the tiktok ad account', description: 'TikTok downloads it from a URL and returns video_id' },
		],
		default: 'listCampaigns',
		displayOptions: { show: { resource: [RESOURCE] } },
	},
	{
		displayName:
			'Spend runs on your own TikTok ad account: TikTok charges it, Upload-Post never does. Everything is created paused unless Status is Active. TikTok refuses ad groups under about 20 EUR a day.',
		name: 'tiktokAdsNotice',
		type: 'notice',
		default: '',
		displayOptions: { show: { resource: [RESOURCE] } },
	},

	// ---- Which ad account ----
	{
		displayName: 'Profile Name or ID',
		name: 'tiktokAdsProfile',
		type: 'options',
		default: '',
		description: 'Use only the TikTok ad account linked to this profile (never the default). Empty = the ad account in Ad Account ID, the only one or the default one. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		typeOptions: { loadOptionsMethod: 'getUserProfiles' },
		displayOptions: show([...ACCOUNT_OPS, 'getConnectLink']),
	},
	{
		displayName: 'Ad Account ID',
		name: 'tiktokAdsAdvertiserId',
		type: 'string',
		default: '',
		placeholder: '7300000000000000001',
		description: 'Connected TikTok ad account (advertiser_id from List Accounts). Empty = the one linked to the profile, the only one or the default one.',
		displayOptions: show(ACCOUNT_OPS),
	},
	{
		displayName: 'Redirect URL',
		name: 'tiktokAdsRedirectUrl',
		type: 'string',
		default: '',
		description: 'Where the Upload-Post dashboard sends the user after connecting (gets ?connect_status=success)',
		displayOptions: show(['getConnectLink']),
	},
	{
		displayName: 'Ad Account ID',
		name: 'tiktokAdsDisconnectId',
		type: 'string',
		required: true,
		default: '',
		description: 'The ad account to disconnect (advertiser_id from List Accounts)',
		displayOptions: show(['disconnectAccount']),
	},
	{
		displayName: 'Only Unlink From Profile Name or ID',
		name: 'tiktokAdsUnlinkProfile',
		type: 'options',
		default: '',
		description: 'Only unlink the ad account from this profile. Empty = disconnect it from Upload-Post and unlink every profile. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		typeOptions: { loadOptionsMethod: 'getUserProfiles' },
		displayOptions: show(['disconnectAccount']),
	},

	// ---- Objects ----
	{
		displayName: 'Campaign ID',
		name: 'tiktokAdsCampaignId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: show(CAMPAIGN_ID_OPS),
	},
	{
		displayName: 'Ad Group ID',
		name: 'tiktokAdsAdgroupId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: show(ADGROUP_ID_OPS),
	},
	{
		displayName: 'Ad ID',
		name: 'tiktokAdsAdId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: show(AD_ID_OPS),
	},
	{
		displayName: 'Audience ID',
		name: 'tiktokAdsAudienceId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: show(['deleteAudience']),
	},
	{
		displayName: 'Confirm Delete',
		name: 'tiktokAdsConfirmDelete',
		type: 'boolean',
		default: false,
		description: 'Whether to really delete it. Deleting cannot be undone; nothing is sent without it.',
		displayOptions: show(['deleteCampaign', 'deleteAdgroup', 'deleteAd', 'deleteAudience']),
	},

	// ---- Post to promote ----
	{
		displayName: 'Identity ID',
		name: 'tiktokAdsIdentityId',
		type: 'string',
		required: true,
		default: '',
		placeholder: '5f39abca-0000-4000-8000-000000000001',
		description: 'The TikTok account that published the post (identity_id from List Identities)',
		displayOptions: show([...POST_OPS, 'listPosts']),
	},
	{
		displayName: 'Post ID',
		name: 'tiktokAdsPostId',
		type: 'string',
		required: true,
		default: '',
		placeholder: '7311111111111111111',
		description: 'The post (item_id from List Posts). The ad text is its caption.',
		displayOptions: show(POST_OPS),
	},
	{
		displayName: 'Post Type',
		name: 'tiktokAdsItemType',
		type: 'options',
		options: [
			{ name: 'Video', value: 'VIDEO' },
			{ name: 'Photo (Carousel)', value: 'CAROUSEL' },
		],
		default: 'VIDEO',
		displayOptions: show(['listPosts']),
	},
	{
		displayName: 'Cursor',
		name: 'tiktokAdsCursor',
		type: 'string',
		default: '',
		description: 'The cursor of the previous page, while has_more is true',
		displayOptions: show(['listPosts']),
	},

	// ---- Create ----
	{
		displayName: 'Name',
		name: 'tiktokAdsName',
		type: 'string',
		required: true,
		default: '',
		description: 'Up to 512 characters (audiences: 128)',
		displayOptions: show(['createCampaign', 'createAdgroup', 'createAd', 'createCustomerFileAudience', 'createLookalikeAudience']),
	},
	{
		displayName: 'Name',
		name: 'tiktokAdsOptionalName',
		type: 'string',
		default: '',
		description: 'New name (empty = unchanged). For Boost Post: the name of the three objects.',
		displayOptions: show(['boostPost', 'updateCampaign', 'updateAdgroup', 'updateAd']),
	},
	{
		displayName: 'Goal',
		name: 'tiktokAdsGoal',
		type: 'options',
		options: GOALS,
		default: 'reach',
		description: 'What TikTok optimizes for. An ad group uses the goal of its campaign.',
		displayOptions: show(['boostPost', 'createCampaign', 'createAdgroup', 'createAd', 'listCountries']),
	},
	{
		displayName: 'Budget',
		name: 'tiktokAdsBudget',
		type: 'number',
		typeOptions: { minValue: 0, numberPrecision: 2 },
		default: 20,
		description: 'In the ad account currency. TikTok refuses ad groups under about 20 EUR a day.',
		displayOptions: show(['boostPost', 'createAdgroup']),
	},
	{
		displayName: 'Budget Type',
		name: 'tiktokAdsBudgetType',
		type: 'options',
		options: [
			{ name: 'Daily', value: 'daily' },
			{ name: 'Lifetime (Needs End Date)', value: 'lifetime' },
		],
		default: 'daily',
		displayOptions: show(['boostPost', 'createAdgroup']),
	},
	{
		displayName: 'Campaign Budget',
		name: 'tiktokAdsCampaignBudget',
		type: 'number',
		typeOptions: { minValue: 0, numberPrecision: 2 },
		default: 0,
		description: '0 = no campaign budget (it lives in the ad groups). For Update Campaign only a campaign with its own budget can change it.',
		displayOptions: show(['createCampaign', 'updateCampaign']),
	},
	{
		displayName: 'Campaign Budget Type',
		name: 'tiktokAdsCampaignBudgetType',
		type: 'options',
		options: [
			{ name: 'Daily', value: 'daily' },
			{ name: 'Lifetime', value: 'lifetime' },
		],
		default: 'daily',
		displayOptions: show(['createCampaign']),
	},
	{
		displayName: 'New Budget',
		name: 'tiktokAdsNewBudget',
		type: 'number',
		typeOptions: { minValue: 0, numberPrecision: 2 },
		default: 0,
		description: '0 = unchanged. TikTok requires at least 105% of what the ad group already spent.',
		displayOptions: show(['updateAdgroup']),
	},
	{
		displayName: 'Countries',
		name: 'tiktokAdsCountries',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'ES, MX',
		description: 'ISO country codes, comma-separated. List Countries gives the ones TikTok delivers the goal to.',
		displayOptions: show([...TARGETING_OPS, 'createLookalikeAudience']),
	},
	{
		displayName: 'Targeting Options',
		name: 'tiktokAdsTargeting',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: show(TARGETING_OPS),
		options: [
			{ displayName: 'Age From', name: 'ageMin', type: 'number', typeOptions: { minValue: 13, maxValue: 100 }, default: 18, description: 'Without an age range only people aged 18 and over' },
			{ displayName: 'Age To', name: 'ageMax', type: 'number', typeOptions: { minValue: 13, maxValue: 100 }, default: 100 },
			{ displayName: 'Audience IDs', name: 'audienceIds', type: 'string', default: '', description: 'Custom or lookalike audiences to target, comma-separated' },
			{ displayName: 'Excluded Audience IDs', name: 'excludedAudienceIds', type: 'string', default: '', description: 'Audiences to leave out, comma-separated' },
			{
				displayName: 'Gender',
				name: 'gender',
				type: 'options',
				options: [
					{ name: 'All', value: 'all' },
					{ name: 'Female', value: 'female' },
					{ name: 'Male', value: 'male' },
				],
				default: 'all',
			},
			{ displayName: 'Interest Category IDs', name: 'interestCategoryIds', type: 'string', default: '', description: 'From List Interests, comma-separated' },
			{ displayName: 'Languages', name: 'languages', type: 'string', default: '', description: 'Language codes, comma-separated' },
		],
	},
	{
		displayName: 'Schedule',
		name: 'tiktokAdsSchedule',
		type: 'collection',
		placeholder: 'Add Date',
		default: {},
		displayOptions: show(TARGETING_OPS),
		options: [
			{ displayName: 'End Date', name: 'endDate', type: 'string', default: '', placeholder: '2026-12-15', description: 'YYYY-MM-DD (until 23:59:59 UTC) or ISO 8601. Needed for a lifetime budget.' },
			{ displayName: 'Start Date', name: 'startDate', type: 'string', default: '', placeholder: '2026-12-01', description: 'YYYY-MM-DD (UTC) or ISO 8601. Empty = now.' },
		],
	},
	{
		displayName: 'Landing Page URL',
		name: 'tiktokAdsLandingPage',
		type: 'string',
		default: '',
		description: 'Website the ad links to. Required for the Traffic goal; without it the ad has no button.',
		displayOptions: show(POST_OPS),
	},
	{
		displayName: 'Call to Action',
		name: 'tiktokAdsCallToAction',
		type: 'options',
		options: [{ name: 'Default (Learn More With a Landing Page)', value: '' }, ...CALLS_TO_ACTION.map((v) => ({ name: label(v), value: v }))],
		default: '',
		description: 'Button of the ad. Only with a Landing Page URL; View Profile only with the Followers goal.',
		displayOptions: show(POST_OPS),
	},
	{
		displayName: 'Frequency Cap',
		name: 'tiktokAdsFrequency',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		description: 'Reach goal only. Default: 3 impressions per person every 7 days.',
		displayOptions: show(TARGETING_OPS, { tiktokAdsGoal: ['reach'] }),
		options: [
			{ displayName: 'Impressions', name: 'frequency', type: 'number', typeOptions: { minValue: 1, maxValue: 1000 }, default: 3 },
			{ displayName: 'Every (Days)', name: 'frequencySchedule', type: 'number', typeOptions: { minValue: 1, maxValue: 30 }, default: 7 },
		],
	},
	{
		displayName: 'Status',
		name: 'tiktokAdsStatus',
		type: 'options',
		options: [
			{ name: 'Paused', value: 'paused' },
			{ name: 'Active (Can Start Spending)', value: 'active' },
		],
		default: 'paused',
		displayOptions: show(CREATE_OPS),
	},
	{
		displayName: 'Pause All Levels',
		name: 'tiktokAdsPauseAllLevels',
		type: 'boolean',
		default: true,
		description: 'Whether the ad group and the ad are also created paused (then resume the ad, the ad group and the campaign). Off: only the campaign is paused and resuming it starts delivery.',
		displayOptions: show(['boostPost'], { tiktokAdsStatus: ['paused'] }),
	},
	{
		displayName: 'Idempotency Key',
		name: 'tiktokAdsIdempotencyKey',
		type: 'string',
		default: '',
		description: 'A retry with the same key within 10 minutes answers 409 instead of creating it twice (up to 128 characters)',
		displayOptions: show(CREATE_OPS),
	},
	{
		displayName: 'New Ad Text',
		name: 'tiktokAdsAdText',
		type: 'string',
		default: '',
		description: 'Only for ads made from a new video (up to 100 characters). An ad made from a post uses its caption.',
		displayOptions: show(['updateAd']),
	},

	// ---- Lists and reports ----
	{
		displayName: 'IDs',
		name: 'tiktokAdsIds',
		type: 'string',
		default: '',
		description: 'Only these IDs, comma-separated (up to 100)',
		displayOptions: show([...LIST_OPS, 'getReport']),
	},
	{
		displayName: 'Of Campaigns',
		name: 'tiktokAdsFilterCampaignIds',
		type: 'string',
		default: '',
		description: 'Only those of these campaigns, comma-separated',
		displayOptions: show(['listAdgroups', 'listAds']),
	},
	{
		displayName: 'Of Ad Groups',
		name: 'tiktokAdsFilterAdgroupIds',
		type: 'string',
		default: '',
		description: 'Only those of these ad groups, comma-separated',
		displayOptions: show(['listAds']),
	},
	{
		displayName: 'Page',
		name: 'tiktokAdsPage',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 1,
		displayOptions: show([...LIST_OPS, 'listIdentities', 'listAudiences']),
	},
	{
		displayName: 'Page Size',
		name: 'tiktokAdsPageSize',
		type: 'number',
		typeOptions: { minValue: 1, maxValue: 100 },
		default: 50,
		displayOptions: show([...LIST_OPS, 'listIdentities', 'listAudiences']),
	},
	{
		displayName: 'Level',
		name: 'tiktokAdsLevel',
		type: 'options',
		options: [
			{ name: 'Ad', value: 'ad' },
			{ name: 'Ad Account', value: 'advertiser' },
			{ name: 'Ad Group', value: 'adgroup' },
			{ name: 'Campaign', value: 'campaign' },
		],
		default: 'campaign',
		description: 'One row per object of this level. IDs only with Campaign, Ad Group or Ad.',
		displayOptions: show(['getReport']),
	},
	{
		displayName: 'Start Date',
		name: 'tiktokAdsStartDate',
		type: 'string',
		default: '',
		placeholder: '2026-11-18',
		description: 'YYYY-MM-DD. Empty = 6 days before End Date.',
		displayOptions: show(['getReport']),
	},
	{
		displayName: 'End Date',
		name: 'tiktokAdsEndDate',
		type: 'string',
		default: '',
		placeholder: '2026-11-24',
		description: 'YYYY-MM-DD. Empty = today (UTC).',
		displayOptions: show(['getReport']),
	},
	{
		displayName: 'Breakdown',
		name: 'tiktokAdsBreakdown',
		type: 'options',
		options: [
			{ name: 'Age', value: 'age' },
			{ name: 'Country', value: 'country' },
			{ name: 'Day (Up to 30 Days)', value: 'day' },
			{ name: 'Gender', value: 'gender' },
			{ name: 'None', value: '' },
			{ name: 'Platform', value: 'platform' },
		],
		default: '',
		displayOptions: show(['getReport']),
	},
	{
		displayName: 'Language',
		name: 'tiktokAdsLanguage',
		type: 'string',
		default: 'en',
		displayOptions: show(['listInterests']),
	},

	// ---- Audiences and creatives ----
	{
		displayName: 'Identifier Type',
		name: 'tiktokAdsIdentifierType',
		type: 'options',
		options: [
			{ name: 'Email', value: 'email' },
			{ name: 'Phone (E.164)', value: 'phone' },
		],
		default: 'email',
		displayOptions: show(['createCustomerFileAudience']),
	},
	{
		displayName: 'Identifiers',
		name: 'tiktokAdsIdentifiers',
		type: 'string',
		typeOptions: { rows: 4 },
		required: true,
		default: '',
		description: 'One email or phone (+34600112233) per line or comma-separated, up to 100,000. Hashed with SHA-256 before it leaves Upload-Post.',
		displayOptions: show(['createCustomerFileAudience']),
	},
	{
		displayName: 'Retention (Days)',
		name: 'tiktokAdsRetention',
		type: 'number',
		typeOptions: { minValue: 0, maxValue: 365 },
		default: 0,
		description: '1-365. 0 = TikTok\'s default.',
		displayOptions: show(['createCustomerFileAudience']),
	},
	{
		displayName: 'Source Audience ID',
		name: 'tiktokAdsSourceAudienceId',
		type: 'string',
		required: true,
		default: '',
		description: 'An audience that is not a lookalike itself',
		displayOptions: show(['createLookalikeAudience']),
	},
	{
		displayName: 'Audience Size',
		name: 'tiktokAdsAudienceSize',
		type: 'options',
		options: [
			{ name: 'Balanced', value: 'BALANCED' },
			{ name: 'Broad', value: 'BROAD' },
			{ name: 'Narrow', value: 'NARROW' },
		],
		default: 'BALANCED',
		displayOptions: show(['createLookalikeAudience']),
	},
	{
		displayName: 'Media URL',
		name: 'tiktokAdsMediaUrl',
		type: 'string',
		required: true,
		default: '',
		description: 'Public URL TikTok downloads the file from',
		displayOptions: show(['uploadVideo', 'uploadImage']),
	},
];

const csv = (raw: string): string[] =>
	raw
		.split(/[\n,]/)
		.map((v) => v.trim())
		.filter(Boolean);

const account = (ctx: NetworkContext): IDataObject => {
	const out: IDataObject = {};
	putFilled(ctx, out, [['tiktokAdsProfile', 'profile_username'], ['tiktokAdsAdvertiserId', 'advertiser_id']]);
	return out;
};

const id = (ctx: NetworkContext, name: string, what: string) => encodeURIComponent(requireStr(ctx, name, what));

const targeting = (ctx: NetworkContext): IDataObject => {
	const countries = csv(requireStr(ctx, 'tiktokAdsCountries', 'Countries')).map((c) => c.toUpperCase());
	const out: IDataObject = { countries };
	const o = (param(ctx, 'tiktokAdsTargeting', {}) ?? {}) as IDataObject;
	if (typeof o.ageMin === 'number') out.age_min = o.ageMin;
	if (typeof o.ageMax === 'number') out.age_max = o.ageMax;
	if (typeof o.gender === 'string' && o.gender) out.gender = o.gender;
	for (const [name, field] of [
		['interestCategoryIds', 'interest_category_ids'],
		['languages', 'languages'],
		['audienceIds', 'audience_ids'],
		['excludedAudienceIds', 'excluded_audience_ids'],
	]) {
		if (typeof o[name] === 'string' && (o[name] as string).trim()) out[field] = csv(o[name] as string);
	}
	return out;
};

const schedule = (ctx: NetworkContext): IDataObject | undefined => {
	const s = (param(ctx, 'tiktokAdsSchedule', {}) ?? {}) as IDataObject;
	const out: IDataObject = {};
	if (typeof s.startDate === 'string' && s.startDate.trim()) out.start_date = s.startDate.trim();
	if (typeof s.endDate === 'string' && s.endDate.trim()) out.end_date = s.endDate.trim();
	return Object.keys(out).length ? out : undefined;
};

const frequency = (ctx: NetworkContext, body: IDataObject) => {
	if (body.goal !== 'reach') return;
	const f = (param(ctx, 'tiktokAdsFrequency', {}) ?? {}) as IDataObject;
	if (typeof f.frequency === 'number') body.frequency = f.frequency;
	if (typeof f.frequencySchedule === 'number') body.frequency_schedule = f.frequencySchedule;
};

const creative = (ctx: NetworkContext, body: IDataObject) => {
	body.identity_id = requireStr(ctx, 'tiktokAdsIdentityId', 'Identity ID');
	body.post_id = requireStr(ctx, 'tiktokAdsPostId', 'Post ID');
	const landing = str(ctx, 'tiktokAdsLandingPage');
	const cta = str(ctx, 'tiktokAdsCallToAction');
	if (body.goal === 'traffic' && !landing) fail(ctx, 'The Traffic goal needs a Landing Page URL');
	if (cta && !landing) fail(ctx, 'A Call to Action needs a Landing Page URL (TikTok shows no button without one)');
	if (cta === 'VIEW_PROFILE' && body.goal !== 'followers') fail(ctx, 'View Profile only works with the Followers goal');
	if (landing) body.landing_page_url = landing;
	if (cta) body.call_to_action = cta;
};

const createCommon = (ctx: NetworkContext, body: IDataObject) => {
	body.status = str(ctx, 'tiktokAdsStatus') || 'paused';
	putFilled(ctx, body, [['tiktokAdsIdempotencyKey', 'idempotency_key']]);
};

const listQuery = (ctx: NetworkContext, filters: Array<[string, string]> = []): IDataObject => {
	const qs = account(ctx);
	putFilled(ctx, qs, [['tiktokAdsIds', 'ids'], ...filters]);
	for (const [name, field] of [['tiktokAdsPage', 'page'], ['tiktokAdsPageSize', 'page_size']]) {
		const n = Number(param(ctx, name, 0));
		if (Number.isInteger(n) && n >= 1) qs[field] = n;
	}
	return qs;
};

export const buildTiktokAdsRequest = (node: IExecuteFunctions, itemIndex: number, operation: string): NetworkRequest => {
	const ctx: NetworkContext = { node, itemIndex, operation };
	const status = /^(pause|resume|delete)(Campaign|Adgroup|Ad)$/.exec(operation);
	if (status) {
		const [, action, level] = status;
		const path = { Campaign: 'campaigns', Adgroup: 'adgroups', Ad: 'ads' }[level] as string;
		const objectId = id(ctx, `tiktokAds${level}Id`, `${level === 'Adgroup' ? 'Ad Group' : level} ID`);
		const body = account(ctx);
		if (action === 'delete') {
			if (!bool(ctx, 'tiktokAdsConfirmDelete')) fail(ctx, 'Deleting cannot be undone: turn on Confirm Delete to do it');
			body.confirm = true;
		}
		return call('POST', `${P}/${path}/${objectId}/${action}`, body);
	}
	switch (operation) {
		case 'getConnectLink': {
			const body: IDataObject = {};
			putFilled(ctx, body, [['tiktokAdsProfile', 'profile_username'], ['tiktokAdsRedirectUrl', 'redirect_url']]);
			return call('POST', `${P}/connect`, body);
		}
		case 'listAccounts':
			return call('GET', `${P}/accounts`, {});
		case 'getAccount':
			return call('GET', `${P}/account`, account(ctx));
		case 'disconnectAccount': {
			const qs: IDataObject = {};
			putFilled(ctx, qs, [['tiktokAdsUnlinkProfile', 'profile_username']]);
			return call('DELETE', `${P}/accounts/${id(ctx, 'tiktokAdsDisconnectId', 'Ad Account ID')}`, qs);
		}
		case 'listIdentities':
			return call('GET', `${P}/identities`, listQuery(ctx));
		case 'listPosts': {
			const qs = account(ctx);
			qs.identity_id = requireStr(ctx, 'tiktokAdsIdentityId', 'Identity ID');
			qs.item_type = str(ctx, 'tiktokAdsItemType') || 'VIDEO';
			putFilled(ctx, qs, [['tiktokAdsCursor', 'cursor']]);
			return call('GET', `${P}/spark/posts`, qs);
		}
		case 'boostPost': {
			const body: IDataObject = { ...account(ctx), goal: str(ctx, 'tiktokAdsGoal') };
			creative(ctx, body);
			body.budget = { amount: Number(param(ctx, 'tiktokAdsBudget', 0)), type: str(ctx, 'tiktokAdsBudgetType') || 'daily' };
			body.targeting = targeting(ctx);
			const when = schedule(ctx);
			if (when) body.schedule = when;
			frequency(ctx, body);
			putFilled(ctx, body, [['tiktokAdsOptionalName', 'name']]);
			createCommon(ctx, body);
			if (body.status === 'paused') body.pause_all_levels = param(ctx, 'tiktokAdsPauseAllLevels', true) !== false;
			return call('POST', `${P}/boost`, body);
		}
		case 'listCampaigns':
			return call('GET', `${P}/campaigns`, listQuery(ctx));
		case 'createCampaign': {
			const body: IDataObject = { ...account(ctx), name: requireStr(ctx, 'tiktokAdsName', 'Name'), goal: str(ctx, 'tiktokAdsGoal') };
			const amount = Number(param(ctx, 'tiktokAdsCampaignBudget', 0));
			if (amount > 0) body.budget = { amount, type: str(ctx, 'tiktokAdsCampaignBudgetType') || 'daily' };
			createCommon(ctx, body);
			return call('POST', `${P}/campaigns`, body);
		}
		case 'updateCampaign':
		case 'updateAdgroup': {
			const isCampaign = operation === 'updateCampaign';
			const body = account(ctx);
			putFilled(ctx, body, [['tiktokAdsOptionalName', 'name']]);
			const amount = Number(param(ctx, isCampaign ? 'tiktokAdsCampaignBudget' : 'tiktokAdsNewBudget', 0));
			if (amount > 0) body.budget = amount;
			if (!body.name && body.budget === undefined) fail(ctx, 'Nothing to change: set Name or a budget');
			const path = isCampaign
				? `campaigns/${id(ctx, 'tiktokAdsCampaignId', 'Campaign ID')}`
				: `adgroups/${id(ctx, 'tiktokAdsAdgroupId', 'Ad Group ID')}`;
			return call('PATCH', `${P}/${path}`, body);
		}
		case 'listAdgroups':
			return call('GET', `${P}/adgroups`, listQuery(ctx, [['tiktokAdsFilterCampaignIds', 'campaign_id']]));
		case 'createAdgroup': {
			const body: IDataObject = {
				...account(ctx),
				campaign_id: requireStr(ctx, 'tiktokAdsCampaignId', 'Campaign ID'),
				name: requireStr(ctx, 'tiktokAdsName', 'Name'),
				goal: str(ctx, 'tiktokAdsGoal'),
				budget: { amount: Number(param(ctx, 'tiktokAdsBudget', 0)), type: str(ctx, 'tiktokAdsBudgetType') || 'daily' },
				targeting: targeting(ctx),
			};
			const when = schedule(ctx);
			if (when) body.schedule = when;
			frequency(ctx, body);
			createCommon(ctx, body);
			return call('POST', `${P}/adgroups`, body);
		}
		case 'listAds':
			return call(
				'GET',
				`${P}/ads`,
				listQuery(ctx, [['tiktokAdsFilterCampaignIds', 'campaign_id'], ['tiktokAdsFilterAdgroupIds', 'adgroup_id']]),
			);
		case 'createAd': {
			const body: IDataObject = {
				...account(ctx),
				adgroup_id: requireStr(ctx, 'tiktokAdsAdgroupId', 'Ad Group ID'),
				name: requireStr(ctx, 'tiktokAdsName', 'Name'),
				goal: str(ctx, 'tiktokAdsGoal'),
			};
			creative(ctx, body);
			createCommon(ctx, body);
			return call('POST', `${P}/ads`, body);
		}
		case 'updateAd': {
			const body = account(ctx);
			putFilled(ctx, body, [['tiktokAdsOptionalName', 'name'], ['tiktokAdsAdText', 'ad_text']]);
			if (!body.name && !body.ad_text) fail(ctx, 'Nothing to change: set Name or New Ad Text');
			return call('PATCH', `${P}/ads/${id(ctx, 'tiktokAdsAdId', 'Ad ID')}`, body);
		}
		case 'getReport': {
			const qs = account(ctx);
			qs.level = str(ctx, 'tiktokAdsLevel') || 'campaign';
			putFilled(ctx, qs, [
				['tiktokAdsIds', 'ids'],
				['tiktokAdsStartDate', 'start_date'],
				['tiktokAdsEndDate', 'end_date'],
				['tiktokAdsBreakdown', 'breakdown'],
			]);
			if (qs.level === 'advertiser' && qs.ids) fail(ctx, 'IDs cannot be used with the Ad Account level');
			return call('GET', `${P}/insights`, qs);
		}
		case 'listCountries':
			return call('GET', `${P}/locations`, { ...account(ctx), goal: str(ctx, 'tiktokAdsGoal') || 'reach' });
		case 'listInterests':
			return call('GET', `${P}/interests`, { ...account(ctx), language: str(ctx, 'tiktokAdsLanguage') || 'en' });
		case 'listAudiences':
			return call('GET', `${P}/audiences`, listQuery(ctx));
		case 'createCustomerFileAudience': {
			const identifiers = csv(requireStr(ctx, 'tiktokAdsIdentifiers', 'Identifiers'));
			if (identifiers.length > 100000) fail(ctx, 'Identifiers: at most 100,000 per audience');
			const body: IDataObject = {
				...account(ctx),
				name: requireStr(ctx, 'tiktokAdsName', 'Name'),
				identifier_type: str(ctx, 'tiktokAdsIdentifierType') || 'email',
				identifiers,
			};
			const days = Number(param(ctx, 'tiktokAdsRetention', 0));
			if (Number.isInteger(days) && days >= 1 && days <= 365) body.retention_in_days = days;
			return call('POST', `${P}/audiences/customer-file`, body);
		}
		case 'createLookalikeAudience':
			return call('POST', `${P}/audiences/lookalike`, {
				...account(ctx),
				name: requireStr(ctx, 'tiktokAdsName', 'Name'),
				source_audience_id: requireStr(ctx, 'tiktokAdsSourceAudienceId', 'Source Audience ID'),
				countries: csv(requireStr(ctx, 'tiktokAdsCountries', 'Countries')).map((c) => c.toUpperCase()),
				audience_size: str(ctx, 'tiktokAdsAudienceSize') || 'BALANCED',
			});
		case 'deleteAudience': {
			const audience = id(ctx, 'tiktokAdsAudienceId', 'Audience ID');
			if (!bool(ctx, 'tiktokAdsConfirmDelete')) fail(ctx, 'Deleting cannot be undone: turn on Confirm Delete to do it');
			return call('POST', `${P}/audiences/${audience}/delete`, { ...account(ctx), confirm: true });
		}
		case 'uploadVideo':
			return call('POST', `${P}/creatives/videos`, { ...account(ctx), video_url: requireStr(ctx, 'tiktokAdsMediaUrl', 'Media URL') });
		case 'uploadImage':
			return call('POST', `${P}/creatives/images`, { ...account(ctx), image_url: requireStr(ctx, 'tiktokAdsMediaUrl', 'Media URL') });
	}
	return fail(ctx, `Unsupported TikTok Ads operation: ${operation}`);
};
