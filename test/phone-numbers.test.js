// Runs the compiled node's execute() for the Phone Number operations and checks
// the HTTP request each one sends, plus the next_step added to 202 answers.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const { UploadPost } = require(path.join(root, 'dist/nodes/UploadPost/UploadPost.node.js'));

const run = async (params, { response = { success: true }, binary } = {}) => {
	const calls = [];
	const ctx = {
		getInputData: () => [{ json: {}, binary }],
		getNodeParameter: (name, _itemIndex, fallback) => {
			if (Object.prototype.hasOwnProperty.call(params, name)) return params[name];
			if (fallback !== undefined) return fallback;
			throw new Error(`missing parameter ${name}`);
		},
		getNode: () => ({ id: 'node-1', name: 'Upload Post', type: 'uploadPost', typeVersion: 1 }),
		getExecutionId: () => 'exec-1',
		helpers: {
			httpRequestWithAuthentication: async (_credential, options) => {
				calls.push(options);
				return response;
			},
			getBinaryDataBuffer: async (_itemIndex, property) => {
				if (!binary || !binary[property]) throw new Error('no binary');
				return Buffer.from(binary[property].content);
			},
		},
	};
	const [items] = await new UploadPost().execute.call(ctx);
	assert.equal(calls.length, 1);
	return { req: calls[0], out: items[0].json };
};

const API = 'https://api.upload-post.com/api/uploadposts/phone-numbers';
const phone = (operation, extra = {}, opts) => run({ resource: 'phoneNumbers', operation, ...extra }, opts);
const N = { phoneNumberId: 'pn_abc123' };

const BUYER = {
	phoneProfile: 'acme',
	phoneCountry: 'es',
	phoneNumberType: 'mobile',
	phonePurchaseIntentId: 'n8n-exec-1-0',
	phoneEndUserType: 'individual',
	phoneEndUserFirstName: 'Ana',
	phoneEndUserLastName: 'García',
	phoneEndUserPhone: '+34600111222',
	phoneEndUserStreet: 'Calle Mayor 1',
	phoneEndUserLocality: 'Madrid',
	phoneEndUserPostalCode: '28013',
	phoneEndUserCountryCode: 'es',
	phoneAcceptTerms: true,
	phoneTermsVersion: '2026-11-28',
	phoneImmediateStartConsent: true,
};

test('config, countries and usage need no number', async () => {
	assert.equal((await phone('getPhoneNumbersConfig')).req.url, `${API}/config`);
	const countries = (await phone('listPhoneNumberCountries')).req;
	assert.equal(countries.method, 'GET');
	assert.equal(countries.url, `${API}/countries`);
	const usage = (await phone('getPhoneNumbersUsage', { phoneUsageFrom: '2026-11-01T00:00:00Z' })).req;
	assert.equal(usage.url, `${API}/usage`);
	assert.deepEqual(usage.qs, { from: '2026-11-01T00:00:00Z' });
});

test('search sends country in capitals, type, filters and limit', async () => {
	const { req } = await phone('searchAvailablePhoneNumbers', {
		phoneCountry: 'us', phoneAreaCode: '212', phoneContains: '77', phoneSmsOnly: true, phoneSearchLimit: 5,
	});
	assert.equal(req.url, `${API}/available`);
	assert.deepEqual(req.qs, { country: 'US', number_type: 'local', area_code: '212', contains: '77', sms: 'true', limit: 5 });
	await assert.rejects(phone('searchAvailablePhoneNumbers'), /Country is required/);
});

test('purchase sends the documented body with end_user and the terms', async () => {
	const { req } = await phone('purchasePhoneNumber', { ...BUYER, phoneAreaCode: '91', phoneEndUserEmail: 'ana@example.com' });
	assert.equal(req.method, 'POST');
	assert.equal(req.url, `${API}/purchase`);
	assert.deepEqual(req.body, {
		profile_username: 'acme',
		country: 'ES',
		number_type: 'mobile',
		purchase_intent_id: 'n8n-exec-1-0',
		area_code: '91',
		accept_terms: true,
		terms_version: '2026-11-28',
		immediate_start_consent: true,
		end_user: {
			type: 'individual',
			first_name: 'Ana',
			last_name: 'García',
			phone: '+34600111222',
			email: 'ana@example.com',
			address: { street_address: 'Calle Mayor 1', locality: 'Madrid', postal_code: '28013', country_code: 'ES' },
		},
	});
});

test('purchase refuses without terms, with a short intent id, and a business without its name', async () => {
	await assert.rejects(phone('purchasePhoneNumber', { ...BUYER, phoneAcceptTerms: false }), /Accept Terms/);
	await assert.rejects(phone('purchasePhoneNumber', { ...BUYER, phonePurchaseIntentId: 'abc' }), /8 to 100 characters/);
	await assert.rejects(phone('purchasePhoneNumber', { ...BUYER, phoneEndUserType: 'business' }), /Business Name is required/);
	const { req } = await phone('purchasePhoneNumber', { ...BUYER, phoneEndUserType: 'business', phoneEndUserBusinessName: 'Acme SL' });
	assert.equal(req.body.end_user.business_name, 'Acme SL');
});

test('the default purchase intent id is unique per execution and item', () => {
	const prop = new UploadPost().description.properties.find((p) => p.name === 'phonePurchaseIntentId');
	assert.match(prop.default, /\$execution\.id/);
	assert.match(prop.default, /\$itemIndex/);
});

test('a 202 kyc_required answer comes back with a next_step and nothing else changed', async () => {
	const response = { success: true, status: 'kyc_required', purchase_intent_id: 'n8n-exec-1-0', fields_url: '/api/uploadposts/phone-numbers/kyc?country=DE' };
	const { out } = await phone('purchasePhoneNumber', BUYER, { response });
	assert.equal(out.status, 'kyc_required');
	assert.equal(out.fields_url, response.fields_url);
	assert.match(out.next_step, /nothing was charged/);
	assert.match(out.next_step, /Submit Identity Documents/);
	const pending = await phone('purchasePhoneNumber', BUYER, { response: { success: true, status: 'pending_regulatory' } });
	assert.match(pending.out.next_step, /phone_number_activated/);
	const paying = await phone('submitPhoneNumberKyc', BUYER, { response: { success: true, status: 'pending_payment' } });
	assert.equal(paying.out.status, 'pending_payment');
	assert.match(paying.out.next_step, /do not buy again/);
	assert.match(paying.out.next_step, /same Purchase Intent ID/);
	const active = await phone('purchasePhoneNumber', BUYER, { response: { success: true, status: 'active' } });
	assert.equal(active.out.next_step, undefined);
	// Other operations are returned untouched.
	const list = await phone('listPhoneNumbers', {}, { response: { success: true, status: 'kyc_required' } });
	assert.equal(list.out.next_step, undefined);
});

test('identity fields and identity documents (values plus base64 files)', async () => {
	const fields = (await phone('getPhoneNumberKycFields', { phoneCountry: 'de' })).req;
	assert.equal(fields.url, `${API}/kyc`);
	assert.deepEqual(fields.qs, { country: 'DE', number_type: 'local' });

	const { req } = await phone(
		'submitPhoneNumberKyc',
		{
			...BUYER,
			phoneKycValues: '{"req_tax": "B12345678"}',
			phoneKycDocuments: { document: [{ requirementId: 'req_id', binaryProperty: 'passport' }] },
		},
		{ binary: { passport: { content: 'PDFDATA', fileName: 'passport.pdf', mimeType: 'application/pdf' } } },
	);
	assert.equal(req.method, 'POST');
	assert.equal(req.url, `${API}/kyc`);
	assert.equal(req.body.purchase_intent_id, 'n8n-exec-1-0');
	assert.deepEqual(req.body.values, { req_tax: 'B12345678' });
	assert.deepEqual(req.body.documents, { req_id: { filename: 'passport.pdf', content_base64: Buffer.from('PDFDATA').toString('base64') } });
	await assert.rejects(
		phone('submitPhoneNumberKyc', { ...BUYER, phoneKycDocuments: { document: [{ requirementId: 'req_id', binaryProperty: 'missing' }] } }),
		/'missing' was not found/,
	);
});

test('list and get', async () => {
	const list = (await phone('listPhoneNumbers', { phoneStatus: 'active', phoneProfileFilter: 'acme' })).req;
	assert.equal(list.url, API);
	assert.deepEqual(list.qs, { status: 'active', profile_username: 'acme' });
	assert.deepEqual((await phone('listPhoneNumbers')).req.qs, {});
	const get = (await phone('getPhoneNumber', N)).req;
	assert.equal(get.url, `${API}/pn_abc123`);
	await assert.rejects(phone('getPhoneNumber'), /Number ID is required/);
});

test('release needs Confirm Release and sends confirm=true', async () => {
	await assert.rejects(phone('releasePhoneNumber', N), /Confirm Release/);
	const { req } = await phone('releasePhoneNumber', { ...N, phoneConfirmRelease: true });
	assert.equal(req.method, 'DELETE');
	assert.equal(req.url, `${API}/pn_abc123`);
	assert.deepEqual(req.qs, { confirm: 'true' });
});

test('voice settings send only what was added; forwarding gets tel: and can be turned off', async () => {
	const { req } = await phone('updatePhoneNumberVoice', {
		...N,
		phoneVoiceSettings: { forwardTo: '+34 600 111 222', voicemailEnabled: false, transcriptionLanguage: 'es' },
	});
	assert.equal(req.method, 'PATCH');
	assert.equal(req.url, `${API}/pn_abc123/voice`);
	assert.deepEqual(req.body, { forward_to: 'tel:+34600111222', voicemail_enabled: false, transcription_language: 'es' });
	const off = (await phone('updatePhoneNumberVoice', { ...N, phoneVoiceSettings: { forwardingOff: true, forwardTo: '+1' } })).req;
	assert.deepEqual(off.body, { forward_to: null });
	await assert.rejects(phone('updatePhoneNumberVoice', { ...N, phoneVoiceSettings: {} }), /Nothing to update/);
	await assert.rejects(
		phone('updatePhoneNumberVoice', { ...N, phoneVoiceSettings: { voicemailGreeting: 'x'.repeat(501) } }),
		/500 characters/,
	);
});

test('send SMS, messages, calls and codes', async () => {
	const sms = (await phone('sendPhoneNumberSms', { ...N, phoneSmsTo: '+34600111222', phoneSmsText: 'Hi' })).req;
	assert.equal(sms.method, 'POST');
	assert.equal(sms.url, `${API}/pn_abc123/sms`);
	assert.deepEqual(sms.body, { to: '+34600111222', text: 'Hi' });
	await assert.rejects(phone('sendPhoneNumberSms', { ...N, phoneSmsTo: '+1', phoneSmsText: 'x'.repeat(1601) }), /1,600/);

	const messages = (await phone('listPhoneNumberMessages', { ...N, phoneBefore: '2026-11-27T10:00:00Z' })).req;
	assert.equal(messages.url, `${API}/pn_abc123/messages`);
	assert.deepEqual(messages.qs, { limit: 50, before: '2026-11-27T10:00:00Z' });
	const calls = (await phone('listPhoneNumberCalls', { ...N, phoneListLimit: 10 })).req;
	assert.equal(calls.url, `${API}/pn_abc123/calls`);
	assert.deepEqual(calls.qs, { limit: 10 });
	const codes = (await phone('listPhoneNumberCodes', { ...N, phoneSince: '2026-11-27T10:00:00Z' })).req;
	assert.equal(codes.url, `${API}/pn_abc123/codes`);
	assert.deepEqual(codes.qs, { since: '2026-11-27T10:00:00Z' });
});

test('WhatsApp verification and port-out', async () => {
	const prepare = (await phone('preparePhoneNumberWhatsapp', { ...N, phoneWhatsappLanguage: 'es' })).req;
	assert.equal(prepare.method, 'POST');
	assert.equal(prepare.url, `${API}/pn_abc123/whatsapp/prepare`);
	assert.deepEqual(prepare.body, { language: 'es' });
	const portOut = (await phone('getPhoneNumberPortOutInfo', N)).req;
	assert.equal(portOut.method, 'GET');
	assert.equal(portOut.url, `${API}/pn_abc123/port-out`);
});

test('the resource is offered with its 23 operations', async () => {
	const props = new UploadPost().description.properties;
	assert.ok(props.find((p) => p.name === 'resource').options.some((o) => o.value === 'phoneNumbers'));
	const ops = props.find((p) => p.name === 'operation' && p.displayOptions?.show?.resource?.includes('phoneNumbers')).options;
	assert.equal(ops.length, 23);
});

test('public texts never name an internal switch', () => {
	const texts = [
		'nodes/UploadPost/PhoneNumberOperations.ts',
		'nodes/UploadPostTrigger/UploadPostTrigger.node.ts',
		'README.md',
		'CHANGELOG.md',
		'AGENTS.md',
	].map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
	assert.doesNotMatch(texts, /PHONE_[A-Z_]+|[A-Z]+_ALLOWLIST|UPLOADPOSTS_[A-Z_]+/);
});
