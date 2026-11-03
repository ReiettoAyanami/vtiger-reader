/** GET /api/crm/link: the user's own CRM account. The access key never comes back. */
export interface CrmLinkStatus {
  /** The company CRM's address, null when the server has none yet (CRM_URL). */
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
  username: string;
  accessKey: string;
}
