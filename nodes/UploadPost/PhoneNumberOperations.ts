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
// see the usage, fix a declined identity review and share a KYC link with an end
// user. Not generally available yet: the API answers 403
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
const FIX_OP = 'remediatePhoneNumberKyc';
const REPLY_OP = 'replyPhoneNumberKycReviewer';
const LINK_OP = 'createPhoneNumberKycLink';
const NUMBER_OPS = [
	'getPhoneNumberKycRemediation',
	FIX_OP,
	REPLY_OP,
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
const COUNTRY_OPS = ['searchAvailablePhoneNumbers', 'getPhoneNumberKycFields', ...BUY_OPS, LINK_OP];
const KYC_LINK_LANGUAGES = [
	{ name: 'English', value: 'en' },
	{ name: 'Portuguese (Brazil)', value: 'pt-BR' },
	{ name: 'Spanish', value: 'es' },
];
// Consumers (individual end users) must ask to start at once within the 14-day withdrawal period.
const IMMEDIATE_START_CONSENT =
	'I ask Upload-Post to start providing this number now, within the 14-day withdrawal period. I understand that if I withdraw I will pay for the days already provided, and that I lose the right of withdrawal once the service has been fully provided.';
// A declined identity review keeps the payment: one text for every place that says it.
const DECLINED_TEXT =
	'If it is declined (phone_number_declined webhook) the payment is kept and the monthly charge paused: see why with Get Identity Review and fix it with Fix Identity Review (no second charge). 30 days without a fix, or releasing it, cancels and refunds it.';
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
			{ name: 'Create KYC Link', value: LINK_OP, action: 'Create a shareable kyc link for an end user', description: 'White-label page (no login, single use, 7 days) where your end user fills in the identity and documents for one number; the purchase is billed to your account' },
			{ name: 'Fix Identity Review', value: FIX_OP, action: 'Fix a declined identity review', description: 'Send only the corrected values, documents or end user address; the review is submitted again and nothing is charged again' },
			{ name: 'Get', value: 'getPhoneNumber', action: 'Get a phone number', description: 'One number with its status, price, call settings and flags' },
			{ name: 'Get Codes', value: 'listPhoneNumberCodes', action: 'Get the verification codes a phone number received', description: 'One-time codes (4-8 digits) found in the SMS and call transcripts of the last 30 minutes' },
			{ name: 'Get Config', value: 'getPhoneNumbersConfig', action: 'Get the phone numbers configuration', description: 'Whether this account can buy a number now (and why not), the current terms version and terms URL' },
			{ name: 'Get Identity Fields', value: 'getPhoneNumberKycFields', action: 'Get the identity fields a country needs', description: 'End-user fields and the documents our carrier needs for a country and number type' },
			{ name: 'Get Identity Review', value: 'getPhoneNumberKycRemediation', action: 'Get why the identity review of a phone number was declined', description: 'Review status, the requirements to fix (needs_fix), the fields to send again and the reviewer thread' },
			{ name: 'Get Port-Out Info', value: 'getPhoneNumberPortOutInfo', action: 'Get what the new carrier needs to port a number out', description: 'Name, address, account number and number to give the new carrier (account owner only)' },
			{ name: 'Get Usage', value: 'getPhoneNumbersUsage', action: 'Get the phone usage and charges', description: 'Billable usage with line items and totals in the account\'s billing currency, charged on the next subscription invoice' },
			{ name: 'List', value: 'listPhoneNumbers', action: 'List phone numbers', description: 'Numbers of the account (pending and active unless Status says otherwise)' },
			{ name: 'List Calls', value: 'listPhoneNumberCalls', action: 'List the calls of a phone number', description: 'Calls and voicemails newest first, with transcript and a recording link valid for 1 hour' },
			{ name: 'List Countries', value: 'listPhoneNumberCountries', action: 'List phone number countries and prices', description: 'Countries and number types on sale, cheapest first, with the real monthly price (it varies by country and type) in the account\'s billing currency and what they support' },
			{ name: 'List KYC Links', value: 'listPhoneNumberKycLinks', action: 'List the shareable kyc links', description: 'Your KYC links newest first, with their status (active, used, expired, revoked) and the number each one bought' },
			{ name: 'List Messages', value: 'listPhoneNumberMessages', action: 'List the sms of a phone number', description: 'Inbound and outbound SMS newest first' },
			{ name: 'Prepare WhatsApp Verification', value: 'preparePhoneNumberWhatsapp', action: 'Prepare a phone number for the whatsapp code', description: 'For 30 minutes calls are answered and transcribed so the code Meta reads out shows in Get Codes' },
			{ name: 'Purchase', value: 'purchasePhoneNumber', action: 'Buy a phone number', description: 'Buy a number for a profile. Charged on the account subscription; some countries first answer kyc_required.' },
			{ name: 'Release', value: 'releasePhoneNumber', action: 'Release a phone number', description: 'Give the number back. Final: needs Confirm Release.' },
			{ name: 'Reply to Reviewer', value: REPLY_OP, action: 'Reply to the identity reviewer of a phone number', description: 'Add a message, with optional files, to the reviewer thread of Get Identity Review' },
			{ name: 'Revoke KYC Link', value: 'revokePhoneNumberKycLink', action: 'Revoke a shareable kyc link', description: 'The link stops working at once (a link already used cannot be revoked: release the number instead)' },
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
		displayOptions: show([...BUY_OPS, LINK_OP]),
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
		displayOptions: show([...BUY_OPS, LINK_OP]),
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
		placeholder: '2026-11-28',
		description: 'The terms_version of Get Config (the version you accepted)',
		displayOptions: show(BUY_OPS),
	},
	{
		displayName: 'Immediate Start Consent',
		name: 'phoneImmediateStartConsent',
		type: 'boolean',
		default: false,
		description:
			`Whether the end user (a consumer) asks to start the service at once. Required for an individual (ignored for a business): "${IMMEDIATE_START_CONSENT}" Show this text to the end user and turn it on only if they accept. Without it the API answers 400 immediate_start_consent_required.`,
		displayOptions: show(BUY_OPS, { phoneEndUserType: ['individual'] }),
	},

	// ---- Identity documents ----
	{
		displayName: 'Identity Values (JSON)',
		name: 'phoneKycValues',
		type: 'json',
		default: '',
		description:
			'Text and date requirements of Get Identity Fields: {"requirement_id": "value"}. For Fix Identity Review only the corrected ones (needs_fix in Get Identity Review).',
		displayOptions: show(['submitPhoneNumberKyc', FIX_OP]),
	},
	{
		displayName: 'Documents',
		name: 'phoneKycDocuments',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		placeholder: 'Add Document',
		default: {},
		description: 'File requirements of Get Identity Fields, each from a binary property (PDF, JPG or PNG, up to 10 MB). For Fix Identity Review only the corrected ones. Documents go to our carrier and are not kept by Upload-Post.',
		displayOptions: show(['submitPhoneNumberKyc', FIX_OP]),
		options: [
			{
				displayName: 'Document',
				name: 'document',
				values: [
					{ displayName: 'Requirement ID', name: 'requirementId', type: 'string', default: '', description: 'The requirement_id of Get Identity Fields (or of Get Identity Review)' },
					{ displayName: 'Input Binary Field', name: 'binaryProperty', type: 'string', default: 'data', description: 'Binary property of the input item that holds the file' },
				],
			},
		],
	},

	// ---- Fix Identity Review ----
	{
		displayName:
			'A declined number keeps its payment and its monthly charge is paused. Send only what the reviewer declined (Get Identity Review: needs_fix): it is submitted again, the number goes back to pending_regulatory and nothing is charged again. 30 days without a fix, or releasing it, cancels and refunds it. 409 phone_number_remediation_in_progress (another correction is being sent) and 503 phone_numbers_capacity (a new order is not possible right now) keep the payment: try again later.',
		name: 'phoneFixNotice',
		type: 'notice',
		default: '',
		displayOptions: show([FIX_OP]),
	},
	{
		displayName: 'New End User',
		name: 'phoneFixEndUser',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		description:
			'Only to correct the end user or its address. The whole end user is sent again: fill type, first and last name, contact phone, street, city, postal code and address country (and business name for a business).',
		displayOptions: show([FIX_OP]),
		options: [
			{ displayName: 'Address Country', name: 'countryCode', type: 'string', default: '', placeholder: 'ES', description: 'ISO country code of the address' },
			{ displayName: 'Address Line 2', name: 'extendedAddress', type: 'string', default: '' },
			{ displayName: 'Business Name', name: 'businessName', type: 'string', default: '', description: 'Legal name of the business (business only)' },
			{ displayName: 'City (Address)', name: 'locality', type: 'string', default: '' },
			{ displayName: 'Contact Phone', name: 'phone', type: 'string', default: '', placeholder: '+34600111222', description: 'Contact phone of the end user in international format' },
			{ displayName: 'Email', name: 'email', type: 'string', placeholder: 'name@email.com', default: '' },
			{
				displayName: 'End User Type',
				name: 'type',
				type: 'options',
				options: [
					{ name: 'Business', value: 'business' },
					{ name: 'Individual', value: 'individual' },
				],
				default: 'individual',
			},
			{ displayName: 'First Name', name: 'firstName', type: 'string', default: '' },
			{ displayName: 'Last Name', name: 'lastName', type: 'string', default: '' },
			{ displayName: 'Postal Code', name: 'postalCode', type: 'string', default: '' },
			{ displayName: 'State / Region', name: 'administrativeArea', type: 'string', default: '' },
			{ displayName: 'Street Address', name: 'street', type: 'string', default: '' },
		],
	},
	{
		displayName: 'Replacement Phone Number',
		name: 'phoneFixReplacementNumber',
		type: 'string',
		default: '',
		placeholder: '+34911234567',
		description:
			'Only after 409 phone_number_unavailable (the number is gone): another number of the same country and type with no higher price, from Search Available. Send it with the corrections again. The payment is kept and nothing is charged again.',
		displayOptions: show([FIX_OP]),
	},

	// ---- Reply to Reviewer ----
	{
		displayName: 'Message',
		name: 'phoneReviewerText',
		type: 'string',
		typeOptions: { rows: 4 },
		required: true,
		default: '',
		description: 'Your answer to the reviewer (up to 2,000 characters). It shows in the thread of Get Identity Review.',
		displayOptions: show([REPLY_OP]),
	},
	{
		displayName: 'Attachments',
		name: 'phoneReviewerAttachments',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		placeholder: 'Add Attachment',
		default: {},
		description: 'Files for the reviewer, each from a binary property (PDF, JPG or PNG, up to 10 MB)',
		displayOptions: show([REPLY_OP]),
		options: [
			{
				displayName: 'Attachment',
				name: 'attachment',
				values: [
					{ displayName: 'Input Binary Field', name: 'binaryProperty', type: 'string', default: 'data', description: 'Binary property of the input item that holds the file' },
				],
			},
		],
	},

	// ---- KYC links ----
	{
		displayName:
			'Your end user opens the link (no login, single use, valid 7 days), fills in the identity and documents and accepts the phone number terms. The purchase is billed to your account (paid plan, checked now and when the page is submitted). Then the page sends them to Redirect URL with ?kyc=submitted&country=XX. At most 20 active links.',
		name: 'phoneKycLinkNotice',
		type: 'notice',
		default: '',
		displayOptions: show([LINK_OP]),
	},
	{
		displayName: 'Redirect URL',
		name: 'phoneKycLinkRedirectUrl',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'https://example.com/done',
		description: 'HTTPS page the end user goes to after submitting (with ?kyc=submitted&country=XX)',
		displayOptions: show([LINK_OP]),
	},
	{
		displayName: 'Page Language',
		name: 'phoneKycLinkLanguage',
		type: 'options',
		options: KYC_LINK_LANGUAGES,
		default: 'en',
		displayOptions: show([LINK_OP]),
	},
	{
		displayName: 'Branding',
		name: 'phoneKycLinkBranding',
		type: 'collection',
		placeholder: 'Add Branding',
		default: {},
		description: 'Your brand on the page (it never shows Upload-Post account details)',
		displayOptions: show([LINK_OP]),
		options: [
			{ displayName: 'Brand Color', name: 'brandColor', type: 'color', default: '#4F46E5', description: 'Hex color #RRGGBB' },
			{ displayName: 'Company Name', name: 'companyName', type: 'string', default: '', description: 'Up to 80 characters' },
			{ displayName: 'Logo URL', name: 'logoUrl', type: 'string', default: '', placeholder: 'https://example.com/logo.png', description: 'HTTPS image URL' },
		],
	},
	{
		displayName: 'Link ID',
		name: 'phoneKycLinkId',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'kl_3f9c0a1b2c3d4e5f6a7b8c9d',
		description: 'The ID of the link (kl_…) from Create KYC Link or List KYC Links, not the token',
		displayOptions: show(['revokePhoneNumberKycLink']),
	},

	// ---- Release ----
	{
		displayName: 'Confirm Release',
		name: 'phoneConfirmRelease',
		type: 'boolean',
		default: false,
		description:
			'Whether you confirm the release. It is final: WhatsApp and anything else using the number stop working, our carrier may give the number to someone else later, and the monthly charge stops (no proration). A number declined by the identity review is cancelled and refunded instead. Without it nothing is sent.',
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
	if (type === 'individual' && !bool(ctx, 'phoneImmediateStartConsent')) {
		fail(
			ctx,
			`An individual end user must give the Immediate Start Consent (otherwise 400 immediate_start_consent_required). Show them this text and turn it on only if they accept: "${IMMEDIATE_START_CONSENT}"`,
		);
	}
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
	if (type === 'individual') body.immediate_start_consent = true;
	putFilled(ctx, body, [['phoneNumberToBuy', 'phone_number'], ['phoneAreaCode', 'area_code']]);
	return body;
};

// A file of the input item as {filename, content_base64}, the JSON form of the API.
const binaryFile = async (ctx: NetworkContext, rawProperty: unknown, fallbackName: string): Promise<IDataObject> => {
	const property = String(rawProperty ?? '').trim() || 'data';
	let content: string;
	try {
		const buffer = await ctx.node.helpers.getBinaryDataBuffer(ctx.itemIndex, property);
		content = buffer.toString('base64');
	} catch (error) {
		const message = error instanceof Error ? ` (${error.message})` : '';
		return fail(ctx, `Binary property '${property}' was not found in item ${ctx.itemIndex}${message}`);
	}
	const fileName = ctx.node.getInputData()[ctx.itemIndex]?.binary?.[property]?.fileName ?? fallbackName;
	return { filename: fileName, content_base64: content };
};

const kycDocuments = async (ctx: NetworkContext): Promise<IDataObject> => {
	const raw = param(ctx, 'phoneKycDocuments', {}) as { document?: Array<{ requirementId?: string; binaryProperty?: string }> };
	const documents: IDataObject = {};
	for (const entry of raw?.document ?? []) {
		const requirementId = String(entry.requirementId ?? '').trim();
		if (!requirementId) fail(ctx, 'Each document needs its Requirement ID (from Get Identity Fields or Get Identity Review)');
		documents[requirementId] = await binaryFile(ctx, entry.binaryProperty, requirementId);
	}
	return documents;
};

// Fix Identity Review: the end user goes whole (the API validates it as on a purchase).
const fixEndUser = (ctx: NetworkContext): IDataObject | undefined => {
	const raw = (param(ctx, 'phoneFixEndUser', {}) ?? {}) as IDataObject;
	const get = (name: string) => (typeof raw[name] === 'string' ? (raw[name] as string).trim() : '');
	const filled = Object.keys(raw).filter((name) => name !== 'type' && get(name));
	if (!filled.length) return undefined;
	const need = (name: string, label: string) => get(name) || fail(ctx, `New End User needs ${label} (the whole end user is sent again)`);
	const type = get('type') || 'individual';
	const address: IDataObject = {
		street_address: need('street', 'Street Address'),
		locality: need('locality', 'City (Address)'),
		postal_code: need('postalCode', 'Postal Code'),
		country_code: need('countryCode', 'Address Country').toUpperCase(),
	};
	if (get('extendedAddress')) address.extended_address = get('extendedAddress');
	if (get('administrativeArea')) address.administrative_area = get('administrativeArea');
	const endUser: IDataObject = {
		type,
		first_name: need('firstName', 'First Name'),
		last_name: need('lastName', 'Last Name'),
		phone: need('phone', 'Contact Phone'),
	};
	if (type === 'business') endUser.business_name = need('businessName', 'Business Name');
	if (get('email')) endUser.email = get('email');
	endUser.address = address;
	return endUser;
};

const fixBody = async (ctx: NetworkContext): Promise<IDataObject> => {
	const body: IDataObject = {};
	const values = jsonObjectParam(ctx, 'phoneKycValues', 'Identity Values (JSON)');
	if (Object.keys(values).length) body.values = values;
	const documents = await kycDocuments(ctx);
	if (Object.keys(documents).length) body.documents = documents;
	const endUser = fixEndUser(ctx);
	if (endUser) body.end_user = endUser;
	if (!Object.keys(body).length) {
		fail(ctx, 'Nothing to fix: add the corrected Identity Values, Documents or New End User (see needs_fix in Get Identity Review)');
	}
	putFilled(ctx, body, [['phoneFixReplacementNumber', 'phone_number']]);
	return body;
};

const replyBody = async (ctx: NetworkContext): Promise<IDataObject> => {
	const text = requireStr(ctx, 'phoneReviewerText', 'Message');
	if (text.length > 2000) fail(ctx, 'Message is limited to 2,000 characters');
	const raw = param(ctx, 'phoneReviewerAttachments', {}) as { attachment?: Array<{ binaryProperty?: string }> };
	const attachments: IDataObject[] = [];
	for (const entry of raw?.attachment ?? []) {
		attachments.push(await binaryFile(ctx, entry.binaryProperty, `attachment-${attachments.length + 1}`));
	}
	return attachments.length ? { text, attachments } : { text };
};

const httpsUrl = (ctx: NetworkContext, value: string, label: string): string => {
	if (!/^https:\/\/\S+$/i.test(value)) fail(ctx, `${label} must be an https:// URL`);
	return value;
};

const kycLinkBody = (ctx: NetworkContext): IDataObject => {
	const body: IDataObject = {
		profile_username: requireStr(ctx, 'phoneProfile', 'Profile'),
		country: country(ctx),
		number_type: str(ctx, 'phoneNumberType') || 'local',
		redirect_url: httpsUrl(ctx, requireStr(ctx, 'phoneKycLinkRedirectUrl', 'Redirect URL'), 'Redirect URL'),
		language: str(ctx, 'phoneKycLinkLanguage') || 'en',
	};
	putFilled(ctx, body, [['phoneNumberToBuy', 'phone_number']]);
	const raw = (param(ctx, 'phoneKycLinkBranding', {}) ?? {}) as IDataObject;
	const get = (name: string) => (typeof raw[name] === 'string' ? (raw[name] as string).trim() : '');
	const branding: IDataObject = {};
	if (get('companyName')) {
		if (get('companyName').length > 80) fail(ctx, 'Company Name is limited to 80 characters');
		branding.company_name = get('companyName');
	}
	if (get('logoUrl')) branding.logo_url = httpsUrl(ctx, get('logoUrl'), 'Logo URL');
	if (get('brandColor')) {
		if (!/^#[0-9a-f]{6}$/i.test(get('brandColor'))) fail(ctx, 'Brand Color must be a hex color like #4F46E5');
		branding.brand_color = get('brandColor');
	}
	if (Object.keys(branding).length) body.branding = branding;
	return body;
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
		case 'getPhoneNumberKycRemediation':
			return call('GET', numberPath(ctx, '/remediate'), {});
		case FIX_OP: {
			const path = numberPath(ctx, '/remediate');
			// 409 phone_number_unavailable is an answer, not a failure: the payment is kept.
			return { ...call('POST', path, await fixBody(ctx)), answerErrors: ['phone_number_unavailable'] };
		}
		case REPLY_OP: {
			const path = numberPath(ctx, '/remediate/reply');
			return call('POST', path, await replyBody(ctx));
		}
		case LINK_OP:
			return call('POST', `${P}/kyc/share`, kycLinkBody(ctx));
		case 'listPhoneNumberKycLinks':
			return call('GET', `${P}/kyc/share`, {});
		case 'revokePhoneNumberKycLink':
			return call('DELETE', `${P}/kyc/share/${encodeURIComponent(requireStr(ctx, 'phoneKycLinkId', 'Link ID'))}`, {});
	}
	return fail(ctx, `Unsupported phone number operation: ${operation}`);
};

// Purchase and Submit Identity Documents answer 202 when the number is not
// active yet; Get / Fix Identity Review answer about a declined review. The answer
// is returned as is, plus a next_step that says what to do.
const withNextStep = (data: IDataObject, next_step: string): IDataObject => ({ ...data, next_step });

export const withPhoneNumberNextStep = (operation: string, data: unknown): unknown => {
	if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
	const answer = data as IDataObject;
	if (operation === FIX_OP) {
		if (answer.error_code === 'phone_number_unavailable') {
			return withNextStep(
				answer,
				'Your payment is kept and nothing was charged again, but this number is no longer available. Pick another number of the same country and type with the same or a lower price (Search Available) and run Fix Identity Review again with the same corrections and that number in Replacement Phone Number.',
			);
		}
		if (answer.status === 'pending_regulatory') {
			const unknown =
				answer.order === 'order_unknown'
					? ' Our carrier did not confirm the new order in time: it is resolved automatically, do not send it again (no second order).'
					: '';
			return withNextStep(
				answer,
				`Corrections sent; nothing was charged again. Our carrier reviews the identity again (phone_number_kyc_resubmitted webhook). On approval the number becomes active and the monthly charge resumes (phone_number_activated); if it is declined again, fix it again with Fix Identity Review. Reviewer messages arrive as phone_number_kyc_comment.${unknown}`,
			);
		}
		return data;
	}
	if (operation === 'getPhoneNumberKycRemediation' || operation === 'getPhoneNumber') {
		const number = answer.phone_number as IDataObject | undefined;
		if (number && number.status === 'regulatory_declined') {
			// remediation_deadline_at = declined_at + 30 days; after it the purchase is cancelled and refunded.
			const deadline = typeof number.remediation_deadline_at === 'string' && number.remediation_deadline_at ? number.remediation_deadline_at : '';
			const until = deadline
				? `Fix it before ${deadline} (remediation_deadline_at): after that, or if you release the number, the purchase is cancelled and refunded.`
				: '30 days without a fix, or releasing the number, cancels and refunds it.';
			const how =
				operation === 'getPhoneNumber'
					? 'See what was declined with Get Identity Review and send only those requirements with Fix Identity Review.'
					: 'Send only the requirements with needs_fix (and a new address if it was declined) with Fix Identity Review; ask the reviewer with Reply to Reviewer.';
			return withNextStep(answer, `Declined: the payment is kept and the monthly charge is paused. ${how} ${until}`);
		}
		return data;
	}
	if (!BUY_OPS.includes(operation)) return data;
	const status = answer.status;
	if (status === 'kyc_required') {
		return withNextStep(
			answer,
			'Identity documents needed; nothing was charged and no number was bought yet. Get the requirements with Get Identity Fields (same country and number type) and send them with Submit Identity Documents, with the same Purchase Intent ID and fields.',
		);
	}
	if (status === 'pending_payment') {
		return withNextStep(
			answer,
			'Paid; the order with our carrier is still being confirmed. Use Get in a minute and do not buy again: the same Purchase Intent ID returns the same number. It ends active (phone_number_activated webhook) or failed with the charge refunded, within about 15 minutes.',
		);
	}
	if (status === 'pending_regulatory') {
		return withNextStep(answer, `Paid; our carrier is reviewing the identity. The number becomes active (phone_number_activated webhook). ${DECLINED_TEXT}`);
	}
	return data;
};
