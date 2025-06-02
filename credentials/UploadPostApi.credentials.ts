import {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class UploadPostApi implements ICredentialType {
	name = 'uploadPostApi';
	displayName = 'Upload Post API';
	readonly icon = 'file:UploadPost.svg';

	documentationUrl = 'https://docs.upload-post.com';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			placeholder: 'Enter your Upload-Post API Key',
			description: 'You can find your API key here: https://app.upload-post.com/api-keys',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'Authorization': '=Apikey {{$credentials.apiKey}}'
			}
		},
	};

	// Test request to check if the credentials are valid
	// This will make a GET request to /api/uploadposts/me to verify the API key.
	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.upload-post.com/api',
			url: '/uploadposts/me',
			method: 'GET',
			headers: {
				'Authorization': '=Apikey {{ $credentials.apiKey }}',
			},
		},
	};
}
