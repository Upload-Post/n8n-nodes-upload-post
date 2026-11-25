# n8n-nodes-upload-post

This is an n8n community node package for [Upload Post](https://www.upload-post.com/). It allows you to automate uploading photos, videos, and text posts to various social media platforms supported by the Upload Post API.

[n8n](https://n8n.io/) is a fair-code licensed workflow automation tool.

## Installation

Follow the [n8n community node installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) to install this node.

1.  Go to **Settings > Community Nodes**.
2.  Select **Install**.
3.  Enter `n8n-nodes-upload-post` in **Enter npm package name**.
4.  Agree to the [risks of using community nodes](https://docs.n8n.io/integrations/community-nodes/risks/).
5.  Select **Install**.

After installing the node, you can use it in your n8n workflows.

## Credentials

To use this node, you need to configure the Upload Post API credentials:

1.  Create an API key from your [Upload Post dashboard](https://www.upload-post.com/).
2.  In n8n, go to **Credentials > New**.
3.  Search for **Upload Post API** and select it.
4.  Enter a **Credential Name**.
5.  Paste your Upload Post API key into the **API Key** field.
6.  Select **Save**.

## Upload Post Trigger

The package has two nodes: **Upload Post** (actions) and **Upload Post Trigger**, which starts a workflow when Upload-Post sends a webhook event. Both use the same **Upload Post API** credential.

**Requirement: a public HTTPS address.** Upload-Post only delivers to a public `https://` URL. An n8n running on `localhost`, a private IP or plain `http` cannot be activated: Upload-Post answers `400 invalid_url` and the node shows *"Upload-Post only sends webhooks to a public HTTPS URL: set WEBHOOK_URL on this n8n to its public https address"* (in n8n 2.x, as the workflow activation error). Self-hosted n8n must run behind a public https address and have its `WEBHOOK_URL` environment variable set to it. n8n Cloud works as is.

**Not generally available yet.** Webhook subscriptions are switched off on Upload-Post for now: while they are, activating the trigger fails with `503 webhook_subscriptions_disabled` (*"Webhook subscriptions are not generally available on Upload-Post yet"*). That is the feature being off, not a temporary failure. Until it is on, point the account webhook (**Update Notification Preferences**) at an n8n **Webhook** node.

**Parameters**
- **Events** (required, several allowed):
  - `upload_completed`: an upload finished, published or failed (check `success` in each platform result).
  - `social_account_connected`, `social_account_disconnected`, `social_account_reauth_required`.
  - `comment_received`, `dm_received`, `telegram_update`: opt-in. The account has to have that feature available (comments on Instagram/TikTok/LinkedIn Pages, DMs on Instagram/WhatsApp/Bluesky/Telegram bot, Telegram bot updates turned on in Upload-Post).
  - Google Business Profile: `review_received`, `review_updated`, `customer_media_received`, `listing_google_update`, `listing_duplicate`, `listing_control_changed` (need Google Business notifications turned on).
  - `post_analytics_updated`: opt-in. Upload-Post refreshed a post's analytics (on a read or a scheduled checkpoint); at most once per post and age bucket, with a daily cap per account.
  - YouTube: `youtube_video_published`, `youtube_video_updated`. Only accepted while YouTube notifications are turned on (not available on every account yet).
  - Post approvals: `post_approval_requested`, `post_approved`, `post_rejected`, `post_approval_expired`. Only accepted while post approvals are turned on for the account.
  - While an event is not available on the account, Upload-Post answers `400 invalid_events` and the activation error names those events (*"These events are not available on this Upload-Post account: …"*); the error details list the events the account accepts now.
- **Profile Name or ID** (optional): only events of that Upload-Post profile. Leave **All Profiles** for the whole account.
- **Verify Signature** (on by default): rejects with `401` any request whose `X-Upload-Post-Signature` does not match the account webhook secret, or whose `X-Upload-Post-Timestamp` is more than 5 minutes off. The secret is read from `GET /api/uploadposts/users/notifications` and cached; if a signature fails, the node reads it again (at most once a minute) in case it was rotated.

**How it works**
- Activating the workflow creates a **webhook subscription** (`POST /api/uploadposts/webhooks/subscriptions`) for the node's URL with `source: "n8n"` and the workflow name. It is separate from the account or profile webhook URL configured with **Update Notification Preferences**, which keeps working unchanged. Each account can have up to 10 active subscriptions (`409 subscription_limit_reached` beyond that).
- Deactivating the workflow deletes the subscription. If it is already gone (`404`), that counts as deleted.
- **Listen for test event** uses n8n's test URL, which is a different subscription from the production one: n8n creates it while listening and deletes it when it stops.
- On activation the node first looks for an active subscription with the same URL, events and profile and reuses it. A subscription Upload-Post disabled (for example because the URL kept answering `404`/`410`) is reactivated. Changing the events or the profile creates a new subscription and removes the old one on that URL.
- The first delivery can take up to about a minute. Deliveries are at least once: deduplicate by `uploadPostDelivery.deliveryId`.

**Output**: one item per delivery with the webhook body as sent by Upload-Post (same body as the account webhook, e.g. `event`, `profile_username`, `platform`, `success`, `result`…) plus `uploadPostDelivery`:

```json
{
  "event": "upload_completed",
  "profile_username": "my_profile",
  "...": "the rest of the event body",
  "uploadPostDelivery": {
    "event": "upload_completed",
    "deliveryId": "6b1d…",
    "attempt": 1,
    "subscriptionId": "whsub_…",
    "timestamp": "1763300000"
  }
}
```

`redeliveryOf` is added when the delivery is a manual redelivery (**Redeliver Webhook**). A delivery for an event the node did not select is acknowledged with `200` and does not run the workflow.

To see what the subscription is doing: `GET /api/uploadposts/webhooks/subscriptions` (status, `disabled_reason`, health) and `GET /api/uploadposts/webhooks/deliveries?subscription_id=<id>` (its delivery log). `POST /api/uploadposts/webhooks/subscriptions/{id}/test` sends a sample of one of its events to the workflow.

## Operations

The node provides the following operations grouped for clarity:

### Upload Actions
- **Upload Photo(s)**: Upload one or more photos to supported platforms.
  - Supports file uploads and photo URLs (comma-separated list).
  - Common parameters: User Identifier, Platform Names or IDs, Title / Main Content, Description (optional), Photos (Files or URLs), Scheduled Date (optional).
  - Title/Description overrides per platform, including Bluesky, Slack, Mastodon, Nostr, Lemmy, Dev.to, Hashnode, WordPress, Whop and Listmonk.
  - Platform-specific parameters available for: Bluesky, Discord, Facebook, Google Business, Instagram, Lemmy, LinkedIn, Mastodon, Pinterest, Reddit, Telegram, Threads, TikTok, WordPress, X (Twitter).
  - **Pinterest**: Requires Board selection via dynamic selector.
  - **Instagram**: Media Type (Image/Stories), TikTok: Auto-add music, disable comments, brand content toggles.
  - **Facebook**: Page selection via dynamic selector.
  - **LinkedIn**: Visibility settings (Photos only), Page selection via dynamic selector.
  - **X (Twitter)**: Tagged user IDs, reply settings, geo place ID.

- **Upload Video**: Upload a single video to supported platforms.
  - Supports file uploads and video URLs.
  - Common parameters: User Identifier, Platform Names or IDs, Title / Main Content, Description (optional), Video (File or URL), Scheduled Date (optional).
  - Title/Description overrides per platform: `instagram_title`, `facebook_title`, `tiktok_title`, `linkedin_title`, `x_title`, `youtube_title`, `pinterest_title`.
  - Platform-specific parameters available for: Bluesky, Discord, Facebook, Google Business, Instagram, LinkedIn, Mastodon, Pinterest, Reddit, Telegram, Threads, TikTok, WordPress, X (Twitter), YouTube.
  - **YouTube**: Custom thumbnail (URL/binary), tags, category, privacy, embeddable, license, public stats, made for kids, synthetic media declaration, geo-restrictions, paid product placement, recording date, default language/audio language.
  - **Facebook**: Page selection, video state (Published/Draft), media type (Reels/Stories).
  - **Instagram**: Media type (Reels/Stories), share to feed, collaborators, cover URL, audio name, user tags, location ID, thumb offset.
  - **TikTok**: Privacy level, disable duet/stitch/comments, cover timestamp, brand content toggles, AI-generated content flag, post mode.
  - **LinkedIn**: Visibility settings, Page selection, video description.
  - **Pinterest**: Board selection, cover image options (URL/base64/keyframe).
  - **X (Twitter)**: Tagged user IDs, reply settings, nullcast, place ID, long text handling.

- **Upload Text**: Upload a text-based post to supported platforms.
  - Common parameters: User Identifier, Platform Names or IDs, Title / Main Content (used as post content), Scheduled Date (optional).
  - Platform-specific parameters available for: Bluesky, Dev.to, Discord, Facebook, Google Business, Hashnode, Lemmy, LinkedIn, Listmonk, Mastodon, Nostr, Reddit, Slack, Telegram, Threads, Whop, WordPress, X (Twitter).
  - **Facebook**: Page selection, link URL for preview.
  - **LinkedIn**: Page selection ("Me" for personal profile).
  - **X (Twitter)**: Reply settings, poll options (2-4 options, 5-10080 min duration), post URL, quote tweet ID, geo place ID, super followers exclusivity, community ID, sharing options, direct message deep link, card URI, long text handling.
  - **Threads**: Long text as single post option.
  - **Reddit**: Subreddit selection, flair ID.

- **Upload Document**: LinkedIn document posts (PDF, PPT/PPTX, DOC/DOCX) and, on Telegram, any file up to 50 MB (audio, voice, sticker, GIF, video note...) with **Telegram Options > Send As**.

- **Paid Partnership** (Upload Photo(s), Video and Text): one switch for sponsored posts, mapped to each network's native label (TikTok branded content, YouTube paid promotion, X paid partnership). Facebook and Pinterest also need **Facebook Sponsor ID** / **Pinterest Sponsor ID** (the sponsor's Page / account). Networks without a label publish without it and the response carries a warning; a network-specific field always wins. TikTok refuses it with the Only Me privacy level (`commercial_disclosure_privacy_conflict`) and drafts do not carry it.
- **Telegram Options** (collection): text and caption override, first comment (as a reply by default), pin after publishing (silent unless Pin Notify), reply to a message (with quote), inline URL buttons (Reply Markup), message effect, link preview options, polls, locations (live too), venues, contacts, dice and rich messages (Upload Text), video cover / thumbnail / start time, album with extra Media URLs, Send As (animation, video note, live photo, audio, voice, sticker, document), caption overflow (split), paid media in Telegram Stars, Send By URL, message and caption entities, full Reply Parameters, suggested posts, ephemeral messages, games, and **Allow Paid Broadcast** (faster than 30 messages/s, 0.1 Star per extra message from the bot's balance; Telegram only allows it to bots with 100,000 Stars and 100,000 monthly active users, otherwise the Telegram result fails). Names and JSON objects follow the Telegram Bot API.
- **Bluesky Options** (collection): Tags (up to 8, not shown in the text), Created At (import older posts), Thread Overflow (long text continues as replies), GIF As Video, Captions (WebVTT, video), Video Presentation (GIF-style video).
- **Google Business Options** (collection): Alert Type, Upload To Gallery, Multiple Media (up to 10 photos), recurring EVENT/OFFER posts (Recurrence, days, day of month, week occurrence, end) and Google's own Scheduled Time.

### Status & History Actions
- **Get Upload Status**: Check the status/result of an async upload by `request_id`.
  - Parameters: Request ID.
- **Get Upload History**: List past uploads.
  - Parameters: Page (default 1), Limit (default 20). Limit can be 20, 50, or 100.
- **Get Analytics**: Retrieve aggregated profile analytics.
  - Parameters: Profile Username, Platforms (required — at least one), Facebook Page ID (required when Facebook is selected), LinkedIn Page URN (optional).
  - Supported: Facebook, Instagram, LinkedIn, Pinterest, Reddit, Telegram, Threads, TikTok, X, YouTube. Telegram returns subscribers or members, reactions and active boosts (the Bot API has no views). Analytics are not available for Discord.
- **Get Post Analytics**: Per-post metrics for an upload, by `request_id`.
  - Parameters: Request ID, Platform (optional filter).
  - On TikTok, `post_metrics` also carries `retention`, `impression_sources`, `audience_types`, `new_followers`, `reach` and the watch times, plus `original_publish_id`.
  - TikTok drafts (`MEDIA_UPLOAD`): metrics arrive once the creator publishes the draft as **public** from the TikTok app (TikTok gives no post ID for private posts). Until then `post_metrics_error` says it is still in the inbox; after 30 days without a post, read it with **Get Post Analytics by Platform ID**.
- **Get Post Analytics by Platform ID**: Per-post metrics for a post published outside Upload-Post.
  - Parameters: Platform Post ID, Platform, Profile Username.
- **Get Cached Post Analytics**: Replays per-post metrics already fetched, instead of querying the platforms again, so it is not subject to the live analytics rate limit (100 requests / 5 minutes). Only contains posts previously fetched through a live per-post endpoint; there is no background refresh, so captured_at is the last time that post was read live.
  - Parameters: Profile Username (required), Platform (optional filter), Limit (default 50, max 200), Cursor, Since / Until (`YYYY-MM-DD`, defaults to the last 30 days).
  - Values are only as fresh as your last live read — check `captured_at` on each post. Use **Get Post Analytics** for a just-published post and this operation for bulk or historical reads.
  - Paginate by passing the `next_cursor` from the previous response as `Cursor` while `has_more` is true.
  - Supported: Facebook, Instagram, LinkedIn, Pinterest, Reddit, Threads, TikTok, YouTube. X (Twitter) is not cached.
- **Get Total Impressions**: Impressions aggregated across connected platforms.
  - Parameters: Profile Username, Period or Start/End Date, Platforms, Breakdown.
- **Get Platform Metrics**: Lists which metrics each platform exposes.
- **Get Reddit Detailed Posts**: Detailed Reddit posts with full media information.
  - Parameters: Profile Username.
- **Get Media**: List published media for a connected network.
- **Get Google Business Locations**: List locations for a Google Business Profile.
- **Resolve LinkedIn Organization**: Turn any LinkedIn company, showcase or school Page (URL, vanity name, numeric ID or `urn:li:organization:ID`) into `{urn, id, name, vanity_name, mention}`.
  - Parameters: User Identifier (its LinkedIn connection makes the lookup), LinkedIn Page.
  - Paste `mention` (`@[Exact Name](urn:li:organization:ID)`) into the LinkedIn post text. LinkedIn only links a company mention whose name matches the Page **exactly, capitals included**; otherwise it is published as plain text. `@company-vanity` in the post text is also resolved on publish.
  - Person profiles (`/in/…`) cannot be resolved (`400 linkedin_person_not_resolvable`). Live lookups count against 60 per hour per account; cached Pages (`cached: true`) are free.
- **Get TikTok Trending Music / Search TikTok Music / Get TikTok Locations / Get TikTok Publishing Settings**: TikTok discovery helpers (music IDs, location IDs, creator capabilities).

### Post Actions
- **Retry Post**: Re-enqueue failed platforms of an upload without re-uploading media (`request_id` or `job_id`).
- **Unpublish Post**: Delete a live post. Not available for Instagram, TikTok or Threads. Telegram: **Telegram Delete All Messages** removes every message of the post (album items, caption rest, first comment), not only Post ID.
- **Edit Post**: Update caption/metadata on a live post. Telegram: new text or caption, **Telegram Action** (pin, unpin, stop poll, stop live location); Google Business: Message becomes the post summary. **Extra Fields (JSON)** passes any other documented field (buttons, media replacement, call to action...).
- **Repost**: Repost on LinkedIn, X or Threads, or forward / copy a Telegram post (**Telegram Mode**, **Telegram Target Chat ID**, **Telegram All Messages**; Message is the new caption of a copy).
- **Save Pin**: Save a Pinterest pin to a board.

### Queue & Best Time
- **Get Best Times**: Best hours to publish for a connected account (Bluesky, Facebook, Instagram, LinkedIn, Pinterest, Threads, TikTok, YouTube), with `source` (`audience_activity`, `account_posts`, `upload_post_history`, `none`) and `confidence`.
  - Parameters: Profile, Platform, Time Zone, Top Hours, Refresh; LinkedIn Page URN / Facebook Page ID.
- **Get Queue Settings / Get Queue Preview / Get Next Queue Slot**: read the profile queue (`slots_mode`, `auto_slots`, `effective_slots`).
- **Update Queue Settings**: **Slots Mode = Automatic** (`slots=auto`) fills the queue with the best hours of the profile's networks (Automatic Slots per Day, Automatic Slots Platforms, Refresh); **Fixed** goes back to fixed slots (Fixed Slots JSON). Also Time Zone, Days of Week and Max Posts per Slot. Posts already scheduled do not move.

### Telegram Actions
Your own bot in the connected chat, group or channel.
- **Get Chat Info / Update Chat Info**: details, subscribers or members and administrators; change title, description and (Extra Fields) permissions, slow mode...
- **Get Boosts**, **Get Member** (one member, or the administrators), **Moderate Member** (ban, unban, restrict, promote, demote, custom title; ban/promote/demote need **Confirm**).
- **Create Invite Link / Revoke Invite Link** (revoke needs Confirm).
- **Get Bot Profile / Update Bot Profile**, **Get Bot Commands / Set Bot Commands**.

### Bluesky Actions
- **Get Profile** (one or several handles/DIDs, or the connected account), **Get Notifications**, **Get Unread Count**, **Search Posts**, **Search Accounts**.
- **List Drafts / Create Draft / Delete Draft**: drafts shown in the Bluesky app (text only; delete needs **Confirm**).

### Google Business Actions
- **List Posts / Get Post**: the location's posts. Edit them with Post Action > Edit Post and delete them with Unpublish Post (platform Google Business).
- **List Reviews / Get Review**.
- **Get Performance** (daily metrics for a date range) and **Get Search Keywords** (monthly).
- **Get Location Info / Update Location Info**: `edit_mode` legacy (default) or strict (title, address, categories, open status; Dry Run and Confirm), Extra Fields for hours and the rest.

### YouTube Actions
Managing the channel after publishing. Every call spends the account's daily YouTube allowance (2,000 units on paid plans, 200 on free; searches 5 and 1 calls a day): check it with **Get Quota**. Destructive calls need **Confirm**, which is never on by default.
- **Get Videos** (by IDs, Most Popular chart or the channel's ratings) and **Get Quota**.
- **Playlists**: List Playlists, Create Playlist (50 units), Update Playlist, Delete Playlist (Confirm), List Playlist Videos, Add Video to Playlist (position, note), Remove Video From Playlist (Confirm).
- **Comments**: List Comments (one video or the whole channel inbox, moderation status, search), List Comment Replies, Reply to Comment (or comment on a video), Delete Comment (Confirm), Moderate Comments (approve, hold or reject up to 50; reject needs Confirm, optional Ban Author). Writes cost 50 units.
- **Channel**: Get Channel, Update Channel (description, keywords, Extra Fields for country, default language, translations).
- **Search** (query, only my videos, channel, type, order).
- **Live**: List Live Broadcasts, Create Live Broadcast (optionally with its stream; the stream key in the answer is a secret).
- Upload Video: **YouTube Localizations (JSON)** (translated title and description, needs YouTube Default Language) and **YouTube Brand Partner** (brand channel ID `UC…`).

### Scheduled Posts
- **List Scheduled Posts**: Lists future scheduled jobs.
- **Cancel Scheduled Post**: Cancels a scheduled job by its Job ID.
- **Edit Scheduled Post**: Updates a scheduled job (e.g., new scheduled date/time).
  - Tip: You can schedule any Upload action by providing the `Scheduled Date` during upload.

### Platform Selectors (Dynamic)
- **Facebook Pages**: Dynamic picker for Facebook pages, or enter ID via expression. Required for all Facebook operations.
- **LinkedIn Pages**: Dynamic picker for organization pages with "Me (Personal Profile)" option, or enter ID via expression.
- **Pinterest Boards**: Dynamic picker for Pinterest boards, or enter ID via expression. Required for all Pinterest operations.

### User Actions (incl. JWT for custom platform integration)
- ⚠️ **JWT endpoints are only needed if you integrate Upload-Post into your own platform** and want end-users to link their social accounts via your UI.
- **List Users**: Retrieve Upload-Post profiles created under your API key.
- **Create User**: Create a new user profile.
  - Parameters: New User Identifier (username).
- **Delete User**: Delete an existing user profile.
  - Parameters: Username to delete.
- **Generate JWT (for platform integration)**: Generate a connection URL (JWT) for a given profile so the user can link social accounts.
  - Parameters: User Identifier, optional redirect URL, logo image URL, redirect button text, platform restrictions, calendar options, connect title/description, language, UI labels.
  - **Language**: forces the connection page language. Supported: English, Spanish, German, French, Portuguese, Polish, Turkish. Leave on Auto-Detect to use the visitor's browser language (falls back to English).
  - **UI Labels**: white-label overrides for individual connection page texts, as key/value pairs (sent as `ui_labels`). The key is an i18n dot-path such as `connect.connectButton`, the value the replacement string. The API accepts up to 100 entries, keys matching `^[a-zA-Z0-9_.]+$` and values of up to 300 characters, and rejects the request otherwise.
- **Validate JWT (for platform integration)**: Validate a connection token from your backend.
  - Parameters: JWT token (password field).
  - The API response is returned as-is; its `profile` object also carries the `ui_labels` map configured for that profile.
- **Get / Update Notification Preferences, Test Notifications**: Webhook URL and events (`upload_completed`, `social_account.*`, `dm_received`, `comment_received`).
  - Webhooks are delivered **at least once**: a timeout, connection error, `5xx`, `408` or `429` is retried up to 6 attempts over about 8.5 hours (+1 min, +5 min, +30 min, +2 h, +6 h) with the same body and the same `X-Upload-Post-Delivery` header, so deduplicate by that header. `X-Upload-Post-Attempt` carries the attempt number. Other `4xx` answers are final.
- **List Webhook Deliveries**: The last 7 days of outgoing webhooks, newest first, with status (`pending`, `delivered`, `failed`, `cancelled`), attempts and the HTTP code your endpoint answered.
  - Parameters: Event, Status, Request ID, Job ID, Profile Username (all optional filters), Page Size (1-100, default 20), Page (1-50), Include Payload.
- **Get Webhook Delivery**: One delivery with its attempts and the exact payload that was sent.
- **Redeliver Webhook**: Send a logged delivery again now, to the webhook URL configured today. It is a new delivery with its own ID (`X-Upload-Post-Redelivery-Of` names the original). `409` when there is no webhook, event subscription or allowed URL to send it to.

### Comment Actions
The comment endpoints are shaped like the rest of the API: **one endpoint per question, with a `platform` parameter** that says which connected network is being asked. There is no endpoint per social network.
- **Get Post Comments**: Comments on a post from the network given by `Platform`.
  - Parameters: User Identifier, Platform, Post ID or URL, Comment ID (optional), Page Size (optional, 1-50), After (Cursor) (optional, the `pagination.next_cursor` of the previous page).
  - Instagram and Facebook accept the media ID or the post URL, YouTube the video ID, LinkedIn the post URN, TikTok the video ID. TikTok has no URL lookup, so pasting a URL fails with a descriptive error instead of an upstream one.
  - Fill **Comment ID** to get the replies to that comment instead of the top-level comments of the post. It is the same question with one parameter more, not a separate operation. Replies work on Instagram, Facebook, LinkedIn (company Pages), TikTok, Threads and YouTube; X and Bluesky answer `platform_not_supported`.
    - Instagram: the numeric comment ID. Facebook: the `{post}_{comment}` ID; Post ID is still needed (its `{page_id}_` prefix picks the Page). LinkedIn: preferably the `comment_urn` from the listing; a bare ID is only looked up among the post's first 250 comments (`404 linkedin_comment_not_found` otherwise).
    - Errors: `400 invalid_comment_id` (wrong format), `404 comment_not_found` (Instagram/Facebook), `403 linkedin_personal_not_supported` / `linkedin_page_access_denied`. A comment without replies is a `200` with an empty list.
- **Comment Action**: Moderate one comment — hide, unhide, like, unlike, pin or unpin it.
  - Parameters: User Identifier, Platform, Comment ID, Action, Post ID (shown only when it is needed).
  - Each action carries its own inverse, so there is no separate toggle: `hide`/`unhide`, `like`/`unlike`, `pin`/`unpin`.
  - **Post ID** is required for `hide`, `unhide`, `pin` and `unpin`, and is never sent for `like`/`unlike` — the API rejects a like that carries a post. The node checks it before the request leaves n8n.
  - TikTok is the network that answers this today, and its profile needs the `comments` capability (see the `capabilities` array returned by **List Users**); an account connected before that capability existed has to reconnect TikTok.
- **Private Reply to Comment**: DM the author of a comment. Instagram only.
- **Public Reply to Comment**: Public reply under the comment. Instagram only.
- **Create Comment**: Top-level comment or reply (Instagram replies only; TikTok always needs the video ID).
- **Delete Comment**: Delete a comment you own or that is on your post.
- **Create / List / Pause / Resume / Delete AutoDM Rule** (Instagram, account-wide): one rule answers with a DM every comment on any post or reel of the account, present and future, plus story replies, story mentions and DMs with a keyword. Rules never expire, do not count towards the 2 monitors per profile per day, and work from Meta webhooks only.
  - Create parameters: User Identifier, Reply Message (max 1,000 characters; 640 with buttons), Triggers (`comment`, `story_reply`, `story_mention`, `dm_keyword`), Trigger Keywords (comma-separated, up to 20; required for `dm_keyword`), Buttons (up to 3), Per-User Cooldown (whole hours, 0-720, default 24; story and DM triggers always wait at least 24 h).
  - Up to 10 rules per Instagram account. A post with its own monitor is answered by that monitor only. Pace: 25 DMs per account every 15 minutes plus the plan's daily DM allowance; what does not fit is queued for up to 24 hours.
  - List shows each rule's `status` (`active`, `paused`, `reconnect_required`, `stopped` with `stop_reason`, `disabled`), `stats`, `pending` and `webhook` (`receiving_events`, `last_event_at`, `hint`): if Meta stops sending events to an account, you see it there.
  - Errors: `502 webhook_subscription_failed` (reconnect Instagram), `409 duplicate_rule` / `rule_limit_reached` / `rule_creation_in_progress` / `rule_stopped`, `503 account_rules_disabled`.

### Direct Message Actions
- **Send DM**: Send a direct message from the Instagram, WhatsApp or Bluesky account of a profile, or a sender action.
  - Parameters: User Identifier, Platform, Recipient ID, Message, Reply To, Sender Action, Message ID, Reaction; Instagram: Buttons, Extra Fields (JSON: `attachments`, `quick_replies`, `generic_template`); WhatsApp: Action, Template Name / Language / Components, Attachments, Location, Contacts, Interactive Message (Reply Buttons, List, Call-to-Action URL Button, Header, Footer), Extra Fields (JSON); Bluesky: Conversation ID, Share Bluesky Post URL.
  - WhatsApp: a messaging channel only (WhatsApp does not publish posts). The profile connects its own WhatsApp Business number (Meta bills the conversations to that WhatsApp Business account). Recipient ID is the phone number in international format (`+34600111222`). Free text (up to 4,096 characters) only within 24 hours of the person's last message; after that only an approved **template** is delivered (otherwise `meta_error_code 131047`). Attachments (up to 10: image, video, audio, document, sticker) by HTTPS URL or by the `media_id` of **Upload WhatsApp Media**; a single image, video or document takes Message as caption. Location, contacts (1-10 cards) and interactive messages (up to 3 reply buttons, a list of up to 10 rows, or a link button; Message is the body, max 1,024) are sent as their own message type. Actions on a received message (Message ID = its `wamid`): React, Remove Reaction, Mark Read (optionally with typing), Typing On; they spend no DM quota. Errors: `400 whatsapp_invalid_request`, `401 whatsapp_reauth_required` (reconnect the number), `meta_error_code 131026` (undeliverable), `131030` (test number: recipient not allowed).
  - Instagram: the person must have written to the account in the last 24 hours. Sender actions: `typing_on`, `typing_off`, `mark_seen`, `react`, `unreact`.
  - Bluesky: the account must be connected with an app password created with **"Allow access to your direct messages"** (otherwise `403 bluesky_dm_scope_missing`: create one in Bluesky > Settings > Privacy and security > App passwords and reconnect). Recipient ID is a handle, DID or profile link. Messages up to 1,000 characters, up to 10 clickable `@mentions`; a Bluesky post can be shared; no images or files. Sender actions: `mark_read`, `react`/`unreact` (a single emoji), `delete` (for you), `accept`, `mute`, `unmute`, `leave`.
  - Bluesky `504 bluesky_send_unconfirmed` (`retryable: false`) means the DM may have gone out: read the conversation before sending again. `403 bluesky_recipient_unavailable` carries the `reason` and spends no quota.
- **List Conversations**: DM conversations newest first, with participants and recent messages.
  - Parameters: User Identifier, Platform, Page Size, Messages per Conversation, Cursor, Since, Participant ID; Bluesky: Conversation ID, Messages Cursor, Status (`request`/`accepted`), Read State (`unread`).
  - Bluesky returns at most 25 conversations per page; when a page takes too long the rest come with only their latest message and `messages_truncated: true`.
  - WhatsApp: Participant ID is a phone number; received media come with a `media_id` (download it with **Download WhatsApp Media**).
  - New DMs can also reach you as the `dm_received` webhook (Bluesky is checked every 5 minutes).
- **Upload WhatsApp Media**: Upload a file from a binary property and get a `media_id` to use in Send DM attachments. Limits: image 5 MB (JPEG/PNG), video 16 MB (MP4/3GPP), audio 16 MB, document 100 MB, sticker 500 KB (WebP).
- **Download WhatsApp Media**: Download a `media_id` (a file someone sent you) into a binary property, with its MIME type.
- **List / Create / Delete WhatsApp Templates**: Message templates of the WhatsApp Business account. Create takes Name (lowercase, numbers, underscores), Category (`UTILITY`, `MARKETING`, `AUTHENTICATION`), Language and either Body (with `{{1}}` variables), Body Examples, Header, Footer and Buttons (URL, phone or quick reply), or Components (JSON, Meta format). Meta reviews each template (`PENDING`, then `APPROVED` or `REJECTED`).
- **Get / Update WhatsApp Business Profile**: About, address, description, email, websites (up to 2), category and profile photo (JPEG/PNG up to 5 MB from a binary property) of the connected number.
- **List / Create or Update / Delete WhatsApp QR Codes**: QR codes and wa.me links that open a chat with your number and a prefilled message (max 140 characters).

### Insight Actions
Two more questions with a `platform` parameter, not two TikTok endpoints. A network that cannot answer a question replies with `platform_not_supported` and the list of the ones that can; today that network is TikTok, whose profile needs the `profile_analytics` capability (see the `capabilities` array returned by **List Users**).
- **Get Audience**: Who follows the profile and when they are around — audience countries, cities, age brackets and genders, followers online per hour, daily followers gained and lost, profile actions and the bio.
  - Parameters: User Identifier, Platform, Start Date, End Date, Benchmark Category (all optional except the first two).
  - Dates are `YYYY-MM-DD`. The window is clamped **by the server**: 60 days at most, and End Date always below today. A wider range is trimmed, not rejected, so the node sends it as typed.
  - Filling **Benchmark Category** adds a `benchmark` object with that niche's averages (comments, engagement rate, follower count and growth, likes, shares, video count and views) next to the account's own numbers. The 25 accepted values come back in `benchmark_categories` on every response, so filling a picker needs no extra call.
  - Use this to know *who* the audience is and *when* to post; use **Get Post Analytics** for how a given post did.
- **Get Suggestions**: What to write about — hashtags or the searches people run around a seed word.
  - Parameters: User Identifier, Platform, Type (`hashtags` / `keywords`), Query, Country Code, Language.
  - `Type = hashtags` answers with `hashtags: [{ name, view_count }]`; `Type = keywords` answers with `keywords: [...]`. One endpoint, told apart by `type`, not by operation.

Refer to the [Upload Post API Documentation](https://docs.upload-post.com) for detailed information on parameters and platform requirements.

### Waiting for asynchronous uploads

Some uploads are processed asynchronously and the API returns immediately with a `request_id`. This happens when:
- You enable "Upload Asynchronously" in the node, or
- The upload exceeds the server's synchronous wait window, in which case the API switches to async mode automatically.

Leaving "Upload Asynchronously" enabled is recommended. Turning it off holds the HTTP connection open for the whole upload, which makes a proxy or execution timeout — and therefore a retry — more likely.

You have two ways to handle this in n8n:

1) Best-effort polling inside the node
- In Upload operations (Photos/Video/Text), enable "Wait for Completion".
- Configure "Poll Interval (Seconds)" (default 10) and "Timeout (Seconds)".
- The node sleeps between checks (using n8n's `sleep`) and calls `GET /api/uploadposts/status?request_id=...` until success/failure or timeout.
- Note: This does not guarantee completion in hosted environments with strict execution limits.
- A post by a team Editor or Contributor that goes to approval comes back as `202` with `pending_approval: true` (or `approval_status: "draft"`) and an `approval_id`: nothing is published until the owner or an Admin approves it, so the node returns that answer at once instead of polling.

2) Workflow-level polling (recommended for reliability)
- Use the Upload operation, read `request_id` from its output.
- Add a Wait node (e.g., 10s), then call "Get Upload Status" passing the `request_id`.
- Loop with an IF node until the status is final (success/failed) or a max attempts limit is reached.

### Duplicate posts and retries

Every upload sends an `Idempotency-Key`. The API collapses two uploads carrying the same key within a 24-hour window into a single post, so a retried upload does not publish twice.

The key is derived from the workflow execution, the node, the run of the node (`$runIndex`), the item index and a hash of the content (every field, plus the name, type and size of each file). It stays the same when n8n's "Retry On Fail" re-runs the node, and changes for every pass of a loop (Loop Over Items runs the node again with item 0 each time) and for any other content. Versions up to 0.9.0 left the run and the content out, so in a loop every pass after the first got the first post back instead of publishing.

If a field changes on every attempt (an expression built from `$now`, for example), a retry counts as different content: set the "Idempotency Key" field yourself in that case, or when you drive retries from outside n8n and need to control the key.

If you saw duplicate posts on an older version of this node, upgrade: versions before 0.1.51 sent no key at all, and a node-level retry after a network timeout would publish the post a second time.

### Platform-Specific Options

#### New in 0.11.0
- **Threads Options**: GIF ID and Ghost Post (Upload Text), Spoiler Media (Upload Photo(s) / Video), Text Spoilers.
- **Facebook Text Options**, Upload Text: Backdated Time and its granularity.
- **Instagram Options (Single Video)**, Upload Photo(s): when the only item is a video it is published as a Reel with Cover URL, Thumbnail Offset, Share to Feed and Audio Name.
- **Create Comment > Image URL** (TikTok) and **Get Suggestions > Trending / Personalized** (TikTok).
- **Direct Message > Extra Fields (JSON)**, WhatsApp: flow, location_request, carousel and call_button.

#### Facebook
- **Page Selection**: Dynamic picker for Facebook pages (required for all operations).
- **Media Type (Video)**: Reels or Stories.
- **Video State**: Published or Draft.
- **Link (Text)**: URL for link preview in text posts.

#### LinkedIn
- **Mentions**: write `@[Exact Page Name](urn:li:organization:ID)`, `@[Name](urn:li:person:ID)` or `@company-vanity` in the LinkedIn post text (put them in the description for photos and videos). Get the URN and exact name with **Resolve LinkedIn Organization**.
- **Page Selection**: Dynamic picker for organization pages ("Me" option for personal profiles).
- **Visibility (Photos/Video)**: Public, Connections, Logged In, Container (video only).
- **Video Description**: User commentary for video posts.

#### Instagram
- **Media Type**: Image (feed photos), Stories, Reels (video).
- **Video Options**: Share to feed, collaborators (comma-separated usernames), cover URL, audio name, user tags (comma-separated), location ID, thumb offset.
- **Photo Cover Index**: Which photo to use as cover (0-based index).

#### TikTok
- **Photo Options**: Auto-add music, disable comments, photo cover index, brand content toggles (paid partnerships/third-party brands vs own business).
- **Video Options**: Privacy level (Public/Mutual Friends/Followers/Self), disable duet/stitch/comments, cover timestamp (ms), brand content toggles, AI-generated content flag, post mode (Direct Post/Media Upload).
- **Brand Content**: Separate toggles for paid partnerships and own business promotion.

#### TikTok Advanced Video Options

> **Capability-gated.** `GET /api/uploadposts/users` returns a `capabilities`
> array on each TikTok account (`music`, `location`, `cover_image`,
> `cover_timestamp`, `draft`, `photo_privacy`, `video_privacy`,
> `inbox_fallback`, `profile_analytics`). If the connection does not declare the capability an option
> needs, the API ignores that field, the post still publishes and the response
> includes a per-field warning — reconnect the TikTok account to enable it.
> These options are only sent when actually filled in, so leaving them at their
> defaults keeps the previous behaviour.

- **Music** (`music`): TikTok Music ID — the `id` of a track returned by `GET /api/uploadposts/tiktok/music/trending` or `GET /api/uploadposts/tiktok/music/search` (not its `commercial_music_id`) — plus music volume (0-100) and music start/end offsets in ms. The Music ID works on **video and photo** posts; the volume and the offsets are video-only, because TikTok's photo contract takes the track id alone.

  To pick a track by name inside a workflow, put an **HTTP Request** node before
  this one calling
  `GET https://api.upload-post.com/api/uploadposts/tiktok/music/search?profile=<profile>&q=<song or artist>`
  with the header `Authorization: Apikey <your key>`, and feed `tracks[0].id`
  into TikTok Music ID. It also accepts `genre`, `country_code`, `date_range`
  and `limit`. Note that TikTok has **no music search endpoint**: the search
  runs over the trending charts Upload-Post caches per genre/country/period, so
  it finds trending tracks, not TikTok's entire catalogue.
- **Original Sound Volume**: Volume (0-100) of the video's own audio when music is added. Keep it above 0 so the original audio is not muted. Music volume and original sound volume are only sent when a Music ID is set.
- **Location** (`location`): TikTok Location ID plus TikTok Location Name — TikTok requires both together. Works on video and photo posts.
- **Cover Image URL** (`cover_image`): Custom cover image, takes priority over the cover timestamp. Video only.
- **Is AI Generated**: AI-generated content disclosure. Works on video and photo posts.
- **Upload to Draft** (`draft`): Sends the video to TikTok drafts instead of publishing; TikTok then ignores the rest of the post settings. Video only.

> **Privacy level on TikTok.** `privacy_level` is accepted on video and photo
> uploads alike (capabilities `video_privacy` / `photo_privacy`), but **TikTok
> decides per account which values are available**: a private account is offered
> Followers / Mutual Friends / Self Only and has no Public. Asking for one the
> account does not have fails with `tiktok_privacy_unavailable`, and the error
> lists the ones it does have. The **Account Default** option on the TikTok
> Privacy Level (Video) field sends nothing and lets TikTok apply the account's
> own setting — the only choice guaranteed to work on every account, and the
> default for new nodes. Photo posts default to Public. To pick a value up front,
> query `GET /api/uploadposts/tiktok/settings?profile=<profile>` from an HTTP
> Request node and read `privacy_level_options`.

#### YouTube
- **Video Metadata**: Tags (comma-separated), category ID, privacy status (public/unlisted/private), embeddable, license, public stats viewable.
- **Compliance**: Made for kids declaration, self-declared made for kids (COPPA), contains synthetic media (AI transparency), has paid product placement (FTC).
- **Geo-Restrictions**: Allowed/blocked countries (ISO 3166-1 alpha-2 codes, mutually exclusive).
- **Language Settings**: Default language (title/description), default audio language.
- **Recording Date**: ISO 8601 timestamp.
- **Thumbnail**: Custom thumbnail via URL or binary file.

#### X (Twitter)
- **Common Options**: Tagged user IDs (comma-separated), reply settings (everyone/following/mentioned/verified/subscribers), geo place ID, long text as single post.
- **Video/Photo Options**: Nullcast (promoted-only posts), place ID.
- **Text Options**: Poll options (2-4 options, 25 chars max each, 5-10080 min duration), poll reply settings, post URL, quote tweet ID, card URI, direct message deep link.
- **Community Features**: Community ID, share with followers.
- **Super Followers**: Exclusive content for super followers.
- **Validation**: Poll options mutually exclusive with card URI, quote tweet ID, and direct message deep link.

#### Threads
- **Text Options**: Long text as single post (otherwise creates thread if >500 chars).
- **Video Options**: Description override support.

#### Pinterest
- **Board Selection**: Dynamic picker for Pinterest boards (required).
- **Link**: Optional link attachment.
- **Video Cover**: URL, base64 data with content type, or keyframe timestamp.

#### Reddit
- **Text Options**: Subreddit (without r/), flair ID for post categorization.

#### Bluesky
- **Images**: 4 per post by default (more are dropped with a warning). Turn on **Bluesky Gallery** (Upload Photo(s)) to publish up to 10 images as a gallery; with more than 10 the first 10 are published and the response carries a warning.

### Validation Rules & Restrictions

#### X (Twitter) Poll Validation
- **Options Count**: Must contain 2-4 non-empty options.
- **Option Length**: Each option cannot exceed 25 characters.
- **Duration**: Must be between 5 and 10080 minutes (5 minutes to 7 days).
- **Mutually Exclusive**: Poll options cannot be used with Card URI, Quote Tweet ID, or Direct Message Deep Link.

#### Platform-Specific Requirements
- **Facebook**: Page selection is required for all operations.
- **Pinterest**: Board selection is required for all operations.
- **LinkedIn Photos**: Only supports PUBLIC visibility (API limitation).
- **YouTube**: Allowed/blocked countries are mutually exclusive.
- **Instagram Video**: Media type automatically defaults to REELS if invalid, IMAGE for photos.
- **TikTok Photos**: Media type automatically defaults to IMAGE if invalid.

#### File Handling
- **Photos**: Comma-separated list supporting both file paths and URLs.
- **Videos**: Single file path or URL.
- **YouTube Thumbnails**: Supports both URL and binary file uploads.
- **Pinterest Covers**: Multiple options (URL, base64 data with content type, or keyframe timestamp).

#### Scheduling
- **Date Format**: Automatic conversion to ISO 8601 with UTC timezone if not provided.
- **Asynchronous Processing**: Automatic fallback to async mode if upload exceeds 59 seconds.

### Title & Description Overrides
- **`Title / Main Content`**: Generic title used across platforms.
- **Platform Title Overrides**: `[platform]_title` (e.g., `x_title`, `pinterest_title`, `threads_title`).
  - Available for: instagram, facebook, tiktok, linkedin, x, youtube, pinterest, threads
- **`Description (Optional)`**: Generic description used for LinkedIn, Facebook, YouTube, Pinterest, TikTok when supported.
- **Platform Description Overrides**: `[platform]_description` (e.g., `youtube_description`, `linkedin_description`).
  - Available for: facebook, tiktok, linkedin, youtube, pinterest
- **`First Comment`**: Generic first comment posted right after publishing.
- **Platform First Comment Overrides**: `[platform]_first_comment` (e.g., `instagram_first_comment`, `tiktok_first_comment`).
  - Available for: instagram, facebook, x, threads, youtube (video only), reddit, bluesky, linkedin, tiktok (media only).
  - TikTok needs the `comments` capability on the profile's TikTok account.

**⚠️ Runtime Validations**: The node performs automatic validations at runtime including poll constraints, mutually exclusive field checks, and platform-specific requirements. Invalid configurations will throw descriptive error messages.

Related docs:
- Profiles & JWT reference (context): [User Profiles API](https://docs.upload-post.com/api/user-profiles#create-user-profile)

## Resources

*   [n8n community nodes documentation](https://docs.n8n.io/integrations/community-nodes/)
*   [Upload Post Website](https://www.upload-post.com/)
*   [Upload Post API Documentation](https://docs.upload-post.com)

## Compatibility

Tested with n8n version 1.x. The Upload Post Trigger was checked on n8n 2.47 (loading, credential, activation, signed deliveries, test URL).
Requires Node.js version 20.15 or later.

## Development

If you want to contribute to this node or run it locally for development:

1.  Clone this repository: `git clone https://github.com/Upload-Post/n8n-nodes-upload-post` (replace `your-github-username`)
2.  Install dependencies: `npm i`
3.  Build the node: `npm run build`
4.  Link the package to your n8n instance for testing. Refer to [Run your node locally](https://docs.n8n.io/integrations/creating-nodes/test/run-node-locally/).

## License

[MIT](LICENSE.md)
<!-- deployed 2026-03-16 17:49 UTC -->
