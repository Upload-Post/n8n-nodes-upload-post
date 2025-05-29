import {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IRequestOptions,
	NodeConnectionType
} from 'n8n-workflow';

export class UploadPost implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Upload Post',
		name: 'uploadPost',
		icon: 'file:UploadPost.svg',
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Upload content to social media via Upload-Post API',
		defaults: {
			name: 'Upload Post',
		},
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
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Upload Photo(s)',
						value: 'uploadPhotos',
						action: 'Upload photos',
						description: 'Upload one or more photos (Supports: TikTok, Instagram, LinkedIn, Facebook, X, Threads)',
					},
					{
						name: 'Upload Video',
						value: 'uploadVideo',
						action: 'Upload a video',
						description: 'Upload a single video',
					},
					{
						name: 'Upload Text',
						value: 'uploadText',
						action: 'Upload a text post',
						description: 'Upload a text-based post (Supports: X, LinkedIn, Facebook, Threads)',
					},
				],
				default: 'uploadPhotos',
			},

		// Common Fields for all operations
			{
				displayName: 'User Identifier',
				name: 'user',
				type: 'string',
				required: true,
				default: '',
				description: 'User identifier for Upload-Post',
			},
			{
				displayName: 'Platform(s)',
				name: 'platform',
				type: 'multiOptions',
				required: true,
				options: [
					{ name: 'Facebook', value: 'facebook' },
					{ name: 'Instagram', value: 'instagram' },
					{ name: 'LinkedIn', value: 'linkedin' },
					{ name: 'Threads', value: 'threads' },
					{ name: 'TikTok', value: 'tiktok' },
					{ name: 'X (Twitter)', value: 'x' },
					{ name: 'YouTube', value: 'youtube' }, // Only for video & text (as per original generic setup)
				],
				default: [],
				description: 'Platform(s) to upload to. Supported platforms vary by operation.',
			},
			{
				displayName: 'Title / Text Content',
				name: 'title',
				type: 'string',
				required: true,
				default: '',
				description: 'Title of the post/video. For Upload Text, this is the main text content. For TikTok Photos, used as fallback for description.',
			},

		// Fields for Upload Photo(s)
			{
				displayName: 'Photos (Files or URLs)',
				name: 'photos',
				type: 'string',
				required: true,
				default: '',
				description: 'Array of photo files or photo URLs. For files, use binary property names like {{$binary.dataPropertyName}}. For URLs, provide direct HTTPS URLs as strings. Multiple items can be added via "Add Field".',
				displayOptions: {
					show: {
						operation: ['uploadPhotos'],
					},
				},
				typeOptions: {
					multiple: true,
					multipleValueButtonText: 'Add Photo',
				},
			},
			{
				displayName: 'Caption (Post Commentary)',
				name: 'caption',
				type: 'string',
				default: '',
				description: 'Caption/description for Photos/Videos. Used as post commentary. Not used for Upload Text.',
				displayOptions: {
					show: {
						operation: ['uploadPhotos', 'uploadVideo'],
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
				description: 'The video file to upload or a video URL. For files, use binary property name like {{$binary.dataPropertyName}}.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
					},
				},
			},

		// ----- LinkedIn Specific Parameters ----- 
			{
				displayName: 'LinkedIn Visibility',
				name: 'linkedinVisibility',
				type: 'options',
				options: [
					{ name: 'Public', value: 'PUBLIC' },
					{ name: 'Connections', value: 'CONNECTIONS', displayOptions: { show: { operation: ['uploadVideo']}}},
					{ name: 'Logged In', value: 'LOGGED_IN', displayOptions: { show: { operation: ['uploadVideo']}}},
					{ name: 'Container', value: 'CONTAINER', displayOptions: { show: { operation: ['uploadVideo']}}},
				],
				default: 'PUBLIC',
				description: 'Visibility for LinkedIn. For Photos, only PUBLIC is supported by API. Not used for Upload Text.',
				displayOptions: {
					show: {
						operation: ['uploadPhotos', 'uploadVideo'],
						platform: ['linkedin']
					},
				},
			},
			{
				displayName: 'Target LinkedIn Page ID',
				name: 'targetLinkedinPageId',
				type: 'string',
				default: '',
				description: 'LinkedIn page ID to upload to an organization (optional). Used for Photos, Video, and Text operations.',
				displayOptions: {
					show: {
						operation: ['uploadPhotos', 'uploadVideo', 'uploadText'],
						platform: ['linkedin']
					},
				},
			},
			{
				displayName: 'LinkedIn Description',
				name: 'linkedinDescription',
				type: 'string',
				default: '',
				description: 'User commentary for LinkedIn Video. Title is used for Photos/Text post commentary. Not used for Upload Text/Photos by API.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'], // API specific for Video only
						platform: ['linkedin']
					},
				},
			},

		// ----- Facebook Specific Parameters ----- 
			{
				displayName: 'Facebook Page ID',
				name: 'facebookPageId',
				type: 'string',
				required: true,
				default: '',
				description: 'Facebook Page ID. Required for Photos, Video, and Text operations.',
				displayOptions: {
					show: {
						operation: ['uploadPhotos', 'uploadVideo', 'uploadText'],
						platform: ['facebook']
					},
				},
			},
			{
				displayName: 'Facebook Video Description',
				name: 'facebookVideoDescription',
				type: 'string',
				default: '',
				description: 'Description for Facebook Video. If not provided, title is used. Not for Photos/Text.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['facebook']
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
					{ name: 'Scheduled', value: 'SCHEDULED' },
				],
				default: 'PUBLISHED',
				description: 'State for Facebook Video. Not for Photos/Text.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['facebook']
					},
				},
			},

		// ----- TikTok Specific Parameters -----
			{
				displayName: 'TikTok Auto Add Music',
				name: 'tiktokAutoAddMusic',
				type: 'boolean',
				default: false,
				description: 'Whether to auto add music to TikTok photos. Only for Upload Photos.',
				displayOptions: {
					show: {
						operation: ['uploadPhotos'],
						platform: ['tiktok']
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
						platform: ['tiktok']
					},
				},
			},
			{
				displayName: 'TikTok Branded Content (Photo)',
				name: 'tiktokBrandedContentPhoto',
				type: 'boolean',
				default: false,
				description: 'Whether to indicate photo post is branded content (requires Disclose Commercial). Only for Upload Photos.',
				displayOptions: {
					show: {
						operation: ['uploadPhotos'],
						platform: ['tiktok']
					},
				},
			},
			{
				displayName: 'TikTok Disclose Commercial (Photo)',
				name: 'tiktokDiscloseCommercialPhoto',
				type: 'boolean',
				default: false,
				description: 'Whether to disclose commercial nature of photo post. Only for Upload Photos.',
				displayOptions: {
					show: {
						operation: ['uploadPhotos'],
						platform: ['tiktok']
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
						platform: ['tiktok']
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
						platform: ['tiktok']
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
				description: 'Privacy setting for TikTok video. Only for Upload Video.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['tiktok']
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
						platform: ['tiktok']
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
						platform: ['tiktok']
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
						platform: ['tiktok']
					},
				},
			},
			{
				displayName: 'TikTok Brand Content Toggle (Video)',
				name: 'tiktokBrandContentToggle',
				type: 'boolean',
				default: false,
				description: 'Whether to enable branded content for TikTok video. Only for Upload Video.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['tiktok']
					},
				},
			},
			{
				displayName: 'TikTok Brand Organic (Video)',
				name: 'tiktokBrandOrganic',
				type: 'boolean',
				default: false,
				description: 'Whether to enable organic branded content for TikTok video. Only for Upload Video.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['tiktok']
					},
				},
			},
			{
				displayName: 'TikTok Branded Content (Video)',
				name: 'tiktokBrandedContentVideo',
				type: 'boolean',
				default: false,
				description: 'Whether to enable branded content with disclosure for TikTok video. Only for Upload Video.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['tiktok']
					},
				},
			},
			{
				displayName: 'TikTok Brand Organic Toggle (Video)',
				name: 'tiktokBrandOrganicToggle',
				type: 'boolean',
				default: false,
				description: 'Whether to enable organic branded content toggle for TikTok video. Only for Upload Video.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['tiktok']
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
						platform: ['tiktok']
					},
				},
			},

		// ----- Instagram Specific Parameters -----
			{
				displayName: 'Instagram Media Type',
				name: 'instagramMediaType', // Renamed to be generic for Photo/Video
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
						platform: ['instagram']
					},
				},
			},
			{
				displayName: 'Instagram Share to Feed (Video)',
				name: 'instagramShareToFeed',
				type: 'boolean',
				default: true,
				description: 'Whether to share Instagram video (Reel/Story) to feed. Only for Upload Video.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['instagram']
					},
				},
			},
			{
				displayName: 'Instagram Collaborators (Video)',
				name: 'instagramCollaborators',
				type: 'string',
				default: '',
				description: 'Comma-separated collaborator usernames for Instagram video. Only for Upload Video.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['instagram']
					},
				},
			},
			{
				displayName: 'Instagram Cover URL (Video)',
				name: 'instagramCoverUrl',
				type: 'string',
				default: '',
				description: 'URL for custom video cover on Instagram. Only for Upload Video.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['instagram']
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
						platform: ['instagram']
					},
				},
			},
			{
				displayName: 'Instagram User Tags (Video)',
				name: 'instagramUserTags',
				type: 'string',
				default: '',
				description: 'Comma-separated user tags for Instagram video. Only for Upload Video.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['instagram']
					},
				},
			},
			{
				displayName: 'Instagram Location ID (Video)',
				name: 'instagramLocationId',
				type: 'string',
				default: '',
				description: 'Instagram location ID for the video. Only for Upload Video.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['instagram']
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
						platform: ['instagram']
					},
				},
			},

		// ----- YouTube Specific Parameters (Video Only) -----
			{
				displayName: 'YouTube Description',
				name: 'youtubeDescription',
				type: 'string',
				default: '',
				description: 'Description of the video for YouTube. If not provided, title is used.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['youtube']
					},
				},
			},
			{
				displayName: 'YouTube Tags',
				name: 'youtubeTags',
				type: 'string',
				default: '',
				description: 'Comma-separated list of tags for YouTube video. These will be sent as an array.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['youtube']
					},
				},
			},
			{
				displayName: 'YouTube Category ID',
				name: 'youtubeCategoryId',
				type: 'string',
				default: '22',
				description: 'Video category for YouTube',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['youtube']
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
				description: 'Privacy setting for YouTube video',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['youtube']
					},
				},
			},
			{
				displayName: 'YouTube Embeddable',
				name: 'youtubeEmbeddable',
				type: 'boolean',
				default: true,
				description: 'Whether the YouTube video is embeddable',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['youtube']
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
				description: 'Video license for YouTube',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['youtube']
					},
				},
			},
			{
				displayName: 'YouTube Public Stats Viewable',
				name: 'youtubePublicStatsViewable',
				type: 'boolean',
				default: true,
				description: 'Whether public stats are viewable for the YouTube video',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['youtube']
					},
				},
			},
			{
				displayName: 'YouTube Made For Kids',
				name: 'youtubeMadeForKids',
				type: 'boolean',
				default: false,
				description: 'Whether the YouTube video is made for kids',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['youtube']
					},
				},
			},

		// ----- Threads Specific Parameters (Not for Photo) -----
			{
				displayName: 'Threads Description',
				name: 'threadsDescription',
				type: 'string',
				default: '',
				description: 'The user generated commentary for the post on Threads. If not provided, title is used. Not used for Upload Photos.',
				displayOptions: {
					show: {
						operation: ['uploadVideo', 'uploadText'],
						platform: ['threads']
					},
				},
			},

		// ----- X (Twitter) Specific Parameters (Video & Text - Not for Photo) -----
			{
				displayName: 'X Tagged User IDs',
				name: 'xTaggedUserIds',
				type: 'string',
				default: '',
				description: 'Comma-separated list of user IDs to tag. Not used for Upload Photos.',
				displayOptions: {
					show: {
						operation: ['uploadVideo', 'uploadText'],
						platform: ['x']
					},
				},
			},
			{
				displayName: 'X Reply Settings',
				name: 'xReplySettings',
				type: 'options',
				options: [
					{ name: 'Following', value: 'following' },
					{ name: 'Mentioned Users', value: 'mentionedUsers' },
					{ name: 'Everyone', value: 'everyone' },
				],
				default: 'following',
				description: 'Who can reply to the post. Not used for Upload Photos.',
				displayOptions: {
					show: {
						operation: ['uploadVideo', 'uploadText'],
						platform: ['x']
					},
				},
			},
			{
				displayName: 'X Nullcast (Video)',
				name: 'xNullcastVideo',
				type: 'boolean',
				default: false,
				description: 'Whether to publish X (Twitter) video without broadcasting. Not for Text/Photos.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['x']
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
						platform: ['x']
					},
				},
			},
			{
				displayName: 'X Poll Duration (Minutes, Video)',
				name: 'xPollDurationVideo',
				type: 'number',
				default: 1440,
				description: 'Poll duration in minutes for X (Twitter) video post. Requires Poll Options. Not for Text/Photos.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['x']
					},
				},
			},
			{
				displayName: 'X Poll Options (Video)',
				name: 'xPollOptionsVideo',
				type: 'string',
				default: '',
				description: 'Comma-separated list of poll options for X (Twitter) video post. Not for Text/Photos.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['x']
					},
				},
			},
			{
				displayName: 'X Poll Reply Settings (Video)',
				name: 'xPollReplySettingsVideo',
				type: 'options',
				options: [
					{ name: 'Following', value: 'following' },
					{ name: 'Mentioned Users', value: 'mentionedUsers' },
					{ name: 'Everyone', value: 'everyone' },
				],
				default: 'following',
				description: 'Who can reply to the poll in X (Twitter) video post. Not for Text/Photos.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['x']
					},
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
						platform: ['x']
					},
				},
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			const operation = this.getNodeParameter('operation', i) as string;
			const user = this.getNodeParameter('user', i) as string;
			let platforms = this.getNodeParameter('platform', i) as string[];
			const title = this.getNodeParameter('title', i) as string;

			let endpoint = '';
			const formData: IDataObject = {};

			formData.user = user;
			formData.title = title; // Common for all, used as main content for Text, fallback for TikTok photo desc.

			switch (operation) {
				case 'uploadPhotos':
					endpoint = '/upload_photos';
					const photos = this.getNodeParameter('photos', i, []) as string[];
					const caption = this.getNodeParameter('caption', i) as string | undefined;

					// Filter platforms for uploadPhotos
					const allowedPhotoPlatforms = ['tiktok', 'instagram', 'linkedin', 'facebook', 'x', 'threads'];
					platforms = platforms.filter(p => allowedPhotoPlatforms.includes(p));
					formData['platform[]'] = platforms;

					if (photos && photos.length > 0) {
						for (let idx = 0; idx < photos.length; idx++) {
							const photo = photos[idx];
							if (photo.startsWith('{{\$binary')) {
								const binaryPropertyName = photo.substring('{{\$binary.'.length, photo.length - 2);
								const binaryData = await this.helpers.getBinaryDataBuffer(i, binaryPropertyName);
								formData[`photos[${idx}]`] = binaryData;
							} else {
								formData[`photos[${idx}]`] = photo;
							}
						}
					}
					if (caption) formData.caption = caption; // Common caption
					break;
				case 'uploadVideo':
					endpoint = '/upload';
					const video = this.getNodeParameter('video', i) as string;
					const videoCaption = this.getNodeParameter('caption', i) as string | undefined;
					formData['platform[]'] = platforms; // Set platforms before specific logic

					if (video) {
						if (video.startsWith('{{\$binary')) {
							const binaryPropertyName = video.substring('{{\$binary.'.length, video.length - 2);
							const binaryData = await this.helpers.getBinaryDataBuffer(i, binaryPropertyName);
							formData.video = binaryData;
						} else {
							formData.video = video;
						}
					}
					if (videoCaption) formData.caption = videoCaption;
					break;
				case 'uploadText':
					endpoint = '/upload_text';
					const allowedTextPlatforms = ['x', 'linkedin', 'facebook', 'threads'];
					platforms = platforms.filter(p => allowedTextPlatforms.includes(p));
					formData['platform[]'] = platforms;
					// Title is already set as main content. No caption for uploadText.
					break;
			}

			// Add platform specific parameters conditionally
			if (platforms.includes('linkedin')) {
				const targetLinkedinPageId = this.getNodeParameter('targetLinkedinPageId', i) as string | undefined;
				if (targetLinkedinPageId) formData.target_linkedin_page_id = targetLinkedinPageId;

				if (operation === 'uploadPhotos') {
					const linkedinVisibility = this.getNodeParameter('linkedinVisibility', i) as string;
					// API for photos only supports PUBLIC, but we keep the field for consistency and future changes.
					if (linkedinVisibility === 'PUBLIC') {
						formData.visibility = 'PUBLIC';
					}
					// No specific description field for LinkedIn photos, caption is used.
				} else if (operation === 'uploadVideo') {
					const linkedinVisibility = this.getNodeParameter('linkedinVisibility', i) as string;
					const linkedinDescription = this.getNodeParameter('linkedinDescription', i) as string | undefined;
					formData.visibility = linkedinVisibility;
					if (linkedinDescription) formData.description = linkedinDescription;
				} // No specific LinkedIn params for Upload Text other than target_linkedin_page_id (handled above)
			}

			if (platforms.includes('facebook')) {
				const facebookPageId = this.getNodeParameter('facebookPageId', i) as string;
				formData.facebook_page_id = facebookPageId;
				// Caption is common for photos. For video, specific description.
				if (operation === 'uploadVideo') {
					const facebookVideoDescription = this.getNodeParameter('facebookVideoDescription', i) as string | undefined;
					const facebookVideoState = this.getNodeParameter('facebookVideoState', i) as string | undefined;
					if (facebookVideoDescription) formData.description = facebookVideoDescription; // API specific field for video
					if (facebookVideoState) formData.video_state = facebookVideoState;
				} // No other specific params for Facebook photos/text based on new docs
			}

			if (platforms.includes('tiktok')) {
				if (operation === 'uploadPhotos') {
					const tiktokAutoAddMusic = this.getNodeParameter('tiktokAutoAddMusic', i) as boolean | undefined;
					const tiktokDisableComment = this.getNodeParameter('tiktokDisableComment', i) as boolean | undefined;
					const tiktokBrandedContentPhoto = this.getNodeParameter('tiktokBrandedContentPhoto', i) as boolean | undefined;
					const tiktokDiscloseCommercialPhoto = this.getNodeParameter('tiktokDiscloseCommercialPhoto', i) as boolean | undefined;
					const tiktokPhotoCoverIndex = this.getNodeParameter('tiktokPhotoCoverIndex', i) as number | undefined;
					const tiktokPhotoDescription = this.getNodeParameter('tiktokPhotoDescription', i) as string | undefined;

					if (tiktokAutoAddMusic !== undefined) formData.auto_add_music = tiktokAutoAddMusic;
					if (tiktokDisableComment !== undefined) formData.disable_comment = tiktokDisableComment;
					if (tiktokBrandedContentPhoto !== undefined) formData.branded_content = tiktokBrandedContentPhoto;
					if (tiktokDiscloseCommercialPhoto !== undefined) formData.disclose_commercial = tiktokDiscloseCommercialPhoto;
					if (tiktokPhotoCoverIndex !== undefined) formData.photo_cover_index = tiktokPhotoCoverIndex;
					if (tiktokPhotoDescription) formData.description = tiktokPhotoDescription; // API specific description for photos
					// If tiktokPhotoDescription is empty, API defaults to title, which is already in formData.title
					
				} else if (operation === 'uploadVideo') {
					const tiktokDisableComment = this.getNodeParameter('tiktokDisableComment', i) as boolean | undefined;
					const tiktokPrivacyLevel = this.getNodeParameter('tiktokPrivacyLevel', i) as string | undefined;
					const tiktokDisableDuet = this.getNodeParameter('tiktokDisableDuet', i) as boolean | undefined;
					const tiktokDisableStitch = this.getNodeParameter('tiktokDisableStitch', i) as boolean | undefined;
					const tiktokCoverTimestamp = this.getNodeParameter('tiktokCoverTimestamp', i) as number | undefined;
					const tiktokBrandContentToggle = this.getNodeParameter('tiktokBrandContentToggle', i) as boolean | undefined;
					const tiktokBrandOrganic = this.getNodeParameter('tiktokBrandOrganic', i) as boolean | undefined;
					const tiktokBrandedContentVideo = this.getNodeParameter('tiktokBrandedContentVideo', i) as boolean | undefined;
					const tiktokBrandOrganicToggle = this.getNodeParameter('tiktokBrandOrganicToggle', i) as boolean | undefined;
					const tiktokIsAigc = this.getNodeParameter('tiktokIsAigc', i) as boolean | undefined;

					if (tiktokDisableComment !== undefined) formData.disable_comment = tiktokDisableComment;
					if (tiktokPrivacyLevel) formData.privacy_level = tiktokPrivacyLevel;
					if (tiktokDisableDuet !== undefined) formData.disable_duet = tiktokDisableDuet;
					if (tiktokDisableStitch !== undefined) formData.disable_stitch = tiktokDisableStitch;
					if (tiktokCoverTimestamp !== undefined) formData.cover_timestamp = tiktokCoverTimestamp;
					if (tiktokBrandContentToggle !== undefined) formData.brand_content_toggle = tiktokBrandContentToggle;
					if (tiktokBrandOrganic !== undefined) formData.brand_organic = tiktokBrandOrganic;
					if (tiktokBrandedContentVideo !== undefined) formData.branded_content = tiktokBrandedContentVideo;
					if (tiktokBrandOrganicToggle !== undefined) formData.brand_organic_toggle = tiktokBrandOrganicToggle;
					if (tiktokIsAigc !== undefined) formData.is_aigc = tiktokIsAigc;
				}
			}

			if (platforms.includes('instagram')) {
				const instagramMediaType = this.getNodeParameter('instagramMediaType', i) as string | undefined;
				if (instagramMediaType) formData.media_type = instagramMediaType;
				
				if (operation === 'uploadVideo') {
					const instagramShareToFeed = this.getNodeParameter('instagramShareToFeed', i) as boolean | undefined;
					const instagramCollaborators = this.getNodeParameter('instagramCollaborators', i) as string | undefined;
					const instagramCoverUrl = this.getNodeParameter('instagramCoverUrl', i) as string | undefined;
					const instagramAudioName = this.getNodeParameter('instagramAudioName', i) as string | undefined;
					const instagramUserTags = this.getNodeParameter('instagramUserTags', i) as string | undefined;
					const instagramLocationId = this.getNodeParameter('instagramLocationId', i) as string | undefined;
					const instagramThumbOffset = this.getNodeParameter('instagramThumbOffset', i) as string | undefined;

					if (instagramShareToFeed !== undefined) formData.share_to_feed = instagramShareToFeed;
					if (instagramCollaborators) formData.collaborators = instagramCollaborators.split(',').map(user => user.trim());
					if (instagramCoverUrl) formData.cover_url = instagramCoverUrl;
					if (instagramAudioName) formData.audio_name = instagramAudioName;
					if (instagramUserTags) formData.user_tags = instagramUserTags.split(',').map(tag => tag.trim());
					if (instagramLocationId) formData.location_id = instagramLocationId;
					if (instagramThumbOffset) formData.thumb_offset = instagramThumbOffset;
				}
			}

			if (platforms.includes('youtube') && operation === 'uploadVideo') {
				const youtubeDescription = this.getNodeParameter('youtubeDescription', i) as string | undefined;
				const youtubeTags = this.getNodeParameter('youtubeTags', i) as string | undefined;
				const youtubeCategoryId = this.getNodeParameter('youtubeCategoryId', i) as string | undefined;
				const youtubePrivacyStatus = this.getNodeParameter('youtubePrivacyStatus', i) as string | undefined;
				const youtubeEmbeddable = this.getNodeParameter('youtubeEmbeddable', i) as boolean | undefined;
				const youtubeLicense = this.getNodeParameter('youtubeLicense', i) as string | undefined;
				const youtubePublicStatsViewable = this.getNodeParameter('youtubePublicStatsViewable', i) as boolean | undefined;
				const youtubeMadeForKids = this.getNodeParameter('youtubeMadeForKids', i) as boolean | undefined;

				if (youtubeDescription) formData.description = youtubeDescription;
				if (youtubeTags) formData.tags = youtubeTags.split(',').map(tag => tag.trim());
				if (youtubeCategoryId) formData.categoryId = youtubeCategoryId;
				if (youtubePrivacyStatus) formData.privacyStatus = youtubePrivacyStatus;
				if (youtubeEmbeddable !== undefined) formData.embeddable = youtubeEmbeddable;
				if (youtubeLicense) formData.license = youtubeLicense;
				if (youtubePublicStatsViewable !== undefined) formData.publicStatsViewable = youtubePublicStatsViewable;
				if (youtubeMadeForKids !== undefined) formData.madeForKids = youtubeMadeForKids;
			}

			if (platforms.includes('threads')) {
				if (operation === 'uploadVideo'){
					const threadsDescription = this.getNodeParameter('threadsDescription', i) as string | undefined;
					if (threadsDescription) formData.description = threadsDescription;
				}
				// For Threads photos/text, no specific params beyond common ones according to docs (title/caption)
			}

			if (platforms.includes('x')) {
				// For X photos, no specific params beyond common ones according to docs (title/caption)
				if (operation === 'uploadText') {
					const xPostUrlText = this.getNodeParameter('xPostUrlText', i) as string | undefined;
					if (xPostUrlText) formData.post_url = xPostUrlText;
					// Clear other X params not applicable to text
					delete formData.tagged_user_ids;
					delete formData.reply_settings;
					delete formData.nullcast;
					delete formData.place_id;
					delete formData.poll_duration;
					delete formData.poll_options;
					delete formData.poll_reply_settings;
				} else if (operation === 'uploadVideo') {
					const xTaggedUserIds = this.getNodeParameter('xTaggedUserIds', i) as string | undefined;
					const xReplySettings = this.getNodeParameter('xReplySettings', i) as string | undefined;
					const xNullcastVideo = this.getNodeParameter('xNullcastVideo', i) as boolean | undefined;
					const xPlaceIdVideo = this.getNodeParameter('xPlaceIdVideo', i) as string | undefined;
					const xPollDurationVideo = this.getNodeParameter('xPollDurationVideo', i) as number | undefined;
					const xPollOptionsVideo = this.getNodeParameter('xPollOptionsVideo', i) as string | undefined;
					const xPollReplySettingsVideo = this.getNodeParameter('xPollReplySettingsVideo', i) as string | undefined;

					if (xTaggedUserIds) formData.tagged_user_ids = xTaggedUserIds.split(',').map(id => id.trim());
					if (xReplySettings) formData.reply_settings = xReplySettings;
					if (xNullcastVideo !== undefined) formData.nullcast = xNullcastVideo;
					if (xPlaceIdVideo) formData.place_id = xPlaceIdVideo;
					if (xPollDurationVideo !== undefined) formData.poll_duration = xPollDurationVideo;
					if (xPollOptionsVideo) formData.poll_options = xPollOptionsVideo.split(',').map(opt => opt.trim());
					if (xPollReplySettingsVideo) formData.poll_reply_settings = xPollReplySettingsVideo;
				}
			}

			const credentials = await this.getCredentials('uploadPostApi');
			const apiKey = credentials.apiKey as string;

			const options: IRequestOptions = {
				uri: `https://api.upload-post.com/api${endpoint}`,
				method: 'POST',
				headers: {
					'Authorization': `Apikey ${apiKey}`,
				},
				formData,
				json: true,
			};

			this.logger.info(`[UploadPost] Request: ${options.method} ${options.uri}`);
			this.logger.info(`[UploadPost] Request Headers: ${JSON.stringify(options.headers)}`);
			this.logger.info(`[UploadPost] Request FormData: ${JSON.stringify(formData)}`);

			const responseData = await this.helpers.request(options);

			returnData.push({
				json: responseData,
				pairedItem: {
					item: i,
				},
			});
		}

		return [returnData];
	}
}

