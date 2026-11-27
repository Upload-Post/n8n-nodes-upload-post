import { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import {
	bool,
	fail,
	jsonObjectParam,
	NetworkContext,
	NetworkRequest,
	param,
	putFilled,
	requireStr,
	str,
} from './NetworkOperations';

// Upload-Post phone numbers: buy a real number for a profile, receive SMS,
// calls and voicemail, send SMS, read one-time codes (WhatsApp verification) and
// see the usage. Not generally available yet: the API answers 403
// phone_numbers_not_available until phone numbers are available for the account.
// Paid plans only. These numbers cannot call emergency services.

const P = '/uploadposts/phone-numbers';
const RESOURCE = 'phoneNumbers';

const call = (
	method: NetworkRequest['method'],
	endpoint: string,
	payload: IDataObject,
	asQuery = method === 'GET' || method === 'DELETE',
): NetworkRequest => {
	const base = { endpoint, method, isUploadOperation: false, waitForCompletion: false };
	return asQuery ? { ...base, qs: payload } : { ...base, body: payload };
};

const show = (operation: string[], extra: IDataObject = {}) => ({ show: { resource: [RESOURCE], operation, ...extra } });

const BUY_OPS = ['purchasePhoneNumber', 'submitPhoneNumberKyc'];
const NUMBER_OPS = [
	'getPhoneNumber',
	'releasePhoneNumber',
	'updatePhoneNumberVoice',
	'sendPhoneNumberSms',
	'listPhoneNumberMessages',
	'listPhoneNumberCalls',
	'listPhoneNumberCodes',
	'preparePhoneNumberWhatsapp',
	'getPhoneNumberPortOutInfo',
];
const COUNTRY_OPS = ['searchAvailablePhoneNumbers', 'getPhoneNumberKycFields', ...BUY_OPS];
const LANGUAGES = [
	{ name: 'English', value: 'en' },
	{ name: 'French', value: 'fr' },
	{ name: 'German', value: 'de' },
	{ name: 'Italian', value: 'it' },
	{ name: 'Portuguese', value: 'pt' },
	{ name: 'Spanish', value: 'es' },
];
const NUMBER_TYPES = [
	{ name: 'Local', value: 'local' },
	{ name: 'Mobile', value: 'mobile' },
	{ name: 'National', value: 'national' },
];

export const phoneNumberProperties: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		options: [
			{ name: 'Get', value: 'getPhoneNumber', action: 'Get a phone number', description: 'One number with its status, price, call settings and flags' },
			{ name: 'Get Codes', value: 'listPhoneNumberCodes', action: 'Get the verification codes a phone number received', description: 'One-time codes (4-8 digits) found in the SMS and call transcripts of the last 30 minutes' },
			{ name: 'Get Config', value: 'getPhoneNumbersConfig', action: 'Get the phone numbers configuration', description: 'Whether this account can buy a number now (and why not), the current terms version and terms URL' },
			{ name: 'Get Identity Fields', value: 'getPhoneNumberKycFields', action: 'Get the identity fields a country needs', description: 'End-user fields and the documents our carrier needs for a country and number type' },
			{ name: 'Get Port-Out Info', value: 'getPhoneNumberPortOutInfo', action: 'Get what the new carrier needs to port a number out', description: 'Name, address, account number and number to give the new carrier (account owner only)' },
			{ name: 'Get Usage', value: 'getPhoneNumbersUsage', action: 'Get the phone usage and charges', description: 'Billable usage with totals in USD, charged on the next subscription invoice' },
			{ name: 'List', value: 'listPhoneNumbers', action: 'List phone numbers', description: 'Numbers of the account (pending and active unless Status says otherwise)' },
			{ name: 'List Calls', value: 'listPhoneNumberCalls', action: 'List the calls of a phone number', description: 'Calls and voicemails newest first, with transcript and a recording link valid for 1 hour' },
			{ name: 'List Countries', value: 'listPhoneNumberCountries', action: 'List phone number countries and prices', description: 'Countries and number types on sale, cheapest first, with the monthly price and what they support' },
			{ name: 'List Messages', value: 'listPhoneNumberMessages', action: 'List the sms of a phone number', description: 'Inbound and outbound SMS newest first' },
			{ name: 'Prepare WhatsApp Verification', value: 'preparePhoneNumberWhatsapp', action: 'Prepare a phone number for the whatsapp code', description: 'For 30 minutes calls are answered and transcribed so the code Meta reads out shows in Get Codes' },
			{ name: 'Purchase', value: 'purchasePhoneNumber', action: 'Buy a phone number', description: 'Buy a number for a profile. Charged on the account subscription; some countries first answer kyc_required.' },
			{ name: 'Release', value: 'releasePhoneNumber', action: 'Release a phone number', description: 'Give the number back. Final: needs Confirm Release.' },
			{ name: 'Search Available', value: 'searchAvailablePhoneNumbers', action: 'Search phone numbers to buy', description: 'Numbers available now in a country, with their monthly price' },
			{ name: 'Send SMS', value: 'sendPhoneNumberSms', action: 'Send an sms from a phone number', description: 'Send an SMS from one of your numbers (not from US or Canadian numbers yet)' },
			{ name: 'Submit Identity Documents', value: 'submitPhoneNumberKyc', action: 'Send identity documents and buy a phone number', description: 'Answer to kyc_required: the purchase plus the identity values and documents our carrier asked for' },
			{ name: 'Update Voice Settings', value: 'updatePhoneNumberVoice', action: 'Update the call settings of a phone number', description: 'Forwarding, voicemail, recording and transcription (only what you add changes)' },
		],
		default: 'listPhoneNumbers',
		displayOptions: { show: { resource: [RESOURCE] } },
	},
	{
		displayName:
			'Not generally available yet: the API answers 403 phone_numbers_not_available until phone numbers are available for your account (Get Config answers enabled: false). Paid plans only. These numbers cannot call emergency services (112/911).',
		name: 'phoneNumbersNotice',
		type: 'notice',
		default: '',
		displayOptions: { show: { resource: [RESOURCE] } },
	},

	// ---- Number ----
	{
		displayName: 'Number ID',
		name: 'phoneNumberId',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'pn_3f9c0a1b2c3d4e5f6a7b8c9d',
		description: 'Upload-Post ID of the number (pn_…), from List or Purchase. Not the phone number itself.',
		displayOptions: show(NUMBER_OPS),
	},

	// ---- List ----
	{
		displayName: 'Status',
		name: 'phoneStatus',
		type: 'options',
		options: [
			{ name: 'Active', value: 'active' },
			{ name: 'Failed', value: 'failed' },
			{ name: 'Pending and Active', value: '' },
			{ name: 'Pending Payment', value: 'pending_payment' },
			{ name: 'Pending Regulatory', value: 'pending_regulatory' },
			{ name: 'Ported Out', value: 'ported_out' },
			{ name: 'Regulatory Declined', value: 'regulatory_declined' },
			{ name: 'Released', value: 'released' },
		],
		default: '',
		displayOptions: show(['listPhoneNumbers']),
	},
	{
		displayName: 'Profile Name or ID',
		name: 'phoneProfileFilter',
		type: 'options',
		default: '',
		description: 'Only the numbers of this profile. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		typeOptions: { loadOptionsMethod: 'getUserProfiles' },
		displayOptions: show(['listPhoneNumbers']),
	},

	// ---- Country and type (search, identity fields, purchase) ----
	{
		displayName: 'Profile Name or ID',
		name: 'phoneProfile',
		type: 'options',
		required: true,
		default: '',
		description: 'Profile the number belongs to. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		typeOptions: { loadOptionsMethod: 'getUserProfiles' },
		displayOptions: show(BUY_OPS),
	},
	{
		displayName: 'Country',
		name: 'phoneCountry',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'US',
		description: 'ISO country code (US, GB, ES, FR, DE, IT, MX, BR). List Countries gives the current list with prices.',
		displayOptions: show(COUNTRY_OPS),
	},
	{
		displayName: 'Number Type',
		name: 'phoneNumberType',
		type: 'options',
		options: NUMBER_TYPES,
		default: 'local',
		displayOptions: show(COUNTRY_OPS),
	},
	{
		displayName: 'Phone Number',
		name: 'phoneNumberToBuy',
		type: 'string',
		default: '',
		placeholder: '+34911234567',
		description: 'A number from Search Available. Empty = the first available one.',
		displayOptions: show(BUY_OPS),
	},
	{
		displayName: 'Area Code',
		name: 'phoneAreaCode',
		type: 'string',
		default: '',
		description: 'National destination code (e.g. 212, 91)',
		displayOptions: show(['searchAvailablePhoneNumbers', ...BUY_OPS]),
	},

	// ---- Search ----
	{
		displayName: 'City',
		name: 'phoneLocality',
		type: 'string',
		default: '',
		displayOptions: show(['searchAvailablePhoneNumbers']),
	},
	{
		displayName: 'Contains',
		name: 'phoneContains',
		type: 'string',
		default: '',
		description: 'Digits the number must contain',
		displayOptions: show(['searchAvailablePhoneNumbers']),
	},
	{
		displayName: 'Only With SMS',
		name: 'phoneSmsOnly',
		type: 'boolean',
		default: false,
		description: 'Whether to return only numbers that can receive SMS (some ES, DE and IT numbers have no SMS at all)',
		displayOptions: show(['searchAvailablePhoneNumbers']),
	},
	{
		displayName: 'Limit',
		name: 'phoneSearchLimit',
		type: 'number',
		typeOptions: { minValue: 1, maxValue: 50 },
		default: 20,
		description: 'Max number of results to return',
		displayOptions: show(['searchAvailablePhoneNumbers']),
	},

	// ---- Purchase ----
	{
		displayName: 'Purchase Intent ID',
		name: 'phonePurchaseIntentId',
		type: 'string',
		required: true,
		default: '={{ "n8n-" + $execution.id + "-" + $itemIndex }}',
		description:
			'Your idempotency key (8-100 characters). Repeating it returns the same number and never charges twice (Retry On Fail keeps it); use a new one to retry a failed purchase. The default is unique per execution and item. For Submit Identity Documents use the purchase_intent_id of the kyc_required answer.',
		displayOptions: show(BUY_OPS),
	},
	{
		displayName: 'End User Type',
		name: 'phoneEndUserType',
		type: 'options',
		options: [
			{ name: 'Business', value: 'business' },
			{ name: 'Individual', value: 'individual' },
		],
		default: 'individual',
		description: 'Who uses the number. Our carrier needs it for every purchase; it is stored encrypted.',
		displayOptions: show(BUY_OPS),
	},
	{
		displayName: 'First Name',
		name: 'phoneEndUserFirstName',
		type: 'string',
		required: true,
		default: '',
		description: 'Legal first name (of the person, or of the business contact)',
		displayOptions: show(BUY_OPS),
	},
	{
		displayName: 'Last Name',
		name: 'phoneEndUserLastName',
		type: 'string',
		required: true,
		default: '',
		displayOptions: show(BUY_OPS),
	},
	{
		displayName: 'Business Name',
		name: 'phoneEndUserBusinessName',
		type: 'string',
		required: true,
		default: '',
		description: 'Legal name of the business',
		displayOptions: show(BUY_OPS, { phoneEndUserType: ['business'] }),
	},
	{
		displayName: 'Contact Phone',
		name: 'phoneEndUserPhone',
		type: 'string',
		required: true,
		default: '',
		placeholder: '+34600111222',
		description: 'Contact phone of the end user in international format',
		displayOptions: show(BUY_OPS),
	},
	{
		displayName: 'Email',
		name: 'phoneEndUserEmail',
		type: 'string',
		placeholder: 'name@email.com',
		default: '',
		displayOptions: show(BUY_OPS),
	},
	{
		displayName: 'Street Address',
		name: 'phoneEndUserStreet',
		type: 'string',
		required: true,
		default: '',
		description: 'ES, DE, FR and IT numbers need an address in that country (local numbers: matching the area code)',
		displayOptions: show(BUY_OPS),
	},
	{
		displayName: 'Address Line 2',
		name: 'phoneEndUserExtendedAddress',
		type: 'string',
		default: '',
		displayOptions: show(BUY_OPS),
	},
	{
		displayName: 'City (Address)',
		name: 'phoneEndUserLocality',
		type: 'string',
		required: true,
		default: '',
		displayOptions: show(BUY_OPS),
	},
	{
		displayName: 'State / Region',
		name: 'phoneEndUserAdministrativeArea',
		type: 'string',
		default: '',
		displayOptions: show(BUY_OPS),
	},
	{
		displayName: 'Postal Code',
		name: 'phoneEndUserPostalCode',
		type: 'string',
		required: true,
		default: '',
		displayOptions: show(BUY_OPS),
	},
	{
		displayName: 'Address Country',
		name: 'phoneEndUserCountryCode',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'ES',
		description: 'ISO country code of the address',
		displayOptions: show(BUY_OPS),
	},
	{
		displayName: 'Accept Terms',
		name: 'phoneAcceptTerms',
		type: 'boolean',
		default: false,
		description:
			'Whether you accept the phone number terms (terms_url of Get Config): no emergency calls (112/911), acceptable use, porting authorization and carrier data processing in the US. Required to buy.',
		displayOptions: show(BUY_OPS),
	},
	{
		displayName: 'Terms Version',
		name: 'phoneTermsVersion',
		type: 'string',
		required: true,
		default: '',
		placeholder: '2026-11-27',
		description: 'The terms_version of Get Config (the version you accepted)',
		displayOptions: show(BUY_OPS),
	},

	// ---- Identity documents ----
	{
		displayName: 'Identity Values (JSON)',
		name: 'phoneKycValues',
		type: 'json',
		default: '',
		description: 'Text and date requirements of Get Identity Fields: {"requirement_id": "value"}',
		displayOptions: show(['submitPhoneNumberKyc']),
	},
	{
		displayName: 'Documents',
		name: 'phoneKycDocuments',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		placeholder: 'Add Document',
		default: {},
		description: 'File requirements of Get Identity Fields, each from a binary property (PDF, JPG or PNG, up to 10 MB). Documents go to our carrier and are not kept by Upload-Post.',
		displayOptions: show(['submitPhoneNumberKyc']),
		options: [
			{
				displayName: 'Document',
				name: 'document',
				values: [
					{ displayName: 'Requirement ID', name: 'requirementId', type: 'string', default: '', description: 'The requirement_id of Get Identity Fields' },
					{ displayName: 'Input Binary Field', name: 'binaryProperty', type: 'string', default: 'data', description: 'Binary property of the input item that holds the file' },
				],
			},
		],
	},

	// ---- Release ----
	{
		displayName: 'Confirm Release',
		name: 'phoneConfirmRelease',
		type: 'boolean',
		default: false,
		description:
			'Whether you confirm the release. It is final: WhatsApp and anything else using the number stop working, our carrier may give the number to someone else later, and the monthly charge stops (no proration). Without it nothing is sent.',
		displayOptions: show(['releasePhoneNumber']),
	},

	// ---- Voice ----
	{
		displayName: 'Voice Settings',
		name: 'phoneVoiceSettings',
		type: 'collection',
		placeholder: 'Add Setting',
		default: {},
		description: 'Only the settings you add change',
		displayOptions: show(['updatePhoneNumberVoice']),
		options: [
			{ displayName: 'Forward To', name: 'forwardTo', type: 'string', default: '', placeholder: '+34600111222', description: 'Forward calls to this number (international format; tel:+… also works). Only geographic or mobile numbers in the number\'s country or the end user\'s country. Forwarded calls show this Upload-Post number as caller ID.' },
			{ displayName: 'Recording', name: 'recordingEnabled', type: 'boolean', default: true, description: 'Whether to record voicemails. Off: calls are only logged as missed.' },
			{ displayName: 'Transcription', name: 'transcriptionEnabled', type: 'boolean', default: true, description: 'Whether to transcribe voicemails' },
			{ displayName: 'Transcription Language', name: 'transcriptionLanguage', type: 'options', options: LANGUAGES, default: 'en' },
			{ displayName: 'Turn Off Forwarding', name: 'forwardingOff', type: 'boolean', default: true, description: 'Whether to stop forwarding calls (sends forward_to null)' },
			{ displayName: 'Voicemail', name: 'voicemailEnabled', type: 'boolean', default: true, description: 'Whether unanswered calls go to voicemail. Voicemail always tells the caller that the call is recorded and transcribed.' },
			{ displayName: 'Voicemail Greeting', name: 'voicemailGreeting', type: 'string', default: '', description: 'Text read to the caller (up to 500 characters)' },
		],
	},

	// ---- SMS ----
	{
		displayName: 'To',
		name: 'phoneSmsTo',
		type: 'string',
		required: true,
		default: '',
		placeholder: '+34600111222',
		description: 'Recipient in international format',
		displayOptions: show(['sendPhoneNumberSms']),
	},
	{
		displayName: 'Text',
		name: 'phoneSmsText',
		type: 'string',
		typeOptions: { rows: 3 },
		required: true,
		default: '',
		description:
			'Up to 1,600 characters, billed per message part. Recipients who replied STOP cannot be messaged; max 10 messages per recipient per 24 h and 1 per second per number; spam, adult, gambling, drugs, crypto and loan content is refused.',
		displayOptions: show(['sendPhoneNumberSms']),
	},

	// ---- Messages, calls, codes ----
	{
		displayName: 'Limit',
		name: 'phoneListLimit',
		type: 'number',
		typeOptions: { minValue: 1, maxValue: 200 },
		default: 50,
		description: 'Max number of results to return',
		displayOptions: show(['listPhoneNumberMessages', 'listPhoneNumberCalls']),
	},
	{
		displayName: 'Before',
		name: 'phoneBefore',
		type: 'string',
		default: '',
		placeholder: '2026-11-27T10:00:00Z',
		description: 'ISO date: only older items (pagination: the date of the last item of the previous page)',
		displayOptions: show(['listPhoneNumberMessages', 'listPhoneNumberCalls']),
	},
	{
		displayName: 'Since',
		name: 'phoneSince',
		type: 'string',
		default: '',
		placeholder: '2026-11-27T10:00:00Z',
		description: 'ISO date: only codes received after it. Poll every few seconds while connecting WhatsApp.',
		displayOptions: show(['listPhoneNumberCodes']),
	},

	// ---- WhatsApp ----
	{
		displayName: 'Language',
		name: 'phoneWhatsappLanguage',
		type: 'options',
		options: LANGUAGES,
		default: 'en',
		description:
			'Language of the call Meta makes. Then open WhatsApp connect in the dashboard, add this number, choose Phone Call (not SMS) and read the code with Get Codes.',
		displayOptions: show(['preparePhoneNumberWhatsapp']),
	},

	// ---- Usage ----
	{
		displayName: 'From',
		name: 'phoneUsageFrom',
		type: 'string',
		default: '',
		placeholder: '2026-11-01T00:00:00Z',
		description: 'ISO date. Empty = start of the month.',
		displayOptions: show(['getPhoneNumbersUsage']),
	},
	{
		displayName: 'To',
		name: 'phoneUsageTo',
		type: 'string',
		default: '',
		placeholder: '2026-11-30T23:59:59Z',
		description: 'ISO date. Empty = now.',
		displayOptions: show(['getPhoneNumbersUsage']),
	},
];

const numberPath = (ctx: NetworkContext, suffix = '') =>
	`${P}/${encodeURIComponent(requireStr(ctx, 'phoneNumberId', 'Number ID'))}${suffix}`;

const country = (ctx: NetworkContext) => requireStr(ctx, 'phoneCountry', 'Country').toUpperCase();

const purchaseBody = (ctx: NetworkContext): IDataObject => {
	const purchaseIntentId = requireStr(ctx, 'phonePurchaseIntentId', 'Purchase Intent ID');
	if (purchaseIntentId.length < 8 || purchaseIntentId.length > 100) {
		fail(ctx, 'Purchase Intent ID must be 8 to 100 characters');
	}
	if (!bool(ctx, 'phoneAcceptTerms')) {
		fail(ctx, 'Turn on Accept Terms to buy a number (no emergency calls, acceptable use, porting and carrier data processing)');
	}
	const type = str(ctx, 'phoneEndUserType') || 'individual';
	const address: IDataObject = {
		street_address: requireStr(ctx, 'phoneEndUserStreet', 'Street Address'),
		locality: requireStr(ctx, 'phoneEndUserLocality', 'City (Address)'),
		postal_code: requireStr(ctx, 'phoneEndUserPostalCode', 'Postal Code'),
		country_code: requireStr(ctx, 'phoneEndUserCountryCode', 'Address Country').toUpperCase(),
	};
	putFilled(ctx, address, [['phoneEndUserExtendedAddress', 'extended_address'], ['phoneEndUserAdministrativeArea', 'administrative_area']]);
	const endUser: IDataObject = {
		type,
		first_name: requireStr(ctx, 'phoneEndUserFirstName', 'First Name'),
		last_name: requireStr(ctx, 'phoneEndUserLastName', 'Last Name'),
		phone: requireStr(ctx, 'phoneEndUserPhone', 'Contact Phone'),
	};
	if (type === 'business') endUser.business_name = requireStr(ctx, 'phoneEndUserBusinessName', 'Business Name');
	putFilled(ctx, endUser, [['phoneEndUserEmail', 'email']]);
	endUser.address = address;

	const body: IDataObject = {
		profile_username: requireStr(ctx, 'phoneProfile', 'Profile'),
		country: country(ctx),
		number_type: str(ctx, 'phoneNumberType') || 'local',
		purchase_intent_id: purchaseIntentId,
		end_user: endUser,
		accept_terms: true,
		terms_version: requireStr(ctx, 'phoneTermsVersion', 'Terms Version'),
	};
	putFilled(ctx, body, [['phoneNumberToBuy', 'phone_number'], ['phoneAreaCode', 'area_code']]);
	return body;
};

const kycDocuments = async (ctx: NetworkContext): Promise<IDataObject> => {
	const raw = param(ctx, 'phoneKycDocuments', {}) as { document?: Array<{ requirementId?: string; binaryProperty?: string }> };
	const documents: IDataObject = {};
	for (const entry of raw?.document ?? []) {
		const requirementId = String(entry.requirementId ?? '').trim();
		const property = String(entry.binaryProperty ?? '').trim() || 'data';
		if (!requirementId) fail(ctx, 'Each document needs its Requirement ID (from Get Identity Fields)');
		let content: string;
		try {
			const buffer = await ctx.node.helpers.getBinaryDataBuffer(ctx.itemIndex, property);
			content = buffer.toString('base64');
		} catch (error) {
			const message = error instanceof Error ? ` (${error.message})` : '';
			return fail(ctx, `Binary property '${property}' was not found in item ${ctx.itemIndex}${message}`);
		}
		const fileName = ctx.node.getInputData()[ctx.itemIndex]?.binary?.[property]?.fileName ?? `${requirementId}`;
		documents[requirementId] = { filename: fileName, content_base64: content };
	}
	return documents;
};

const voiceBody = (ctx: NetworkContext): IDataObject => {
	const settings = (param(ctx, 'phoneVoiceSettings', {}) ?? {}) as IDataObject;
	const body: IDataObject = {};
	if (settings.forwardingOff === true) {
		body.forward_to = null;
	} else if (typeof settings.forwardTo === 'string' && settings.forwardTo.trim()) {
		const target = settings.forwardTo.trim().replace(/\s+/g, '');
		body.forward_to = target.startsWith('tel:') ? target : `tel:${target}`;
	}
	for (const [name, field] of [
		['voicemailEnabled', 'voicemail_enabled'],
		['recordingEnabled', 'recording_enabled'],
		['transcriptionEnabled', 'transcription_enabled'],
	]) {
		if (typeof settings[name] === 'boolean') body[field] = settings[name];
	}
	if (typeof settings.voicemailGreeting === 'string' && settings.voicemailGreeting.trim()) {
		const greeting = settings.voicemailGreeting.trim();
		if (greeting.length > 500) fail(ctx, 'Voicemail Greeting is limited to 500 characters');
		body.voicemail_greeting = greeting;
	}
	if (typeof settings.transcriptionLanguage === 'string' && settings.transcriptionLanguage) {
		body.transcription_language = settings.transcriptionLanguage;
	}
	if (!Object.keys(body).length) fail(ctx, 'Nothing to update: add at least one Voice Setting');
	return body;
};

export const buildPhoneNumberRequest = async (
	node: IExecuteFunctions,
	itemIndex: number,
	operation: string,
): Promise<NetworkRequest> => {
	const ctx: NetworkContext = { node, itemIndex, operation };
	switch (operation) {
		case 'getPhoneNumbersConfig':
			return call('GET', `${P}/config`, {});
		case 'listPhoneNumberCountries':
			return call('GET', `${P}/countries`, {});
		case 'searchAvailablePhoneNumbers': {
			const qs: IDataObject = { country: country(ctx), number_type: str(ctx, 'phoneNumberType') || 'local' };
			putFilled(ctx, qs, [['phoneAreaCode', 'area_code'], ['phoneLocality', 'locality'], ['phoneContains', 'contains']]);
			if (bool(ctx, 'phoneSmsOnly')) qs.sms = 'true';
			const limit = Number(param(ctx, 'phoneSearchLimit', 20));
			if (Number.isInteger(limit) && limit >= 1 && limit <= 50) qs.limit = limit;
			return call('GET', `${P}/available`, qs);
		}
		case 'getPhoneNumberKycFields':
			return call('GET', `${P}/kyc`, { country: country(ctx), number_type: str(ctx, 'phoneNumberType') || 'local' });
		case 'purchasePhoneNumber':
			return call('POST', `${P}/purchase`, purchaseBody(ctx));
		case 'submitPhoneNumberKyc': {
			const body = purchaseBody(ctx);
			const values = jsonObjectParam(ctx, 'phoneKycValues', 'Identity Values (JSON)');
			if (Object.keys(values).length) body.values = values;
			const documents = await kycDocuments(ctx);
			if (Object.keys(documents).length) body.documents = documents;
			return call('POST', `${P}/kyc`, body);
		}
		case 'listPhoneNumbers': {
			const qs: IDataObject = {};
			putFilled(ctx, qs, [['phoneStatus', 'status'], ['phoneProfileFilter', 'profile_username']]);
			return call('GET', P, qs);
		}
		case 'getPhoneNumber':
			return call('GET', numberPath(ctx), {});
		case 'releasePhoneNumber': {
			const path = numberPath(ctx);
			if (!bool(ctx, 'phoneConfirmRelease')) {
				fail(ctx, 'Releasing a number is final: turn on Confirm Release to do it');
			}
			return call('DELETE', path, { confirm: 'true' });
		}
		case 'updatePhoneNumberVoice':
			return call('PATCH', numberPath(ctx, '/voice'), voiceBody(ctx));
		case 'sendPhoneNumberSms': {
			const text = requireStr(ctx, 'phoneSmsText', 'Text');
			if (text.length > 1600) fail(ctx, 'Text is limited to 1,600 characters');
			return call('POST', numberPath(ctx, '/sms'), { to: requireStr(ctx, 'phoneSmsTo', 'To'), text });
		}
		case 'listPhoneNumberMessages':
		case 'listPhoneNumberCalls': {
			const qs: IDataObject = {};
			const limit = Number(param(ctx, 'phoneListLimit', 50));
			if (Number.isInteger(limit) && limit >= 1 && limit <= 200) qs.limit = limit;
			putFilled(ctx, qs, [['phoneBefore', 'before']]);
			return call('GET', numberPath(ctx, operation === 'listPhoneNumberCalls' ? '/calls' : '/messages'), qs);
		}
		case 'listPhoneNumberCodes': {
			const qs: IDataObject = {};
			putFilled(ctx, qs, [['phoneSince', 'since']]);
			return call('GET', numberPath(ctx, '/codes'), qs);
		}
		case 'preparePhoneNumberWhatsapp':
			return call('POST', numberPath(ctx, '/whatsapp/prepare'), { language: str(ctx, 'phoneWhatsappLanguage') || 'en' });
		case 'getPhoneNumberPortOutInfo':
			return call('GET', numberPath(ctx, '/port-out'), {});
		case 'getPhoneNumbersUsage': {
			const qs: IDataObject = {};
			putFilled(ctx, qs, [['phoneUsageFrom', 'from'], ['phoneUsageTo', 'to']]);
			return call('GET', `${P}/usage`, qs);
		}
	}
	return fail(ctx, `Unsupported phone number operation: ${operation}`);
};

// Purchase and Submit Identity Documents answer 202 when the number is not
// active yet. The answer is returned as is, plus a next_step that says what to do.
export const withPhoneNumberNextStep = (operation: string, data: unknown): unknown => {
	if (!BUY_OPS.includes(operation) || !data || typeof data !== 'object' || Array.isArray(data)) return data;
	const status = (data as IDataObject).status;
	if (status === 'kyc_required') {
		return {
			...(data as IDataObject),
			next_step:
				'Identity documents needed; nothing was charged and no number was bought yet. Get the requirements with Get Identity Fields (same country and number type) and send them with Submit Identity Documents, with the same Purchase Intent ID and fields.',
		};
	}
	if (status === 'pending_regulatory') {
		return {
			...(data as IDataObject),
			next_step:
				'Paid; our carrier is reviewing the identity. The number becomes active (phone_number_activated webhook) or is declined and refunded (phone_number_declined webhook).',
		};
	}
	return data;
};
