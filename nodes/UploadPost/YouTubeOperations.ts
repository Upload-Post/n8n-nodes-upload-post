import { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import {
	bool,
	fail,
	jsonObjectParam,
	NetworkContext,
	NetworkRequest,
	param,
	parseJson,
	putFilled,
	requireStr,
	str,
} from './NetworkOperations';

// YouTube management after publishing: videos, quota, playlists, comments,
// channel, search and live broadcasts. Every call spends the account's daily
// YouTube allowance (see Get Quota). Destructive calls carry the API's own
// `confirm`, which is a field the user has to turn on: it is never set by default.

const Y = '/uploadposts/youtube';
const MANUAL_PLATFORM_VALUE = '__manual_platform__';

const call = (
	method: NetworkRequest['method'],
	endpoint: string,
	payload: IDataObject,
	asQuery = method === 'GET' || method === 'DELETE',
): NetworkRequest => {
	const base = { endpoint, method, isUploadOperation: false, waitForCompletion: false };
	return asQuery ? { ...base, qs: payload } : { ...base, body: payload };
};

const pathId = (ctx: NetworkContext, name: string, label: string) => encodeURIComponent(requireStr(ctx, name, label));

const PAGING: Array<[string, string]> = [['youtubeMaxResults', 'max_results'], ['youtubePageCursor', 'page_token']];

// ---------------------------------------------------------------------------
// Upload Video fields
// ---------------------------------------------------------------------------

export const applyYoutubeUploadOptions = (
	node: IExecuteFunctions,
	itemIndex: number,
	operation: string,
	platforms: string[],
	formData: IDataObject,
) => {
	if (operation !== 'uploadVideo') return;
	if (!platforms.includes('youtube') && !platforms.includes(MANUAL_PLATFORM_VALUE)) return;
	const ctx: NetworkContext = { node, itemIndex, operation };
	const localizations = parseJson(ctx, param(ctx, 'youtubeLocalizations', ''), 'YouTube Localizations');
	if (localizations !== undefined) {
		if (typeof localizations !== 'object' || Array.isArray(localizations) || localizations === null) {
			fail(ctx, 'YouTube Localizations must be a JSON object keyed by language, e.g. {"es": {"title": "...", "description": "..."}}');
		}
		formData.youtube_localizations = JSON.stringify(localizations);
	}
	const brandPartner = str(ctx, 'youtubeBrandPartner');
	if (brandPartner) formData.youtube_brand_partner = brandPartner;
};

export const youtubeUploadProperties: INodeProperties[] = [
	{
		displayName: 'YouTube Localizations (JSON)',
		name: 'youtubeLocalizations',
		type: 'json',
		default: '',
		description:
			'Translated title and description per language, shown to viewers in that language, e.g. {"es": {"title": "...", "description": "..."}}. Requires YouTube Default Language (the language of the main title and description).',
		displayOptions: { show: { operation: ['uploadVideo'], platform: ['youtube', MANUAL_PLATFORM_VALUE] } },
	},
	{
		displayName: 'YouTube Brand Partner',
		name: 'youtubeBrandPartner',
		type: 'string',
		default: '',
		placeholder: 'UCxxxxxxxxxxxxxxxxxxxxxx',
		description: 'Brand partner channel ID (UC…, 24 characters) for YouTube\'s creator-initiated brand partner access. Handles (@name) are not accepted.',
		displayOptions: { show: { operation: ['uploadVideo'], platform: ['youtube', MANUAL_PLATFORM_VALUE] } },
	},
];

// ---------------------------------------------------------------------------
// YouTube resource
// ---------------------------------------------------------------------------

const show = (operation: string[]) => ({ show: { resource: ['youtube'], operation } });

const CONFIRM_OPS = ['deleteYoutubePlaylist', 'removeYoutubePlaylistItem', 'deleteYoutubeComment', 'moderateYoutubeComments'];

export const youtubeProperties: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		options: [
			{ name: 'Add Video to Playlist', value: 'addYoutubePlaylistItem', action: 'Add a video to a youtube playlist', description: 'Add a video to a playlist (52 units)' },
			{ name: 'Create Live Broadcast', value: 'createYoutubeBroadcast', action: 'Create a youtube live broadcast', description: 'Schedule a live broadcast, optionally with its stream. The stream key in the answer is a secret.' },
			{ name: 'Create Playlist', value: 'createYoutubePlaylist', action: 'Create a youtube playlist', description: 'Create a playlist on the connected channel (50 units)' },
			{ name: 'Delete Comment', value: 'deleteYoutubeComment', action: 'Delete a youtube comment', description: 'Delete your own comment (needs Confirm, 50 units)' },
			{ name: 'Delete Playlist', value: 'deleteYoutubePlaylist', action: 'Delete a youtube playlist', description: 'Delete a playlist; its videos stay (needs Confirm, 51 units)' },
			{ name: 'Get Channel', value: 'getYoutubeChannel', action: 'Get the youtube channel', description: 'Settings, branding, translations and statistics of the connected channel' },
			{ name: 'Get Quota', value: 'getYoutubeQuota', action: 'Get the youtube daily allowance', description: 'Your account\'s daily allowance for the YouTube management features and what is left' },
			{ name: 'Get Videos', value: 'getYoutubeVideos', action: 'Get youtube videos', description: 'Full details of videos by ID, the most popular chart, or the videos the channel rated' },
			{ name: 'List Comment Replies', value: 'listYoutubeCommentReplies', action: 'List youtube comment replies', description: 'Replies to a top-level comment' },
			{ name: 'List Comments', value: 'listYoutubeComments', action: 'List youtube comment threads', description: 'Comment threads of a video or of the whole channel, with moderation status filter' },
			{ name: 'List Live Broadcasts', value: 'listYoutubeBroadcasts', action: 'List youtube live broadcasts', description: 'Live broadcasts of the channel' },
			{ name: 'List Playlist Videos', value: 'listYoutubePlaylistItems', action: 'List youtube playlist videos', description: 'Videos of a playlist' },
			{ name: 'List Playlists', value: 'listYoutubePlaylists', action: 'List youtube playlists', description: 'Playlists of the connected channel, another channel, or by ID' },
			{ name: 'Moderate Comments', value: 'moderateYoutubeComments', action: 'Moderate youtube comments', description: 'Approve, hold or reject up to 50 comments of your channel in one call (reject needs Confirm, 50 units)' },
			{ name: 'Remove Video From Playlist', value: 'removeYoutubePlaylistItem', action: 'Remove a video from a youtube playlist', description: 'Remove a playlist item (needs Confirm, 52 units)' },
			{ name: 'Reply to Comment', value: 'createYoutubeComment', action: 'Reply to a youtube comment', description: 'Reply to a comment, or post a new comment on a video (50 units)' },
			{ name: 'Search', value: 'searchYoutube', action: 'Search youtube', description: 'Search videos, channels and playlists. Searches have their own small daily limit (5 on paid plans, 1 on free).' },
			{ name: 'Update Channel', value: 'updateYoutubeChannel', action: 'Update the youtube channel', description: 'Change the channel description, keywords and other settings (only what you send changes)' },
			{ name: 'Update Playlist', value: 'updateYoutubePlaylist', action: 'Update a youtube playlist', description: 'Edit a playlist; only what you send changes (51 units)' },
		],
		default: 'getYoutubeVideos',
		displayOptions: { show: { resource: ['youtube'] } },
	},
	{
		displayName: 'Profile Name or ID',
		name: 'youtubeProfile',
		type: 'options',
		noDataExpression: true,
		required: true,
		default: '',
		description: 'Choose from your created profiles. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		typeOptions: { loadOptionsMethod: 'getUserProfiles' },
		displayOptions: { show: { resource: ['youtube'] }, hide: { operation: ['getYoutubeQuota'] } },
	},

	// ---- Videos ----
	{
		displayName: 'Video IDs',
		name: 'youtubeVideoIds',
		type: 'string',
		default: '',
		description: 'Up to 50 video IDs, comma-separated. Or use Chart / My Rating.',
		displayOptions: show(['getYoutubeVideos']),
	},
	{
		displayName: 'Chart',
		name: 'youtubeChart',
		type: 'options',
		options: [
			{ name: 'None', value: '' },
			{ name: 'Most Popular', value: 'mostPopular' },
		],
		default: '',
		displayOptions: show(['getYoutubeVideos']),
	},
	{
		displayName: 'My Rating',
		name: 'youtubeMyRating',
		type: 'options',
		options: [
			{ name: 'Disliked', value: 'dislike' },
			{ name: 'Liked', value: 'like' },
			{ name: 'None', value: '' },
		],
		default: '',
		description: 'Videos the channel rated',
		displayOptions: show(['getYoutubeVideos']),
	},
	{
		displayName: 'Parts',
		name: 'youtubeParts',
		type: 'string',
		default: '',
		placeholder: 'snippet,status,statistics',
		description: 'Comma-separated parts to return. Empty = API default.',
		displayOptions: show(['getYoutubeVideos', 'listYoutubePlaylists']),
	},

	// ---- Playlists ----
	{
		displayName: 'Playlist IDs',
		name: 'youtubePlaylistIds',
		type: 'string',
		default: '',
		description: 'Up to 50 playlist IDs, comma-separated. Empty = the playlists of the connected channel (or of Channel ID).',
		displayOptions: show(['listYoutubePlaylists']),
	},
	{
		displayName: 'Channel ID',
		name: 'youtubeChannelId',
		type: 'string',
		default: '',
		description: 'Public playlists of another channel (UC…), or search results of that channel',
		displayOptions: show(['listYoutubePlaylists', 'searchYoutube']),
	},
	{
		displayName: 'Playlist ID',
		name: 'youtubePlaylistId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: show(['updateYoutubePlaylist', 'deleteYoutubePlaylist', 'listYoutubePlaylistItems', 'addYoutubePlaylistItem', 'removeYoutubePlaylistItem']),
	},
	{
		displayName: 'Title',
		name: 'youtubeTitle',
		type: 'string',
		default: '',
		description: 'Playlist title (up to 150 characters) or broadcast title (1-100). Required to create.',
		displayOptions: show(['createYoutubePlaylist', 'updateYoutubePlaylist', 'createYoutubeBroadcast']),
	},
	{
		displayName: 'Description',
		name: 'youtubeDescription',
		type: 'string',
		default: '',
		typeOptions: { rows: 3 },
		description: 'Empty = no change on updates. Channel: up to 1,000 characters, without angle brackets.',
		displayOptions: show(['createYoutubePlaylist', 'updateYoutubePlaylist', 'createYoutubeBroadcast', 'updateYoutubeChannel']),
	},
	{
		displayName: 'Privacy Status',
		name: 'youtubePrivacyStatus',
		type: 'options',
		options: [
			{ name: 'Keep / YouTube Default', value: '' },
			{ name: 'Private', value: 'private' },
			{ name: 'Public', value: 'public' },
			{ name: 'Unlisted', value: 'unlisted' },
		],
		default: '',
		description: 'Required to create a live broadcast',
		displayOptions: show(['createYoutubePlaylist', 'updateYoutubePlaylist', 'createYoutubeBroadcast']),
	},
	{
		displayName: 'Video ID',
		name: 'youtubeVideoId',
		type: 'string',
		default: '',
		description: 'Add to playlist: the video to add (required). List comments / reply: the video whose threads to read, or to comment on.',
		displayOptions: show(['addYoutubePlaylistItem', 'listYoutubeComments', 'createYoutubeComment', 'listYoutubePlaylistItems']),
	},
	{
		displayName: 'Position',
		name: 'youtubePosition',
		type: 'number',
		typeOptions: { minValue: -1 },
		default: -1,
		description: 'Zero-based place in the playlist (only for playlists sorted manually). -1 = at the end.',
		displayOptions: show(['addYoutubePlaylistItem']),
	},
	{
		displayName: 'Note',
		name: 'youtubeNote',
		type: 'string',
		default: '',
		description: 'Note shown for this video in the playlist (up to 280 characters)',
		displayOptions: show(['addYoutubePlaylistItem']),
	},
	{
		displayName: 'Playlist Item ID',
		name: 'youtubeItemId',
		type: 'string',
		required: true,
		default: '',
		description: 'The item ID from List Playlist Videos (not the video ID)',
		displayOptions: show(['removeYoutubePlaylistItem']),
	},

	// ---- Comments ----
	{
		displayName: 'Whole Channel',
		name: 'youtubeChannelScope',
		type: 'boolean',
		default: false,
		description: 'Whether to read the comment inbox of the whole channel instead of one video',
		displayOptions: show(['listYoutubeComments']),
	},
	{
		displayName: 'Moderation Status',
		name: 'youtubeModerationStatus',
		type: 'options',
		options: [
			{ name: 'Held for Review', value: 'heldForReview' },
			{ name: 'Likely Spam', value: 'likelySpam' },
			{ name: 'Published', value: 'published' },
		],
		default: 'published',
		description: 'Only for your own channel\'s videos',
		displayOptions: show(['listYoutubeComments']),
	},
	{
		displayName: 'Search Text',
		name: 'youtubeSearchText',
		type: 'string',
		default: '',
		description: 'Only threads whose comments contain this text (up to 200 characters)',
		displayOptions: show(['listYoutubeComments']),
	},
	{
		displayName: 'Parent Comment ID',
		name: 'youtubeParentId',
		type: 'string',
		default: '',
		description: 'Top-level comment to read the replies of, or to reply to',
		displayOptions: show(['listYoutubeCommentReplies', 'createYoutubeComment']),
	},
	{
		displayName: 'Text',
		name: 'youtubeText',
		type: 'string',
		required: true,
		default: '',
		typeOptions: { rows: 3 },
		displayOptions: show(['createYoutubeComment']),
	},
	{
		displayName: 'Comment ID',
		name: 'youtubeCommentId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: show(['deleteYoutubeComment']),
	},
	{
		displayName: 'Comment IDs',
		name: 'youtubeCommentIds',
		type: 'string',
		required: true,
		default: '',
		description: 'Up to 50 comment IDs of your channel, comma-separated',
		displayOptions: show(['moderateYoutubeComments']),
	},
	{
		displayName: 'New Status',
		name: 'youtubeModerationAction',
		type: 'options',
		options: [
			{ name: 'Approve (Published)', value: 'published' },
			{ name: 'Hold for Review', value: 'heldForReview' },
			{ name: 'Reject', value: 'rejected' },
		],
		default: 'published',
		description: 'Reject removes the comments from public view and needs Confirm',
		displayOptions: show(['moderateYoutubeComments']),
	},
	{
		displayName: 'Ban Author',
		name: 'youtubeBanAuthor',
		type: 'boolean',
		default: false,
		description: 'Whether to also reject every future comment of those authors on your channel (with Reject)',
		displayOptions: { show: { resource: ['youtube'], operation: ['moderateYoutubeComments'], youtubeModerationAction: ['rejected'] } },
	},

	// ---- Channel ----
	{
		displayName: 'Keywords',
		name: 'youtubeKeywords',
		type: 'string',
		default: '',
		description: 'Channel keywords, space-separated (multi-word keywords in double quotes), up to 500 characters. Empty = no change.',
		displayOptions: show(['updateYoutubeChannel']),
	},

	// ---- Search ----
	{
		displayName: 'Query',
		name: 'youtubeQuery',
		type: 'string',
		default: '',
		description: 'Search text (up to 500 characters; - for NOT, | for OR)',
		displayOptions: show(['searchYoutube']),
	},
	{
		displayName: 'Only My Videos',
		name: 'youtubeForMine',
		type: 'boolean',
		default: false,
		description: 'Whether to search only the videos of the connected channel',
		displayOptions: show(['searchYoutube']),
	},
	{
		displayName: 'Type',
		name: 'youtubeSearchType',
		type: 'options',
		options: [
			{ name: 'All', value: '' },
			{ name: 'Channel', value: 'channel' },
			{ name: 'Playlist', value: 'playlist' },
			{ name: 'Video', value: 'video' },
		],
		default: '',
		displayOptions: show(['searchYoutube']),
	},
	{
		displayName: 'Order',
		name: 'youtubeOrder',
		type: 'options',
		options: [
			{ name: 'Date', value: 'date' },
			{ name: 'Rating', value: 'rating' },
			{ name: 'Relevance', value: 'relevance' },
			{ name: 'Title', value: 'title' },
			{ name: 'View Count', value: 'viewCount' },
		],
		default: 'relevance',
		displayOptions: show(['searchYoutube']),
	},

	// ---- Live ----
	{
		displayName: 'Broadcast Status',
		name: 'youtubeBroadcastStatus',
		type: 'options',
		options: [
			{ name: 'Active', value: 'active' },
			{ name: 'All', value: 'all' },
			{ name: 'Completed', value: 'completed' },
			{ name: 'Upcoming', value: 'upcoming' },
		],
		default: 'all',
		displayOptions: show(['listYoutubeBroadcasts']),
	},
	{
		displayName: 'Scheduled Start Time',
		name: 'youtubeScheduledStartTime',
		type: 'string',
		required: true,
		default: '',
		placeholder: '2026-12-01T18:00:00Z',
		description: 'ISO 8601 with time zone, in the future',
		displayOptions: show(['createYoutubeBroadcast']),
	},
	{
		displayName: 'Create Stream',
		name: 'youtubeCreateStream',
		type: 'boolean',
		default: false,
		description: 'Whether to also create a stream and bind it (the answer carries the ingestion address and the stream key, which is a secret)',
		displayOptions: show(['createYoutubeBroadcast']),
	},

	// ---- Paging, confirm, extra ----
	{
		displayName: 'Max Results',
		name: 'youtubeMaxResults',
		type: 'number',
		typeOptions: { minValue: 0, maxValue: 100 },
		default: 0,
		description: 'Items per page (YouTube maximum 50; 100 for comments). 0 = YouTube default.',
		displayOptions: show(['getYoutubeVideos', 'listYoutubePlaylists', 'listYoutubeComments', 'listYoutubeCommentReplies', 'searchYoutube', 'listYoutubeBroadcasts']),
	},
	{
		displayName: 'Page Cursor',
		name: 'youtubePageCursor',
		type: 'string',
		default: '',
		description: 'The next_page_token of the previous page',
		displayOptions: show(['getYoutubeVideos', 'listYoutubePlaylists', 'listYoutubeComments', 'listYoutubeCommentReplies', 'searchYoutube', 'listYoutubeBroadcasts']),
	},
	{
		displayName: 'Confirm',
		name: 'youtubeConfirm',
		type: 'boolean',
		default: false,
		description: 'Whether you confirm this destructive change. Required to delete a playlist, remove a playlist video, delete a comment and reject comments; without it the API answers confirmation_required and nothing is sent to YouTube.',
		displayOptions: show(CONFIRM_OPS),
	},
	{
		displayName: 'Extra Fields (JSON)',
		name: 'youtubeExtraFields',
		type: 'json',
		default: '',
		description: 'Other documented fields merged into the request body as is, e.g. {"default_language": "en", "localizations": {...}} for playlists and the channel, {"country": "ES"} for the channel, or {"latency_preference": "low", "enable_dvr": false} for a broadcast',
		displayOptions: show(['createYoutubePlaylist', 'updateYoutubePlaylist', 'updateYoutubeChannel', 'createYoutubeBroadcast']),
	},
];

export const buildYoutubeRequest = (node: IExecuteFunctions, itemIndex: number, operation: string): NetworkRequest => {
	const ctx: NetworkContext = { node, itemIndex, operation };
	if (operation === 'getYoutubeQuota') return call('GET', `${Y}/quota`, {});
	const user = requireStr(ctx, 'youtubeProfile', 'Profile');
	const extra = () => jsonObjectParam(ctx, 'youtubeExtraFields', 'Extra Fields (JSON)');
	const withConfirm = (payload: IDataObject) => {
		if (bool(ctx, 'youtubeConfirm')) payload.confirm = 'true';
		return payload;
	};

	switch (operation) {
		case 'getYoutubeVideos': {
			const qs: IDataObject = { user };
			putFilled(ctx, qs, [['youtubeVideoIds', 'ids'], ['youtubeChart', 'chart'], ['youtubeMyRating', 'my_rating'], ['youtubeParts', 'parts'], ...PAGING]);
			if (!qs.ids && !qs.chart && !qs.my_rating) fail(ctx, 'Set Video IDs, Chart or My Rating');
			return call('GET', `${Y}/videos`, qs);
		}
		case 'listYoutubePlaylists': {
			const qs: IDataObject = { user };
			putFilled(ctx, qs, [['youtubePlaylistIds', 'ids'], ['youtubeChannelId', 'channel_id'], ['youtubeParts', 'parts'], ...PAGING]);
			return call('GET', `${Y}/playlists`, qs);
		}
		case 'createYoutubePlaylist': {
			const body: IDataObject = { user, title: requireStr(ctx, 'youtubeTitle', 'Title') };
			putFilled(ctx, body, [['youtubeDescription', 'description'], ['youtubePrivacyStatus', 'privacy_status']]);
			return call('POST', `${Y}/playlists`, { ...body, ...extra() });
		}
		case 'updateYoutubePlaylist': {
			const body: IDataObject = { user };
			putFilled(ctx, body, [['youtubeTitle', 'title'], ['youtubeDescription', 'description'], ['youtubePrivacyStatus', 'privacy_status']]);
			Object.assign(body, extra());
			if (Object.keys(body).length === 1) fail(ctx, 'Nothing to update: set Title, Description, Privacy Status or Extra Fields');
			return call('PATCH', `${Y}/playlists/${pathId(ctx, 'youtubePlaylistId', 'Playlist ID')}`, body);
		}
		case 'deleteYoutubePlaylist':
			return call('DELETE', `${Y}/playlists/${pathId(ctx, 'youtubePlaylistId', 'Playlist ID')}`, withConfirm({ user }));
		case 'listYoutubePlaylistItems': {
			const qs: IDataObject = { user };
			putFilled(ctx, qs, [['youtubeVideoId', 'video_id']]);
			return call('GET', `${Y}/playlists/${pathId(ctx, 'youtubePlaylistId', 'Playlist ID')}/items`, qs);
		}
		case 'addYoutubePlaylistItem': {
			const body: IDataObject = { user, video_id: requireStr(ctx, 'youtubeVideoId', 'Video ID') };
			const position = Number(param(ctx, 'youtubePosition', -1));
			if (Number.isInteger(position) && position >= 0) body.position = position;
			putFilled(ctx, body, [['youtubeNote', 'note']]);
			return call('POST', `${Y}/playlists/${pathId(ctx, 'youtubePlaylistId', 'Playlist ID')}/items`, body);
		}
		case 'removeYoutubePlaylistItem':
			return call(
				'DELETE',
				`${Y}/playlists/${pathId(ctx, 'youtubePlaylistId', 'Playlist ID')}/items/${pathId(ctx, 'youtubeItemId', 'Playlist Item ID')}`,
				withConfirm({ user }),
			);
		case 'listYoutubeComments': {
			const qs: IDataObject = { user };
			if (bool(ctx, 'youtubeChannelScope')) qs.scope = 'channel';
			else putFilled(ctx, qs, [['youtubeVideoId', 'video_id']]);
			if (!qs.scope && !qs.video_id) fail(ctx, 'Set Video ID or turn on Whole Channel');
			const moderation = str(ctx, 'youtubeModerationStatus');
			if (moderation && moderation !== 'published') qs.moderation_status = moderation;
			putFilled(ctx, qs, [['youtubeSearchText', 'search'], ...PAGING]);
			return call('GET', `${Y}/comments`, qs);
		}
		case 'listYoutubeCommentReplies': {
			const qs: IDataObject = { user, parent_id: requireStr(ctx, 'youtubeParentId', 'Parent Comment ID') };
			putFilled(ctx, qs, PAGING);
			return call('GET', `${Y}/comments/replies`, qs);
		}
		case 'createYoutubeComment': {
			const body: IDataObject = { user, text: requireStr(ctx, 'youtubeText', 'Text') };
			putFilled(ctx, body, [['youtubeParentId', 'parent_id']]);
			if (!body.parent_id) putFilled(ctx, body, [['youtubeVideoId', 'video_id']]);
			if (!body.parent_id && !body.video_id) fail(ctx, 'Set Parent Comment ID (reply) or Video ID (new comment)');
			return call('POST', `${Y}/comments`, body);
		}
		case 'deleteYoutubeComment':
			return call('DELETE', `${Y}/comments/${pathId(ctx, 'youtubeCommentId', 'Comment ID')}`, withConfirm({ user }));
		case 'moderateYoutubeComments': {
			const ids = requireStr(ctx, 'youtubeCommentIds', 'Comment IDs').split(',').map(id => id.trim()).filter(Boolean);
			const status = str(ctx, 'youtubeModerationAction') || 'published';
			const body: IDataObject = { user, comment_ids: ids, status };
			if (status === 'rejected' && bool(ctx, 'youtubeBanAuthor')) body.ban_author = true;
			if (bool(ctx, 'youtubeConfirm')) body.confirm = true;
			return call('POST', `${Y}/comments/moderate`, body);
		}
		case 'getYoutubeChannel':
			return call('GET', `${Y}/channel`, { user });
		case 'updateYoutubeChannel': {
			const body: IDataObject = { user };
			putFilled(ctx, body, [['youtubeDescription', 'description'], ['youtubeKeywords', 'keywords']]);
			Object.assign(body, extra());
			if (Object.keys(body).length === 1) fail(ctx, 'Nothing to update: set Description, Keywords or Extra Fields');
			return call('PATCH', `${Y}/channel`, body);
		}
		case 'searchYoutube': {
			const qs: IDataObject = { user };
			putFilled(ctx, qs, [['youtubeQuery', 'q'], ['youtubeChannelId', 'channel_id'], ['youtubeSearchType', 'type'], ...PAGING]);
			if (bool(ctx, 'youtubeForMine')) {
				qs.for_mine = 'true';
				qs.type = 'video';
				delete qs.channel_id;
			}
			const order = str(ctx, 'youtubeOrder');
			if (order && order !== 'relevance') qs.order = order;
			if (!qs.q && !qs.for_mine && !qs.channel_id) fail(ctx, 'Set Query, Only My Videos or Channel ID');
			return call('GET', `${Y}/search`, qs);
		}
		case 'listYoutubeBroadcasts': {
			const qs: IDataObject = { user };
			putFilled(ctx, qs, [['youtubeBroadcastStatus', 'status'], ...PAGING]);
			return call('GET', `${Y}/live/broadcasts`, qs);
		}
		case 'createYoutubeBroadcast': {
			const privacy = str(ctx, 'youtubePrivacyStatus');
			if (!privacy) fail(ctx, 'Privacy Status is required to create a live broadcast');
			const body: IDataObject = {
				user,
				title: requireStr(ctx, 'youtubeTitle', 'Title'),
				scheduled_start_time: requireStr(ctx, 'youtubeScheduledStartTime', 'Scheduled Start Time'),
				privacy_status: privacy,
			};
			putFilled(ctx, body, [['youtubeDescription', 'description']]);
			if (bool(ctx, 'youtubeCreateStream')) body.create_stream = true;
			return call('POST', `${Y}/live/broadcasts`, { ...body, ...extra() });
		}
	}
	return fail(ctx, `Unsupported YouTube operation: ${operation}`);
};
