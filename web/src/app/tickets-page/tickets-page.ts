import { Component, computed, effect, inject, signal } from '@angular/core';
import { rxResource, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import {
  MatAutocompleteModule,
  MatAutocompleteSelectedEvent,
} from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { EMPTY, catchError, debounceTime, distinctUntilChanged, map, of, switchMap } from 'rxjs';

import { ApiError } from '../data/api-error';
import { CustomerHit, Folder, ListQuery, TicketRow, whoLabel } from '../data/tickets';
import { TicketsApi } from '../data/tickets-api';
import { Session } from '../session/session';
import { LinkCrmCard } from '../ui/link-crm-card/link-crm-card';
import { WhenPipe } from '../ui/when';

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
 * The tickets of the user's CRM (plan 3.1, 3.2): the folders on the side (a menu on a phone), the
 * search, the status, the customer and the order above the list, pages of 50. Everything lives in
 * the address (?folder=…&q=…), so Back and a reload keep it. Read live from the CRM: the list
 * first, then the organizations' names (slow on the CRM: ~100 ms each), then the folders' counts.
 */
@Component({
  selector: 'app-tickets-page',
  imports: [
    LinkCrmCard,
    MatAutocompleteModule,
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
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
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly session = inject(Session);

  protected readonly sorts = SORTS;
  protected readonly whoLabel = whoLabel;

  private readonly params = toSignal(this.route.queryParamMap, { requireSync: true });

  /** What the list shows, from the address. */
  protected readonly query = computed<ListQuery>(() => {
    const p = this.params();
    const sort = (SORTS.find((s) => s.value === p.get('sort'))?.value ?? 'created-desc').split('-');
    const page = Number(p.get('page') ?? 0);
    return {
      folder: p.get('folder') || 'mine-open',
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

  protected readonly folders = rxResource({ stream: () => this.api.folders() });
  protected readonly tickets = rxResource({
    params: () => this.query(),
    stream: ({ params }) => this.api.list(params),
  });

  /** The counts come after the first page (one CRM count per folder: they would hold the list back). */
  private readonly countsWanted = signal(false);
  protected readonly counts = rxResource({
    params: () => (this.countsWanted() ? true : undefined),
    stream: () => this.api.folderCounts(),
  });

  /** Organizations' names, read after the list (the CRM gives them one at a time). */
  private readonly names = signal<Record<string, string>>({});

  protected readonly notLinked = computed(() =>
    [this.tickets.error(), this.folders.error()].some(
      (e) => apiErrorOf(e)?.code === 'crm-not-linked',
    ),
  );
  protected readonly failure = computed(() => {
    const error = apiErrorOf(this.tickets.error());
    if (!error || error.code === 'crm-not-linked') return null;
    if (error.code === 'crm-unreachable' || error.status === null)
      return 'The CRM is not reachable right now.';
    return `Could not load the tickets: ${error.detail || error.title}${error.status ? ` (${error.status})` : ''}`;
  });

  /** A resource's value, or undefined while it has none (reading an errored resource's value throws). */
  protected readonly folderData = computed(() =>
    this.folders.hasValue() ? this.folders.value() : undefined,
  );
  private readonly page = computed(() =>
    this.tickets.hasValue() ? this.tickets.value() : undefined,
  );
  private readonly countData = computed(() =>
    this.counts.hasValue() ? this.counts.value() : undefined,
  );

  protected readonly sections = computed(() => {
    const groups = new Map<string, Folder[]>();
    for (const folder of this.folderData()?.folders ?? [])
      groups.set(folder.section, [...(groups.get(folder.section) ?? []), folder]);
    return [...groups].map(([name, folders]) => ({ name, folders }));
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

  protected folderCount(folder: Folder): number | null {
    return this.countData()?.[folder.id] ?? null;
  }

  protected chooseFolder(id: string): void {
    this.go({ folder: id === 'mine-open' ? null : id, page: null });
  }

  protected chooseStatus(status: string): void {
    this.go({ status: status || null, page: null });
  }

  protected chooseSort(sort: Sort): void {
    this.go({ sort: sort === 'created-desc' ? null : sort, page: null });
  }

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
