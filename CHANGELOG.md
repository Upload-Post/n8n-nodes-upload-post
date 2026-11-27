# Changelog

## 0.13.0

- Phone numbers (still not generally available: the API answers `403 phone_numbers_not_available` until phone numbers are available for your account):
  - **A declined identity review keeps the payment** (before, it was refunded at once). The number stays `regulatory_declined` with the monthly charge paused; fix it with **Fix Identity Review** (no second charge). If nothing is fixed within 30 days, or the number is released, the purchase is cancelled and refunded. On approval the number becomes active and the monthly charge resumes (no new proration). The `next_step` of a `pending_regulatory` purchase, the Phone Number Declined trigger event and the Release text say so.
  - **Get Identity Review**: review status, the requirements to fix (`needs_fix`), the fields to send again and the reviewer thread, plus a `next_step` while the number is declined (Get too) with the `remediation_deadline_at` date when present. A declined number carries `declined_at` and `remediation_deadline_at` (`declined_at` + 30 days).
  - **Fix Identity Review**: only the corrected Identity Values, Documents (from binary properties, sent as base64) and/or New End User (a new address). `409 phone_number_unavailable` (`keeps_payment: true`) comes back as the item with `http_status` and a `next_step` instead of failing the node: run it again with the corrections and a **Replacement Phone Number** of the same country and type with no higher price.
  - **Reply to Reviewer**: a message (up to 2,000 characters) with optional attachments from binary properties.
  - **Create KYC Link**, **List KYC Links**, **Revoke KYC Link**: a white-label, single-use page (7 days, at most 20 active) where your end user fills in the identity and documents for one number; the purchase is billed to your account. Branding (company name, logo URL, brand color), HTTPS Redirect URL and page language (en, es, pt-BR).
  - **Immediate Start Consent** on Purchase and Submit Identity Documents (current terms version `2026-11-28`): required for an individual end user (a consumer's request to start at once within the 14-day withdrawal period; the node shows the consent text and refuses without it, the API answers `400 immediate_start_consent_required`); sent as `immediate_start_consent`, never for a business.
  - Fix Identity Review documents `409 phone_number_remediation_in_progress`, `503 phone_numbers_capacity` (payment kept, try later) and `order: order_unknown` (resolved automatically, no second order).
- Upload Post Trigger: `phone_number_kyc_comment` (the identity reviewer wrote) and `phone_number_kyc_resubmitted` (the corrections were sent), opt-in like the other phone number events.

## 0.12.0

- New **Phone Number** resource (not generally available yet: the API answers `403 phone_numbers_not_available` until phone numbers are available for your account; paid plans only; no emergency calls). Real numbers bought for a profile:
  - **Get Config**, **List Countries**, **Search Available**, **Purchase** (end user, terms, idempotent Purchase Intent ID with a per-execution default), **Get Identity Fields** and **Submit Identity Documents** (values plus files from binary properties).
  - Purchase and Submit Identity Documents return the API answer plus a `next_step` when it is `202`: `kyc_required` (nothing charged, send the documents), `pending_payment` (paid, the order is being confirmed: check with Get, do not buy again) or `pending_regulatory` (paid, our carrier is reviewing).
  - **List**, **Get**, **Release** (final, needs Confirm Release), **Update Voice Settings** (forwarding, voicemail, recording, transcription), **Send SMS**, **List Messages**, **List Calls**, **Get Codes**, **Prepare WhatsApp Verification**, **Get Port-Out Info** and **Get Usage**.
  - Prices and usage are in the account's billing currency (USD, EUR or GBP, same numeric amount); an account billed in another currency gets `409 phone_numbers_currency_unsupported`.
- Upload Post Trigger: the phone number events `sms_received`, `call_received`, `voicemail_received`, `phone_number_activated`, `phone_number_declined`, `phone_number_released` and `phone_number_port_out` (opt-in, only accepted while phone numbers are available on the account).

## 0.11.0

- Options for the API features switched on in production on 2026-11-25 (nothing is sent unless it is filled):
  - **Threads Options** (Upload Photo(s) / Video / Text): GIF ID and Ghost Post (text), Spoiler Media (photos/video), Text Spoilers.
  - **X Video and Clip Options**: video card title, description and call to action (Upload Video); clip of another post's video (Upload Text).
  - Upload Text: **Facebook Text Options** (Backdated Time and its granularity).
  - Upload Photo(s): **Instagram Options (Single Video)**: a single video is published as a Reel with Cover URL, Thumbnail Offset, Share to Feed and Audio Name.
  - Direct Message: **Get / Set / Delete Instagram Ice Breakers or Menu** (starter questions and persistent menu of the Instagram inbox).
  - Create Comment: top-level comment on your own Instagram post (Post ID or Post URL without Comment ID); **Image URL** on TikTok. Get Suggestions: **Trending** type and **Personalized** (TikTok).
  - Direct Message *Extra Fields (JSON)* lists the WhatsApp flow, location_request, carousel and call_button fields.

## 0.10.0

- **WhatsApp** direct messages, open to every account (WhatsApp is a messaging channel: it does not publish posts). Direct Message > Platform has **WhatsApp**: the profile's own WhatsApp Business number, Recipient ID = phone number in international format.
  - Send DM sends every WhatsApp field of `/dms/send`: message, reply to, attachments (image, video, audio, document, sticker by HTTPS URL or `media_id`, with caption and file name), approved **template** (name, language, components; the only message delivered outside the 24-hour window), location, contacts, interactive messages (reply buttons, list, call-to-action URL button, header, footer), React / Remove Reaction, Mark Read (with typing) and Typing On. Extra Fields (JSON) also works for WhatsApp.
  - List Conversations accepts WhatsApp (Participant ID = phone number).
  - New operations: **Upload WhatsApp Media** (binary to `media_id`), **Download WhatsApp Media** (`media_id` to binary), **List / Create / Delete WhatsApp Templates**, **Get / Update WhatsApp Business Profile** (with profile photo) and **List / Create or Update / Delete WhatsApp QR Codes**.
- Generate JWT: WhatsApp can be offered as a platform to connect (for direct messages).
- Upload Post Trigger: `dm_received` also covers WhatsApp.

## 0.9.1

- Uploads in a loop (Loop Over Items / Split In Batches) are all published. The derived `Idempotency-Key` now includes the run of the node and a hash of the content (fields plus file names, types and sizes): before, every pass of the loop sent the key of the first one and got the first post back. Retry On Fail still sends the same key.
- Get Upload History: **Limit** is a list of the values the API accepts (10, 20, 50, 100); a workflow saved with another number gets the closest one instead of a `400`, and a page below 1 is sent as 1.
- Wait for Completion: a `429` while checking the status no longer fails the node; it waits (`Retry-After` when sent) and keeps checking within the timeout. A `404` (`not_found`) is read and checked again every 10 s; if it lasts a minute (or until the timeout) the node fails saying the request_id is unknown, instead of the bare HTTP error.

## 0.9.0

- New **Upload Post Trigger** node: starts a workflow when Upload-Post sends a webhook event.
  - Events: `upload_completed`, `social_account_connected`, `social_account_disconnected`, `social_account_reauth_required`, `comment_received`, `dm_received`, `telegram_update` and `post_analytics_updated` (opt-in), the Google Business Profile events, the YouTube push events and the post approval events (`post_approval_requested`, `post_approved`, `post_rejected`, `post_approval_expired`). The list matches the API's `WebhookEventName`; YouTube and approval events need that feature turned on, and when one is not available the activation error names it.
  - Optional profile filter and **Verify Signature** (on by default): HMAC-SHA256 of `"{timestamp}.{raw body}"` with the account webhook secret, constant-time comparison, deliveries more than 5 minutes off rejected.
  - Uses webhook subscriptions (`/api/uploadposts/webhooks/subscriptions`): one per active workflow and one while listening for a test event, created with `source: "n8n"` and the workflow name, deleted on deactivation (a `404` counts as deleted). It does not touch the account or profile webhook URL.
  - Needs n8n on a public HTTPS address: a local URL is refused by Upload-Post (`400 invalid_url`) and the node says so.
  - Not generally available yet: while webhook subscriptions are switched off, activation fails with `503 webhook_subscriptions_disabled` and the node says the feature is off (not a temporary failure).
- Telegram Options on uploads: **Allow Paid Broadcast** (`telegram_allow_paid_broadcast`, spends the bot's Stars), plus Entities, Caption Entities, Reply Parameters, Suggested Post Parameters, Ephemeral Message Parameters, Game Short Name and Disable Content Type Detection.
- A team member's post that goes to approval (`202`, `pending_approval: true`) is returned right away instead of polling the status until the timeout.
- Create User says that a repeated name answers `409 Username already in use` and a full plan `403 PROFILE_LIMIT_REACHED`.

## 0.8.0

- YouTube resource (videos, quota, playlists, comments, channel, search, live) and YouTube localizations / brand partner on Upload Video.

## 0.7.0

- Best time and automatic queue, paid partnership, Telegram, Bluesky and Google Business options and operations.

## 0.6.0

- Webhook deliveries (list, get, redeliver), account-wide AutoDM rules, Direct Messages (Instagram, Bluesky), LinkedIn organization lookup.
