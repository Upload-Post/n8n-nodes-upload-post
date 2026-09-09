import { Buffer } from 'buffer';
import {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	NodeConnectionType,
	NodeOperationError,
	sleep
} from 'n8n-workflow';

const MANUAL_USER_VALUE = '__manual_user__';
const MANUAL_FACEBOOK_VALUE = '__manual_facebook__';
const MANUAL_LINKEDIN_VALUE = '__manual_linkedin__';
const MANUAL_PINTEREST_VALUE = '__manual_pinterest__';
const MANUAL_PLATFORM_VALUE = '__manual_platform__';

type BinaryFormField = {
	value: Buffer | string;
	options?: {
		filename?: string;
		contentType?: string;
	};
};

declare const FormData:
	| undefined
	| {
			new (): {
				append(name: string, value: any, options?: { filename?: string; contentType?: string } | string): void;
			};
	  };

declare const Blob:
	| undefined
	| {
			new (blobParts?: any[], options?: { type?: string }): any;
	  };

type NativeFormData = {
	append(name: string, value: any, options?: { filename?: string; contentType?: string } | string): void;
};
const isBinaryFormField = (value: unknown): value is BinaryFormField => {
	return typeof value === 'object' && value !== null && 'value' in (value as Record<string, unknown>);
};

const isUrlString = (value: unknown): boolean => {
	if (typeof value !== 'string') return false;
	const lower = value.toLowerCase();
	return lower.startsWith('http://') || lower.startsWith('https://');
};

const normalizeFormField = (value: unknown): string | BinaryFormField | undefined => {
	if (value === undefined || value === null) {
		return undefined;
	}
	if (isBinaryFormField(value)) {
		return value;
	}
	return String(value);
};

type MultipartValue = string | BinaryFormField;
type MultipartPayload = Record<string, MultipartValue | MultipartValue[]>;

const buildMultipartPayload = (rawFormData: IDataObject): MultipartPayload => {
	const payload: MultipartPayload = {};
	for (const [key, rawValue] of Object.entries(rawFormData)) {
		if (rawValue === undefined || rawValue === null) continue;
		if (Array.isArray(rawValue)) {
			const normalizedItems = rawValue
				.map(item => normalizeFormField(item))
				.filter((item): item is string | BinaryFormField => item !== undefined);
			if (normalizedItems.length > 0) {
				payload[key] = normalizedItems;
			}
			continue;
		}
		const normalizedValue = normalizeFormField(rawValue);
		if (normalizedValue !== undefined) {
			payload[key] = normalizedValue;
		}
	}
	return payload;
};

const parseJsonIfNeeded = (data: any): any => {
	if (typeof data === 'string') {
		try {
			return JSON.parse(data);
		} catch {
			return data;
		}
	}
	return data;
};

const API_BASE_URL = 'https://api.upload-post.com/api';

type UploadOperation = 'uploadPhotos' | 'uploadVideo' | 'uploadText' | 'uploadDocument';

type RequestMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

type RequestConfig = {
	endpoint: string;
	method: RequestMethod;
	formData?: IDataObject;
	body?: IDataObject;
	qs?: IDataObject;
	headers?: IDataObject;
	isUploadOperation: boolean;
	waitForCompletion: boolean;
	pollInterval?: number;
	pollTimeout?: number;
	// Validate JWT authenticates with the profile token, not the API key, so the
	// credential's Authorization header must not overwrite it.
	skipCredentialAuth?: boolean;
};

type ExecutionContext = {
	node: IExecuteFunctions;
	items: INodeExecutionData[];
	itemIndex: number;
	operation: string;
};

type UploadPreparation = {
	formData: IDataObject;
	platforms: string[];
	waitForCompletion: boolean;
	pollInterval: number;
	pollTimeout: number;
};

const normalizeDateInput = (value: string | undefined): string | undefined => {
	if (!value) return undefined;
	const hasTimezone = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(value);
	return hasTimezone ? value : `${value}Z`;
};

const ensureArrayFromCommaSeparated = (value: string): string[] => {
	return value
		.split(',')
		.map(item => item.trim())
		.filter(item => item.length > 0);
};

// Statuses after which /uploadposts/status will not change on its own. Anything
// else (queued, pending, processing, in_progress) means the job is still moving.
const TERMINAL_UPLOAD_STATUSES = ['completed', 'failed', 'error', 'retryable', 'scheduled', 'not_found'];

// The API deduplicates an upload when the same idempotency key arrives twice within 24h.
// The key must survive an n8n "Retry On Fail", otherwise a retried upload posts twice.
// Execution id, node id and item index are all stable across a node-level retry.
// The API shallow-merges the notification payload, so toggling the webhook
// channel would drop telegram/slack/whatsapp unless we resend them.
const fetchNotificationChannels = async (ctx: ExecutionContext): Promise<IDataObject> => {
	try {
		const current = await ctx.node.helpers.httpRequestWithAuthentication.call(ctx.node, 'uploadPostApi', {
			url: `${API_BASE_URL}/uploadposts/users/notifications`,
			method: 'GET',
			json: true,
		});
		const channels = ((current as IDataObject)?.notifications as IDataObject)?.channels;
		return (channels as IDataObject) ?? {};
	} catch {
		return {};
	}
};

const buildIdempotencyKey = (ctx: ExecutionContext): string => {
	const override = String(ctx.node.getNodeParameter('idempotencyKey', ctx.itemIndex, '') ?? '').trim();
	if (override) {
		return override;
	}
	return `n8n:${ctx.node.getExecutionId()}:${ctx.node.getNode().id}:${ctx.itemIndex}`;
};

const getBinaryFieldFromItem = async (
	ctx: ExecutionContext,
	propertyName: string,
	errorLabel: string,
): Promise<BinaryFormField> => {
	const { node, itemIndex, items } = ctx;
	try {
		const binaryBuffer = await node.helpers.getBinaryDataBuffer(itemIndex, propertyName);
		const binaryDetails = items[itemIndex].binary?.[propertyName];
		return {
			value: binaryBuffer,
			options: {
				filename: binaryDetails?.fileName ?? propertyName,
				contentType: binaryDetails?.mimeType,
			},
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : '';
		const details = message ? ` (${message})` : '';
		throw new NodeOperationError(node.getNode(), `${errorLabel} '${propertyName}' was not found in item ${itemIndex}.${details}`, {
			itemIndex,
		});
	}
};

const PLATFORM_SUPPORT: Record<UploadOperation, string[]> = {
	uploadPhotos: ['bluesky', 'discord', 'facebook', 'instagram', 'linkedin', 'pinterest', 'telegram', 'threads', 'tiktok', 'x', 'reddit', 'google_business', 'mastodon', 'lemmy', 'wordpress'],
	uploadVideo: ['bluesky', 'discord', 'facebook', 'instagram', 'linkedin', 'pinterest', 'reddit', 'telegram', 'threads', 'tiktok', 'x', 'youtube', 'google_business', 'mastodon', 'wordpress'],
	uploadText: ['bluesky', 'discord', 'facebook', 'linkedin', 'reddit', 'telegram', 'threads', 'x', 'google_business', 'slack', 'mastodon', 'nostr', 'lemmy', 'devto', 'hashnode', 'wordpress', 'whop', 'listmonk'],
	uploadDocument: ['linkedin'],
};

const DESCRIPTION_ENABLED_PLATFORMS = new Set(['linkedin', 'facebook', 'youtube', 'pinterest', 'tiktok']);

const TITLE_OVERRIDES: Array<{
	platform: string;
	param: string;
	field: string;
	operations?: UploadOperation[];
}> = [
	{ platform: 'bluesky', param: 'blueskyTitle', field: 'bluesky_title' },
	{ platform: 'instagram', param: 'instagramTitle', field: 'instagram_title' },
	{ platform: 'facebook', param: 'facebookTitle', field: 'facebook_title' },
	{ platform: 'tiktok', param: 'tiktokTitle', field: 'tiktok_title' },
	{ platform: 'linkedin', param: 'linkedinTitle', field: 'linkedin_title' },
	{ platform: 'x', param: 'xTitle', field: 'x_title' },
	{ platform: 'youtube', param: 'youtubeTitle', field: 'youtube_title', operations: ['uploadVideo'] },
	{ platform: 'pinterest', param: 'pinterestTitle', field: 'pinterest_title' },
	{ platform: 'threads', param: 'threadsTitle', field: 'threads_title' },
	{ platform: 'slack', param: 'slackTitle', field: 'slack_title' },
	{ platform: 'mastodon', param: 'mastodonTitle', field: 'mastodon_title' },
	{ platform: 'nostr', param: 'nostrTitle', field: 'nostr_title' },
	{ platform: 'lemmy', param: 'lemmyTitle', field: 'lemmy_title' },
	{ platform: 'devto', param: 'devtoTitle', field: 'devto_title' },
	{ platform: 'hashnode', param: 'hashnodeTitle', field: 'hashnode_title' },
	{ platform: 'wordpress', param: 'wordpressTitle', field: 'wordpress_title' },
	{ platform: 'whop', param: 'whopTitle', field: 'whop_title' },
	{ platform: 'listmonk', param: 'listmonkTitle', field: 'listmonk_title' },
];

const DESCRIPTION_OVERRIDES: Array<{
	platform: string;
	param: string;
	field: string;
	operations?: UploadOperation[];
}> = [
	{ platform: 'linkedin', param: 'linkedinDescription', field: 'linkedin_description', operations: ['uploadPhotos', 'uploadVideo'] },
	{ platform: 'youtube', param: 'youtubeDescription', field: 'youtube_description', operations: ['uploadVideo'] },
	{ platform: 'facebook', param: 'facebookDescription', field: 'facebook_description', operations: ['uploadPhotos', 'uploadVideo'] },
	{ platform: 'tiktok', param: 'tiktokDescription', field: 'tiktok_description', operations: ['uploadPhotos'] },
	{ platform: 'pinterest', param: 'pinterestDescription', field: 'pinterest_description', operations: ['uploadPhotos', 'uploadVideo'] },
];

const FIRST_COMMENT_OVERRIDES: Array<{
	platform: string;
	param: string;
	field: string;
	operations?: UploadOperation[];
}> = [
	{ platform: 'instagram', param: 'instagramFirstComment', field: 'instagram_first_comment' },
	{ platform: 'facebook', param: 'facebookFirstComment', field: 'facebook_first_comment' },
	{ platform: 'x', param: 'xFirstComment', field: 'x_first_comment' },
	{ platform: 'threads', param: 'threadsFirstComment', field: 'threads_first_comment' },
	{ platform: 'youtube', param: 'youtubeFirstComment', field: 'youtube_first_comment', operations: ['uploadVideo'] },
	{ platform: 'reddit', param: 'redditFirstComment', field: 'reddit_first_comment' },
	{ platform: 'bluesky', param: 'blueskyFirstComment', field: 'bluesky_first_comment' },
	{ platform: 'linkedin', param: 'linkedinFirstComment', field: 'linkedin_first_comment' },
	// TikTok has no text posts, so the override only makes sense on media uploads.
	{ platform: 'tiktok', param: 'tiktokFirstComment', field: 'tiktok_first_comment', operations: ['uploadPhotos', 'uploadVideo'] },
];

const getFilteredPlatforms = (operation: UploadOperation, platforms: string[]): string[] => {
	const allowed = PLATFORM_SUPPORT[operation] ?? [];
	return platforms.filter(platform => allowed.includes(platform));
};

const applyTitleOverrides = (ctx: ExecutionContext, operation: UploadOperation, platforms: string[], formData: IDataObject) => {
	for (const override of TITLE_OVERRIDES) {
		if (!platforms.includes(override.platform)) continue;
		if (override.operations && !override.operations.includes(operation)) continue;
		const value = ctx.node.getNodeParameter(override.param, ctx.itemIndex, '') as string;
		if (value) {
			formData[override.field] = value;
		}
	}
};

const applyDescriptionOverrides = (ctx: ExecutionContext, operation: UploadOperation, platforms: string[], formData: IDataObject) => {
	const genericDescription = ctx.node.getNodeParameter('description', ctx.itemIndex, '') as string;
	if (
		genericDescription &&
		(operation === 'uploadPhotos' || operation === 'uploadVideo') &&
		platforms.some(platform => DESCRIPTION_ENABLED_PLATFORMS.has(platform))
	) {
		formData.description = genericDescription;
	}

	for (const override of DESCRIPTION_OVERRIDES) {
		if (!platforms.includes(override.platform)) continue;
		if (override.operations && !override.operations.includes(operation)) continue;
		const value = ctx.node.getNodeParameter(override.param, ctx.itemIndex, '') as string;
		if (value) {
			formData[override.field] = value;
		}
	}
};

const applyFirstCommentOverrides = (ctx: ExecutionContext, operation: UploadOperation, platforms: string[], formData: IDataObject) => {
	for (const override of FIRST_COMMENT_OVERRIDES) {
		if (!platforms.includes(override.platform)) continue;
		if (override.operations && !override.operations.includes(operation)) continue;
		const value = ctx.node.getNodeParameter(override.param, ctx.itemIndex, '') as string;
		if (value) {
			formData[override.field] = value;
		}
	}
};

const getUserForOperation = (ctx: ExecutionContext, needsUser: boolean): string => {
	if (!needsUser) {
		return '';
	}
	const selection = ctx.node.getNodeParameter('user', ctx.itemIndex) as string;
	if (selection === MANUAL_USER_VALUE) {
		return ctx.node.getNodeParameter('userManual', ctx.itemIndex) as string;
	}
	return selection;
};

const prepareUploadBase = (ctx: ExecutionContext, operation: UploadOperation): UploadPreparation => {
	const formData: IDataObject = {};
	const user = getUserForOperation(ctx, true);
	const title = ctx.node.getNodeParameter('title', ctx.itemIndex, '') as string;
	formData.user = user;
	if (title) formData.title = title;

	const firstComment = ctx.node.getNodeParameter('firstComment', ctx.itemIndex, '') as string;
	if (firstComment) {
		formData.first_comment = firstComment;
	}

	const firstCommentMedia = ctx.node.getNodeParameter('firstCommentMedia', ctx.itemIndex, '') as string;
	if (firstCommentMedia) {
		formData['first_comment_media[]'] = ensureArrayFromCommaSeparated(firstCommentMedia);
	}

	const replyToId = ctx.node.getNodeParameter('replyToId', ctx.itemIndex, '') as string;
	if (replyToId) {
		formData.reply_to_id = replyToId;
	}

	const altText = ctx.node.getNodeParameter('altText', ctx.itemIndex, '') as string;
	if (altText) {
		formData.alt_text = altText;
	}

	const scheduledDate = normalizeDateInput(ctx.node.getNodeParameter('scheduledDate', ctx.itemIndex, '') as string);
	if (scheduledDate) {
		formData.scheduled_date = scheduledDate;
	}

	const timezone = ctx.node.getNodeParameter("timezone", ctx.itemIndex, "") as string;
	if (timezone) {
		formData.timezone = timezone;
	}

	const addToQueue = ctx.node.getNodeParameter('addToQueue', ctx.itemIndex, false) as boolean;
	if (addToQueue) {
		formData.add_to_queue = 'true';
		const maxPostsPerSlot = ctx.node.getNodeParameter('maxPostsPerSlot', ctx.itemIndex, 0) as number;
		if (maxPostsPerSlot > 0) {
			formData.max_posts_per_slot = String(maxPostsPerSlot);
		}
	}

	const uploadAsync = ctx.node.getNodeParameter('uploadAsync', ctx.itemIndex) as boolean;
	formData.async_upload = String(uploadAsync);

	const rawPlatforms = ctx.node.getNodeParameter('platform', ctx.itemIndex) as string[];
	const platforms = getFilteredPlatforms(operation, Array.isArray(rawPlatforms) ? rawPlatforms : []);
	formData['platform[]'] = platforms;

	applyTitleOverrides(ctx, operation, platforms, formData);
	applyDescriptionOverrides(ctx, operation, platforms, formData);
	applyFirstCommentOverrides(ctx, operation, platforms, formData);

	const waitForCompletion = ctx.node.getNodeParameter('waitForCompletion', ctx.itemIndex, false) as boolean;
	const pollInterval = ctx.node.getNodeParameter('pollInterval', ctx.itemIndex, 10) as number;
	const pollTimeout = ctx.node.getNodeParameter('pollTimeout', ctx.itemIndex, 600) as number;

	return {
		formData,
		platforms,
		waitForCompletion,
		pollInterval,
		pollTimeout,
	};
};

const applyPinterestOptions = (ctx: ExecutionContext, operation: UploadOperation, formData: IDataObject, isManualPlatform = false) => {
	let pinterestBoardId = '';
	if (isManualPlatform) {
		pinterestBoardId = ctx.node.getNodeParameter('pinterestBoardIdManualEntry', ctx.itemIndex, '') as string;
	} else {
		const selection = ctx.node.getNodeParameter('pinterestBoardId', ctx.itemIndex, '') as string;
		pinterestBoardId =
			selection === MANUAL_PINTEREST_VALUE
				? (ctx.node.getNodeParameter('pinterestBoardIdManual', ctx.itemIndex) as string)
				: selection;
	}
	if (pinterestBoardId) {
		formData.pinterest_board_id = pinterestBoardId;
	}
	const pinterestAltText = ctx.node.getNodeParameter('pinterestAltText', ctx.itemIndex, '') as string;
	if (pinterestAltText) {
		formData.pinterest_alt_text = pinterestAltText;
	}
	const pinterestLink = ctx.node.getNodeParameter('pinterestLink', ctx.itemIndex, '') as string;
	if (pinterestLink) {
		formData.pinterest_link = pinterestLink;
	}
	const pinterestBoardSectionId = ctx.node.getNodeParameter('pinterestBoardSectionId', ctx.itemIndex, '') as string;
	if (pinterestBoardSectionId) {
		formData.pinterest_board_section_id = pinterestBoardSectionId;
	}
	if (operation === 'uploadVideo') {
		const pinterestCoverImageUrl = ctx.node.getNodeParameter('pinterestCoverImageUrl', ctx.itemIndex, '') as string;
		const pinterestCoverImageContentType = ctx.node.getNodeParameter('pinterestCoverImageContentType', ctx.itemIndex, '') as string;
		const pinterestCoverImageData = ctx.node.getNodeParameter('pinterestCoverImageData', ctx.itemIndex, '') as string;
		const pinterestCoverImageKeyFrameTime = ctx.node.getNodeParameter('pinterestCoverImageKeyFrameTime', ctx.itemIndex, 0) as number;
		if (pinterestCoverImageUrl) {
			formData.pinterest_cover_image_url = pinterestCoverImageUrl;
		} else if (pinterestCoverImageContentType && pinterestCoverImageData) {
			formData.pinterest_cover_image_content_type = pinterestCoverImageContentType;
			formData.pinterest_cover_image_data = pinterestCoverImageData;
		} else if (pinterestCoverImageKeyFrameTime !== undefined) {
			formData.pinterest_cover_image_key_frame_time = pinterestCoverImageKeyFrameTime;
		}
		if (pinterestLink) {
			formData.pinterest_link = pinterestLink;
		}
	}
};

const applyLinkedinOptions = (ctx: ExecutionContext, operation: UploadOperation, formData: IDataObject, isManualPlatform = false) => {
	let resolvedValue = '';
	if (isManualPlatform) {
		resolvedValue = ctx.node.getNodeParameter('targetLinkedinPageIdManualEntry', ctx.itemIndex, '') as string;
	} else {
		const selection = ctx.node.getNodeParameter('targetLinkedinPageId', ctx.itemIndex, '') as string;
		resolvedValue =
			selection === MANUAL_LINKEDIN_VALUE
				? (ctx.node.getNodeParameter('targetLinkedinPageIdManual', ctx.itemIndex) as string)
				: selection;
	}
	if (resolvedValue && resolvedValue !== 'me') {
		const match = resolvedValue.match(/(\d+)$/);
		formData.target_linkedin_page_id = match ? match[1] : resolvedValue;
	}
	if (operation === 'uploadPhotos') {
		const linkedinVisibility = ctx.node.getNodeParameter('linkedinVisibility', ctx.itemIndex, 'PUBLIC') as string;
		if (linkedinVisibility === 'PUBLIC') {
			formData.visibility = 'PUBLIC';
		}
	} else if (operation === 'uploadVideo') {
		const linkedinVisibility = ctx.node.getNodeParameter('linkedinVisibility', ctx.itemIndex, 'PUBLIC') as string;
		formData.visibility = linkedinVisibility;
	} else if (operation === 'uploadText') {
		const linkedinLink = ctx.node.getNodeParameter('linkedinLink', ctx.itemIndex, '') as string;
		if (linkedinLink) {
			formData.linkedin_link_url = linkedinLink;
		}
	}

	const linkedinAltText = ctx.node.getNodeParameter('linkedinAltText', ctx.itemIndex, '') as string;
	if (linkedinAltText) formData.linkedin_alt_text = linkedinAltText;
	const linkedinDisableReshare = ctx.node.getNodeParameter('linkedinDisableReshare', ctx.itemIndex, false) as boolean;
	if (linkedinDisableReshare) formData.linkedin_disable_reshare = 'true';
	const linkedinLinkTitle = ctx.node.getNodeParameter('linkedinLinkTitle', ctx.itemIndex, '') as string;
	if (linkedinLinkTitle) formData.linkedin_link_title = linkedinLinkTitle;
	const linkedinLinkDescription = ctx.node.getNodeParameter('linkedinLinkDescription', ctx.itemIndex, '') as string;
	if (linkedinLinkDescription) formData.linkedin_link_description = linkedinLinkDescription;

	if (operation === 'uploadDocument') {
		const linkedinVisibility = ctx.node.getNodeParameter('linkedinVisibility', ctx.itemIndex, 'PUBLIC') as string;
		formData.visibility = linkedinVisibility;
		const documentDescription = ctx.node.getNodeParameter('documentDescription', ctx.itemIndex, '') as string;
		if (documentDescription) {
			formData.description = documentDescription;
		}
	}
};

const applyFacebookOptions = (ctx: ExecutionContext, operation: UploadOperation, formData: IDataObject, isManualPlatform = false) => {
	let resolvedValue = '';
	if (isManualPlatform) {
		resolvedValue = ctx.node.getNodeParameter('facebookPageIdManualEntry', ctx.itemIndex, '') as string;
	} else {
		const selection = ctx.node.getNodeParameter('facebookPageId', ctx.itemIndex) as string;
		resolvedValue =
			selection === MANUAL_FACEBOOK_VALUE
				? (ctx.node.getNodeParameter('facebookPageIdManual', ctx.itemIndex) as string)
				: selection;
	}
	if (resolvedValue) formData.facebook_page_id = resolvedValue;

	if (operation === 'uploadVideo') {
		const facebookVideoState = ctx.node.getNodeParameter('facebookVideoState', ctx.itemIndex, '') as string;
		const facebookMediaType = ctx.node.getNodeParameter('facebookMediaType', ctx.itemIndex, '') as string;
		if (facebookVideoState) {
			formData.video_state = facebookVideoState;
		}
		if (facebookMediaType) {
			formData.facebook_media_type = facebookMediaType;
		}
		if (facebookMediaType === 'VIDEO') {
			const facebookThumbnailUrl = ctx.node.getNodeParameter('facebookThumbnailUrl', ctx.itemIndex, '') as string;
			if (facebookThumbnailUrl) {
				formData.thumbnail_url = facebookThumbnailUrl;
			}
		}
	} else if (operation === 'uploadPhotos') {
		const facebookMediaTypePhoto = ctx.node.getNodeParameter('facebookMediaTypePhoto', ctx.itemIndex, 'POSTS') as string;
		if (facebookMediaTypePhoto && facebookMediaTypePhoto !== 'POSTS') {
			formData.facebook_media_type = facebookMediaTypePhoto;
		}
	} else if (operation === 'uploadText') {
		const facebookLink = ctx.node.getNodeParameter('facebookLink', ctx.itemIndex, '') as string;
		if (facebookLink) {
			formData.facebook_link_url = facebookLink;
		}
		const facebookCallToAction = ctx.node.getNodeParameter('facebookCallToAction', ctx.itemIndex, '') as string;
		if (facebookCallToAction) formData.facebook_call_to_action = facebookCallToAction;
	}

	const facebookPlaceId = ctx.node.getNodeParameter('facebookPlaceId', ctx.itemIndex, '') as string;
	if (facebookPlaceId) formData.facebook_place_id = facebookPlaceId;
	if (operation === 'uploadPhotos') {
		const facebookAltText = ctx.node.getNodeParameter('facebookAltText', ctx.itemIndex, '') as string;
		if (facebookAltText) formData.facebook_alt_text = facebookAltText;
	}
	if (operation === 'uploadVideo') {
		const facebookIsAiGenerated = ctx.node.getNodeParameter('facebookIsAiGenerated', ctx.itemIndex, false) as boolean;
		if (facebookIsAiGenerated) formData.facebook_is_ai_generated = 'true';
	}
};

// TikTok fields shared by video and photo posts: the track id, the location pair
// and the AI disclosure. Only these three — the volume/trim, cover-image and
// draft fields are video-only, because TikTok's photo contract takes the track
// id alone.
const applySharedTiktokFields = (ctx: ExecutionContext, formData: IDataObject) => {
	const musicId = ctx.node.getNodeParameter('tiktokMusicId', ctx.itemIndex, '') as string;
	if (musicId) formData.tiktok_music_id = musicId;

	const locationId = ctx.node.getNodeParameter('tiktokLocationId', ctx.itemIndex, '') as string;
	const locationName = ctx.node.getNodeParameter('tiktokLocationName', ctx.itemIndex, '') as string;
	// TikTok rejects a location id without its name, and answers with a hard error
	// instead of dropping the tag — so send the pair or neither.
	if (locationId && locationName) {
		formData.tiktok_location_id = locationId;
		formData.tiktok_location_name = locationName;
	}

	const isAiGenerated = ctx.node.getNodeParameter('tiktokIsAiGenerated', ctx.itemIndex, false) as boolean;
	if (isAiGenerated) formData.tiktok_is_ai_generated = 'true';
};

const applyTiktokOptions = (ctx: ExecutionContext, operation: UploadOperation, formData: IDataObject) => {
	if (operation === 'uploadPhotos') {
		const autoAddMusic = ctx.node.getNodeParameter('tiktokAutoAddMusic', ctx.itemIndex, false) as boolean;
		const disableComment = ctx.node.getNodeParameter('tiktokDisableComment', ctx.itemIndex, false) as boolean;
		const brandContentToggle = ctx.node.getNodeParameter('brand_content_toggle', ctx.itemIndex, false) as boolean;
		const brandOrganicToggle = ctx.node.getNodeParameter('brand_organic_toggle', ctx.itemIndex, false) as boolean;
		const photoCoverIndex = ctx.node.getNodeParameter('tiktokPhotoCoverIndex', ctx.itemIndex, 0) as number;
		const photoDescription = ctx.node.getNodeParameter('tiktokPhotoDescription', ctx.itemIndex, '') as string;

		formData.auto_add_music = String(autoAddMusic);
		formData.disable_comment = String(disableComment);
		formData.brand_content_toggle = String(brandContentToggle);
		formData.brand_organic_toggle = String(brandOrganicToggle);
		formData.photo_cover_index = photoCoverIndex;
		if (photoDescription && formData.description === undefined) {
			formData.description = photoDescription;
		}

		applySharedTiktokFields(ctx, formData);
	} else if (operation === 'uploadVideo') {
		const privacyLevel = ctx.node.getNodeParameter('tiktokPrivacyLevel', ctx.itemIndex, '') as string;
		const disableDuet = ctx.node.getNodeParameter('tiktokDisableDuet', ctx.itemIndex, false) as boolean;
		const disableComment = ctx.node.getNodeParameter('tiktokDisableComment', ctx.itemIndex, false) as boolean;
		const disableStitch = ctx.node.getNodeParameter('tiktokDisableStitch', ctx.itemIndex, false) as boolean;
		const coverTimestamp = ctx.node.getNodeParameter('tiktokCoverTimestamp', ctx.itemIndex, 1000) as number;
		const brandContentToggle = ctx.node.getNodeParameter('brand_content_toggle', ctx.itemIndex, false) as boolean;
		const brandOrganicToggle = ctx.node.getNodeParameter('brand_organic_toggle', ctx.itemIndex, false) as boolean;
		const isAigc = ctx.node.getNodeParameter('tiktokIsAigc', ctx.itemIndex, false) as boolean;
		const postMode = ctx.node.getNodeParameter('tiktokPostMode', ctx.itemIndex, '') as string;

		if (privacyLevel) formData.privacy_level = privacyLevel;
		formData.disable_duet = String(disableDuet);
		formData.disable_comment = String(disableComment);
		formData.disable_stitch = String(disableStitch);
		formData.cover_timestamp = coverTimestamp;
		formData.brand_content_toggle = String(brandContentToggle);
		formData.brand_organic_toggle = String(brandOrganicToggle);
		formData.is_aigc = String(isAigc);
		if (postMode) formData.post_mode = postMode;

		// Capability-gated TikTok options. Only sent when actually configured: a
		// connection without the matching capability ignores them (with a warning),
		// and sending the defaults unconditionally would attach music/covers nobody
		// asked for.
		applySharedTiktokFields(ctx, formData);

		// Video-only mixing controls, meaningless without a track.
		if (formData.tiktok_music_id) {
			formData.tiktok_music_volume = ctx.node.getNodeParameter('tiktokMusicVolume', ctx.itemIndex, 50) as number;
			formData.tiktok_original_sound_volume = ctx.node.getNodeParameter('tiktokOriginalSoundVolume', ctx.itemIndex, 50) as number;

			const musicStart = ctx.node.getNodeParameter('tiktokMusicStart', ctx.itemIndex, 0) as number;
			const musicEnd = ctx.node.getNodeParameter('tiktokMusicEnd', ctx.itemIndex, 0) as number;
			if (musicStart > 0) formData.tiktok_music_start = musicStart;
			if (musicEnd > 0) formData.tiktok_music_end = musicEnd;
		}

		const coverImageUrl = ctx.node.getNodeParameter('tiktokCoverImageUrl', ctx.itemIndex, '') as string;
		if (coverImageUrl) formData.tiktok_cover_image_url = coverImageUrl;

		const uploadToDraft = ctx.node.getNodeParameter('tiktokUploadToDraft', ctx.itemIndex, false) as boolean;
		if (uploadToDraft) formData.tiktok_upload_to_draft = 'true';

		const isAdsOnly = ctx.node.getNodeParameter('tiktokIsAdsOnly', ctx.itemIndex, false) as boolean;
		if (isAdsOnly) formData.tiktok_is_ads_only = 'true';
		const ttoInviteLink = ctx.node.getNodeParameter('tiktokTtoInviteLink', ctx.itemIndex, '') as string;
		if (ttoInviteLink) formData.tiktok_tto_invite_link = ttoInviteLink;
	}
};

const applyInstagramOptions = async (ctx: ExecutionContext, operation: UploadOperation, formData: IDataObject) => {
	const providedMediaType = ctx.node.getNodeParameter('instagramMediaType', ctx.itemIndex, '') as string;
	let finalMediaType = providedMediaType;
	if (operation === 'uploadPhotos') {
		if (!['IMAGE', 'STORIES'].includes(providedMediaType)) {
			finalMediaType = 'IMAGE';
		}
	} else if (operation === 'uploadVideo') {
		if (!['REELS', 'STORIES'].includes(providedMediaType)) {
			finalMediaType = 'REELS';
		}
	}
	if (finalMediaType) {
		formData.media_type = finalMediaType;
	}

	if (['uploadVideo', 'uploadPhotos'].includes(operation)) {
		const collaborators = ctx.node.getNodeParameter('instagramCollaborators', ctx.itemIndex, '') as string;
		const userTags = ctx.node.getNodeParameter('instagramUserTags', ctx.itemIndex, '') as string;
		const locationId = ctx.node.getNodeParameter('instagramLocationId', ctx.itemIndex, '') as string;

		if (collaborators) formData.collaborators = collaborators;
		if (userTags) formData.user_tags = userTags;
		if (locationId) formData.location_id = locationId;
	}

	if (operation === 'uploadVideo') {
		const shareToFeed = ctx.node.getNodeParameter('instagramShareToFeed', ctx.itemIndex, true) as boolean;
		const coverUrl = ctx.node.getNodeParameter('instagramCoverUrl', ctx.itemIndex, '') as string;
		const audioName = ctx.node.getNodeParameter('instagramAudioName', ctx.itemIndex, '') as string;
		const thumbOffset = ctx.node.getNodeParameter('instagramThumbOffset', ctx.itemIndex, '') as string;
		const shareMode = ctx.node.getNodeParameter('instagramShareMode', ctx.itemIndex, 'CUSTOM') as string;

		formData.share_to_feed = String(shareToFeed);
		if (shareMode && shareMode !== 'CUSTOM') {
			formData.share_mode = shareMode;
		}
		if (coverUrl) {
			if (isUrlString(coverUrl)) {
				formData.cover_url = coverUrl;
			} else {
				const coverBinary = await getBinaryFieldFromItem(ctx, coverUrl, 'Binary data for Instagram cover property');
				formData.cover_image = coverBinary;
			}
		}
		if (audioName) formData.audio_name = audioName;
		if (thumbOffset) formData.thumb_offset = thumbOffset;
	}

	if (operation === 'uploadPhotos') {
		const instagramAltText = ctx.node.getNodeParameter('instagramAltText', ctx.itemIndex, '') as string;
		if (instagramAltText) formData.instagram_alt_text = instagramAltText;
	}
};

const applyYoutubeOptions = async (ctx: ExecutionContext, formData: IDataObject) => {
	const tagsRaw = ctx.node.getNodeParameter('youtubeTags', ctx.itemIndex, '') as string;
	const categoryId = ctx.node.getNodeParameter('youtubeCategoryId', ctx.itemIndex, '') as string;
	const privacyStatus = ctx.node.getNodeParameter('youtubePrivacyStatus', ctx.itemIndex, '') as string;
	const embeddable = ctx.node.getNodeParameter('youtubeEmbeddable', ctx.itemIndex, true) as boolean;
	const license = ctx.node.getNodeParameter('youtubeLicense', ctx.itemIndex, '') as string;
	const publicStatsViewable = ctx.node.getNodeParameter('youtubePublicStatsViewable', ctx.itemIndex, true) as boolean;
	const thumbnailInput = ctx.node.getNodeParameter('youtubeThumbnail', ctx.itemIndex, '') as string;

	if (tagsRaw) formData['tags[]'] = ensureArrayFromCommaSeparated(tagsRaw);
	if (categoryId) formData.categoryId = categoryId;
	if (privacyStatus) formData.privacyStatus = privacyStatus;
	formData.embeddable = String(embeddable);
	if (license) formData.license = license;
	formData.publicStatsViewable = String(publicStatsViewable);

	if (thumbnailInput) {
		if (isUrlString(thumbnailInput)) {
			formData.thumbnail_url = thumbnailInput;
		} else {
			const thumbnailBinary = await getBinaryFieldFromItem(ctx, thumbnailInput, 'Binary data for YouTube thumbnail property');
			formData.thumbnail = thumbnailBinary;
		}
	}

	const selfDeclaredMadeForKids = ctx.node.getNodeParameter('youtubeSelfDeclaredMadeForKids', ctx.itemIndex, false) as boolean;
	const containsSyntheticMedia = ctx.node.getNodeParameter('youtubeContainsSyntheticMedia', ctx.itemIndex, false) as boolean;
	const defaultLanguage = ctx.node.getNodeParameter('youtubeDefaultLanguage', ctx.itemIndex, '') as string;
	const defaultAudioLanguage = ctx.node.getNodeParameter('youtubeDefaultAudioLanguage', ctx.itemIndex, '') as string;
	const allowedCountries = ctx.node.getNodeParameter('youtubeAllowedCountries', ctx.itemIndex, '') as string;
	const blockedCountries = ctx.node.getNodeParameter('youtubeBlockedCountries', ctx.itemIndex, '') as string;
	const hasPaidProductPlacement = ctx.node.getNodeParameter('youtubeHasPaidProductPlacement', ctx.itemIndex, false) as boolean;
	const recordingDate = ctx.node.getNodeParameter('youtubeRecordingDate', ctx.itemIndex, '') as string;
	const playlistId = ctx.node.getNodeParameter('youtubePlaylistId', ctx.itemIndex, '') as string;

	formData.selfDeclaredMadeForKids = String(selfDeclaredMadeForKids);
	formData.containsSyntheticMedia = String(containsSyntheticMedia);
	if (defaultLanguage) formData.defaultLanguage = defaultLanguage;
	if (defaultAudioLanguage) formData.defaultAudioLanguage = defaultAudioLanguage;
	if (allowedCountries) formData.allowedCountries = allowedCountries;
	if (blockedCountries) formData.blockedCountries = blockedCountries;
	formData.hasPaidProductPlacement = String(hasPaidProductPlacement);
	if (recordingDate) formData.recordingDate = recordingDate;
	if (playlistId) formData.youtube_playlist_id = playlistId;

	// Subtitle files
	const subtitleLanguages = ctx.node.getNodeParameter('youtubeSubtitleLanguages', ctx.itemIndex, '') as string;
	const subtitleNames = ctx.node.getNodeParameter('youtubeSubtitleNames', ctx.itemIndex, '') as string;
	const subtitleFiles = ctx.node.getNodeParameter('youtubeSubtitleFiles', ctx.itemIndex, '') as string;

	if (subtitleLanguages && subtitleFiles) {
		const languages = subtitleLanguages.split(',').map((s: string) => s.trim()).filter(Boolean);
		const names = subtitleNames ? subtitleNames.split(',').map((s: string) => s.trim()) : [];
		const fileRefs = subtitleFiles.split(',').map((s: string) => s.trim()).filter(Boolean);

		for (let i = 0; i < Math.min(languages.length, fileRefs.length); i++) {
			formData[`youtube_subtitle_language_${i}`] = languages[i];
			if (names[i]) {
				formData[`youtube_subtitle_name_${i}`] = names[i];
			}
			const fileRef = fileRefs[i];
			if (isUrlString(fileRef)) {
				formData[`youtube_subtitle_file_${i}`] = fileRef;
			} else {
				const subtitleBinary = await getBinaryFieldFromItem(ctx, fileRef, `Binary data for YouTube subtitle ${i}`);
				formData[`youtube_subtitle_file_${i}`] = subtitleBinary;
			}
		}
	}

	const notifySubscribers = ctx.node.getNodeParameter('youtubeNotifySubscribers', ctx.itemIndex, true) as boolean;
	formData.youtube_notify_subscribers = String(notifySubscribers);
	const publishAt = ctx.node.getNodeParameter('youtubePublishAt', ctx.itemIndex, '') as string;
	if (publishAt) formData.youtube_publish_at = publishAt;
};

const validateXPollConfiguration = (
	ctx: ExecutionContext,
	operation: UploadOperation,
	formData: IDataObject,
): void => {
	if (operation !== 'uploadText') {
		return;
	}
	const pollOptionsRaw = ctx.node.getNodeParameter('xPollOptions', ctx.itemIndex, '') as string;
	const hasPollOptions = pollOptionsRaw.trim().length > 0;
	if (!hasPollOptions) {
		return;
	}

	const conflictingFields: string[] = [];
	const cardUri = ctx.node.getNodeParameter('xCardUri', ctx.itemIndex, '') as string;
	const quoteTweetId = ctx.node.getNodeParameter('xQuoteTweetId', ctx.itemIndex, '') as string;
	const directMessageDeepLink = ctx.node.getNodeParameter('xDirectMessageDeepLink', ctx.itemIndex, '') as string;

	if (cardUri.trim().length > 0) conflictingFields.push('X Card URI');
	if (quoteTweetId.trim().length > 0) conflictingFields.push('X Quote Tweet ID');
	if (directMessageDeepLink.trim().length > 0) conflictingFields.push('X Direct Message Deep Link');

	if (conflictingFields.length > 0) {
		throw new NodeOperationError(
			ctx.node.getNode(),
			`X Poll Options cannot be used with: ${conflictingFields.join(', ')}. These fields are mutually exclusive.`,
		);
	}

	const pollOptions = ensureArrayFromCommaSeparated(pollOptionsRaw);
	if (pollOptions.length < 2 || pollOptions.length > 4) {
		throw new NodeOperationError(
			ctx.node.getNode(),
			`X Poll Options must contain between 2 and 4 non-empty options. Found: ${pollOptions.length}`,
		);
	}

	const invalidOptions = pollOptions.filter(option => option.length > 25);
	if (invalidOptions.length > 0) {
		throw new NodeOperationError(
			ctx.node.getNode(),
			`X Poll Options cannot exceed 25 characters each. Invalid options: ${invalidOptions.join(', ')}`,
		);
	}

	const pollDuration = ctx.node.getNodeParameter('xPollDuration', ctx.itemIndex, 1440) as number;
	if (pollDuration < 5 || pollDuration > 10080) {
		throw new NodeOperationError(
			ctx.node.getNode(),
			`X Poll Duration must be between 5 and 10080 minutes (5 minutes to 7 days). Provided: ${pollDuration}`,
		);
	}

	formData['poll_options[]'] = pollOptions;
	formData.poll_duration = pollDuration;
	const pollReplySettings = ctx.node.getNodeParameter('xPollReplySettings', ctx.itemIndex, 'following') as string;
	formData.poll_reply_settings = pollReplySettings;
};

const applyXOptions = (ctx: ExecutionContext, operation: UploadOperation, formData: IDataObject) => {
	const quoteTweetId = ctx.node.getNodeParameter('xQuoteTweetId', ctx.itemIndex, '') as string;
	const geoPlaceId = ctx.node.getNodeParameter('xGeoPlaceId', ctx.itemIndex, '') as string;
	const forSuperFollowersOnly = ctx.node.getNodeParameter('xForSuperFollowersOnly', ctx.itemIndex, false) as boolean;
	const communityId = ctx.node.getNodeParameter('xCommunityId', ctx.itemIndex, '') as string;
	const shareWithFollowers = ctx.node.getNodeParameter('xShareWithFollowers', ctx.itemIndex, false) as boolean;
	const directMessageDeepLink = ctx.node.getNodeParameter('xDirectMessageDeepLink', ctx.itemIndex, '') as string;
	const cardUri = ctx.node.getNodeParameter('xCardUri', ctx.itemIndex, '') as string;

	if (quoteTweetId) formData.quote_tweet_id = quoteTweetId;
	if (geoPlaceId) formData.geo_place_id = geoPlaceId;
	if (forSuperFollowersOnly) formData.for_super_followers_only = String(forSuperFollowersOnly);
	if (communityId) formData.community_id = communityId;
	if (shareWithFollowers) formData.share_with_followers = String(shareWithFollowers);
	if (directMessageDeepLink) formData.direct_message_deep_link = directMessageDeepLink;
	if (cardUri) formData.card_uri = cardUri;

	if (operation === 'uploadText') {
		const postUrl = ctx.node.getNodeParameter('xPostUrlText', ctx.itemIndex, '') as string;
		const replySettings = ctx.node.getNodeParameter('xReplySettings', ctx.itemIndex, 'everyone') as string;
		if (postUrl) formData.post_url = postUrl;
		if (replySettings && replySettings !== 'everyone') formData.reply_settings = replySettings;

		validateXPollConfiguration(ctx, operation, formData);

		const xLongTextAsPost = ctx.node.getNodeParameter('xLongTextAsPost', ctx.itemIndex, false) as boolean;
		if (xLongTextAsPost) {
			formData.x_long_text_as_post = String(xLongTextAsPost);
		}

		delete formData.nullcast;
		delete formData.place_id;
	} else {
		const taggedUserIds = ctx.node.getNodeParameter('xTaggedUserIds', ctx.itemIndex, '') as string;
		const replySettings = ctx.node.getNodeParameter('xReplySettings', ctx.itemIndex, 'everyone') as string;
		const nullcast = ctx.node.getNodeParameter('xNullcastVideo', ctx.itemIndex, false) as boolean;

		if (taggedUserIds) {
			formData['tagged_user_ids[]'] = ensureArrayFromCommaSeparated(taggedUserIds);
		}
		if (replySettings && replySettings !== 'everyone') formData.reply_settings = replySettings;
		formData.nullcast = String(nullcast);

		if (operation === 'uploadVideo' || operation === 'uploadPhotos') {
			const xLongTextAsPost = ctx.node.getNodeParameter('xLongTextAsPost', ctx.itemIndex, false) as boolean;
			if (xLongTextAsPost) {
				formData.x_long_text_as_post = String(xLongTextAsPost);
			}
		}

		if (operation === 'uploadPhotos') {
			const xThreadImageLayout = ctx.node.getNodeParameter('xThreadImageLayout', ctx.itemIndex, '') as string;
			if (xThreadImageLayout) {
				formData.x_thread_image_layout = xThreadImageLayout;
			}
		}

		const xPlaceIdVideo = ctx.node.getNodeParameter('xPlaceIdVideo', ctx.itemIndex, '') as string;
		if (operation === 'uploadVideo' && xPlaceIdVideo) {
			formData.place_id = xPlaceIdVideo;
		}

		const xAltText = ctx.node.getNodeParameter('xAltText', ctx.itemIndex, '') as string;
		if (xAltText) formData.x_alt_text = xAltText;
		const xSubtitlesUrl = ctx.node.getNodeParameter('xSubtitlesUrl', ctx.itemIndex, '') as string;
		if (xSubtitlesUrl) formData.x_subtitles_url = xSubtitlesUrl;
	}

	const xPaidPartnership = ctx.node.getNodeParameter('xPaidPartnership', ctx.itemIndex, false) as boolean;
	if (xPaidPartnership) formData.x_paid_partnership = 'true';

	if (operation === 'uploadText') {
		const xArticleTitle = ctx.node.getNodeParameter('xArticleTitle', ctx.itemIndex, '') as string;
		if (xArticleTitle) formData.x_article_title = xArticleTitle;
		const xArticleBody = ctx.node.getNodeParameter('xArticleBody', ctx.itemIndex, '') as string;
		if (xArticleBody) formData.x_article_body = xArticleBody;
	}
};

const applyThreadsOptions = (ctx: ExecutionContext, formData: IDataObject) => {
	const operation = ctx.node.getNodeParameter('operation', ctx.itemIndex) as string;
	const threadsLongTextAsPost = ctx.node.getNodeParameter('threadsLongTextAsPost', ctx.itemIndex, false) as boolean;
	if (threadsLongTextAsPost) {
		formData.threads_long_text_as_post = String(threadsLongTextAsPost);
	}

	if (operation === 'uploadPhotos') {
		const threadsThreadMediaLayout = ctx.node.getNodeParameter('threadsThreadMediaLayout', ctx.itemIndex, '') as string;
		if (threadsThreadMediaLayout) {
			formData.threads_thread_media_layout = threadsThreadMediaLayout;
		}
	}

	const threadsTopicTag = ctx.node.getNodeParameter('threadsTopicTag', ctx.itemIndex, '') as string;
	if (threadsTopicTag) {
		formData.threads_topic_tag = threadsTopicTag;
	}

	const threadsReplyControl = ctx.node.getNodeParameter('threadsReplyControl', ctx.itemIndex, '') as string;
	if (threadsReplyControl) formData.threads_reply_control = threadsReplyControl;
	const threadsAltText = ctx.node.getNodeParameter('threadsAltText', ctx.itemIndex, '') as string;
	if (threadsAltText) formData.threads_alt_text = threadsAltText;
	const threadsReplyToId = ctx.node.getNodeParameter('threadsReplyToId', ctx.itemIndex, '') as string;
	if (threadsReplyToId) formData.threads_reply_to_id = threadsReplyToId;
	const threadsQuotePostId = ctx.node.getNodeParameter('threadsQuotePostId', ctx.itemIndex, '') as string;
	if (threadsQuotePostId) formData.threads_quote_post_id = threadsQuotePostId;
	const threadsLinkAttachment = ctx.node.getNodeParameter('threadsLinkAttachment', ctx.itemIndex, '') as string;
	if (threadsLinkAttachment) formData.threads_link_attachment = threadsLinkAttachment;
	const threadsPollOptions = ctx.node.getNodeParameter('threadsPollOptions', ctx.itemIndex, '') as string;
	if (threadsPollOptions) formData.threads_poll_options = threadsPollOptions;
};

const applyGoogleBusinessOptions = (ctx: ExecutionContext, _operation: UploadOperation, formData: IDataObject) => {
	const locationId = ctx.node.getNodeParameter('gbpLocationId', ctx.itemIndex, '') as string;
	if (locationId) formData.gbp_location_id = locationId;

	const topicType = ctx.node.getNodeParameter('gbpTopicType', ctx.itemIndex, '') as string;
	if (topicType) formData.gbp_topic_type = topicType;

	const mediaUrl = ctx.node.getNodeParameter('gbpMediaUrl', ctx.itemIndex, '') as string;
	if (mediaUrl) formData.gbp_media_url = mediaUrl;
	const mediaFormat = ctx.node.getNodeParameter('gbpMediaFormat', ctx.itemIndex, '') as string;
	if (mediaFormat) formData.gbp_media_format = mediaFormat;

	const postType = ctx.node.getNodeParameter('gbpPostType', ctx.itemIndex, '') as string;
	if (postType) {
		formData.gbp_post_type = postType;
		const mediaCategory = ctx.node.getNodeParameter('gbpMediaCategory', ctx.itemIndex, '') as string;
		if (mediaCategory) formData.gbp_media_category = mediaCategory;
	}

	const ctaType = ctx.node.getNodeParameter('gbpCtaType', ctx.itemIndex, '') as string;
	if (ctaType) formData.gbp_cta_type = ctaType;
	const ctaUrl = ctx.node.getNodeParameter('gbpCtaUrl', ctx.itemIndex, '') as string;
	if (ctaUrl) formData.gbp_cta_url = ctaUrl;

	if (topicType === 'EVENT') {
		const eventTitle = ctx.node.getNodeParameter('gbpEventTitle', ctx.itemIndex, '') as string;
		if (eventTitle) formData.gbp_event_title = eventTitle;
		const startDate = ctx.node.getNodeParameter('gbpEventStartDate', ctx.itemIndex, '') as string;
		if (startDate) formData.gbp_event_start_date = startDate;
		const startTime = ctx.node.getNodeParameter('gbpEventStartTime', ctx.itemIndex, '') as string;
		if (startTime) formData.gbp_event_start_time = startTime;
		const endDate = ctx.node.getNodeParameter('gbpEventEndDate', ctx.itemIndex, '') as string;
		if (endDate) formData.gbp_event_end_date = endDate;
		const endTime = ctx.node.getNodeParameter('gbpEventEndTime', ctx.itemIndex, '') as string;
		if (endTime) formData.gbp_event_end_time = endTime;
	}

	if (topicType === 'OFFER') {
		const coupon = ctx.node.getNodeParameter('gbpOfferCoupon', ctx.itemIndex, '') as string;
		if (coupon) formData.gbp_offer_coupon = coupon;
		const redeemUrl = ctx.node.getNodeParameter('gbpOfferRedeemUrl', ctx.itemIndex, '') as string;
		if (redeemUrl) formData.gbp_offer_redeem_url = redeemUrl;
		const terms = ctx.node.getNodeParameter('gbpOfferTerms', ctx.itemIndex, '') as string;
		if (terms) formData.gbp_offer_terms = terms;
	}

	const languageCode = ctx.node.getNodeParameter('gbpLanguageCode', ctx.itemIndex, '') as string;
	if (languageCode) formData.gbp_language_code = languageCode;
};

const applyRedditOptions = (ctx: ExecutionContext, operation: UploadOperation, formData: IDataObject) => {
	const subreddit = ctx.node.getNodeParameter('redditSubreddit', ctx.itemIndex) as string;
	const flairId = ctx.node.getNodeParameter('redditFlairId', ctx.itemIndex, '') as string;
	formData.subreddit = subreddit;
	if (flairId) {
		formData.flair_id = flairId;
	}
	if (operation === 'uploadText') {
		const redditLink = ctx.node.getNodeParameter('redditLinkUrl', ctx.itemIndex, '') as string;
		if (redditLink) {
			formData.reddit_link_url = redditLink;
		}
	}
	const redditNsfw = ctx.node.getNodeParameter('redditNsfw', ctx.itemIndex, false) as boolean;
	if (redditNsfw) formData.reddit_nsfw = 'true';
	const redditSpoiler = ctx.node.getNodeParameter('redditSpoiler', ctx.itemIndex, false) as boolean;
	if (redditSpoiler) formData.reddit_spoiler = 'true';
	const redditFlairText = ctx.node.getNodeParameter('redditFlairText', ctx.itemIndex, '') as string;
	if (redditFlairText) formData.reddit_flair_text = redditFlairText;
};

const setIfFilled = (formData: IDataObject, field: string, value: string | boolean | number | undefined) => {
	if (value === undefined || value === null || value === '' || value === false) return;
	formData[field] = typeof value === 'boolean' ? 'true' : value;
};

const applyCredentialPlatformOptions = (
	ctx: ExecutionContext,
	platforms: string[],
	formData: IDataObject,
) => {
	const isManual = platforms.includes(MANUAL_PLATFORM_VALUE);
	const has = (platform: string) => platforms.includes(platform) || isManual;

	if (has('bluesky')) {
		setIfFilled(formData, 'bluesky_alt_text', ctx.node.getNodeParameter('blueskyAltText', ctx.itemIndex, '') as string);
		setIfFilled(formData, 'bluesky_langs', ctx.node.getNodeParameter('blueskyLangs', ctx.itemIndex, '') as string);
		setIfFilled(formData, 'bluesky_labels', ctx.node.getNodeParameter('blueskyLabels', ctx.itemIndex, '') as string);
		setIfFilled(formData, 'bluesky_threadgate', ctx.node.getNodeParameter('blueskyThreadgate', ctx.itemIndex, '') as string);
		setIfFilled(formData, 'bluesky_quote_uri', ctx.node.getNodeParameter('blueskyQuoteUri', ctx.itemIndex, '') as string);
	}

	if (has('discord')) {
		setIfFilled(formData, 'discord_thread_id', ctx.node.getNodeParameter('discordThreadId', ctx.itemIndex, '') as string);
		setIfFilled(formData, 'discord_thread_name', ctx.node.getNodeParameter('discordThreadName', ctx.itemIndex, '') as string);
		setIfFilled(formData, 'discord_username', ctx.node.getNodeParameter('discordUsername', ctx.itemIndex, '') as string);
		setIfFilled(formData, 'discord_avatar_url', ctx.node.getNodeParameter('discordAvatarUrl', ctx.itemIndex, '') as string);
		setIfFilled(formData, 'discord_embeds', ctx.node.getNodeParameter('discordEmbeds', ctx.itemIndex, '') as string);
		setIfFilled(formData, 'discord_alt_text', ctx.node.getNodeParameter('discordAltText', ctx.itemIndex, '') as string);
		setIfFilled(formData, 'discord_tts', ctx.node.getNodeParameter('discordTts', ctx.itemIndex, false) as boolean);
	}

	if (has('telegram')) {
		setIfFilled(formData, 'telegram_parse_mode', ctx.node.getNodeParameter('telegramParseMode', ctx.itemIndex, '') as string);
		setIfFilled(formData, 'telegram_message_thread_id', ctx.node.getNodeParameter('telegramMessageThreadId', ctx.itemIndex, '') as string);
		setIfFilled(formData, 'telegram_disable_notification', ctx.node.getNodeParameter('telegramDisableNotification', ctx.itemIndex, false) as boolean);
		setIfFilled(formData, 'telegram_protect_content', ctx.node.getNodeParameter('telegramProtectContent', ctx.itemIndex, false) as boolean);
		setIfFilled(formData, 'telegram_has_spoiler', ctx.node.getNodeParameter('telegramHasSpoiler', ctx.itemIndex, false) as boolean);
		setIfFilled(formData, 'telegram_as_document', ctx.node.getNodeParameter('telegramAsDocument', ctx.itemIndex, false) as boolean);
	}

	if (has('mastodon')) {
		setIfFilled(formData, 'mastodon_visibility', ctx.node.getNodeParameter('mastodonVisibility', ctx.itemIndex, '') as string);
		setIfFilled(formData, 'mastodon_sensitive', ctx.node.getNodeParameter('mastodonSensitive', ctx.itemIndex, false) as boolean);
		setIfFilled(formData, 'mastodon_spoiler_text', ctx.node.getNodeParameter('mastodonSpoilerText', ctx.itemIndex, '') as string);
		setIfFilled(formData, 'mastodon_language', ctx.node.getNodeParameter('mastodonLanguage', ctx.itemIndex, '') as string);
		setIfFilled(formData, 'mastodon_alt_text', ctx.node.getNodeParameter('mastodonAltText', ctx.itemIndex, '') as string);
		setIfFilled(formData, 'mastodon_poll_options', ctx.node.getNodeParameter('mastodonPollOptions', ctx.itemIndex, '') as string);
		setIfFilled(formData, 'mastodon_poll_expires_in', ctx.node.getNodeParameter('mastodonPollExpiresIn', ctx.itemIndex, 0) as number);
		setIfFilled(formData, 'mastodon_poll_multiple', ctx.node.getNodeParameter('mastodonPollMultiple', ctx.itemIndex, false) as boolean);
	}

	if (has('wordpress')) {
		setIfFilled(formData, 'wordpress_status', ctx.node.getNodeParameter('wordpressStatus', ctx.itemIndex, '') as string);
		setIfFilled(formData, 'wordpress_date', ctx.node.getNodeParameter('wordpressDate', ctx.itemIndex, '') as string);
		setIfFilled(formData, 'wordpress_categories', ctx.node.getNodeParameter('wordpressCategories', ctx.itemIndex, '') as string);
		setIfFilled(formData, 'wordpress_tags', ctx.node.getNodeParameter('wordpressTags', ctx.itemIndex, '') as string);
		setIfFilled(formData, 'wordpress_excerpt', ctx.node.getNodeParameter('wordpressExcerpt', ctx.itemIndex, '') as string);
		setIfFilled(formData, 'wordpress_slug', ctx.node.getNodeParameter('wordpressSlug', ctx.itemIndex, '') as string);
		setIfFilled(formData, 'wordpress_alt_text', ctx.node.getNodeParameter('wordpressAltText', ctx.itemIndex, '') as string);
	}

	if (has('lemmy')) {
		setIfFilled(formData, 'lemmy_community', ctx.node.getNodeParameter('lemmyCommunity', ctx.itemIndex, '') as string);
		setIfFilled(formData, 'lemmy_url', ctx.node.getNodeParameter('lemmyUrl', ctx.itemIndex, '') as string);
		setIfFilled(formData, 'lemmy_nsfw', ctx.node.getNodeParameter('lemmyNsfw', ctx.itemIndex, false) as boolean);
		setIfFilled(formData, 'lemmy_alt_text', ctx.node.getNodeParameter('lemmyAltText', ctx.itemIndex, '') as string);
	}

	if (has('slack')) {
		setIfFilled(formData, 'slack_markdown', ctx.node.getNodeParameter('slackMarkdown', ctx.itemIndex, false) as boolean);
		setIfFilled(formData, 'slack_blocks', ctx.node.getNodeParameter('slackBlocks', ctx.itemIndex, '') as string);
		setIfFilled(formData, 'slack_mrkdwn', ctx.node.getNodeParameter('slackMrkdwn', ctx.itemIndex, false) as boolean);
	}

	if (has('nostr')) {
		setIfFilled(formData, 'nostr_kind', ctx.node.getNodeParameter('nostrKind', ctx.itemIndex, '') as string);
		setIfFilled(formData, 'nostr_long_form', ctx.node.getNodeParameter('nostrLongForm', ctx.itemIndex, false) as boolean);
	}

	if (has('devto')) {
		setIfFilled(formData, 'devto_tags', ctx.node.getNodeParameter('devtoTags', ctx.itemIndex, '') as string);
		setIfFilled(formData, 'devto_canonical_url', ctx.node.getNodeParameter('devtoCanonicalUrl', ctx.itemIndex, '') as string);
		setIfFilled(formData, 'devto_description', ctx.node.getNodeParameter('devtoDescription', ctx.itemIndex, '') as string);
		setIfFilled(formData, 'devto_main_image', ctx.node.getNodeParameter('devtoMainImage', ctx.itemIndex, '') as string);
		setIfFilled(formData, 'devto_series', ctx.node.getNodeParameter('devtoSeries', ctx.itemIndex, '') as string);
		setIfFilled(formData, 'devto_published', ctx.node.getNodeParameter('devtoPublished', ctx.itemIndex, false) as boolean);
	}

	if (has('hashnode')) {
		setIfFilled(formData, 'hashnode_tags', ctx.node.getNodeParameter('hashnodeTags', ctx.itemIndex, '') as string);
		setIfFilled(formData, 'hashnode_subtitle', ctx.node.getNodeParameter('hashnodeSubtitle', ctx.itemIndex, '') as string);
		setIfFilled(formData, 'hashnode_cover_image_url', ctx.node.getNodeParameter('hashnodeCoverImageUrl', ctx.itemIndex, '') as string);
		setIfFilled(formData, 'hashnode_body', ctx.node.getNodeParameter('hashnodeBody', ctx.itemIndex, '') as string);
		setIfFilled(formData, 'hashnode_draft', ctx.node.getNodeParameter('hashnodeDraft', ctx.itemIndex, false) as boolean);
	}

	if (has('whop')) {
		setIfFilled(formData, 'whop_body', ctx.node.getNodeParameter('whopBody', ctx.itemIndex, '') as string);
		setIfFilled(formData, 'whop_pinned', ctx.node.getNodeParameter('whopPinned', ctx.itemIndex, false) as boolean);
		setIfFilled(formData, 'whop_paywall_amount', ctx.node.getNodeParameter('whopPaywallAmount', ctx.itemIndex, '') as string);
		setIfFilled(formData, 'whop_paywall_currency', ctx.node.getNodeParameter('whopPaywallCurrency', ctx.itemIndex, '') as string);
	}

	if (has('listmonk')) {
		setIfFilled(formData, 'listmonk_content_type', ctx.node.getNodeParameter('listmonkContentType', ctx.itemIndex, '') as string);
		setIfFilled(formData, 'listmonk_send_at', ctx.node.getNodeParameter('listmonkSendAt', ctx.itemIndex, '') as string);
		setIfFilled(formData, 'listmonk_lists', ctx.node.getNodeParameter('listmonkLists', ctx.itemIndex, '') as string);
		setIfFilled(formData, 'listmonk_template_id', ctx.node.getNodeParameter('listmonkTemplateId', ctx.itemIndex, '') as string);
	}
};

const applyUploadPlatformOptions = async (
	ctx: ExecutionContext,
	operation: UploadOperation,
	prep: UploadPreparation,
) => {
	const { formData, platforms } = prep;
	const isManualPlatform = platforms.includes(MANUAL_PLATFORM_VALUE);

	if (platforms.includes('pinterest') || isManualPlatform) {
		applyPinterestOptions(ctx, operation, formData, isManualPlatform);
	}

	if (platforms.includes('linkedin') || isManualPlatform) {
		applyLinkedinOptions(ctx, operation, formData, isManualPlatform);
	}

	if (platforms.includes('facebook') || isManualPlatform) {
		applyFacebookOptions(ctx, operation, formData, isManualPlatform);
	}

	if (platforms.includes('tiktok')) {
		applyTiktokOptions(ctx, operation, formData);
	}

	if (platforms.includes('instagram')) {
		await applyInstagramOptions(ctx, operation, formData);
	}

	if (platforms.includes('youtube') && operation === 'uploadVideo') {
		await applyYoutubeOptions(ctx, formData);
	}

	if (platforms.includes('x')) {
		applyXOptions(ctx, operation, formData);
	}

	if (platforms.includes('threads')) {
		applyThreadsOptions(ctx, formData);
	}

	if (platforms.includes('reddit')) {
		applyRedditOptions(ctx, operation, formData);
	}

	if (platforms.includes('google_business')) {
		applyGoogleBusinessOptions(ctx, operation, formData);
	}

	if (platforms.includes('bluesky') && operation === 'uploadText') {
		const blueskyLink = ctx.node.getNodeParameter('blueskyLink', ctx.itemIndex, '') as string;
		if (blueskyLink) {
			formData.bluesky_link_url = blueskyLink;
		}
	}

	applyCredentialPlatformOptions(ctx, platforms, formData);
};

const buildUploadPhotosRequest = async (
	ctx: ExecutionContext,
): Promise<RequestConfig> => {
	const prep = prepareUploadBase(ctx, 'uploadPhotos');
	const photosInput = ctx.node.getNodeParameter('photos', ctx.itemIndex, '') as string | string[];

	let photosToProcess: string[] = [];
	if (Array.isArray(photosInput)) {
		photosToProcess = photosInput.filter(item => typeof item === 'string' && item.trim().length > 0).map(item => item.trim());
	} else if (typeof photosInput === 'string') {
		photosToProcess = ensureArrayFromCommaSeparated(photosInput);
	}

	const photoArray: Array<string | BinaryFormField> = [];
	for (const photoItem of photosToProcess) {
		if (isUrlString(photoItem)) {
			photoArray.push(photoItem);
			continue;
		}
		const binaryField = await getBinaryFieldFromItem(ctx, photoItem, 'Binary data for property');
		photoArray.push(binaryField);
	}

	if (photoArray.length > 0) {
		prep.formData['photos[]'] = photoArray;
	}

	await applyUploadPlatformOptions(ctx, 'uploadPhotos', prep);

	return {
		endpoint: '/upload_photos',
		method: 'POST',
		formData: prep.formData,
		isUploadOperation: true,
		waitForCompletion: prep.waitForCompletion,
		pollInterval: prep.pollInterval,
		pollTimeout: prep.pollTimeout,
	};
};

const buildUploadVideoRequest = async (
	ctx: ExecutionContext,
): Promise<RequestConfig> => {
	const prep = prepareUploadBase(ctx, 'uploadVideo');
	const videoInput = ctx.node.getNodeParameter('video', ctx.itemIndex, '') as string;

	if (videoInput) {
		if (isUrlString(videoInput)) {
			prep.formData.video = videoInput;
		} else {
			const binaryField = await getBinaryFieldFromItem(ctx, videoInput, 'Binary data for video property');
			prep.formData.video = binaryField;
		}
	}

	await applyUploadPlatformOptions(ctx, 'uploadVideo', prep);

	return {
		endpoint: '/upload',
		method: 'POST',
		formData: prep.formData,
		isUploadOperation: true,
		waitForCompletion: prep.waitForCompletion,
		pollInterval: prep.pollInterval,
		pollTimeout: prep.pollTimeout,
	};
};

const buildUploadTextRequest = async (
	ctx: ExecutionContext,
): Promise<RequestConfig> => {
	const prep = prepareUploadBase(ctx, 'uploadText');

	await applyUploadPlatformOptions(ctx, 'uploadText', prep);

	return {
		endpoint: '/upload_text',
		method: 'POST',
		formData: prep.formData,
		isUploadOperation: true,
		waitForCompletion: prep.waitForCompletion,
		pollInterval: prep.pollInterval,
		pollTimeout: prep.pollTimeout,
	};
};

const buildUploadDocumentRequest = async (
	ctx: ExecutionContext,
): Promise<RequestConfig> => {
	const prep = prepareUploadBase(ctx, 'uploadDocument');
	const documentInput = ctx.node.getNodeParameter('document', ctx.itemIndex, '') as string;

	if (documentInput) {
		if (isUrlString(documentInput)) {
			prep.formData.document = documentInput;
		} else {
			const binaryField = await getBinaryFieldFromItem(ctx, documentInput, 'Binary data for document property');
			prep.formData.document = binaryField;
		}
	}

	// Apply LinkedIn options for document uploads
	const isManualDoc = prep.platforms.includes(MANUAL_PLATFORM_VALUE);
	if (prep.platforms.includes('linkedin') || isManualDoc) {
		applyLinkedinOptions(ctx, 'uploadDocument', prep.formData, isManualDoc);
	}

	return {
		endpoint: '/upload_document',
		method: 'POST',
		formData: prep.formData,
		isUploadOperation: true,
		waitForCompletion: prep.waitForCompletion,
		pollInterval: prep.pollInterval,
		pollTimeout: prep.pollTimeout,
	};
};

const buildMonitoringRequest = (ctx: ExecutionContext): RequestConfig => {
	switch (ctx.operation) {
		case 'getStatus': {
			const requestId = ctx.node.getNodeParameter('requestId', ctx.itemIndex) as string;
			return {
				endpoint: '/uploadposts/status',
				method: 'GET',
				qs: { request_id: requestId },
				isUploadOperation: false,
				waitForCompletion: false,
			};
		}
		case 'getJobStatus': {
			const jobId = ctx.node.getNodeParameter('jobId', ctx.itemIndex) as string;
			return {
				endpoint: '/uploadposts/status',
				method: 'GET',
				qs: { job_id: jobId },
				isUploadOperation: false,
				waitForCompletion: false,
			};
		}
		case 'getHistory': {
			const page = ctx.node.getNodeParameter('historyPage', ctx.itemIndex, 1) as number;
			const limit = ctx.node.getNodeParameter('historyLimit', ctx.itemIndex, 20) as number;
			return {
				endpoint: '/uploadposts/history',
				method: 'GET',
				qs: { page, limit },
				isUploadOperation: false,
				waitForCompletion: false,
			};
		}
		case 'getAnalytics': {
			const profileUsername = ctx.node.getNodeParameter('analyticsProfileUsername', ctx.itemIndex) as string;
			const analyticsPlatforms = ctx.node.getNodeParameter('analyticsPlatforms', ctx.itemIndex, []) as string[];
			if (!Array.isArray(analyticsPlatforms) || analyticsPlatforms.length === 0) {
				throw new NodeOperationError(ctx.node.getNode(), 'Select at least one platform: the analytics API rejects a request without "platforms".', {
					itemIndex: ctx.itemIndex,
				});
			}
			const qs: IDataObject = { platforms: analyticsPlatforms.join(',') };
			const analyticsPageId = ctx.node.getNodeParameter('analyticsPageId', ctx.itemIndex, '') as string;
			if (analyticsPlatforms.includes('facebook') && !analyticsPageId) {
				throw new NodeOperationError(ctx.node.getNode(), 'Facebook analytics require a Page ID.', { itemIndex: ctx.itemIndex });
			}
			if (analyticsPageId) qs.page_id = analyticsPageId;
			const analyticsPageUrn = ctx.node.getNodeParameter('analyticsPageUrn', ctx.itemIndex, '') as string;
			if (analyticsPageUrn) qs.page_urn = analyticsPageUrn;
			return {
				endpoint: `/analytics/${encodeURIComponent(profileUsername)}`,
				method: 'GET',
				qs,
				isUploadOperation: false,
				waitForCompletion: false,
			};
		}
		case 'getPostAnalytics': {
			const requestId = ctx.node.getNodeParameter('postAnalyticsRequestId', ctx.itemIndex) as string;
			const platform = ctx.node.getNodeParameter('postAnalyticsPlatform', ctx.itemIndex, '') as string;
			const qs: IDataObject = {};
			if (platform) {
				qs.platform = platform;
			}
			return {
				endpoint: `/uploadposts/post-analytics/${encodeURIComponent(requestId)}`,
				method: 'GET',
				qs,
				isUploadOperation: false,
				waitForCompletion: false,
			};
		}
		case 'getPostAnalyticsByPlatformId': {
			return {
				endpoint: '/uploadposts/post-analytics',
				method: 'GET',
				qs: {
					platform_post_id: ctx.node.getNodeParameter('platformPostId', ctx.itemIndex) as string,
					platform: ctx.node.getNodeParameter('nativePostPlatform', ctx.itemIndex) as string,
					user: ctx.node.getNodeParameter('nativePostProfileUsername', ctx.itemIndex) as string,
				},
				isUploadOperation: false,
				waitForCompletion: false,
			};
		}
		case 'getCachedPostAnalytics': {
			const qs: IDataObject = {
				user: ctx.node.getNodeParameter('cachedAnalyticsProfileUsername', ctx.itemIndex) as string,
			};
			const platform = ctx.node.getNodeParameter('cachedAnalyticsPlatform', ctx.itemIndex, '') as string;
			if (platform) qs.platform = platform;
			const limit = ctx.node.getNodeParameter('cachedAnalyticsLimit', ctx.itemIndex, 50) as number;
			if (limit) qs.limit = limit;
			const cursor = ctx.node.getNodeParameter('cachedAnalyticsCursor', ctx.itemIndex, '') as string;
			if (cursor) qs.cursor = cursor;
			const since = ctx.node.getNodeParameter('cachedAnalyticsSince', ctx.itemIndex, '') as string;
			if (since) qs.since = since;
			const until = ctx.node.getNodeParameter('cachedAnalyticsUntil', ctx.itemIndex, '') as string;
			if (until) qs.until = until;
			return {
				endpoint: '/uploadposts/post-analytics/cached',
				method: 'GET',
				qs,
				isUploadOperation: false,
				waitForCompletion: false,
			};
		}
		case 'getPlatformMetrics': {
			return {
				endpoint: '/uploadposts/platform-metrics',
				method: 'GET',
				isUploadOperation: false,
				waitForCompletion: false,
			};
		}
		case 'getTotalImpressions': {
			const profileUsername = ctx.node.getNodeParameter('impressionsProfileUsername', ctx.itemIndex) as string;
			const qs: IDataObject = {};
			const period = ctx.node.getNodeParameter('impressionsPeriod', ctx.itemIndex, '') as string;
			const startDate = ctx.node.getNodeParameter('impressionsStartDate', ctx.itemIndex, '') as string;
			const endDate = ctx.node.getNodeParameter('impressionsEndDate', ctx.itemIndex, '') as string;
			const platforms = ctx.node.getNodeParameter('impressionsPlatforms', ctx.itemIndex, []) as string[];
			const breakdown = ctx.node.getNodeParameter('impressionsBreakdown', ctx.itemIndex, false) as boolean;
			if (period) qs.period = period;
			if (startDate) qs.start_date = startDate;
			if (endDate) qs.end_date = endDate;
			if (Array.isArray(platforms) && platforms.length > 0) qs.platform = platforms.join(',');
			if (breakdown) qs.breakdown = 'true';
			return {
				endpoint: `/uploadposts/total-impressions/${encodeURIComponent(profileUsername)}`,
				method: 'GET',
				qs,
				isUploadOperation: false,
				waitForCompletion: false,
			};
		}
		case 'getRedditDetailedPosts': {
			return {
				endpoint: '/uploadposts/reddit/detailed-posts/',
				method: 'GET',
				qs: { profile_username: ctx.node.getNodeParameter('redditProfileUsername', ctx.itemIndex) as string },
				isUploadOperation: false,
				waitForCompletion: false,
			};
		}
		case 'listScheduled': {
			return {
				endpoint: '/uploadposts/schedule',
				method: 'GET',
				isUploadOperation: false,
				waitForCompletion: false,
			};
		}
		case 'cancelScheduled': {
			const jobId = ctx.node.getNodeParameter('scheduleJobId', ctx.itemIndex) as string;
			return {
				endpoint: `/uploadposts/schedule/${jobId}`,
				method: 'DELETE',
				isUploadOperation: false,
				waitForCompletion: false,
			};
		}
		case 'editScheduled': {
			const jobId = ctx.node.getNodeParameter('scheduleJobId', ctx.itemIndex) as string;
			const newScheduledDateRaw = ctx.node.getNodeParameter('newScheduledDate', ctx.itemIndex, '') as string;
			const normalizedDate = normalizeDateInput(newScheduledDateRaw);
			const body: IDataObject = {};
			if (normalizedDate) {
				body.scheduled_date = normalizedDate;
			}
			const newTimezone = ctx.node.getNodeParameter('newTimezone', ctx.itemIndex, '') as string;
			if (newTimezone) {
				body.timezone = newTimezone;
			}
			return {
				endpoint: `/uploadposts/schedule/${jobId}`,
				method: 'PATCH',
				body,
				isUploadOperation: false,
				waitForCompletion: false,
			};
		}
		case 'getMedia': {
			const qs: IDataObject = {
				platform: ctx.node.getNodeParameter('mediaPlatform', ctx.itemIndex) as string,
				user: ctx.node.getNodeParameter('mediaUser', ctx.itemIndex) as string,
			};
			const pageUrn = ctx.node.getNodeParameter('mediaPageUrn', ctx.itemIndex, '') as string;
			if (pageUrn) qs.page_urn = pageUrn;
			const limit = ctx.node.getNodeParameter('mediaLimit', ctx.itemIndex, 0) as number;
			if (limit) qs.limit = limit;
			const cursor = ctx.node.getNodeParameter('mediaCursor', ctx.itemIndex, '') as string;
			if (cursor) qs.cursor = cursor;
			return {
				endpoint: '/uploadposts/media',
				method: 'GET',
				qs,
				isUploadOperation: false,
				waitForCompletion: false,
			};
		}
		case 'getGoogleBusinessLocations': {
			const qs: IDataObject = {};
			const profile = ctx.node.getNodeParameter('gbpLocationsProfile', ctx.itemIndex, '') as string;
			if (profile) qs.profile = profile;
			return {
				endpoint: '/uploadposts/google-business/locations',
				method: 'GET',
				qs,
				isUploadOperation: false,
				waitForCompletion: false,
			};
		}
		case 'getTiktokTrendingMusic': {
			const qs: IDataObject = {
				profile: ctx.node.getNodeParameter('tiktokDiscoveryProfile', ctx.itemIndex) as string,
			};
			const genre = ctx.node.getNodeParameter('tiktokMusicGenre', ctx.itemIndex, '') as string;
			if (genre) qs.genre = genre;
			const countryCode = ctx.node.getNodeParameter('tiktokMusicCountryCode', ctx.itemIndex, '') as string;
			if (countryCode) qs.country_code = countryCode;
			return {
				endpoint: '/uploadposts/tiktok/music/trending',
				method: 'GET',
				qs,
				isUploadOperation: false,
				waitForCompletion: false,
			};
		}
		case 'searchTiktokMusic': {
			const qs: IDataObject = {
				profile: ctx.node.getNodeParameter('tiktokDiscoveryProfile', ctx.itemIndex) as string,
			};
			const query = ctx.node.getNodeParameter('tiktokMusicQuery', ctx.itemIndex, '') as string;
			if (query) qs.q = query;
			const genre = ctx.node.getNodeParameter('tiktokMusicGenre', ctx.itemIndex, '') as string;
			if (genre) qs.genre = genre;
			const countryCode = ctx.node.getNodeParameter('tiktokMusicCountryCode', ctx.itemIndex, '') as string;
			if (countryCode) qs.country_code = countryCode;
			const limit = ctx.node.getNodeParameter('tiktokMusicLimit', ctx.itemIndex, 0) as number;
			if (limit) qs.limit = limit;
			return {
				endpoint: '/uploadposts/tiktok/music/search',
				method: 'GET',
				qs,
				isUploadOperation: false,
				waitForCompletion: false,
			};
		}
		case 'getTiktokLocations': {
			return {
				endpoint: '/uploadposts/tiktok/locations',
				method: 'GET',
				qs: {
					profile: ctx.node.getNodeParameter('tiktokDiscoveryProfile', ctx.itemIndex) as string,
					q: ctx.node.getNodeParameter('tiktokLocationQuery', ctx.itemIndex) as string,
				},
				isUploadOperation: false,
				waitForCompletion: false,
			};
		}
		case 'getTiktokSettings': {
			return {
				endpoint: '/uploadposts/tiktok/settings',
				method: 'GET',
				qs: {
					profile: ctx.node.getNodeParameter('tiktokDiscoveryProfile', ctx.itemIndex) as string,
				},
				isUploadOperation: false,
				waitForCompletion: false,
			};
		}
		default:
			throw new NodeOperationError(ctx.node.getNode(), `Unsupported monitoring operation: ${ctx.operation}`, {
				itemIndex: ctx.itemIndex,
			});
	}
};

const buildPostActionRequest = (ctx: ExecutionContext): RequestConfig => {
	switch (ctx.operation) {
		case 'retryPost': {
			const body: IDataObject = {};
			const requestId = ctx.node.getNodeParameter('retryRequestId', ctx.itemIndex, '') as string;
			const jobId = ctx.node.getNodeParameter('retryJobId', ctx.itemIndex, '') as string;
			if (requestId) body.request_id = requestId;
			if (jobId) body.job_id = jobId;
			if (!requestId && !jobId) {
				throw new NodeOperationError(ctx.node.getNode(), 'Provide a Request ID or a Job ID to retry.', {
					itemIndex: ctx.itemIndex,
				});
			}
			return {
				endpoint: '/uploadposts/posts/retry',
				method: 'POST',
				body,
				isUploadOperation: false,
				waitForCompletion: false,
			};
		}
		case 'unpublishPost': {
			return {
				endpoint: '/uploadposts/posts/unpublish',
				method: 'POST',
				body: {
					platform: ctx.node.getNodeParameter('postActionPlatform', ctx.itemIndex) as string,
					user: ctx.node.getNodeParameter('postActionUser', ctx.itemIndex) as string,
					post_id: ctx.node.getNodeParameter('postActionPostId', ctx.itemIndex) as string,
				},
				isUploadOperation: false,
				waitForCompletion: false,
			};
		}
		case 'editPost': {
			const body: IDataObject = {
				platform: ctx.node.getNodeParameter('postActionPlatform', ctx.itemIndex) as string,
				user: ctx.node.getNodeParameter('postActionUser', ctx.itemIndex) as string,
				post_id: ctx.node.getNodeParameter('postActionPostId', ctx.itemIndex) as string,
			};
			const message = ctx.node.getNodeParameter('postActionMessage', ctx.itemIndex, '') as string;
			if (message) body.message = message;
			return {
				endpoint: '/uploadposts/posts/edit',
				method: 'POST',
				body,
				isUploadOperation: false,
				waitForCompletion: false,
			};
		}
		case 'repostPost': {
			const body: IDataObject = {
				platform: ctx.node.getNodeParameter('repostPlatform', ctx.itemIndex) as string,
				user: ctx.node.getNodeParameter('postActionUser', ctx.itemIndex) as string,
				post_id: ctx.node.getNodeParameter('postActionPostId', ctx.itemIndex) as string,
			};
			const commentary = ctx.node.getNodeParameter('postActionMessage', ctx.itemIndex, '') as string;
			if (commentary) body.commentary = commentary;
			return {
				endpoint: '/uploadposts/posts/repost',
				method: 'POST',
				body,
				isUploadOperation: false,
				waitForCompletion: false,
			};
		}
		case 'savePin': {
			const body: IDataObject = {
				platform: 'pinterest',
				user: ctx.node.getNodeParameter('postActionUser', ctx.itemIndex) as string,
				post_id: ctx.node.getNodeParameter('postActionPostId', ctx.itemIndex) as string,
				pinterest_board_id: ctx.node.getNodeParameter('savePinBoardId', ctx.itemIndex) as string,
			};
			const sectionId = ctx.node.getNodeParameter('savePinBoardSectionId', ctx.itemIndex, '') as string;
			if (sectionId) body.pinterest_board_section_id = sectionId;
			return {
				endpoint: '/uploadposts/posts/save',
				method: 'POST',
				body,
				isUploadOperation: false,
				waitForCompletion: false,
			};
		}
		default:
			throw new NodeOperationError(ctx.node.getNode(), `Unsupported post action: ${ctx.operation}`, {
				itemIndex: ctx.itemIndex,
			});
	}
};

const collectUiLabels = (ctx: ExecutionContext): IDataObject => {
	const raw = ctx.node.getNodeParameter('uiLabels', ctx.itemIndex, {}) as IDataObject;
	const entries = Array.isArray(raw.label) ? (raw.label as IDataObject[]) : [];
	const uiLabels: IDataObject = {};
	for (const entry of entries) {
		const key = String(entry.key ?? '').trim();
		if (!key) continue;
		uiLabels[key] = String(entry.value ?? '');
	}
	return uiLabels;
};

const buildUserRequest = async (ctx: ExecutionContext): Promise<RequestConfig> => {
	switch (ctx.operation) {
		case 'listUsers':
			return {
				endpoint: '/uploadposts/users',
				method: 'GET',
				isUploadOperation: false,
				waitForCompletion: false,
			};
		case 'createUser': {
			const username = ctx.node.getNodeParameter('newUser', ctx.itemIndex) as string;
			return {
				endpoint: '/uploadposts/users',
				method: 'POST',
				body: { username },
				isUploadOperation: false,
				waitForCompletion: false,
			};
		}
		case 'deleteUser': {
			const username = ctx.node.getNodeParameter('deleteUserId', ctx.itemIndex) as string;
			return {
				endpoint: '/uploadposts/users',
				method: 'DELETE',
				body: { username },
				isUploadOperation: false,
				waitForCompletion: false,
			};
		}
		case 'generateJwt': {
			const username = getUserForOperation(ctx, true);
			const redirectUrl = ctx.node.getNodeParameter('redirectUrl', ctx.itemIndex, '') as string;
			const logoImage = ctx.node.getNodeParameter('logoImage', ctx.itemIndex, '') as string;
			const redirectButtonText = ctx.node.getNodeParameter('redirectButtonText', ctx.itemIndex, '') as string;
			const platforms = ctx.node.getNodeParameter('jwtPlatforms', ctx.itemIndex, []) as string[];
			const showCalendar = ctx.node.getNodeParameter('showCalendar', ctx.itemIndex, true) as boolean;
			const readonlyCalendar = ctx.node.getNodeParameter('readonlyCalendar', ctx.itemIndex, false) as boolean;
			const connectTitle = ctx.node.getNodeParameter('connectTitle', ctx.itemIndex, '') as string;
			const connectDescription = ctx.node.getNodeParameter('connectDescription', ctx.itemIndex, '') as string;
			const language = ctx.node.getNodeParameter('language', ctx.itemIndex, '') as string;
			const body: IDataObject = { username };
			if (redirectUrl) body.redirect_url = redirectUrl;
			if (logoImage) body.logo_image = logoImage;
			if (redirectButtonText) body.redirect_button_text = redirectButtonText;
			if (Array.isArray(platforms) && platforms.length > 0) body.platforms = platforms;
			body.show_calendar = showCalendar;
			body.readonly_calendar = readonlyCalendar;
			if (connectTitle) body.connect_title = connectTitle;
			if (connectDescription) body.connect_description = connectDescription;
			if (language) body.language = language;
			const uiLabels = collectUiLabels(ctx);
			if (Object.keys(uiLabels).length > 0) body.ui_labels = uiLabels;
			return {
				endpoint: '/uploadposts/users/generate-jwt',
				method: 'POST',
				body,
				isUploadOperation: false,
				waitForCompletion: false,
			};
		}
		case 'validateJwt': {
			const jwt = ctx.node.getNodeParameter('jwtToken', ctx.itemIndex) as string;
			return {
				endpoint: '/uploadposts/users/validate-jwt',
				method: 'GET',
				headers: { Authorization: `Bearer ${jwt}` },
				skipCredentialAuth: true,
				isUploadOperation: false,
				waitForCompletion: false,
			};
		}
		case 'getNotificationPrefs': {
			return {
				endpoint: '/uploadposts/users/notifications',
				method: 'GET',
				body: {},
				isUploadOperation: false,
				waitForCompletion: false,
			};
		}
		case 'updateNotificationPrefs': {
			const webhookUrl = ctx.node.getNodeParameter('webhookUrl', ctx.itemIndex, '') as string;
			const webhookEnabled = ctx.node.getNodeParameter('webhookEnabled', ctx.itemIndex, false) as boolean;
			const webhookEventsRaw = ctx.node.getNodeParameter('webhookEvents', ctx.itemIndex, []) as string[];
			const existingChannels = await fetchNotificationChannels(ctx);
			const body: IDataObject = {
				channels: { ...existingChannels, webhook: webhookEnabled },
			};
			if (webhookUrl) body.webhook_url = webhookUrl;
			if (webhookEventsRaw.length > 0) {
				body.webhook_events = Object.fromEntries(webhookEventsRaw.map(event => [event, true]));
			}
			return {
				endpoint: '/uploadposts/users/notifications',
				method: 'POST',
				body,
				isUploadOperation: false,
				waitForCompletion: false,
			};
		}
		case 'getUserPreferences': {
			return {
				endpoint: '/uploadposts/users/preferences',
				method: 'GET',
				isUploadOperation: false,
				waitForCompletion: false,
			};
		}
		case 'updateUserPreferences': {
			const weekStartDay = ctx.node.getNodeParameter('weekStartDay', ctx.itemIndex, '') as string;
			const body: IDataObject = {};
			if (weekStartDay !== '') body.weekStartDay = parseInt(weekStartDay, 10);
			return {
				endpoint: '/uploadposts/users/preferences',
				method: 'POST',
				body,
				isUploadOperation: false,
				waitForCompletion: false,
			};
		}
		case 'testNotifications':
			return {
				endpoint: '/uploadposts/users/notifications/test',
				method: 'POST',
				body: {},
				isUploadOperation: false,
				waitForCompletion: false,
			};
		default:
			throw new NodeOperationError(ctx.node.getNode(), `Unsupported user operation: ${ctx.operation}`, {
				itemIndex: ctx.itemIndex,
			});
	}
};

// Liking a comment needs nothing but the comment; hiding and pinning are done to
// a comment inside a post, and the API rejects a like that carries a post.
const COMMENT_ACTIONS_WITHOUT_POST = new Set(['like', 'unlike']);

const buildInstagramRequest = (ctx: ExecutionContext): RequestConfig => {
	switch (ctx.operation) {
		case 'getPostComments': {
			const user = ctx.node.getNodeParameter('instagramUser', ctx.itemIndex) as string;
			const platform = ctx.node.getNodeParameter('commentPlatform', ctx.itemIndex, 'instagram') as string;
			const postId = ctx.node.getNodeParameter('instagramPostId', ctx.itemIndex) as string;
			const qs: IDataObject = { platform, user };
			if (postId.startsWith('http://') || postId.startsWith('https://')) {
				// TikTok resolves comments by video ID only; sending a URL would
				// reach the API and come back as an opaque upstream error.
				if (platform === 'tiktok') {
					throw new NodeOperationError(ctx.node.getNode(), 'TikTok comments are looked up by video ID, not by URL. Paste the numeric video ID instead.', {
						itemIndex: ctx.itemIndex,
					});
				}
				qs.post_url = postId;
			} else {
				qs.post_id = postId;
			}
			// Same question, one parameter more: with a comment the API answers with
			// its replies instead of the top-level comments of the post.
			const commentId = ctx.node.getNodeParameter('commentsCommentId', ctx.itemIndex, '') as string;
			if (commentId) qs.comment_id = commentId;
			return {
				endpoint: '/uploadposts/comments',
				method: 'GET',
				qs,
				isUploadOperation: false,
				waitForCompletion: false,
			};
		}
		case 'privateReplyToComment': {
			const user = ctx.node.getNodeParameter('instagramUser', ctx.itemIndex) as string;
			const commentId = ctx.node.getNodeParameter('instagramCommentId', ctx.itemIndex) as string;
			const message = ctx.node.getNodeParameter('instagramReplyMessage', ctx.itemIndex) as string;
			return {
				endpoint: '/uploadposts/comments/reply',
				method: 'POST',
				body: { platform: 'instagram', user, comment_id: commentId, message },
				isUploadOperation: false,
				waitForCompletion: false,
			};
		}
		case 'publicReplyToComment': {
			const user = ctx.node.getNodeParameter('instagramUser', ctx.itemIndex) as string;
			const commentId = ctx.node.getNodeParameter('instagramCommentId', ctx.itemIndex) as string;
			const message = ctx.node.getNodeParameter('instagramReplyMessage', ctx.itemIndex) as string;
			return {
				endpoint: '/uploadposts/comments/public-reply',
				method: 'POST',
				body: { platform: 'instagram', user, comment_id: commentId, message },
				isUploadOperation: false,
				waitForCompletion: false,
			};
		}
		case 'createComment': {
			const user = ctx.node.getNodeParameter('instagramUser', ctx.itemIndex) as string;
			const platform = ctx.node.getNodeParameter('commentPlatform', ctx.itemIndex, 'instagram') as string;
			const body: IDataObject = {
				platform,
				user,
				message: ctx.node.getNodeParameter('createCommentMessage', ctx.itemIndex) as string,
			};
			const commentId = ctx.node.getNodeParameter('createCommentCommentId', ctx.itemIndex, '') as string;
			const postId = ctx.node.getNodeParameter('createCommentPostId', ctx.itemIndex, '') as string;
			const postUrl = ctx.node.getNodeParameter('createCommentPostUrl', ctx.itemIndex, '') as string;
			if (commentId) body.comment_id = commentId;
			if (postId) body.post_id = postId;
			if (postUrl && !postId) body.post_url = postUrl;
			return {
				endpoint: '/uploadposts/comments/create',
				method: 'POST',
				body,
				isUploadOperation: false,
				waitForCompletion: false,
			};
		}
		case 'deleteComment': {
			const user = ctx.node.getNodeParameter('instagramUser', ctx.itemIndex) as string;
			const platform = ctx.node.getNodeParameter('commentPlatform', ctx.itemIndex, 'instagram') as string;
			const body: IDataObject = {
				platform,
				user,
				comment_id: ctx.node.getNodeParameter('createCommentCommentId', ctx.itemIndex) as string,
			};
			const postId = ctx.node.getNodeParameter('createCommentPostId', ctx.itemIndex, '') as string;
			if (postId) body.post_id = postId;
			return {
				endpoint: '/uploadposts/comments/delete',
				method: 'DELETE',
				body,
				isUploadOperation: false,
				waitForCompletion: false,
			};
		}
		case 'commentAction': {
			const user = ctx.node.getNodeParameter('instagramUser', ctx.itemIndex) as string;
			const platform = ctx.node.getNodeParameter('commentActionPlatform', ctx.itemIndex, 'tiktok') as string;
			const action = ctx.node.getNodeParameter('commentModerationAction', ctx.itemIndex) as string;
			const body: IDataObject = {
				platform,
				user,
				comment_id: ctx.node.getNodeParameter('instagramCommentId', ctx.itemIndex) as string,
				action,
			};
			// Liking takes the comment alone; hiding and pinning act on a comment
			// inside a post, so the post is part of the address.
			if (!COMMENT_ACTIONS_WITHOUT_POST.has(action)) {
				const postId = ctx.node.getNodeParameter('commentActionPostId', ctx.itemIndex, '') as string;
				if (!postId) {
					throw new NodeOperationError(ctx.node.getNode(), `A Post ID is required to ${action} a comment.`, {
						itemIndex: ctx.itemIndex,
					});
				}
				body.post_id = postId;
			}
			return {
				endpoint: '/uploadposts/comments/action',
				method: 'POST',
				body,
				isUploadOperation: false,
				waitForCompletion: false,
			};
		}
		default:
			throw new NodeOperationError(ctx.node.getNode(), `Unsupported Instagram operation: ${ctx.operation}`, {
				itemIndex: ctx.itemIndex,
			});
	}
};

// Both insight questions are asked the same way: one endpoint, and a `platform`
// that says which connected network answers it.
const buildInsightsRequest = (ctx: ExecutionContext): RequestConfig => {
	const user = ctx.node.getNodeParameter('insightsUser', ctx.itemIndex) as string;
	const platform = ctx.node.getNodeParameter('insightsPlatform', ctx.itemIndex, 'tiktok') as string;

	switch (ctx.operation) {
		case 'getAudience': {
			const qs: IDataObject = { user, platform };
			// The server clamps the window (60 days at most, always below today), so
			// a wider range is trimmed rather than rejected: nothing to check here.
			const startDate = ctx.node.getNodeParameter('audienceStartDate', ctx.itemIndex, '') as string;
			if (startDate) qs.start_date = startDate.slice(0, 10);
			const endDate = ctx.node.getNodeParameter('audienceEndDate', ctx.itemIndex, '') as string;
			if (endDate) qs.end_date = endDate.slice(0, 10);
			// Without a category the response still carries benchmark_categories, so a
			// picker never needs a second call.
			const benchmarkCategory = ctx.node.getNodeParameter('audienceBenchmarkCategory', ctx.itemIndex, '') as string;
			if (benchmarkCategory) qs.benchmark_category = benchmarkCategory;
			return {
				endpoint: '/uploadposts/audience',
				method: 'GET',
				qs,
				isUploadOperation: false,
				waitForCompletion: false,
			};
		}
		case 'getSuggestions': {
			const qs: IDataObject = {
				user,
				platform,
				type: ctx.node.getNodeParameter('suggestionsType', ctx.itemIndex) as string,
			};
			const query = ctx.node.getNodeParameter('suggestionsQuery', ctx.itemIndex, '') as string;
			if (query) qs.q = query;
			const countryCode = ctx.node.getNodeParameter('suggestionsCountryCode', ctx.itemIndex, '') as string;
			if (countryCode) qs.country_code = countryCode;
			const language = ctx.node.getNodeParameter('suggestionsLanguage', ctx.itemIndex, '') as string;
			if (language) qs.language = language;
			return {
				endpoint: '/uploadposts/suggestions',
				method: 'GET',
				qs,
				isUploadOperation: false,
				waitForCompletion: false,
			};
		}
		default:
			throw new NodeOperationError(ctx.node.getNode(), `Unsupported insights operation: ${ctx.operation}`, {
				itemIndex: ctx.itemIndex,
			});
	}
};

const buildRequestConfig = async (ctx: ExecutionContext): Promise<RequestConfig> => {
	if (ctx.operation === 'uploadPhotos') {
		return buildUploadPhotosRequest(ctx);
	}
	if (ctx.operation === 'uploadVideo') {
		return buildUploadVideoRequest(ctx);
	}
	if (ctx.operation === 'uploadText') {
		return buildUploadTextRequest(ctx);
	}
	if (ctx.operation === 'uploadDocument') {
		return buildUploadDocumentRequest(ctx);
	}

	const resource = ctx.node.getNodeParameter('resource', ctx.itemIndex) as string;
	if (resource === 'instagram') {
		return buildInstagramRequest(ctx);
	}
	if (resource === 'insights') {
		return buildInsightsRequest(ctx);
	}
	if (resource === 'monitoring') {
		return buildMonitoringRequest(ctx);
	}
	if (resource === 'postActions') {
		return buildPostActionRequest(ctx);
	}
	if (resource === 'users') {
		return await buildUserRequest(ctx);
	}

	throw new NodeOperationError(ctx.node.getNode(), `Unsupported operation: ${ctx.operation}`, {
		itemIndex: ctx.itemIndex,
	});
};

const buildNativeFormData = (payload: MultipartPayload, node: IExecuteFunctions): NativeFormData => {
	if (typeof FormData === 'undefined') {
		throw new NodeOperationError(node.getNode(), 'FormData is not supported in this runtime environment');
	}
	const form = new FormData();
	for (const [key, value] of Object.entries(payload)) {
		if (Array.isArray(value)) {
			value.forEach(item => appendValue(form, key, item));
		} else {
			appendValue(form, key, value);
		}
	}
	return form;
};

const appendValue = (form: NativeFormData, key: string, value: MultipartValue) => {
	if (isBinaryFormField(value)) {
		appendBinaryValue(form, key, value);
	} else {
		form.append(key, value);
	}
};

const appendBinaryValue = (form: NativeFormData, key: string, field: BinaryFormField) => {
	const { value, options } = field;
	if (typeof value === 'string') {
		form.append(key, value);
		return;
	}

	const filename = options?.filename ?? 'upload.bin';
	const contentType = options?.contentType ?? 'application/octet-stream';

	if (typeof Blob !== 'undefined') {
		const blob = new Blob([value], { type: contentType });
		form.append(key, blob, filename);
		return;
	}

	form.append(key, value, { filename, contentType });
};

const pollUploadStatus = async (
	node: IExecuteFunctions,
	requestId: string,
	pollInterval: number,
	pollTimeout: number,
): Promise<any> => {
	const start = Date.now();
	let finalData: any = { success: false, message: 'Polling timed out', request_id: requestId };
	let isPolling = true; while (isPolling) {
		await sleep(Math.max(1, pollInterval) * 1000);
		if (Date.now() - start > Math.max(5, pollTimeout) * 1000) {
			break;
		}
		const statusOptions: IHttpRequestOptions = {
			url: `${API_BASE_URL}/uploadposts/status`,
			method: 'GET',
			qs: { request_id: requestId },
			headers: { 'X-Upload-Post-Source': 'n8n' },
			json: true,
		};
		const statusData = await node.helpers.httpRequestWithAuthentication.call(node, 'uploadPostApi', statusOptions);
		finalData = statusData;
		const statusValue = (statusData && (statusData as any).status) as string | undefined;
		if (typeof statusValue === 'string' && TERMINAL_UPLOAD_STATUSES.includes(statusValue.toLowerCase())) {
			break;
		}
	}
	return finalData;
};

export class UploadPost implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Upload Post',
		name: 'uploadPost',
		icon: 'file:uploadpost.svg',
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Upload content to social media via Upload-Post API',
		defaults: {
			name: 'Upload Post',
		},
		usableAsTool: true,
		inputs: [NodeConnectionType.Main],
		outputs: [NodeConnectionType.Main],
		credentials: [
			{
				name: 'uploadPostApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					// Value kept as 'instagram' so saved workflows keep working; the
					// listing operation is no longer Instagram-only, hence the label.
					{ name: 'Comment', value: 'instagram' },
					{ name: 'Insight', value: 'insights' },
					{ name: 'Post Action', value: 'postActions' },
					{ name: 'Status & History', value: 'monitoring' },
					{ name: 'Upload', value: 'uploads' },
					{ name: 'User', value: 'users' },
				],
				default: 'uploads',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Upload Document', value: 'uploadDocument', action: 'Upload a document', description: 'Upload a document (PDF, PPT, PPTX, DOC, DOCX) as a native carousel/viewer (Supports: LinkedIn only)' },
					{ name: 'Upload Photo(s)', value: 'uploadPhotos', action: 'Upload photos', description: 'Upload one or more photos (Supports: Bluesky, Discord, Facebook, Google Business, Instagram, Lemmy, LinkedIn, Mastodon, Pinterest, Reddit, Telegram, Threads, TikTok, WordPress, X)' },
					{ name: 'Upload Text', value: 'uploadText', action: 'Upload a text post', description: 'Upload a text-based post (Supports: Bluesky, Dev.to, Discord, Facebook, Google Business, Hashnode, Lemmy, LinkedIn, Listmonk, Mastodon, Nostr, Reddit, Slack, Telegram, Threads, Whop, WordPress, X)' },
					{ name: 'Upload Video', value: 'uploadVideo', action: 'Upload a video', description: 'Upload a single video (Supports: Bluesky, Discord, Facebook, Google Business, Instagram, LinkedIn, Mastodon, Pinterest, Reddit, Telegram, Threads, TikTok, WordPress, X, YouTube)' },
				],
				default: 'uploadPhotos',
				displayOptions: { show: { resource: ['uploads'] } },
			},
			// Operations for Status & History
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Cancel Scheduled Post', value: 'cancelScheduled', action: 'Cancel scheduled post', description: 'Cancel a scheduled post by its job ID' },
					{ name: 'Edit Scheduled Post', value: 'editScheduled', action: 'Edit scheduled post', description: 'Edit schedule details (like date/time) by job ID' },
					{ name: 'Get Analytics', value: 'getAnalytics', action: 'Get analytics', description: 'Retrieve aggregated analytics for uploads' },
					{ name: 'Get Cached Post Analytics', value: 'getCachedPostAnalytics', action: 'Get cached post analytics', description: 'Replay per-post metrics already fetched for a profile instead of querying the platforms again, so it is not subject to the live analytics rate limit (100 requests / 5 minutes). Only contains posts previously fetched through Get Post Analytics; there is no background refresh, so captured_at is the last time that post was read live. Use Get Post Analytics to refresh a post, and this operation for bulk re-reads.' },
					{ name: 'Get Google Business Locations', value: 'getGoogleBusinessLocations', action: 'Get google business locations', description: 'List Google Business Profile locations for a profile' },
					{ name: 'Get Job Status', value: 'getJobStatus', action: 'Get job status', description: 'Check the status of a scheduled or queued post using the job_id' },
					{ name: 'Get Media', value: 'getMedia', action: 'Get media', description: 'List published media for a connected network (LinkedIn, Facebook, Instagram, YouTube, and others the API exposes)' },
					{ name: 'Get Platform Metrics', value: 'getPlatformMetrics', action: 'Get platform metrics', description: 'List the analytics metrics available for each platform' },
					{ name: 'Get Post Analytics', value: 'getPostAnalytics', action: 'Get post analytics', description: 'Retrieve per-post analytics for an upload using its request_id. On TikTok post_metrics also carries retention, impression_sources, audience_types, new_followers, reach and the watch times.' },
					{ name: 'Get Post Analytics by Platform ID', value: 'getPostAnalyticsByPlatformId', action: 'Get post analytics by platform id', description: 'Retrieve per-post analytics using the native platform post ID, for posts not published through Upload-Post' },
					{ name: 'Get Reddit Detailed Posts', value: 'getRedditDetailedPosts', action: 'Get reddit detailed posts', description: 'Retrieve detailed Reddit posts with full media information' },
					{ name: 'Get TikTok Locations', value: 'getTiktokLocations', action: 'Get tiktok locations', description: 'Search TikTok locations for a profile to use as tiktok_location_id' },
					{ name: 'Get TikTok Publishing Settings', value: 'getTiktokSettings', action: 'Get tiktok publishing settings', description: 'Read the TikTok creator info and capabilities for a profile (privacy levels, music, comments, draft, ...)' },
					{ name: 'Get TikTok Trending Music', value: 'getTiktokTrendingMusic', action: 'Get tiktok trending music', description: 'List trending TikTok tracks for a connected profile' },
					{ name: 'Get Total Impressions', value: 'getTotalImpressions', action: 'Get total impressions', description: 'Retrieve impressions aggregated across connected platforms for a date range' },
					{ name: 'Get Upload History', value: 'getHistory', action: 'Get upload history', description: 'List past uploads with optional filters' },
					{ name: 'Get Upload Status', value: 'getStatus', action: 'Get upload status', description: 'Check the status of an upload using the request_id' },
					{ name: 'List Scheduled Posts', value: 'listScheduled', action: 'List scheduled posts', description: 'List your scheduled (future) posts' },
					{ name: 'Search TikTok Music', value: 'searchTiktokMusic', action: 'Search tiktok music', description: 'Search TikTok music by query for a connected profile' },
				],
				default: 'getStatus',
				displayOptions: { show: { resource: ['monitoring'] } },
			},
			// Operations for Users
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Create User', value: 'createUser', action: 'Create user', description: 'Create a new Upload-Post user (profile name)' },
					{ name: 'Delete User', value: 'deleteUser', action: 'Delete user', description: 'Delete an existing Upload-Post user by profile name' },
					{ name: 'Generate JWT (for Platform Integration)', value: 'generateJwt', action: 'Generate jwt for platform integration', description: 'Generate a connection URL (JWT) for a profile. Only needed when integrating Upload-Post into your own platform.' },
					{ name: 'Get Notification Preferences', value: 'getNotificationPrefs', action: 'Get notification preferences', description: 'Get current webhook and notification settings' },
					{ name: 'Get User Preferences', value: 'getUserPreferences', action: 'Get user preferences', description: 'Get user preferences including calendar week start day' },
					{ name: 'List Users', value: 'listUsers', action: 'List users', description: 'List Upload-Post users (profiles)' },
					{ name: 'Test Notifications', value: 'testNotifications', action: 'Test notifications', description: 'Send a test event to the configured webhook and notification channels' },
					{ name: 'Update Notification Preferences', value: 'updateNotificationPrefs', action: 'Update notification preferences', description: 'Configure webhook URL and event types for real-time notifications (upload_completed, social_account.connected, social_account.disconnected, social_account.reauth_required)' },
					{ name: 'Update User Preferences', value: 'updateUserPreferences', action: 'Update user preferences', description: 'Update user preferences including calendar week start day (0=Sunday, 1=Monday)' },
					{ name: 'Validate JWT (for Platform Integration)', value: 'validateJwt', action: 'Validate jwt for platform integration', description: 'Validate a connection token from your backend. Only needed for custom platform integration.' },
				],
				default: 'listUsers',
				displayOptions: { show: { resource: ['users'] } },
			},
			// Operations for Instagram
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Comment Action', value: 'commentAction', action: 'Act on a comment', description: 'Moderate one comment: hide, unhide, like, unlike, pin or unpin it. Platform says which connected network the comment lives on. Post ID is required to hide, unhide, pin or unpin, and is never sent for like or unlike.' },
					{ name: 'Create Comment', value: 'createComment', action: 'Create a comment', description: 'Post a comment or a reply. Instagram only supports replies (comment ID required). TikTok always needs the video ID, plus comment ID to reply.' },
					{ name: 'Delete Comment', value: 'deleteComment', action: 'Delete a comment', description: 'Delete a comment you own or that is on your post' },
					{ name: 'Get Post Comments', value: 'getPostComments', action: 'Get post comments', description: 'Retrieve the comments on a post from the network given by Platform (Instagram, Facebook, YouTube, LinkedIn or TikTok). Fill Comment ID to get the replies to that comment instead of the top-level comments of the post.' },
					{ name: 'Private Reply to Comment', value: 'privateReplyToComment', action: 'Private reply to comment', description: 'Send a private reply (DM) to the author of a comment. Instagram only.' },
					{ name: 'Public Reply to Comment', value: 'publicReplyToComment', action: 'Public reply to comment', description: 'Post a public reply visible under the original comment. Instagram only.' },
				],
				default: 'getPostComments',
				displayOptions: { show: { resource: ['instagram'] } },
			},
			// Instagram operation parameters
			{
				displayName: 'User Identifier Name or ID',
				name: 'instagramUser',
				type: 'options',
				noDataExpression: true,
				required: true,
				default: '',
				description: 'Choose from your created profiles. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
				typeOptions: { loadOptionsMethod: 'getUserProfiles' },
				displayOptions: {
					show: {
						resource: ['instagram'],
						operation: ['getPostComments', 'privateReplyToComment', 'publicReplyToComment', 'commentAction', 'createComment', 'deleteComment'],
					},
				},
			},
			{
				displayName: 'Platform',
				name: 'commentPlatform',
				type: 'options',
				options: [
					{ name: 'Bluesky', value: 'bluesky' },
					{ name: 'Facebook', value: 'facebook' },
					{ name: 'Instagram', value: 'instagram' },
					{ name: 'LinkedIn', value: 'linkedin' },
					{ name: 'Threads', value: 'threads' },
					{ name: 'TikTok', value: 'tiktok' },
					{ name: 'X (Twitter)', value: 'x' },
					{ name: 'YouTube', value: 'youtube' },
				],
				default: 'instagram',
				description: 'Network the post lives on. TikTok needs the "comments" capability on the profile (see the capabilities array returned by List Users); an account connected before that capability existed has to reconnect TikTok.',
				displayOptions: {
					show: {
						resource: ['instagram'],
						operation: ['getPostComments', 'createComment', 'deleteComment'],
					},
				},
			},
			{
				displayName: 'Comment ID',
				name: 'commentsCommentId',
				type: 'string',
				default: '',
				description: 'Leave empty for the top-level comments of the post. Set it to a comment ID to get the replies to that comment instead: it is the same question with one parameter more.',
				displayOptions: {
					show: {
						resource: ['instagram'],
						operation: ['getPostComments'],
					},
				},
			},
			{
				displayName: 'Post ID or URL',
				name: 'instagramPostId',
				type: 'string',
				required: true,
				default: '',
				description: 'Post identifier. Instagram and Facebook accept the numeric media ID or the post URL, YouTube the video ID, LinkedIn the post URN, TikTok the video ID (TikTok has no URL lookup).',
				displayOptions: {
					show: {
						resource: ['instagram'],
						operation: ['getPostComments'],
					},
				},
			},
			{
				displayName: 'Comment ID',
				name: 'instagramCommentId',
				type: 'string',
				required: true,
				default: '',
				description: 'The ID of the comment to reply to or act on (from Get Post Comments)',
				displayOptions: {
					show: {
						resource: ['instagram'],
						operation: ['privateReplyToComment', 'publicReplyToComment', 'commentAction'],
					},
				},
			},
			{
				displayName: 'Platform',
				name: 'commentActionPlatform',
				type: 'options',
				required: true,
				options: [
					{ name: 'TikTok', value: 'tiktok' },
				],
				default: 'tiktok',
				description: 'Network the comment lives on. TikTok is the network that answers this question today; any other one replies with platform_not_supported and the list of the ones that can. On TikTok the profile needs the "comments" capability (see the capabilities array returned by List Users); an account connected before that capability existed has to reconnect TikTok.',
				displayOptions: { show: { resource: ['instagram'], operation: ['commentAction'] } },
			},
			{
				displayName: 'Action',
				name: 'commentModerationAction',
				type: 'options',
				required: true,
				options: [
					{ name: 'Hide', value: 'hide' },
					{ name: 'Like', value: 'like' },
					{ name: 'Pin', value: 'pin' },
					{ name: 'Unhide', value: 'unhide' },
					{ name: 'Unlike', value: 'unlike' },
					{ name: 'Unpin', value: 'unpin' },
				],
				default: 'hide',
				description: 'What to do with the comment. Each action carries its own inverse, so there is no separate toggle: hide/unhide change its visibility, like/unlike react to it as the account, pin/unpin move it to the top of the thread.',
				displayOptions: { show: { resource: ['instagram'], operation: ['commentAction'] } },
			},
			{
				displayName: 'Post ID',
				name: 'commentActionPostId',
				type: 'string',
				required: true,
				default: '',
				description: 'Native ID of the post the comment hangs from, as the platform assigns it (on TikTok, the video ID). Required to hide, unhide, pin or unpin; it is not sent for like or unlike, which the API rejects when it carries a post.',
				displayOptions: {
					show: {
						resource: ['instagram'],
						operation: ['commentAction'],
						commentModerationAction: ['hide', 'unhide', 'pin', 'unpin'],
					},
				},
			},
			{
				displayName: 'Message',
				name: 'instagramReplyMessage',
				type: 'string',
				required: true,
				default: '',
				description: 'The reply message text',
				typeOptions: { rows: 3 },
				displayOptions: {
					show: {
						resource: ['instagram'],
						operation: ['privateReplyToComment', 'publicReplyToComment'],
					},
				},
			},
			{
				displayName: 'Comment ID',
				name: 'createCommentCommentId',
				type: 'string',
				default: '',
				description: 'Reply to this comment. Required for Instagram. On TikTok add it together with Post ID to reply instead of posting a top-level comment.',
				displayOptions: {
					show: {
						resource: ['instagram'],
						operation: ['createComment', 'deleteComment'],
					},
				},
			},
			{
				displayName: 'Post ID',
				name: 'createCommentPostId',
				type: 'string',
				default: '',
				description: 'Native post ID for a top-level comment. Required on TikTok (video ID) even when replying. LinkedIn uses the post URN.',
				displayOptions: {
					show: {
						resource: ['instagram'],
						operation: ['createComment', 'deleteComment'],
					},
				},
			},
			{
				displayName: 'Post URL',
				name: 'createCommentPostUrl',
				type: 'string',
				default: '',
				description: 'Alternative to Post ID for a top-level comment. Ignored when Post ID is set.',
				displayOptions: {
					show: {
						resource: ['instagram'],
						operation: ['createComment'],
					},
				},
			},
			{
				displayName: 'Message',
				name: 'createCommentMessage',
				type: 'string',
				required: true,
				default: '',
				description: 'Comment text to publish',
				typeOptions: { rows: 3 },
				displayOptions: {
					show: {
						resource: ['instagram'],
						operation: ['createComment'],
					},
				},
			},

			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Edit Post', value: 'editPost', action: 'Edit a published post', description: 'Update caption or metadata on a live post. Fields you omit are left unchanged.' },
					{ name: 'Repost', value: 'repostPost', action: 'Repost a post', description: 'Repost on LinkedIn or X' },
					{ name: 'Retry Post', value: 'retryPost', action: 'Retry a failed upload', description: 'Re-enqueue platforms that failed on an upload without re-uploading media. Provide request ID or job ID.' },
					{ name: 'Save Pin', value: 'savePin', action: 'Save a pinterest pin', description: 'Save a Pinterest pin to a board' },
					{ name: 'Unpublish Post', value: 'unpublishPost', action: 'Unpublish a post', description: 'Delete a live post from a platform. Instagram, TikTok and Threads are not supported.' },
				],
				default: 'retryPost',
				displayOptions: { show: { resource: ['postActions'] } },
			},
			{
				displayName: 'User Identifier Name or ID',
				name: 'postActionUser',
				type: 'options',
				noDataExpression: true,
				required: true,
				default: '',
				description: 'Choose from your created profiles. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
				typeOptions: { loadOptionsMethod: 'getUserProfiles' },
				displayOptions: {
					show: {
						resource: ['postActions'],
						operation: ['unpublishPost', 'editPost', 'repostPost', 'savePin'],
					},
				},
			},
			{
				displayName: 'Platform',
				name: 'postActionPlatform',
				type: 'options',
				required: true,
				options: [
					{ name: 'Bluesky', value: 'bluesky' },
					{ name: 'Discord', value: 'discord' },
					{ name: 'Facebook', value: 'facebook' },
					{ name: 'Google Business', value: 'google_business' },
					{ name: 'LinkedIn', value: 'linkedin' },
					{ name: 'Mastodon', value: 'mastodon' },
					{ name: 'Pinterest', value: 'pinterest' },
					{ name: 'Telegram', value: 'telegram' },
					{ name: 'WordPress', value: 'wordpress' },
					{ name: 'X (Twitter)', value: 'x' },
					{ name: 'YouTube', value: 'youtube' },
				],
				default: 'facebook',
				description: 'Network to act on. Unpublish is not available for Instagram, TikTok or Threads.',
				displayOptions: {
					show: {
						resource: ['postActions'],
						operation: ['unpublishPost', 'editPost'],
					},
				},
			},
			{
				displayName: 'Platform',
				name: 'repostPlatform',
				type: 'options',
				required: true,
				options: [
					{ name: 'LinkedIn', value: 'linkedin' },
					{ name: 'X (Twitter)', value: 'x' },
				],
				default: 'linkedin',
				description: 'Network to repost on',
				displayOptions: { show: { resource: ['postActions'], operation: ['repostPost'] } },
			},
			{
				displayName: 'Request ID',
				name: 'retryRequestId',
				type: 'string',
				default: '',
				description: 'Request ID of the original upload. Provide this or Job ID.',
				displayOptions: { show: { resource: ['postActions'], operation: ['retryPost'] } },
			},
			{
				displayName: 'Job ID',
				name: 'retryJobId',
				type: 'string',
				default: '',
				description: 'Scheduled job ID of the original upload. Alternative to Request ID.',
				displayOptions: { show: { resource: ['postActions'], operation: ['retryPost'] } },
			},
			{
				displayName: 'Post ID',
				name: 'postActionPostId',
				type: 'string',
				required: true,
				default: '',
				description: 'Native ID of the published post on the target network',
				displayOptions: {
					show: {
						resource: ['postActions'],
						operation: ['unpublishPost', 'editPost', 'repostPost', 'savePin'],
					},
				},
			},
			{
				displayName: 'Message',
				name: 'postActionMessage',
				type: 'string',
				default: '',
				description: 'New caption. Facebook uses message, X uses text, LinkedIn uses commentary.',
				displayOptions: { show: { resource: ['postActions'], operation: ['editPost', 'repostPost'] } },
			},
			{
				displayName: 'Pinterest Board ID',
				name: 'savePinBoardId',
				type: 'string',
				required: true,
				default: '',
				description: 'Board to save the pin to',
				displayOptions: { show: { resource: ['postActions'], operation: ['savePin'] } },
			},
			{
				displayName: 'Pinterest Board Section ID',
				name: 'savePinBoardSectionId',
				type: 'string',
				default: '',
				description: 'Optional board section to save the pin to',
				displayOptions: { show: { resource: ['postActions'], operation: ['savePin'] } },
			},

			// Operations for Insights
			// One endpoint per QUESTION with a `platform` that says who is asked,
			// which is how the API is shaped: there is no endpoint per network.
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Get Audience', value: 'getAudience', action: 'Get audience', description: 'Ask a connected network who follows the profile: audience countries, cities, age brackets and genders, how many followers are online each hour, daily followers gained and lost, profile actions and the bio. Platform says which network answers. Pass a Benchmark Category to also get that niche averages (comments, engagement rate, follower count and growth, likes, shares, video count and views) next to the numbers of the account; every response lists the 25 accepted categories in benchmark_categories. Use this to know WHO the audience is and WHEN to post; use Get Post Analytics for how a given post did.' },
					{ name: 'Get Suggestions', value: 'getSuggestions', action: 'Get suggestions', description: 'Ask a connected network what to write about: hashtags (each with its view count) or the searches people run, around a seed word. Type picks which of the two, Platform says which network answers. Use this before writing a caption to pick hashtags or find the wording an audience searches for.' },
				],
				default: 'getAudience',
				displayOptions: { show: { resource: ['insights'] } },
			},
			// Insights operation parameters
			{
				displayName: 'User Identifier Name or ID',
				name: 'insightsUser',
				type: 'options',
				noDataExpression: true,
				required: true,
				default: '',
				description: 'Upload-Post profile whose connected account answers the question. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
				typeOptions: { loadOptionsMethod: 'getUserProfiles' },
				displayOptions: { show: { resource: ['insights'] } },
			},
			{
				displayName: 'Platform',
				name: 'insightsPlatform',
				type: 'options',
				required: true,
				options: [
					{ name: 'TikTok', value: 'tiktok' },
				],
				default: 'tiktok',
				description: 'Network that answers the question. TikTok is the network that answers this question today; any other one replies with platform_not_supported and the list of the ones that can. On TikTok the profile needs the "profile_analytics" capability (see the capabilities array returned by List Users).',
				displayOptions: { show: { resource: ['insights'] } },
			},
			{
				displayName: 'Start Date',
				name: 'audienceStartDate',
				type: 'string',
				default: '',
				placeholder: 'YYYY-MM-DD',
				description: 'First day of the window. The server clamps the range to 60 days at most and always below today, so a wider window is trimmed instead of rejected. Leave empty for the default range.',
				displayOptions: { show: { resource: ['insights'], operation: ['getAudience'] } },
			},
			{
				displayName: 'End Date',
				name: 'audienceEndDate',
				type: 'string',
				default: '',
				placeholder: 'YYYY-MM-DD',
				description: 'Last day of the window. The server moves it below today, because there are no audience numbers for the current day yet.',
				displayOptions: { show: { resource: ['insights'], operation: ['getAudience'] } },
			},
			{
				displayName: 'Benchmark Category',
				name: 'audienceBenchmarkCategory',
				type: 'string',
				default: '',
				placeholder: 'SOFTWARE_AND_APPS',
				description: 'Niche to compare the account against, which adds a benchmark object to the response. Leave empty to skip the comparison: the accepted values come back in benchmark_categories on every response anyway, so no extra call is needed to fill a picker.',
				displayOptions: { show: { resource: ['insights'], operation: ['getAudience'] } },
			},
			{
				displayName: 'Type',
				name: 'suggestionsType',
				type: 'options',
				required: true,
				options: [
					{ name: 'Hashtags', value: 'hashtags' },
					{ name: 'Keywords', value: 'keywords' },
				],
				default: 'hashtags',
				description: 'Which suggestions you want. Hashtags answers with a list of name and view_count; keywords answers with the searches people run around the word.',
				displayOptions: { show: { resource: ['insights'], operation: ['getSuggestions'] } },
			},
			{
				displayName: 'Query',
				name: 'suggestionsQuery',
				type: 'string',
				default: '',
				description: 'Seed word to get suggestions around, written without the "#"',
				displayOptions: { show: { resource: ['insights'], operation: ['getSuggestions'] } },
			},
			{
				displayName: 'Country Code',
				name: 'suggestionsCountryCode',
				type: 'string',
				default: '',
				placeholder: 'ES',
				description: 'ISO 3166-1 alpha-2 country to bias the suggestions towards, e.g. ES or US',
				displayOptions: { show: { resource: ['insights'], operation: ['getSuggestions'] } },
			},
			{
				displayName: 'Language',
				name: 'suggestionsLanguage',
				type: 'string',
				default: '',
				placeholder: 'es',
				description: 'Language code to bias the suggestions towards, e.g. es or en',
				displayOptions: { show: { resource: ['insights'], operation: ['getSuggestions'] } },
			},

		// Common Fields for all operations
			{
				displayName: 'User Identifier Name or ID',
				name: 'user',
				type: 'options',
				noDataExpression: true,
				required: true,
				default: '',
				description: 'Choose from your created profiles, or specify a profile name using an <a href="https://docs.n8n.io/code/expressions/">expression</a>. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
				typeOptions: { loadOptionsMethod: 'getUserProfiles' },
				displayOptions: {
					show: {
						resource: ['uploads','users'],
						operation: ['uploadPhotos','uploadVideo','uploadText','uploadDocument','generateJwt']
					}
				},
			},
			{
				displayName: 'User Identifier (Manual Entry)',
				name: 'userManual',
				type: 'string',
				required: true,
				default: '',
				description: 'Provide a profile name or ID when it does not appear in the list',
				displayOptions: {
					show: {
						resource: ['uploads','users'],
						operation: ['uploadPhotos','uploadVideo','uploadText','uploadDocument','generateJwt'],
						user: [MANUAL_USER_VALUE]
					}
				},
			},
			{
				displayName: 'Platform Names or IDs',
				name: 'platform',
				type: 'multiOptions',
				required: true,
				typeOptions: { loadOptionsMethod: 'getPlatforms' },
				default: [],
				description: 'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				displayOptions: { show: { resource: ['uploads'], operation: ['uploadPhotos','uploadVideo','uploadText','uploadDocument'] } },
			},
			{
				displayName: 'Title / Main Content',
				name: 'title',
				type: 'string',
				default: '',
				description: 'Title of the post. Required for YouTube, Reddit, and text posts. Optional for TikTok, Instagram, Facebook, LinkedIn, X, Threads, Bluesky, Pinterest. For Upload Text, this is the main text content.',
				displayOptions: { show: { resource: ['uploads'], operation: ['uploadPhotos','uploadVideo','uploadText','uploadDocument'] } },
			},
			{
				displayName: 'First Comment',
				name: 'firstComment',
				type: 'string',
				default: '',
				description: 'Text to post as the first comment (or reply) immediately after publishing. Supported on Instagram, Facebook, X, Threads, YouTube, Reddit, Bluesky, LinkedIn and TikTok. On TikTok the profile needs the "comments" capability (see the capabilities array returned by List Users).',
				displayOptions: { show: { resource: ['uploads'], operation: ['uploadPhotos','uploadVideo','uploadText'] } },
			},
			{
				displayName: 'First Comment Media URLs',
				name: 'firstCommentMedia',
				type: 'string',
				default: '',
				description: 'Comma-separated media URLs to attach to the first comment, when the platform accepts it',
				displayOptions: { show: { resource: ['uploads'], operation: ['uploadPhotos','uploadVideo','uploadText'] } },
			},
			{
				displayName: 'Reply To ID',
				name: 'replyToId',
				type: 'string',
				default: '',
				description: 'ID of an existing post to reply to. X uses a tweet ID; Bluesky uses a post URL or AT-URI.',
				displayOptions: { show: { operation: ['uploadPhotos','uploadVideo','uploadText'], platform: ['x', 'bluesky', '__manual_platform__'] } },
			},
			{
				displayName: 'Alt Text (Extended)',
				name: 'altText',
				type: 'string',
				default: '',
				description: 'Alternative text for images. Supported on LinkedIn, Pinterest, and others.',
				displayOptions: { show: { resource: ['uploads'], operation: ['uploadPhotos'] } },
			},
				// Platform-specific Title Overrides (appear when the platform is selected)
				{
					displayName: 'Bluesky Title (Override)',
					name: 'blueskyTitle',
					type: 'string',
					default: '',
					description: 'Optional override for Bluesky title (max 300 characters)',
					displayOptions: { show: { operation: ['uploadPhotos','uploadVideo','uploadText'], platform: ['bluesky', '__manual_platform__'] } },
				},
				{
					displayName: 'Instagram Title (Override)',
					name: 'instagramTitle',
					type: 'string',
					default: '',
					description: 'Optional override for Instagram title',
					displayOptions: { show: { operation: ['uploadPhotos','uploadVideo','uploadText'], platform: ['instagram', '__manual_platform__'] } },
				},
				{
					displayName: 'Facebook Title (Override)',
					name: 'facebookTitle',
					type: 'string',
					default: '',
					description: 'Optional override for Facebook title',
					displayOptions: { show: { operation: ['uploadPhotos','uploadVideo','uploadText'], platform: ['facebook', '__manual_platform__'] } },
				},
				{
					displayName: 'TikTok Title (Override)',
					name: 'tiktokTitle',
					type: 'string',
					default: '',
					description: 'Optional override for TikTok title (max 90 chars for photos, 2200 for videos)',
					displayOptions: { show: { operation: ['uploadPhotos','uploadVideo','uploadText'], platform: ['tiktok', '__manual_platform__'] } },
				},
				{
					displayName: 'LinkedIn Title (Override)',
					name: 'linkedinTitle',
					type: 'string',
					default: '',
					description: 'Optional override for LinkedIn title',
					displayOptions: { show: { operation: ['uploadPhotos','uploadVideo','uploadText'], platform: ['linkedin', '__manual_platform__'] } },
				},
				{
					displayName: 'X Title (Override)',
					name: 'xTitle',
					type: 'string',
					default: '',
					description: 'Optional override for X title',
					displayOptions: { show: { operation: ['uploadPhotos','uploadVideo','uploadText'], platform: ['x', '__manual_platform__'] } },
				},
				{
					displayName: 'YouTube Title (Override)',
					name: 'youtubeTitle',
					type: 'string',
					default: '',
					description: 'Optional override for YouTube title',
					displayOptions: { show: { operation: ['uploadPhotos','uploadVideo','uploadText'], platform: ['youtube', '__manual_platform__'] } },
				},
				{
					displayName: 'Pinterest Title (Override)',
					name: 'pinterestTitle',
					type: 'string',
					default: '',
					description: 'Optional override for Pinterest title',
					displayOptions: { show: { operation: ['uploadPhotos','uploadVideo','uploadText'], platform: ['pinterest', '__manual_platform__'] } },
			},
			{
				displayName: 'Threads Title (Override)',
				name: 'threadsTitle',
				type: 'string',
				default: '',
				description: 'Optional override for Threads title',
				displayOptions: { show: { operation: ['uploadPhotos','uploadVideo','uploadText'], platform: ['threads', '__manual_platform__'] } },
			},
			{
				displayName: 'Slack Title (Override)',
				name: 'slackTitle',
				type: 'string',
				default: '',
				description: 'Optional override for Slack title',
				displayOptions: { show: { operation: ['uploadText'], platform: ['slack', '__manual_platform__'] } },
			},
			{
				displayName: 'Mastodon Title (Override)',
				name: 'mastodonTitle',
				type: 'string',
				default: '',
				description: 'Optional override for Mastodon title',
				displayOptions: { show: { operation: ['uploadPhotos','uploadVideo','uploadText'], platform: ['mastodon', '__manual_platform__'] } },
			},
			{
				displayName: 'Nostr Title (Override)',
				name: 'nostrTitle',
				type: 'string',
				default: '',
				description: 'Optional override for Nostr title',
				displayOptions: { show: { operation: ['uploadText'], platform: ['nostr', '__manual_platform__'] } },
			},
			{
				displayName: 'Lemmy Title (Override)',
				name: 'lemmyTitle',
				type: 'string',
				default: '',
				description: 'Optional override for Lemmy title',
				displayOptions: { show: { operation: ['uploadPhotos','uploadText'], platform: ['lemmy', '__manual_platform__'] } },
			},
			{
				displayName: 'Dev.to Title (Override)',
				name: 'devtoTitle',
				type: 'string',
				default: '',
				description: 'Optional override for Dev.to title',
				displayOptions: { show: { operation: ['uploadText'], platform: ['devto', '__manual_platform__'] } },
			},
			{
				displayName: 'Hashnode Title (Override)',
				name: 'hashnodeTitle',
				type: 'string',
				default: '',
				description: 'Optional override for Hashnode title',
				displayOptions: { show: { operation: ['uploadText'], platform: ['hashnode', '__manual_platform__'] } },
			},
			{
				displayName: 'WordPress Title (Override)',
				name: 'wordpressTitle',
				type: 'string',
				default: '',
				description: 'Optional override for WordPress title',
				displayOptions: { show: { operation: ['uploadPhotos','uploadVideo','uploadText'], platform: ['wordpress', '__manual_platform__'] } },
			},
			{
				displayName: 'Whop Title (Override)',
				name: 'whopTitle',
				type: 'string',
				default: '',
				description: 'Optional override for Whop title',
				displayOptions: { show: { operation: ['uploadText'], platform: ['whop', '__manual_platform__'] } },
			},
			{
				displayName: 'Listmonk Title (Override)',
				name: 'listmonkTitle',
				type: 'string',
				default: '',
				description: 'Optional override for Listmonk title',
				displayOptions: { show: { operation: ['uploadText'], platform: ['listmonk', '__manual_platform__'] } },
			},

			// Generic Description & Platform Overrides
			{
				displayName: 'Description (Optional)',
				name: 'description',
				type: 'string',
				default: '',
				description: 'Optional extended description used for LinkedIn commentary, Facebook description/message, YouTube video description, Pinterest description, and TikTok photo captions. Other platforms ignore it. When empty we fall back to the main title where a description is required. Platform-specific overrides below take precedence.',
				displayOptions: {
					show: {
						operation: ['uploadPhotos', 'uploadVideo'],
						platform: ['linkedin', 'facebook', 'youtube', 'pinterest', 'tiktok', '__manual_platform__']
					}
				},
			},
			{
				displayName: 'Facebook Description (Override)',
				name: 'facebookDescription',
				type: 'string',
				default: '',
				description: 'Override for Facebook description/message when supported (Reels/feed, albums). Falls back to the main title when empty.',
				displayOptions: { show: { operation: ['uploadPhotos','uploadVideo'], platform: ['facebook', '__manual_platform__'] } },
			},
			{
				displayName: 'TikTok Description (Override)',
				name: 'tiktokDescription',
				type: 'string',
				default: '',
				description: 'Override for TikTok photo post description. Video uploads ignore this value.',
				displayOptions: { show: { operation: ['uploadPhotos'], platform: ['tiktok', '__manual_platform__'] } },
			},
			{
				displayName: 'LinkedIn Description (Override)',
				name: 'linkedinDescription',
				type: 'string',
				default: '',
				description: 'Override for LinkedIn post commentary. When empty we repeat the main title.',
				displayOptions: { show: { operation: ['uploadPhotos','uploadVideo'], platform: ['linkedin', '__manual_platform__'] } },
			},
			{
				displayName: 'YouTube Description (Override)',
				name: 'youtubeDescription',
				type: 'string',
				default: '',
				description: 'Override for YouTube video description. When empty we default to the main title.',
				displayOptions: { show: { operation: ['uploadVideo'], platform: ['youtube', '__manual_platform__'] } },
			},
			{
				displayName: 'Pinterest Alt Text (Override)',
				name: 'pinterestAltText',
				type: 'string',
				default: '',
				description: 'Optional override for Pinterest alt text',
				displayOptions: { show: { operation: ['uploadPhotos','uploadVideo'], platform: ['pinterest', '__manual_platform__'] } },
			},
			{
				displayName: 'Pinterest Description (Override)',
				name: 'pinterestDescription',
				type: 'string',
				default: '',
				description: 'Override for Pinterest pin description (and alt text fallback). When empty we re-use the main title.',
				displayOptions: { show: { operation: ['uploadPhotos','uploadVideo'], platform: ['pinterest', '__manual_platform__'] } },
			},

			// Platform-specific First Comment Overrides
			{
				displayName: 'Instagram First Comment (Override)',
				name: 'instagramFirstComment',
				type: 'string',
				default: '',
				description: 'Optional override for Instagram first comment. If provided, overrides the generic First Comment for Instagram.',
				displayOptions: { show: { operation: ['uploadPhotos','uploadVideo'], platform: ['instagram', '__manual_platform__'] } },
			},
			{
				displayName: 'Facebook First Comment (Override)',
				name: 'facebookFirstComment',
				type: 'string',
				default: '',
				description: 'Optional override for Facebook first comment. If provided, overrides the generic First Comment for Facebook.',
				displayOptions: { show: { operation: ['uploadPhotos','uploadVideo','uploadText'], platform: ['facebook', '__manual_platform__'] } },
			},
			{
				displayName: 'X First Comment (Override)',
				name: 'xFirstComment',
				type: 'string',
				default: '',
				description: 'Optional override for X (Twitter) first comment/reply. If provided, overrides the generic First Comment for X.',
				displayOptions: { show: { operation: ['uploadPhotos','uploadVideo','uploadText'], platform: ['x', '__manual_platform__'] } },
			},
			{
				displayName: 'Threads First Comment (Override)',
				name: 'threadsFirstComment',
				type: 'string',
				default: '',
				description: 'Optional override for Threads first comment/reply. If provided, overrides the generic First Comment for Threads.',
				displayOptions: { show: { operation: ['uploadPhotos','uploadVideo','uploadText'], platform: ['threads', '__manual_platform__'] } },
			},
			{
				displayName: 'YouTube First Comment (Override)',
				name: 'youtubeFirstComment',
				type: 'string',
				default: '',
				description: 'Optional override for YouTube first comment. If provided, overrides the generic First Comment for YouTube.',
				displayOptions: { show: { operation: ['uploadVideo'], platform: ['youtube', '__manual_platform__'] } },
			},
			{
				displayName: 'Reddit First Comment (Override)',
				name: 'redditFirstComment',
				type: 'string',
				default: '',
				description: 'Optional override for Reddit first comment. If provided, overrides the generic First Comment for Reddit.',
				displayOptions: { show: { operation: ['uploadPhotos','uploadText'], platform: ['reddit', '__manual_platform__'] } },
			},
			{
				displayName: 'Bluesky First Comment (Override)',
				name: 'blueskyFirstComment',
				type: 'string',
				default: '',
				description: 'Optional override for Bluesky first comment/reply. If provided, overrides the generic First Comment for Bluesky.',
				displayOptions: { show: { operation: ['uploadPhotos','uploadVideo','uploadText'], platform: ['bluesky', '__manual_platform__'] } },
			},
			{
				displayName: 'LinkedIn First Comment (Override)',
				name: 'linkedinFirstComment',
				type: 'string',
				default: '',
				description: 'Optional override for LinkedIn first comment. If provided, overrides the generic First Comment for LinkedIn.',
				displayOptions: { show: { operation: ['uploadPhotos','uploadVideo','uploadText','uploadDocument'], platform: ['linkedin', '__manual_platform__'] } },
			},
			{
				displayName: 'TikTok First Comment (Override)',
				name: 'tiktokFirstComment',
				type: 'string',
				default: '',
				description: 'Optional override for the TikTok first comment. If provided, overrides the generic First Comment for TikTok. The profile needs the "comments" capability (see the capabilities array returned by List Users); an account connected before that capability existed has to reconnect TikTok.',
				displayOptions: { show: { operation: ['uploadPhotos','uploadVideo'], platform: ['tiktok', '__manual_platform__'] } },
			},

		// Fields for Upload Photo(s)
			{
				displayName: 'Photos (Files or URLs)',
				name: 'photos',
				type: 'string',
				required: true,
				default: '',
				description: 'Provide photo files or URLs as a comma-separated list (e.g., data,https://example.com/image.jpg,otherImage). For files, enter the binary property name (e.g., data, myImage). For URLs, provide direct HTTP/HTTPS URLs.',
				displayOptions: {
					show: {
						operation: ['uploadPhotos'],
					},
				},
			},

		// Fields for Upload Video
			{
				displayName: 'Video (File or URL)',
				name: 'video',
				type: 'string',
				required: true,
				default: '',
				description: 'The video file to upload or a video URL. For files, enter the binary property name (e.g., data).',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
					},
				},
			},
		// Fields for Upload Document
			{
				displayName: 'Document (File or URL)',
				name: 'document',
				type: 'string',
				required: true,
				default: '',
				description: 'The document file (PDF, PPT, PPTX, DOC, DOCX) to upload or a document URL. For files, enter the binary property name (e.g., data). Max 100MB, 300 pages.',
				displayOptions: {
					show: {
						operation: ['uploadDocument'],
					},
				},
			},
			{
				displayName: 'Document Description',
				name: 'documentDescription',
				type: 'string',
				default: '',
				description: 'Optional description/commentary for the LinkedIn document post',
				displayOptions: {
					show: {
						operation: ['uploadDocument'],
						platform: ['linkedin', '__manual_platform__'],
					},
				},
			},
			{
				displayName: 'Scheduled Date',
				name: 'scheduledDate',
				type: 'dateTime',
				default: '',
				description: 'Optional scheduling date/time. If set, the API will schedule the publication instead of posting immediately.',
				displayOptions: { show: { resource: ['uploads'], operation: ['uploadPhotos','uploadVideo','uploadText','uploadDocument'] } },
			},
			{
				displayName: "Timezone",
				name: "timezone",
				type: "string",
				default: "",
				placeholder: "Europe/Madrid",
				description: "Optional timezone for the scheduled date. If not provided, UTC is assumed.",
				displayOptions: { show: { resource: ["uploads"], operation: ["uploadPhotos","uploadVideo","uploadText","uploadDocument"] } },
			},
			{
				displayName: 'Add to Queue',
				name: 'addToQueue',
				type: 'boolean',
				default: false,
				description: 'Whether to add this post to your configured queue instead of posting immediately. The post will be automatically scheduled to your next available queue slot. Configure your queue settings in the Upload-Post dashboard.',
				displayOptions: { show: { resource: ['uploads'], operation: ['uploadPhotos','uploadVideo','uploadText','uploadDocument'] } },
			},
			{
				displayName: 'Max Posts Per Slot',
				name: 'maxPostsPerSlot',
				type: 'number',
				default: 0,
				description: 'Maximum number of posts allowed per queue slot. Overrides the profile setting. Set to 0 to use the profile default. Only used when Add to Queue is enabled.',
				displayOptions: { show: { resource: ['uploads'], operation: ['uploadPhotos','uploadVideo','uploadText','uploadDocument'], addToQueue: [true] } },
			},
			{
				displayName: 'Upload Asynchronously',
				name: 'uploadAsync',
				type: 'boolean',
				default: true,
				description: 'Whether to process the upload asynchronously and return immediately. Recommended: leaving this off holds the HTTP connection open, and if it exceeds the server\'s synchronous wait window the upload switches to asynchronous processing anyway. In that case, use the request_id with the Upload Status endpoint to check the upload status and result.',
				displayOptions: {
					show: {
						operation: ['uploadPhotos','uploadVideo','uploadText','uploadDocument']
					}
				},
			},
			{
				displayName: 'Idempotency Key',
				name: 'idempotencyKey',
				type: 'string',
				default: '',
				description: 'Key the API uses to collapse duplicate uploads within 24 hours. Leave empty to derive one automatically from the execution, node and item, which is what prevents a retried upload from posting twice. Set it explicitly only when you drive retries yourself.',
				displayOptions: {
					show: {
						operation: ['uploadPhotos','uploadVideo','uploadText','uploadDocument']
					}
				},
			},
			{
				displayName: 'Wait for Completion',
				name: 'waitForCompletion',
				type: 'boolean',
				default: true,
				description: 'Whether to perform best-effort sleeping between status checks within this node. Not guaranteed to finish; for reliable long polling use a separate Wait node plus Get Upload Status.',
				displayOptions: {
					show: {
						operation: ['uploadPhotos','uploadVideo','uploadText','uploadDocument']
					}
				},
			},
			{
				displayName: 'Poll Interval (Seconds)',
				name: 'pollInterval',
				type: 'number',
				default: 10,
				description: 'Sleep interval between status checks when waiting for completion',
				displayOptions: {
					show: {
						operation: ['uploadPhotos','uploadVideo','uploadText','uploadDocument'],
						waitForCompletion: [true]
					}
				},
			},
			{
				displayName: 'Timeout (Seconds)',
				name: 'pollTimeout',
				type: 'number',
				default: 600,
				description: 'Maximum time to sleep-and-check before giving up inside this node',
				displayOptions: {
					show: {
						operation: ['uploadPhotos','uploadVideo','uploadText','uploadDocument'],
						waitForCompletion: [true]
					}
				},
			},
			// Fields for Status & History
			{
				displayName: 'Request ID',
				name: 'requestId',
				type: 'string',
				required: true,
				default: '',
				description: 'The request_id returned by an async upload to query its status',
				displayOptions: {
					show: {
						operation: ['getStatus']
					}
				},
			},
			{
				displayName: 'Job ID',
				name: 'jobId',
				type: 'string',
				required: true,
				default: '',
				description: 'The job_id returned by a scheduled or queued post to query its status',
				displayOptions: {
					show: {
						operation: ['getJobStatus']
					}
				},
			},
			{
				displayName: 'Page',
				name: 'historyPage',
				type: 'number',
				default: 1,
				description: 'Page number for pagination',
				displayOptions: {
					show: {
						operation: ['getHistory']
					}
				},
			},
			{
				displayName: 'Limit',
				name: 'historyLimit',
				type: 'number',
				default: 20,
				description: 'Items per page. Can be 20, 50, or 100.',
				displayOptions: {
					show: {
						operation: ['getHistory']
					}
				},
			},
				// Scheduled Posts fields
				{
					displayName: 'Job ID',
					name: 'scheduleJobId',
					type: 'string',
					default: '',
					description: 'Scheduled job identifier',
					displayOptions: { show: { operation: ['cancelScheduled','editScheduled'] } },
				},
				// Analytics fields
				{
					displayName: 'Profile Username',
					name: 'analyticsProfileUsername',
					type: 'string',
					required: true,
					default: '',
					description: 'Profile username to fetch analytics for',
					displayOptions: { show: { operation: ['getAnalytics'] } },
				},
				{
					displayName: 'New Scheduled Date',
					name: 'newScheduledDate',
					type: 'dateTime',
					default: '',
					description: 'New scheduled date/time for the post',
					displayOptions: { show: { operation: ['editScheduled'] } },
				},
				{
					displayName: "New Timezone",
					name: "newTimezone",
					type: "string",
					default: "",
					placeholder: "Europe/Madrid",
					description: "New timezone for the scheduled date",
					displayOptions: { show: { operation: ["editScheduled"] } },
				},
				{
					displayName: 'Platforms',
					name: 'analyticsPlatforms',
					type: 'multiOptions',
					required: true,
					options: [
						{ name: 'Facebook', value: 'facebook' },
						{ name: 'Instagram', value: 'instagram' },
						{ name: 'LinkedIn', value: 'linkedin' },
						{ name: 'Pinterest', value: 'pinterest' },
						{ name: 'Reddit', value: 'reddit' },
						{ name: 'Threads', value: 'threads' },
						{ name: 'TikTok', value: 'tiktok' },
						{ name: 'X (Twitter)', value: 'x' },
						{ name: 'YouTube', value: 'youtube' },
					],
					default: [],
					description: 'Platforms to fetch analytics for. Analytics are not available for Bluesky, Discord, Google Business or Telegram.',
					displayOptions: { show: { operation: ['getAnalytics'] } },
				},
				{
					displayName: 'Facebook Page ID',
					name: 'analyticsPageId',
					type: 'string',
					default: '',
					description: 'Required when Facebook is among the selected platforms',
					displayOptions: { show: { operation: ['getAnalytics'] } },
				},
				{
					displayName: 'LinkedIn Page URN',
					name: 'analyticsPageUrn',
					type: 'string',
					default: '',
					description: 'LinkedIn organization/company page (URN or numeric ID) to report on. LinkedIn analytics are only available for pages you administer — personal profiles are not supported. Leave empty to use the first administered page.',
					displayOptions: { show: { operation: ['getAnalytics'] } },
				},

			// Post analytics by request ID
			{
				displayName: 'Request ID',
				name: 'postAnalyticsRequestId',
				type: 'string',
				required: true,
				default: '',
				description: 'The request_id returned by the upload you want metrics for',
				displayOptions: { show: { operation: ['getPostAnalytics'] } },
			},
			{
				displayName: 'Platform',
				name: 'postAnalyticsPlatform',
				type: 'options',
				options: [
					{ name: 'All Platforms', value: '' },
					{ name: 'Facebook', value: 'facebook' },
					{ name: 'Instagram', value: 'instagram' },
					{ name: 'LinkedIn', value: 'linkedin' },
					{ name: 'Pinterest', value: 'pinterest' },
					{ name: 'Reddit', value: 'reddit' },
					{ name: 'Threads', value: 'threads' },
					{ name: 'TikTok', value: 'tiktok' },
					{ name: 'X (Twitter)', value: 'x' },
					{ name: 'YouTube', value: 'youtube' },
				],
				default: '',
				description: 'Restrict the result to a single platform',
				displayOptions: { show: { operation: ['getPostAnalytics'] } },
			},

			// Post analytics by native platform post ID
			{
				displayName: 'Platform Post ID',
				name: 'platformPostId',
				type: 'string',
				required: true,
				default: '',
				description: 'The post ID as assigned by the social platform itself',
				displayOptions: { show: { operation: ['getPostAnalyticsByPlatformId'] } },
			},
			{
				displayName: 'Platform',
				name: 'nativePostPlatform',
				type: 'options',
				required: true,
				options: [
					{ name: 'Facebook', value: 'facebook' },
					{ name: 'Instagram', value: 'instagram' },
					{ name: 'LinkedIn', value: 'linkedin' },
					{ name: 'Pinterest', value: 'pinterest' },
					{ name: 'Reddit', value: 'reddit' },
					{ name: 'Threads', value: 'threads' },
					{ name: 'TikTok', value: 'tiktok' },
					{ name: 'X (Twitter)', value: 'x' },
					{ name: 'YouTube', value: 'youtube' },
				],
				default: 'instagram',
				description: 'Platform the post lives on',
				displayOptions: { show: { operation: ['getPostAnalyticsByPlatformId'] } },
			},
			{
				displayName: 'Profile Username',
				name: 'nativePostProfileUsername',
				type: 'string',
				required: true,
				default: '',
				description: 'Upload-Post profile that owns the connected account',
				displayOptions: { show: { operation: ['getPostAnalyticsByPlatformId'] } },
			},

			// Cached post analytics (write-through cache, filled by live reads)
			{
				displayName: 'Profile Username',
				name: 'cachedAnalyticsProfileUsername',
				type: 'string',
				required: true,
				default: '',
				description: 'Profile username whose cached post metrics you want',
				displayOptions: { show: { operation: ['getCachedPostAnalytics'] } },
			},
			{
				displayName: 'Platform',
				name: 'cachedAnalyticsPlatform',
				type: 'options',
				options: [
					{ name: 'All Platforms', value: '' },
					{ name: 'Facebook', value: 'facebook' },
					{ name: 'Instagram', value: 'instagram' },
					{ name: 'LinkedIn', value: 'linkedin' },
					{ name: 'Pinterest', value: 'pinterest' },
					{ name: 'Reddit', value: 'reddit' },
					{ name: 'Threads', value: 'threads' },
					{ name: 'TikTok', value: 'tiktok' },
					{ name: 'YouTube', value: 'youtube' },
				],
				default: '',
				description: 'Restrict the result to a single platform. X (Twitter) is not available: the snapshot cache does not store it.',
				displayOptions: { show: { operation: ['getCachedPostAnalytics'] } },
			},
			{
				displayName: 'Limit',
				name: 'cachedAnalyticsLimit',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 200 },
				default: 50,
				description: 'Max number of results to return',
				displayOptions: { show: { operation: ['getCachedPostAnalytics'] } },
			},
			{
				displayName: 'Cursor',
				name: 'cachedAnalyticsCursor',
				type: 'string',
				default: '',
				description: 'Opaque pagination cursor. Pass the next_cursor returned by the previous call to fetch the following page.',
				displayOptions: { show: { operation: ['getCachedPostAnalytics'] } },
			},
			{
				displayName: 'Since',
				name: 'cachedAnalyticsSince',
				type: 'string',
				default: '',
				placeholder: 'YYYY-MM-DD',
				description: 'Start of the snapshot date range. Defaults to 30 days ago.',
				displayOptions: { show: { operation: ['getCachedPostAnalytics'] } },
			},
			{
				displayName: 'Until',
				name: 'cachedAnalyticsUntil',
				type: 'string',
				default: '',
				placeholder: 'YYYY-MM-DD',
				description: 'End of the snapshot date range. Defaults to today.',
				displayOptions: { show: { operation: ['getCachedPostAnalytics'] } },
			},

			// Total impressions
			{
				displayName: 'Profile Username',
				name: 'impressionsProfileUsername',
				type: 'string',
				required: true,
				default: '',
				description: 'Profile username to aggregate impressions for',
				displayOptions: { show: { operation: ['getTotalImpressions'] } },
			},
			{
				displayName: 'Period',
				name: 'impressionsPeriod',
				type: 'options',
				options: [
					{ name: 'Custom Range (Use Start/End Date)', value: '' },
					{ name: 'Last 3 Months', value: 'last_3months' },
					{ name: 'Last Day', value: 'last_day' },
					{ name: 'Last Month', value: 'last_month' },
					{ name: 'Last Week', value: 'last_week' },
					{ name: 'Last Year', value: 'last_year' },
				],
				default: '',
				description: 'Preset range. Leave on custom range to use Start and End Date instead. Defaults to the last 30 days when nothing is set.',
				displayOptions: { show: { operation: ['getTotalImpressions'] } },
			},
			{
				displayName: 'Start Date',
				name: 'impressionsStartDate',
				type: 'string',
				default: '',
				placeholder: 'YYYY-MM-DD',
				description: 'Start of a custom date range. Ignored when Period is set.',
				displayOptions: { show: { operation: ['getTotalImpressions'] } },
			},
			{
				displayName: 'End Date',
				name: 'impressionsEndDate',
				type: 'string',
				default: '',
				placeholder: 'YYYY-MM-DD',
				description: 'End of a custom date range. Ignored when Period is set.',
				displayOptions: { show: { operation: ['getTotalImpressions'] } },
			},
			{
				displayName: 'Platforms',
				name: 'impressionsPlatforms',
				type: 'multiOptions',
				options: [
					{ name: 'Facebook', value: 'facebook' },
					{ name: 'Instagram', value: 'instagram' },
					{ name: 'LinkedIn', value: 'linkedin' },
					{ name: 'Pinterest', value: 'pinterest' },
					{ name: 'Reddit', value: 'reddit' },
					{ name: 'Threads', value: 'threads' },
					{ name: 'TikTok', value: 'tiktok' },
					{ name: 'X (Twitter)', value: 'x' },
					{ name: 'YouTube', value: 'youtube' },
				],
				default: [],
				description: 'Restrict the aggregate to these platforms. Leave empty for all.',
				displayOptions: { show: { operation: ['getTotalImpressions'] } },
			},
			{
				displayName: 'Breakdown',
				name: 'impressionsBreakdown',
				type: 'boolean',
				default: false,
				description: 'Whether to return impressions broken down per platform instead of a single total',
				displayOptions: { show: { operation: ['getTotalImpressions'] } },
			},

			// Reddit detailed posts
			{
				displayName: 'Profile Username',
				name: 'redditProfileUsername',
				type: 'string',
				required: true,
				default: '',
				description: 'Profile username whose Reddit posts you want',
				displayOptions: { show: { operation: ['getRedditDetailedPosts'] } },
			},
			{
				displayName: 'User Identifier Name or ID',
				name: 'mediaUser',
				type: 'options',
				noDataExpression: true,
				required: true,
				default: '',
				description: 'Choose from your created profiles. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
				typeOptions: { loadOptionsMethod: 'getUserProfiles' },
				displayOptions: { show: { operation: ['getMedia'] } },
			},
			{
				displayName: 'Platform',
				name: 'mediaPlatform',
				type: 'string',
				required: true,
				default: '',
				description: 'Network to list media from (e.g. linkedin, facebook, instagram, youtube)',
				displayOptions: { show: { operation: ['getMedia'] } },
			},
			{
				displayName: 'Page URN',
				name: 'mediaPageUrn',
				type: 'string',
				default: '',
				description: 'Optional LinkedIn page URN when listing page media',
				displayOptions: { show: { operation: ['getMedia'] } },
			},
			{
				displayName: 'Limit',
				name: 'mediaLimit',
				type: 'number',
				default: 0,
				description: 'Max items to return. 0 uses the API default.',
				displayOptions: { show: { operation: ['getMedia'] } },
			},
			{
				displayName: 'Cursor',
				name: 'mediaCursor',
				type: 'string',
				default: '',
				description: 'Pagination cursor from a previous Get Media response',
				displayOptions: { show: { operation: ['getMedia'] } },
			},
			{
				displayName: 'User Identifier Name or ID',
				name: 'gbpLocationsProfile',
				type: 'options',
				noDataExpression: true,
				default: '',
				description: 'Profile whose Google Business locations to list. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
				typeOptions: { loadOptionsMethod: 'getUserProfiles' },
				displayOptions: { show: { operation: ['getGoogleBusinessLocations'] } },
			},
			{
				displayName: 'User Identifier Name or ID',
				name: 'tiktokDiscoveryProfile',
				type: 'options',
				noDataExpression: true,
				required: true,
				default: '',
				description: 'TikTok-connected profile. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
				typeOptions: { loadOptionsMethod: 'getUserProfiles' },
				displayOptions: { show: { operation: ['getTiktokTrendingMusic', 'searchTiktokMusic', 'getTiktokLocations', 'getTiktokSettings'] } },
			},
			{
				displayName: 'Query',
				name: 'tiktokMusicQuery',
				type: 'string',
				default: '',
				description: 'Search text for TikTok music',
				displayOptions: { show: { operation: ['searchTiktokMusic'] } },
			},
			{
				displayName: 'Query',
				name: 'tiktokLocationQuery',
				type: 'string',
				required: true,
				default: '',
				description: 'Search text for TikTok locations',
				displayOptions: { show: { operation: ['getTiktokLocations'] } },
			},
			{
				displayName: 'Genre',
				name: 'tiktokMusicGenre',
				type: 'string',
				default: '',
				description: 'Optional TikTok music genre filter',
				displayOptions: { show: { operation: ['getTiktokTrendingMusic', 'searchTiktokMusic'] } },
			},
			{
				displayName: 'Country Code',
				name: 'tiktokMusicCountryCode',
				type: 'string',
				default: '',
				description: 'Optional country code for TikTok music (e.g. US, ES)',
				displayOptions: { show: { operation: ['getTiktokTrendingMusic', 'searchTiktokMusic'] } },
			},
			{
				displayName: 'Limit',
				name: 'tiktokMusicLimit',
				type: 'number',
				default: 0,
				description: 'Max tracks to return on search. 0 uses the API default.',
				displayOptions: { show: { operation: ['searchTiktokMusic'] } },
			},

			// Create user
			{
				displayName: 'New User Identifier',
				name: 'newUser',
				type: 'string',
				required: true,
				default: '',
				description: 'Profile name to create',
				displayOptions: {
					show: { operation: ['createUser'] }
				},
			},

			// Delete user
			{
				displayName: 'User to Delete',
				name: 'deleteUserId',
				type: 'string',
				required: true,
				default: '',
				description: 'Profile name to delete',
				displayOptions: {
					show: { operation: ['deleteUser'] }
				},
			},

			// Generate JWT
			{
				displayName: 'Redirect URL',
				name: 'redirectUrl',
				type: 'string',
				default: '',
				description: 'Optional URL to redirect the user after linking their social account',
				displayOptions: { show: { operation: ['generateJwt'] } },
			},
			{
				displayName: 'Logo Image URL',
				name: 'logoImage',
				type: 'string',
				default: '',
				description: 'Optional logo image URL to show on the linking page',
				displayOptions: { show: { operation: ['generateJwt'] } },
			},
			{
				displayName: 'Redirect Button Text',
				name: 'redirectButtonText',
				type: 'string',
				default: '',
				description: 'Optional text for the redirect button after linking (default: "Logout connection")',
				displayOptions: { show: { operation: ['generateJwt'] } },
			},
			{
				displayName: 'Platforms (Optional)',
				name: 'jwtPlatforms',
				type: 'multiOptions',
				options: [
					{ name: 'Bluesky', value: 'bluesky' },
					{ name: 'Dev.to', value: 'devto' },
					{ name: 'Discord', value: 'discord' },
					{ name: 'Facebook', value: 'facebook' },
					{ name: 'Google Business', value: 'google_business' },
					{ name: 'Hashnode', value: 'hashnode' },
					{ name: 'Instagram', value: 'instagram' },
					{ name: 'Lemmy', value: 'lemmy' },
					{ name: 'LinkedIn', value: 'linkedin' },
					{ name: 'Listmonk', value: 'listmonk' },
					{ name: 'Mastodon', value: 'mastodon' },
					{ name: 'Nostr', value: 'nostr' },
					{ name: 'Pinterest', value: 'pinterest' },
					{ name: 'Reddit', value: 'reddit' },
					{ name: 'Slack', value: 'slack' },
					{ name: 'Telegram', value: 'telegram' },
					{ name: 'Threads', value: 'threads' },
					{ name: 'TikTok', value: 'tiktok' },
					{ name: 'Whop', value: 'whop' },
					{ name: 'WordPress', value: 'wordpress' },
					{ name: 'X (Twitter)', value: 'x' },
					{ name: 'YouTube', value: 'youtube' },
				],
				default: [],
				description: 'Optional list of platforms to show for connection. Defaults to all supported platforms.',
				displayOptions: { show: { operation: ['generateJwt'] } },
			},
			{
				displayName: 'Show Calendar View',
				name: 'showCalendar',
				type: 'boolean',
				default: true,
				description: 'Whether to show the calendar view on the connection page',
				displayOptions: { show: { operation: ['generateJwt'] } },
			},
			{
				displayName: 'Read-Only Calendar',
				name: 'readonlyCalendar',
				type: 'boolean',
				default: false,
				description: 'Whether to show only a read-only calendar view (no editing, no account connection). Ideal for sharing with end clients.',
				displayOptions: { show: { operation: ['generateJwt'], showCalendar: [true] } },
			},
			{
				displayName: 'Connect Title',
				name: 'connectTitle',
				type: 'string',
				default: '',
				description: 'Optional custom title for the connection page',
				displayOptions: { show: { operation: ['generateJwt'] } },
			},
			{
				displayName: 'Connect Description',
				name: 'connectDescription',
				type: 'string',
				default: '',
				description: 'Optional custom description for the connection page',
				displayOptions: { show: { operation: ['generateJwt'] } },
			},
			{
				displayName: 'Language',
				name: 'language',
				type: 'options',
				default: '',
				description:
					'Force the connection page language for this profile. When set to Auto-Detect, the page detects the visitor browser language and falls back to English.',
				options: [
					{ name: 'Auto-Detect (Default)', value: '' },
					{ name: 'English', value: 'en' },
					{ name: 'French', value: 'fr' },
					{ name: 'German', value: 'de' },
					{ name: 'Polish', value: 'pl' },
					{ name: 'Portuguese', value: 'pt' },
					{ name: 'Spanish', value: 'es' },
					{ name: 'Turkish', value: 'tr' },
				],
				displayOptions: { show: { operation: ['generateJwt'] } },
			},
			{
				displayName: 'UI Labels',
				name: 'uiLabels',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true },
				placeholder: 'Add UI Label',
				default: {},
				description:
					'Override individual texts of the connection page, for white-label integrations. Each entry is an i18n dot-path key (for example connect.connectButton) plus the replacement string, and is sent as ui_labels. The API accepts at most 100 entries, keys matching ^[a-zA-Z0-9_.]+$ and values of up to 300 characters, and returns an error otherwise.',
				options: [
					{
						displayName: 'Label',
						name: 'label',
						values: [
							{
								displayName: 'Key',
								name: 'key',
								type: 'string',
								default: '',
								placeholder: 'connect.connectButton',
								description: 'I18n dot-path key of the connection page text to override',
							},
							{
								displayName: 'Value',
								name: 'value',
								type: 'string',
								default: '',
								description: 'Replacement text shown on the connection page',
							},
						],
					},
				],
				displayOptions: { show: { operation: ['generateJwt'] } },
			},

			// Validate JWT
			{
				displayName: 'JWT',
				name: 'jwtToken',
				type: 'string',
				typeOptions: { password: true },
				required: true,
				default: '',
				description: 'JWT to validate',
				displayOptions: { show: { operation: ['validateJwt'] } },
			},

			// Update Notification Preferences
			{
				displayName: 'Webhook Enabled',
				name: 'webhookEnabled',
				type: 'boolean',
				default: true,
				description: 'Whether to enable webhook notifications',
				displayOptions: { show: { operation: ['updateNotificationPrefs'] } },
			},
			{
				displayName: 'Webhook URL',
				name: 'webhookUrl',
				type: 'string',
				default: '',
				placeholder: 'https://your-server.com/webhook',
				description: 'URL to receive webhook POST requests',
				displayOptions: { show: { operation: ['updateNotificationPrefs'] } },
			},
			{
				displayName: 'Webhook Events',
				name: 'webhookEvents',
				type: 'multiOptions',
				options: [
					{ name: 'Upload Completed', value: 'upload_completed', description: 'When a post upload finishes (success or failure)' },
					{ name: 'Account Connected', value: 'social_account.connected', description: 'When a social account is connected or reconnected' },
					{ name: 'Account Disconnected', value: 'social_account.disconnected', description: 'When a social account is disconnected' },
					{ name: 'Re-Auth Required', value: 'social_account.reauth_required', description: 'When a social account needs re-authentication' },
				],
				default: ['upload_completed', 'social_account.connected', 'social_account.disconnected', 'social_account.reauth_required'],
				description: 'Which webhook events to subscribe to',
				displayOptions: { show: { operation: ['updateNotificationPrefs'] } },
			},

			// Update User Preferences
			{
				displayName: 'Week Start Day',
				name: 'weekStartDay',
				type: 'options',
				options: [
					{ name: 'Sunday', value: '0' },
					{ name: 'Monday', value: '1' },
				],
				default: '0',
				description: 'Calendar week start day (0=Sunday, 1=Monday)',
				displayOptions: { show: { operation: ['updateUserPreferences'] } },
			},

		// ----- LinkedIn Specific Parameters -----
			{
				displayName: 'LinkedIn Visibility',
				name: 'linkedinVisibility',
				type: 'options',
				options: [
					{ name: 'Public', value: 'PUBLIC' },
					{ name: 'Connections', value: 'CONNECTIONS'},
					{ name: 'Logged In', value: 'LOGGED_IN', displayOptions: { show: { operation: ['uploadVideo', 'uploadDocument'] } } },
					{ name: 'Container', value: 'CONTAINER', displayOptions: { show: { operation: ['uploadVideo', 'uploadDocument'] } } },
				],
				default: 'PUBLIC',
				description: 'Visibility for LinkedIn. For Photos, only PUBLIC is supported by API. For Video/Document, CONNECTIONS, PUBLIC, LOGGED_IN, CONTAINER. Not used for Upload Text.',
				displayOptions: {
					show: {
						operation: ['uploadPhotos', 'uploadVideo', 'uploadDocument'],
						platform: ['linkedin', '__manual_platform__']
					},
				},
			},
			{
				displayName: 'Target LinkedIn Page Name or ID',
				name: 'targetLinkedinPageId',
				type: 'options',
				noDataExpression: true,
				default: '',
				description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				typeOptions: { loadOptionsMethod: 'getLinkedinPages', loadOptionsDependsOn: ['user'] },
				displayOptions: {
					show: {
						operation: ['uploadPhotos', 'uploadVideo', 'uploadText', 'uploadDocument'],
						platform: ['linkedin', '__manual_platform__']
					}
				},
			},
			{
				displayName: 'LinkedIn Page Name or ID (Manual Entry)',
				name: 'targetLinkedinPageIdManual',
				type: 'string',
				default: '',
				description: 'Provide the LinkedIn page identifier when it does not appear in the list',
				displayOptions: {
					show: {
						operation: ['uploadPhotos', 'uploadVideo', 'uploadText', 'uploadDocument'],
						platform: ['linkedin'],
						targetLinkedinPageId: [MANUAL_LINKEDIN_VALUE]
					}
				},
			},
			{
				displayName: 'LinkedIn Video Description',
				name: 'linkedinDescription',
				type: 'string',
				default: '',
				description: 'User commentary for LinkedIn Video. If not provided, Title is used. Not for Photos/Text.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['linkedin', '__manual_platform__']
					},
				},
			},

		// ----- Facebook Specific Parameters ----- 
			{
				displayName: 'Facebook Page Name or ID',
				name: 'facebookPageId',
				type: 'options',
				noDataExpression: true,
				default: '',
				description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				typeOptions: { loadOptionsMethod: 'getFacebookPages', loadOptionsDependsOn: ['user'] },
				displayOptions: {
					show: {
						operation: ['uploadPhotos', 'uploadVideo', 'uploadText'],
						platform: ['facebook', '__manual_platform__']
					}
				},
			},
			{
				displayName: 'Facebook Page Name or ID (Manual Entry)',
				name: 'facebookPageIdManual',
				type: 'string',
				default: '',
				description: 'Provide the Facebook page identifier when it does not appear in the list',
				displayOptions: {
					show: {
						operation: ['uploadPhotos', 'uploadVideo', 'uploadText'],
						platform: ['facebook'],
						facebookPageId: [MANUAL_FACEBOOK_VALUE]
					}
				},
			},
			{
				displayName: 'Facebook Link (Text)',
				name: 'facebookLink',
				type: 'string',
				default: '',
				description: 'URL to attach to the Facebook text post as a link preview. Only for Upload Text.',
				displayOptions: {
					show: {
						operation: ['uploadText'],
						platform: ['facebook', '__manual_platform__']
					},
				},
			},
			{
				displayName: 'Facebook Place ID',
				name: 'facebookPlaceId',
				type: 'string',
				default: '',
				description: 'Facebook place ID to tag',
				displayOptions: { show: { operation: ['uploadPhotos','uploadVideo','uploadText'], platform: ['facebook', '__manual_platform__'] } },
			},
			{
				displayName: 'Facebook Alt Text',
				name: 'facebookAltText',
				type: 'string',
				default: '',
				description: 'Alt text for Facebook photos',
				displayOptions: { show: { operation: ['uploadPhotos'], platform: ['facebook', '__manual_platform__'] } },
			},
			{
				displayName: 'Facebook Is AI Generated',
				name: 'facebookIsAiGenerated',
				type: 'boolean',
				default: false,
				description: 'Whether to disclose the Facebook video as AI-generated',
				displayOptions: { show: { operation: ['uploadVideo'], platform: ['facebook', '__manual_platform__'] } },
			},
			{
				displayName: 'Facebook Call to Action',
				name: 'facebookCallToAction',
				type: 'string',
				default: '',
				description: 'JSON call-to-action object for a Facebook text post',
				displayOptions: { show: { operation: ['uploadText'], platform: ['facebook', '__manual_platform__'] } },
			},
			{
				displayName: 'LinkedIn Link (Text)',
				name: 'linkedinLink',
				type: 'string',
				default: '',
				description: 'URL to attach to the LinkedIn text post as a link preview card. LinkedIn will display a rich preview with the page title, description, and thumbnail. Only for Upload Text.',
				displayOptions: {
					show: {
						operation: ['uploadText'],
						platform: ['linkedin', '__manual_platform__']
					},
				},
			},
			{
				displayName: 'LinkedIn Alt Text',
				name: 'linkedinAltText',
				type: 'string',
				default: '',
				description: 'Alt text for LinkedIn media',
				displayOptions: { show: { operation: ['uploadPhotos','uploadVideo'], platform: ['linkedin', '__manual_platform__'] } },
			},
			{
				displayName: 'LinkedIn Disable Reshare',
				name: 'linkedinDisableReshare',
				type: 'boolean',
				default: false,
				description: 'Whether to disable resharing of the LinkedIn post',
				displayOptions: { show: { operation: ['uploadPhotos','uploadVideo','uploadText','uploadDocument'], platform: ['linkedin', '__manual_platform__'] } },
			},
			{
				displayName: 'LinkedIn Link Title',
				name: 'linkedinLinkTitle',
				type: 'string',
				default: '',
				description: 'Override title of the LinkedIn link preview card',
				displayOptions: { show: { operation: ['uploadText'], platform: ['linkedin', '__manual_platform__'] } },
			},
			{
				displayName: 'LinkedIn Link Description',
				name: 'linkedinLinkDescription',
				type: 'string',
				default: '',
				description: 'Override description of the LinkedIn link preview card',
				displayOptions: { show: { operation: ['uploadText'], platform: ['linkedin', '__manual_platform__'] } },
			},
			{
				displayName: 'Bluesky Link (Text)',
				name: 'blueskyLink',
				type: 'string',
				default: '',
				description: 'URL to attach to the Bluesky text post as an external embed link preview card. Bluesky will display a rich preview with the page title, description, and thumbnail. Only for Upload Text.',
				displayOptions: {
					show: {
						operation: ['uploadText'],
						platform: ['bluesky', '__manual_platform__']
					},
				},
			},
			{
				displayName: 'Facebook Video Description',
				name: 'facebookVideoDescription',
				type: 'string',
				default: '',
				description: 'Description for Facebook Video. If not provided, Title is used. Not for Photos/Text.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['facebook', '__manual_platform__']
					},
				},
			},
			{
				displayName: 'Facebook Video State',
				name: 'facebookVideoState',
				type: 'options',
				options: [
					{ name: 'Published', value: 'PUBLISHED' },
					{ name: 'Draft', value: 'DRAFT' },
				],
				default: 'PUBLISHED',
				description: 'State for Facebook Video (DRAFT or PUBLISHED). Use Scheduled Date field for scheduling.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['facebook', '__manual_platform__']
					},
				},
			},
			{
				displayName: 'Facebook Media Type (Video)',
				name: 'facebookMediaType',
				type: 'options',
				options: [
					{ name: 'Reels', value: 'REELS' },
					{ name: 'Stories', value: 'STORIES' },
					{ name: 'Video (Normal Page Video)', value: 'VIDEO' },
				],
				default: 'REELS',
				description: 'Choose whether to post as Reels, Stories, or normal page Video for Facebook',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['facebook', '__manual_platform__']
					},
				},
			},
			{
				displayName: 'Facebook Video Thumbnail URL',
				name: 'facebookThumbnailUrl',
				type: 'string',
				default: '',
				description: 'URL of a custom thumbnail image for normal page videos (only when Media Type is VIDEO)',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['facebook', '__manual_platform__'],
						facebookMediaType: ['VIDEO'],
					},
				},
			},
			{
				displayName: 'Facebook Media Type (Photo)',
				name: 'facebookMediaTypePhoto',
				type: 'options',
				options: [
					{ name: 'Posts (Feed)', value: 'POSTS' },
					{ name: 'Stories', value: 'STORIES' },
				],
				default: 'POSTS',
				description: 'Choose whether to post photos to Feed or Stories',
				displayOptions: {
					show: {
						operation: ['uploadPhotos'],
						platform: ['facebook', '__manual_platform__']
					},
				},
			},

		// ----- TikTok Specific Parameters -----
			{
				displayName: 'TikTok Auto Add Music (Photo)',
				name: 'tiktokAutoAddMusic',
				type: 'boolean',
				default: false,
				description: 'Whether to auto add music to TikTok photos. Only for Upload Photos.',
				displayOptions: {
					show: {
						operation: ['uploadPhotos'],
						platform: ['tiktok', '__manual_platform__']
					},
				},
			},
			{
				displayName: 'TikTok Disable Comment',
				name: 'tiktokDisableComment',
				type: 'boolean',
				default: false,
				description: 'Whether to disable comments on TikTok post. For Photos & Video.',
				displayOptions: {
					show: {
						operation: ['uploadPhotos', 'uploadVideo'],
						platform: ['tiktok', '__manual_platform__']
					},
				},
			},
			{
				displayName: 'TikTok Photo Cover Index',
				name: 'tiktokPhotoCoverIndex',
				type: 'number',
				default: 0,
				typeOptions: { minValue: 0 },
				description: 'Index (0-based) of photo to use as cover for TikTok photo post. Only for Upload Photos.',
				displayOptions: {
					show: {
						operation: ['uploadPhotos'],
						platform: ['tiktok', '__manual_platform__']
					},
				},
			},
			{
				displayName: 'TikTok Photo Description',
				name: 'tiktokPhotoDescription',
				type: 'string',
				default: '',
				description: 'Description for TikTok photo post. If not provided, Title is used. Only for Upload Photos.',
				displayOptions: {
					show: {
						operation: ['uploadPhotos'],
						platform: ['tiktok', '__manual_platform__']
					},
				},
			},
			{
				displayName: 'TikTok Brand Content Toggle (Photo)',
				name: 'brand_content_toggle',
				type: 'boolean',
				default: false,
				description: 'Whether to set as true for paid partnerships that promote third-party brands',
				displayOptions: {
					show: {
						operation: ['uploadPhotos'],
						platform: ['tiktok', '__manual_platform__']
					},
				},
			},
			{
				displayName: 'TikTok Brand Organic Toggle (Photo)',
				name: 'brand_organic_toggle',
				type: 'boolean',
				default: false,
				description: 'Whether to set as true when promoting the creator\'s own business',
				displayOptions: {
					show: {
						operation: ['uploadPhotos'],
						platform: ['tiktok', '__manual_platform__']
					},
				},
			},
			{
				displayName: 'TikTok Privacy Level (Video)',
				name: 'tiktokPrivacyLevel',
				type: 'options',
				options: [
					{ name: 'Account Default', value: '' },
					{ name: 'Follower of Creator', value: 'FOLLOWER_OF_CREATOR' },
					{ name: 'Mutual Follow Friends', value: 'MUTUAL_FOLLOW_FRIENDS' },
					{ name: 'Public to Everyone', value: 'PUBLIC_TO_EVERYONE' },
					{ name: 'Self Only', value: 'SELF_ONLY' },
				],
				default: '',
				description: 'Privacy setting for the TikTok video. TikTok decides per account which levels are available: a private account has no Public to Everyone, and asking for one the account does not have fails with tiktok_privacy_unavailable listing the allowed ones. Account Default sends nothing and lets TikTok apply the account\'s own setting, which is the only value guaranteed to work on every account. Only for Upload Video.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['tiktok', '__manual_platform__']
					},
				},
			},
			{
				displayName: 'TikTok Disable Duet (Video)',
				name: 'tiktokDisableDuet',
				type: 'boolean',
				default: false,
				description: 'Whether to disable duet for TikTok video. Only for Upload Video.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['tiktok', '__manual_platform__']
					},
				},
			},
			{
				displayName: 'TikTok Disable Stitch (Video)',
				name: 'tiktokDisableStitch',
				type: 'boolean',
				default: false,
				description: 'Whether to disable stitch for TikTok video. Only for Upload Video.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['tiktok', '__manual_platform__']
					},
				},
			},
			{
				displayName: 'TikTok Cover Timestamp (Ms, Video)',
				name: 'tiktokCoverTimestamp',
				type: 'number',
				default: 1000,
				description: 'Timestamp (ms) for video cover on TikTok. Only for Upload Video.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['tiktok', '__manual_platform__']
					},
				},
			},
			{
				displayName: 'TikTok Brand Content Toggle (Video)',
				name: 'brand_content_toggle',
				type: 'boolean',
				default: false,
				description: 'Whether to enable brand content toggle for paid partnerships that promote third-party brands',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['tiktok', '__manual_platform__']
					},
				},
			},
			{
				displayName: 'TikTok Brand Organic Toggle (Video)',
				name: 'brand_organic_toggle',
				type: 'boolean',
				default: false,
				description: 'Whether to enable brand organic toggle when promoting the creator\'s own business',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['tiktok', '__manual_platform__']
					},
				},
			},
			{
				displayName: 'TikTok Is AIGC (Video)',
				name: 'tiktokIsAigc',
				type: 'boolean',
				default: false,
				description: 'Whether to indicate if content is AI-generated for TikTok video. Only for Upload Video.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['tiktok', '__manual_platform__']
					}
				},
			},
			{
				displayName: 'TikTok Post Mode (Video)',
				name: 'tiktokPostMode',
				type: 'options',
				options: [
					{ name: 'Direct Post', value: 'DIRECT_POST' },
					{ name: 'Media Upload (Inbox)', value: 'MEDIA_UPLOAD' },
				],
				default: 'DIRECT_POST',
				description: 'Choose TikTok posting mode for video',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['tiktok', '__manual_platform__']
					}
				},
			},

		// ----- TikTok Capability-Gated Options -----
		// Each of these depends on a capability declared by the TikTok connection
		// (see the `capabilities` array on the TikTok account in the user-profiles
		// response). When the connection lacks the capability the API ignores the
		// field and returns a per-field warning, so the post still publishes. They
		// are only sent when actually filled in, so leaving them at their defaults
		// keeps the current behaviour.
			{
				displayName: 'TikTok Music ID',
				name: 'tiktokMusicId',
				type: 'string',
				default: '',
				description: 'Commercial Music Library track ID to add to the post: the ID field returned by the TikTok trending-music or music-search endpoint, not its commercial_music_id. To find a track by song or artist, call GET /api/uploadposts/tiktok/music/search from an HTTP Request node first. Works on video and photo posts alike, but a photo post takes the ID alone: the volume and trim options below are video-only. Needs the music capability on the TikTok connection (see capabilities in the user-profiles response); without it the field is ignored with a warning and the post still publishes. Leave empty to skip.',
				displayOptions: {
					show: {
						operation: ['uploadVideo', 'uploadPhotos'],
						platform: ['tiktok', '__manual_platform__']
					}
				},
			},
			{
				displayName: 'TikTok Music Volume',
				name: 'tiktokMusicVolume',
				type: 'number',
				default: 50,
				typeOptions: { minValue: 0, maxValue: 100 },
				description: 'Volume (0-100) of the Commercial Music Library track. Only sent when a TikTok Music ID is set.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['tiktok', '__manual_platform__']
					}
				},
			},
			{
				displayName: 'TikTok Music Start (Ms)',
				name: 'tiktokMusicStart',
				type: 'number',
				default: 0,
				typeOptions: { minValue: 0 },
				description: 'Start offset (ms) of the music track. Only sent when a TikTok Music ID is set and this is above 0.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['tiktok', '__manual_platform__']
					}
				},
			},
			{
				displayName: 'TikTok Music End (Ms)',
				name: 'tiktokMusicEnd',
				type: 'number',
				default: 0,
				typeOptions: { minValue: 0 },
				description: 'End offset (ms) of the music track. Only sent when a TikTok Music ID is set and this is above 0.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['tiktok', '__manual_platform__']
					}
				},
			},
			{
				displayName: 'TikTok Original Sound Volume',
				name: 'tiktokOriginalSoundVolume',
				type: 'number',
				default: 50,
				typeOptions: { minValue: 0, maxValue: 100 },
				description: 'Volume (0-100) of the original video audio when music is added. Only sent when a TikTok Music ID is set. Keep it above 0 so the original audio is not muted.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['tiktok', '__manual_platform__']
					}
				},
			},
			{
				displayName: 'TikTok Location ID',
				name: 'tiktokLocationId',
				type: 'string',
				default: '',
				description: 'Location ID to tag on the post (video or photos). Needs the location capability on the TikTok connection (see capabilities in the user-profiles response) and a TikTok Location Name — the tag is only sent when both are filled in. Without the capability the field is ignored with a warning and the post still publishes. Leave empty to skip.',
				displayOptions: {
					show: {
						operation: ['uploadVideo', 'uploadPhotos'],
						platform: ['tiktok', '__manual_platform__']
					}
				},
			},
			{
				displayName: 'TikTok Location Name',
				name: 'tiktokLocationName',
				type: 'string',
				default: '',
				description: 'Location name matching the TikTok Location ID. TikTok requires both together, so the location tag is only sent when this and the ID are both filled in.',
				displayOptions: {
					show: {
						operation: ['uploadVideo', 'uploadPhotos'],
						platform: ['tiktok', '__manual_platform__']
					}
				},
			},
			{
				displayName: 'TikTok Cover Image URL',
				name: 'tiktokCoverImageUrl',
				type: 'string',
				default: '',
				description: 'Custom cover image URL for the video. Needs the cover_image capability on the TikTok connection (see capabilities in the user-profiles response); without it the field is ignored with a warning and the post still publishes. Takes priority over TikTok Cover Timestamp.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['tiktok', '__manual_platform__']
					}
				},
			},
			{
				displayName: 'TikTok Is AI Generated',
				name: 'tiktokIsAiGenerated',
				type: 'boolean',
				default: false,
				description: 'Whether to disclose the post as AI-generated on TikTok. Works on video and photo posts. Only sent when enabled.',
				displayOptions: {
					show: {
						operation: ['uploadVideo', 'uploadPhotos'],
						platform: ['tiktok', '__manual_platform__']
					}
				},
			},
			{
				displayName: 'TikTok Upload to Draft',
				name: 'tiktokUploadToDraft',
				type: 'boolean',
				default: false,
				description: 'Whether to send the video to TikTok drafts instead of publishing it. Needs the draft capability on the TikTok connection (see capabilities in the user-profiles response); without it the field is ignored with a warning and the post still publishes. When enabled TikTok ignores the rest of the post settings.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['tiktok', '__manual_platform__']
					}
				},
			},
			{
				displayName: 'TikTok Ads Only',
				name: 'tiktokIsAdsOnly',
				type: 'boolean',
				default: false,
				description: 'Whether to mark the TikTok video as ads-only',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['tiktok', '__manual_platform__']
					}
				},
			},
			{
				displayName: 'TikTok TTO Invite Link',
				name: 'tiktokTtoInviteLink',
				type: 'string',
				default: '',
				description: 'TikTok One invite link for branded content',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['tiktok', '__manual_platform__']
					}
				},
			},

		// ----- Instagram Specific Parameters -----
			{
				displayName: 'Instagram Media Type',
				name: 'instagramMediaType',
				type: 'options',
				options: [
					{ name: 'Image (Feed - Photo)', value: 'IMAGE', displayOptions: {show: {operation: ['uploadPhotos']}} },
					{ name: 'Stories (Photo/Video)', value: 'STORIES' },
					{ name: 'Reels (Video)', value: 'REELS', displayOptions: {show: {operation: ['uploadVideo']}} },
				],
				default: 'IMAGE',
				description: 'Type of media for Instagram. IMAGE/STORIES for Photos. REELS/STORIES for Video.',
				displayOptions: {
					show: {
						operation: ['uploadPhotos', 'uploadVideo'],
						platform: ['instagram', '__manual_platform__']
					},
				},
			},
			{
				displayName: 'Instagram Reel Type',
				name: 'instagramShareMode',
				type: 'options',
				options: [
					{ name: 'Regular Reel', value: 'CUSTOM' },
					{ name: 'Trial Reel (Auto-Share If Liked)', value: 'TRIAL_REELS_SHARE_TO_FOLLOWERS_IF_LIKED' },
					{ name: 'Trial Reel (Don\'t Auto-Share)', value: 'TRIAL_REELS_DONT_SHARE_TO_FOLLOWERS' },
				],
				default: 'CUSTOM',
				description: 'Choose posting mode. Trial Reels are shown to non-followers first to test content performance before sharing with followers.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['instagram', '__manual_platform__'],
						instagramMediaType: ['REELS'],
					},
				},
			},
			{
				displayName: 'Instagram Share to Feed (Video)',
				name: 'instagramShareToFeed',
				type: 'boolean',
				default: true,
				description: 'Whether to share Instagram video (Reel/Story) to feed. Only for Upload Video with Regular Reels.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['instagram', '__manual_platform__'],
						instagramShareMode: ['CUSTOM'],
					},
				},
			},
			{
				displayName: 'Instagram Collaborators',
				name: 'instagramCollaborators',
				type: 'string',
				default: '',
				description: 'Comma-separated collaborator usernames for Instagram. Sent as a string.',
				displayOptions: { show: { operation: ['uploadVideo', 'uploadPhotos'],
						platform: ['instagram', '__manual_platform__']
					},
				},
			},
			{
				displayName: 'Instagram Cover URL or Binary (Video)',
				name: 'instagramCoverUrl',
				type: 'string',
				default: '',
				description: 'URL or binary property name for custom video cover on Instagram. Binary images are uploaded and converted to a public URL automatically. JPEG, ≤ 8MB.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['instagram', '__manual_platform__']
					},
				},
			},
			{
				displayName: 'Instagram Audio Name (Video)',
				name: 'instagramAudioName',
				type: 'string',
				default: '',
				description: 'Name of the audio track for Instagram video. Only for Upload Video.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['instagram', '__manual_platform__']
					},
				},
			},
			{
				displayName: 'Instagram User Tags',
				name: 'instagramUserTags',
				type: 'string',
				default: '',
				description: 'Comma-separated user tags for Instagram. Sent as a string.',
				displayOptions: { show: { operation: ['uploadVideo', 'uploadPhotos'],
						platform: ['instagram', '__manual_platform__']
					},
				},
			},
			{
				displayName: 'Instagram Location ID',
				name: 'instagramLocationId',
				type: 'string',
				default: '',
				displayOptions: { show: { operation: ['uploadVideo', 'uploadPhotos'],
						platform: ['instagram', '__manual_platform__']
					},
				},
			},
			{
				displayName: 'Instagram Thumb Offset (Video)',
				name: 'instagramThumbOffset',
				type: 'string',
				default: '',
				description: 'Timestamp offset for video thumbnail on Instagram. Only for Upload Video.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['instagram', '__manual_platform__']
					}
				},
			},
			{
				displayName: 'Instagram Alt Text',
				name: 'instagramAltText',
				type: 'string',
				default: '',
				description: 'Alt text for Instagram photos',
				displayOptions: { show: { operation: ['uploadPhotos'], platform: ['instagram', '__manual_platform__'] } },
			},

		// ----- Threads Specific Parameters -----
			{
				displayName: 'Threads Long Text as Single Post',
				name: 'threadsLongTextAsPost',
				type: 'boolean',
				default: false,
				description: 'Whether long text is published as a single post. If false (default), a thread is created if the text exceeds 500 characters.',
				displayOptions: { show: { operation: ['uploadPhotos','uploadVideo','uploadText'], platform: ['threads', '__manual_platform__'] } },
			},
			{
				displayName: 'Threads Thread Media Layout',
				name: 'threadsThreadMediaLayout',
				type: 'string',
				default: '',
				description: 'Comma-separated list of how many media items to include in each Threads post. Each value must be 1-10, and the total must equal the number of files. Example: \'5,5\' splits 10 items into 2 posts with 5 each.',
				displayOptions: {
					show: {
						operation: ['uploadPhotos'],
						platform: ['threads', '__manual_platform__']
					},
				},
			},
			{
				displayName: 'Threads Topic Tag',
				name: 'threadsTopicTag',
				type: 'string',
				default: '',
				description: 'A topic tag for the Threads post (1-50 characters, no periods or ampersands). Helps increase reach on Threads.',
				displayOptions: { show: { operation: ['uploadPhotos','uploadVideo','uploadText'], platform: ['threads', '__manual_platform__'] } },
			},
			{
				displayName: 'Threads Reply Control',
				name: 'threadsReplyControl',
				type: 'string',
				default: '',
				description: 'Who can reply to the Threads post',
				displayOptions: { show: { operation: ['uploadPhotos','uploadVideo','uploadText'], platform: ['threads', '__manual_platform__'] } },
			},
			{
				displayName: 'Threads Alt Text',
				name: 'threadsAltText',
				type: 'string',
				default: '',
				description: 'Alt text for Threads media',
				displayOptions: { show: { operation: ['uploadPhotos','uploadVideo'], platform: ['threads', '__manual_platform__'] } },
			},
			{
				displayName: 'Threads Reply To ID',
				name: 'threadsReplyToId',
				type: 'string',
				default: '',
				description: 'Threads post ID to reply to',
				displayOptions: { show: { operation: ['uploadPhotos','uploadVideo','uploadText'], platform: ['threads', '__manual_platform__'] } },
			},
			{
				displayName: 'Threads Quote Post ID',
				name: 'threadsQuotePostId',
				type: 'string',
				default: '',
				description: 'Threads post ID to quote',
				displayOptions: { show: { operation: ['uploadPhotos','uploadVideo','uploadText'], platform: ['threads', '__manual_platform__'] } },
			},
			{
				displayName: 'Threads Link Attachment',
				name: 'threadsLinkAttachment',
				type: 'string',
				default: '',
				description: 'URL to attach to a Threads text post',
				displayOptions: { show: { operation: ['uploadText'], platform: ['threads', '__manual_platform__'] } },
			},
			{
				displayName: 'Threads Poll Options',
				name: 'threadsPollOptions',
				type: 'string',
				default: '',
				description: 'Comma-separated poll options for a Threads post',
				displayOptions: { show: { operation: ['uploadText'], platform: ['threads', '__manual_platform__'] } },
			},

		// ----- Google Business Specific Parameters -----
			{
				displayName: 'Google Business Location ID',
				name: 'gbpLocationId',
				type: 'string',
				default: '',
				description: 'Location ID for accounts with multiple Google Business Profile locations (e.g., accounts/123/locations/456). If omitted, uses the default connected location.',
				displayOptions: { show: { operation: ['uploadPhotos', 'uploadVideo', 'uploadText'], platform: ['google_business', '__manual_platform__'] } },
			},
			{
				displayName: 'Google Business Post Type',
				name: 'gbpTopicType',
				type: 'options',
				options: [
					{ name: 'Standard', value: 'STANDARD' },
					{ name: 'Event', value: 'EVENT' },
					{ name: 'Offer', value: 'OFFER' },
				],
				default: 'STANDARD',
				description: 'Kind of Google Business post to publish',
				displayOptions: { show: { operation: ['uploadPhotos', 'uploadVideo', 'uploadText'], platform: ['google_business', '__manual_platform__'] } },
			},
			{
				displayName: 'Google Business Media URL',
				name: 'gbpMediaUrl',
				type: 'string',
				default: '',
				description: 'URL of the media attached to the Google Business post',
				displayOptions: { show: { operation: ['uploadPhotos', 'uploadVideo', 'uploadText'], platform: ['google_business', '__manual_platform__'] } },
			},
			{
				displayName: 'Google Business Media Format',
				name: 'gbpMediaFormat',
				type: 'options',
				options: [
					{ name: 'Not Set', value: '' },
					{ name: 'Photo', value: 'PHOTO' },
					{ name: 'Video', value: 'VIDEO' },
				],
				default: '',
				description: 'Format of the attached media',
				displayOptions: { show: { operation: ['uploadPhotos', 'uploadVideo', 'uploadText'], platform: ['google_business', '__manual_platform__'] } },
			},
			{
				displayName: 'Google Business Publish As',
				name: 'gbpPostType',
				type: 'options',
				options: [
					{ name: 'Gallery', value: 'GALLERY' },
					{ name: 'Local Post (Default)', value: '' },
					{ name: 'Media', value: 'MEDIA' },
					{ name: 'Photo', value: 'PHOTO' },
				],
				default: '',
				description:
					'Where the upload lands on the Google Business Profile. Local Post keeps the default behaviour and creates a post on the timeline. Media, Photo and Gallery all publish the image to the location Media/Gallery tab instead, without creating a Local Post.',
				displayOptions: { show: { operation: ['uploadPhotos', 'uploadVideo', 'uploadText'], platform: ['google_business', '__manual_platform__'] } },
			},
			{
				displayName: 'Google Business Media Category',
				name: 'gbpMediaCategory',
				type: 'options',
				options: [
					{ name: 'Additional', value: 'ADDITIONAL' },
					{ name: 'At Work', value: 'AT_WORK' },
					{ name: 'Common Area', value: 'COMMON_AREA' },
					{ name: 'Cover', value: 'COVER' },
					{ name: 'Exterior', value: 'EXTERIOR' },
					{ name: 'Food and Drink', value: 'FOOD_AND_DRINK' },
					{ name: 'Interior', value: 'INTERIOR' },
					{ name: 'Logo', value: 'LOGO' },
					{ name: 'Menu', value: 'MENU' },
					{ name: 'Product', value: 'PRODUCT' },
					{ name: 'Profile', value: 'PROFILE' },
					{ name: 'Rooms', value: 'ROOMS' },
					{ name: 'Teams', value: 'TEAMS' },
				],
				default: 'ADDITIONAL',
				description: 'Category the photo is filed under in the Media/Gallery tab. Only used when Publish As is Media, Photo or Gallery.',
				displayOptions: { show: { operation: ['uploadPhotos', 'uploadVideo', 'uploadText'], platform: ['google_business', '__manual_platform__'], gbpPostType: ['GALLERY', 'MEDIA', 'PHOTO'] } },
			},
			{
				displayName: 'Google Business Call to Action',
				name: 'gbpCtaType',
				type: 'options',
				options: [
					{ name: 'Book', value: 'BOOK' },
					{ name: 'Call', value: 'CALL' },
					{ name: 'Learn More', value: 'LEARN_MORE' },
					{ name: 'None', value: '' },
					{ name: 'Order', value: 'ORDER' },
					{ name: 'Shop', value: 'SHOP' },
					{ name: 'Sign Up', value: 'SIGN_UP' },
				],
				default: '',
				description: 'Button shown under the Google Business post',
				displayOptions: { show: { operation: ['uploadPhotos', 'uploadVideo', 'uploadText'], platform: ['google_business', '__manual_platform__'] } },
			},
			{
				displayName: 'Google Business Call to Action URL',
				name: 'gbpCtaUrl',
				type: 'string',
				default: '',
				description: 'URL the call-to-action button opens',
				displayOptions: { show: { operation: ['uploadPhotos', 'uploadVideo', 'uploadText'], platform: ['google_business', '__manual_platform__'] } },
			},
			{
				displayName: 'Google Business Event Title',
				name: 'gbpEventTitle',
				type: 'string',
				default: '',
				description: 'Title of the event',
				displayOptions: { show: { operation: ['uploadPhotos', 'uploadVideo', 'uploadText'], platform: ['google_business', '__manual_platform__'], gbpTopicType: ['EVENT'] } },
			},
			{
				displayName: 'Google Business Event Start Date',
				name: 'gbpEventStartDate',
				type: 'string',
				default: '',
				placeholder: 'YYYY-MM-DD',
				description: 'Date the event starts',
				displayOptions: { show: { operation: ['uploadPhotos', 'uploadVideo', 'uploadText'], platform: ['google_business', '__manual_platform__'], gbpTopicType: ['EVENT'] } },
			},
			{
				displayName: 'Google Business Event Start Time',
				name: 'gbpEventStartTime',
				type: 'string',
				default: '',
				placeholder: 'HH:MM',
				description: 'Time the event starts',
				displayOptions: { show: { operation: ['uploadPhotos', 'uploadVideo', 'uploadText'], platform: ['google_business', '__manual_platform__'], gbpTopicType: ['EVENT'] } },
			},
			{
				displayName: 'Google Business Event End Date',
				name: 'gbpEventEndDate',
				type: 'string',
				default: '',
				placeholder: 'YYYY-MM-DD',
				description: 'Date the event ends',
				displayOptions: { show: { operation: ['uploadPhotos', 'uploadVideo', 'uploadText'], platform: ['google_business', '__manual_platform__'], gbpTopicType: ['EVENT'] } },
			},
			{
				displayName: 'Google Business Event End Time',
				name: 'gbpEventEndTime',
				type: 'string',
				default: '',
				placeholder: 'HH:MM',
				description: 'Time the event ends',
				displayOptions: { show: { operation: ['uploadPhotos', 'uploadVideo', 'uploadText'], platform: ['google_business', '__manual_platform__'], gbpTopicType: ['EVENT'] } },
			},
			{
				displayName: 'Google Business Offer Coupon',
				name: 'gbpOfferCoupon',
				type: 'string',
				default: '',
				description: 'Coupon code for the offer',
				displayOptions: { show: { operation: ['uploadPhotos', 'uploadVideo', 'uploadText'], platform: ['google_business', '__manual_platform__'], gbpTopicType: ['OFFER'] } },
			},
			{
				displayName: 'Google Business Offer Redeem URL',
				name: 'gbpOfferRedeemUrl',
				type: 'string',
				default: '',
				description: 'URL where the offer is redeemed',
				displayOptions: { show: { operation: ['uploadPhotos', 'uploadVideo', 'uploadText'], platform: ['google_business', '__manual_platform__'], gbpTopicType: ['OFFER'] } },
			},
			{
				displayName: 'Google Business Offer Terms',
				name: 'gbpOfferTerms',
				type: 'string',
				default: '',
				description: 'Terms and conditions of the offer',
				displayOptions: { show: { operation: ['uploadPhotos', 'uploadVideo', 'uploadText'], platform: ['google_business', '__manual_platform__'], gbpTopicType: ['OFFER'] } },
			},
			{
				displayName: 'Google Business Language Code',
				name: 'gbpLanguageCode',
				type: 'string',
				default: '',
				description: 'Language code for the Google Business post (e.g. en, es)',
				displayOptions: { show: { operation: ['uploadPhotos', 'uploadVideo', 'uploadText'], platform: ['google_business', '__manual_platform__'] } },
			},

			{
				displayName: 'Bluesky Alt Text',
				name: 'blueskyAltText',
				type: 'string',
				default: '',
				description: 'Alt text for Bluesky images',
				displayOptions: { show: { operation: ['uploadPhotos'], platform: ['bluesky', '__manual_platform__'] } },
			},
			{
				displayName: 'Bluesky Languages',
				name: 'blueskyLangs',
				type: 'string',
				default: '',
				description: 'Comma-separated language codes for the Bluesky post (e.g. en, es)',
				displayOptions: { show: { operation: ['uploadPhotos','uploadVideo','uploadText'], platform: ['bluesky', '__manual_platform__'] } },
			},
			{
				displayName: 'Bluesky Labels',
				name: 'blueskyLabels',
				type: 'string',
				default: '',
				description: 'Content labels for the Bluesky post',
				displayOptions: { show: { operation: ['uploadPhotos','uploadVideo','uploadText'], platform: ['bluesky', '__manual_platform__'] } },
			},
			{
				displayName: 'Bluesky Threadgate',
				name: 'blueskyThreadgate',
				type: 'string',
				default: '',
				description: 'Who can reply (threadgate) on Bluesky',
				displayOptions: { show: { operation: ['uploadPhotos','uploadVideo','uploadText'], platform: ['bluesky', '__manual_platform__'] } },
			},
			{
				displayName: 'Bluesky Quote URI',
				name: 'blueskyQuoteUri',
				type: 'string',
				default: '',
				description: 'AT-URI or URL of a Bluesky post to quote',
				displayOptions: { show: { operation: ['uploadPhotos','uploadVideo','uploadText'], platform: ['bluesky', '__manual_platform__'] } },
			},

			{
				displayName: 'Discord Thread ID',
				name: 'discordThreadId',
				type: 'string',
				default: '',
				description: 'Existing Discord thread ID to post into',
				displayOptions: { show: { operation: ['uploadPhotos','uploadVideo','uploadText'], platform: ['discord', '__manual_platform__'] } },
			},
			{
				displayName: 'Discord Thread Name',
				name: 'discordThreadName',
				type: 'string',
				default: '',
				description: 'Name of a new Discord thread to create with this post',
				displayOptions: { show: { operation: ['uploadPhotos','uploadVideo','uploadText'], platform: ['discord', '__manual_platform__'] } },
			},
			{
				displayName: 'Discord Username',
				name: 'discordUsername',
				type: 'string',
				default: '',
				description: 'Webhook username override',
				displayOptions: { show: { operation: ['uploadPhotos','uploadVideo','uploadText'], platform: ['discord', '__manual_platform__'] } },
			},
			{
				displayName: 'Discord Avatar URL',
				name: 'discordAvatarUrl',
				type: 'string',
				default: '',
				description: 'Webhook avatar URL override',
				displayOptions: { show: { operation: ['uploadPhotos','uploadVideo','uploadText'], platform: ['discord', '__manual_platform__'] } },
			},
			{
				displayName: 'Discord Embeds',
				name: 'discordEmbeds',
				type: 'string',
				default: '',
				description: 'JSON array of Discord embeds',
				displayOptions: { show: { operation: ['uploadText'], platform: ['discord', '__manual_platform__'] } },
			},
			{
				displayName: 'Discord Alt Text',
				name: 'discordAltText',
				type: 'string',
				default: '',
				description: 'Alt text for Discord attachments',
				displayOptions: { show: { operation: ['uploadPhotos','uploadVideo'], platform: ['discord', '__manual_platform__'] } },
			},
			{
				displayName: 'Discord TTS',
				name: 'discordTts',
				type: 'boolean',
				default: false,
				description: 'Whether to send the Discord message as text-to-speech',
				displayOptions: { show: { operation: ['uploadPhotos','uploadVideo','uploadText'], platform: ['discord', '__manual_platform__'] } },
			},

			{
				displayName: 'Telegram Parse Mode',
				name: 'telegramParseMode',
				type: 'options',
				options: [
					{ name: 'HTML', value: 'HTML' },
					{ name: 'Markdown', value: 'Markdown' },
					{ name: 'MarkdownV2', value: 'MarkdownV2' },
					{ name: 'None', value: '' },
				],
				default: '',
				description: 'How Telegram should parse the caption',
				displayOptions: { show: { operation: ['uploadPhotos','uploadVideo','uploadText'], platform: ['telegram', '__manual_platform__'] } },
			},
			{
				displayName: 'Telegram Message Thread ID',
				name: 'telegramMessageThreadId',
				type: 'string',
				default: '',
				description: 'Forum topic thread ID',
				displayOptions: { show: { operation: ['uploadPhotos','uploadVideo','uploadText'], platform: ['telegram', '__manual_platform__'] } },
			},
			{
				displayName: 'Telegram Disable Notification',
				name: 'telegramDisableNotification',
				type: 'boolean',
				default: false,
				description: 'Whether to send the Telegram message silently',
				displayOptions: { show: { operation: ['uploadPhotos','uploadVideo','uploadText'], platform: ['telegram', '__manual_platform__'] } },
			},
			{
				displayName: 'Telegram Protect Content',
				name: 'telegramProtectContent',
				type: 'boolean',
				default: false,
				description: 'Whether to forbid forwarding and saving of the Telegram message',
				displayOptions: { show: { operation: ['uploadPhotos','uploadVideo','uploadText'], platform: ['telegram', '__manual_platform__'] } },
			},
			{
				displayName: 'Telegram Has Spoiler',
				name: 'telegramHasSpoiler',
				type: 'boolean',
				default: false,
				description: 'Whether to mark Telegram media as a spoiler',
				displayOptions: { show: { operation: ['uploadPhotos','uploadVideo'], platform: ['telegram', '__manual_platform__'] } },
			},
			{
				displayName: 'Telegram As Document',
				name: 'telegramAsDocument',
				type: 'boolean',
				default: false,
				description: 'Whether to send the file as a document instead of media',
				displayOptions: { show: { operation: ['uploadPhotos','uploadVideo'], platform: ['telegram', '__manual_platform__'] } },
			},

			{
				displayName: 'Mastodon Visibility',
				name: 'mastodonVisibility',
				type: 'options',
				options: [
					{ name: 'Account Default', value: '' },
					{ name: 'Direct', value: 'direct' },
					{ name: 'Private', value: 'private' },
					{ name: 'Public', value: 'public' },
					{ name: 'Unlisted', value: 'unlisted' },
				],
				default: '',
				description: 'Mastodon post visibility',
				displayOptions: { show: { operation: ['uploadPhotos','uploadVideo','uploadText'], platform: ['mastodon', '__manual_platform__'] } },
			},
			{
				displayName: 'Mastodon Sensitive',
				name: 'mastodonSensitive',
				type: 'boolean',
				default: false,
				description: 'Whether to mark the Mastodon post as sensitive',
				displayOptions: { show: { operation: ['uploadPhotos','uploadVideo','uploadText'], platform: ['mastodon', '__manual_platform__'] } },
			},
			{
				displayName: 'Mastodon Spoiler Text',
				name: 'mastodonSpoilerText',
				type: 'string',
				default: '',
				description: 'Content warning shown before the Mastodon post',
				displayOptions: { show: { operation: ['uploadPhotos','uploadVideo','uploadText'], platform: ['mastodon', '__manual_platform__'] } },
			},
			{
				displayName: 'Mastodon Language',
				name: 'mastodonLanguage',
				type: 'string',
				default: '',
				description: 'ISO language code for the Mastodon post',
				displayOptions: { show: { operation: ['uploadPhotos','uploadVideo','uploadText'], platform: ['mastodon', '__manual_platform__'] } },
			},
			{
				displayName: 'Mastodon Alt Text',
				name: 'mastodonAltText',
				type: 'string',
				default: '',
				description: 'Alt text for Mastodon media',
				displayOptions: { show: { operation: ['uploadPhotos','uploadVideo'], platform: ['mastodon', '__manual_platform__'] } },
			},
			{
				displayName: 'Mastodon Poll Options',
				name: 'mastodonPollOptions',
				type: 'string',
				default: '',
				description: 'Comma-separated poll options for a Mastodon text post',
				displayOptions: { show: { operation: ['uploadText'], platform: ['mastodon', '__manual_platform__'] } },
			},
			{
				displayName: 'Mastodon Poll Expires In',
				name: 'mastodonPollExpiresIn',
				type: 'number',
				default: 0,
				description: 'Poll duration in seconds. 0 means no poll expiry override.',
				displayOptions: { show: { operation: ['uploadText'], platform: ['mastodon', '__manual_platform__'] } },
			},
			{
				displayName: 'Mastodon Poll Multiple',
				name: 'mastodonPollMultiple',
				type: 'boolean',
				default: false,
				description: 'Whether the Mastodon poll allows multiple choices',
				displayOptions: { show: { operation: ['uploadText'], platform: ['mastodon', '__manual_platform__'] } },
			},

			{
				displayName: 'WordPress Status',
				name: 'wordpressStatus',
				type: 'options',
				options: [
					{ name: 'Draft', value: 'draft' },
					{ name: 'Not Set', value: '' },
					{ name: 'Pending', value: 'pending' },
					{ name: 'Private', value: 'private' },
					{ name: 'Publish', value: 'publish' },
				],
				default: '',
				description: 'WordPress post status',
				displayOptions: { show: { operation: ['uploadPhotos','uploadVideo','uploadText'], platform: ['wordpress', '__manual_platform__'] } },
			},
			{
				displayName: 'WordPress Date',
				name: 'wordpressDate',
				type: 'string',
				default: '',
				description: 'WordPress publication date (ISO-8601)',
				displayOptions: { show: { operation: ['uploadPhotos','uploadVideo','uploadText'], platform: ['wordpress', '__manual_platform__'] } },
			},
			{
				displayName: 'WordPress Categories',
				name: 'wordpressCategories',
				type: 'string',
				default: '',
				description: 'Comma-separated WordPress category IDs or names',
				displayOptions: { show: { operation: ['uploadPhotos','uploadVideo','uploadText'], platform: ['wordpress', '__manual_platform__'] } },
			},
			{
				displayName: 'WordPress Tags',
				name: 'wordpressTags',
				type: 'string',
				default: '',
				description: 'Comma-separated WordPress tags',
				displayOptions: { show: { operation: ['uploadPhotos','uploadVideo','uploadText'], platform: ['wordpress', '__manual_platform__'] } },
			},
			{
				displayName: 'WordPress Excerpt',
				name: 'wordpressExcerpt',
				type: 'string',
				default: '',
				description: 'Short excerpt shown on WordPress archive pages',
				displayOptions: { show: { operation: ['uploadPhotos','uploadVideo','uploadText'], platform: ['wordpress', '__manual_platform__'] } },
			},
			{
				displayName: 'WordPress Slug',
				name: 'wordpressSlug',
				type: 'string',
				default: '',
				description: 'WordPress post slug',
				displayOptions: { show: { operation: ['uploadPhotos','uploadVideo','uploadText'], platform: ['wordpress', '__manual_platform__'] } },
			},
			{
				displayName: 'WordPress Alt Text',
				name: 'wordpressAltText',
				type: 'string',
				default: '',
				description: 'Alt text for WordPress media',
				displayOptions: { show: { operation: ['uploadPhotos','uploadVideo'], platform: ['wordpress', '__manual_platform__'] } },
			},

			{
				displayName: 'Lemmy Community',
				name: 'lemmyCommunity',
				type: 'string',
				default: '',
				description: 'Lemmy community name or ID',
				displayOptions: { show: { operation: ['uploadPhotos','uploadText'], platform: ['lemmy', '__manual_platform__'] } },
			},
			{
				displayName: 'Lemmy URL',
				name: 'lemmyUrl',
				type: 'string',
				default: '',
				description: 'Optional link URL for a Lemmy post',
				displayOptions: { show: { operation: ['uploadText'], platform: ['lemmy', '__manual_platform__'] } },
			},
			{
				displayName: 'Lemmy NSFW',
				name: 'lemmyNsfw',
				type: 'boolean',
				default: false,
				description: 'Whether to mark the Lemmy post as NSFW',
				displayOptions: { show: { operation: ['uploadPhotos','uploadText'], platform: ['lemmy', '__manual_platform__'] } },
			},
			{
				displayName: 'Lemmy Alt Text',
				name: 'lemmyAltText',
				type: 'string',
				default: '',
				description: 'Alt text for Lemmy images',
				displayOptions: { show: { operation: ['uploadPhotos'], platform: ['lemmy', '__manual_platform__'] } },
			},

			{
				displayName: 'Slack Markdown',
				name: 'slackMarkdown',
				type: 'boolean',
				default: false,
				description: 'Whether to send the Slack message as markdown',
				displayOptions: { show: { operation: ['uploadText'], platform: ['slack', '__manual_platform__'] } },
			},
			{
				displayName: 'Slack Blocks',
				name: 'slackBlocks',
				type: 'string',
				default: '',
				description: 'JSON Slack Block Kit payload',
				displayOptions: { show: { operation: ['uploadText'], platform: ['slack', '__manual_platform__'] } },
			},
			{
				displayName: 'Slack Mrkdwn',
				name: 'slackMrkdwn',
				type: 'boolean',
				default: false,
				description: 'Whether to enable Slack mrkdwn formatting',
				displayOptions: { show: { operation: ['uploadText'], platform: ['slack', '__manual_platform__'] } },
			},

			{
				displayName: 'Nostr Kind',
				name: 'nostrKind',
				type: 'string',
				default: '',
				description: 'Nostr event kind. Leave empty for a short note.',
				displayOptions: { show: { operation: ['uploadText'], platform: ['nostr', '__manual_platform__'] } },
			},
			{
				displayName: 'Nostr Long Form',
				name: 'nostrLongForm',
				type: 'boolean',
				default: false,
				description: 'Whether to publish as a Nostr long-form article',
				displayOptions: { show: { operation: ['uploadText'], platform: ['nostr', '__manual_platform__'] } },
			},

			{
				displayName: 'Dev.to Tags',
				name: 'devtoTags',
				type: 'string',
				default: '',
				description: 'Comma-separated Dev.to tags',
				displayOptions: { show: { operation: ['uploadText'], platform: ['devto', '__manual_platform__'] } },
			},
			{
				displayName: 'Dev.to Canonical URL',
				name: 'devtoCanonicalUrl',
				type: 'string',
				default: '',
				description: 'Canonical URL if the article was originally published elsewhere',
				displayOptions: { show: { operation: ['uploadText'], platform: ['devto', '__manual_platform__'] } },
			},
			{
				displayName: 'Dev.to Description',
				name: 'devtoDescription',
				type: 'string',
				default: '',
				description: 'Dev.to article description / subtitle',
				displayOptions: { show: { operation: ['uploadText'], platform: ['devto', '__manual_platform__'] } },
			},
			{
				displayName: 'Dev.to Main Image',
				name: 'devtoMainImage',
				type: 'string',
				default: '',
				description: 'Cover image URL for the Dev.to article',
				displayOptions: { show: { operation: ['uploadText'], platform: ['devto', '__manual_platform__'] } },
			},
			{
				displayName: 'Dev.to Series',
				name: 'devtoSeries',
				type: 'string',
				default: '',
				description: 'Dev.to series name',
				displayOptions: { show: { operation: ['uploadText'], platform: ['devto', '__manual_platform__'] } },
			},
			{
				displayName: 'Dev.to Published',
				name: 'devtoPublished',
				type: 'boolean',
				default: false,
				description: 'Whether to publish the Dev.to article immediately instead of saving it as a draft',
				displayOptions: { show: { operation: ['uploadText'], platform: ['devto', '__manual_platform__'] } },
			},

			{
				displayName: 'Hashnode Tags',
				name: 'hashnodeTags',
				type: 'string',
				default: '',
				description: 'Comma-separated Hashnode tags',
				displayOptions: { show: { operation: ['uploadText'], platform: ['hashnode', '__manual_platform__'] } },
			},
			{
				displayName: 'Hashnode Subtitle',
				name: 'hashnodeSubtitle',
				type: 'string',
				default: '',
				description: 'Hashnode article subtitle',
				displayOptions: { show: { operation: ['uploadText'], platform: ['hashnode', '__manual_platform__'] } },
			},
			{
				displayName: 'Hashnode Cover Image URL',
				name: 'hashnodeCoverImageUrl',
				type: 'string',
				default: '',
				description: 'Cover image URL for the Hashnode article',
				displayOptions: { show: { operation: ['uploadText'], platform: ['hashnode', '__manual_platform__'] } },
			},
			{
				displayName: 'Hashnode Body',
				name: 'hashnodeBody',
				type: 'string',
				default: '',
				description: 'Markdown body of the Hashnode article. The title field is used as the article title.',
				typeOptions: { rows: 6 },
				displayOptions: { show: { operation: ['uploadText'], platform: ['hashnode', '__manual_platform__'] } },
			},
			{
				displayName: 'Hashnode Draft',
				name: 'hashnodeDraft',
				type: 'boolean',
				default: false,
				description: 'Whether to save the Hashnode article as a draft',
				displayOptions: { show: { operation: ['uploadText'], platform: ['hashnode', '__manual_platform__'] } },
			},

			{
				displayName: 'Whop Body',
				name: 'whopBody',
				type: 'string',
				default: '',
				description: 'Whop post body',
				typeOptions: { rows: 4 },
				displayOptions: { show: { operation: ['uploadText'], platform: ['whop', '__manual_platform__'] } },
			},
			{
				displayName: 'Whop Pinned',
				name: 'whopPinned',
				type: 'boolean',
				default: false,
				description: 'Whether to pin the Whop post',
				displayOptions: { show: { operation: ['uploadText'], platform: ['whop', '__manual_platform__'] } },
			},
			{
				displayName: 'Whop Paywall Amount',
				name: 'whopPaywallAmount',
				type: 'string',
				default: '',
				description: 'Paywall amount for the Whop post',
				displayOptions: { show: { operation: ['uploadText'], platform: ['whop', '__manual_platform__'] } },
			},
			{
				displayName: 'Whop Paywall Currency',
				name: 'whopPaywallCurrency',
				type: 'string',
				default: '',
				description: 'Paywall currency code (e.g. USD)',
				displayOptions: { show: { operation: ['uploadText'], platform: ['whop', '__manual_platform__'] } },
			},

			{
				displayName: 'Listmonk Content Type',
				name: 'listmonkContentType',
				type: 'options',
				options: [
					{ name: 'HTML', value: 'html' },
					{ name: 'Markdown', value: 'markdown' },
					{ name: 'Not Set', value: '' },
					{ name: 'Plain', value: 'plain' },
				],
				default: '',
				description: 'Listmonk campaign content type',
				displayOptions: { show: { operation: ['uploadText'], platform: ['listmonk', '__manual_platform__'] } },
			},
			{
				displayName: 'Listmonk Send At',
				name: 'listmonkSendAt',
				type: 'string',
				default: '',
				description: 'When to send the Listmonk campaign (ISO-8601)',
				displayOptions: { show: { operation: ['uploadText'], platform: ['listmonk', '__manual_platform__'] } },
			},
			{
				displayName: 'Listmonk Lists',
				name: 'listmonkLists',
				type: 'string',
				default: '',
				description: 'Comma-separated Listmonk list IDs',
				displayOptions: { show: { operation: ['uploadText'], platform: ['listmonk', '__manual_platform__'] } },
			},
			{
				displayName: 'Listmonk Template ID',
				name: 'listmonkTemplateId',
				type: 'string',
				default: '',
				description: 'Template ID used by Listmonk for the campaign',
				displayOptions: { show: { operation: ['uploadText'], platform: ['listmonk', '__manual_platform__'] } },
			},

		// ----- Reddit Specific Parameters -----
			{
				displayName: 'Reddit Subreddit',
				name: 'redditSubreddit',
				type: 'string',
				default: '',
				description: 'Destination subreddit, without r/ (e.g., python)',
				displayOptions: { show: { operation: ['uploadPhotos','uploadText'], platform: ['reddit', '__manual_platform__'] } },
			},
			{
				displayName: 'Reddit Flair ID',
				name: 'redditFlairId',
				type: 'string',
				default: '',
				description: 'ID of the flair template to apply to the post',
				displayOptions: { show: { operation: ['uploadPhotos','uploadText'], platform: ['reddit', '__manual_platform__'] } },
			},
			{
				displayName: 'Reddit Link URL',
				name: 'redditLinkUrl',
				type: 'string',
				default: '',
				description: 'URL for a Reddit link post. Creates a link post with URL preview card instead of a text post.',
				displayOptions: { show: { operation: ['uploadText'], platform: ['reddit', '__manual_platform__'] } },
			},
			{
				displayName: 'Reddit NSFW',
				name: 'redditNsfw',
				type: 'boolean',
				default: false,
				description: 'Whether to mark the Reddit post as NSFW',
				displayOptions: { show: { operation: ['uploadPhotos','uploadText'], platform: ['reddit', '__manual_platform__'] } },
			},
			{
				displayName: 'Reddit Spoiler',
				name: 'redditSpoiler',
				type: 'boolean',
				default: false,
				description: 'Whether to mark the Reddit post as a spoiler',
				displayOptions: { show: { operation: ['uploadPhotos','uploadText'], platform: ['reddit', '__manual_platform__'] } },
			},
			{
				displayName: 'Reddit Flair Text',
				name: 'redditFlairText',
				type: 'string',
				default: '',
				description: 'Flair text when a flair ID is not used',
				displayOptions: { show: { operation: ['uploadPhotos','uploadText'], platform: ['reddit', '__manual_platform__'] } },
			},

		// ----- YouTube Specific Parameters (Video Only) -----
			{
				displayName: 'YouTube Tags',
				name: 'youtubeTags',
				type: 'string',
				default: '',
				description: 'Comma-separated list of tags for YouTube video. Will be sent as an array. Only for Upload Video.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['youtube', '__manual_platform__']
					},
				},
			},
			{
				displayName: 'YouTube Category ID',
				name: 'youtubeCategoryId',
				type: 'string',
				default: '22',
				description: 'Video category ID for YouTube (e.g., 22 for People & Blogs). Only for Upload Video.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['youtube', '__manual_platform__']
					},
				},
			},
			{
				displayName: 'YouTube Privacy Status',
				name: 'youtubePrivacyStatus',
				type: 'options',
				options: [
					{ name: 'Public', value: 'public' },
					{ name: 'Unlisted', value: 'unlisted' },
					{ name: 'Private', value: 'private' },
				],
				default: 'public',
				description: 'Privacy setting for YouTube video (public, unlisted, private). Only for Upload Video.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['youtube', '__manual_platform__']
					},
				},
			},
			{
				displayName: 'YouTube Embeddable',
				name: 'youtubeEmbeddable',
				type: 'boolean',
				default: true,
				description: 'Whether the YouTube video is embeddable. Only for Upload Video.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['youtube', '__manual_platform__']
					},
				},
			},
			{
				displayName: 'YouTube License',
				name: 'youtubeLicense',
				type: 'options',
				options: [
					{ name: 'Standard YouTube License', value: 'youtube' },
					{ name: 'Creative Commons - Attribution', value: 'creativeCommon' },
				],
				default: 'youtube',
				description: 'Video license for YouTube (youtube, creativeCommon). Only for Upload Video.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['youtube', '__manual_platform__']
					},
				},
			},
			{
				displayName: 'YouTube Public Stats Viewable',
				name: 'youtubePublicStatsViewable',
				type: 'boolean',
				default: true,
				description: 'Whether public stats are viewable for the YouTube video. Only for Upload Video.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['youtube', '__manual_platform__']
					},
				},
			},
			{
				displayName: 'YouTube Thumbnail (File or URL)',
				name: 'youtubeThumbnail',
				type: 'string',
				default: '',
				description: 'Custom thumbnail for YouTube video. Provide a binary property name (e.g., data) or a direct HTTP/HTTPS URL. Only for Upload Video.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['youtube', '__manual_platform__']
					},
				},
			},
			{
				displayName: 'YouTube Self Declared Made For Kids',
				name: 'youtubeSelfDeclaredMadeForKids',
				type: 'boolean',
				default: false,
				description: 'Whether this is an explicit declaration for children content (COPPA compliance). Only for Upload Video.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['youtube', '__manual_platform__']
					},
				},
			},
			{
				displayName: 'YouTube Contains Synthetic Media',
				name: 'youtubeContainsSyntheticMedia',
				type: 'boolean',
				default: false,
				description: 'Whether this is a declaration for AI/synthetic content transparency. Only for Upload Video.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['youtube', '__manual_platform__']
					},
				},
			},
			{
				displayName: 'YouTube Default Language',
				name: 'youtubeDefaultLanguage',
				type: 'string',
				default: '',
				description: 'Title/description language (BCP-47 codes like "es", "en"). Only for Upload Video.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['youtube', '__manual_platform__']
					},
				},
			},
			{
				displayName: 'YouTube Default Audio Language',
				name: 'youtubeDefaultAudioLanguage',
				type: 'string',
				default: '',
				description: 'Video audio language (BCP-47 codes like "es-ES", "en-US"). Only for Upload Video.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['youtube', '__manual_platform__']
					},
				},
			},
			{
				displayName: 'YouTube Allowed Countries',
				name: 'youtubeAllowedCountries',
				type: 'string',
				default: '',
				description: 'Comma-separated country codes for allowed regions (ISO 3166-1 alpha-2). Cannot be used with blocked countries. Only for Upload Video.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['youtube', '__manual_platform__']
					},
				},
			},
			{
				displayName: 'YouTube Blocked Countries',
				name: 'youtubeBlockedCountries',
				type: 'string',
				default: '',
				description: 'Comma-separated country codes for blocked regions (ISO 3166-1 alpha-2). Cannot be used with allowed countries. Only for Upload Video.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['youtube', '__manual_platform__']
					},
				},
			},
			{
				displayName: 'YouTube Has Paid Product Placement',
				name: 'youtubeHasPaidProductPlacement',
				type: 'boolean',
				default: false,
				description: 'Whether this is a declaration for paid product placements (FTC compliance). Only for Upload Video.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['youtube', '__manual_platform__']
					},
				},
			},
			{
				displayName: 'YouTube Recording Date',
				name: 'youtubeRecordingDate',
				type: 'dateTime',
				default: '',
				description: 'Recording timestamp (ISO 8601 format). Only for Upload Video.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['youtube', '__manual_platform__']
					},
				},
			},
			{
				displayName: 'YouTube Subtitle Languages',
				name: 'youtubeSubtitleLanguages',
				type: 'string',
				default: '',
				description: 'Comma-separated BCP-47 language codes for subtitle tracks (e.g. "en,es,fr"). Each language maps to a corresponding subtitle file. Only for Upload Video.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['youtube', '__manual_platform__']
					},
				},
			},
			{
				displayName: 'YouTube Subtitle Names',
				name: 'youtubeSubtitleNames',
				type: 'string',
				default: '',
				description: 'Comma-separated display names for subtitle tracks (e.g. "English,Spanish,French"). Optional; defaults to language code if not provided. Only for Upload Video.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['youtube', '__manual_platform__']
					},
				},
			},
			{
				displayName: 'YouTube Subtitle Files',
				name: 'youtubeSubtitleFiles',
				type: 'string',
				default: '',
				description: 'Comma-separated binary property names or URLs for subtitle files (e.g. "data_en,data_es" or "https://example.com/en.srt,https://example.com/es.srt"). Supported formats: SRT, VTT, SBV, SUB, ASS, SSA, TTML. Only for Upload Video.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['youtube', '__manual_platform__']
					},
				},
			},

			{
					displayName: 'YouTube Playlist ID',
					name: 'youtubePlaylistId',
					type: 'string',
					default: '',
					description: 'Optional YouTube playlist ID (e.g. PLxxxxxxxxxxxx) to add the uploaded video to after publishing. For multiple playlists, pass a comma-separated list of IDs. The playlist must belong to the same YouTube channel that owns the upload. Only for Upload Video.',
					displayOptions: {
						show: {
							operation: ['uploadVideo'],
							platform: ['youtube', '__manual_platform__']
						},
					},
				},
			{
				displayName: 'YouTube Notify Subscribers',
				name: 'youtubeNotifySubscribers',
				type: 'boolean',
				default: true,
				description: 'Whether YouTube should notify subscribers when the video is published',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['youtube', '__manual_platform__']
					},
				},
			},
			{
				displayName: 'YouTube Publish At',
				name: 'youtubePublishAt',
				type: 'string',
				default: '',
				description: 'Schedule the YouTube video to go public at this ISO-8601 datetime. Privacy should be private.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['youtube', '__manual_platform__']
					},
				},
			},

				// ----- Pinterest Specific Parameters (Video Only) -----

			{
				displayName: 'Pinterest Board Name or ID',
				name: 'pinterestBoardId',
				type: 'options',
				noDataExpression: true,
				default: '',
				description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				typeOptions: { loadOptionsMethod: 'getPinterestBoards', loadOptionsDependsOn: ['user'] },
				displayOptions: {
					show: {
						resource: ['uploads'],
						operation: ['uploadPhotos', 'uploadVideo'],
						platform: ['pinterest', '__manual_platform__']
					},
				},
			},
			{
				displayName: 'Pinterest Board Name or ID (Manual Entry)',
				name: 'pinterestBoardIdManual',
				type: 'string',
				default: '',
				description: 'Provide the Pinterest board identifier when it does not appear in the list',
				displayOptions: {
					show: {
						resource: ['uploads'],
						operation: ['uploadPhotos', 'uploadVideo'],
						platform: ['pinterest'],
						pinterestBoardId: [MANUAL_PINTEREST_VALUE]
					},
				},
			},
			{
				displayName: 'Pinterest Link (Photo/Video)',
				name: 'pinterestLink',
				type: 'string',
				default: '',
				description: 'Optional link to attach to the Pinterest pin',
				displayOptions: {
					show: {
						operation: ['uploadPhotos', 'uploadVideo'],
						platform: ['pinterest', '__manual_platform__']
					}
				},
			},
			{
				displayName: 'Pinterest Board Section ID',
				name: 'pinterestBoardSectionId',
				type: 'string',
				default: '',
				description: 'Optional Pinterest board section ID',
				displayOptions: {
					show: {
						operation: ['uploadPhotos', 'uploadVideo'],
						platform: ['pinterest', '__manual_platform__']
					}
				},
			},
			{
				displayName: 'Pinterest Cover Image URL (Video)',
				name: 'pinterestCoverImageUrl',
				type: 'string',
				default: '',
				description: 'Optional cover image URL for Pinterest video. If provided, overrides other cover options.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['pinterest', '__manual_platform__']
					}
				},
			},
			{
				displayName: 'Pinterest Cover Image Content Type (Video)',
				name: 'pinterestCoverImageContentType',
				type: 'options',
				options: [
					{ name: 'JPEG', value: 'image/jpeg' },
					{ name: 'PNG', value: 'image/png' },
					{ name: 'GIF', value: 'image/gif' },
					{ name: 'BMP', value: 'image/bmp' },
				],
				default: 'image/jpeg',
				description: 'MIME type for the cover image when providing raw base64 data',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['pinterest', '__manual_platform__']
					}
				},
			},
			{
				displayName: 'Pinterest Cover Image Data (Base64, Video)',
				name: 'pinterestCoverImageData',
				type: 'string',
				default: '',
				description: 'Base64-encoded image bytes for the cover image. Used if URL is not provided.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['pinterest', '__manual_platform__']
					}
				},
			},
			{
				displayName: 'Pinterest Cover Image Key Frame Time (MS, Video)',
				name: 'pinterestCoverImageKeyFrameTime',
				type: 'number',
				default: 0,
				description: 'Key frame time to use as the cover image if no image is provided',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['pinterest', '__manual_platform__']
					}
				},
			},

		// ----- X (Twitter) Specific Parameters -----
			{
				displayName: 'X Tagged User IDs',
				name: 'xTaggedUserIds',
				type: 'string',
				default: '',
				description: 'Comma-separated list of user IDs to tag for X (Twitter)',
				displayOptions: {
					show: {
						operation: ['uploadPhotos', 'uploadVideo'],
						platform: ['x', '__manual_platform__']
					},
				},
			},
			{
				displayName: 'X Reply Settings',
				name: 'xReplySettings',
				type: 'options',
				options: [
					{ name: 'Everyone', value: 'everyone' },
					{ name: 'Following', value: 'following' },
					{ name: 'Mentioned Users', value: 'mentionedUsers' },
					{ name: 'Subscribers', value: 'subscribers' },
					{ name: 'Verified', value: 'verified' },
				],
				default: 'everyone',
				description: 'Who can reply to the post on X (Twitter)',
				displayOptions: {
					show: {
						operation: ['uploadPhotos', 'uploadVideo', 'uploadText'],
						platform: ['x', '__manual_platform__']
					},
				},
			},
			{
				displayName: 'X Nullcast',
				name: 'xNullcastVideo',
				type: 'boolean',
				default: false,
				description: 'Whether to publish X (Twitter) post without broadcasting (promoted-only posts)',
				displayOptions: {
					show: {
						operation: ['uploadPhotos', 'uploadVideo', 'uploadText'],
						platform: ['x', '__manual_platform__']
					},
				},
			},
			{
				displayName: 'X Place ID (Video)',
				name: 'xPlaceIdVideo',
				type: 'string',
				default: '',
				description: 'Location place ID for X (Twitter) video. Not for Text/Photos.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['x', '__manual_platform__']
					},
				},
			},
			{
				displayName: 'X Poll Duration (Minutes)',
				name: 'xPollDuration',
				type: 'number',
				default: 1440,
				description: 'Poll duration in minutes for X (Twitter) post (requires Poll Options)',
				displayOptions: {
					show: {
						operation: ['uploadText'],
						platform: ['x', '__manual_platform__']
					}
				},
			},
			{
				displayName: 'X Poll Options',
				name: 'xPollOptions',
				type: 'string',
				default: '',
				description: 'Comma-separated list of poll options for X (Twitter) post',
				displayOptions: {
					show: {
						operation: ['uploadText'],
						platform: ['x', '__manual_platform__']
					}
				},
			},
			{
				displayName: 'X Poll Reply Settings',
				name: 'xPollReplySettings',
				type: 'options',
				options: [
					{ name: 'Following', value: 'following' },
					{ name: 'Mentioned Users', value: 'mentionedUsers' },
					{ name: 'Everyone', value: 'everyone' },
					{ name: 'Subscribers', value: 'subscribers' },
				],
				default: 'following',
				description: 'Who can reply to the poll in X (Twitter) post',
				displayOptions: {
					show: {
						operation: ['uploadText'],
						platform: ['x', '__manual_platform__']
					}
				},
			},
			{
				displayName: 'X Post URL (Text)',
				name: 'xPostUrlText',
				type: 'string',
				default: '',
				description: 'URL to attach to the X (Twitter) text post. Only for Upload Text.',
				displayOptions: {
					show: {
						operation: ['uploadText'],
						platform: ['x', '__manual_platform__']
					},
				},
			},
			{
				displayName: 'X Quote Tweet ID',
				name: 'xQuoteTweetId',
				type: 'string',
				default: '',
				description: 'ID of the tweet to quote in a quote tweet',
				displayOptions: {
					show: {
						operation: ['uploadText'],
						platform: ['x', '__manual_platform__']
					}
				},
			},
			{
				displayName: 'X Geo Place ID',
				name: 'xGeoPlaceId',
				type: 'string',
				default: '',
				description: 'Geographic place ID to add location to the tweet',
				displayOptions: {
					show: {
						operation: ['uploadPhotos', 'uploadVideo', 'uploadText'],
						platform: ['x', '__manual_platform__']
					},
				},
			},
			{
				displayName: 'X For Super Followers Only',
				name: 'xForSuperFollowersOnly',
				type: 'boolean',
				default: false,
				description: 'Whether the tweet is exclusive for super followers',
				displayOptions: {
					show: {
						operation: ['uploadPhotos', 'uploadVideo', 'uploadText'],
						platform: ['x', '__manual_platform__']
					},
				},
			},
			{
				displayName: 'X Community ID',
				name: 'xCommunityId',
				type: 'string',
				default: '',
				description: 'Community ID for posting in specific communities',
				displayOptions: {
					show: {
						operation: ['uploadPhotos', 'uploadVideo', 'uploadText'],
						platform: ['x', '__manual_platform__']
					},
				},
			},
			{
				displayName: 'X Share with Followers',
				name: 'xShareWithFollowers',
				type: 'boolean',
				default: false,
				description: 'Whether to share community post with followers',
				displayOptions: {
					show: {
						operation: ['uploadPhotos', 'uploadVideo', 'uploadText'],
						platform: ['x', '__manual_platform__']
					},
				},
			},
			{
				displayName: 'X Direct Message Deep Link',
				name: 'xDirectMessageDeepLink',
				type: 'string',
				default: '',
				description: 'Link to take the conversation from public timeline to private Direct Message',
				displayOptions: {
					show: {
						operation: ['uploadPhotos', 'uploadVideo', 'uploadText'],
						platform: ['x', '__manual_platform__']
					}
				},
			},
			{
				displayName: 'X Card URI',
				name: 'xCardUri',
				type: 'string',
				default: '',
				description: 'URI of card (for Twitter Cards/ads/promoted content)',
				displayOptions: {
					show: {
						operation: ['uploadText'],
						platform: ['x', '__manual_platform__']
					}
				},
			},
			{
				displayName: 'X Thread Image Layout',
				name: 'xThreadImageLayout',
				type: 'string',
				default: '',
				description: 'Comma-separated list of how many images to attach to each tweet in the thread (e.g. "4,4" or "2,3,1"). Each value must be 1-4, and the total must equal the number of images. If omitted and more than 4 images are provided, auto-chunks into groups of 4.',
				displayOptions: {
					show: {
						operation: ['uploadPhotos'],
						platform: ['x', '__manual_platform__']
					},
				},
			},
			{
				displayName: 'X Long Text as Single Post',
				name: 'xLongTextAsPost',
				type: 'boolean',
				default: false,
				description: 'Whether to post long text as a single post instead of splitting into a thread (if supported)',
				displayOptions: {
					show: {
						operation: ['uploadPhotos', 'uploadVideo', 'uploadText'],
						platform: ['x', '__manual_platform__']
					},
				},
			},
			{
				displayName: 'X Paid Partnership',
				name: 'xPaidPartnership',
				type: 'boolean',
				default: false,
				description: 'Whether to mark the X post as a paid partnership',
				displayOptions: { show: { operation: ['uploadPhotos','uploadVideo','uploadText'], platform: ['x', '__manual_platform__'] } },
			},
			{
				displayName: 'X Alt Text',
				name: 'xAltText',
				type: 'string',
				default: '',
				description: 'Alt text for X images',
				displayOptions: { show: { operation: ['uploadPhotos'], platform: ['x', '__manual_platform__'] } },
			},
			{
				displayName: 'X Subtitles URL',
				name: 'xSubtitlesUrl',
				type: 'string',
				default: '',
				description: 'URL of a subtitles file for the X video',
				displayOptions: { show: { operation: ['uploadVideo'], platform: ['x', '__manual_platform__'] } },
			},
			{
				displayName: 'X Article Title',
				name: 'xArticleTitle',
				type: 'string',
				default: '',
				description: 'Title for an X article post',
				displayOptions: { show: { operation: ['uploadText'], platform: ['x', '__manual_platform__'] } },
			},
			{
				displayName: 'X Article Body',
				name: 'xArticleBody',
				type: 'string',
				default: '',
				description: 'Body of an X article post',
				typeOptions: { rows: 4 },
				displayOptions: { show: { operation: ['uploadText'], platform: ['x', '__manual_platform__'] } },
			},

			// ----- Manual Platform Entry: Platform-Specific IDs -----
			// These fields only show when "Manual Entry (all fields)" is selected as platform,
			// allowing AI agents and advanced users to provide all platform-specific identifiers.
			{
				displayName: 'LinkedIn Page ID',
				name: 'targetLinkedinPageIdManualEntry',
				type: 'string',
				default: '',
				description: 'LinkedIn company/page ID or vanity name (only needed when posting to LinkedIn)',
				displayOptions: {
					show: {
						operation: ['uploadPhotos', 'uploadVideo', 'uploadText', 'uploadDocument'],
						platform: [MANUAL_PLATFORM_VALUE],
					}
				},
			},
			{
				displayName: 'Facebook Page ID',
				name: 'facebookPageIdManualEntry',
				type: 'string',
				default: '',
				description: 'Facebook page ID or name (only needed when posting to Facebook)',
				displayOptions: {
					show: {
						operation: ['uploadPhotos', 'uploadVideo', 'uploadText'],
						platform: [MANUAL_PLATFORM_VALUE],
					}
				},
			},
			{
				displayName: 'Pinterest Board ID',
				name: 'pinterestBoardIdManualEntry',
				type: 'string',
				default: '',
				description: 'Pinterest board ID (only needed when posting to Pinterest)',
				displayOptions: {
					show: {
						operation: ['uploadPhotos', 'uploadVideo'],
						platform: [MANUAL_PLATFORM_VALUE],
					}
				},
			},

		],
	};

	// Load options methods for dynamic selectors
	methods = {
		loadOptions: {
			async getPlatforms(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const operation = this.getCurrentNodeParameter('operation') as string;
				const allPlatforms = [
					{ name: 'Bluesky', value: 'bluesky' },
					{ name: 'Discord', value: 'discord' },
					{ name: 'Facebook', value: 'facebook' },
					{ name: 'Google Business', value: 'google_business' },
					{ name: 'Instagram', value: 'instagram' },
					{ name: 'LinkedIn', value: 'linkedin' },
					{ name: 'Pinterest', value: 'pinterest' },
					{ name: 'Reddit', value: 'reddit' },
					{ name: 'Telegram', value: 'telegram' },
					{ name: 'Threads', value: 'threads' },
					{ name: 'TikTok', value: 'tiktok' },
					{ name: 'X (Twitter)', value: 'x' },
					{ name: 'YouTube', value: 'youtube' },
					{ name: 'Slack', value: 'slack' },
					{ name: 'Mastodon', value: 'mastodon' },
					{ name: 'Nostr', value: 'nostr' },
					{ name: 'Lemmy', value: 'lemmy' },
					{ name: 'Dev.to', value: 'devto' },
					{ name: 'Hashnode', value: 'hashnode' },
					{ name: 'WordPress', value: 'wordpress' },
					{ name: 'Whop', value: 'whop' },
					{ name: 'Listmonk', value: 'listmonk' },
				];

				const platformSupport: Record<string, string[]> = {
					uploadPhotos: ['bluesky', 'discord', 'facebook', 'google_business', 'instagram', 'linkedin', 'pinterest', 'telegram', 'threads', 'tiktok', 'x', 'reddit', 'mastodon', 'lemmy', 'wordpress'],
					uploadVideo: ['bluesky', 'discord', 'facebook', 'google_business', 'instagram', 'linkedin', 'pinterest', 'reddit', 'telegram', 'threads', 'tiktok', 'x', 'youtube', 'mastodon', 'wordpress'],
					uploadText: ['bluesky', 'discord', 'facebook', 'google_business', 'linkedin', 'reddit', 'telegram', 'threads', 'x', 'slack', 'mastodon', 'nostr', 'lemmy', 'devto', 'hashnode', 'wordpress', 'whop', 'listmonk'],
					uploadDocument: ['linkedin'],
				};

				const supportedPlatforms = platformSupport[operation] || [];
				const filtered = allPlatforms.filter(platform => supportedPlatforms.includes(platform.value));
				filtered.push({ name: 'Manual Entry (all fields)', value: MANUAL_PLATFORM_VALUE });
				return filtered;
			},
			async getFacebookPages(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				try {
					const profile = (this.getCurrentNodeParameter('user') as string | undefined) || '';
					const qs: IDataObject = {};
					if (profile) qs.profile = profile;
					const options: IHttpRequestOptions = {
						url: 'https://api.upload-post.com/api/uploadposts/facebook/pages',
						method: 'GET',
						qs,
						json: true,
					};
					const resp = await this.helpers.httpRequestWithAuthentication.call(this, 'uploadPostApi', options);
					const pages = (resp && (resp.pages || resp.data || [])) as Array<{ id: string; name?: string }>;
					const pageOptions = (pages || []).map(p => ({ name: p.name ? `${p.name} (${p.id})` : p.id, value: p.id }));
					return [
						{ name: 'Manual entry...', value: MANUAL_FACEBOOK_VALUE },
						...pageOptions
					];
				} catch (error) {
					// Return manual option to allow manual input when API fails
					return [
						{ name: 'Manual entry...', value: MANUAL_FACEBOOK_VALUE }
					];
				}
			},
			async getLinkedinPages(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				try {
					const profile = (this.getCurrentNodeParameter('user') as string | undefined) || '';
					const qs: IDataObject = {};
					if (profile) qs.profile = profile;
					const options: IHttpRequestOptions = {
						url: 'https://api.upload-post.com/api/uploadposts/linkedin/pages',
						method: 'GET',
						qs,
						json: true,
					};
					const resp = await this.helpers.httpRequestWithAuthentication.call(this, 'uploadPostApi', options);
					const pages = (resp && (resp.pages || resp.data || [])) as Array<{ id: string; name?: string }>;
					const pageOptions = (pages || []).map(p => ({ name: p.name ? `${p.name} (${p.id})` : p.id, value: p.id }));

					return [
						{ name: 'Manual entry...', value: MANUAL_LINKEDIN_VALUE },
						{ name: 'Me (Personal Profile)', value: 'me' },
						...pageOptions
					];
				} catch (error) {
					// Return manual and "Me" options to allow manual input when API fails
					return [
						{ name: 'Manual entry...', value: MANUAL_LINKEDIN_VALUE },
						{ name: 'Me (Personal Profile)', value: 'me' }
					];
				}
			},
			async getPinterestBoards(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				try {
					const profile = (this.getCurrentNodeParameter('user') as string | undefined) || '';
					const qs: IDataObject = {};
					if (profile) qs.profile = profile;
					const options: IHttpRequestOptions = {
						url: 'https://api.upload-post.com/api/uploadposts/pinterest/boards',
						method: 'GET',
						qs,
						json: true,
					};
					const resp = await this.helpers.httpRequestWithAuthentication.call(this, 'uploadPostApi', options);
					const boards = (resp && (resp.boards || resp.data || [])) as Array<{ id: string; name?: string }>;
					const boardOptions = (boards || []).map(b => ({ name: b.name ? `${b.name} (${b.id})` : b.id, value: b.id }));
					return [
						{ name: 'Manual entry...', value: MANUAL_PINTEREST_VALUE },
						...boardOptions
					];
				} catch (error) {
					// Return manual option to allow manual input when API fails
					return [
						{ name: 'Manual entry...', value: MANUAL_PINTEREST_VALUE }
					];
				}
			},
			async getUserProfiles(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				try {
					const options: IHttpRequestOptions = {
						url: 'https://api.upload-post.com/api/uploadposts/users',
						method: 'GET',
						json: true,
					};
					const resp = await this.helpers.httpRequestWithAuthentication.call(this, 'uploadPostApi', options);
					const profiles = (resp && resp.profiles) as Array<{
						username: string;
						social_accounts: Record<string, any>;
						created_at: string;
					}>;
					const profileOptions = (profiles || []).map(profile => {
						// Create a display name that shows connected platforms
						const connectedPlatforms = Object.keys(profile.social_accounts || {})
							.filter(platform => profile.social_accounts[platform] && typeof profile.social_accounts[platform] === 'object')
							.join(', ');

						const displayName = connectedPlatforms
							? `${profile.username} (${connectedPlatforms})`
							: profile.username;

						return {
							name: displayName,
							value: profile.username
						};
					});
					return [
						{ name: 'Manual entry...', value: MANUAL_USER_VALUE },
						...profileOptions
					];
				} catch (error) {
					// Return manual option to allow manual input when API fails
					return [
						{ name: 'Manual entry...', value: MANUAL_USER_VALUE }
					];
				}
			},
		},
	};


	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			const operation = this.getNodeParameter('operation', itemIndex) as string;
			const ctx: ExecutionContext = {
				node: this,
				items,
				itemIndex,
				operation,
			};

			const config = await buildRequestConfig(ctx);

			const requestOptions: IHttpRequestOptions = {
				url: `${API_BASE_URL}${config.endpoint}`,
				method: config.method,
			};

			if (config.headers) {
				requestOptions.headers = config.headers;
			}
			if (config.isUploadOperation) {
				requestOptions.headers = {
					...(requestOptions.headers ?? {}),
					'Idempotency-Key': buildIdempotencyKey(ctx),
					'X-Upload-Post-Source': 'n8n',
				};
			}
			if (config.qs) {
				requestOptions.qs = config.qs;
			}

			if (config.formData) {
				const multipartPayload = buildMultipartPayload(config.formData);
				const nativeFormData = buildNativeFormData(multipartPayload, this);
				requestOptions.body = nativeFormData as unknown as IDataObject;
				requestOptions.json = false;
			} else if (config.body) {
				// For JSON requests
				requestOptions.body = config.body;
				requestOptions.json = true;
			} else {
				// For requests without body (GET, etc)
				requestOptions.json = true;
			}

			const rawResponse = config.skipCredentialAuth
				? await this.helpers.httpRequest(requestOptions)
				: await this.helpers.httpRequestWithAuthentication.call(
					this,
					'uploadPostApi',
					requestOptions,
				);

			const responseData = parseJsonIfNeeded(rawResponse);

			let finalData: any = responseData;
			if (config.isUploadOperation && config.waitForCompletion) {
				const requestId = responseData && (responseData as any).request_id
					? ((responseData as any).request_id as string)
					: undefined;
				if (requestId) {
					finalData = await pollUploadStatus(
						this,
						requestId,
						config.pollInterval ?? 10,
						config.pollTimeout ?? 600,
					);
				}
			}

			returnData.push({
				json: finalData,
				pairedItem: { item: itemIndex },
			});
		}

		return [returnData];
	}
}

