import type { CrmField, CrmModule } from '../crm/client.js';

/**
 * What the app needs to know of a CRM's tickets (HelpDesk), read from its `describe`: every
 * OpenCRM has its own custom fields, so none of the CRM's own names is hardcoded beyond vtiger's
 * standard ones (ticket_no, ticket_title, ticketstatus...). The company CRM's are in the brain
 * (crm-spike.md), never here.
 */
export interface TicketSchema {
  module: CrmModule;
  /** The field with the request's text: `description`, or a text field labelled "Descrizione"/"Description". */
  description: string | null;
  /** The field with the solution: `solution`, or a text field labelled "Soluzione"/"Solution". */
  solution: string | null;
  /** The statuses of a ticket still to handle, and of a finished one. */
  openStatuses: string[];
  closedStatuses: string[];
  /** Picklists the folders are made of: the category, and the support groups when the CRM has them. */
  folderFields: CrmField[];
  has(field: string): boolean;
}

/** Statuses that end a ticket (vtiger's standard one, and the usual Italian and English others). */
const CLOSED = new Set(['closed', 'chiuso', 'annullato', 'annullata', 'cancelled', 'canceled', 'rejected', 'risolto', 'resolved']);

export function isClosedStatus(status: string): boolean {
  return CLOSED.has(status.trim().toLowerCase());
}

const BIG_TEXT = new Set(['text', 'string']);

function byNameOrLabel(module: CrmModule, name: string, label: RegExp): string | null {
  if (module.fields.some((f) => f.name === name)) return name;
  return module.fields.find((f) => BIG_TEXT.has(f.type) && label.test(f.label.trim()))?.name ?? null;
}

export function ticketSchema(module: CrmModule): TicketSchema {
  const names = new Set(module.fields.map((f) => f.name));
  const statuses = module.fields.find((f) => f.name === 'ticketstatus')?.picklist.map((p) => p.value) ?? [];
  const folderFields = module.fields.filter(
    (f) => f.type === 'picklist' && f.picklist.length > 0 && (f.name === 'ticketcategories' || /\b(gruppo|group|team)\b/i.test(f.label)),
  );
  return {
    module,
    description: byNameOrLabel(module, 'description', /^(descrizione|description)\b/i),
    solution: byNameOrLabel(module, 'solution', /^(soluzione|solution)\b/i),
    openStatuses: statuses.filter((s) => !isClosedStatus(s)),
    closedStatuses: statuses.filter((s) => isClosedStatus(s)),
    folderFields,
    has: (field) => names.has(field),
  };
}
