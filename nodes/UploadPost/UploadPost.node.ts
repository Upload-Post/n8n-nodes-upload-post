import {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	INodeExecutionData,
	INodeProperties,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	IRequestOptions,
	NodeConnectionType,
	NodeOperationError,
} from 'n8n-workflow';

export class UploadPost implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Upload Post',
		name: 'uploadPost',
		icon: 'file:UploadPost.svg', // You'll need to add an SVG icon
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
		requestDefaults: {
			baseURL: 'https://api.upload-post.com/api',
			headers: {
				'Accept': 'application/json',
			},
		},
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
						description: 'Upload one or more photos',
						routing: {
							request: {
								method: 'POST',
								url: '/upload_photos',
							},
						},
					},
					{
						name: 'Upload Video',
						value: 'uploadVideo',
						action: 'Upload a video',
						description: 'Upload a single video',
						routing: {
							request: {
								method: 'POST',
								url: '/upload', // Video endpoint is /upload
							},
						},
					},
					{
						name: 'Upload Text',
						value: 'uploadText',
						action: 'Upload a text post',
						description: 'Upload a text-based post',
						routing: {
							request: {
								method: 'POST',
								url: '/upload_text',
							},
						},
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
				routing: {
					send: {
						type: 'body',
						property: 'user',
					}
				}
			},
			{
				displayName: 'Platform(s)',
				name: 'platform',
				type: 'multiOptions',
				required: true,
				options: [ // Supported values from docs
					{ name: 'Facebook', value: 'facebook' },
					{ name: 'Instagram', value: 'instagram' },
					{ name: 'LinkedIn', value: 'linkedin' },
					{ name: 'Threads', value: 'threads' },
					{ name: 'TikTok', value: 'tiktok' },
					{ name: 'X (Twitter)', value: 'x' },
					{ name: 'YouTube', value: 'youtube' }, // Only for video
				],
				default: [],
				description: 'Platform(s) to upload to',
				routing: {
					send: {
						type: 'body',
						property: 'platform[]', // API expects platform[]
					}
				}
			},
			{
				displayName: 'Title',
				name: 'title',
				type: 'string',
				required: true,
				default: '',
				description: 'Title of the post/video/text',
				routing: {
					send: {
						type: 'body',
						property: 'title',
					}
				}
			},

		// Fields for Upload Photo(s)
			{
				displayName: 'Photos (Files or URLs)',
				name: 'photos',
				type: 'string', // Can be URLs or binary file references
				required: true,
				default: '',
				description: 'Array of photo files or photo URLs. For files, use binary property names like {{$binary.dataPropertyName}}. For URLs, provide direct HTTPS URLs as strings. Multiple items can be added via "Add Field".',
				displayOptions: {
					show: {
						operation: ['uploadPhotos'],
					},
				},
				typeOptions: {
					multiple: true, // Allows adding multiple photo fields
					multipleValueButtonText: 'Add Photo',
				},
				routing: {
					send: {
						type: 'body',
						property: 'photos[]',
						value: '={{ $value.startsWith("http") ? $value : { "data": $value, "isBinary": true } }}',
					}
				}
			},
			{
				displayName: 'Caption',
				name: 'caption',
				type: 'string',
				default: '',
				description: 'Caption/description for the photos (post commentary)',
				displayOptions: {
					show: {
						operation: ['uploadPhotos'],
					},
				},
				routing: {
					send: {
						type: 'body',
						property: 'caption',
					}
				}
			},

		// Fields for Upload Video
			{
				displayName: 'Video (File or URL)',
				name: 'video',
				type: 'string', // Can be a URL or binary file reference
				required: true,
				default: '',
				description: 'The video file to upload or a video URL. For files, use binary property name like {{$binary.dataPropertyName}}.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
					},
				},
				routing: {
					send: {
						type: 'body',
						property: 'video',
						value: '={{ $value.startsWith("http") ? $value : { "data": $value, "isBinary": true } }}',
					}
				}
			},
		// Note: Text upload uses the common 'title' field as its main content based on API docs.
		// Platform specific parameters will be added as separate optional fields

		// ----- LinkedIn Specific Parameters (Photo & Video & Text) -----
			{
				displayName: 'LinkedIn Visibility',
				name: 'linkedinVisibility',
				type: 'options',
				options: [
					{ name: 'Public', value: 'PUBLIC' },
					// Video specific options (from docs)
					{ name: 'Connections', value: 'CONNECTIONS', displayOptions: { show: { operation: ['uploadVideo']}}},
					{ name: 'Logged In', value: 'LOGGED_IN', displayOptions: { show: { operation: ['uploadVideo']}}},
					{ name: 'Container', value: 'CONTAINER', displayOptions: { show: { operation: ['uploadVideo']}}},
				],
				default: 'PUBLIC',
				description: 'Visibility setting for the LinkedIn post',
				displayOptions: {
					show: {
						operation: ['uploadPhotos', 'uploadVideo', 'uploadText'],
						platform: ['linkedin']
					},
				},
				routing: {
					send: {
						type: 'body',
						property: 'visibility',
					}
				}
			},
			{
				displayName: 'Target LinkedIn Page ID',
				name: 'targetLinkedinPageId',
				type: 'string',
				default: '',
				description: 'LinkedIn page ID to upload to an organization (optional)',
				displayOptions: {
					show: {
						operation: ['uploadPhotos', 'uploadVideo', 'uploadText'],
						platform: ['linkedin']
					},
				},
				routing: {
					send: {
						type: 'body',
						property: 'target_linkedin_page_id',
					}
				}
			},
			{
				displayName: 'LinkedIn Description',
				name: 'linkedinDescription',
				type: 'string',
				default: '',
				description: 'The user generated commentary for the post (LinkedIn Video/Text). If not provided, title is used for video.',
				displayOptions: {
					show: {
						operation: ['uploadVideo', 'uploadText'],
						platform: ['linkedin']
					},
				},
				routing: {
					send: {
						type: 'body',
						property: 'description',
					}
				}
			},

		// ----- Facebook Specific Parameters (Photo & Video & Text) -----
			{
				displayName: 'Facebook Page ID',
				name: 'facebookPageId',
				type: 'string',
				required: true, // Required for Facebook uploads
				default: '',
				description: 'Facebook Page ID where the content will be posted',
				displayOptions: {
					show: {
						operation: ['uploadPhotos', 'uploadVideo', 'uploadText'],
						platform: ['facebook']
					},
				},
				routing: {
					send: {
						type: 'body',
						property: 'facebook_page_id',
					}
				}
			},
			{ // Facebook specific for Video
				displayName: 'Facebook Video Description',
				name: 'facebookVideoDescription',
				type: 'string',
				default: '',
				description: 'Description of the video for Facebook. If not provided, title is used.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['facebook']
					},
				},
				routing: {
					send: {
						type: 'body',
						property: 'description',
					}
				}
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
				description: 'Desired state of the video on Facebook',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['facebook']
					},
				},
				routing: {
					send: {
						type: 'body',
						property: 'video_state',
					}
				}
			},

		// ----- TikTok Specific Parameters (Photo & Video) -----
			{ // TikTok specific for Photo
				displayName: 'TikTok Auto Add Music',
				name: 'tiktokAutoAddMusic',
				type: 'boolean',
				default: false,
				description: 'Whether to automatically add background music to photos on TikTok',
				displayOptions: {
					show: {
						operation: ['uploadPhotos'],
						platform: ['tiktok']
					},
				},
				routing: {
					send: {
						type: 'body',
						property: 'auto_add_music',
					}
				}
			},
			{ // TikTok specific for Photo & Video
				displayName: 'TikTok Disable Comment',
				name: 'tiktokDisableComment',
				type: 'boolean',
				default: false,
				description: 'Whether to disable comments on the TikTok post',
				displayOptions: {
					show: {
						operation: ['uploadPhotos', 'uploadVideo'],
						platform: ['tiktok']
					},
				},
				routing: {
					send: {
						type: 'body',
						property: 'disable_comment',
					}
				}
			},
			{ // TikTok specific for Photo (branded_content & disclose_commercial)
				displayName: 'TikTok Branded Content (Photo)',
				name: 'tiktokBrandedContentPhoto',
				type: 'boolean',
				default: false,
				description: 'Whether to indicate if the photo post is branded content (requires Disclose Commercial to be true)',
				displayOptions: {
					show: {
						operation: ['uploadPhotos'],
						platform: ['tiktok']
					},
				},
				routing: {
					send: {
						type: 'body',
						property: 'branded_content',
					}
				}
			},
			{
				displayName: 'TikTok Disclose Commercial (Photo)',
				name: 'tiktokDiscloseCommercialPhoto',
				type: 'boolean',
				default: false,
				description: 'Whether to disclose the commercial nature of the photo post (used with Branded Content)',
				displayOptions: {
					show: {
						operation: ['uploadPhotos'],
						platform: ['tiktok']
					},
				},
				routing: {
					send: {
						type: 'body',
						property: 'disclose_commercial',
					}
				}
			},
			{
				displayName: 'TikTok Photo Cover Index',
				name: 'tiktokPhotoCoverIndex',
				type: 'number',
				default: 0,
				typeOptions: { minValue: 0 },
				description: 'Index (starting at 0) of the photo to use as the cover/thumbnail for the TikTok photo post',
				displayOptions: {
					show: {
						operation: ['uploadPhotos'],
						platform: ['tiktok']
					},
				},
				routing: {
					send: {
						type: 'body',
						property: 'photo_cover_index',
					}
				}
			},
			{ // TikTok specific for Photo - Description
				displayName: 'TikTok Photo Description',
				name: 'tiktokPhotoDescription',
				type: 'string',
				default: '',
				description: 'Description for the TikTok photo post. If not provided, the common Title value will be used.',
				displayOptions: {
					show: {
						operation: ['uploadPhotos'],
						platform: ['tiktok']
					},
				},
				routing: {
					send: {
						type: 'body',
						property: 'description',
					}
				}
			},
			{ // TikTok specific for Video
				displayName: 'TikTok Privacy Level',
				name: 'tiktokPrivacyLevel',
				type: 'options',
				options: [
					{ name: 'Public to Everyone', value: 'PUBLIC_TO_EVERYONE' },
					{ name: 'Mutual Follow Friends', value: 'MUTUAL_FOLLOW_FRIENDS' },
					{ name: 'Follower of Creator', value: 'FOLLOWER_OF_CREATOR' },
					{ name: 'Self Only', value: 'SELF_ONLY' },
				],
				default: 'PUBLIC_TO_EVERYONE',
				description: 'Privacy setting for the TikTok video',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['tiktok']
					},
				},
				routing: {
					send: {
						type: 'body',
						property: 'privacy_level',
					}
				}
			},
			{
				displayName: 'TikTok Disable Duet',
				name: 'tiktokDisableDuet',
				type: 'boolean',
				default: false,
				description: 'Whether to disable duet feature for the TikTok video',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['tiktok']
					},
				},
				routing: {
					send: {
						type: 'body',
						property: 'disable_duet',
					}
				}
			},
			{
				displayName: 'TikTok Disable Stitch',
				name: 'tiktokDisableStitch',
				type: 'boolean',
				default: false,
				description: 'Whether to disable stitch feature for the TikTok video',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['tiktok']
					},
				},
				routing: {
					send: {
						type: 'body',
						property: 'disable_stitch',
					}
				}
			},
			{
				displayName: 'TikTok Cover Timestamp (Ms)',
				name: 'tiktokCoverTimestamp',
				type: 'number',
				default: 1000,
				description: 'Timestamp in milliseconds for video cover on TikTok',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['tiktok']
					},
				},
				routing: {
					send: {
						type: 'body',
						property: 'cover_timestamp',
					}
				}
			},
			{
				displayName: 'TikTok Brand Content Toggle',
				name: 'tiktokBrandContentToggle',
				type: 'boolean',
				default: false,
				description: 'Whether to enable branded content for TikTok video',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['tiktok']
					},
				},
				routing: {
					send: {
						type: 'body',
						property: 'brand_content_toggle',
					}
				}
			},
			{
				displayName: 'TikTok Brand Organic',
				name: 'tiktokBrandOrganic',
				type: 'boolean',
				default: false,
				description: 'Whether to enable organic branded content for TikTok video',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['tiktok']
					},
				},
				routing: {
					send: {
						type: 'body',
						property: 'brand_organic',
					}
				}
			},
			{
				displayName: 'TikTok Branded Content (Video)',
				name: 'tiktokBrandedContentVideo',
				type: 'boolean',
				default: false,
				description: 'Whether to enable branded content with disclosure for TikTok video',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['tiktok']
					},
				},
				routing: {
					send: {
						type: 'body',
						property: 'branded_content',
					}
				}
			},
			{
				displayName: 'TikTok Brand Organic Toggle',
				name: 'tiktokBrandOrganicToggle',
				type: 'boolean',
				default: false,
				description: 'Whether to enable organic branded content toggle for TikTok video',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['tiktok']
					},
				},
				routing: {
					send: {
						type: 'body',
						property: 'brand_organic_toggle',
					}
				}
			},
			{
				displayName: 'TikTok Is AIGC',
				name: 'tiktokIsAigc',
				type: 'boolean',
				default: false,
				description: 'Whether to indicate if content is AI-generated for TikTok video',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['tiktok']
					},
				},
				routing: {
					send: {
						type: 'body',
						property: 'is_aigc',
					}
				}
			},

		// ----- Instagram Specific Parameters (Photo & Video) -----
			{ // Instagram specific for Photo
				displayName: 'Instagram Photo Media Type',
				name: 'instagramPhotoMediaType',
				type: 'options',
				options: [
					{ name: 'Image (Feed)', value: 'IMAGE' },
					{ name: 'Stories', value: 'STORIES' },
				],
				default: 'IMAGE',
				description: 'Type of media for Instagram photo upload',
				displayOptions: {
					show: {
						operation: ['uploadPhotos'],
						platform: ['instagram']
					},
				},
				routing: {
					send: {
						type: 'body',
						property: 'media_type',
					}
				}
			},
			{ // Instagram specific for Video
				displayName: 'Instagram Video Media Type',
				name: 'instagramVideoMediaType',
				type: 'options',
				options: [
					{ name: 'Reels', value: 'REELS' },
					{ name: 'Stories', value: 'STORIES' },
				],
				default: 'REELS',
				description: 'Type of media for Instagram video upload',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['instagram']
					},
				},
				routing: {
					send: {
						type: 'body',
						property: 'media_type',
					}
				}
			},
			{
				displayName: 'Instagram Share to Feed',
				name: 'instagramShareToFeed',
				type: 'boolean',
				default: true,
				description: 'Whether to share the Instagram video (Reel/Story) to feed',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['instagram']
					},
				},
				routing: {
					send: {
						type: 'body',
						property: 'share_to_feed',
					}
				}
			},
			{
				displayName: 'Instagram Collaborators',
				name: 'instagramCollaborators',
				type: 'string',
				default: '',
				description: 'Comma-separated list of collaborator usernames for Instagram video',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['instagram']
					},
				},
				routing: {
					send: {
						type: 'body',
						property: 'collaborators',
					}
				}
			},
			{
				displayName: 'Instagram Cover URL',
				name: 'instagramCoverUrl',
				type: 'string',
				default: '',
				description: 'URL for custom video cover on Instagram',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['instagram']
					},
				},
				routing: {
					send: {
						type: 'body',
						property: 'cover_url',
					}
				}
			},
			{
				displayName: 'Instagram Audio Name',
				name: 'instagramAudioName',
				type: 'string',
				default: '',
				description: 'Name of the audio track for Instagram video',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['instagram']
					},
				},
				routing: {
					send: {
						type: 'body',
						property: 'audio_name',
					}
				}
			},
			{
				displayName: 'Instagram User Tags',
				name: 'instagramUserTags',
				type: 'string',
				default: '',
				description: 'Comma-separated list of user tags for Instagram video',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['instagram']
					},
				},
				routing: {
					send: {
						type: 'body',
						property: 'user_tags',
					}
				}
			},
			{
				displayName: 'Instagram Location ID',
				name: 'instagramLocationId',
				type: 'string',
				default: '',
				description: 'Instagram location ID for the video',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['instagram']
					},
				},
				routing: {
					send: {
						type: 'body',
						property: 'location_id',
					}
				}
			},
			{
				displayName: 'Instagram Thumb Offset',
				name: 'instagramThumbOffset',
				type: 'string', // API Doc says string, might be number
				default: '',
				description: 'Timestamp offset for video thumbnail on Instagram',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['instagram']
					},
				},
				routing: {
					send: {
						type: 'body',
						property: 'thumb_offset',
					}
				}
			},

		// ----- YouTube Specific Parameters (Video) -----
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
				routing: {
					send: {
						type: 'body',
						property: 'description',
					}
				}
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
				routing: {
					send: {
						type: 'body',
						property: 'tags',
						value: '={{ $value ? $value.split(",").map(tag => tag.trim()) : [] }}',
					}
				}
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
				routing: {
					send: {
						type: 'body',
						property: 'categoryId',
					}
				}
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
				routing: {
					send: {
						type: 'body',
						property: 'privacyStatus',
					}
				}
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
				routing: {
					send: {
						type: 'body',
						property: 'embeddable',
					}
				}
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
				routing: {
					send: {
						type: 'body',
						property: 'license',
					}
				}
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
				routing: {
					send: {
						type: 'body',
						property: 'publicStatsViewable',
					}
				}
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
				routing: {
					send: {
						type: 'body',
						property: 'madeForKids',
					}
				}
			},

		// ----- Threads Specific Parameters (Video & Text) -----
			{
				displayName: 'Threads Description',
				name: 'threadsDescription',
				type: 'string',
				default: '',
				description: 'The user generated commentary for the post on Threads. If not provided, title is used.',
				displayOptions: {
					show: {
						operation: ['uploadVideo', 'uploadText'],
						platform: ['threads']
					},
				},
				routing: {
					send: {
						type: 'body',
						property: 'description',
					}
				}
			},

		// ----- X (Twitter) Specific Parameters (Video & Text) -----
			{
				displayName: 'X Tagged User IDs',
				name: 'xTaggedUserIds',
				type: 'string',
				default: '',
				description: 'Comma-separated list of user IDs to tag for X (Twitter) video/text. These will be sent as an array.',
				displayOptions: {
					show: {
						operation: ['uploadVideo', 'uploadText'],
						platform: ['x']
					},
				},
				routing: {
					send: {
						type: 'body',
						property: 'tagged_user_ids',
						value: '={{ $value ? $value.split(",").map(id => id.trim()) : [] }}',
					}
				}
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
				description: 'Who can reply to the X (Twitter) video/text post',
				displayOptions: {
					show: {
						operation: ['uploadVideo', 'uploadText'],
						platform: ['x']
					},
				},
				routing: {
					send: {
						type: 'body',
						property: 'reply_settings',
					}
				}
			},
			{ // X specific for Video
				displayName: 'X Nullcast (Video)',
				name: 'xNullcastVideo',
				type: 'boolean',
				default: false,
				description: 'Whether to publish X (Twitter) video without broadcasting',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['x']
					},
				},
				routing: {
					send: {
						type: 'body',
						property: 'nullcast',
					}
				}
			},
			{ // X specific for Video
				displayName: 'X Place ID (Video)',
				name: 'xPlaceIdVideo',
				type: 'string',
				default: '',
				description: 'Location place ID for X (Twitter) video',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['x']
					},
				},
				routing: {
					send: {
						type: 'body',
						property: 'place_id',
					}
				}
			},
			{ // X specific for Video - Poll options
				displayName: 'X Poll Duration (Minutes, Video)',
				name: 'xPollDurationVideo',
				type: 'number',
				default: 1440,
				description: 'Poll duration in minutes for X (Twitter) video post. Requires Poll Options.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['x']
					},
				},
				routing: {
					send: {
						type: 'body',
						property: 'poll_duration',
					}
				}
			},
			{
				displayName: 'X Poll Options (Video)',
				name: 'xPollOptionsVideo',
				type: 'string',
				default: '',
				description: 'Comma-separated list of poll options for X (Twitter) video post. These will be sent as an array.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['x']
					},
				},
				routing: {
					send: {
						type: 'body',
						property: 'poll_options',
						value: '={{ $value ? $value.split(",").map(opt => opt.trim()) : [] }}',
					}
				}
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
				description: 'Who can reply to the poll in X (Twitter) video post',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['x']
					},
				},
				routing: {
					send: {
						type: 'body',
						property: 'poll_reply_settings',
					}
				}
			},
			{ // X specific for Text
				displayName: 'X Post URL (Text)',
				name: 'xPostUrlText',
				type: 'string',
				default: '',
				description: 'URL to attach to the X (Twitter) text post',
				displayOptions: {
					show: {
						operation: ['uploadText'],
						platform: ['x']
					},
				},
				routing: {
					send: {
						type: 'body',
						property: 'post_url',
					}
				}
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const length = items.length;
		const baseApiUrl = 'https://api.upload-post.com/api'; // Define base URL directly

		// Node description for operation details
		const nodeDescription = (this as any as INodeType).description;

		for (let i = 0; i < length; i++) {
			try {
				// Get credentials for manual authentication
				const credentials = await this.getCredentials('uploadPostApi', i);
				if (!credentials || !credentials.apiKey) {
					throw new NodeOperationError(this.getNode(), 'API key is missing from UploadPostApi credentials.', { itemIndex: i });
				}
				const apiKey = credentials.apiKey as string;
				const authorizationHeader = `Apikey ${apiKey}`;

				const operation = this.getNodeParameter('operation', i) as string;

				const operationProperty = nodeDescription.properties.find((prop: INodeProperties) => prop.name === 'operation');
				const operationOptions = operationProperty?.options as INodePropertyOptions[] | undefined;
				const operationConfig = operationOptions?.find(opt => opt.value === operation);

				if (!operationConfig || !operationConfig.routing || !(operationConfig.routing as IDataObject).request) {
					throw new NodeOperationError(this.getNode(), `Routing information not found for operation: ${operation}`, { itemIndex: i });
				}

				const requestDetails = (operationConfig.routing as IDataObject).request as IDataObject;
				const relativeUrl = requestDetails.url as string;
				const httpMethod = requestDetails.method as IHttpRequestMethods;

				if (!relativeUrl || !httpMethod) {
					throw new NodeOperationError(this.getNode(), `Incomplete routing details (URL or Method missing) for operation: ${operation}`, { itemIndex: i });
				}

				// Construct the full URL
				let fullUrl;
				if (baseApiUrl.endsWith('/') && relativeUrl.startsWith('/')) {
					fullUrl = baseApiUrl + relativeUrl.substring(1);
				} else if (!baseApiUrl.endsWith('/') && !relativeUrl.startsWith('/')) {
					fullUrl = `${baseApiUrl}/${relativeUrl}`;
				} else {
					fullUrl = baseApiUrl + relativeUrl;
				}

				const requestOptions: IRequestOptions = {
					method: httpMethod,
					uri: fullUrl,
					headers: {
						'Accept': 'application/json',
						'Authorization': authorizationHeader,
					},
					json: true, // Send body as JSON and parse response as JSON
					// Body will be automatically assembled by n8n from parameters
					// that have `routing: { send: { type: 'body', ...}}`
				};

				// Set Content-Type for methods that have a body
				if (httpMethod === 'POST' || httpMethod === 'PUT' || httpMethod === 'PATCH') {
					requestOptions.headers!['Content-Type'] = 'application/json';
				}
				
				this.logger.debug(`[UploadPost Node] Executing direct request: ${httpMethod} ${fullUrl} with API Key auth.`);

				const responseData = await this.helpers.request.call(this, requestOptions);

				returnData.push({ json: responseData, pairedItem: i });
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ json: { error: error.message }, pairedItem: i });
					continue;
				}
				if (error.context) {
					// If it's already a NodeApiError or NodeOperationError with context
					error.context.itemIndex = i;
					throw error;
				}
				// For other errors, wrap them in NodeOperationError
				throw new NodeOperationError(this.getNode(), error, { itemIndex: i });
			}
		}
		return [returnData];
	}
}
