// WhatsApp direct messages: the /dms/send body for every WhatsApp field, and
// the media, template, business profile and QR code operations.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { UploadPost } = require(path.join(__dirname, '..', 'dist/nodes/UploadPost/UploadPost.node.js'));
const description = new UploadPost().description;

const API = 'https://api.upload-post.com/api';

const run = async (params, { response = { success: true }, binary } = {}) => {
	const calls = [];
	const prepared = [];
	const ctx = {
		getInputData: () => [{ json: {}, binary }],
		getNodeParameter: (name, _itemIndex, fallback) => {
			if (Object.prototype.hasOwnProperty.call(params, name)) return params[name];
			if (fallback !== undefined) return fallback;
			throw new Error(`missing parameter ${name}`);
		},
		getNode: () => ({ name: 'Upload Post', type: 'uploadPost', typeVersion: 1 }),
		helpers: {
			httpRequestWithAuthentication: async (_credential, options) => {
				calls.push(options);
				return response;
			},
			getBinaryDataBuffer: async (_itemIndex, property) => {
				if (!binary || !binary[property]) throw new Error(`no binary ${property}`);
				return Buffer.from(binary[property].data, 'base64');
			},
			prepareBinaryData: async (buffer, fileName, mimeType) => {
				prepared.push({ buffer, fileName, mimeType });
				return { data: buffer.toString('base64'), fileName, mimeType };
			},
		},
	};
	const output = await new UploadPost().execute.call(ctx);
	assert.equal(calls.length, 1);
	return { req: calls[0], item: output[0][0], prepared };
};

const send = (extra) => run({
	resource: 'dms',
	operation: 'sendDm',
	dmUser: 'p',
	dmPlatform: 'whatsapp',
	dmRecipientId: '+34600111222',
	...extra,
});

test('WhatsApp is a DM platform and a connectable platform, not an upload target', () => {
	const dmPlatform = description.properties.find(p => p.name === 'dmPlatform');
	assert.ok(dmPlatform.options.some(o => o.value === 'whatsapp'));
	assert.deepEqual(dmPlatform.displayOptions.show.operation, ['sendDm', 'listDmConversations']);
	const jwt = description.properties.find(p => p.name === 'jwtPlatforms');
	assert.ok(jwt.options.some(o => o.value === 'whatsapp'));
	const uploadPlatforms = description.properties
		.filter(p => p.name === 'platform' && Array.isArray(p.options))
		.flatMap(p => p.options.map(o => o.value));
	assert.ok(!uploadPlatforms.includes('whatsapp'));
	// WhatsApp is open to every account: nothing may call it limited.
	const texts = [];
	const collect = (entry) => {
		texts.push(`${entry.displayName ?? ''} ${entry.name ?? ''} ${entry.action ?? ''} ${entry.description ?? ''}`);
		for (const child of [...(entry.options ?? []), ...(entry.values ?? [])]) if (child && typeof child === 'object') collect(child);
	};
	description.properties.forEach(collect);
	const whatsappTexts = texts.filter(text => /whatsapp/i.test(text));
	assert.ok(whatsappTexts.length > 10);
	for (const text of whatsappTexts) assert.doesNotMatch(text, /limited|allowlist|not generally available/i, text);
});

test('a WhatsApp text with reply_to, attachments by URL and media_id', async () => {
	const { req } = await send({
		dmMessage: 'Your invoice',
		dmReplyTo: 'wamid.IN1',
		dmWhatsappAttachments: {
			attachment: [
				{ type: 'document', url: ' https://example.com/invoice.pdf ', caption: 'Invoice', filename: 'invoice.pdf' },
				{ type: 'image', mediaId: '1234567890' },
				{ type: 'image', url: '', mediaId: '' },
			],
		},
	});
	assert.equal(req.method, 'POST');
	assert.equal(req.url, `${API}/uploadposts/dms/send`);
	assert.deepEqual(req.body, {
		platform: 'whatsapp',
		user: 'p',
		recipient_id: '+34600111222',
		message: 'Your invoice',
		reply_to: 'wamid.IN1',
		attachments: [
			{ type: 'document', url: 'https://example.com/invoice.pdf', caption: 'Invoice', filename: 'invoice.pdf' },
			{ type: 'image', media_id: '1234567890' },
		],
	});
});

test('a WhatsApp template needs no message and carries its components', async () => {
	const { req } = await send({
		dmWhatsappTemplateName: ' order_update ',
		dmWhatsappTemplateLanguage: 'es',
		dmWhatsappTemplateComponents: '[{"type": "body", "parameters": [{"type": "text", "text": "Ana"}]}]',
	});
	assert.deepEqual(req.body.template, {
		name: 'order_update',
		language: 'es',
		components: [{ type: 'body', parameters: [{ type: 'text', text: 'Ana' }] }],
	});
	assert.equal(req.body.message, undefined);
	const plain = await send({ dmWhatsappTemplateName: 'hello_world' });
	assert.deepEqual(plain.req.body.template, { name: 'hello_world', language: 'en_US' });
	await assert.rejects(send({ dmWhatsappTemplateName: 't', dmWhatsappTemplateComponents: '"x"' }), /JSON array/);
});

test('WhatsApp location and contacts', async () => {
	const { req } = await send({
		dmMessage: 'We are here',
		dmWhatsappLocation: { location: { latitude: 40.4168, longitude: -3.7038, name: 'Office', address: '' } },
		dmWhatsappContacts: '{"name": "Ana", "phones": ["+34600111222"]}',
	});
	assert.deepEqual(req.body.location, { latitude: 40.4168, longitude: -3.7038, name: 'Office' });
	assert.deepEqual(req.body.contacts, [{ name: 'Ana', phones: ['+34600111222'] }]);
	const onlyContacts = await send({ dmWhatsappContacts: '[{"name": "Ana", "phones": ["+1"]}, {"name": "Bo", "phones": ["+2"]}]' });
	assert.equal(onlyContacts.req.body.contacts.length, 2);
});

test('WhatsApp interactive messages: reply buttons, list and call-to-action URL with header and footer', async () => {
	const buttons = await send({
		dmMessage: 'Pick one',
		dmWhatsappInteractive: 'buttons',
		dmWhatsappButtons: { button: [{ title: 'Yes', id: 'y' }, { title: 'No', id: '' }, { title: '', id: 'x' }] },
		dmWhatsappHeader: 'Question',
		dmWhatsappFooter: 'Reply below',
	});
	assert.deepEqual(buttons.req.body.buttons, [{ title: 'Yes', id: 'y' }, { title: 'No' }]);
	assert.equal(buttons.req.body.header, 'Question');
	assert.equal(buttons.req.body.footer, 'Reply below');

	const list = await send({
		dmMessage: 'Plans',
		dmWhatsappInteractive: 'list',
		dmWhatsappList: '{"button": "Options", "sections": [{"rows": [{"id": "a", "title": "A"}]}]}',
	});
	assert.deepEqual(list.req.body.list, { button: 'Options', sections: [{ rows: [{ id: 'a', title: 'A' }] }] });

	const cta = await send({ dmMessage: 'Offer', dmWhatsappInteractive: 'cta_url', dmWhatsappCtaText: 'Open', dmWhatsappCtaUrl: 'https://example.com' });
	assert.deepEqual(cta.req.body.cta_url, { display_text: 'Open', url: 'https://example.com' });
	assert.equal(cta.req.body.header, undefined);

	await assert.rejects(send({ dmWhatsappInteractive: 'buttons', dmWhatsappButtons: { button: [{ title: 'Yes' }] } }), /body text/);
	await assert.rejects(send({ dmMessage: 'x', dmWhatsappInteractive: 'buttons' }), /reply button/);
	await assert.rejects(send({ dmMessage: 'x', dmWhatsappInteractive: 'cta_url', dmWhatsappCtaText: 'Open' }), /Button URL/);
});

test('WhatsApp reactions and sender actions need the received message ID', async () => {
	const react = await send({ dmWhatsappAction: 'react', dmMessageId: 'wamid.IN1', dmReaction: '👍' });
	assert.deepEqual(react.req.body, {
		platform: 'whatsapp',
		user: 'p',
		recipient_id: '+34600111222',
		message_id: 'wamid.IN1',
		reaction: '👍',
	});
	// The API drops an empty reaction string as "not set": removal goes as an object.
	const unreact = await send({ dmWhatsappAction: 'unreact', dmMessageId: 'wamid.IN1' });
	assert.deepEqual(unreact.req.body.reaction, { message_id: 'wamid.IN1', emoji: '' });
	const read = await send({ dmWhatsappAction: 'mark_read', dmMessageId: 'wamid.IN1', dmWhatsappTyping: true });
	assert.equal(read.req.body.sender_action, 'mark_read');
	assert.equal(read.req.body.typing, true);
	const typing = await send({ dmWhatsappAction: 'typing_on', dmMessageId: 'wamid.IN1', dmWhatsappTyping: true });
	assert.equal(typing.req.body.sender_action, 'typing_on');
	assert.equal(typing.req.body.typing, undefined);
	// Instagram's sender action parameter is not read for WhatsApp.
	const ignored = await send({ dmMessage: 'hi', dmInstagramSenderAction: 'mark_seen' });
	assert.equal(ignored.req.body.sender_action, undefined);

	await assert.rejects(send({ dmWhatsappAction: 'mark_read' }), /Message ID/);
	await assert.rejects(send({ dmWhatsappAction: 'react', dmMessageId: 'wamid.IN1' }), /Reaction/);
	await assert.rejects(send({}), /Message is required unless you send a template/);
	await assert.rejects(send({ dmRecipientId: '', dmMessage: 'hi' }), /phone number/);
});

test('WhatsApp Extra Fields (JSON) reach the body as is', async () => {
	const { req } = await send({ dmMessage: 'hi', dmExtraFields: '{"typing": true, "header": "H"}' });
	assert.equal(req.body.typing, true);
	assert.equal(req.body.header, 'H');
});

test('list WhatsApp conversations by phone number', async () => {
	const { req } = await run({
		resource: 'dms',
		operation: 'listDmConversations',
		dmUser: 'p',
		dmPlatform: 'whatsapp',
		dmParticipantId: '+34600111222',
		dmMessagesLimit: 5,
		dmStatus: 'request',
	});
	assert.equal(req.url, `${API}/uploadposts/dms/conversations`);
	assert.deepEqual(req.qs, { platform: 'whatsapp', user: 'p', messages_limit: 5, participant_id: '+34600111222' });
});

test('upload WhatsApp media sends the binary file as multipart', async () => {
	const { req } = await run(
		{ resource: 'dms', operation: 'uploadDmMedia', dmUser: 'p', dmMediaBinaryProperty: 'photo', dmMediaType: 'image' },
		{ binary: { photo: { data: Buffer.from('png-bytes').toString('base64'), fileName: 'a.png', mimeType: 'image/png' } } },
	);
	assert.equal(req.method, 'POST');
	assert.equal(req.url, `${API}/uploadposts/dms/media`);
	assert.equal(req.json, false);
	assert.equal(req.body.get('platform'), 'whatsapp');
	assert.equal(req.body.get('user'), 'p');
	assert.equal(req.body.get('type'), 'image');
	const file = req.body.get('file');
	assert.equal(file.name, 'a.png');
	assert.equal(file.type, 'image/png');
	assert.equal(Buffer.from(await file.arrayBuffer()).toString(), 'png-bytes');
	await assert.rejects(
		run({ resource: 'dms', operation: 'uploadDmMedia', dmUser: 'p', dmMediaBinaryProperty: 'missing' }, { binary: {} }),
		/missing' was not found/,
	);
});

test('download WhatsApp media returns the file as binary data', async () => {
	const { req, item, prepared } = await run(
		{ resource: 'dms', operation: 'downloadDmMedia', dmUser: 'p', dmMediaId: ' 987 ', dmMediaOutputProperty: 'file' },
		{ response: { statusCode: 200, headers: { 'content-type': 'audio/ogg; codecs=opus' }, body: Buffer.from('ogg') } },
	);
	assert.equal(req.method, 'GET');
	assert.equal(req.url, `${API}/uploadposts/dms/media`);
	assert.deepEqual(req.qs, { platform: 'whatsapp', user: 'p', media_id: '987' });
	assert.equal(req.encoding, 'arraybuffer');
	assert.equal(req.returnFullResponse, true);
	assert.equal(req.json, false);
	assert.equal(prepared[0].fileName, 'whatsapp-987.ogg');
	assert.equal(prepared[0].mimeType, 'audio/ogg');
	assert.equal(item.binary.file.fileName, 'whatsapp-987.ogg');
	assert.deepEqual(item.json, { success: true, media_id: '987', mime_type: 'audio/ogg', file_name: 'whatsapp-987.ogg', size: 3 });

	await assert.rejects(
		run(
			{ resource: 'dms', operation: 'downloadDmMedia', dmUser: 'p', dmMediaId: '1' },
			{ response: { statusCode: 401, headers: { 'content-type': 'application/json' }, body: Buffer.from('{"success": false, "error": "reconnect", "code": "whatsapp_reauth_required"}') } },
		),
		(error) => error.httpCode === '401',
	);
});

test('list, create and delete WhatsApp templates', async () => {
	const list = await run({ resource: 'dms', operation: 'listDmTemplates', dmUser: 'p', dmTemplateLimit: 50, dmTemplateStatus: 'APPROVED', dmTemplateNameFilter: 'x' });
	assert.equal(list.req.method, 'GET');
	assert.equal(list.req.url, `${API}/uploadposts/dms/templates`);
	assert.deepEqual(list.req.qs, { platform: 'whatsapp', user: 'p', limit: 50, status: 'APPROVED', name: 'x' });

	const create = await run({
		resource: 'dms',
		operation: 'createDmTemplate',
		dmUser: 'p',
		dmTemplateName: ' Order_Update ',
		dmTemplateCategory: 'UTILITY',
		dmTemplateLanguage: 'es',
		dmTemplateBody: 'Hi {{1}}, order {{2}} shipped',
		dmTemplateExamples: 'Ana, #1042',
		dmTemplateHeader: 'Shipping',
		dmTemplateFooter: 'Thanks',
		dmTemplateButtons: { button: [{ text: 'Track', url: 'https://example.com/t' }, { text: 'Call', phoneNumber: '+341' }, { text: 'OK' }, { text: '' }] },
	});
	assert.equal(create.req.method, 'POST');
	assert.deepEqual(create.req.body, {
		platform: 'whatsapp',
		user: 'p',
		name: 'order_update',
		category: 'UTILITY',
		language: 'es',
		body: 'Hi {{1}}, order {{2}} shipped',
		examples: ['Ana', '#1042'],
		header: 'Shipping',
		footer: 'Thanks',
		buttons: [{ text: 'Track', url: 'https://example.com/t' }, { text: 'Call', phone_number: '+341' }, { text: 'OK' }],
	});

	const raw = await run({
		resource: 'dms',
		operation: 'createDmTemplate',
		dmUser: 'p',
		dmTemplateName: 'promo',
		dmTemplateCategory: 'MARKETING',
		dmTemplateBody: 'ignored',
		dmTemplateComponents: '[{"type": "BODY", "text": "Sale"}]',
	});
	assert.deepEqual(raw.req.body, {
		platform: 'whatsapp',
		user: 'p',
		name: 'promo',
		category: 'MARKETING',
		language: 'en_US',
		components: [{ type: 'BODY', text: 'Sale' }],
	});
	await assert.rejects(run({ resource: 'dms', operation: 'createDmTemplate', dmUser: 'p', dmTemplateName: 'bad name', dmTemplateBody: 'x' }), /lowercase/);
	await assert.rejects(run({ resource: 'dms', operation: 'createDmTemplate', dmUser: 'p', dmTemplateName: 'ok' }), /Body is required/);

	const del = await run({ resource: 'dms', operation: 'deleteDmTemplate', dmUser: 'p', dmTemplateName: 'promo' });
	assert.equal(del.req.method, 'DELETE');
	assert.deepEqual(del.req.qs, { platform: 'whatsapp', user: 'p', name: 'promo' });
});

test('WhatsApp business profile: get, update as JSON and with a photo', async () => {
	const get = await run({ resource: 'dms', operation: 'getWhatsappProfile', dmUser: 'p' });
	assert.equal(get.req.method, 'GET');
	assert.equal(get.req.url, `${API}/uploadposts/dms/whatsapp/profile`);
	assert.deepEqual(get.req.qs, { user: 'p' });

	const update = await run({
		resource: 'dms',
		operation: 'updateWhatsappProfile',
		dmUser: 'p',
		dmWhatsappProfileFields: { about: 'Open 9-18', websites: 'https://a.com, https://b.com', vertical: 'RETAIL', email: '' },
	});
	assert.equal(update.req.method, 'POST');
	assert.deepEqual(update.req.body, { user: 'p', about: 'Open 9-18', websites: ['https://a.com', 'https://b.com'], vertical: 'RETAIL' });

	const photo = await run(
		{
			resource: 'dms',
			operation: 'updateWhatsappProfile',
			dmUser: 'p',
			dmWhatsappProfileFields: { websites: 'https://a.com, https://b.com' },
			dmWhatsappProfilePhoto: 'data',
		},
		{ binary: { data: { data: Buffer.from('jpg').toString('base64'), fileName: 'logo.jpg', mimeType: 'image/jpeg' } } },
	);
	assert.equal(photo.req.json, false);
	assert.equal(photo.req.body.get('user'), 'p');
	assert.equal(photo.req.body.get('websites'), 'https://a.com,https://b.com');
	assert.equal(photo.req.body.get('file').name, 'logo.jpg');

	await assert.rejects(run({ resource: 'dms', operation: 'updateWhatsappProfile', dmUser: 'p', dmWhatsappProfileFields: {} }), /at least one/);
});

test('WhatsApp QR codes: list, create or update, delete', async () => {
	const list = await run({ resource: 'dms', operation: 'listWhatsappQrCodes', dmUser: 'p' });
	assert.equal(list.req.url, `${API}/uploadposts/dms/whatsapp/qr`);
	assert.deepEqual(list.req.qs, { user: 'p' });

	const create = await run({ resource: 'dms', operation: 'createWhatsappQrCode', dmUser: 'p', dmQrPrefilledMessage: 'Hi!' });
	assert.equal(create.req.method, 'POST');
	assert.deepEqual(create.req.body, { user: 'p', prefilled_message: 'Hi!' });
	const edit = await run({ resource: 'dms', operation: 'createWhatsappQrCode', dmUser: 'p', dmQrPrefilledMessage: 'Hello', dmQrCode: 'ABC123' });
	assert.deepEqual(edit.req.body, { user: 'p', prefilled_message: 'Hello', code: 'ABC123' });

	const del = await run({ resource: 'dms', operation: 'deleteWhatsappQrCode', dmUser: 'p', dmQrCode: 'ABC123' });
	assert.equal(del.req.method, 'DELETE');
	assert.deepEqual(del.req.qs, { user: 'p', code: 'ABC123' });
	await assert.rejects(run({ resource: 'dms', operation: 'deleteWhatsappQrCode', dmUser: 'p' }), /QR Code ID/);
});
