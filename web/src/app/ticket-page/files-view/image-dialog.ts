import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';

export interface ImageDialogData {
  name: string;
  url: string;
  downloadUrl: string;
  size: string;
}

/** A ticket's image, as large as the window allows (plan 3.6). Back closes it, like every dialog. */
@Component({
  selector: 'app-image-dialog',
  imports: [MatButtonModule, MatDialogModule, MatIconModule],
  template: `
    <div class="head">
      <span class="name" [title]="data.name">{{ data.name }}</span>
      <span class="size">{{ data.size }}</span>
      <a mat-icon-button [href]="data.downloadUrl" aria-label="Download"
        ><mat-icon>download</mat-icon></a
      >
      <button mat-icon-button type="button" mat-dialog-close aria-label="Close">
        <mat-icon>close</mat-icon>
      </button>
    </div>
    <img class="image" [src]="data.url" [alt]="data.name" />
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 8px 8px 16px 16px;
      max-height: 92dvh;
    }
    .head {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    .name {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font: var(--mat-sys-title-medium);
    }
    .size {
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);
    }
    .image {
      display: block;
      max-width: 100%;
      max-height: calc(92dvh - 80px);
      margin: 0 auto;
      object-fit: contain;
      border-radius: 8px;
    }
  `,
})
export class ImageDialog {
  protected readonly data = inject<ImageDialogData>(MAT_DIALOG_DATA);
}
