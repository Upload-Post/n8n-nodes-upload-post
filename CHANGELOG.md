# Changelog

## Unreleased

- Uploads in a loop (Loop Over Items / Split In Batches) are all published. The derived `Idempotency-Key` now includes the run of the node and a hash of the content (fields plus file names, types and sizes): before, every pass of the loop sent the key of the first one and got the first post back. Retry On Fail still sends the same key.
- Get Upload History: **Limit** is a list of the values the API accepts (10, 20, 50, 100); a workflow saved with another number gets the closest one instead of a `400`, and a page below 1 is sent as 1.

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
