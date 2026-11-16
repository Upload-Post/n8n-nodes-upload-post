import { IDataObject, IExecuteFunctions, INodeProperties, NodeOperationError } from 'n8n-workflow';

// Best time to post, the queue, and the Telegram / Bluesky / Google Business
// operations, plus the network options of the upload operations. Every field is
// optional and nothing is sent unless it is filled, so existing workflows send
// exactly the same requests as before.

export type NetworkContext = {
	node: IExecuteFunctions;
	itemIndex: number;
	operation: string;
};

export type NetworkRequest = {
	endpoint: string;
	method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
	body?: IDataObject;
	qs?: IDataObject;
	isUploadOperation: boolean;
	waitForCompletion: boolean;
};

export const NETWORK_RESOURCES = ['queue', 'telegram', 'bluesky', 'googleBusiness'];

const MANUAL_PLATFORM_VALUE = '__manual_platform__';

// ---------------------------------------------------------------------------
// Parameter helpers
// ---------------------------------------------------------------------------

export const param = (ctx: NetworkContext, name: string, fallback: unknown): unknown =>
	ctx.node.getNodeParameter(name, ctx.itemIndex, fallback);

export const str = (ctx: NetworkContext, name: string): string => String(param(ctx, name, '') ?? '').trim();
export const bool = (ctx: NetworkContext, name: string): boolean => param(ctx, name, false) === true;

export const fail = (ctx: NetworkContext, message: string): never => {
	throw new NodeOperationError(ctx.node.getNode(), message, { itemIndex: ctx.itemIndex });
};

export const parseJson = (ctx: NetworkContext, raw: unknown, label: string): unknown => {
	if (raw === undefined || raw === null || raw === '') return undefined;
	if (typeof raw !== 'string') return raw;
	const trimmed = raw.trim();
	if (!trimmed) return undefined;
	try {
		return JSON.parse(trimmed);
	} catch {
		return fail(ctx, `${label} is not valid JSON`);
	}
};

export const jsonObjectParam = (ctx: NetworkContext, name: string, label: string): IDataObject => {
	const parsed = parseJson(ctx, param(ctx, name, ''), label);
	if (parsed === undefined) return {};
	if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) {
		return fail(ctx, `${label} must be a JSON object`);
	}
	return parsed as IDataObject;
};

// [n8n parameter, API field]: strings and numbers are sent when filled.
export const putFilled = (ctx: NetworkContext, target: IDataObject, pairs: Array<[string, string]>) => {
	for (const [name, field] of pairs) {
		const value = param(ctx, name, '');
		if (value === undefined || value === null || value === '' || value === 0) continue;
		if (typeof value === 'string') {
			if (value.trim()) target[field] = value.trim();
		} else {
			target[field] = value as IDataObject[keyof IDataObject];
		}
	}
};

export const requireStr = (ctx: NetworkContext, name: string, label: string): string => {
	const value = str(ctx, name);
	if (!value) fail(ctx, `${label} is required`);
	return value;
};

const request = (
	method: NetworkRequest['method'],
	endpoint: string,
	payload: IDataObject,
): NetworkRequest => {
	const base = { endpoint, method, isUploadOperation: false, waitForCompletion: false };
	return method === 'GET' ? { ...base, qs: payload } : { ...base, body: payload };
};

// ---------------------------------------------------------------------------
// Upload options (Telegram, Bluesky, Google Business, paid partnership)
// ---------------------------------------------------------------------------

type OptionKind = 'string' | 'number' | 'boolean' | 'json';

const TELEGRAM_UPLOAD_OPTIONS: Array<[string, string, OptionKind]> = [
	['audioTitle', 'telegram_title_audio', 'string'],
	['captionOverflow', 'telegram_caption_overflow', 'string'],
	['contact', 'telegram_contact', 'json'],
	['cover', 'telegram_cover', 'string'],
	['dice', 'telegram_dice', 'string'],
	['directMessagesTopicId', 'telegram_direct_messages_topic_id', 'number'],
	['duration', 'telegram_duration', 'number'],
	['emoji', 'telegram_emoji', 'string'],
	['firstComment', 'telegram_first_comment', 'string'],
	['firstCommentAsReply', 'telegram_first_comment_as_reply', 'boolean'],
	['length', 'telegram_length', 'number'],
	['linkPreviewOptions', 'telegram_link_preview_options', 'json'],
	['livePhotoPhoto', 'telegram_live_photo_photo', 'string'],
	['location', 'telegram_location', 'json'],
	['mediaUrls', 'telegram_media_urls', 'string'],
	['messageEffectId', 'telegram_message_effect_id', 'string'],
	['paidPayload', 'telegram_paid_payload', 'string'],
	['paidStarCount', 'telegram_paid_star_count', 'number'],
	['performer', 'telegram_performer', 'string'],
	['pin', 'telegram_pin', 'boolean'],
	['pinNotify', 'telegram_pin_notify', 'boolean'],
	['poll', 'telegram_poll', 'json'],
	['replyMarkup', 'telegram_reply_markup', 'json'],
	['replyQuote', 'telegram_reply_quote', 'string'],
	['replyToMessageId', 'telegram_reply_to_message_id', 'number'],
	['richMessage', 'telegram_rich_message', 'string'],
	['sendAs', 'telegram_send_as', 'string'],
	['sendByUrl', 'telegram_send_by_url', 'boolean'],
	['sendTitle', 'telegram_send_title', 'boolean'],
	['showCaptionAboveMedia', 'telegram_show_caption_above_media', 'boolean'],
	['startTimestamp', 'telegram_start_timestamp', 'number'],
	['telegramTitle', 'telegram_title', 'string'],
	['thumbnail', 'telegram_thumbnail', 'string'],
	['venue', 'telegram_venue', 'json'],
];

const BLUESKY_UPLOAD_OPTIONS: Array<[string, string, OptionKind]> = [
	['captions', 'bluesky_captions', 'json'],
	['createdAt', 'bluesky_created_at', 'string'],
	['gifAsVideo', 'bluesky_gif_as_video', 'boolean'],
	['tags', 'bluesky_tags', 'string'],
	['threadOverflow', 'bluesky_thread_overflow', 'boolean'],
	['videoPresentation', 'bluesky_video_presentation', 'string'],
];

const GBP_UPLOAD_OPTIONS: Array<[string, string, OptionKind]> = [
	['alertType', 'gbp_alert_type', 'string'],
	['multiMedia', 'gbp_multi_media', 'boolean'],
	['recurrence', 'gbp_recurrence', 'string'],
	['recurrenceDayOfMonth', 'gbp_recurrence_day_of_month', 'number'],
	['recurrenceDays', 'gbp_recurrence_days', 'string'],
	['recurrenceEnd', 'gbp_recurrence_end', 'string'],
	['recurrenceWeekOccurrence', 'gbp_recurrence_week_occurrence', 'string'],
	['scheduledTime', 'gbp_scheduled_time', 'string'],
	['uploadToGallery', 'gbp_upload_to_gallery', 'boolean'],
];

const applyCollection = (
	ctx: NetworkContext,
	collectionName: string,
	label: string,
	table: Array<[string, string, OptionKind]>,
	formData: IDataObject,
) => {
	const values = (param(ctx, collectionName, {}) ?? {}) as IDataObject;
	for (const [key, field, kind] of table) {
		if (!Object.prototype.hasOwnProperty.call(values, key)) continue;
		const value = values[key];
		if (kind === 'boolean') {
			// The option was added on purpose: send it as chosen (false included).
			formData[field] = value === true ? 'true' : 'false';
		} else if (kind === 'number') {
			if (value === '' || value === null || value === undefined) continue;
			formData[field] = String(value);
		} else if (kind === 'json') {
			const parsed = parseJson(ctx, value, `${label}: ${key}`);
			if (parsed === undefined) continue;
			formData[field] = JSON.stringify(parsed);
		} else {
			const text = String(value ?? '').trim();
			if (text) formData[field] = text;
		}
	}
};

export const applyNetworkUploadOptions = (
	node: IExecuteFunctions,
	itemIndex: number,
	operation: string,
	platforms: string[],
	formData: IDataObject,
) => {
	const ctx: NetworkContext = { node, itemIndex, operation };
	const manual = platforms.includes(MANUAL_PLATFORM_VALUE);
	const has = (platform: string) => platforms.includes(platform) || manual;

	if (has('telegram')) {
		applyCollection(ctx, 'telegramOptions', 'Telegram Options', TELEGRAM_UPLOAD_OPTIONS, formData);
	}
	if (operation === 'uploadDocument') return;

	if (bool(ctx, 'paidPartnership')) formData.paid_partnership = 'true';
	if (has('facebook')) {
		const sponsor = str(ctx, 'facebookSponsorId');
		if (sponsor) formData.facebook_sponsor_id = sponsor;
	}
	if (has('pinterest') && operation !== 'uploadText') {
		const sponsor = str(ctx, 'pinterestSponsorId');
		if (sponsor) formData.pinterest_sponsor_id = sponsor;
	}
	if (has('bluesky')) {
		applyCollection(ctx, 'blueskyOptions', 'Bluesky Options', BLUESKY_UPLOAD_OPTIONS, formData);
	}
	if (has('google_business')) {
		applyCollection(ctx, 'gbpOptions', 'Google Business Options', GBP_UPLOAD_OPTIONS, formData);
	}
};

const MEDIA_AND_TEXT = ['uploadPhotos', 'uploadVideo', 'uploadText'];

export const uploadExtraProperties: INodeProperties[] = [
	{
		displayName: 'Paid Partnership',
		name: 'paidPartnership',
		type: 'boolean',
		default: false,
		description:
			'Whether the post is sponsored or made in partnership with a brand. Upload-Post sets each network\'s native label: TikTok branded content, YouTube paid promotion and X paid partnership (Facebook and Pinterest also need their sponsor ID). Networks without a label publish without it and the response carries a warning. A network-specific field always wins. TikTok refuses it with the Only Me privacy level (commercial_disclosure_privacy_conflict) and drafts do not carry it.',
		displayOptions: { show: { resource: ['uploads'], operation: MEDIA_AND_TEXT } },
	},
	{
		displayName: 'Facebook Sponsor ID',
		name: 'facebookSponsorId',
		type: 'string',
		default: '',
		description:
			'Numeric ID of the sponsor\'s Facebook Page for the branded content tag. Page photos, Page videos and text/link posts only (Reels and Stories have no sponsor field). Your Page needs access to Meta\'s branded content tool.',
		displayOptions: { show: { operation: MEDIA_AND_TEXT, platform: ['facebook', MANUAL_PLATFORM_VALUE] } },
	},
	{
		displayName: 'Pinterest Sponsor ID',
		name: 'pinterestSponsorId',
		type: 'string',
		default: '',
		description:
			'Numeric ID of the sponsor\'s Pinterest account for the paid partnership label. Pinterest only opens it to accounts in its closed beta; outside it the Pin is rejected.',
		displayOptions: { show: { operation: ['uploadPhotos', 'uploadVideo'], platform: ['pinterest', MANUAL_PLATFORM_VALUE] } },
	},
	{
		displayName: 'Telegram Options',
		name: 'telegramOptions',
		type: 'collection',
		placeholder: 'Add Telegram Option',
		default: {},
		description: 'Telegram Bot API options (see docs.upload-post.com/api/telegram). JSON options take the official Bot API object as is.',
		displayOptions: {
			show: {
				operation: ['uploadPhotos', 'uploadVideo', 'uploadText', 'uploadDocument'],
				platform: ['telegram', MANUAL_PLATFORM_VALUE],
			},
		},
		options: [
			{ displayName: 'Audio Title', name: 'audioTitle', type: 'string', default: '', description: 'Upload Document with Send As = audio: track title' },
			{
				displayName: 'Caption Overflow',
				name: 'captionOverflow',
				type: 'options',
				options: [
					{ name: 'Split (Rest of the Caption as a Reply)', value: 'split' },
					{ name: 'Truncate (Refuse Captions Over 1024 Characters)', value: 'truncate' },
				],
				default: 'split',
				description: 'Media captions over 1,024 characters',
			},
			{ displayName: 'Contact (JSON)', name: 'contact', type: 'json', default: '', description: 'Upload Text: send a contact, e.g. {"phone_number": "+34600000000", "first_name": "Ana"}' },
			{ displayName: 'Cover', name: 'cover', type: 'string', default: '', description: 'Upload Video: cover image (public URL or Telegram file_id)' },
			{ displayName: 'Dice', name: 'dice', type: 'string', default: '', description: 'Upload Text: send an animated dice. One of 🎲 🎯 🏀 ⚽ 🎳 🎰, or true for 🎲.' },
			{ displayName: 'Direct Messages Topic ID', name: 'directMessagesTopicId', type: 'number', default: 0, description: 'Topic of a channel direct messages chat (required by Telegram when the connected chat is one)' },
			{ displayName: 'Duration', name: 'duration', type: 'number', default: 0, description: 'Upload Document (audio, voice, animation, video note): duration in seconds' },
			{ displayName: 'Emoji', name: 'emoji', type: 'string', default: '', description: 'Upload Document with Send As = sticker: emoji of the sticker' },
			{ displayName: 'First Comment', name: 'firstComment', type: 'string', default: '', description: 'Telegram-only first comment (falls back to First Comment)' },
			{ displayName: 'First Comment As Reply', name: 'firstCommentAsReply', type: 'boolean', default: true, description: 'Whether the first comment is sent as a reply to the post (default) instead of a separate message' },
			{ displayName: 'Length', name: 'length', type: 'number', default: 0, description: 'Video note diameter in pixels' },
			{ displayName: 'Link Preview Options (JSON)', name: 'linkPreviewOptions', type: 'json', default: '', description: 'Upload Text: Telegram LinkPreviewOptions object, e.g. {"is_disabled": true} or {"prefer_large_media": true, "show_above_text": true}' },
			{ displayName: 'Live Photo Still', name: 'livePhotoPhoto', type: 'string', default: '', description: 'Upload Video with Send As = live_photo: URL of the still photo' },
			{ displayName: 'Location (JSON)', name: 'location', type: 'json', default: '', description: 'Upload Text: send a location, e.g. {"latitude": 40.41, "longitude": -3.70}. Add live_period (60-86400 s) for a live location.' },
			{ displayName: 'Media URLs', name: 'mediaUrls', type: 'string', default: '', description: 'Upload Video / Upload Document: up to 9 extra comma-separated URLs sent with the file as one album' },
			{ displayName: 'Message Effect ID', name: 'messageEffectId', type: 'string', default: '', description: 'Message effect (Telegram shows effects in private chats only)' },
			{ displayName: 'Paid Media Payload', name: 'paidPayload', type: 'string', default: '', description: 'Internal reference for paid media (max 128 bytes, never shown to readers)' },
			{ displayName: 'Paid Media Stars', name: 'paidStarCount', type: 'number', typeOptions: { minValue: 1, maxValue: 25000 }, default: 1, description: 'Upload Photo(s) / Upload Video: readers pay this many Telegram Stars to unlock the media. The Stars go to your channel or bot.' },
			{ displayName: 'Performer', name: 'performer', type: 'string', default: '', description: 'Upload Document with Send As = audio: performer' },
			{ displayName: 'Pin', name: 'pin', type: 'boolean', default: true, description: 'Whether to pin the post after publishing (silently). A failed pin never fails the post.' },
			{ displayName: 'Pin Notify', name: 'pinNotify', type: 'boolean', default: true, description: 'Whether to notify the members about the pin (groups only)' },
			{ displayName: 'Poll (JSON)', name: 'poll', type: 'json', default: '', description: 'Upload Text: send a poll, e.g. {"options": ["Monday", "Friday"], "is_anonymous": false}. The question defaults to the post text.' },
			{ displayName: 'Reply Markup (JSON)', name: 'replyMarkup', type: 'json', default: '', description: 'Inline keyboard with URL buttons: a Telegram InlineKeyboardMarkup object ({"inline_keyboard": [[button, ...]]}, each button with text and a link). Buttons with callback_data need your own bot to answer them.' },
			{ displayName: 'Reply Quote', name: 'replyQuote', type: 'string', default: '', description: 'With Reply To Message ID: exact part of the message to quote' },
			{ displayName: 'Reply To Message ID', name: 'replyToMessageId', type: 'number', default: 0, description: 'Publish as a reply to this message of the chat' },
			{ displayName: 'Rich Message', name: 'richMessage', type: 'string', default: '', description: 'Upload Text: send a rich message (headings, lists, tables). True = the post text is rich Markdown, or markdown / html.' },
			{
				displayName: 'Send As',
				name: 'sendAs',
				type: 'options',
				options: [
					{ name: 'Animation', value: 'animation' },
					{ name: 'Audio', value: 'audio' },
					{ name: 'Document', value: 'document' },
					{ name: 'Live Photo', value: 'live_photo' },
					{ name: 'Photo', value: 'photo' },
					{ name: 'Sticker', value: 'sticker' },
					{ name: 'Video', value: 'video' },
					{ name: 'Video Note', value: 'video_note' },
					{ name: 'Voice', value: 'voice' },
				],
				default: 'document',
				description: 'Upload Video: animation, video_note, live_photo or document. Upload Document: any type (default document).',
			},
			{ displayName: 'Send By URL', name: 'sendByUrl', type: 'boolean', default: true, description: 'Whether Telegram downloads the media URLs itself (max 5 MB per photo and 20 MB per file)' },
			{ displayName: 'Send Title', name: 'sendTitle', type: 'boolean', default: false, description: 'Whether to send the post text before a location, contact, dice, sticker or video note (default true)' },
			{ displayName: 'Show Caption Above Media', name: 'showCaptionAboveMedia', type: 'boolean', default: true, description: 'Whether to show the caption above the media' },
			{ displayName: 'Start Timestamp', name: 'startTimestamp', type: 'number', default: 0, description: 'Upload Video: second where the video starts playing' },
			{ displayName: 'Telegram Title', name: 'telegramTitle', type: 'string', default: '', description: 'Telegram text or caption (falls back to Title)' },
			{ displayName: 'Thumbnail URL', name: 'thumbnail', type: 'string', default: '', description: 'Public URL of a JPEG under 200 kB, max 320×320' },
			{ displayName: 'Venue (JSON)', name: 'venue', type: 'json', default: '', description: 'Upload Text: send a venue, e.g. {"latitude": 40.41, "longitude": -3.70, "address": "Gran Vía 1", "title": "Our shop"}' },
		],
	},
	{
		displayName: 'Bluesky Options',
		name: 'blueskyOptions',
		type: 'collection',
		placeholder: 'Add Bluesky Option',
		default: {},
		description: 'An invalid value only fails the Bluesky part of the request (bluesky_invalid_parameter)',
		displayOptions: { show: { operation: MEDIA_AND_TEXT, platform: ['bluesky', MANUAL_PLATFORM_VALUE] } },
		options: [
			{ displayName: 'Captions (JSON)', name: 'captions', type: 'json', default: '', description: 'Upload Video: up to 20 WebVTT subtitle tracks, one per language: objects with lang plus either a public link to the .vtt file or the WebVTT text in vtt (see docs.upload-post.com/api/upload-video)' },
			{ displayName: 'Created At', name: 'createdAt', type: 'string', default: '', description: 'Date Bluesky shows and sorts the post by (ISO 8601 with time zone, not in the future), to import older posts' },
			{ displayName: 'GIF As Video', name: 'gifAsVideo', type: 'boolean', default: true, description: 'Whether to publish a single animated GIF as a looping video (counts against the daily Bluesky video quota)' },
			{ displayName: 'Tags', name: 'tags', type: 'string', default: '', description: 'Up to 8 comma-separated hashtags stored on the post without appearing in the text' },
			{ displayName: 'Thread Overflow', name: 'threadOverflow', type: 'boolean', default: true, description: 'Whether a text longer than 300 characters continues as replies instead of being cut' },
			{
				displayName: 'Video Presentation',
				name: 'videoPresentation',
				type: 'options',
				options: [
					{ name: 'Default', value: 'default' },
					{ name: 'GIF (Looping, Muted, No Controls)', value: 'gif' },
				],
				default: 'default',
				description: 'Upload Video: how Bluesky plays the video',
			},
		],
	},
	{
		displayName: 'Google Business Options',
		name: 'gbpOptions',
		type: 'collection',
		placeholder: 'Add Google Business Option',
		default: {},
		displayOptions: { show: { operation: MEDIA_AND_TEXT, platform: ['google_business', MANUAL_PLATFORM_VALUE] } },
		options: [
			{ displayName: 'Alert Type', name: 'alertType', type: 'string', default: 'COVID_19', description: 'Topic Type ALERT: kind of alert (Google only accepts COVID_19 today)' },
			{ displayName: 'Multiple Media', name: 'multiMedia', type: 'boolean', default: true, description: 'Whether to send every attached photo to Google (photos only, max 10). Without it only the first one is sent.' },
			{
				displayName: 'Recurrence',
				name: 'recurrence',
				type: 'options',
				options: [
					{ name: 'Daily', value: 'DAILY' },
					{ name: 'Monthly', value: 'MONTHLY' },
					{ name: 'Weekly', value: 'WEEKLY' },
				],
				default: 'WEEKLY',
				description: 'EVENT and OFFER posts: repeat the post. Needs the event start and end dates.',
			},
			{ displayName: 'Recurrence Day of Month', name: 'recurrenceDayOfMonth', type: 'number', typeOptions: { minValue: 1, maxValue: 31 }, default: 1, description: 'MONTHLY: day of the month' },
			{ displayName: 'Recurrence Days', name: 'recurrenceDays', type: 'string', default: '', placeholder: 'MON,THU', description: 'WEEKLY: comma-separated days (MONDAY,THURSDAY or MON,THU)' },
			{ displayName: 'Recurrence End', name: 'recurrenceEnd', type: 'string', default: '', description: 'End of the series: YYYY-MM-DD or RFC 3339, at most a year after the event start' },
			{
				displayName: 'Recurrence Week Occurrence',
				name: 'recurrenceWeekOccurrence',
				type: 'options',
				options: [
					{ name: 'First', value: 'FIRST' },
					{ name: 'Fourth', value: 'FOURTH' },
					{ name: 'Last', value: 'LAST' },
					{ name: 'Second', value: 'SECOND' },
					{ name: 'Third', value: 'THIRD' },
				],
				default: 'FIRST',
				description: 'MONTHLY: occurrence of the weekday of the event start',
			},
			{ displayName: 'Scheduled Time (Google)', name: 'scheduledTime', type: 'string', default: '', description: 'Google\'s own scheduling: RFC 3339 with time zone, at most a year ahead. Cancelling in Upload-Post does not stop it (use Unpublish Post).' },
			{ displayName: 'Upload To Gallery', name: 'uploadToGallery', type: 'boolean', default: true, description: 'Whether to publish the photo to the Media/Gallery tab (same as Post Type = Media)' },
		],
	},
];

// ---------------------------------------------------------------------------
// Operation lists
// ---------------------------------------------------------------------------

const opsFor = (resource: string) => ({ show: { resource: [resource] } });
const showFor = (resource: string, operation: string[]) => ({ show: { resource: [resource], operation } });

const BEST_TIME_PLATFORMS = [
	{ name: 'Bluesky', value: 'bluesky' },
	{ name: 'Facebook', value: 'facebook' },
	{ name: 'Instagram', value: 'instagram' },
	{ name: 'LinkedIn', value: 'linkedin' },
	{ name: 'Pinterest', value: 'pinterest' },
	{ name: 'Threads', value: 'threads' },
	{ name: 'TikTok', value: 'tiktok' },
	{ name: 'YouTube', value: 'youtube' },
];

const confirmProperty = (resource: string, operation: string[], what: string): INodeProperties => ({
	displayName: 'Confirm',
	name: `${resource}Confirm`,
	type: 'boolean',
	default: false,
	description: `Whether you confirm ${what}. The API refuses the call (confirmation_required) without it.`,
	displayOptions: showFor(resource, operation),
});

const extraJsonProperty = (resource: string, operation: string[], description: string): INodeProperties => ({
	displayName: 'Extra Fields (JSON)',
	name: `${resource}ExtraFields`,
	type: 'json',
	default: '',
	description,
	displayOptions: showFor(resource, operation),
});

export const networkProperties: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		options: [
			{ name: 'Get Best Times', value: 'getBestTimes', action: 'Get the best times to post', description: 'Best hours to publish for a connected account, with source (audience activity, account posts or Upload-Post history) and confidence' },
			{ name: 'Get Next Queue Slot', value: 'getNextQueueSlot', action: 'Get the next free queue slot', description: 'Next free slot of the profile queue' },
			{ name: 'Get Queue Preview', value: 'getQueuePreview', action: 'Preview the queue', description: 'Upcoming queue slots and how many posts each one has' },
			{ name: 'Get Queue Settings', value: 'getQueueSettings', action: 'Get the queue settings', description: 'Queue settings, including slots_mode, auto_slots and effective_slots' },
			{ name: 'Update Queue Settings', value: 'updateQueueSettings', action: 'Update the queue settings', description: 'Change the queue: automatic slots from the best times (slots=auto) or fixed slots, time zone, days and posts per slot' },
		],
		default: 'getBestTimes',
		displayOptions: opsFor('queue'),
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		options: [
			{ name: 'Create Invite Link', value: 'createTelegramInviteLink', action: 'Create a telegram invite link', description: 'Create an invite link for the connected chat' },
			{ name: 'Get Boosts', value: 'getTelegramBoosts', action: 'Get telegram boosts', description: 'Boosts of the chat, or of one user' },
			{ name: 'Get Bot Commands', value: 'getTelegramBotCommands', action: 'Get telegram bot commands', description: 'Commands of the connected bot' },
			{ name: 'Get Bot Profile', value: 'getTelegramBotProfile', action: 'Get the telegram bot profile', description: 'Bot name, descriptions, photo, menu button and default administrator rights' },
			{ name: 'Get Chat Info', value: 'getTelegramChatInfo', action: 'Get telegram chat info', description: 'Chat details, subscribers or members and administrators' },
			{ name: 'Get Member', value: 'getTelegramMember', action: 'Get a telegram member', description: 'Read one member, or list the administrators when User ID is empty' },
			{ name: 'Moderate Member', value: 'moderateTelegramMember', action: 'Moderate a telegram member', description: 'Ban, unban, restrict, promote, demote or give a custom title to a member' },
			{ name: 'Revoke Invite Link', value: 'revokeTelegramInviteLink', action: 'Revoke a telegram invite link', description: 'Revoke an invite link the bot created' },
			{ name: 'Set Bot Commands', value: 'setTelegramBotCommands', action: 'Set telegram bot commands', description: 'Replace the commands of the connected bot' },
			{ name: 'Update Bot Profile', value: 'updateTelegramBotProfile', action: 'Update the telegram bot profile', description: 'Change the bot name, descriptions, menu button or default administrator rights' },
			{ name: 'Update Chat Info', value: 'updateTelegramChatInfo', action: 'Update telegram chat info', description: 'Change the chat title, description, permissions and other settings' },
		],
		default: 'getTelegramChatInfo',
		displayOptions: opsFor('telegram'),
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		options: [
			{ name: 'Create Draft', value: 'createBlueskyDraft', action: 'Create a bluesky draft', description: 'Create a draft (text only) that shows up in the Bluesky app drafts list' },
			{ name: 'Delete Draft', value: 'deleteBlueskyDraft', action: 'Delete a bluesky draft', description: 'Delete a draft' },
			{ name: 'Get Notifications', value: 'getBlueskyNotifications', action: 'Get bluesky notifications', description: 'Notifications of the connected account (replies, mentions, quotes, likes, reposts, follows...)' },
			{ name: 'Get Profile', value: 'getBlueskyProfile', action: 'Get bluesky profiles', description: 'One or several Bluesky profiles, or the connected account when Actor is empty' },
			{ name: 'Get Unread Count', value: 'getBlueskyUnreadCount', action: 'Get the bluesky unread count', description: 'Unread notification count' },
			{ name: 'List Drafts', value: 'listBlueskyDrafts', action: 'List bluesky drafts', description: 'Drafts of the connected account' },
			{ name: 'Search Accounts', value: 'searchBlueskyActors', action: 'Search bluesky accounts', description: 'Search Bluesky accounts' },
			{ name: 'Search Posts', value: 'searchBlueskyPosts', action: 'Search bluesky posts', description: 'Search Bluesky posts as the connected account' },
		],
		default: 'getBlueskyProfile',
		displayOptions: opsFor('bluesky'),
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		options: [
			{ name: 'Get Location Info', value: 'getGbpLocationInfo', action: 'Get google business location info', description: 'Name, address, hours, phones, categories, service area and open status of the location' },
			{ name: 'Get Performance', value: 'getGbpPerformance', action: 'Get google business performance', description: 'Daily metrics for a date range (impressions, calls, website clicks, directions...)' },
			{ name: 'Get Post', value: 'getGbpPost', action: 'Get a google business post', description: 'Read one post. Edit it with Post Action > Edit Post and delete it with Post Action > Unpublish Post.' },
			{ name: 'Get Review', value: 'getGbpReview', action: 'Get a google business review', description: 'Read one review' },
			{ name: 'Get Search Keywords', value: 'getGbpSearchKeywords', action: 'Get google business search keywords', description: 'Monthly search keywords that showed the location' },
			{ name: 'List Posts', value: 'listGbpPosts', action: 'List google business posts', description: 'Posts of the location' },
			{ name: 'List Reviews', value: 'listGbpReviews', action: 'List google business reviews', description: 'Reviews of the location' },
			{ name: 'Update Location Info', value: 'updateGbpLocationInfo', action: 'Update google business location info', description: 'Edit the location info. Legacy mode (default) or strict mode, which can also change name, address, categories and open status.' },
		],
		default: 'listGbpPosts',
		displayOptions: opsFor('googleBusiness'),
	},
	{
		displayName: 'Profile Name or ID',
		name: 'networkProfile',
		type: 'options',
		noDataExpression: true,
		required: true,
		default: '',
		description: 'Choose from your created profiles. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		typeOptions: { loadOptionsMethod: 'getUserProfiles' },
		displayOptions: { show: { resource: NETWORK_RESOURCES } },
	},

	// ---- Queue & best time ----
	{
		displayName: 'Platform',
		name: 'bestTimesPlatform',
		type: 'options',
		required: true,
		options: BEST_TIME_PLATFORMS,
		default: 'instagram',
		description: 'Connected network to analyse',
		displayOptions: showFor('queue', ['getBestTimes']),
	},
	{
		displayName: 'Time Zone',
		name: 'queueTimezone',
		type: 'string',
		default: '',
		placeholder: 'Europe/Madrid',
		description: 'IANA time zone. Best times: the hours of the answer (default: the queue time zone, else UTC). Update queue: the queue time zone.',
		displayOptions: showFor('queue', ['getBestTimes', 'updateQueueSettings']),
	},
	{
		displayName: 'Top Hours',
		name: 'bestTimesTop',
		type: 'number',
		typeOptions: { minValue: 0, maxValue: 24 },
		default: 0,
		description: 'How many hours to return (1-24). 0 = API default (5).',
		displayOptions: showFor('queue', ['getBestTimes']),
	},
	{
		displayName: 'Refresh',
		name: 'queueRefresh',
		type: 'boolean',
		default: false,
		description: 'Whether to recompute instead of using the cached answer (only when it is at least 24 hours old; YouTube 7 days)',
		displayOptions: showFor('queue', ['getBestTimes', 'updateQueueSettings']),
	},
	{
		displayName: 'LinkedIn Page URN',
		name: 'bestTimesPageUrn',
		type: 'string',
		default: '',
		description: 'LinkedIn only: organization ID or urn:li:organization:ID of a Page this connection administers',
		displayOptions: { show: { resource: ['queue'], operation: ['getBestTimes'], bestTimesPlatform: ['linkedin'] } },
	},
	{
		displayName: 'Facebook Page ID',
		name: 'bestTimesFacebookPageId',
		type: 'string',
		default: '',
		description: 'Facebook only: numeric ID of one of the connection\'s Pages',
		displayOptions: { show: { resource: ['queue'], operation: ['getBestTimes'], bestTimesPlatform: ['facebook'] } },
	},
	{
		displayName: 'Slots Mode',
		name: 'queueSlotsMode',
		type: 'options',
		options: [
			{ name: 'Automatic (Best Times)', value: 'auto' },
			{ name: 'Fixed Slots', value: 'fixed' },
			{ name: 'Keep Current', value: '' },
		],
		default: '',
		description: 'Automatic fills the queue with the best hours of the profile\'s networks (posts already scheduled do not move). Fixed uses the Fixed Slots below, or the stored ones.',
		displayOptions: showFor('queue', ['updateQueueSettings']),
	},
	{
		displayName: 'Automatic Slots per Day',
		name: 'queueAutoSlotsCount',
		type: 'number',
		typeOptions: { minValue: 0, maxValue: 12 },
		default: 0,
		description: 'Automatic mode: hours per day (1-12). 0 = API default (the number of fixed slots, or 3).',
		displayOptions: { show: { resource: ['queue'], operation: ['updateQueueSettings'], queueSlotsMode: ['auto'] } },
	},
	{
		displayName: 'Automatic Slots Platforms',
		name: 'queueAutoPlatforms',
		type: 'multiOptions',
		options: [...BEST_TIME_PLATFORMS],
		default: [],
		description: 'Automatic mode: networks to take into account (up to 6). Empty = every connected network with best times.',
		displayOptions: { show: { resource: ['queue'], operation: ['updateQueueSettings'], queueSlotsMode: ['auto'] } },
	},
	{
		displayName: 'Fixed Slots (JSON)',
		name: 'queueSlots',
		type: 'json',
		default: '',
		description: 'Fixed mode: array of slots, e.g. [{"hour": 9, "minute": 0}, {"hour": 17, "minute": 30}] (max 24)',
		displayOptions: { show: { resource: ['queue'], operation: ['updateQueueSettings'], queueSlotsMode: ['fixed'] } },
	},
	{
		displayName: 'Days of Week',
		name: 'queueDaysOfWeek',
		type: 'string',
		default: '',
		placeholder: '0,1,2,3,4',
		description: 'Active days, comma-separated: 0 = Monday ... 6 = Sunday. Empty = unchanged.',
		displayOptions: showFor('queue', ['updateQueueSettings']),
	},
	{
		displayName: 'Max Posts per Slot',
		name: 'queueMaxPostsPerSlot',
		type: 'number',
		typeOptions: { minValue: 0, maxValue: 100 },
		default: 0,
		description: '1-100. 0 = unchanged.',
		displayOptions: showFor('queue', ['updateQueueSettings']),
	},
	{
		displayName: 'Slots to Preview',
		name: 'queuePreviewCount',
		type: 'number',
		typeOptions: { minValue: 0, maxValue: 50 },
		default: 0,
		description: 'Number of slots to return (max 50). 0 = API default (10).',
		displayOptions: showFor('queue', ['getQueuePreview']),
	},

	// ---- Telegram ----
	{
		displayName: 'Include Administrators',
		name: 'telegramIncludeAdministrators',
		type: 'boolean',
		default: true,
		description: 'Whether to add the chat administrators',
		displayOptions: showFor('telegram', ['getTelegramChatInfo']),
	},
	{
		displayName: 'Return Bots',
		name: 'telegramReturnBots',
		type: 'boolean',
		default: false,
		description: 'Whether to also list other bots that are administrators',
		displayOptions: showFor('telegram', ['getTelegramChatInfo', 'getTelegramMember']),
	},
	{
		displayName: 'Telegram User ID',
		name: 'telegramUserId',
		type: 'string',
		default: '',
		description: 'Numeric Telegram user ID. Get Member: empty lists the administrators. Get Boosts: empty returns the chat boosts.',
		displayOptions: showFor('telegram', ['getTelegramBoosts', 'getTelegramMember', 'moderateTelegramMember']),
	},
	{
		displayName: 'Member Action',
		name: 'telegramMemberAction',
		type: 'options',
		options: [
			{ name: 'Ban', value: 'ban' },
			{ name: 'Demote', value: 'demote' },
			{ name: 'Promote', value: 'promote' },
			{ name: 'Restrict', value: 'restrict' },
			{ name: 'Set Custom Title', value: 'set_title' },
			{ name: 'Unban', value: 'unban' },
		],
		default: 'restrict',
		description: 'Ban, promote and demote need Confirm. Put permissions, rights, until_date or custom_title in Extra Fields.',
		displayOptions: showFor('telegram', ['moderateTelegramMember']),
	},
	{
		displayName: 'Title',
		name: 'telegramChatTitle',
		type: 'string',
		default: '',
		description: 'New chat title (1-128 characters)',
		displayOptions: showFor('telegram', ['updateTelegramChatInfo']),
	},
	{
		displayName: 'Description',
		name: 'telegramChatDescription',
		type: 'string',
		default: '',
		description: 'New chat description (0-255 characters)',
		displayOptions: showFor('telegram', ['updateTelegramChatInfo']),
	},
	{
		displayName: 'Link Name',
		name: 'telegramInviteName',
		type: 'string',
		default: '',
		description: 'Name of the invite link (0-32 characters)',
		displayOptions: showFor('telegram', ['createTelegramInviteLink']),
	},
	{
		displayName: 'Expire Date',
		name: 'telegramInviteExpireDate',
		type: 'number',
		default: 0,
		description: 'Unix time when the link expires. 0 = never.',
		displayOptions: showFor('telegram', ['createTelegramInviteLink']),
	},
	{
		displayName: 'Member Limit',
		name: 'telegramInviteMemberLimit',
		type: 'number',
		typeOptions: { minValue: 0, maxValue: 99999 },
		default: 0,
		description: 'Members that can join with the link (1-99999). 0 = no limit. Not together with Creates Join Request.',
		displayOptions: showFor('telegram', ['createTelegramInviteLink']),
	},
	{
		displayName: 'Creates Join Request',
		name: 'telegramInviteCreatesJoinRequest',
		type: 'boolean',
		default: false,
		description: 'Whether people joining with the link need to be approved by an administrator',
		displayOptions: showFor('telegram', ['createTelegramInviteLink']),
	},
	{
		displayName: 'Invite Link',
		name: 'telegramInviteLink',
		type: 'string',
		required: true,
		default: '',
		description: 'The invite link to revoke (only links created by the bot)',
		displayOptions: showFor('telegram', ['revokeTelegramInviteLink']),
	},
	{
		displayName: 'Bot Name',
		name: 'telegramBotName',
		type: 'string',
		default: '',
		description: 'Bot name (0-64 characters)',
		displayOptions: showFor('telegram', ['updateTelegramBotProfile']),
	},
	{
		displayName: 'Bot Description',
		name: 'telegramBotDescription',
		type: 'string',
		default: '',
		description: 'Shown in an empty chat with the bot (0-512 characters)',
		displayOptions: showFor('telegram', ['updateTelegramBotProfile']),
	},
	{
		displayName: 'Bot Short Description',
		name: 'telegramBotShortDescription',
		type: 'string',
		default: '',
		description: 'Shown on the bot profile and when it is shared (0-120 characters)',
		displayOptions: showFor('telegram', ['updateTelegramBotProfile']),
	},
	{
		displayName: 'Commands',
		name: 'telegramCommands',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true, maxValue: 100 },
		default: {},
		placeholder: 'Add Command',
		options: [
			{
				name: 'command',
				displayName: 'Command',
				values: [
					{ displayName: 'Command', name: 'command', type: 'string', default: '', description: '1-32 lowercase letters, digits or underscores, without the slash' },
					{ displayName: 'Description', name: 'description', type: 'string', default: '', description: 'Description shown in the menu (1-256 characters)' },
				],
			},
		],
		displayOptions: showFor('telegram', ['setTelegramBotCommands']),
	},
	{
		displayName: 'Language Code',
		name: 'telegramLanguageCode',
		type: 'string',
		default: '',
		description: 'Two-letter ISO 639-1 code: the texts or commands apply to that language only. Empty = every language without its own.',
		displayOptions: showFor('telegram', ['updateTelegramBotProfile', 'getTelegramBotCommands', 'setTelegramBotCommands']),
	},
	confirmProperty('telegram', ['moderateTelegramMember', 'revokeTelegramInviteLink'], 'the change (ban, promote, demote, revoke)'),
	extraJsonProperty(
		'telegram',
		['updateTelegramChatInfo', 'moderateTelegramMember', 'updateTelegramBotProfile', 'setTelegramBotCommands'],
		'Other fields merged into the request body as is, e.g. {"permissions": {"can_send_messages": false}}, {"rights": {"can_post_messages": true}}, {"until_date": 0}, {"menu_button": {"type": "commands"}} or {"scope": {"type": "all_private_chats"}}',
	),

	// ---- Bluesky ----
	{
		displayName: 'Actor',
		name: 'blueskyActor',
		type: 'string',
		default: '',
		description: 'Handle or DID, or several separated by commas (up to 25). Empty = the connected account.',
		displayOptions: showFor('bluesky', ['getBlueskyProfile']),
	},
	{
		displayName: 'Search Query',
		name: 'blueskyQuery',
		type: 'string',
		required: true,
		default: '',
		displayOptions: showFor('bluesky', ['searchBlueskyPosts', 'searchBlueskyActors']),
	},
	{
		displayName: 'Sort',
		name: 'blueskySort',
		type: 'options',
		options: [
			{ name: 'API Default', value: '' },
			{ name: 'Latest', value: 'latest' },
			{ name: 'Top', value: 'top' },
		],
		default: '',
		displayOptions: showFor('bluesky', ['searchBlueskyPosts']),
	},
	{
		displayName: 'Author',
		name: 'blueskyAuthor',
		type: 'string',
		default: '',
		description: 'Only posts by this handle or DID',
		displayOptions: showFor('bluesky', ['searchBlueskyPosts']),
	},
	{
		displayName: 'Language',
		name: 'blueskyLang',
		type: 'string',
		default: '',
		placeholder: 'en',
		displayOptions: showFor('bluesky', ['searchBlueskyPosts']),
	},
	{
		displayName: 'Since',
		name: 'blueskySince',
		type: 'string',
		default: '',
		description: 'YYYY-MM-DD or ISO 8601 with time zone',
		displayOptions: showFor('bluesky', ['searchBlueskyPosts']),
	},
	{
		displayName: 'Until',
		name: 'blueskyUntil',
		type: 'string',
		default: '',
		description: 'YYYY-MM-DD or ISO 8601 with time zone',
		displayOptions: showFor('bluesky', ['searchBlueskyPosts']),
	},
	{
		displayName: 'Reasons',
		name: 'blueskyReasons',
		type: 'multiOptions',
		options: [
			{ name: 'Follow', value: 'follow' },
			{ name: 'Like', value: 'like' },
			{ name: 'Mention', value: 'mention' },
			{ name: 'Quote', value: 'quote' },
			{ name: 'Reply', value: 'reply' },
			{ name: 'Repost', value: 'repost' },
		],
		default: [],
		description: 'Only these kinds of notification. Empty = all.',
		displayOptions: showFor('bluesky', ['getBlueskyNotifications']),
	},
	{
		displayName: 'Page Size',
		name: 'blueskyPageSize',
		type: 'number',
		typeOptions: { minValue: 0, maxValue: 100 },
		default: 0,
		description: '1-100. 0 = API default.',
		displayOptions: showFor('bluesky', ['getBlueskyNotifications', 'searchBlueskyPosts', 'searchBlueskyActors', 'listBlueskyDrafts']),
	},
	{
		displayName: 'Cursor',
		name: 'blueskyCursor',
		type: 'string',
		default: '',
		description: 'Cursor of the previous page',
		displayOptions: showFor('bluesky', ['getBlueskyNotifications', 'searchBlueskyPosts', 'searchBlueskyActors', 'listBlueskyDrafts']),
	},
	{
		displayName: 'Draft Text',
		name: 'blueskyDraftText',
		type: 'string',
		default: '',
		typeOptions: { rows: 3 },
		description: 'Text of a one-post draft (up to 1,000 characters). For a thread use Draft Posts.',
		displayOptions: showFor('bluesky', ['createBlueskyDraft']),
	},
	{
		displayName: 'Draft Posts (JSON)',
		name: 'blueskyDraftPosts',
		type: 'json',
		default: '',
		description: 'Thread of 1-100 posts, e.g. [{"text": "Part 1", "link_url": "https://example.com"}, {"text": "Part 2"}]. Images and video are not accepted in drafts.',
		displayOptions: showFor('bluesky', ['createBlueskyDraft']),
	},
	{
		displayName: 'Languages',
		name: 'blueskyDraftLangs',
		type: 'string',
		default: '',
		placeholder: 'en,es',
		description: 'Up to 3 comma-separated language codes',
		displayOptions: showFor('bluesky', ['createBlueskyDraft']),
	},
	{
		displayName: 'Reply Settings',
		name: 'blueskyDraftReplySettings',
		type: 'string',
		default: '',
		description: 'Who can reply once published: nobody, mention, following, followers, or list: followed by the list AT-URI',
		displayOptions: showFor('bluesky', ['createBlueskyDraft']),
	},
	{
		displayName: 'Draft ID',
		name: 'blueskyDraftId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: showFor('bluesky', ['deleteBlueskyDraft']),
	},
	confirmProperty('bluesky', ['deleteBlueskyDraft'], 'deleting the draft'),

	// ---- Google Business ----
	{
		displayName: 'Location ID',
		name: 'gbpApiLocationId',
		type: 'string',
		default: '',
		description: 'Location as locations/123, 123 or accounts/456/locations/123. Empty = the location selected for the profile.',
		displayOptions: { show: { resource: ['googleBusiness'], operation: ['listGbpPosts', 'listGbpReviews', 'getGbpPerformance', 'getGbpSearchKeywords', 'getGbpLocationInfo', 'updateGbpLocationInfo'] } },
	},
	{
		displayName: 'Post ID',
		name: 'gbpApiPostId',
		type: 'string',
		required: true,
		default: '',
		description: 'Full post name returned on upload or by List Posts: accounts/{a}/locations/{l}/localPosts/{p}',
		displayOptions: showFor('googleBusiness', ['getGbpPost']),
	},
	{
		displayName: 'Review Name',
		name: 'gbpApiReviewName',
		type: 'string',
		required: true,
		default: '',
		description: 'Full review name from List Reviews: accounts/.../locations/.../reviews/{ID}',
		displayOptions: showFor('googleBusiness', ['getGbpReview']),
	},
	{
		displayName: 'Order By',
		name: 'gbpApiOrderBy',
		type: 'options',
		options: [
			{ name: 'Highest Rating', value: 'rating desc' },
			{ name: 'Lowest Rating', value: 'rating' },
			{ name: 'Newest', value: 'updateTime desc' },
		],
		default: 'updateTime desc',
		displayOptions: showFor('googleBusiness', ['listGbpReviews']),
	},
	{
		displayName: 'Page Size',
		name: 'gbpApiPageSize',
		type: 'number',
		typeOptions: { minValue: 0, maxValue: 100 },
		default: 0,
		description: 'Items per page. 0 = API default.',
		displayOptions: showFor('googleBusiness', ['listGbpPosts', 'listGbpReviews', 'getGbpSearchKeywords']),
	},
	{
		displayName: 'Page Token',
		name: 'gbpApiPageCursor',
		type: 'string',
		default: '',
		description: 'The next_page_token of the previous page',
		displayOptions: showFor('googleBusiness', ['listGbpPosts', 'listGbpReviews', 'getGbpSearchKeywords']),
	},
	{
		displayName: 'Metrics',
		name: 'gbpApiMetrics',
		type: 'string',
		default: '',
		placeholder: 'CALL_CLICKS,WEBSITE_CLICKS',
		description: 'Comma-separated metrics. Empty = all of them.',
		displayOptions: showFor('googleBusiness', ['getGbpPerformance']),
	},
	{
		displayName: 'Start Date',
		name: 'gbpApiStartDate',
		type: 'string',
		default: '',
		placeholder: '2026-10-01',
		description: 'YYYY-MM-DD (at most 18 months back). Default: 29 days before the end date.',
		displayOptions: showFor('googleBusiness', ['getGbpPerformance']),
	},
	{
		displayName: 'End Date',
		name: 'gbpApiEndDate',
		type: 'string',
		default: '',
		description: 'YYYY-MM-DD. Default: today (UTC).',
		displayOptions: showFor('googleBusiness', ['getGbpPerformance']),
	},
	{
		displayName: 'Start Month',
		name: 'gbpApiStartMonth',
		type: 'string',
		default: '',
		placeholder: '2026-09',
		description: 'YYYY-MM (at most 18 months back)',
		displayOptions: showFor('googleBusiness', ['getGbpSearchKeywords']),
	},
	{
		displayName: 'End Month',
		name: 'gbpApiEndMonth',
		type: 'string',
		default: '',
		description: 'YYYY-MM. Default: the current month.',
		displayOptions: showFor('googleBusiness', ['getGbpSearchKeywords']),
	},
	{
		displayName: 'Read Mask',
		name: 'gbpApiReadMask',
		type: 'string',
		default: '',
		description: 'Comma-separated Location fields to return (e.g. name,title,regularHours). Empty = all.',
		displayOptions: showFor('googleBusiness', ['getGbpLocationInfo']),
	},
	{
		displayName: 'Edit Mode',
		name: 'gbpApiEditMode',
		type: 'options',
		options: [
			{ name: 'Legacy (Default)', value: 'legacy' },
			{ name: 'Strict', value: 'strict' },
		],
		default: 'legacy',
		description: 'Strict can also change title, address, categories, service area and open status (some need Confirm) and supports Dry Run',
		displayOptions: showFor('googleBusiness', ['updateGbpLocationInfo']),
	},
	{
		displayName: 'Description',
		name: 'gbpApiDescription',
		type: 'string',
		default: '',
		description: 'Business description (max 750 characters)',
		displayOptions: showFor('googleBusiness', ['updateGbpLocationInfo']),
	},
	{
		displayName: 'Website',
		name: 'gbpApiWebsite',
		type: 'string',
		default: '',
		displayOptions: showFor('googleBusiness', ['updateGbpLocationInfo']),
	},
	{
		displayName: 'Phone',
		name: 'gbpApiPhone',
		type: 'string',
		default: '',
		description: 'Primary phone, e.g. +34 912 345 678',
		displayOptions: showFor('googleBusiness', ['updateGbpLocationInfo']),
	},
	{
		displayName: 'Validate Only',
		name: 'gbpApiValidateOnly',
		type: 'boolean',
		default: false,
		description: 'Whether Google only validates the change without applying it',
		displayOptions: showFor('googleBusiness', ['updateGbpLocationInfo']),
	},
	{
		displayName: 'Dry Run',
		name: 'gbpApiDryRun',
		type: 'boolean',
		default: false,
		description: 'Whether to only validate the change (strict mode)',
		displayOptions: { show: { resource: ['googleBusiness'], operation: ['updateGbpLocationInfo'], gbpApiEditMode: ['strict'] } },
	},
	confirmProperty('googleBusiness', ['updateGbpLocationInfo'], 'changing title, address, primary category, phone or closing the location (strict mode)'),
	extraJsonProperty(
		'googleBusiness',
		['updateGbpLocationInfo'],
		'Other location fields merged into the body as is, e.g. {"regular_hours": [{"day": "MONDAY", "open": "09:00", "close": "18:00"}]}, special_hours, primary_category, additional_categories or (strict mode) title, address, open_status',
	),
];

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

const buildQueueRequest = (ctx: NetworkContext, profile: string): NetworkRequest => {
	switch (ctx.operation) {
		case 'getBestTimes': {
			const qs: IDataObject = { profile_username: profile, platform: requireStr(ctx, 'bestTimesPlatform', 'Platform') };
			putFilled(ctx, qs, [['queueTimezone', 'timezone'], ['bestTimesTop', 'top']]);
			if (bool(ctx, 'queueRefresh')) qs.refresh = 'true';
			if (qs.platform === 'linkedin') putFilled(ctx, qs, [['bestTimesPageUrn', 'page_urn']]);
			if (qs.platform === 'facebook') putFilled(ctx, qs, [['bestTimesFacebookPageId', 'facebook_page_id']]);
			return request('GET', '/uploadposts/best-times', qs);
		}
		case 'getQueueSettings':
			return request('GET', '/uploadposts/queue/settings', { profile_username: profile });
		case 'getQueuePreview': {
			const qs: IDataObject = { profile_username: profile };
			putFilled(ctx, qs, [['queuePreviewCount', 'count']]);
			return request('GET', '/uploadposts/queue/preview', qs);
		}
		case 'getNextQueueSlot':
			return request('GET', '/uploadposts/queue/next-slot', { profile_username: profile });
		case 'updateQueueSettings': {
			const body: IDataObject = { profile_username: profile };
			putFilled(ctx, body, [['queueTimezone', 'timezone'], ['queueMaxPostsPerSlot', 'max_posts_per_slot']]);
			const mode = str(ctx, 'queueSlotsMode');
			if (mode === 'auto') {
				body.slots_mode = 'auto';
				putFilled(ctx, body, [['queueAutoSlotsCount', 'auto_slots_count']]);
				const platforms = param(ctx, 'queueAutoPlatforms', []) as string[];
				if (Array.isArray(platforms) && platforms.length > 0) body.auto_platforms = platforms;
				if (bool(ctx, 'queueRefresh')) body.refresh = true;
			} else if (mode === 'fixed') {
				const slots = parseJson(ctx, param(ctx, 'queueSlots', ''), 'Fixed Slots');
				if (slots === undefined) {
					body.slots_mode = 'fixed';
				} else if (Array.isArray(slots)) {
					body.slots = slots;
				} else {
					fail(ctx, 'Fixed Slots must be a JSON array, e.g. [{"hour": 9, "minute": 0}]');
				}
			}
			const days = str(ctx, 'queueDaysOfWeek');
			if (days) {
				const parsed = days.split(',').map(day => day.trim()).filter(Boolean).map(Number);
				if (parsed.some(day => !Number.isInteger(day) || day < 0 || day > 6)) {
					fail(ctx, 'Days of Week must be numbers from 0 (Monday) to 6 (Sunday)');
				}
				body.days_of_week = parsed;
			}
			if (Object.keys(body).length === 1) fail(ctx, 'Nothing to update: set Slots Mode, Time Zone, Days of Week or Max Posts per Slot');
			return request('POST', '/uploadposts/queue/settings', body);
		}
	}
	return fail(ctx, `Unsupported queue operation: ${ctx.operation}`);
};

const TG = '/uploadposts/telegram';

const buildTelegramRequest = (ctx: NetworkContext, user: string): NetworkRequest => {
	const extra = () => jsonObjectParam(ctx, 'telegramExtraFields', 'Extra Fields (JSON)');
	const confirm = (body: IDataObject) => {
		if (bool(ctx, 'telegramConfirm')) body.confirm = true;
		return body;
	};
	switch (ctx.operation) {
		case 'getTelegramChatInfo': {
			const qs: IDataObject = { user };
			// The API includes them by default: only send the switch when it is turned off.
			if (param(ctx, 'telegramIncludeAdministrators', true) === false) qs.include_administrators = 'false';
			if (bool(ctx, 'telegramReturnBots')) qs.return_bots = 'true';
			return request('GET', `${TG}/chat-info`, qs);
		}
		case 'updateTelegramChatInfo': {
			const body: IDataObject = { user };
			putFilled(ctx, body, [['telegramChatTitle', 'title'], ['telegramChatDescription', 'description']]);
			Object.assign(body, extra());
			if (Object.keys(body).length === 1) fail(ctx, 'Nothing to update: set Title, Description or Extra Fields');
			return request('PATCH', `${TG}/chat-info`, body);
		}
		case 'getTelegramBoosts': {
			const qs: IDataObject = { user };
			putFilled(ctx, qs, [['telegramUserId', 'user_id']]);
			return request('GET', `${TG}/boosts`, qs);
		}
		case 'getTelegramMember': {
			const qs: IDataObject = { user };
			putFilled(ctx, qs, [['telegramUserId', 'user_id']]);
			if (bool(ctx, 'telegramReturnBots')) qs.return_bots = 'true';
			return request('GET', `${TG}/members`, qs);
		}
		case 'moderateTelegramMember': {
			const body: IDataObject = {
				user,
				action: requireStr(ctx, 'telegramMemberAction', 'Member Action'),
				user_id: requireStr(ctx, 'telegramUserId', 'Telegram User ID'),
				...extra(),
			};
			return request('POST', `${TG}/members`, confirm(body));
		}
		case 'createTelegramInviteLink': {
			const body: IDataObject = { user };
			putFilled(ctx, body, [
				['telegramInviteName', 'name'],
				['telegramInviteExpireDate', 'expire_date'],
				['telegramInviteMemberLimit', 'member_limit'],
			]);
			if (bool(ctx, 'telegramInviteCreatesJoinRequest')) body.creates_join_request = true;
			return request('POST', `${TG}/invite-links`, body);
		}
		case 'revokeTelegramInviteLink':
			return request('DELETE', `${TG}/invite-links`, confirm({ user, invite_link: requireStr(ctx, 'telegramInviteLink', 'Invite Link') }));
		case 'getTelegramBotProfile':
			return request('GET', `${TG}/bot-profile`, { user });
		case 'updateTelegramBotProfile': {
			const body: IDataObject = { user };
			putFilled(ctx, body, [
				['telegramBotName', 'name'],
				['telegramBotDescription', 'description'],
				['telegramBotShortDescription', 'short_description'],
				['telegramLanguageCode', 'language_code'],
			]);
			Object.assign(body, extra());
			return request('PATCH', `${TG}/bot-profile`, body);
		}
		case 'getTelegramBotCommands': {
			const qs: IDataObject = { user };
			putFilled(ctx, qs, [['telegramLanguageCode', 'language_code']]);
			return request('GET', `${TG}/bot-commands`, qs);
		}
		case 'setTelegramBotCommands': {
			const raw = param(ctx, 'telegramCommands', {}) as IDataObject;
			const commands = ((raw.command as IDataObject[] | undefined) ?? [])
				.map(entry => ({
					command: String(entry.command ?? '').trim().replace(/^\//, ''),
					description: String(entry.description ?? '').trim(),
				}))
				.filter(entry => entry.command && entry.description);
			const body: IDataObject = { user, ...extra() };
			if (commands.length > 0) body.commands = commands;
			if (!body.commands) fail(ctx, 'Add at least one command with a description');
			putFilled(ctx, body, [['telegramLanguageCode', 'language_code']]);
			return request('POST', `${TG}/bot-commands`, body);
		}
	}
	return fail(ctx, `Unsupported Telegram operation: ${ctx.operation}`);
};

const BS = '/uploadposts/bluesky';
const BLUESKY_PAGING: Array<[string, string]> = [['blueskyPageSize', 'limit'], ['blueskyCursor', 'cursor']];

const buildBlueskyRequest = (ctx: NetworkContext, user: string): NetworkRequest => {
	switch (ctx.operation) {
		case 'getBlueskyProfile': {
			const qs: IDataObject = { user };
			putFilled(ctx, qs, [['blueskyActor', 'actor']]);
			return request('GET', `${BS}/profile`, qs);
		}
		case 'getBlueskyNotifications': {
			const qs: IDataObject = { user };
			const reasons = param(ctx, 'blueskyReasons', []) as string[];
			if (Array.isArray(reasons) && reasons.length > 0) qs.reasons = reasons.join(',');
			putFilled(ctx, qs, BLUESKY_PAGING);
			return request('GET', `${BS}/notifications`, qs);
		}
		case 'getBlueskyUnreadCount':
			return request('GET', `${BS}/notifications/unread-count`, { user });
		case 'searchBlueskyPosts': {
			const qs: IDataObject = { user, q: requireStr(ctx, 'blueskyQuery', 'Search Query') };
			putFilled(ctx, qs, [
				['blueskySort', 'sort'],
				['blueskyAuthor', 'author'],
				['blueskyLang', 'lang'],
				['blueskySince', 'since'],
				['blueskyUntil', 'until'],
				...BLUESKY_PAGING,
			]);
			return request('GET', `${BS}/search/posts`, qs);
		}
		case 'searchBlueskyActors': {
			const qs: IDataObject = { user, q: requireStr(ctx, 'blueskyQuery', 'Search Query') };
			putFilled(ctx, qs, BLUESKY_PAGING);
			return request('GET', `${BS}/search/actors`, qs);
		}
		case 'listBlueskyDrafts': {
			const qs: IDataObject = { user };
			putFilled(ctx, qs, BLUESKY_PAGING);
			return request('GET', `${BS}/drafts`, qs);
		}
		case 'createBlueskyDraft': {
			const body: IDataObject = { user };
			const posts = parseJson(ctx, param(ctx, 'blueskyDraftPosts', ''), 'Draft Posts');
			if (posts !== undefined) {
				if (!Array.isArray(posts)) fail(ctx, 'Draft Posts must be a JSON array of posts');
				body.posts = posts as IDataObject[];
			} else {
				putFilled(ctx, body, [['blueskyDraftText', 'text']]);
			}
			if (!body.posts && !body.text) fail(ctx, 'Set Draft Text or Draft Posts');
			putFilled(ctx, body, [['blueskyDraftLangs', 'langs'], ['blueskyDraftReplySettings', 'reply_settings']]);
			return request('POST', `${BS}/drafts`, body);
		}
		case 'deleteBlueskyDraft': {
			const draftId = encodeURIComponent(requireStr(ctx, 'blueskyDraftId', 'Draft ID'));
			const body: IDataObject = { user };
			if (bool(ctx, 'blueskyConfirm')) body.confirm = true;
			return request('DELETE', `${BS}/drafts/${draftId}`, body);
		}
	}
	return fail(ctx, `Unsupported Bluesky operation: ${ctx.operation}`);
};

const GB = '/uploadposts/google-business';
const GBP_PAGING: Array<[string, string]> = [['gbpApiPageSize', 'page_size'], ['gbpApiPageCursor', 'page_token']];

const buildGoogleBusinessRequest = (ctx: NetworkContext, user: string): NetworkRequest => {
	const located = (): IDataObject => {
		const payload: IDataObject = { user };
		putFilled(ctx, payload, [['gbpApiLocationId', 'location_id']]);
		return payload;
	};
	switch (ctx.operation) {
		case 'listGbpPosts': {
			const qs = located();
			putFilled(ctx, qs, GBP_PAGING);
			return request('GET', `${GB}/posts`, qs);
		}
		case 'getGbpPost':
			return request('GET', `${GB}/posts/get`, { user, post_id: requireStr(ctx, 'gbpApiPostId', 'Post ID') });
		case 'listGbpReviews': {
			const qs = located();
			putFilled(ctx, qs, [...GBP_PAGING, ['gbpApiOrderBy', 'order_by']]);
			return request('GET', `${GB}/reviews`, qs);
		}
		case 'getGbpReview':
			return request('GET', `${GB}/reviews/get`, { user, review_name: requireStr(ctx, 'gbpApiReviewName', 'Review Name') });
		case 'getGbpPerformance': {
			const qs = located();
			putFilled(ctx, qs, [['gbpApiMetrics', 'metrics'], ['gbpApiStartDate', 'start_date'], ['gbpApiEndDate', 'end_date']]);
			return request('GET', `${GB}/performance`, qs);
		}
		case 'getGbpSearchKeywords': {
			const qs = located();
			putFilled(ctx, qs, [['gbpApiStartMonth', 'start_month'], ['gbpApiEndMonth', 'end_month'], ...GBP_PAGING]);
			return request('GET', `${GB}/performance/keywords`, qs);
		}
		case 'getGbpLocationInfo': {
			const qs = located();
			putFilled(ctx, qs, [['gbpApiReadMask', 'read_mask']]);
			return request('GET', `${GB}/location-info`, qs);
		}
		case 'updateGbpLocationInfo': {
			const body = located();
			const mode = str(ctx, 'gbpApiEditMode') || 'legacy';
			body.edit_mode = mode;
			putFilled(ctx, body, [['gbpApiDescription', 'description'], ['gbpApiWebsite', 'website'], ['gbpApiPhone', 'phone']]);
			if (bool(ctx, 'gbpApiValidateOnly')) body.validate_only = true;
			if (mode === 'strict') {
				if (bool(ctx, 'gbpApiDryRun')) body.dry_run = true;
				if (bool(ctx, 'googleBusinessConfirm')) body.confirm = true;
			}
			Object.assign(body, jsonObjectParam(ctx, 'googleBusinessExtraFields', 'Extra Fields (JSON)'));
			return request('PATCH', `${GB}/location-info`, body);
		}
	}
	return fail(ctx, `Unsupported Google Business operation: ${ctx.operation}`);
};

export const buildNetworkRequest = (
	node: IExecuteFunctions,
	itemIndex: number,
	resource: string,
	operation: string,
): NetworkRequest => {
	const ctx: NetworkContext = { node, itemIndex, operation };
	const profile = requireStr(ctx, 'networkProfile', 'Profile');
	if (resource === 'queue') return buildQueueRequest(ctx, profile);
	if (resource === 'telegram') return buildTelegramRequest(ctx, profile);
	if (resource === 'bluesky') return buildBlueskyRequest(ctx, profile);
	return buildGoogleBusinessRequest(ctx, profile);
};
