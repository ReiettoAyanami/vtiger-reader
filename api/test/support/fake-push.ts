import { createECDH, randomBytes } from 'node:crypto';
import type { PushSend } from '../../src/modules/notifications/push.js';

/** What a browser would give: an endpoint at a push service, and its keys (a real P-256 point). */
export function browserSubscription(endpoint = `https://push.example.com/send/${randomBytes(8).toString('hex')}`) {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    endpoint,
    expirationTime: null,
    keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') },
  };
}

/** A push service: records what is sent; the endpoints in `gone` answer 410, as an expired subscription does. */
export class FakePush {
  readonly sent: Array<{ endpoint: string; message: { title: string; body: string; url: string; tag: string }; subject: string }> = [];
  readonly gone = new Set<string>();

  readonly send: PushSend = async (subscription, payload, options) => {
    if (this.gone.has(subscription.endpoint)) throw Object.assign(new Error('Received unexpected response code'), { statusCode: 410 });
    this.sent.push({ endpoint: subscription.endpoint, message: JSON.parse(payload), subject: options.vapidDetails.subject });
    return { statusCode: 201 };
  };
}
