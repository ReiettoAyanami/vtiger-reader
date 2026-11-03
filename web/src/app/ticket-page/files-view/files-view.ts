import { Component, computed, inject, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';

import { Attachment, Mark } from '../../data/tickets';
import { TicketsApi } from '../../data/tickets-api';
import { HistoryDialogs } from '../../history-dialogs';
import { ImageDialog, ImageDialogData } from './image-dialog';

/** "24 KB", "1.2 MB". */
export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** An icon for a file's type. */
export function typeIcon(type: string): string {
  if (type.startsWith('image/')) return 'image';
  if (type === 'application/pdf') return 'picture_as_pdf';
  if (type.includes('spreadsheet') || type.includes('excel')) return 'table_chart';
  if (type.includes('word')) return 'description';
  if (type.includes('zip')) return 'folder_zip';
  return 'attach_file';
}

/**
 * The files of a comment or a document (plan 3.6, 3.7): the photos as thumbnails, the other files
 * as links (images and PDFs open, the rest download), the signature images apart and folded. Each
 * image can be marked "logo" or "photo" by the user: the mark follows the same picture elsewhere.
 */
@Component({
  selector: 'app-files-view',
  imports: [MatButtonModule, MatIconModule, MatMenuModule],
  templateUrl: './files-view.html',
  styleUrl: './files-view.css',
})
export class FilesView {
  private readonly api = inject(TicketsApi);
  private readonly dialogs = inject(HistoryDialogs);
  private readonly snackBar = inject(MatSnackBar);

  readonly ticketId = input.required<string>();
  readonly files = input.required<Attachment[]>();
  /** A mark changed: the ticket's attachments are read again. */
  readonly marked = output<void>();

  protected readonly sizeLabel = sizeLabel;
  protected readonly typeIcon = typeIcon;

  protected readonly photos = computed(() =>
    this.files().filter((f) => f.type.startsWith('image/') && f.inline && !f.signature),
  );
  protected readonly others = computed(() =>
    this.files().filter((f) => !f.type.startsWith('image/') || !f.inline),
  );
  protected readonly signatures = computed(() =>
    this.files().filter((f) => f.type.startsWith('image/') && f.inline && f.signature),
  );
  protected readonly busy = signal<string | null>(null);

  protected url(file: Attachment, download = false): string {
    return this.api.fileUrl(this.ticketId(), file.id, download);
  }

  protected view(file: Attachment): void {
    void this.dialogs.open<ImageDialog, ImageDialogData, void>(
      ImageDialog,
      {
        name: file.name,
        url: this.url(file),
        downloadUrl: this.url(file, true),
        size: sizeLabel(file.size),
      },
      { maxWidth: '96vw', maxHeight: '96dvh', panelClass: 'image-dialog' },
    );
  }

  protected async mark(file: Attachment, mark: Mark | null): Promise<void> {
    if (this.busy()) return;
    this.busy.set(file.id);
    try {
      await firstValueFrom(this.api.mark(this.ticketId(), file.id, mark));
      this.snackBar.open(
        mark === 'logo'
          ? 'Marked as a logo: set aside here and in other tickets'
          : mark === 'photo'
            ? 'Marked as a photo'
            : 'Mark removed',
        undefined,
        { duration: 3000 },
      );
      this.marked.emit();
    } catch {
      this.snackBar.open('Could not save the mark', undefined, { duration: 4000 });
    } finally {
      this.busy.set(null);
    }
  }
}
