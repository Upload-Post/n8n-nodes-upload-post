# Changelog

## 0.9.0

- New **Upload Post Trigger** node: starts a workflow when Upload-Post sends a webhook event.
  - Events: `upload_completed`, `social_account_connected`, `social_account_disconnected`, `social_account_reauth_required`, `comment_received`, `dm_received`, `telegram_update` and `post_analytics_updated` (opt-in), the Google Business Profile events, the YouTube push events and the post approval events (`post_approval_requested`, `post_approved`, `post_rejected`, `post_approval_expired`). The list matches the API's `WebhookEventName`; YouTube and approval events need that feature turned on, and when one is not available the activation error names it.
  - Optional profile filter and **Verify Signature** (on by default): HMAC-SHA256 of `"{timestamp}.{raw body}"` with the account webhook secret, constant-time comparison, deliveries more than 5 minutes off rejected.
  - Uses webhook subscriptions (`/api/uploadposts/webhooks/subscriptions`): one per active workflow and one while listening for a test event, created with `source: "n8n"` and the workflow name, deleted on deactivation (a `404` counts as deleted). It does not touch the account or profile webhook URL.
  - Needs n8n on a public HTTPS address: a local URL is refused by Upload-Post (`400 invalid_url`) and the node says so.

## 0.8.0

- YouTube resource (videos, quota, playlists, comments, channel, search, live) and YouTube localizations / brand partner on Upload Video.

## 0.7.0

- Best time and automatic queue, paid partnership, Telegram, Bluesky and Google Business options and operations.

## 0.6.0

- Webhook deliveries (list, get, redeliver), account-wide AutoDM rules, Direct Messages (Instagram, Bluesky), LinkedIn organization lookup.
