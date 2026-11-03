/** GET /api/crm/link: the user's own CRM account. The access key never comes back. */
export interface CrmLinkStatus {
  /** The address of the CRM the user linked (each user sets their own), null when not linked. */
  crmUrl: string | null;
  linked: boolean;
  username: string | null;
  /** ISO instants. */
  linkedAt: string | null;
  lastLoginAt: string | null;
  /** Why the link cannot be used as it is (e.g. the saved key no longer opens), else null. */
  problem: string | null;
}

/** PUT /api/crm/link */
export interface CrmLinkInput {
  /** https, on the internet: e.g. https://nomecrm.opencrmitalia.com */
  url: string;
  username: string;
  accessKey: string;
}
