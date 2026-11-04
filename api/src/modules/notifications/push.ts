import webpush from 'web-push';
import type { Pool } from '../../db/pool.js';
import type { Owner } from '../../shared/owner.js';
import type { SecretBox } from '../../shared/secret-box.js';
import * as repo from './repository.js';

/** What a push notification carries to the service worker (web/public/push-sw.js). */
export interface PushMessage {
  title: string;
  body: string;
  /** The page the notification opens, on the app's own address ('/lenzi/tickets/17x1'). */
  url: string;
  /** One tag per user: a newer notification replaces the one still shown. */
  tag: string;
}

/** How a message reaches a push service (tests: a fake one). Its answer's status, or a thrown error. */
export type PushSend = (
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
  options: { vapidDetails: { subject: string; publicKey: string; privateKey: string }; TTL: number; urgency: 'high' },
) => Promise<{ statusCode: number }>;

const SEAL_CONTEXT = 'push_vapid';

/**
 * Web Push (plan 5.3): the instance's VAPID keys, made at the first need and kept in the database
 * (nothing to configure), and the sending, to every browser the user allowed. A subscription the
 * push service says is gone (404, 410) is deleted.
 */
export class PushSender {
  private keys: Promise<{ publicKey: string; privateKey: string }> | null = null;

  constructor(
    private readonly pool: Pool,
    private readonly box: SecretBox,
    private readonly options: { subject: string; send?: PushSend; log?: (message: string) => void },
  ) {}

  /** The public key the browsers subscribe with (applicationServerKey). */
  async publicKey(): Promise<string> {
    return (await this.vapid()).publicKey;
  }

  /** Sends to each of the owner's browsers; how many took it. */
  async send(owner: Owner, message: PushMessage): Promise<number> {
    const subscriptions = await repo.listSubscriptions(this.pool, owner);
    if (subscriptions.length === 0) return 0;
    const { publicKey, privateKey } = await this.vapid();
    const send = this.options.send ?? (webpush.sendNotification as unknown as PushSend);
    const payload = JSON.stringify(message);
    let delivered = 0;
    for (const sub of subscriptions) {
      try {
        await send({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, {
          vapidDetails: { subject: this.options.subject, publicKey, privateKey },
          // A ticket an hour old is still worth hearing of; older, the bell has it.
          TTL: 3600,
          urgency: 'high',
        });
        delivered++;
      } catch (error) {
        const status = (error as { statusCode?: unknown }).statusCode;
        if (status === 404 || status === 410) {
          await repo.deleteSubscription(this.pool, owner, sub.endpoint);
        } else {
          this.options.log?.(`push to ${new URL(sub.endpoint).host} failed: ${status ?? (error as Error).message}`);
        }
      }
    }
    return delivered;
  }

  private vapid(): Promise<{ publicKey: string; privateKey: string }> {
    this.keys ??= this.loadKeys().catch((error: unknown) => {
      this.keys = null;
      throw error;
    });
    return this.keys;
  }

  private async loadKeys(): Promise<{ publicKey: string; privateKey: string }> {
    const saved = await repo.findVapid(this.pool);
    if (saved) {
      const privateKey = this.box.open(saved.privateKeySealed, SEAL_CONTEXT);
      if (privateKey) return { publicKey: saved.publicKey, privateKey };
      // ENCRYPTION_KEY changed: the old keys are of no use, nor the subscriptions made with them.
      this.options.log?.('the VAPID keys do not open with this ENCRYPTION_KEY: new keys, every browser must allow notifications again');
      await repo.resetVapid(this.pool);
    }
    const made = webpush.generateVAPIDKeys();
    await repo.insertVapid(this.pool, made.publicKey, this.box.seal(made.privateKey, SEAL_CONTEXT));
    // Another start may have saved its keys first: the saved ones are the ones.
    const kept = await repo.findVapid(this.pool);
    const privateKey = kept ? this.box.open(kept.privateKeySealed, SEAL_CONTEXT) : null;
    if (!kept || !privateKey) throw new Error('the VAPID keys could not be saved');
    return { publicKey: kept.publicKey, privateKey };
  }
}
