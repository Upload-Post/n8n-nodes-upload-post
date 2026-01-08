# Upload Post Node - Agent Integration Guide

This guide explains how AI agents can effectively use the Upload Post node in n8n workflows to automate social media content publishing across multiple platforms.

## Overview

The Upload Post node enables automated publishing to:
- **Instagram** (Photos, Videos, Stories, Reels)
- **Facebook** (Photos, Videos, Text, Pages)
- **LinkedIn** (Photos, Videos, Text, Pages)
- **TikTok** (Photos, Videos)
- **X (Twitter)** (Photos, Videos, Text, Polls)
- **YouTube** (Videos)
- **Pinterest** (Photos, Videos, Boards)
- **Threads** (Photos, Videos, Text)
- **Reddit** (Text posts)

## Agent Integration Capabilities

### Direct Workflow Invocation
Agents can trigger Upload Post workflows by:
- Calling n8n webhooks with content data
- Using the n8n API to execute workflows
- Integrating with n8n's agent framework

### Content Generation & Publishing Flow
```
Agent → Content Generation → Upload Post Node → Multiple Platforms
```

### Supported Agent Operations

#### Content Upload Operations
- **Upload Photos**: Single or multiple images with platform-specific customization
- **Upload Videos**: Video content with thumbnails and metadata
- **Upload Text**: Text posts, including polls on X/Twitter

#### Management Operations
- **Get Upload Status**: Check async upload completion
- **Get Upload History**: Retrieve past uploads
- **List Scheduled Posts**: View future scheduled content
- **Cancel/Edit Scheduled Posts**: Modify scheduled content

#### User Management
- **Create/List/Delete Users**: Manage Upload Post profiles
- **Generate/Validate JWT**: Platform integration tokens

## Agent Usage Examples

### Basic Content Publishing

```json
{
  "operation": "uploadPhotos",
  "user": "my_profile",
  "platform": ["instagram", "facebook"],
  "title": "Beautiful sunset view",
  "description": "Captured this amazing sunset during my evening walk",
  "photos": "{{ $binary.data }}"
}
```

### Video Upload with Platform-Specific Settings

```json
{
  "operation": "uploadVideo",
  "user": "creator_profile",
  "platform": ["youtube", "tiktok", "instagram"],
  "title": "Tutorial: Getting Started with AI",
  "description": "Learn the basics of artificial intelligence",
  "video": "{{ $binary.video }}",
  "youtubeTitle": "AI Tutorial for Beginners",
  "youtubeDescription": "Complete guide to AI fundamentals",
  "youtubeTags": "AI, tutorial, beginners, machine learning",
  "tiktokTitle": "AI Basics in 5 Minutes! 🤖",
  "instagramMediaType": "REELS"
}
```

### Scheduled Content Publishing

```json
{
  "operation": "uploadText",
  "user": "business_profile",
  "platform": ["linkedin", "facebook"],
  "title": "Exciting company news coming soon!",
  "scheduledDate": "2024-12-25T10:00:00Z",
  "facebookTitle": "🚨 Big Announcement 🚨",
  "linkedinTitle": "Important Update from Our Team"
}
```

### Poll Creation on X/Twitter

```json
{
  "operation": "uploadText",
  "user": "social_profile",
  "platform": ["x"],
  "title": "What's your favorite programming language?",
  "xPollOptions": "JavaScript, Python, TypeScript, Go",
  "xPollDuration": 1440
}
```

## Agent Best Practices

### Content Preparation
1. **Optimize Media**: Ensure images/videos meet platform requirements
2. **Platform-Specific Customization**: Use title/description overrides for each platform
3. **Hashtag Strategy**: Include relevant hashtags in platform-specific titles

### Error Handling
```json
{
  "operation": "getStatus",
  "requestId": "{{ $node.uploadPost.output.request_id }}"
}
```

### Workflow Design
1. **Async Processing**: Use `uploadAsync: true` for large uploads
2. **Status Polling**: Implement polling for async operations
3. **Fallback Strategies**: Handle platform-specific failures gracefully

### Rate Limiting & Scheduling
- Schedule content during optimal posting times
- Space out multi-platform publishing to avoid rate limits
- Use the scheduling feature for precise timing

## Platform-Specific Agent Considerations

### Instagram
- **Media Types**: IMAGE (feed), STORIES, REELS
- **Video Options**: Share to feed, collaborators, cover URL
- **Best Practice**: Use high-quality, vertical videos for Reels

### TikTok
- **Photo Options**: Auto-add music, disable comments
- **Video Options**: Privacy levels, duet/stitch controls
- **AI Content**: Declare AI-generated content when applicable

### YouTube
- **Metadata**: Tags, categories, privacy settings
- **Compliance**: Made for kids, synthetic media declarations
- **Geo-Restrictions**: Country-specific availability

### X (Twitter)
- **Rich Features**: Polls, quote tweets, threads
- **Validation**: Poll options (2-4, max 25 chars each)
- **Timing**: Optimal engagement windows

### LinkedIn
- **Professional Focus**: Use appropriate tone and formatting
- **Page Selection**: Target specific organization pages
- **Visibility**: Public, connections, or logged-in users

## Agent Workflow Patterns

### Content Calendar Automation
```
Agent analyzes trends → Generates content → Schedules across platforms → Monitors performance
```

### Social Media Management
```
Agent monitors mentions → Generates responses → Posts replies → Tracks engagement
```

### Multi-Platform Publishing
```
Agent creates content → Customizes per platform → Uploads simultaneously → Reports results
```

## Monitoring & Analytics

### Track Upload Success
```json
{
  "operation": "getAnalytics",
  "analyticsProfileUsername": "my_profile",
  "analyticsPlatforms": ["instagram", "facebook"]
}
```

### Async Upload Monitoring
```json
{
  "operation": "getStatus",
  "requestId": "{{ previous_request_id }}",
  "waitForCompletion": true,
  "pollInterval": 5,
  "pollTimeout": 300
}
```

## Security & Authentication

- Store API keys securely in n8n credentials
- Use JWT tokens for platform integrations when needed
- Implement proper user profile management
- Validate all inputs before publishing

## Performance Optimization

### Batch Processing
- Group similar content uploads
- Use async processing for large files
- Implement retry logic for failed uploads

### Resource Management
- Monitor API rate limits per platform
- Cache user profiles and platform data
- Optimize media file sizes before upload

## Troubleshooting for Agents

### Common Issues
1. **Authentication Errors**: Verify API key and user profiles
2. **File Upload Failures**: Check file formats and sizes
3. **Platform-Specific Errors**: Review platform requirements
4. **Async Timeout**: Increase polling timeout for large files

### Debug Information
- Use `getStatus` to check upload progress
- Review response data for error messages
- Enable logging in n8n workflows

## Integration Examples

### Webhook Integration
```
POST /webhook/upload-content
Content-Type: application/json

{
  "content": "Generated post content",
  "platforms": ["instagram", "twitter"],
  "media": "base64_encoded_image"
}
```

## Resources

### Complete API Documentation
For comprehensive technical documentation including all API endpoints, parameters, and examples:

**📖 [Upload-Post API Documentation](https://docs.upload-post.com/llm.txt)**  
Complete API reference in LLM-friendly format with all endpoints, parameters, and examples.

This integration enables AI agents to seamlessly publish content across social media platforms while maintaining platform-specific optimization and proper error handling.