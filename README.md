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

## Operations

The node provides the following operations grouped for clarity:

### Upload Actions
- **Upload Photo(s)**: Upload one or more photos to supported platforms.
  - Supports file uploads and photo URLs (comma-separated list).
  - Common parameters: User Identifier, Platform Names or IDs, Title / Main Content, Description (optional), Photos (Files or URLs), Scheduled Date (optional).
  - Title/Description overrides per platform: `instagram_title`, `facebook_title`, `tiktok_title`, `linkedin_title`, `x_title`, `youtube_title`, `pinterest_title`, `threads_title`.
  - Platform-specific parameters available for: Facebook, Instagram, LinkedIn, Pinterest, TikTok, X (Twitter).
  - **Pinterest**: Requires Board selection via dynamic selector.
  - **Instagram**: Media Type (Image/Stories), TikTok: Auto-add music, disable comments, brand content toggles.
  - **Facebook**: Page selection via dynamic selector.
  - **LinkedIn**: Visibility settings (Photos only), Page selection via dynamic selector.
  - **X (Twitter)**: Tagged user IDs, reply settings, geo place ID.

- **Upload Video**: Upload a single video to supported platforms.
  - Supports file uploads and video URLs.
  - Common parameters: User Identifier, Platform Names or IDs, Title / Main Content, Description (optional), Video (File or URL), Scheduled Date (optional).
  - Title/Description overrides per platform: `instagram_title`, `facebook_title`, `tiktok_title`, `linkedin_title`, `x_title`, `youtube_title`, `pinterest_title`.
  - Platform-specific parameters available for: Facebook, Instagram, LinkedIn, Pinterest, Threads, TikTok, X (Twitter), YouTube.
  - **YouTube**: Custom thumbnail (URL/binary), tags, category, privacy, embeddable, license, public stats, made for kids, synthetic media declaration, geo-restrictions, paid product placement, recording date, default language/audio language.
  - **Facebook**: Page selection, video state (Published/Draft), media type (Reels/Stories).
  - **Instagram**: Media type (Reels/Stories), share to feed, collaborators, cover URL, audio name, user tags, location ID, thumb offset.
  - **TikTok**: Privacy level, disable duet/stitch/comments, cover timestamp, brand content toggles, AI-generated content flag, post mode.
  - **LinkedIn**: Visibility settings, Page selection, video description.
  - **Pinterest**: Board selection, cover image options (URL/base64/keyframe).
  - **X (Twitter)**: Tagged user IDs, reply settings, nullcast, place ID, long text handling.

- **Upload Text**: Upload a text-based post to supported platforms.
  - Common parameters: User Identifier, Platform Names or IDs, Title / Main Content (used as post content), Scheduled Date (optional).
  - Platform-specific parameters available for: Facebook, LinkedIn, Reddit, Threads, X (Twitter).
  - **Facebook**: Page selection, link URL for preview.
  - **LinkedIn**: Page selection ("Me" for personal profile).
  - **X (Twitter)**: Reply settings, poll options (2-4 options, 5-10080 min duration), post URL, quote tweet ID, geo place ID, super followers exclusivity, community ID, sharing options, direct message deep link, card URI, long text handling.
  - **Threads**: Long text as single post option.
  - **Reddit**: Subreddit selection, flair ID.

### Status & History Actions
- **Get Upload Status**: Check the status/result of an async upload by `request_id`.
  - Parameters: Request ID.
- **Get Upload History**: List past uploads.
  - Parameters: Page (default 1), Limit (default 20). Limit can be 20, 50, or 100.
- **Get Analytics**: Retrieve aggregated analytics for uploads.
  - Optional filters: From Date, To Date, User Filter, Platforms.

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
  - Parameters: User Identifier, optional redirect URL, logo image URL, redirect button text, platform restrictions.
- **Validate JWT (for platform integration)**: Validate a connection token from your backend.
  - Parameters: JWT token (password field).

Refer to the [Upload Post API Documentation](https://docs.upload-post.com) for detailed information on parameters and platform requirements.

### Waiting for asynchronous uploads

Some uploads are processed asynchronously and the API returns immediately with a `request_id`. This happens when:
- You enable "Upload Asynchronously" in the node, or
- The upload takes longer than ~59 seconds and the API switches to async mode automatically.

You have two ways to handle this in n8n:

1) Best-effort polling inside the node
- In Upload operations (Photos/Video/Text), enable "Wait for Completion".
- Configure "Poll Interval (Seconds)" (default 10) and "Timeout (Seconds)".
- The node sleeps between checks (using n8n's `sleep`) and calls `GET /api/uploadposts/status?request_id=...` until success/failure or timeout.
- Note: This does not guarantee completion in hosted environments with strict execution limits.

2) Workflow-level polling (recommended for reliability)
- Use the Upload operation, read `request_id` from its output.
- Add a Wait node (e.g., 10s), then call "Get Upload Status" passing the `request_id`.
- Loop with an IF node until the status is final (success/failed) or a max attempts limit is reached.

### Platform-Specific Options

#### Facebook
- **Page Selection**: Dynamic picker for Facebook pages (required for all operations).
- **Media Type (Video)**: Reels or Stories.
- **Video State**: Published or Draft.
- **Link (Text)**: URL for link preview in text posts.

#### LinkedIn
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

**⚠️ Runtime Validations**: The node performs automatic validations at runtime including poll constraints, mutually exclusive field checks, and platform-specific requirements. Invalid configurations will throw descriptive error messages.

Related docs:
- Profiles & JWT reference (context): [User Profiles API](https://docs.upload-post.com/api/user-profiles#create-user-profile)

## Resources

*   [n8n community nodes documentation](https://docs.n8n.io/integrations/community-nodes/)
*   [Upload Post Website](https://www.upload-post.com/)
*   [Upload Post API Documentation](https://docs.upload-post.com)

## Compatibility

Tested with n8n version 1.x.
Requires Node.js version 20.15 or later.

## Development

If you want to contribute to this node or run it locally for development:

1.  Clone this repository: `git clone https://github.com/Upload-Post/n8n-nodes-upload-post` (replace `your-github-username`)
2.  Install dependencies: `npm i`
3.  Build the node: `npm run build`
4.  Link the package to your n8n instance for testing. Refer to [Run your node locally](https://docs.n8n.io/integrations/creating-nodes/test/run-node-locally/).

## License

[MIT](LICENSE.md)