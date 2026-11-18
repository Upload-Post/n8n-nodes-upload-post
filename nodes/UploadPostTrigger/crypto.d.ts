// n8n Cloud lets community nodes import Node's 'crypto' module, but this package
// has no @types/node (no new dependencies): declare only what the nodes use.
declare module 'crypto' {
	interface Hmac {
		update(data: string | Uint8Array): Hmac;
		digest(encoding: 'hex'): string;
	}
	export function createHmac(algorithm: 'sha256', key: string): Hmac;
	export function createHash(algorithm: 'sha256'): Hmac;
}
