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

type RequestMethod = 'GET' | 'POST' | 'DELETE';

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
	uploadPhotos: ['bluesky', 'facebook', 'instagram', 'linkedin', 'pinterest', 'threads', 'tiktok', 'x', 'reddit', 'google_business'],
	uploadVideo: ['bluesky', 'facebook', 'instagram', 'linkedin', 'pinterest', 'threads', 'tiktok', 'x', 'youtube', 'google_business'],
	uploadText: ['bluesky', 'facebook', 'linkedin', 'reddit', 'threads', 'x', 'google_business'],
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
	} else if (operation === 'uploadDocument') {
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
	}
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

	formData.selfDeclaredMadeForKids = String(selfDeclaredMadeForKids);
	formData.containsSyntheticMedia = String(containsSyntheticMedia);
	if (defaultLanguage) formData.defaultLanguage = defaultLanguage;
	if (defaultAudioLanguage) formData.defaultAudioLanguage = defaultAudioLanguage;
	if (allowedCountries) formData.allowedCountries = allowedCountries;
	if (blockedCountries) formData.blockedCountries = blockedCountries;
	formData.hasPaidProductPlacement = String(hasPaidProductPlacement);
	if (recordingDate) formData.recordingDate = recordingDate;
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
};

const applyGoogleBusinessOptions = (ctx: ExecutionContext, _operation: UploadOperation, formData: IDataObject) => {
	const locationId = ctx.node.getNodeParameter('gbpLocationId', ctx.itemIndex, '') as string;
	if (locationId) formData.gbp_location_id = locationId;
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
			const qs: IDataObject = {};
			if (Array.isArray(analyticsPlatforms) && analyticsPlatforms.length > 0) {
				qs.platforms = analyticsPlatforms.join(',');
			}
			return {
				endpoint: `/analytics/${encodeURIComponent(profileUsername)}`,
				method: 'GET',
				qs,
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
			const newTimezone = ctx.node.getNodeParameter("newTimezone", ctx.itemIndex, "") as string;
			if (newTimezone) {
				body.timezone = newTimezone;
			}
			}
			return {
				endpoint: `/uploadposts/schedule/${jobId}`,
				method: 'POST',
				body,
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

const buildUserRequest = (ctx: ExecutionContext): RequestConfig => {
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
			const body: IDataObject = { username };
			if (redirectUrl) body.redirect_url = redirectUrl;
			if (logoImage) body.logo_image = logoImage;
			if (redirectButtonText) body.redirect_button_text = redirectButtonText;
			if (Array.isArray(platforms) && platforms.length > 0) body.platforms = platforms;
			body.show_calendar = showCalendar;
			body.readonly_calendar = readonlyCalendar;
			if (connectTitle) body.connect_title = connectTitle;
			if (connectDescription) body.connect_description = connectDescription;
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
				method: 'POST',
				body: { jwt },
				headers: { Authorization: `Bearer ${jwt}` },
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
			const body: IDataObject = {
				channels: { webhook: webhookEnabled },
			};
			if (webhookUrl) body.webhook_url = webhookUrl;
			if (webhookEventsRaw.length > 0) body.webhook_events = webhookEventsRaw;
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
			if (weekStartDay !== '') body.week_start_day = parseInt(weekStartDay, 10);
			return {
				endpoint: '/uploadposts/users/preferences',
				method: 'POST',
				body,
				isUploadOperation: false,
				waitForCompletion: false,
			};
		}
		default:
			throw new NodeOperationError(ctx.node.getNode(), `Unsupported user operation: ${ctx.operation}`, {
				itemIndex: ctx.itemIndex,
			});
	}
};

const buildInstagramRequest = (ctx: ExecutionContext): RequestConfig => {
	switch (ctx.operation) {
		case 'getPostComments': {
			const user = ctx.node.getNodeParameter('instagramUser', ctx.itemIndex) as string;
			const postId = ctx.node.getNodeParameter('instagramPostId', ctx.itemIndex) as string;
			const qs: IDataObject = { platform: 'instagram', user };
			if (postId.startsWith('http://') || postId.startsWith('https://')) {
				qs.post_url = postId;
			} else {
				qs.post_id = postId;
			}
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
		default:
			throw new NodeOperationError(ctx.node.getNode(), `Unsupported Instagram operation: ${ctx.operation}`, {
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
	if (resource === 'monitoring') {
		return buildMonitoringRequest(ctx);
	}
	if (resource === 'users') {
		return buildUserRequest(ctx);
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
		if (
			(statusData && (statusData as any).success === true) ||
			(typeof statusValue === 'string' && ['success', 'completed', 'failed', 'error', 'scheduled', 'queued', 'pending'].includes(statusValue.toLowerCase()))
		) {
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
					{ name: 'Upload', value: 'uploads' },
					{ name: 'Instagram', value: 'instagram' },
					{ name: 'Status & History', value: 'monitoring' },
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
					{ name: 'Upload Photo(s)', value: 'uploadPhotos', action: 'Upload photos', description: 'Upload one or more photos (Supports: TikTok, Instagram, LinkedIn, Facebook, X, Threads)' },
					{ name: 'Upload Text', value: 'uploadText', action: 'Upload a text post', description: 'Upload a text-based post (Supports: X, LinkedIn, Facebook, Threads)' },
					{ name: 'Upload Video', value: 'uploadVideo', action: 'Upload a video', description: 'Upload a single video (Supports: TikTok, Instagram, LinkedIn, YouTube, Facebook, X, Threads)' },
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
					{ name: 'Get Job Status', value: 'getJobStatus', action: 'Get job status', description: 'Check the status of a scheduled or queued post using the job_id' },
					{ name: 'Get Upload History', value: 'getHistory', action: 'Get upload history', description: 'List past uploads with optional filters' },
					{ name: 'Get Upload Status', value: 'getStatus', action: 'Get upload status', description: 'Check the status of an upload using the request_id' },
					{ name: 'List Scheduled Posts', value: 'listScheduled', action: 'List scheduled posts', description: 'List your scheduled (future) posts' },
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
					{ name: 'Get Post Comments', value: 'getPostComments', action: 'Get post comments', description: 'Retrieve all comments on a specific Instagram post' },
					{ name: 'Private Reply to Comment', value: 'privateReplyToComment', action: 'Private reply to comment', description: 'Send a private reply (DM) to the author of a comment' },
					{ name: 'Public Reply to Comment', value: 'publicReplyToComment', action: 'Public reply to comment', description: 'Post a public reply visible under the original comment' },
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
						operation: ['getPostComments', 'privateReplyToComment', 'publicReplyToComment'],
					},
				},
			},
			{
				displayName: 'Post ID or URL',
				name: 'instagramPostId',
				type: 'string',
				required: true,
				default: '',
				description: 'Numeric media ID or full Instagram post URL (e.g., https://www.instagram.com/p/ABC123/)',
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
				description: 'The ID of the comment to reply to (from Get Post Comments)',
				displayOptions: {
					show: {
						resource: ['instagram'],
						operation: ['privateReplyToComment', 'publicReplyToComment'],
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
				description: 'Text to post as the first comment (or reply) immediately after publishing. Supported on Instagram, Facebook, X, Threads, YouTube, Reddit, Bluesky.',
				displayOptions: { show: { resource: ['uploads'], operation: ['uploadPhotos','uploadVideo','uploadText'] } },
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
				description: 'Whether to process the upload asynchronously and return immediately. If you set to false but the upload takes longer than 59 seconds, it will automatically switch to asynchronous processing to avoid timeouts. In that case, use the request_id with the Upload Status endpoint to check the upload status and result.',
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
					displayName: 'Platforms (Optional)',
					name: 'analyticsPlatforms',
					type: 'multiOptions',
					options: [
						{ name: 'Instagram', value: 'instagram' },
						{ name: 'LinkedIn', value: 'linkedin' },
						{ name: 'Facebook', value: 'facebook' },
						{ name: 'X (Twitter)', value: 'x' },
					],
					default: [],
					description: 'Platforms to fetch analytics for (comma-joined in request)',
					displayOptions: { show: { operation: ['getAnalytics'] } },
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
					{ name: 'Facebook', value: 'facebook' },
					{ name: 'Instagram', value: 'instagram' },
					{ name: 'LinkedIn', value: 'linkedin' },
					{ name: 'Threads', value: 'threads' },
					{ name: 'TikTok', value: 'tiktok' },
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
					{ name: 'Public to Everyone', value: 'PUBLIC_TO_EVERYONE' },
					{ name: 'Mutual Follow Friends', value: 'MUTUAL_FOLLOW_FRIENDS' },
					{ name: 'Follower of Creator', value: 'FOLLOWER_OF_CREATOR' },
					{ name: 'Self Only', value: 'SELF_ONLY' },
				],
				default: 'PUBLIC_TO_EVERYONE',
				description: 'Privacy setting for TikTok video (PUBLIC_TO_EVERYONE, MUTUAL_FOLLOW_FRIENDS, etc.). Only for Upload Video.',
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

		// ----- Google Business Specific Parameters -----
			{
				displayName: 'Google Business Location ID',
				name: 'gbpLocationId',
				type: 'string',
				default: '',
				description: 'Location ID for accounts with multiple Google Business Profile locations (e.g., accounts/123/locations/456). If omitted, uses the default connected location.',
				displayOptions: { show: { operation: ['uploadPhotos', 'uploadVideo', 'uploadText'], platform: ['google_business', '__manual_platform__'] } },
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
					{ name: 'Facebook', value: 'facebook' },
					{ name: 'Instagram', value: 'instagram' },
					{ name: 'LinkedIn', value: 'linkedin' },
					{ name: 'Pinterest', value: 'pinterest' },
					{ name: 'Reddit', value: 'reddit' },
					{ name: 'Threads', value: 'threads' },
					{ name: 'TikTok', value: 'tiktok' },
					{ name: 'X (Twitter)', value: 'x' },
					{ name: 'YouTube', value: 'youtube' },
				];

				const platformSupport: Record<string, string[]> = {
					uploadPhotos: ['bluesky', 'facebook', 'instagram', 'linkedin', 'pinterest', 'threads', 'tiktok', 'x', 'reddit'],
					uploadVideo: ['bluesky', 'facebook', 'instagram', 'linkedin', 'pinterest', 'threads', 'tiktok', 'x', 'youtube'],
					uploadText: ['bluesky', 'facebook', 'linkedin', 'reddit', 'threads', 'x'],
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

			const rawResponse = await this.helpers.httpRequestWithAuthentication.call(
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

