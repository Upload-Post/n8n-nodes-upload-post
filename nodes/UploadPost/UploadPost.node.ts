import { Buffer } from 'buffer';
import {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	IRequestOptions,
	NodeConnectionType,
	NodeOperationError,
	sleep
} from 'n8n-workflow';

const MANUAL_USER_VALUE = '__manual_user__';
const MANUAL_FACEBOOK_VALUE = '__manual_facebook__';
const MANUAL_LINKEDIN_VALUE = '__manual_linkedin__';
const MANUAL_PINTEREST_VALUE = '__manual_pinterest__';

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
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Upload', value: 'uploads' },
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
					{ name: 'List Users', value: 'listUsers', action: 'List users', description: 'List Upload-Post users (profiles)' },
					{ name: 'Validate JWT (for Platform Integration)', value: 'validateJwt', action: 'Validate jwt for platform integration', description: 'Validate a connection token from your backend. Only needed for custom platform integration.' },
				],
				default: 'listUsers',
				displayOptions: { show: { resource: ['users'] } },
			},
			// (Removed separate JWT resource; JWT operations are under Users below)

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
						operation: ['uploadPhotos','uploadVideo','uploadText','generateJwt']
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
						operation: ['uploadPhotos','uploadVideo','uploadText','generateJwt'],
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
				displayOptions: { show: { resource: ['uploads'], operation: ['uploadPhotos','uploadVideo','uploadText'] } },
			},
			{
				displayName: 'Title / Main Content',
				name: 'title',
				type: 'string',
				required: true,
				default: '',
				description: 'Title of the post. For Upload Text, this is the main text content. For some video platforms, this acts as a fallback for description if a specific description is not provided.',
				displayOptions: { show: { resource: ['uploads'], operation: ['uploadPhotos','uploadVideo','uploadText'] } },
			},
				// Platform-specific Title Overrides (appear when the platform is selected)
				{
					displayName: 'Instagram Title (Override)',
					name: 'instagramTitle',
					type: 'string',
					default: '',
					description: 'Optional override for Instagram title',
					displayOptions: { show: { operation: ['uploadPhotos','uploadVideo','uploadText'], platform: ['instagram'] } },
				},
				{
					displayName: 'Facebook Title (Override)',
					name: 'facebookTitle',
					type: 'string',
					default: '',
					description: 'Optional override for Facebook title',
					displayOptions: { show: { operation: ['uploadPhotos','uploadVideo','uploadText'], platform: ['facebook'] } },
				},
				{
					displayName: 'TikTok Title (Override)',
					name: 'tiktokTitle',
					type: 'string',
					default: '',
					description: 'Optional override for TikTok title',
					displayOptions: { show: { operation: ['uploadPhotos','uploadVideo','uploadText'], platform: ['tiktok'] } },
				},
				{
					displayName: 'LinkedIn Title (Override)',
					name: 'linkedinTitle',
					type: 'string',
					default: '',
					description: 'Optional override for LinkedIn title',
					displayOptions: { show: { operation: ['uploadPhotos','uploadVideo','uploadText'], platform: ['linkedin'] } },
				},
				{
					displayName: 'X Title (Override)',
					name: 'xTitle',
					type: 'string',
					default: '',
					description: 'Optional override for X title',
					displayOptions: { show: { operation: ['uploadPhotos','uploadVideo','uploadText'], platform: ['x'] } },
				},
				{
					displayName: 'YouTube Title (Override)',
					name: 'youtubeTitle',
					type: 'string',
					default: '',
					description: 'Optional override for YouTube title',
					displayOptions: { show: { operation: ['uploadPhotos','uploadVideo','uploadText'], platform: ['youtube'] } },
				},
				{
					displayName: 'Pinterest Title (Override)',
					name: 'pinterestTitle',
					type: 'string',
					default: '',
					description: 'Optional override for Pinterest title',
					displayOptions: { show: { operation: ['uploadPhotos','uploadVideo','uploadText'], platform: ['pinterest'] } 				},
			},
			{
				displayName: 'Threads Title (Override)',
				name: 'threadsTitle',
				type: 'string',
				default: '',
				description: 'Optional override for Threads title',
				displayOptions: { show: { operation: ['uploadText'], platform: ['threads'] } },
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
						platform: ['linkedin', 'facebook', 'youtube', 'pinterest', 'tiktok']
					}
				},
			},
			{
				displayName: 'Facebook Description (Override)',
				name: 'facebookDescription',
				type: 'string',
				default: '',
				description: 'Override for Facebook description/message when supported (Reels/feed, albums). Falls back to the main title when empty.',
				displayOptions: { show: { operation: ['uploadPhotos','uploadVideo'], platform: ['facebook'] } },
			},
			{
				displayName: 'TikTok Description (Override)',
				name: 'tiktokDescription',
				type: 'string',
				default: '',
				description: 'Override for TikTok photo post description. Video uploads ignore this value.',
				displayOptions: { show: { operation: ['uploadPhotos'], platform: ['tiktok'] } },
			},
			{
				displayName: 'LinkedIn Description (Override)',
				name: 'linkedinDescription',
				type: 'string',
				default: '',
				description: 'Override for LinkedIn post commentary. When empty we repeat the main title.',
				displayOptions: { show: { operation: ['uploadPhotos','uploadVideo'], platform: ['linkedin'] } },
			},
			{
				displayName: 'YouTube Description (Override)',
				name: 'youtubeDescription',
				type: 'string',
				default: '',
				description: 'Override for YouTube video description. When empty we default to the main title.',
				displayOptions: { show: { operation: ['uploadVideo'], platform: ['youtube'] } },
			},
			{
				displayName: 'Pinterest Description (Override)',
				name: 'pinterestDescription',
				type: 'string',
				default: '',
				description: 'Override for Pinterest pin description (and alt text fallback). When empty we re-use the main title.',
				displayOptions: { show: { operation: ['uploadPhotos','uploadVideo'], platform: ['pinterest'] } },
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
			{
				displayName: 'Scheduled Date',
				name: 'scheduledDate',
				type: 'dateTime',
				default: '',
				description: 'Optional scheduling date/time. If set, the API will schedule the publication instead of posting immediately.',
				displayOptions: { show: { resource: ['uploads'], operation: ['uploadPhotos','uploadVideo','uploadText'] } },
			},
			{
				displayName: 'Upload Asynchronously',
				name: 'uploadAsync',
				type: 'boolean',
				default: true,
				description: 'Whether to process the upload asynchronously and return immediately. If you set to false but the upload takes longer than 59 seconds, it will automatically switch to asynchronous processing to avoid timeouts. In that case, use the request_id with the Upload Status endpoint to check the upload status and result.',
				displayOptions: {
					show: {
						operation: ['uploadPhotos','uploadVideo','uploadText']
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
						operation: ['uploadPhotos','uploadVideo','uploadText']
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
						operation: ['uploadPhotos','uploadVideo','uploadText'],
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
						operation: ['uploadPhotos','uploadVideo','uploadText'],
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
			// Removed platform filter (not supported by API)
			// Removed status filter (not supported by API)
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
			// Removed from/to date filters (not supported by API)

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
				displayName: 'Target LinkedIn Page Name or ID',
				name: 'targetLinkedinPageId',
				type: 'options',
				noDataExpression: true,
				default: '',
				description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				typeOptions: { loadOptionsMethod: 'getLinkedinPages', loadOptionsDependsOn: ['user'] },
				displayOptions: {
					show: {
						operation: ['uploadPhotos', 'uploadVideo', 'uploadText'],
						platform: ['linkedin']
					}
				},
			},
			{
				displayName: 'LinkedIn Page Name or ID (Manual Entry)',
				name: 'targetLinkedinPageIdManual',
				type: 'string',
				required: true,
				default: '',
				description: 'Provide the LinkedIn page identifier when it does not appear in the list',
				displayOptions: {
					show: {
						operation: ['uploadPhotos', 'uploadVideo', 'uploadText'],
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
						platform: ['linkedin']
					},
				},
			},

		// ----- Facebook Specific Parameters ----- 
			{
				displayName: 'Facebook Page Name or ID',
				name: 'facebookPageId',
				type: 'options',
				noDataExpression: true,
				required: true,
				default: '',
				description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				typeOptions: { loadOptionsMethod: 'getFacebookPages', loadOptionsDependsOn: ['user'] },
				displayOptions: {
					show: {
						operation: ['uploadPhotos', 'uploadVideo', 'uploadText'],
						platform: ['facebook']
					}
				},
			},
			{
				displayName: 'Facebook Page Name or ID (Manual Entry)',
				name: 'facebookPageIdManual',
				type: 'string',
				required: true,
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
				],
				default: 'PUBLISHED',
				description: 'State for Facebook Video (DRAFT or PUBLISHED). Use Scheduled Date field for scheduling.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['facebook']
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
				],
				default: 'REELS',
				description: 'Choose whether to post as Reels or Stories for Facebook video',
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
				displayName: 'TikTok Brand Content Toggle (Photo)',
				name: 'brand_content_toggle',
				type: 'boolean',
				default: false,
				description: 'Whether to set as true for paid partnerships that promote third-party brands',
				displayOptions: {
					show: {
						operation: ['uploadPhotos'],
						platform: ['tiktok']
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
				name: 'brand_content_toggle',
				type: 'boolean',
				default: false,
				description: 'Whether to enable brand content toggle for paid partnerships that promote third-party brands',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['tiktok']
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
						platform: ['tiktok']
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
				displayOptions: { show: { operation: ['uploadText'], platform: ['threads'] } },
			},

		// ----- Reddit Specific Parameters -----
			{
				displayName: 'Reddit Subreddit',
				name: 'redditSubreddit',
				type: 'string',
				required: true,
				default: '',
				description: 'Destination subreddit, without r/ (e.g., python)',
				displayOptions: { show: { operation: ['uploadText'], platform: ['reddit'] } },
			},
			{
				displayName: 'Reddit Flair ID',
				name: 'redditFlairId',
				type: 'string',
				default: '',
				description: 'ID of the flair template to apply to the post',
				displayOptions: { show: { operation: ['uploadText'], platform: ['reddit'] } },
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
			{
				displayName: 'YouTube Thumbnail (File or URL)',
				name: 'youtubeThumbnail',
				type: 'string',
				default: '',
				description: 'Custom thumbnail for YouTube video. Provide a binary property name (e.g., data) or a direct HTTP/HTTPS URL. Only for Upload Video.',
				displayOptions: {
					show: {
						operation: ['uploadVideo'],
						platform: ['youtube']
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
						platform: ['youtube']
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
						platform: ['youtube']
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
						platform: ['youtube']
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
						platform: ['youtube']
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
						platform: ['youtube']
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
						platform: ['youtube']
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
						platform: ['youtube']
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
						platform: ['youtube']
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
						platform: ['pinterest']
					},
				},
			},
			{
				displayName: 'Pinterest Board Name or ID (Manual Entry)',
				name: 'pinterestBoardIdManual',
				type: 'string',
				required: true,
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
						platform: ['pinterest']
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
						platform: ['pinterest']
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
						platform: ['pinterest']
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
						platform: ['pinterest']
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
						platform: ['pinterest']
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
						platform: ['x']
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
						platform: ['x']
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
				displayName: 'X Poll Duration (Minutes)',
				name: 'xPollDuration',
				type: 'number',
				default: 1440,
				description: 'Poll duration in minutes for X (Twitter) post (requires Poll Options)',
				displayOptions: {
					show: {
						operation: ['uploadText'],
						platform: ['x']
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
						platform: ['x']
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
						platform: ['x']
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
						platform: ['x']
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
						platform: ['x']
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
						platform: ['x']
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
						platform: ['x']
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
						platform: ['x']
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
						platform: ['x']
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
						platform: ['x']
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
						platform: ['x']
					}
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
						operation: ['uploadVideo', 'uploadText'],
						platform: ['x']
					},
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
					uploadPhotos: ['facebook', 'instagram', 'linkedin', 'pinterest', 'threads', 'tiktok', 'x'],
					uploadVideo: ['facebook', 'instagram', 'linkedin', 'pinterest', 'threads', 'tiktok', 'x', 'youtube'],
					uploadText: ['facebook', 'linkedin', 'reddit', 'threads', 'x'],
				};

				const supportedPlatforms = platformSupport[operation] || [];
				return allPlatforms.filter(platform => supportedPlatforms.includes(platform.value));
			},
			async getFacebookPages(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				try {
					const credentials = await this.getCredentials('uploadPostApi');
					const apiKey = credentials.apiKey as string;
					const profile = (this.getCurrentNodeParameter('user') as string | undefined) || '';
					const qs: IDataObject = {};
					if (profile) qs.profile = profile;
					const options: IRequestOptions = {
						uri: 'https://api.upload-post.com/api/uploadposts/facebook/pages',
						method: 'GET',
						headers: { Authorization: `ApiKey ${apiKey}` },
						qs,
						json: true,
					};
					const resp = await this.helpers.request(options);
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
					const credentials = await this.getCredentials('uploadPostApi');
					const apiKey = credentials.apiKey as string;
					const profile = (this.getCurrentNodeParameter('user') as string | undefined) || '';
					const qs: IDataObject = {};
					if (profile) qs.profile = profile;
					const options: IRequestOptions = {
						uri: 'https://api.upload-post.com/api/uploadposts/linkedin/pages',
						method: 'GET',
						headers: { Authorization: `ApiKey ${apiKey}` },
						qs,
						json: true,
					};
					const resp = await this.helpers.request(options);
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
					const credentials = await this.getCredentials('uploadPostApi');
					const apiKey = credentials.apiKey as string;
					const profile = (this.getCurrentNodeParameter('user') as string | undefined) || '';
					const qs: IDataObject = {};
					if (profile) qs.profile = profile;
					const options: IRequestOptions = {
						uri: 'https://api.upload-post.com/api/uploadposts/pinterest/boards',
						method: 'GET',
						headers: { Authorization: `ApiKey ${apiKey}` },
						qs,
						json: true,
					};
					const resp = await this.helpers.request(options);
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
					const credentials = await this.getCredentials('uploadPostApi');
					const apiKey = credentials.apiKey as string;
					const options: IRequestOptions = {
						uri: 'https://api.upload-post.com/api/uploadposts/users',
						method: 'GET',
						headers: { Authorization: `ApiKey ${apiKey}` },
						json: true,
					};
					const resp = await this.helpers.request(options);
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

		for (let i = 0; i < items.length; i++) {
			const operation = this.getNodeParameter('operation', i) as string;
			const isUploadOperation = ['uploadPhotos', 'uploadVideo', 'uploadText'].includes(operation);
			const needsUser = isUploadOperation || operation === 'generateJwt';
			const userSelection = needsUser ? (this.getNodeParameter('user', i) as string) : '';
			const userManualValue = needsUser && userSelection === MANUAL_USER_VALUE
				? (this.getNodeParameter('userManual', i) as string)
				: '';
			const user = needsUser
				? (userSelection === MANUAL_USER_VALUE ? userManualValue : userSelection)
				: '';
			let platforms = isUploadOperation ? (this.getNodeParameter('platform', i) as string[]) : [];
			const title = isUploadOperation ? (this.getNodeParameter('title', i) as string) : '';

			let endpoint = '';
			let method: 'GET' | 'POST' | 'DELETE' = 'POST';
			const formData: IDataObject = {};
			const qs: IDataObject = {};
			const body: IDataObject = {};

			if (isUploadOperation) {
				formData.user = user;
				formData.title = title;

				// Optional scheduling
				const scheduledDate = this.getNodeParameter('scheduledDate', i) as string | undefined;
				if (scheduledDate) {
					let normalizedDate = scheduledDate;
					// If the date string has no timezone info (no trailing Z and no +/- offset), append Z (UTC)
					const hasTimezone = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(normalizedDate);
					if (!hasTimezone) {
						normalizedDate = `${normalizedDate}Z`;
					}
					formData.scheduled_date = normalizedDate;
				}

				// Async processing toggle
				const uploadAsync = this.getNodeParameter('uploadAsync', i) as boolean | undefined;
				if (uploadAsync !== undefined) {
					formData.async_upload = String(uploadAsync);
				}
			}

			// Apply platform-specific title overrides when provided
			if (isUploadOperation) {
				try {
					if (platforms.includes('instagram')) {
						const instagramTitle = this.getNodeParameter('instagramTitle', i, '') as string;
						if (instagramTitle) (formData as any).instagram_title = instagramTitle;
					}
				} catch {}
				try {
					if (platforms.includes('facebook')) {
						const facebookTitle = this.getNodeParameter('facebookTitle', i, '') as string;
						if (facebookTitle) (formData as any).facebook_title = facebookTitle;
					}
				} catch {}
				try {
					if (platforms.includes('tiktok')) {
						const tiktokTitle = this.getNodeParameter('tiktokTitle', i, '') as string;
						if (tiktokTitle) (formData as any).tiktok_title = tiktokTitle;
					}
				} catch {}
				try {
					if (platforms.includes('linkedin')) {
						const linkedinTitle = this.getNodeParameter('linkedinTitle', i, '') as string;
						if (linkedinTitle) (formData as any).linkedin_title = linkedinTitle;
					}
				} catch {}
				try {
					if (platforms.includes('x')) {
						const xTitle = this.getNodeParameter('xTitle', i, '') as string;
						if (xTitle) (formData as any).x_title = xTitle;
					}
				} catch {}
				try {
					if (platforms.includes('youtube')) {
						const youtubeTitle = this.getNodeParameter('youtubeTitle', i, '') as string;
						if (youtubeTitle) (formData as any).youtube_title = youtubeTitle;
					}
				} catch {}
				try {
					if (platforms.includes('pinterest')) {
						const pinterestTitle = this.getNodeParameter('pinterestTitle', i, '') as string;
						if (pinterestTitle) (formData as any).pinterest_title = pinterestTitle;
					}
				} catch {}
			}

		// Apply generic description and platform-specific description overrides
			if (isUploadOperation) {
				const genericDescription = this.getNodeParameter('description', i, '') as string;
				const descriptionPlatforms = new Set(['linkedin', 'facebook', 'youtube', 'pinterest', 'tiktok']);
				if (genericDescription && platforms.some(p => descriptionPlatforms.has(p))) {
					(formData as any).description = genericDescription;
				}
				try {
					if (platforms.includes('linkedin')) {
						const linkedinDescription = this.getNodeParameter('linkedinDescription', i, '') as string;
						if (linkedinDescription) (formData as any).linkedin_description = linkedinDescription;
					}
				} catch {}
				try {
					if (platforms.includes('youtube')) {
						const youtubeDescription = this.getNodeParameter('youtubeDescription', i, '') as string;
						if (youtubeDescription) (formData as any).youtube_description = youtubeDescription;
					}
				} catch {}
				try {
					if (platforms.includes('facebook')) {
						const facebookDescription = this.getNodeParameter('facebookDescription', i, '') as string;
						if (facebookDescription) (formData as any).facebook_description = facebookDescription;
					}
				} catch {}
				try {
					if (platforms.includes('tiktok')) {
						const tiktokDescription = this.getNodeParameter('tiktokDescription', i, '') as string;
						if (tiktokDescription) (formData as any).tiktok_description = tiktokDescription;
					}
				} catch {}
				try {
					if (platforms.includes('pinterest')) {
						const pinterestDescription = this.getNodeParameter('pinterestDescription', i, '') as string;
						if (pinterestDescription) (formData as any).pinterest_description = pinterestDescription;
					}
				} catch {}
			}

			switch (operation) {
				case 'uploadPhotos':
					endpoint = '/upload_photos';
					// caption removed in favor of description

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

					const allowedPhotoPlatforms = ['tiktok', 'instagram', 'linkedin', 'facebook', 'x', 'threads', 'pinterest'];
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
					// description handled above; no caption
					break;
				case 'uploadVideo':
					endpoint = '/upload';
					const videoInput = this.getNodeParameter('video', i) as string;
					// caption removed in favor of description
					
					const allowedVideoPlatforms = ['tiktok', 'instagram', 'linkedin', 'youtube', 'facebook', 'x', 'threads', 'pinterest'];
					platforms = platforms.filter(p => allowedVideoPlatforms.includes(p));
					formData['platform[]'] = platforms;

					// description handled above; no caption

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
					const allowedTextPlatforms = ['x', 'linkedin', 'facebook', 'threads', 'reddit'];
					platforms = platforms.filter(p => allowedTextPlatforms.includes(p));
					formData['platform[]'] = platforms;
					break;
				case 'getStatus':
					method = 'GET';
					endpoint = '/uploadposts/status';
					qs.request_id = this.getNodeParameter('requestId', i) as string;
					break;
				case 'getHistory':
					method = 'GET';
					endpoint = '/uploadposts/history';
					const historyPage = this.getNodeParameter('historyPage', i) as number | undefined;
					qs.page = historyPage ?? 1;
					const historyLimit = this.getNodeParameter('historyLimit', i) as number | undefined;
					qs.limit = historyLimit ?? 20;
					break;
				case 'getAnalytics':
					method = 'GET';
					{
						const analyticsPlatforms = this.getNodeParameter('analyticsPlatforms', i, []) as string[];
						const profileUsername = this.getNodeParameter('analyticsProfileUsername', i) as string;
						endpoint = `/analytics/${encodeURIComponent(profileUsername)}`;
						if (Array.isArray(analyticsPlatforms) && analyticsPlatforms.length > 0) {
							(qs as any).platforms = analyticsPlatforms.join(',');
						}
					}
					break;
				case 'listScheduled':
					method = 'GET';
					endpoint = '/uploadposts/schedule';
					break;
				case 'cancelScheduled':
					method = 'DELETE';
					{
						const jobId = this.getNodeParameter('scheduleJobId', i) as string;
						endpoint = `/uploadposts/schedule/${jobId}`;
					}
					break;
				case 'editScheduled':
					method = 'POST';
					{
						const jobId = this.getNodeParameter('scheduleJobId', i) as string;
						endpoint = `/uploadposts/schedule/${jobId}`;
						const newScheduledDate = this.getNodeParameter('newScheduledDate', i, '') as string;
						if (newScheduledDate) {
							let normalizedDate = newScheduledDate;
							const hasTimezone = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(normalizedDate);
							if (!hasTimezone) normalizedDate = `${normalizedDate}Z`;
							(body as any).scheduled_date = normalizedDate;
						}
					}
					break;

				case 'listUsers':
					method = 'GET';
					endpoint = '/uploadposts/users';
					break;
				case 'createUser':
					method = 'POST';
					endpoint = '/uploadposts/users';
					body.username = this.getNodeParameter('newUser', i) as string;
					break;
				case 'deleteUser':
					method = 'DELETE';
					endpoint = '/uploadposts/users';
					body.username = this.getNodeParameter('deleteUserId', i) as string;
					break;
				case 'generateJwt':
					method = 'POST';
					endpoint = '/uploadposts/users/generate-jwt';
					body.username = user;
					const redirectUrl = this.getNodeParameter('redirectUrl', i, '') as string;
					const logoImage = this.getNodeParameter('logoImage', i, '') as string;
					const redirectButtonText = this.getNodeParameter('redirectButtonText', i, '') as string;
					const jwtPlatforms = this.getNodeParameter('jwtPlatforms', i, []) as string[];
					if (redirectUrl) body.redirect_url = redirectUrl;
					if (logoImage) body.logo_image = logoImage;
					if (redirectButtonText) body.redirect_button_text = redirectButtonText;
					if (Array.isArray(jwtPlatforms) && jwtPlatforms.length > 0) body.platforms = jwtPlatforms;
					break;
				case 'validateJwt':
					method = 'POST';
					endpoint = '/uploadposts/users/validate-jwt';
					body.jwt = this.getNodeParameter('jwtToken', i) as string;
					break;
			}
			// Pinterest specific (only when uploading)
			if (isUploadOperation && platforms.includes('pinterest')) {
				const pinterestSelection = this.getNodeParameter('pinterestBoardId', i) as string | undefined;
				const pinterestManual = pinterestSelection === MANUAL_PINTEREST_VALUE
					? (this.getNodeParameter('pinterestBoardIdManual', i) as string)
					: '';
				const pinterestBoardId = pinterestSelection === MANUAL_PINTEREST_VALUE ? pinterestManual : pinterestSelection;
				if (pinterestBoardId) formData.pinterest_board_id = pinterestBoardId;
					const pinterestLink = this.getNodeParameter('pinterestLink', i) as string | undefined;
					if (pinterestLink) formData.pinterest_link = pinterestLink;
					if (operation === 'uploadVideo') {
						const pinterestCoverImageUrl = this.getNodeParameter('pinterestCoverImageUrl', i) as string | undefined;
						const pinterestCoverImageContentType = this.getNodeParameter('pinterestCoverImageContentType', i) as string | undefined;
						const pinterestCoverImageData = this.getNodeParameter('pinterestCoverImageData', i) as string | undefined;
						const pinterestCoverImageKeyFrameTime = this.getNodeParameter('pinterestCoverImageKeyFrameTime', i) as number | undefined;
						const pinterestLink = this.getNodeParameter('pinterestLink', i) as string | undefined;

						if (pinterestCoverImageUrl) {
							formData.pinterest_cover_image_url = pinterestCoverImageUrl;
						} else {
							if (pinterestCoverImageContentType && pinterestCoverImageData) {
								formData.pinterest_cover_image_content_type = pinterestCoverImageContentType;
								formData.pinterest_cover_image_data = pinterestCoverImageData;
							} else if (pinterestCoverImageKeyFrameTime !== undefined) {
								formData.pinterest_cover_image_key_frame_time = pinterestCoverImageKeyFrameTime;
							}
						}
						if (pinterestLink) formData.pinterest_link = pinterestLink;
					}
			}

			// Add platform specifics only for uploads
			if (isUploadOperation && platforms.includes('linkedin')) {
				const targetLinkedinSelection = this.getNodeParameter('targetLinkedinPageId', i) as string | undefined;
				const targetLinkedinManual = targetLinkedinSelection === MANUAL_LINKEDIN_VALUE
					? (this.getNodeParameter('targetLinkedinPageIdManual', i) as string)
					: '';
				const targetLinkedinPageId = targetLinkedinSelection === MANUAL_LINKEDIN_VALUE ? targetLinkedinManual : targetLinkedinSelection;
				if (targetLinkedinPageId && targetLinkedinPageId !== 'me') {
					// Extract only the numeric ID from a URN like "urn:li:organization:108870530"
					const match = targetLinkedinPageId.match(/(\d+)$/);
					if (match) {
						formData.target_linkedin_page_id = match[1];
					} else {
						formData.target_linkedin_page_id = targetLinkedinPageId; // fallback, in case it's already just the ID
					}
				}
				if (operation === 'uploadPhotos') {
					const linkedinVisibility = this.getNodeParameter('linkedinVisibility', i) as string;
					if (linkedinVisibility === 'PUBLIC') {
						formData.visibility = 'PUBLIC';
					}
				} else if (operation === 'uploadVideo') {
					const linkedinVisibility = this.getNodeParameter('linkedinVisibility', i) as string;
					formData.visibility = linkedinVisibility;
					// description handled by generic/override block above
				}
			}

			if (isUploadOperation && platforms.includes('facebook')) {
				const facebookPageSelection = this.getNodeParameter('facebookPageId', i) as string;
				const facebookPageManual = facebookPageSelection === MANUAL_FACEBOOK_VALUE
					? (this.getNodeParameter('facebookPageIdManual', i) as string)
					: '';
				const facebookPageId = facebookPageSelection === MANUAL_FACEBOOK_VALUE ? facebookPageManual : facebookPageSelection;
				formData.facebook_page_id = facebookPageId;
				if (operation === 'uploadVideo') {
					const facebookVideoState = this.getNodeParameter('facebookVideoState', i) as string | undefined;
					if (facebookVideoState) formData.video_state = facebookVideoState;
						// Facebook media type (REELS or STORIES)
						try {
							const facebookMediaType = this.getNodeParameter('facebookMediaType', i) as string | undefined;
							if (facebookMediaType) formData.facebook_media_type = facebookMediaType;
						} catch {}
				} else if (operation === 'uploadText') {
					const facebookLink = this.getNodeParameter('facebookLink', i) as string | undefined;
					if (facebookLink) formData.facebook_link_url = facebookLink;
				}
			}

			if (isUploadOperation && platforms.includes('tiktok')) {
				if (operation === 'uploadPhotos') {
					const tiktokAutoAddMusic = this.getNodeParameter('tiktokAutoAddMusic', i) as boolean | undefined;
					const tiktokDisableComment = this.getNodeParameter('tiktokDisableComment', i) as boolean | undefined;
					const brandContentToggle = this.getNodeParameter('brand_content_toggle', i) as boolean | undefined;
					const brandOrganicToggle = this.getNodeParameter('brand_organic_toggle', i) as boolean | undefined;
					const tiktokPhotoCoverIndex = this.getNodeParameter('tiktokPhotoCoverIndex', i) as number | undefined;
					const tiktokPhotoDescription = this.getNodeParameter('tiktokPhotoDescription', i) as string | undefined;

					if (tiktokAutoAddMusic !== undefined) formData.auto_add_music = String(tiktokAutoAddMusic);
					if (tiktokDisableComment !== undefined) formData.disable_comment = String(tiktokDisableComment);
					if (brandContentToggle !== undefined) formData.brand_content_toggle = String(brandContentToggle);
					if (brandOrganicToggle !== undefined) formData.brand_organic_toggle = String(brandOrganicToggle);
					if (tiktokPhotoCoverIndex !== undefined) formData.photo_cover_index = tiktokPhotoCoverIndex;
						if (tiktokPhotoDescription && (formData as any).description === undefined) (formData as any).description = tiktokPhotoDescription;
					
				} else if (operation === 'uploadVideo') {
					const tiktokPrivacyLevel = this.getNodeParameter('tiktokPrivacyLevel', i) as string | undefined;
					const tiktokDisableDuet = this.getNodeParameter('tiktokDisableDuet', i) as boolean | undefined;
					const tiktokDisableComment = this.getNodeParameter('tiktokDisableComment', i) as boolean | undefined;
					const tiktokDisableStitch = this.getNodeParameter('tiktokDisableStitch', i) as boolean | undefined;
					const tiktokCoverTimestamp = this.getNodeParameter('tiktokCoverTimestamp', i) as number | undefined;
					const brandContentToggle = this.getNodeParameter('brand_content_toggle', i) as boolean | undefined;
					const brandOrganicToggle = this.getNodeParameter('brand_organic_toggle', i) as boolean | undefined;
					const tiktokIsAigc = this.getNodeParameter('tiktokIsAigc', i) as boolean | undefined;
					const tiktokPostMode = this.getNodeParameter('tiktokPostMode', i) as string | undefined;

					if (tiktokPrivacyLevel) formData.privacy_level = tiktokPrivacyLevel;
					if (tiktokDisableDuet !== undefined) formData.disable_duet = String(tiktokDisableDuet);
					if (tiktokDisableComment !== undefined) formData.disable_comment = String(tiktokDisableComment);
					if (tiktokDisableStitch !== undefined) formData.disable_stitch = String(tiktokDisableStitch);
					if (tiktokCoverTimestamp !== undefined) formData.cover_timestamp = tiktokCoverTimestamp;
					if (brandContentToggle !== undefined) formData.brand_content_toggle = String(brandContentToggle);
					if (brandOrganicToggle !== undefined) formData.brand_organic_toggle = String(brandOrganicToggle);
					if (tiktokIsAigc !== undefined) formData.is_aigc = String(tiktokIsAigc);
					if (tiktokPostMode) formData.post_mode = tiktokPostMode;
				}
			}

			if (isUploadOperation && platforms.includes('instagram')) {
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

			if (isUploadOperation && platforms.includes('youtube') && operation === 'uploadVideo') {
				const youtubeTagsRaw = this.getNodeParameter('youtubeTags', i) as string | undefined;
				const youtubeCategoryId = this.getNodeParameter('youtubeCategoryId', i) as string | undefined;
				const youtubePrivacyStatus = this.getNodeParameter('youtubePrivacyStatus', i) as string | undefined;
				const youtubeEmbeddable = this.getNodeParameter('youtubeEmbeddable', i) as boolean | undefined;
				const youtubeLicense = this.getNodeParameter('youtubeLicense', i) as string | undefined;
				const youtubePublicStatsViewable = this.getNodeParameter('youtubePublicStatsViewable', i) as boolean | undefined;
				const youtubeMadeForKids = this.getNodeParameter('youtubeMadeForKids', i) as boolean | undefined;
				const youtubeThumbnail = this.getNodeParameter('youtubeThumbnail', i) as string | undefined;

				if (youtubeTagsRaw) formData['tags[]'] = youtubeTagsRaw.split(',').map(tag => tag.trim());
				if (youtubeCategoryId) formData.categoryId = youtubeCategoryId;
				if (youtubePrivacyStatus) formData.privacyStatus = youtubePrivacyStatus;
				if (youtubeEmbeddable !== undefined) formData.embeddable = String(youtubeEmbeddable);
				if (youtubeLicense) formData.license = youtubeLicense;
				if (youtubePublicStatsViewable !== undefined) formData.publicStatsViewable = String(youtubePublicStatsViewable);
				if (youtubeMadeForKids !== undefined) formData.madeForKids = String(youtubeMadeForKids);

				if (youtubeThumbnail) {
					if (youtubeThumbnail.toLowerCase().startsWith('http://') || youtubeThumbnail.toLowerCase().startsWith('https://')) {
						formData.thumbnail_url = youtubeThumbnail;
					} else {
						const binaryPropertyName = youtubeThumbnail;
						try {
							const binaryBuffer = await this.helpers.getBinaryDataBuffer(i, binaryPropertyName);
							const binaryFileDetails = items[i].binary![binaryPropertyName];
							formData.thumbnail = {
								value: binaryBuffer,
								options: {
									filename: binaryFileDetails.fileName ?? binaryPropertyName,
									contentType: binaryFileDetails.mimeType,
								},
							};
						} catch (error) {
							this.logger.warn(`[UploadPost Node] Could not find binary data for YouTube thumbnail property '${binaryPropertyName}' in item ${i}. Error: ${error.message}`);
						}
					}
				}

				const youtubeSelfDeclaredMadeForKids = this.getNodeParameter('youtubeSelfDeclaredMadeForKids', i) as boolean | undefined;
				const youtubeContainsSyntheticMedia = this.getNodeParameter('youtubeContainsSyntheticMedia', i) as boolean | undefined;
				const youtubeDefaultLanguage = this.getNodeParameter('youtubeDefaultLanguage', i) as string | undefined;
				const youtubeDefaultAudioLanguage = this.getNodeParameter('youtubeDefaultAudioLanguage', i) as string | undefined;
				const youtubeAllowedCountries = this.getNodeParameter('youtubeAllowedCountries', i) as string | undefined;
				const youtubeBlockedCountries = this.getNodeParameter('youtubeBlockedCountries', i) as string | undefined;
				const youtubeHasPaidProductPlacement = this.getNodeParameter('youtubeHasPaidProductPlacement', i) as boolean | undefined;
				const youtubeRecordingDate = this.getNodeParameter('youtubeRecordingDate', i) as string | undefined;

				if (youtubeSelfDeclaredMadeForKids !== undefined) formData.selfDeclaredMadeForKids = String(youtubeSelfDeclaredMadeForKids);
				if (youtubeContainsSyntheticMedia !== undefined) formData.containsSyntheticMedia = String(youtubeContainsSyntheticMedia);
				if (youtubeDefaultLanguage) formData.defaultLanguage = youtubeDefaultLanguage;
				if (youtubeDefaultAudioLanguage) formData.defaultAudioLanguage = youtubeDefaultAudioLanguage;
				if (youtubeAllowedCountries) formData.allowedCountries = youtubeAllowedCountries;
				if (youtubeBlockedCountries) formData.blockedCountries = youtubeBlockedCountries;
				if (youtubeHasPaidProductPlacement !== undefined) formData.hasPaidProductPlacement = String(youtubeHasPaidProductPlacement);
				if (youtubeRecordingDate) formData.recordingDate = youtubeRecordingDate;
			}

				// Threads description handled via override block

			if (isUploadOperation && platforms.includes('x')) {
				// Common X parameters for all operations
				const xQuoteTweetId = this.getNodeParameter('xQuoteTweetId', i, '') as string;
				const xGeoPlaceId = this.getNodeParameter('xGeoPlaceId', i, '') as string;
				const xForSuperFollowersOnly = this.getNodeParameter('xForSuperFollowersOnly', i, false) as boolean;
				const xCommunityId = this.getNodeParameter('xCommunityId', i, '') as string;
				const xShareWithFollowers = this.getNodeParameter('xShareWithFollowers', i, false) as boolean;
				const xDirectMessageDeepLink = this.getNodeParameter('xDirectMessageDeepLink', i, '') as string;
				const xCardUri = this.getNodeParameter('xCardUri', i, '') as string;

				if (xQuoteTweetId) formData.quote_tweet_id = xQuoteTweetId;
				if (xGeoPlaceId) formData.geo_place_id = xGeoPlaceId;
				if (xForSuperFollowersOnly) formData.for_super_followers_only = String(xForSuperFollowersOnly);
				if (xCommunityId) formData.community_id = xCommunityId;
				if (xShareWithFollowers) formData.share_with_followers = String(xShareWithFollowers);
				if (xDirectMessageDeepLink) formData.direct_message_deep_link = xDirectMessageDeepLink;
				if (xCardUri) formData.card_uri = xCardUri;

				if (operation === 'uploadText') {
					const xPostUrlText = this.getNodeParameter('xPostUrlText', i) as string | undefined;
					if (xPostUrlText) formData.post_url = xPostUrlText;

					const xReplySettingsText = this.getNodeParameter('xReplySettings', i) as string | undefined;
					if (xReplySettingsText && xReplySettingsText !== 'everyone') formData.reply_settings = xReplySettingsText;

					// Poll parameters (only for text)
					const xPollDuration = this.getNodeParameter('xPollDuration', i, 1440) as number;
					const xPollOptionsRaw = this.getNodeParameter('xPollOptions', i, '') as string;
					const xPollReplySettings = this.getNodeParameter('xPollReplySettings', i, 'following') as string;

					// Check for mutually exclusive fields
					const xCardUri = this.getNodeParameter('xCardUri', i, '') as string;
					const xQuoteTweetId = this.getNodeParameter('xQuoteTweetId', i, '') as string;
					const xDirectMessageDeepLink = this.getNodeParameter('xDirectMessageDeepLink', i, '') as string;

					const hasPollOptions = xPollOptionsRaw && xPollOptionsRaw.trim();
					const hasCardUri = xCardUri && xCardUri.trim();
					const hasQuoteTweetId = xQuoteTweetId && xQuoteTweetId.trim();
					const hasDirectMessageDeepLink = xDirectMessageDeepLink && xDirectMessageDeepLink.trim();

					// Validate mutually exclusive fields
					if (hasPollOptions && (hasCardUri || hasQuoteTweetId || hasDirectMessageDeepLink)) {
						const conflictingFields = [];
						if (hasCardUri) conflictingFields.push('X Card URI');
						if (hasQuoteTweetId) conflictingFields.push('X Quote Tweet ID');
						if (hasDirectMessageDeepLink) conflictingFields.push('X Direct Message Deep Link');
						throw new NodeOperationError(this.getNode(), `X Poll Options cannot be used with: ${conflictingFields.join(', ')}. These fields are mutually exclusive.`);
					}

					// Process poll options if provided
					if (hasPollOptions) {
						const pollOptions = xPollOptionsRaw.split(',').map(opt => opt.trim()).filter(opt => opt.length > 0);

						// Validate poll options according to Upload-Post API requirements
						if (pollOptions.length < 2 || pollOptions.length > 4) {
							throw new NodeOperationError(this.getNode(), `X Poll Options must contain between 2 and 4 non-empty options. Found: ${pollOptions.length}`);
						}

						// Validate each option is max 25 characters
						const invalidOptions = pollOptions.filter(opt => opt.length > 25);
						if (invalidOptions.length > 0) {
							throw new NodeOperationError(this.getNode(), `X Poll Options cannot exceed 25 characters each. Invalid options: ${invalidOptions.join(', ')}`);
						}

						// Validate poll duration (5 minutes to 7 days = 10080 minutes)
						if (xPollDuration < 5 || xPollDuration > 10080) {
							throw new NodeOperationError(this.getNode(), `X Poll Duration must be between 5 and 10080 minutes (5 minutes to 7 days). Provided: ${xPollDuration}`);
						}

						// Set poll parameters according to Upload-Post API
						formData['poll_options[]'] = pollOptions;
						formData.poll_duration = xPollDuration;
						formData.poll_reply_settings = xPollReplySettings;
					}

					try {
						const xLongTextAsPostText = this.getNodeParameter('xLongTextAsPost', i, false) as boolean;
						if (xLongTextAsPostText) formData.x_long_text_as_post = String(xLongTextAsPostText);
					} catch {}

					delete formData.nullcast;
					delete formData.place_id;
				} else if (operation === 'uploadVideo' || operation === 'uploadPhotos') {
					const xTaggedUserIds = this.getNodeParameter('xTaggedUserIds', i) as string | undefined;
					const xReplySettings = this.getNodeParameter('xReplySettings', i) as string | undefined;
					const xNullcastVideo = this.getNodeParameter('xNullcastVideo', i) as boolean | undefined;

					if (xTaggedUserIds) formData['tagged_user_ids[]'] = xTaggedUserIds.split(',').map(id => id.trim());
					if (xReplySettings && xReplySettings !== 'everyone') formData.reply_settings = xReplySettings;
					if (xNullcastVideo !== undefined) formData.nullcast = String(xNullcastVideo);

					if (operation === 'uploadVideo') {
						try {
							const xLongTextAsPost = this.getNodeParameter('xLongTextAsPost', i, false) as boolean;
							if (xLongTextAsPost) formData.x_long_text_as_post = String(xLongTextAsPost);
						} catch {}
					}
				}
			}

			if (isUploadOperation && platforms.includes('threads')) {
				if (operation === 'uploadText') {
					const threadsTitle = this.getNodeParameter('threadsTitle', i, '') as string;
					if (threadsTitle) formData.threads_title = threadsTitle;

					const threadsLongTextAsPost = this.getNodeParameter('threadsLongTextAsPost', i, false) as boolean;
					if (threadsLongTextAsPost) formData.threads_long_text_as_post = String(threadsLongTextAsPost);
				}
			}

			if (isUploadOperation && platforms.includes('reddit')) {
				if (operation === 'uploadText') {
					const redditSubreddit = this.getNodeParameter('redditSubreddit', i) as string;
					formData.subreddit = redditSubreddit;

					const redditFlairId = this.getNodeParameter('redditFlairId', i, '') as string;
					if (redditFlairId) formData.flair_id = redditFlairId;
				}
			}

			const credentials = await this.getCredentials('uploadPostApi');
			const apiKey = credentials.apiKey as string;

			const options: IRequestOptions = {
				uri: `https://api.upload-post.com/api${endpoint}`,
				method,
				headers: {},
				json: true,
			};

			// Set auth header according to endpoint
			if (operation === 'validateJwt') {
				const jwt = this.getNodeParameter('jwtToken', i) as string;
				(options.headers as any)['Authorization'] = `Bearer ${jwt}`;
			} else {
				(options.headers as any)['Authorization'] = `ApiKey ${apiKey}`;
			}

			// Decide payload container
			if (method === 'POST') {
				// Upload endpoints use multipart form-data, others JSON body
				if (operation === 'uploadPhotos' || operation === 'uploadVideo' || operation === 'uploadText') {
					(options as any).formData = formData;
				} else {
					(options as any).body = body;
				}
			} else if (method === 'GET' || method === 'DELETE') {
				// Some DELETE endpoints accept JSON in body (delete user), but stick to body for deleteUser
				if (operation === 'deleteUser') {
					(options as any).body = body;
				} else {
					(options as any).qs = qs;
				}
			}

			// Log form data for debugging
			this.logger.info(`Operation: ${operation}, Is Upload Operation: ${isUploadOperation}`);
			//this.logger.info('Complete Form Data being sent (JSON): ' + JSON.stringify(formData, null, 2));

			const responseData = await this.helpers.request(options);

			// Handle optional polling after upload
			const shouldConsiderPolling = operation === 'uploadPhotos' || operation === 'uploadVideo' || operation === 'uploadText';
			const waitForCompletion = shouldConsiderPolling ? (this.getNodeParameter('waitForCompletion', i, false) as boolean) : false;
			let finalData: any = responseData;
			if (shouldConsiderPolling && waitForCompletion) {
				const maybeRequestId = (responseData && (responseData as any).request_id) ? (responseData as any).request_id as string : undefined;
				if (maybeRequestId) {
					const requestId = maybeRequestId;
					const pollIntervalSec = this.getNodeParameter('pollInterval', i, 10) as number;
					const pollTimeoutSec = this.getNodeParameter('pollTimeout', i, 600) as number;
					const start = Date.now();
					while (true) {
						await sleep(Math.max(1, pollIntervalSec) * 1000);
						if (Date.now() - start > Math.max(5, pollTimeoutSec) * 1000) {
							finalData = { success: false, message: 'Polling timed out', request_id: requestId };
							break;
						}
						const statusOptions: IRequestOptions = {
							uri: `https://api.upload-post.com/api/uploadposts/status`,
							method: 'GET',
							headers: { 'Authorization': `ApiKey ${apiKey}` },
							qs: { request_id: requestId },
							json: true,
						};
						const statusData = await this.helpers.request(statusOptions);
						finalData = statusData;
						const statusValue = (statusData && (statusData as any).status) as string | undefined;
						if ((statusData as any).success === true || (statusValue && ['success','completed','failed','error'].includes(statusValue.toLowerCase()))) {
							break;
						}
					}
				}
			}

			returnData.push({
				json: finalData,
				pairedItem: {
					item: i,
				},
			});
		}

		return [returnData];
	}
}

