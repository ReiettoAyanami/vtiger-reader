import { Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

/**
 * The floating "+" (design-frontend.md, "add button"): a Material FAB at the bottom right of the
 * screen. It only says it was pressed; whoever places it decides what opens.
 */
@Component({
  selector: 'app-add-button',
  imports: [MatButtonModule, MatIconModule],
  templateUrl: './add-button.html',
  styleUrl: './add-button.css',
})
export class AddButton {
  /** What the button does, for screen readers (e.g. "Add user"). */
  readonly label = input.required<string>();
  readonly pressed = output<void>();
}
