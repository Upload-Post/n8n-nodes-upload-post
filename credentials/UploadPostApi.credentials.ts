import {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class UploadPostApi implements ICredentialType {
	name = 'uploadPostApi';
	displayName = 'Upload Post API';

	documentationUrl = 'https://docs.upload-post.com/api';

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
