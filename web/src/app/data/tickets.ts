/** The tickets of the user's CRM, as /api/tickets gives them (api/src/modules/tickets/service.ts). */

/** Who a ticket is assigned to, or who wrote a comment. Colleagues' names cannot be read (plan 2.1). */
export type Who =
  | { kind: 'me' }
  | { kind: 'group'; name: string }
  | { kind: 'customer'; id: string; name: string }
  | { kind: 'colleague' }
  | { kind: 'nobody' };

/** A record of the CRM: its id and name. A list's organizations come without a name (read later, /api/names). */
export interface Ref {
  id: string;
  name: string | null;
}

export interface Folder {
  id: string;
  label: string;
  section: string;
}

/** GET /api/tickets/folders: the folders, and the statuses a ticket can have. */
export interface FoldersAndStatuses {
  folders: Folder[];
  statuses: Array<{ value: string; label: string; closed: boolean }>;
}

export type FolderCounts = Record<string, number | null>;

export interface TicketRow {
  id: string;
  number: string;
  title: string;
  status: string;
  priority: string;
  category: string;
  /** ISO instants (UTC). */
  createdAt: string | null;
  modifiedAt: string | null;
  owner: Who;
  organization: Ref | null;
  contact: Ref | null;
  closed: boolean;
}

export interface TicketPage {
  items: TicketRow[];
  page: number;
  size: number;
  total: number;
}

export interface ListQuery {
  folder: string;
  q?: string;
  status?: string;
  contact?: string;
  organization?: string;
  sort?: 'created' | 'modified';
  dir?: 'asc' | 'desc';
  page?: number;
  size?: number;
}

/** A mail or comment: its words cleaned, and the original HTML (Raw). */
export interface MailText {
  text: string;
  /** Something was cut (a quote, a disclaimer, a signature). */
  cut: boolean;
  html: string;
}

export interface Comment {
  id: string;
  at: string | null;
  author: Who;
  private: boolean;
  body: { text: string; cut: boolean };
  html: string;
  files: string[];
  sameAsDescription: boolean;
}

export interface TicketDetail extends TicketRow {
  crmLink: string;
  description: MailText | null;
  solution: MailText | null;
  fields: Array<{ name: string; label: string; value: string }>;
  comments: Comment[];
  documents: Array<{ id: string; title: string; fileName: string; files: string[] }>;
}

export type Mark = 'logo' | 'photo';

export interface Attachment {
  id: string;
  name: string;
  type: string;
  size: number;
  inline: boolean;
  width: number | null;
  height: number | null;
  from: { kind: 'comment' | 'document'; id: string };
  signature: boolean;
  mark: Mark | null;
}

export interface CustomerHit {
  id: string;
  name: string;
  email: string;
  organization: Ref | null;
}

/** "me", a group's name, "a colleague": how a person shows. */
export function whoLabel(who: Who): string {
  switch (who.kind) {
    case 'me':
      return 'Me';
    case 'group':
      return who.name || 'A group';
    case 'customer':
      return who.name || 'The customer';
    case 'colleague':
      return 'A colleague';
    default:
      return 'Nobody';
  }
}
