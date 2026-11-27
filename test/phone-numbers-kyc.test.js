// Phone numbers round 2: a declined identity review is fixed (the payment is
// kept), the reviewer thread, and shareable KYC links. Runs the compiled node's
// execute() and checks the HTTP request of each operation and the next_step.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const { UploadPost } = require(path.join(root, 'dist/nodes/UploadPost/UploadPost.node.js'));
const { UploadPostTrigger } = require(path.join(root, 'dist/nodes/UploadPostTrigger/UploadPostTrigger.node.js'));

// `response` is what the API answers; with returnFullResponse it is wrapped as
// {statusCode, body} like n8n does.
const run = async (params, { response = { success: true }, statusCode = 200, binary } = {}) => {
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
				if (options.returnFullResponse) return { statusCode, headers: {}, body: response };
				if (statusCode >= 400) throw new Error(`HTTP ${statusCode}`);
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
const b64 = (text) => Buffer.from(text).toString('base64');

// ---------------------------------------------------------------- Get Identity Review

test('get identity review reads /remediate and explains a declined number', async () => {
	const response = {
		success: true,
		phone_number: { id: 'pn_abc123', status: 'regulatory_declined' },
		group_status: 'declined',
		requirements: [{ requirement_id: 'req_id', kind: 'file', status: 'declined', needs_fix: true }],
		comments: [],
	};
	const { req, out } = await phone('getPhoneNumberKycRemediation', N, { response });
	assert.equal(req.method, 'GET');
	assert.equal(req.url, `${API}/pn_abc123/remediate`);
	assert.equal(out.group_status, 'declined');
	assert.match(out.next_step, /payment is kept/);
	assert.match(out.next_step, /monthly charge is paused/);
	assert.match(out.next_step, /Fix Identity Review/);
	assert.match(out.next_step, /30 days/);
	const reviewing = await phone('getPhoneNumberKycRemediation', N, {
		response: { success: true, phone_number: { id: 'pn_abc123', status: 'pending_regulatory' } },
	});
	assert.equal(reviewing.out.next_step, undefined);
	await assert.rejects(phone('getPhoneNumberKycRemediation'), /Number ID is required/);
});

// ---------------------------------------------------------------- Fix Identity Review

test('fix identity review sends only the corrected values and documents', async () => {
	const { req, out } = await phone(
		'remediatePhoneNumberKyc',
		{
			...N,
			phoneKycValues: '{"req_tax": "B12345678"}',
			phoneKycDocuments: { document: [{ requirementId: 'req_id', binaryProperty: 'passport' }] },
		},
		{
			binary: { passport: { content: 'PDFDATA', fileName: 'passport.pdf', mimeType: 'application/pdf' } },
			response: { success: true, status: 'pending_regulatory', order: 'same_order' },
		},
	);
	assert.equal(req.method, 'POST');
	assert.equal(req.url, `${API}/pn_abc123/remediate`);
	assert.deepEqual(req.body, {
		values: { req_tax: 'B12345678' },
		documents: { req_id: { filename: 'passport.pdf', content_base64: b64('PDFDATA') } },
	});
	assert.equal(req.json, true);
	assert.equal(out.status, 'pending_regulatory');
	assert.equal(out.order, 'same_order');
	assert.match(out.next_step, /nothing was charged again/);
	assert.match(out.next_step, /phone_number_kyc_resubmitted/);
});

test('fix identity review sends the whole new end user and the replacement number', async () => {
	const { req } = await phone('remediatePhoneNumberKyc', {
		...N,
		phoneFixEndUser: {
			type: 'business',
			firstName: 'Ana',
			lastName: 'García',
			businessName: 'Acme SL',
			phone: '+34600111222',
			street: 'Calle Nueva 2',
			locality: 'Madrid',
			postalCode: '28014',
			countryCode: 'es',
			administrativeArea: 'Madrid',
		},
		phoneFixReplacementNumber: '+34911000000',
	});
	assert.deepEqual(req.body, {
		end_user: {
			type: 'business',
			first_name: 'Ana',
			last_name: 'García',
			phone: '+34600111222',
			business_name: 'Acme SL',
			address: {
				street_address: 'Calle Nueva 2',
				locality: 'Madrid',
				postal_code: '28014',
				country_code: 'ES',
				administrative_area: 'Madrid',
			},
		},
		phone_number: '+34911000000',
	});
});

test('fix identity review refuses an empty fix, a replacement number alone and a partial end user', async () => {
	await assert.rejects(phone('remediatePhoneNumberKyc', N), /Nothing to fix/);
	await assert.rejects(phone('remediatePhoneNumberKyc', { ...N, phoneFixReplacementNumber: '+34911000000' }), /Nothing to fix/);
	await assert.rejects(
		phone('remediatePhoneNumberKyc', { ...N, phoneFixEndUser: { street: 'Calle Nueva 2' } }),
		/New End User needs .*whole end user/,
	);
	await assert.rejects(phone('remediatePhoneNumberKyc', { phoneKycValues: '{"a": "b"}' }), /Number ID is required/);
});

test('409 phone_number_unavailable comes back as the item with keeps_payment and a next_step', async () => {
	const response = {
		success: false,
		error_code: 'phone_number_unavailable',
		keeps_payment: true,
		message: 'That number is no longer available.',
	};
	const { req, out } = await phone('remediatePhoneNumberKyc', { ...N, phoneKycValues: '{"req_tax": "B1"}' }, { response, statusCode: 409 });
	assert.equal(req.returnFullResponse, true);
	assert.equal(req.ignoreHttpStatusErrors, true);
	assert.equal(out.error_code, 'phone_number_unavailable');
	assert.equal(out.keeps_payment, true);
	assert.equal(out.http_status, 409);
	assert.match(out.next_step, /payment is kept/);
	assert.match(out.next_step, /Replacement Phone Number/);
	assert.match(out.next_step, /same or a lower price/);
});

test('other Fix Identity Review errors still fail the node', async () => {
	for (const [statusCode, code] of [
		[409, 'phone_number_not_remediable'],
		[409, 'phone_numbers_type_not_offered'],
		[400, 'phone_numbers_kyc_invalid'],
		[502, 'phone_numbers_carrier_error'],
	]) {
		await assert.rejects(
			phone('remediatePhoneNumberKyc', { ...N, phoneKycValues: '{"req_tax": "B1"}' }, {
				response: { success: false, error_code: code, message: code },
				statusCode,
			}),
			(error) => error.httpCode === String(statusCode),
			code,
		);
	}
	// Only Fix Identity Review asks for the full response.
	const { req } = await phone('getPhoneNumberKycRemediation', N);
	assert.equal(req.returnFullResponse, undefined);
});

// ---------------------------------------------------------------- Reply to Reviewer

test('reply to reviewer sends the text and the attachments as base64', async () => {
	const { req } = await phone(
		'replyPhoneNumberKycReviewer',
		{ ...N, phoneReviewerText: 'Here is the new bill', phoneReviewerAttachments: { attachment: [{ binaryProperty: 'bill' }, { binaryProperty: 'data' }] } },
		{ binary: { bill: { content: 'BILL', fileName: 'bill.pdf' }, data: { content: 'IMG' } } },
	);
	assert.equal(req.method, 'POST');
	assert.equal(req.url, `${API}/pn_abc123/remediate/reply`);
	assert.deepEqual(req.body, {
		text: 'Here is the new bill',
		attachments: [
			{ filename: 'bill.pdf', content_base64: b64('BILL') },
			{ filename: 'attachment-2', content_base64: b64('IMG') },
		],
	});
	const plain = (await phone('replyPhoneNumberKycReviewer', { ...N, phoneReviewerText: 'Done' })).req;
	assert.deepEqual(plain.body, { text: 'Done' });
	await assert.rejects(phone('replyPhoneNumberKycReviewer', { ...N, phoneReviewerText: 'x'.repeat(2001) }), /2,000/);
	await assert.rejects(phone('replyPhoneNumberKycReviewer', N), /Message is required/);
	await assert.rejects(
		phone('replyPhoneNumberKycReviewer', { ...N, phoneReviewerText: 'Hi', phoneReviewerAttachments: { attachment: [{ binaryProperty: 'gone' }] } }),
		/'gone' was not found/,
	);
});

// ---------------------------------------------------------------- KYC links

const LINK = {
	phoneProfile: 'client-a',
	phoneCountry: 'es',
	phoneNumberType: 'local',
	phoneKycLinkRedirectUrl: 'https://example.com/done',
	phoneKycLinkLanguage: 'es',
};

test('create KYC link sends profile, country, type, redirect, language and branding', async () => {
	const response = { success: true, id: 'kl_1', url: 'https://app.upload-post.com/phone-kyc/tok', token: 'tok', expires_at: '2026-12-04T00:00:00Z' };
	const { req, out } = await phone(
		'createPhoneNumberKycLink',
		{ ...LINK, phoneNumberToBuy: '+34911234567', phoneKycLinkBranding: { companyName: 'Acme', logoUrl: 'https://example.com/logo.png', brandColor: '#4F46E5' } },
		{ response },
	);
	assert.equal(req.method, 'POST');
	assert.equal(req.url, `${API}/kyc/share`);
	assert.deepEqual(req.body, {
		profile_username: 'client-a',
		country: 'ES',
		number_type: 'local',
		redirect_url: 'https://example.com/done',
		language: 'es',
		phone_number: '+34911234567',
		branding: { company_name: 'Acme', logo_url: 'https://example.com/logo.png', brand_color: '#4F46E5' },
	});
	assert.deepEqual(out, response);
	const bare = (await phone('createPhoneNumberKycLink', { ...LINK, phoneKycLinkLanguage: 'pt-BR' })).req;
	assert.equal(bare.body.branding, undefined);
	assert.equal(bare.body.phone_number, undefined);
	assert.equal(bare.body.language, 'pt-BR');
});

test('create KYC link refuses http URLs, a bad color and a long company name', async () => {
	await assert.rejects(phone('createPhoneNumberKycLink', { ...LINK, phoneKycLinkRedirectUrl: 'http://example.com' }), /Redirect URL must be an https/);
	await assert.rejects(phone('createPhoneNumberKycLink', { ...LINK, phoneKycLinkRedirectUrl: '' }), /Redirect URL is required/);
	await assert.rejects(phone('createPhoneNumberKycLink', { ...LINK, phoneKycLinkBranding: { logoUrl: 'http://x/logo.png' } }), /Logo URL must be an https/);
	await assert.rejects(phone('createPhoneNumberKycLink', { ...LINK, phoneKycLinkBranding: { brandColor: 'blue' } }), /Brand Color/);
	await assert.rejects(phone('createPhoneNumberKycLink', { ...LINK, phoneKycLinkBranding: { companyName: 'x'.repeat(81) } }), /80 characters/);
	await assert.rejects(phone('createPhoneNumberKycLink', { ...LINK, phoneCountry: '' }), /Country is required/);
});

test('list and revoke KYC links', async () => {
	const list = (await phone('listPhoneNumberKycLinks')).req;
	assert.equal(list.method, 'GET');
	assert.equal(list.url, `${API}/kyc/share`);
	const revoke = (await phone('revokePhoneNumberKycLink', { phoneKycLinkId: 'kl_3f9c' })).req;
	assert.equal(revoke.method, 'DELETE');
	assert.equal(revoke.url, `${API}/kyc/share/kl_3f9c`);
	await assert.rejects(phone('revokePhoneNumberKycLink'), /Link ID is required/);
});

test('the hosted page endpoints are not operations', () => {
	const props = new UploadPost().description.properties;
	const ops = props.find((p) => p.name === 'operation' && p.displayOptions?.show?.resource?.includes('phoneNumbers')).options;
	for (const value of [
		'getPhoneNumberKycRemediation',
		'remediatePhoneNumberKyc',
		'replyPhoneNumberKycReviewer',
		'createPhoneNumberKycLink',
		'listPhoneNumberKycLinks',
		'revokePhoneNumberKycLink',
	]) {
		assert.ok(ops.some((o) => o.value === value), value);
	}
	const source = fs.readFileSync(path.join(root, 'nodes/UploadPost/PhoneNumberOperations.ts'), 'utf8');
	assert.doesNotMatch(source, /phone-kyc\//);
});

// ---------------------------------------------------------------- declined = payment kept

test('a pending_regulatory purchase says a declined review keeps the payment', async () => {
	const BUYER = {
		phoneProfile: 'acme', phoneCountry: 'de', phonePurchaseIntentId: 'n8n-exec-1-0',
		phoneEndUserFirstName: 'Ana', phoneEndUserLastName: 'Ruiz', phoneEndUserPhone: '+34600111222',
		phoneEndUserStreet: 'Hauptstr. 1', phoneEndUserLocality: 'Berlin', phoneEndUserPostalCode: '10115',
		phoneEndUserCountryCode: 'de', phoneAcceptTerms: true, phoneTermsVersion: '2026-11-28', phoneImmediateStartConsent: true,
	};
	const { out } = await phone('submitPhoneNumberKyc', BUYER, { response: { success: true, status: 'pending_regulatory' } });
	assert.match(out.next_step, /payment is kept/);
	assert.match(out.next_step, /Fix Identity Review/);
	assert.match(out.next_step, /30 days/);
	assert.doesNotMatch(out.next_step, /declined and refunded/);
});

test('no public text says a declined review is refunded at once', () => {
	const trigger = new UploadPostTrigger().description.properties.find((p) => p.name === 'events').options;
	const declined = trigger.find((o) => o.value === 'phone_number_declined').description;
	assert.match(declined, /payment is kept/);
	assert.doesNotMatch(declined, /charge was refunded/);
	const texts = ['nodes/UploadPost/PhoneNumberOperations.ts', 'README.md', 'AGENTS.md']
		.map((f) => fs.readFileSync(path.join(root, f), 'utf8'))
		.join('\n');
	assert.doesNotMatch(texts, /declined and refunded|if declined it is refunded|declined.{0,40}charge was refunded/i);
});

// ---------------------------------------------------------------- trigger events

test('the trigger offers the two new phone review events, gated like the others', () => {
	const options = new UploadPostTrigger().description.properties.find((p) => p.name === 'events').options;
	for (const value of ['phone_number_kyc_comment', 'phone_number_kyc_resubmitted']) {
		const option = options.find((o) => o.value === value);
		assert.ok(option, value);
		assert.match(option.description, /Opt-in\. Needs phone numbers available on the account/);
	}
	const catalog = require(path.join(__dirname, 'fixtures', 'webhook-event-names.json')).events;
	assert.ok(catalog.includes('phone_number_kyc_comment'));
	assert.ok(catalog.includes('phone_number_kyc_resubmitted'));
});

test('public texts never name the carrier or an internal switch', () => {
	const texts = [
		'nodes/UploadPost/PhoneNumberOperations.ts',
		'nodes/UploadPost/UploadPost.node.ts',
		'nodes/UploadPostTrigger/UploadPostTrigger.node.ts',
		'README.md',
		'CHANGELOG.md',
		'AGENTS.md',
	].map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
	assert.doesNotMatch(texts, /tel[n]yx/i);
	assert.doesNotMatch(texts, /PHONE_[A-Z_]+|TEL[N]YX_|[A-Z]+_ALLOWLIST|UPLOADPOSTS_[A-Z_]+|[A-Z]+_ENABLED\b/);
});

// ---------------------------------------------------------------- update 2

const CONSUMER = {
	phoneProfile: 'acme', phoneCountry: 'es', phonePurchaseIntentId: 'n8n-exec-1-0', phoneEndUserType: 'individual',
	phoneEndUserFirstName: 'Ana', phoneEndUserLastName: 'Ruiz', phoneEndUserPhone: '+34600111222',
	phoneEndUserStreet: 'Calle Mayor 1', phoneEndUserLocality: 'Madrid', phoneEndUserPostalCode: '28013',
	phoneEndUserCountryCode: 'es', phoneAcceptTerms: true, phoneTermsVersion: '2026-11-28',
};

test('an individual end user needs the immediate start consent, a business does not send it', async () => {
	for (const operation of ['purchasePhoneNumber', 'submitPhoneNumberKyc']) {
		await assert.rejects(phone(operation, CONSUMER), /Immediate Start Consent.*14-day withdrawal period/s, operation);
		await assert.rejects(phone(operation, CONSUMER), /immediate_start_consent_required/, operation);
		const { req } = await phone(operation, { ...CONSUMER, phoneImmediateStartConsent: true });
		assert.equal(req.body.immediate_start_consent, true, operation);
		assert.equal(req.body.terms_version, '2026-11-28');
		const business = (await phone(operation, {
			...CONSUMER, phoneEndUserType: 'business', phoneEndUserBusinessName: 'Acme SL', phoneImmediateStartConsent: true,
		})).req;
		assert.equal(business.body.immediate_start_consent, undefined, operation);
	}
	const prop = new UploadPost().description.properties.find((p) => p.name === 'phoneImmediateStartConsent');
	assert.deepEqual(prop.displayOptions.show.phoneEndUserType, ['individual']);
	assert.match(prop.description, /I ask Upload-Post to start providing this number now/);
	const terms = new UploadPost().description.properties.find((p) => p.name === 'phoneTermsVersion');
	assert.equal(terms.placeholder, '2026-11-28');
});

test('an order_unknown fix says it is resolved automatically', async () => {
	const { out } = await phone('remediatePhoneNumberKyc', { ...N, phoneKycValues: '{"req_tax": "B1"}' }, {
		response: { success: true, status: 'pending_regulatory', order: 'order_unknown' },
	});
	assert.match(out.next_step, /resolved automatically/);
	assert.match(out.next_step, /no second order/);
	const same = await phone('remediatePhoneNumberKyc', { ...N, phoneKycValues: '{"req_tax": "B1"}' }, {
		response: { success: true, status: 'pending_regulatory', order: 'same_order' },
	});
	assert.doesNotMatch(same.out.next_step, /resolved automatically/);
});

test('remediation in progress and capacity still fail the node; the README documents them and the KYC link guide', async () => {
	for (const [statusCode, code] of [[409, 'phone_number_remediation_in_progress'], [503, 'phone_numbers_capacity']]) {
		await assert.rejects(
			phone('remediatePhoneNumberKyc', { ...N, phoneKycValues: '{"req_tax": "B1"}' }, { response: { success: false, error_code: code }, statusCode }),
			(error) => error.httpCode === String(statusCode),
			code,
		);
	}
	const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
	for (const text of [
		'phone_number_remediation_in_progress',
		'503 phone_numbers_capacity',
		'order_unknown',
		'immediate_start_consent_required',
		'https://docs.upload-post.com/guides/phone-number-kyc-link',
	]) {
		assert.ok(readme.includes(text), text);
	}
});
