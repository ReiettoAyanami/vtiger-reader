import type { Pool } from '../../db/pool.js';
import type { Owner } from '../../shared/owner.js';
import { parseInstant, type Clock } from '../../shared/time.js';
import { Semaphore } from '../crm/client.js';
import { CrmError } from '../crm/webservice.js';
import type { ListsService } from '../lists/service.js';
import { crmTime, type TicketRow, type TicketsService } from '../tickets/service.js';
import type { NotificationMessage, Notifier } from './notifier.js';
import * as repo from './repository.js';

/** Every 2 minutes, around the clock (plan 5.1). */
export const CHECK_EVERY_MS = 120_000;
/** At most this many tickets in the bell. */
export const BELL_SIZE = 50;

export interface NotificationSettings {
  enabled: boolean;
  /** The ids of the user's lists a new ticket notifies them from. */
  lists: number[];
}

export interface Bell {
  enabled: boolean;
  /** The tickets created since the user last opened the bell, in their notifying lists, newest first. */
  items: TicketRow[];
}

/** What an open page hears (the SSE stream): new tickets for its user, to read the bell again. */
export interface LiveEvent {
  count: number;
}

/**
 * Notifications (plan 5, 7.2): a check every 2 minutes for every profile with a CRM link, with its
 * own CRM account; the new tickets that are in one of the lists it picked go to the open app (SSE)
 * and to the desktop (the Notifier: the system's own notifications). The CRM stays the only source:
 * we keep how far each check has looked (a time), never which tickets it saw.
 */
export class NotificationsService {
  private readonly listeners = new Map<number, Set<(event: LiveEvent) => void>>();
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;

  constructor(
    private readonly pool: Pool,
    private readonly tickets: TicketsService,
    private readonly lists: ListsService,
    private readonly notifier: Notifier,
    private readonly options: {
      clock: Clock;
      log: { warn: (obj: object, message: string) => void; info: (message: string) => void };
    },
  ) {}

  // ---- Settings ------------------------------------------------------------------------------

  async settings(owner: Owner): Promise<NotificationSettings> {
    const [state, lists] = await Promise.all([repo.findState(this.pool, owner), this.lists.notifying(owner)]);
    return { enabled: state.enabled, lists: lists.map((l) => l.id) };
  }

  /**
   * Turns notifications on or off, and picks the lists. Any change starts the checks again from
   * "now": whoever turns them on is not sent what arrived while they were off.
   */
  async updateSettings(owner: Owner, input: { enabled: boolean; lists: number[] }): Promise<NotificationSettings> {
    const before = await this.settings(owner);
    await this.lists.setNotifying(owner, input.lists);
    const sameLists = [...new Set(input.lists)].sort((a, b) => a - b).join() === [...before.lists].sort((a, b) => a - b).join();
    if (input.enabled !== before.enabled || !sameLists) {
      await repo.saveState(this.pool, owner, { enabled: input.enabled, watermark: null });
    }
    return this.settings(owner);
  }

  // ---- The bell ------------------------------------------------------------------------------

  /** The tickets created since the user last opened the bell (read from the CRM, plan 5.3). */
  async bell(owner: Owner): Promise<Bell> {
    const state = await repo.findState(this.pool, owner);
    if (!state.enabled) return { enabled: false, items: [] };
    let since = state.bellSeenAt;
    if (!since) {
      // The first look: from the newest ticket there is, nothing before.
      since = (await this.tickets.newestCreated(owner)) ?? crmTime(this.options.clock());
      await repo.saveState(this.pool, owner, { bellSeenAt: since });
      return { enabled: true, items: [] };
    }
    const lists = await this.lists.notifying(owner);
    return { enabled: true, items: await this.tickets.createdAfter(owner, lists.map((l) => l.filter), since, { limit: BELL_SIZE }) };
  }

  /** The user opened the bell and saw the tickets up to this one's creation (an ISO instant). */
  async seen(owner: Owner, upTo: string): Promise<void> {
    const at = parseInstant(upTo, 'upTo');
    const now = this.options.clock();
    const seen = crmTime(at > now ? now : at);
    const state = await repo.findState(this.pool, owner);
    if (state.bellSeenAt && state.bellSeenAt >= seen) return;
    await repo.saveState(this.pool, owner, { bellSeenAt: seen });
  }

  // ---- Live pages (SSE) ----------------------------------------------------------------------

  /** An open page of the user listens; the function returned stops it. */
  listen(owner: Owner, listener: (event: LiveEvent) => void): () => void {
    let set = this.listeners.get(owner.userId);
    if (!set) this.listeners.set(owner.userId, (set = new Set()));
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0 && this.listeners.get(owner.userId) === set) this.listeners.delete(owner.userId);
    };
  }

  private tell(owner: Owner, event: LiveEvent): void {
    for (const listener of this.listeners.get(owner.userId) ?? []) listener(event);
  }

  // ---- On the desktop -----------------------------------------------------------------------

  /** A test notification on this PC; whether it was shown. */
  async test(owner: Owner): Promise<boolean> {
    return this.notifier.show(owner, {
      title: 'vtiger-reader',
      body: 'Notifications work on this PC.',
      url: '/',
      tag: `test-${owner.userId}`,
    });
  }

  // ---- The checks ----------------------------------------------------------------------------

  /** Starts the checks, every 2 minutes (server.ts, after listening). */
  start(everyMs = CHECK_EVERY_MS): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.checkAll(), everyMs);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.running;
  }

  /** One round of checks, for every watched user, a few at once; a round still running is not doubled. */
  checkAll(): Promise<void> {
    this.running ??= this.round().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async round(): Promise<void> {
    const users = await repo.listWatchedUsers(this.pool).catch((err: unknown) => {
      this.options.log.warn({ err }, 'notifications: the users to check could not be read');
      return [];
    });
    const atOnce = new Semaphore(4);
    await Promise.all(
      users.map((user) =>
        atOnce.run(() =>
          this.check(user).catch((err: unknown) => {
            // One user's CRM down, or their key revoked, stops nobody else's check.
            const crm = err instanceof CrmError;
            this.options.log.warn(crm ? { crm: err.kind, userId: user.owner.userId } : { err, userId: user.owner.userId }, 'notifications: a check failed');
          }),
        ),
      ),
    );
  }

  /**
   * One user's check (plan 5.1). The newest createdtime of their CRM is the new watermark; the
   * tickets after the old one, up to it, in a list they picked, are new for them. The watermark moves
   * before anything is sent, and only if no other check moved it meanwhile: nothing is sent twice.
   * The first check (or the first after a change of settings) only sets it.
   */
  async check(user: repo.WatchedUser): Promise<TicketRow[]> {
    const { owner } = user;
    const lists = await this.lists.notifying(owner);
    const state = await repo.findState(this.pool, owner);
    if (!state.enabled) return [];
    if (lists.length === 0) {
      if (state.watermark) await repo.saveState(this.pool, owner, { watermark: null });
      return [];
    }
    const newest = await this.tickets.newestCreated(owner);
    if (!state.watermark) {
      await repo.saveState(this.pool, owner, { watermark: newest ?? crmTime(this.options.clock()) });
      return [];
    }
    if (!newest || newest <= state.watermark) return [];
    if (!(await repo.moveWatermark(this.pool, owner, state.watermark, newest))) return [];

    const found = await this.tickets.createdAfter(
      owner,
      lists.map((l) => l.filter),
      state.watermark,
      { upTo: newest },
    );
    if (found.length === 0) return [];
    this.tell(owner, { count: found.length });
    await this.notifier.show(owner, messageFor(owner, found));
    return found;
  }
}

/** One ticket: its number and title, opening it. Several: how many, opening the list (plan 5.3). */
export function messageFor(owner: Owner, found: readonly TicketRow[]): NotificationMessage {
  const tag = `tickets-${owner.userId}`;
  const first = found[0];
  if (found.length === 1 && first) {
    const who = first.organization?.name ?? first.contact?.name ?? '';
    return {
      title: `${first.number} ${first.title}`.trim(),
      body: [who, first.priority, first.category].filter(Boolean).join(' · ') || 'New ticket',
      url: `/tickets/${first.id}`,
      tag,
    };
  }
  const titles = found.slice(0, 3).map((t) => `${t.number} ${t.title}`.trim());
  return {
    title: `${found.length} new tickets`,
    body: titles.join('\n') + (found.length > 3 ? '\n…' : ''),
    url: '/',
    tag,
  };
}
