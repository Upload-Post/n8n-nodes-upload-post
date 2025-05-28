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

The node provides the following operations:

*   **Upload Photo(s)**: Upload one or more photos to supported platforms.
    *   Supports file uploads and photo URLs.
    *   Common parameters: User Identifier, Platform(s), Title, Photos (Files or URLs), Caption.
    *   Platform-specific parameters are available for LinkedIn, Facebook, TikTok, and Instagram.
*   **Upload Video**: Upload a single video to supported platforms.
    *   Supports file uploads and video URLs.
    *   Common parameters: User Identifier, Platform(s), Title, Video (File or URL).
    *   Platform-specific parameters are available for LinkedIn, Facebook, TikTok, Instagram, YouTube, Threads, and X (Twitter).
*   **Upload Text**: Upload a text-based post to supported platforms.
    *   Common parameters: User Identifier, Platform(s), Title (used as content for most platforms).
    *   Platform-specific parameters are available for LinkedIn, Facebook, Threads, and X (Twitter).

Refer to the [Upload Post API Documentation](https://docs.upload-post.com/api) for detailed information on parameters and platform requirements.

## Resources

*   [n8n community nodes documentation](https://docs.n8n.io/integrations/community-nodes/)
*   [Upload Post Website](https://www.upload-post.com/)
*   [Upload Post API Documentation](https://docs.upload-post.com/api)

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
