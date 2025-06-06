import { Buffer } from 'buffer';
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
						description: 'Upload a single video (Supports: TikTok, Instagram, LinkedIn, YouTube, Facebook, X, Threads)',
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
				description: 'The Profile Name you created in your upload-post.com account. You can find it in the \'Manage Users\' section (e.g., app.upload-post.com/manage-users).',
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
					{ name: 'YouTube', value: 'youtube' },
				],
				default: [],
				description: 'Platform(s) to upload to. Supported platforms vary by operation.',
			},
			{
				displayName: 'Title / Main Content',
				name: 'title',
				type: 'string',
				required: true,
				default: '',
				description: 'Title of the post. For Upload Text, this is the main text content. For some video platforms, this acts as a fallback for description if a specific description is not provided.',
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
			{
				displayName: 'Caption (Photo/Video Commentary)',
				name: 'caption',
				type: 'string',
				default: '',
				description: 'General caption/commentary for Photo or Video posts. For some video platforms, a specific \'Description\' field might be used instead (see platform-specific options). Not used for Upload Text.',
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
				description: 'The video file to upload or a video URL. For files, enter the binary property name (e.g., data).',
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
					{ name: 'Connections', value: 'CONNECTIONS'},
					{ name: 'Logged In', value: 'LOGGED_IN', displayOptions: { show: { operation: ['uploadVideo'] } } },
					{ name: 'Container', value: 'CONTAINER', displayOptions: { show: { operation: ['uploadVideo'] } } },
				],
				default: 'PUBLIC',
				description: 'Visibility for LinkedIn. For Photos, only PUBLIC is supported by API. For Video, CONNECTIONS, PUBLIC, LOGGED_IN, CONTAINER. Not used for Upload Text.',
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
				displayName: 'LinkedIn Video Description',
				name: 'linkedinDescription',
				type: 'string',
				default: '',
				description: 'User commentary for LinkedIn Video. If not provided, Title is used. Not for Photos/Text.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
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
				description: 'Description for Facebook Video. If not provided, Title is used. Not for Photos/Text.',
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
				description: 'State for Facebook Video (DRAFT, PUBLISHED, SCHEDULED). Not for Photos/Text.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['facebook']
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
				description: 'Privacy setting for TikTok video (PUBLIC_TO_EVERYONE, MUTUAL_FOLLOW_FRIENDS, etc.). Only for Upload Video.',
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
				description: 'Comma-separated collaborator usernames for Instagram video. Sent as a string. Only for Upload Video.',
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
				description: 'Comma-separated user tags for Instagram video. Sent as a string. Only for Upload Video.',
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
				displayName: 'YouTube Video Description',
				name: 'youtubeDescription',
				type: 'string',
				default: '',
				description: 'Description of the video for YouTube. If not provided, Title is used. Only for Upload Video.',
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
				description: 'Comma-separated list of tags for YouTube video. Will be sent as an array. Only for Upload Video.',
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
				description: 'Video category ID for YouTube (e.g., 22 for People & Blogs). Only for Upload Video.',
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
				description: 'Privacy setting for YouTube video (public, unlisted, private). Only for Upload Video.',
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
				description: 'Whether the YouTube video is embeddable. Only for Upload Video.',
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
				description: 'Video license for YouTube (youtube, creativeCommon). Only for Upload Video.',
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
				description: 'Whether public stats are viewable for the YouTube video. Only for Upload Video.',
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
				description: 'Whether the YouTube video is made for kids. Only for Upload Video.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['youtube']
					},
				},
			},

		// ----- Threads Specific Parameters (Not for Photo) -----
			{
				displayName: 'Threads Video Description',
				name: 'threadsDescription',
				type: 'string',
				default: '',
				description: 'User commentary for Threads video. If not provided, Title is used. Not for Photos/Text.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['threads']
					},
				},
			},

		// ----- X (Twitter) Specific Parameters (Video & Text - Not for Photo) -----
			{
				displayName: 'X Tagged User IDs (Video/Text)',
				name: 'xTaggedUserIds',
				type: 'string',
				default: '',
				description: 'Comma-separated list of user IDs to tag for X (Twitter). Not for Photos.',
				displayOptions: {
					show: {
						operation: ['uploadVideo', 'uploadText'],
						platform: ['x']
					},
				},
			},
			{
				displayName: 'X Reply Settings (Video/Text)',
				name: 'xReplySettings',
				type: 'options',
				options: [
					{ name: 'Following', value: 'following' },
					{ name: 'Mentioned Users', value: 'mentionedUsers' },
					{ name: 'Everyone', value: 'everyone' },
				],
				default: 'following',
				description: 'Who can reply to the post on X (Twitter) (following, mentionedUsers, everyone). Not for Photos.',
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
				description: 'Poll duration in minutes for X (Twitter) video post (requires Poll Options). Not for Text/Photos.',
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
				description: 'Comma-separated list of poll options for X (Twitter) video post. Will be sent as an array. Not for Text/Photos.',
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
				description: 'Who can reply to the poll in X (Twitter) video post (following, mentionedUsers, everyone). Not for Text/Photos.',
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
			formData.title = title;

			switch (operation) {
				case 'uploadPhotos':
					endpoint = '/upload_photos';
					const photoCaption = this.getNodeParameter('caption', i) as string | undefined;

					// Handle 'photos' parameter which can be string or string[]
					let photosInput = this.getNodeParameter('photos', i, []) as string | string[];
					let photosToProcess: string[];

					if (typeof photosInput === 'string') {
						// If it's a string, split by comma for multiple items, trim, and filter empty.
						// This handles cases like "url1,url2" or "{{$binary.data1}},{{$binary.data2}}"
						// or a single item like "url1" or "{{$binary.data1}}".
						photosToProcess = photosInput.split(',').map(item => item.trim()).filter(item => item !== '');
					} else {
						// It's already string[] (from "Add Field" or if the parameter somehow became an array),
						// filter out any non-string or empty string items.
						photosToProcess = photosInput.filter(item => typeof item === 'string' && item.trim() !== '');
					}

					const allowedPhotoPlatforms = ['tiktok', 'instagram', 'linkedin', 'facebook', 'x', 'threads'];
					platforms = platforms.filter(p => allowedPhotoPlatforms.includes(p));
					formData['platform[]'] = platforms;

					if (photosToProcess.length > 0) {
						const photoArray: Array<string | { value: Buffer; options: { filename: string; contentType?: string } }> = [];
						for (const photoItem of photosToProcess) {
							// Ensure photoItem is a non-empty string before processing
							if (typeof photoItem === 'string' && photoItem) {
								if (photoItem.toLowerCase().startsWith('http://') || photoItem.toLowerCase().startsWith('https://')) {
									// It's a URL
									photoArray.push(photoItem);
								} else {
									// Assume it's a binary property name
									const binaryPropertyName = photoItem;
									try {
										const binaryBuffer = await this.helpers.getBinaryDataBuffer(i, binaryPropertyName);
										const binaryFileDetails = items[i].binary![binaryPropertyName];
										photoArray.push({
											value: binaryBuffer,
											options: {
												filename: binaryFileDetails.fileName ?? binaryPropertyName,
												contentType: binaryFileDetails.mimeType,
											},
										});
									} catch (error) {
										// Log a warning if binary data for the given property name is not found
										this.logger.warn(`[UploadPost Node] Could not find binary data for property '${binaryPropertyName}' in item ${i}. Error: ${error.message}`);
										// Optionally, you could decide to throw an error or add the photoItem as a string if that's desired fallback behavior.
										// For now, we'll just skip this item if the binary data isn't found to prevent sending a non-URL string.
									}
								}
							}
						}
						// Only add 'photos[]' to formData if there are items in photoArray
						if (photoArray.length > 0) {
							formData['photos[]'] = photoArray;
						}
					}
					if (photoCaption) formData.caption = photoCaption;
					break;
				case 'uploadVideo':
					endpoint = '/upload';
					const videoInput = this.getNodeParameter('video', i) as string;
					
					const allowedVideoPlatforms = ['tiktok', 'instagram', 'linkedin', 'youtube', 'facebook', 'x', 'threads'];
					platforms = platforms.filter(p => allowedVideoPlatforms.includes(p));
					formData['platform[]'] = platforms;

					if (videoInput) {
						if (videoInput.toLowerCase().startsWith('http://') || videoInput.toLowerCase().startsWith('https://')) {
							// It's a URL
							formData.video = videoInput;
						} else {
							// Assume it's a binary property name
							const binaryPropertyName = videoInput;
							try {
								const binaryBuffer = await this.helpers.getBinaryDataBuffer(i, binaryPropertyName);
								const binaryFileDetails = items[i].binary![binaryPropertyName];
								formData.video = {
									value: binaryBuffer,
									options: {
										filename: binaryFileDetails.fileName ?? binaryPropertyName,
										contentType: binaryFileDetails.mimeType,
									},
								};
							} catch (error) {
								this.logger.warn(`[UploadPost Node] Could not find binary data for video property '${binaryPropertyName}' in item ${i}. Error: ${error.message}`);
								// If the video field is mandatory for the API, not adding it here might cause an API error.
								// You might want to throw an error if binaryData is essential:
								// throw new NodeApiError(this.getNode(), items[i].json, { message: `Binary data for video property '${binaryPropertyName}' not found.` });
							}
						}
					}
					break;
				case 'uploadText':
					endpoint = '/upload_text';
					const allowedTextPlatforms = ['x', 'linkedin', 'facebook', 'threads'];
					platforms = platforms.filter(p => allowedTextPlatforms.includes(p));
					formData['platform[]'] = platforms;
					break;
			}

			// Add platform specific parameters conditionally
			if (platforms.includes('linkedin')) {
				const targetLinkedinPageId = this.getNodeParameter('targetLinkedinPageId', i) as string | undefined;
				if (targetLinkedinPageId) formData.target_linkedin_page_id = targetLinkedinPageId;

				if (operation === 'uploadPhotos') {
					const linkedinVisibility = this.getNodeParameter('linkedinVisibility', i) as string;
					if (linkedinVisibility === 'PUBLIC') {
						formData.visibility = 'PUBLIC';
					}
				} else if (operation === 'uploadVideo') {
					const linkedinVisibility = this.getNodeParameter('linkedinVisibility', i) as string;
					const linkedinDescription = this.getNodeParameter('linkedinDescription', i) as string | undefined;
					formData.visibility = linkedinVisibility;
					if (linkedinDescription) formData.description = linkedinDescription;
				}
			}

			if (platforms.includes('facebook')) {
				const facebookPageId = this.getNodeParameter('facebookPageId', i) as string;
				formData.facebook_page_id = facebookPageId;

				if (operation === 'uploadVideo') {
					const facebookVideoDescription = this.getNodeParameter('facebookVideoDescription', i) as string | undefined;
					const facebookVideoState = this.getNodeParameter('facebookVideoState', i) as string | undefined;
					if (facebookVideoDescription) formData.description = facebookVideoDescription;
					if (facebookVideoState) formData.video_state = facebookVideoState;
				}
			}

			if (platforms.includes('tiktok')) {
				if (operation === 'uploadPhotos') {
					const tiktokAutoAddMusic = this.getNodeParameter('tiktokAutoAddMusic', i) as boolean | undefined;
					const tiktokDisableComment = this.getNodeParameter('tiktokDisableComment', i) as boolean | undefined;
					const tiktokBrandedContentPhoto = this.getNodeParameter('tiktokBrandedContentPhoto', i) as boolean | undefined;
					const tiktokDiscloseCommercialPhoto = this.getNodeParameter('tiktokDiscloseCommercialPhoto', i) as boolean | undefined;
					const tiktokPhotoCoverIndex = this.getNodeParameter('tiktokPhotoCoverIndex', i) as number | undefined;
					const tiktokPhotoDescription = this.getNodeParameter('tiktokPhotoDescription', i) as string | undefined;

					if (tiktokAutoAddMusic !== undefined) formData.auto_add_music = String(tiktokAutoAddMusic);
					if (tiktokDisableComment !== undefined) formData.disable_comment = String(tiktokDisableComment);
					if (tiktokBrandedContentPhoto !== undefined) formData.branded_content = String(tiktokBrandedContentPhoto);
					if (tiktokDiscloseCommercialPhoto !== undefined) formData.disclose_commercial = String(tiktokDiscloseCommercialPhoto);
					if (tiktokPhotoCoverIndex !== undefined) formData.photo_cover_index = tiktokPhotoCoverIndex;
					if (tiktokPhotoDescription) formData.description = tiktokPhotoDescription;
					
				} else if (operation === 'uploadVideo') {
					const tiktokPrivacyLevel = this.getNodeParameter('tiktokPrivacyLevel', i) as string | undefined;
					const tiktokDisableDuet = this.getNodeParameter('tiktokDisableDuet', i) as boolean | undefined;
					const tiktokDisableComment = this.getNodeParameter('tiktokDisableComment', i) as boolean | undefined;
					const tiktokDisableStitch = this.getNodeParameter('tiktokDisableStitch', i) as boolean | undefined;
					const tiktokCoverTimestamp = this.getNodeParameter('tiktokCoverTimestamp', i) as number | undefined;
					const tiktokBrandContentToggle = this.getNodeParameter('tiktokBrandContentToggle', i) as boolean | undefined;
					const tiktokBrandOrganic = this.getNodeParameter('tiktokBrandOrganic', i) as boolean | undefined;
					const tiktokBrandedContentVideo = this.getNodeParameter('tiktokBrandedContentVideo', i) as boolean | undefined;
					const tiktokBrandOrganicToggle = this.getNodeParameter('tiktokBrandOrganicToggle', i) as boolean | undefined;
					const tiktokIsAigc = this.getNodeParameter('tiktokIsAigc', i) as boolean | undefined;

					if (tiktokPrivacyLevel) formData.privacy_level = tiktokPrivacyLevel;
					if (tiktokDisableDuet !== undefined) formData.disable_duet = String(tiktokDisableDuet);
					if (tiktokDisableComment !== undefined) formData.disable_comment = String(tiktokDisableComment);
					if (tiktokDisableStitch !== undefined) formData.disable_stitch = String(tiktokDisableStitch);
					if (tiktokCoverTimestamp !== undefined) formData.cover_timestamp = tiktokCoverTimestamp;
					if (tiktokBrandContentToggle !== undefined) formData.brand_content_toggle = String(tiktokBrandContentToggle);
					if (tiktokBrandOrganic !== undefined) formData.brand_organic = String(tiktokBrandOrganic);
					if (tiktokBrandedContentVideo !== undefined) formData.branded_content = String(tiktokBrandedContentVideo);
					if (tiktokBrandOrganicToggle !== undefined) formData.brand_organic_toggle = String(tiktokBrandOrganicToggle);
					if (tiktokIsAigc !== undefined) formData.is_aigc = String(tiktokIsAigc);
				}
			}

			if (platforms.includes('instagram')) {
				const instagramMediaTypeInput = this.getNodeParameter('instagramMediaType', i) as string | undefined;
				let finalInstagramMediaType = instagramMediaTypeInput;

				if (operation === 'uploadPhotos') {
					if (!instagramMediaTypeInput || !['IMAGE', 'STORIES'].includes(instagramMediaTypeInput) ) {
						finalInstagramMediaType = 'IMAGE';
					}
				} else if (operation === 'uploadVideo') {
					if (!instagramMediaTypeInput || !['REELS', 'STORIES'].includes(instagramMediaTypeInput)) {
						finalInstagramMediaType = 'REELS';
					}
				}
				if (finalInstagramMediaType) formData.media_type = finalInstagramMediaType;
				
				if (operation === 'uploadVideo') {
					const instagramShareToFeed = this.getNodeParameter('instagramShareToFeed', i) as boolean | undefined;
					const instagramCollaborators = this.getNodeParameter('instagramCollaborators', i) as string | undefined;
					const instagramCoverUrl = this.getNodeParameter('instagramCoverUrl', i) as string | undefined;
					const instagramAudioName = this.getNodeParameter('instagramAudioName', i) as string | undefined;
					const instagramUserTags = this.getNodeParameter('instagramUserTags', i) as string | undefined;
					const instagramLocationId = this.getNodeParameter('instagramLocationId', i) as string | undefined;
					const instagramThumbOffset = this.getNodeParameter('instagramThumbOffset', i) as string | undefined;

					if (instagramShareToFeed !== undefined) formData.share_to_feed = String(instagramShareToFeed);
					if (instagramCollaborators) formData.collaborators = instagramCollaborators;
					if (instagramCoverUrl) formData.cover_url = instagramCoverUrl;
					if (instagramAudioName) formData.audio_name = instagramAudioName;
					if (instagramUserTags) formData.user_tags = instagramUserTags;
					if (instagramLocationId) formData.location_id = instagramLocationId;
					if (instagramThumbOffset) formData.thumb_offset = instagramThumbOffset;
				}
			}

			if (platforms.includes('youtube') && operation === 'uploadVideo') {
				const youtubeDescription = this.getNodeParameter('youtubeDescription', i) as string | undefined;
				const youtubeTagsRaw = this.getNodeParameter('youtubeTags', i) as string | undefined;
				const youtubeCategoryId = this.getNodeParameter('youtubeCategoryId', i) as string | undefined;
				const youtubePrivacyStatus = this.getNodeParameter('youtubePrivacyStatus', i) as string | undefined;
				const youtubeEmbeddable = this.getNodeParameter('youtubeEmbeddable', i) as boolean | undefined;
				const youtubeLicense = this.getNodeParameter('youtubeLicense', i) as string | undefined;
				const youtubePublicStatsViewable = this.getNodeParameter('youtubePublicStatsViewable', i) as boolean | undefined;
				const youtubeMadeForKids = this.getNodeParameter('youtubeMadeForKids', i) as boolean | undefined;

				if (youtubeDescription) formData.description = youtubeDescription;
				if (youtubeTagsRaw) formData.tags = youtubeTagsRaw.split(',').map(tag => tag.trim());
				if (youtubeCategoryId) formData.categoryId = youtubeCategoryId;
				if (youtubePrivacyStatus) formData.privacyStatus = youtubePrivacyStatus;
				if (youtubeEmbeddable !== undefined) formData.embeddable = String(youtubeEmbeddable);
				if (youtubeLicense) formData.license = youtubeLicense;
				if (youtubePublicStatsViewable !== undefined) formData.publicStatsViewable = String(youtubePublicStatsViewable);
				if (youtubeMadeForKids !== undefined) formData.madeForKids = String(youtubeMadeForKids);
			}

			if (platforms.includes('threads')) {
				if (operation === 'uploadVideo'){
					const threadsDescription = this.getNodeParameter('threadsDescription', i) as string | undefined;
					if (threadsDescription) formData.description = threadsDescription;
				}
			}

			if (platforms.includes('x')) {
				if (operation === 'uploadText') {
					const xPostUrlText = this.getNodeParameter('xPostUrlText', i) as string | undefined;
					if (xPostUrlText) formData.post_url = xPostUrlText;
					
					const xTaggedUserIdsText = this.getNodeParameter('xTaggedUserIds', i) as string | undefined;
					const xReplySettingsText = this.getNodeParameter('xReplySettings', i) as string | undefined;
					if (xTaggedUserIdsText) formData.tagged_user_ids = xTaggedUserIdsText.split(',').map(id => id.trim());
					if (xReplySettingsText) formData.reply_settings = xReplySettingsText;
					
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
					const xPollOptionsVideoRaw = this.getNodeParameter('xPollOptionsVideo', i) as string | undefined;
					const xPollReplySettingsVideo = this.getNodeParameter('xPollReplySettingsVideo', i) as string | undefined;

					if (xTaggedUserIds) formData.tagged_user_ids = xTaggedUserIds.split(',').map(id => id.trim());
					if (xReplySettings) formData.reply_settings = xReplySettings;
					if (xNullcastVideo !== undefined) formData.nullcast = String(xNullcastVideo);
					if (xPlaceIdVideo) formData.place_id = xPlaceIdVideo;
					if (xPollDurationVideo !== undefined) formData.poll_duration = xPollDurationVideo;
					if (xPollOptionsVideoRaw) formData.poll_options = xPollOptionsVideoRaw.split(',').map(opt => opt.trim());
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

