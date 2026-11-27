import { createHmac } from 'crypto';
import {
	IDataObject,
	IHookFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	IWebhookFunctions,
	JsonObject,
	NodeApiError,
} from 'n8n-workflow';

export const API_BASE_URL = 'https://api.upload-post.com/api';
export const SUBSCRIPTIONS_PATH = '/uploadposts/webhooks/subscriptions';
export const NOTIFICATIONS_PATH = '/uploadposts/users/notifications';

// Deliveries whose X-Upload-Post-Timestamp is further than this from now are
// rejected, so a captured request cannot be replayed later.
export const SIGNATURE_TOLERANCE_SECONDS = 300;
// A failed signature refetches the account secret (it may have been rotated),
// but at most once per this window, so forged requests cannot turn into one
// API call each.
export const SECRET_REFRESH_INTERVAL_MS = 60_000;

export const MAX_NAME_LENGTH = 100;

type Context = IHookFunctions | IWebhookFunctions | ILoadOptionsFunctions;

export type ApiResponse = { statusCode: number; body: IDataObject };

export type Subscription = {
	id: string;
	url: string;
	events: string[];
	profile_username: string | null;
	status: string;
};

// Every call returns the status code instead of throwing, so each caller can
// decide what a 404 or a 400 means (a DELETE that finds nothing is a success).
export async function apiRequest(
	this: Context,
	method: IHttpRequestMethods,
	path: string,
	body?: IDataObject,
	qs?: IDataObject,
): Promise<ApiResponse> {
	const options: IHttpRequestOptions = {
		method,
		url: `${API_BASE_URL}${path}`,
		json: true,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
	};
	if (body !== undefined) options.body = body;
	if (qs !== undefined) options.qs = qs;
	const response = (await this.helpers.httpRequestWithAuthentication.call(
		this,
		'uploadPostApi',
		options,
	)) as { statusCode: number; body: unknown };
	let parsed = response.body;
	if (typeof parsed === 'string') {
		try {
			parsed = JSON.parse(parsed);
		} catch {
			parsed = { message: parsed };
		}
	}
	return {
		statusCode: Number(response.statusCode),
		body: parsed && typeof parsed === 'object' ? (parsed as IDataObject) : {},
	};
}

const describeError = (
	statusCode: number,
	body: IDataObject,
	requested: string[],
): { message: string; description: string } => {
	const reason = String(body.reason ?? '');
	const apiMessage = String(body.message ?? '');
	switch (reason) {
		case 'invalid_url':
			return {
				// n8n shows only the message when an activation fails, so the fix goes here too.
				message:
					'Upload-Post only sends webhooks to a public HTTPS URL: set WEBHOOK_URL on this n8n to its public https address',
				description:
					`${apiMessage ? apiMessage + '. ' : ''}This n8n instance gave a webhook URL that Upload-Post cannot reach ` +
					'(not https, or a private/local address). Run n8n behind a public https address and set its WEBHOOK_URL ' +
					'environment variable to that address, then activate the workflow again.',
			};
		case 'invalid_events': {
			// Gated events (YouTube push, post approvals) are refused while that
			// feature is off on the account; name them, n8n shows only the message.
			const allowed = Array.isArray(body.allowed_events) ? (body.allowed_events as string[]) : [];
			let missing = allowed.length ? requested.filter((event) => !allowed.includes(event)) : [];
			if (!missing.length) {
				const listed = /Unknown webhook events:\s*(.+)$/.exec(apiMessage);
				missing = listed ? listed[1].split(',').map((event) => event.trim()).filter(Boolean) : [];
			}
			return {
				message: missing.length
					? `These events are not available on this Upload-Post account: ${missing.join(', ')}. Remove them or turn the feature on`
					: 'Upload-Post does not accept one of the selected events',
				description: `${apiMessage ? apiMessage + '. ' : ''}Events this account accepts now: ${
					allowed.length ? allowed.join(', ') : 'see the API documentation'
				}. YouTube video events need YouTube notifications on, post approval events need post approvals on, phone number events need phone numbers available on the account.`,
			};
		}
		case 'profile_not_found':
			return { message: 'The selected Upload-Post profile does not exist', description: apiMessage };
		case 'subscription_limit_reached':
			return {
				message: `This Upload-Post account already has ${body.limit ?? 'the maximum number of'} active webhook subscriptions`,
				description:
					'Deactivate another workflow that uses the Upload Post Trigger, or delete an unused subscription with the API, and try again.',
			};
		case 'team_member_forbidden':
			return {
				message: 'This API key belongs to a team member',
				description: 'Webhook subscriptions can only be managed with the account owner’s API key.',
			};
		case 'webhook_subscriptions_disabled':
			return {
				// Off as a feature, not a temporary failure: retrying will not help.
				message: 'Webhook subscriptions are not generally available on Upload-Post yet, so this trigger cannot be activated',
				description:
					`${apiMessage ? apiMessage + '. ' : ''}Upload-Post answered 503 webhook_subscriptions_disabled: the feature is switched off, ` +
					'not a temporary failure. Until it is on, use the account webhook (Update Notification Preferences) with an n8n Webhook node.',
			};
	}
	if (statusCode === 401 || statusCode === 403) {
		return { message: 'Upload-Post rejected the API key', description: apiMessage || 'Check the Upload Post API credential.' };
	}
	return {
		message: `Upload-Post answered ${statusCode}${reason ? ` (${reason})` : ''}`,
		description: apiMessage || JSON.stringify(body),
	};
};

// requested: the events the node sent, to name the ones Upload-Post refused.
export function throwApiError(this: Context, response: ApiResponse, requested: string[] = []): never {
	const { message, description } = describeError(response.statusCode, response.body, requested);
	throw new NodeApiError(this.getNode(), response.body as JsonObject, {
		message,
		description,
		httpCode: String(response.statusCode),
	});
}

export const normalizeEvents = (events: unknown): string[] =>
	Array.from(new Set((Array.isArray(events) ? events : []).map((e) => String(e).trim().toLowerCase()))).sort();

export const sameEvents = (a: unknown, b: unknown): boolean => {
	const left = normalizeEvents(a);
	const right = normalizeEvents(b);
	return left.length === right.length && left.every((event, index) => event === right[index]);
};

export const normalizeProfile = (profile: unknown): string => String(profile ?? '').trim();

export const matchesSubscription = (
	subscription: Subscription,
	url: string,
	events: string[],
	profile: string,
): boolean =>
	subscription.status === 'active' &&
	subscription.url === url &&
	sameEvents(subscription.events, events) &&
	normalizeProfile(subscription.profile_username) === profile;

export async function listSubscriptions(this: IHookFunctions, url: string, status?: string): Promise<Subscription[]> {
	const qs: IDataObject = { url };
	if (status) qs.status = status;
	const response = await apiRequest.call(this, 'GET', SUBSCRIPTIONS_PATH, undefined, qs);
	if (response.statusCode !== 200) throwApiError.call(this, response);
	const rows = response.body.subscriptions;
	return Array.isArray(rows) ? (rows as Subscription[]) : [];
}

export async function fetchWebhookSecret(this: Context): Promise<string> {
	const response = await apiRequest.call(this, 'GET', NOTIFICATIONS_PATH);
	if (response.statusCode !== 200) throwApiError.call(this, response);
	const notifications = (response.body.notifications ?? {}) as IDataObject;
	return String(notifications.webhook_secret ?? '');
}

export const computeSignature = (secret: string, timestamp: string, rawBody: string | Uint8Array): string => {
	const hmac = createHmac('sha256', secret);
	hmac.update(`${timestamp}.`);
	hmac.update(rawBody);
	return hmac.digest('hex');
};

// Compares every character whatever the input, so the time taken does not tell
// an attacker how much of a forged signature was right.
export const constantTimeEqual = (expected: string, received: string): boolean => {
	let diff = expected.length ^ received.length;
	for (let i = 0; i < expected.length; i++) {
		diff |= expected.charCodeAt(i) ^ (i < received.length ? received.charCodeAt(i) : 0);
	}
	return diff === 0;
};

export const signatureMatches = (
	secret: string,
	timestamp: string,
	rawBody: string | Uint8Array,
	header: string,
): boolean => {
	if (!secret || !header.startsWith('sha256=')) return false;
	const expected = computeSignature(secret, timestamp, rawBody);
	const received = header.slice('sha256='.length).trim().toLowerCase();
	return constantTimeEqual(expected, received);
};

export const timestampIsFresh = (timestamp: string, nowMs: number): boolean => {
	if (!/^\d+$/.test(timestamp)) return false;
	return Math.abs(nowMs / 1000 - Number(timestamp)) <= SIGNATURE_TOLERANCE_SECONDS;
};

export const headerValue = (headers: IDataObject, name: string): string => {
	const value = headers[name.toLowerCase()];
	if (Array.isArray(value)) return String(value[0] ?? '');
	return value === undefined || value === null ? '' : String(value);
};
