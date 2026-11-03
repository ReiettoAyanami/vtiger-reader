import { Component, computed, effect, inject, signal } from '@angular/core';
import { rxResource, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import {
  MatAutocompleteModule,
  MatAutocompleteSelectedEvent,
} from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  EMPTY,
  catchError,
  debounceTime,
  distinctUntilChanged,
  firstValueFrom,
  map,
  of,
  switchMap,
} from 'rxjs';

import { ConfirmDialog, ConfirmDialogData } from '../confirm-dialog/confirm-dialog';
import { ApiError } from '../data/api-error';
import { TicketList } from '../data/lists';
import { ListsApi } from '../data/lists-api';
import { CustomerHit, ListQuery, TicketRow, whoLabel } from '../data/tickets';
import { TicketsApi } from '../data/tickets-api';
import { HistoryDialogs } from '../history-dialogs';
import { Session } from '../session/session';
import { LinkCrmCard } from '../ui/link-crm-card/link-crm-card';
import { statusColor } from '../ui/status-color';
import { WhenPipe } from '../ui/when';
import { ListDialog, ListDialogData } from './list-dialog/list-dialog';

type Sort = 'created-desc' | 'created-asc' | 'modified-desc';

const SORTS: Array<{ value: Sort; label: string }> = [
  { value: 'created-desc', label: 'Newest first' },
  { value: 'created-asc', label: 'Oldest first' },
  { value: 'modified-desc', label: 'Recently changed' },
];

const PAGE_SIZE = 50;

/** The ApiError behind a resource's error (the interceptor's object is wrapped as its cause). */
function apiErrorOf(error: unknown): Partial<ApiError> | null {
  if (!error) return null;
  return ((error as { cause?: unknown }).cause ?? error) as Partial<ApiError>;
}

/**
 * The tickets of the user's CRM (plan 3.1, 3.2), through the user's own lists (lenzi, 2026-11-03:
 * the CRM's saved lists cannot be read with an access key; the lists are "a relation to the user
 * itself"): the lists on the side (a menu on a phone), each made, edited, moved or deleted by the
 * user; the search, the status, the customer and the order above the tickets, pages of 50.
 * Everything lives in the address (?list=…&q=…), so Back and a reload keep it. The tickets first,
 * then the organizations' names (slow on the CRM: ~100 ms each), then the lists' counts.
 */
@Component({
  selector: 'app-tickets-page',
  imports: [
    LinkCrmCard,
    MatAutocompleteModule,
    MatButtonModule,
    MatChipsModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    MatProgressBarModule,
    MatSelectModule,
    ReactiveFormsModule,
    RouterLink,
    WhenPipe,
  ],
  templateUrl: './tickets-page.html',
  styleUrl: './tickets-page.css',
})
export class TicketsPage {
  private readonly api = inject(TicketsApi);
  private readonly listsApi = inject(ListsApi);
  private readonly dialogs = inject(HistoryDialogs);
  private readonly snackBar = inject(MatSnackBar);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly session = inject(Session);

  protected readonly sorts = SORTS;
  protected readonly whoLabel = whoLabel;
  protected readonly statusColor = statusColor;

  private readonly params = toSignal(this.route.queryParamMap, { requireSync: true });

  protected readonly lists = rxResource({ stream: () => this.listsApi.lists() });
  protected readonly options = rxResource({ stream: () => this.api.options() });

  /** The user's lists, or none while they come (reading an errored resource's value throws). */
  protected readonly listData = computed(() => (this.lists.hasValue() ? this.lists.value() : []));
  protected readonly optionData = computed(() =>
    this.options.hasValue() ? this.options.value() : undefined,
  );

  /** The list shown: the one in the address, else the user's first. */
  protected readonly currentList = computed<TicketList | null>(() => {
    const id = Number(this.params().get('list'));
    return this.listData().find((l) => l.id === id) ?? this.listData()[0] ?? null;
  });

  /** What the page shows, from the address. */
  protected readonly query = computed<ListQuery>(() => {
    const p = this.params();
    const sort = (SORTS.find((s) => s.value === p.get('sort'))?.value ?? 'created-desc').split('-');
    const page = Number(p.get('page') ?? 0);
    const list = Number(p.get('list'));
    return {
      ...(Number.isInteger(list) && list > 0 ? { list } : {}),
      q: p.get('q') ?? '',
      status: p.get('status') ?? '',
      contact: p.get('contact') ?? '',
      organization: p.get('organization') ?? '',
      sort: sort[0] as 'created' | 'modified',
      dir: sort[1] as 'asc' | 'desc',
      page: Number.isInteger(page) && page > 0 ? page : 0,
      size: PAGE_SIZE,
    };
  });
  protected readonly sort = computed<Sort>(
    () => `${this.query().sort}-${this.query().dir}` as Sort,
  );

  protected readonly tickets = rxResource({
    params: () => this.query(),
    stream: ({ params }) => this.api.list(params),
  });
  private readonly page = computed(() =>
    this.tickets.hasValue() ? this.tickets.value() : undefined,
  );

  /** The counts come after the first page (one CRM count per list: they would hold the page back). */
  private readonly countsWanted = signal(false);
  protected readonly counts = rxResource({
    params: () =>
      this.countsWanted()
        ? this.listData()
            .map((l) => l.id)
            .join(',') || undefined
        : undefined,
    stream: () => this.listsApi.counts(),
  });
  private readonly countData = computed(() =>
    this.counts.hasValue() ? this.counts.value() : undefined,
  );

  /** Organizations' names, read after the tickets (the CRM gives them one at a time). */
  private readonly names = signal<Record<string, string>>({});

  protected readonly notLinked = computed(() =>
    [this.tickets.error(), this.options.error()].some(
      (e) => apiErrorOf(e)?.code === 'crm-not-linked',
    ),
  );
  protected readonly failure = computed(() => {
    const error = apiErrorOf(this.tickets.error());
    if (!error || error.code === 'crm-not-linked') return null;
    if (error.code === 'list-outdated') return `${error.detail}.`;
    if (error.code === 'crm-unreachable' || error.status === null)
      return 'The CRM is not reachable right now.';
    return `Could not load the tickets: ${error.detail || error.title}${error.status ? ` (${error.status})` : ''}`;
  });

  protected readonly rows = computed(() => this.page()?.items ?? []);
  protected readonly range = computed(() => {
    const page = this.page();
    if (!page || page.total === 0) return '';
    const from = page.page * page.size + 1;
    return `${from}–${Math.min(from + page.items.length - 1, page.total)} of ${page.total}`;
  });
  protected readonly hasPrevious = computed(() => (this.page()?.page ?? 0) > 0);
  protected readonly hasNext = computed(() => {
    const page = this.page();
    return !!page && (page.page + 1) * page.size < page.total;
  });

  // The search field, sent 300 ms after the last key.
  protected readonly search = new FormControl(this.query().q ?? '', { nonNullable: true });

  // The customer filter: contacts found by name or mail.
  protected readonly customerInput = new FormControl<string | CustomerHit>('', {
    nonNullable: true,
  });
  protected readonly customerHits = toSignal(
    this.customerInput.valueChanges.pipe(
      debounceTime(300),
      map((v) => (typeof v === 'string' ? v.trim() : '')),
      distinctUntilChanged(),
      switchMap((q) =>
        q.length < 2 ? of([]) : this.api.customers(q).pipe(catchError(() => of([]))),
      ),
    ),
    { initialValue: [] as CustomerHit[] },
  );
  /** The customer chosen, by name (the address has only its id). */
  protected readonly customerName = signal<string | null>(null);
  /** The chosen contact's organization: "the whole organization" is one tap away. */
  protected readonly customerOrganization = signal<{ id: string; name: string } | null>(null);

  constructor() {
    this.search.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged())
      .subscribe((q) => this.go({ q: q.trim() || null, page: null }, true));

    effect(() => {
      // The first page is in: the counts may come now.
      if (this.tickets.hasValue()) this.countsWanted.set(true);
    });

    effect(() => {
      const missing = [
        ...new Set(
          this.rows().flatMap((r) =>
            r.organization && r.organization.name === null ? [r.organization.id] : [],
          ),
        ),
      ].filter((id) => !(id in this.names()));
      if (missing.length === 0) return;
      this.api
        .names(missing.slice(0, 100))
        .pipe(catchError(() => EMPTY))
        .subscribe((found) =>
          this.names.update((names) => ({
            ...names,
            ...Object.fromEntries(missing.map((id) => [id, found[id] ?? ''])),
          })),
        );
    });

    effect(() => {
      // A customer in the address (a reload, a link): its name, once.
      const id = this.query().contact || this.query().organization;
      if (!id) {
        this.customerName.set(null);
        return;
      }
      if (this.customerName() !== null) return;
      this.api
        .names([id])
        .pipe(catchError(() => of({} as Record<string, string>)))
        .subscribe((found) => this.customerName.set(found[id] ?? id));
    });
  }

  protected organizationName(row: TicketRow): string {
    if (!row.organization) return '';
    return row.organization.name ?? this.names()[row.organization.id] ?? '…';
  }

  protected listCount(list: TicketList): number | null {
    return this.countData()?.[String(list.id)] ?? null;
  }

  protected chooseList(id: number): void {
    this.go({ list: id, page: null });
  }

  protected chooseStatus(status: string): void {
    this.go({ status: status || null, page: null });
  }

  protected chooseSort(sort: Sort): void {
    this.go({ sort: sort === 'created-desc' ? null : sort, page: null });
  }

  // The lists: new, edited, moved, deleted.

  protected async addList(): Promise<void> {
    const saved = await this.openListDialog(null);
    if (!saved) return;
    this.lists.reload();
    this.counts.reload();
    this.chooseList(saved.id);
  }

  protected async editList(list: TicketList): Promise<void> {
    const saved = await this.openListDialog(list);
    if (!saved) return;
    this.lists.reload();
    this.counts.reload();
    this.tickets.reload();
  }

  protected async moveList(list: TicketList, step: -1 | 1): Promise<void> {
    const ids = this.listData().map((l) => l.id);
    const at = ids.indexOf(list.id);
    const to = at + step;
    if (at < 0 || to < 0 || to >= ids.length) return;
    [ids[at], ids[to]] = [ids[to] as number, ids[at] as number];
    try {
      this.lists.set(await firstValueFrom(this.listsApi.reorder(ids)));
    } catch {
      this.snackBar.open('Could not move the list', undefined, { duration: 4000 });
    }
  }

  protected async deleteList(list: TicketList): Promise<void> {
    const deleted = await this.dialogs.open<ConfirmDialog, ConfirmDialogData, true>(
      ConfirmDialog,
      {
        title: `Delete “${list.name}”?`,
        message: 'Only the list goes: the tickets stay in the CRM.',
        confirm: 'Delete',
        action: () => this.listsApi.remove(list.id),
      },
      { width: '400px' },
    );
    if (!deleted) return;
    if (this.currentList()?.id === list.id) this.go({ list: null, page: null });
    this.lists.reload();
  }

  private async openListDialog(list: TicketList | null): Promise<TicketList | undefined> {
    const options = this.optionData() ?? { statuses: [], groups: [], picklists: [] };
    return this.dialogs.open<ListDialog, ListDialogData, TicketList>(
      ListDialog,
      { list, options },
      { width: '560px', maxWidth: '96vw' },
    );
  }

  // The customer filter.

  protected customerLabel(hit: CustomerHit | string): string {
    return typeof hit === 'string' ? hit : hit.name;
  }

  protected chooseCustomer(event: MatAutocompleteSelectedEvent): void {
    const hit = event.option.value as CustomerHit;
    this.customerName.set(hit.name);
    this.customerOrganization.set(
      hit.organization
        ? { id: hit.organization.id, name: hit.organization.name ?? 'the organization' }
        : null,
    );
    this.customerInput.setValue('', { emitEvent: false });
    this.go({ contact: hit.id, organization: null, page: null });
  }

  /** From the contact to their whole organization. */
  protected widenToOrganization(hit: { id: string; name: string }): void {
    this.customerName.set(hit.name);
    this.customerOrganization.set(null);
    this.go({ organization: hit.id, contact: null, page: null });
  }

  protected clearCustomer(): void {
    this.customerName.set(null);
    this.customerOrganization.set(null);
    this.go({ contact: null, organization: null, page: null });
  }

  protected turnPage(step: number): void {
    const page = (this.page()?.page ?? 0) + step;
    this.go({ page: page > 0 ? page : null });
  }

  protected link(row: TicketRow): string {
    return this.session.path(`/tickets/${row.id}`);
  }

  private go(change: Record<string, string | number | null>, replaceUrl = false): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: change,
      queryParamsHandling: 'merge',
      replaceUrl,
    });
  }
}
