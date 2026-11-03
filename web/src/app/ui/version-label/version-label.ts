import { Component, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';

import { VersionApi } from '../../data/version-api';

/**
 * The instance's version in the bottom right corner of every page (lenzi, 2026-10-03: "metti in
 * basso la sottoversione in basso a destra", in substance-tracker), small and faint, under the windows,
 * never in the way of a tap. The API says which version runs (api/src/version.ts); nothing shows
 * until it answers, nor if it does not.
 */
@Component({
  selector: 'app-version-label',
  imports: [],
  templateUrl: './version-label.html',
  styleUrl: './version-label.css',
})
export class VersionLabel {
  private readonly versionApi = inject(VersionApi);

  protected readonly version = rxResource({ stream: () => this.versionApi.getVersion() });
}
