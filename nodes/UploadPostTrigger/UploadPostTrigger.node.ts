import {
	IDataObject,
	IHookFunctions,
	ILoadOptionsFunctions,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
	NodeConnectionType,
} from 'n8n-workflow';

import {
	apiRequest,
	fetchWebhookSecret,
	headerValue,
	listSubscriptions,
	matchesSubscription,
	MAX_NAME_LENGTH,
	normalizeEvents,
	normalizeProfile,
	SECRET_REFRESH_INTERVAL_MS,
	signatureMatches,
	SUBSCRIPTIONS_PATH,
	throwApiError,
	timestampIsFresh,
} from './GenericFunctions';

// Static data kept per node (n8n stores it with the workflow):
//   subscriptionId          id of the Upload-Post subscription this node created
//   webhookSecret           account webhook secret, used to check signatures
//   webhookSecretFetchedAt  when the secret was last read (ms), to throttle refreshes
type TriggerStaticData = IDataObject & {
	subscriptionId?: string;
	webhookSecret?: string;
	webhookSecretFetchedAt?: number;
};

const reject = (ctx: IWebhookFunctions, status: number, message: string): IWebhookResponseData => {
	ctx.getResponseObject().status(status).json({ success: false, message }).end();
	return { noWebhookResponse: true };
};

export class UploadPostTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Upload Post Trigger',
		name: 'uploadPostTrigger',
		icon: { light: 'file:uploadpost.svg', dark: 'file:uploadpost.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["events"].join(", ")}}',
		description: 'Starts the workflow when Upload-Post sends a webhook event',
		defaults: {
			name: 'Upload Post Trigger',
		},
		inputs: [],
		outputs: [NodeConnectionType.Main],
		credentials: [
			{
				name: 'uploadPostApi',
				required: true,
			},
		],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName:
					'Upload-Post can only reach a public HTTPS address. A local n8n (localhost, a private IP or plain http) cannot be activated: set WEBHOOK_URL to the public https address of this n8n.',
				name: 'publicUrlNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				required: true,
				default: [],
				description: 'The Upload-Post events that start this workflow',
				options: [
					{
						name: 'Call Received',
						value: 'call_received',
						description:
							'Someone called one of your Upload-Post phone numbers (the call field has the caller, duration and status). Opt-in. Needs phone numbers available on the account (not generally available yet).',
					},
					{
						name: 'Comment Received',
						value: 'comment_received',
						description:
							'Someone commented on a post of a connected Instagram, TikTok or LinkedIn Page account. Opt-in: the account must have comment events available.',
					},
					{
						name: 'Customer Media Received',
						value: 'customer_media_received',
						description:
							'A Google Maps user added a photo to a Google Business Profile location. Needs Google Business notifications turned on.',
					},
					{
						name: 'Direct Message Received',
						value: 'dm_received',
						description:
							'Someone sent a direct message to a connected Instagram, WhatsApp or Bluesky account, or to your Telegram bot. Opt-in: the account must have direct messages available.',
					},
					{
						name: 'Listing Control Changed',
						value: 'listing_control_changed',
						description:
							'The control over a Google Business Profile listing changed (verification, suspension…). Needs Google Business notifications turned on.',
					},
					{
						name: 'Listing Duplicate',
						value: 'listing_duplicate',
						description:
							'Google flagged a change in a listing’s possible duplicate. Needs Google Business notifications turned on.',
					},
					{
						name: 'Listing Google Update',
						value: 'listing_google_update',
						description:
							'Google suggests updates to a Google Business Profile listing. Needs Google Business notifications turned on.',
					},
					{
						name: 'Phone Number Activated',
						value: 'phone_number_activated',
						description:
							'A phone number you bought is active (also after an identity review). Opt-in. Needs phone numbers available on the account (not generally available yet).',
					},
					{
						name: 'Phone Number Declined',
						value: 'phone_number_declined',
						description:
							'Our carrier declined the identity review of a phone number (reason field). The payment is kept and the monthly charge paused: fix it with Fix Identity Review (no second charge); 30 days without a fix, or a release, cancels and refunds it. Opt-in. Needs phone numbers available on the account (not generally available yet).',
					},
					{
						name: 'Phone Number KYC Comment',
						value: 'phone_number_kyc_comment',
						description:
							'The identity reviewer of our carrier wrote about one of your phone numbers (one event per message: the comment field has the body; the number field the number). Answer with Reply to Reviewer. Opt-in. Needs phone numbers available on the account (not generally available yet).',
					},
					{
						name: 'Phone Number KYC Resubmitted',
						value: 'phone_number_kyc_resubmitted',
						description:
							'The corrections of Fix Identity Review were sent and the number is back under review (number and order fields; nothing is charged again). Opt-in. Needs phone numbers available on the account (not generally available yet).',
					},
					{
						name: 'Phone Number Port Out',
						value: 'phone_number_port_out',
						description:
							'A phone number is being moved, or was moved, to another carrier (port_out_status field). Opt-in. Needs phone numbers available on the account (not generally available yet).',
					},
					{
						name: 'Phone Number Released',
						value: 'phone_number_released',
						description:
							'A phone number was released, by you or after the subscription ended (reason field). Opt-in. Needs phone numbers available on the account (not generally available yet).',
					},
					{
						name: 'Post Analytics Updated',
						value: 'post_analytics_updated',
						description:
							'Upload-Post refreshed the analytics of a post (on a read or a scheduled checkpoint). Opt-in, at most once per post and age bucket, with a daily cap.',
					},
					{
						name: 'Post Approval Expired',
						value: 'post_approval_expired',
						description:
							'A post waiting for approval passed its date without a decision and will not be published. Needs post approvals turned on for the account.',
					},
					{
						name: 'Post Approval Requested',
						value: 'post_approval_requested',
						description:
							'A team member (Editor or Contributor) created a post that waits for approval. Needs post approvals turned on for the account.',
					},
					{
						name: 'Post Approved',
						value: 'post_approved',
						description:
							'A post waiting for approval was approved and scheduled. Needs post approvals turned on for the account.',
					},
					{
						name: 'Post Rejected',
						value: 'post_rejected',
						description:
							'A post waiting for approval was rejected. Needs post approvals turned on for the account.',
					},
					{
						name: 'Review Received',
						value: 'review_received',
						description:
							'A Google Business Profile location got a new review. Needs Google Business notifications turned on.',
					},
					{
						name: 'Review Updated',
						value: 'review_updated',
						description:
							'A review of a Google Business Profile location was edited. Needs Google Business notifications turned on.',
					},
					{
						name: 'SMS Received',
						value: 'sms_received',
						description:
							'One of your Upload-Post phone numbers received an SMS (the message field has the sender and the text). Opt-in. Needs phone numbers available on the account (not generally available yet).',
					},
					{
						name: 'Social Account Connected',
						value: 'social_account_connected',
						description: 'A social account was connected or reconnected to a profile',
					},
					{
						name: 'Social Account Disconnected',
						value: 'social_account_disconnected',
						description: 'A social account was disconnected, manually or automatically',
					},
					{
						name: 'Social Account Reauth Required',
						value: 'social_account_reauth_required',
						description: 'A social account needs to be connected again',
					},
					{
						name: 'Telegram Update',
						value: 'telegram_update',
						description:
							'Every raw update your Telegram bot receives (button presses, join requests, payments…). Opt-in: the bot’s updates must be turned on in Upload-Post.',
					},
					{
						name: 'Upload Completed',
						value: 'upload_completed',
						description:
							'An upload finished, published or failed: check the success field of each platform result',
					},
					{
						name: 'Voicemail Received',
						value: 'voicemail_received',
						description:
							'A caller left a voicemail on one of your Upload-Post phone numbers (the call field has the recording link and the transcript). Opt-in. Needs phone numbers available on the account (not generally available yet).',
					},
					{
						name: 'YouTube Video Published',
						value: 'youtube_video_published',
						description:
							'The YouTube channel of a profile published a video. Needs YouTube notifications turned on (not available on every account yet).',
					},
					{
						name: 'YouTube Video Updated',
						value: 'youtube_video_updated',
						description:
							'A video of that channel changed its title or description. Needs YouTube notifications turned on (not available on every account yet).',
					},
				],
			},
			{
				displayName: 'Profile Name or ID',
				name: 'profileUsername',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getProfiles',
				},
				default: '',
				description:
					'Only events of this Upload-Post profile. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Verify Signature',
				name: 'verifySignature',
				type: 'boolean',
				default: true,
				description:
					'Whether to reject deliveries whose X-Upload-Post-Signature does not match the account webhook secret, or whose timestamp is more than 5 minutes off',
			},
		],
	};

	methods = {
		loadOptions: {
			async getProfiles(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const response = await apiRequest.call(this, 'GET', '/uploadposts/users');
				if (response.statusCode !== 200) throwApiError.call(this, response);
				const profiles = Array.isArray(response.body.profiles)
					? (response.body.profiles as Array<{ username?: string }>)
					: [];
				return [
					{ name: 'All Profiles', value: '' },
					...profiles
						.filter((profile) => profile.username)
						.map((profile) => ({ name: String(profile.username), value: String(profile.username) })),
				];
			},
		},
	};

	webhookMethods = {
		default: {
			// True only when an active subscription with exactly these events and
			// profile already points at this URL. Anything else (disabled, other
			// events, other profile, none) makes n8n call create().
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node') as TriggerStaticData;
				const url = this.getNodeWebhookUrl('default') as string;
				const events = normalizeEvents(this.getNodeParameter('events', []));
				const profile = normalizeProfile(this.getNodeParameter('profileUsername', ''));
				const subscriptions = await listSubscriptions.call(this, url, 'active');
				const match = subscriptions.find((s) => matchesSubscription(s, url, events, profile));
				if (!match) return false;
				staticData.subscriptionId = match.id;
				return true;
			},

			// POST is idempotent on (url, events, profile): calling it again
			// returns the same subscription, reactivating it if it was disabled.
			async create(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node') as TriggerStaticData;
				const url = this.getNodeWebhookUrl('default') as string;
				const events = normalizeEvents(this.getNodeParameter('events', []));
				const profile = normalizeProfile(this.getNodeParameter('profileUsername', ''));
				const body: IDataObject = { url, events, source: 'n8n' };
				if (profile) body.profile_username = profile;
				const workflowName = String(this.getWorkflow().name ?? '').trim();
				if (workflowName) body.name = workflowName.slice(0, MAX_NAME_LENGTH);

				const response = await apiRequest.call(this, 'POST', SUBSCRIPTIONS_PATH, body);
				if (response.statusCode !== 200 && response.statusCode !== 201) {
					throwApiError.call(this, response, events);
				}
				const subscription = (response.body.subscription ?? {}) as IDataObject;
				if (!subscription.id) throwApiError.call(this, response);
				const subscriptionId = String(subscription.id);
				staticData.subscriptionId = subscriptionId;

				// A subscription for this same URL with other events or another
				// profile was left by an earlier version of this node: the URL
				// belongs to this node only, so it would deliver events nobody
				// selected any more.
				try {
					const stale = (await listSubscriptions.call(this, url, 'active')).filter(
						(s) => s.id !== subscriptionId,
					);
					for (const old of stale) {
						const removed = await apiRequest.call(
							this,
							'DELETE',
							`${SUBSCRIPTIONS_PATH}/${encodeURIComponent(old.id)}`,
						);
						if (removed.statusCode !== 200 && removed.statusCode !== 404) {
							this.logger.warn(
								`Upload Post Trigger: could not remove the old subscription ${old.id} (HTTP ${removed.statusCode})`,
							);
						}
					}
				} catch (error) {
					this.logger.warn(
						`Upload Post Trigger: could not check for old subscriptions on this URL: ${(error as Error).message}`,
					);
				}

				// The account secret exists once a subscription does; cache it so
				// the first delivery is verified without an extra request.
				try {
					staticData.webhookSecret = await fetchWebhookSecret.call(this);
					staticData.webhookSecretFetchedAt = Date.now();
				} catch (error) {
					this.logger.warn(
						`Upload Post Trigger: could not read the webhook secret yet, it will be read on the first delivery: ${(error as Error).message}`,
					);
				}
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node') as TriggerStaticData;
				const subscriptionId = staticData.subscriptionId;
				if (subscriptionId) {
					let response;
					try {
						response = await apiRequest.call(
							this,
							'DELETE',
							`${SUBSCRIPTIONS_PATH}/${encodeURIComponent(subscriptionId)}`,
						);
					} catch (error) {
						this.logger.error(
							`Upload Post Trigger: could not delete subscription ${subscriptionId}: ${(error as Error).message}`,
						);
						return false;
					}
					// 404: already gone (deleted by hand, or removed by Upload-Post).
					if (response.statusCode !== 200 && response.statusCode !== 404) {
						this.logger.error(
							`Upload Post Trigger: could not delete subscription ${subscriptionId} (HTTP ${response.statusCode})`,
						);
						return false;
					}
				}
				delete staticData.subscriptionId;
				delete staticData.webhookSecret;
				delete staticData.webhookSecretFetchedAt;
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const req = this.getRequestObject();
		const headers = this.getHeaderData() as IDataObject;
		const event = headerValue(headers, 'x-upload-post-event');
		const timestamp = headerValue(headers, 'x-upload-post-timestamp');

		if (this.getNodeParameter('verifySignature', true) as boolean) {
			const signature = headerValue(headers, 'x-upload-post-signature');
			if (!signature) return reject(this, 401, 'Missing X-Upload-Post-Signature');
			if (!timestampIsFresh(timestamp, Date.now())) {
				return reject(this, 401, 'X-Upload-Post-Timestamp is missing or more than 5 minutes off');
			}
			const rawBody: string | Uint8Array =
				req.rawBody ?? JSON.stringify(this.getBodyData() ?? {});
			const staticData = this.getWorkflowStaticData('node') as TriggerStaticData;
			let valid = signatureMatches(staticData.webhookSecret ?? '', timestamp, rawBody, signature);
			const fetchedAt = Number(staticData.webhookSecretFetchedAt ?? 0);
			if (!valid && (!staticData.webhookSecret || Date.now() - fetchedAt >= SECRET_REFRESH_INTERVAL_MS)) {
				// The secret may have been rotated since it was cached.
				try {
					staticData.webhookSecret = await fetchWebhookSecret.call(this);
					staticData.webhookSecretFetchedAt = Date.now();
				} catch (error) {
					this.logger.error(
						`Upload Post Trigger: could not read the webhook secret: ${(error as Error).message}`,
					);
					return reject(this, 503, 'Could not read the Upload-Post webhook secret');
				}
				valid = signatureMatches(staticData.webhookSecret, timestamp, rawBody, signature);
			}
			if (!valid) return reject(this, 401, 'Invalid X-Upload-Post-Signature');
		}

		const body = this.getBodyData() ?? {};
		const eventName = event || String(body.event ?? '');
		const selected = normalizeEvents(this.getNodeParameter('events', []));
		if (eventName && selected.length && !selected.includes(eventName.toLowerCase())) {
			// Acknowledge it so Upload-Post does not retry, but do not run the workflow.
			return { webhookResponse: { success: true, ignored: true } };
		}

		const delivery: IDataObject = {
			event: eventName,
			deliveryId: headerValue(headers, 'x-upload-post-delivery'),
			attempt: Number(headerValue(headers, 'x-upload-post-attempt') || 1),
			subscriptionId: headerValue(headers, 'x-upload-post-subscription'),
			timestamp,
		};
		const redeliveryOf = headerValue(headers, 'x-upload-post-redelivery-of');
		if (redeliveryOf) delivery.redeliveryOf = redeliveryOf;

		return {
			workflowData: [this.helpers.returnJsonArray({ ...body, uploadPostDelivery: delivery })],
		};
	}
}
