import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { ApiError } from './api-error';
import {
  AskEvent,
  ModelInfo,
  Provider,
  ProviderInput,
  Task,
  TaskModels,
  ThreadTurn,
  UsageRow,
} from './ai';

/** The events of a server-sent stream as they arrive, a chunk at a time. */
export function parseEvents(buffer: string): { events: AskEvent[]; rest: string } {
  const events: AskEvent[] = [];
  let rest = buffer;
  let end: number;
  while ((end = rest.indexOf('\n\n')) >= 0) {
    const block = rest.slice(0, end);
    rest = rest.slice(end + 2);
    const name = /^event: (.+)$/m.exec(block)?.[1];
    const data = /^data: (.+)$/m.exec(block)?.[1];
    if (!name || data === undefined) continue;
    try {
      events.push({ event: name, data: JSON.parse(data) } as AskEvent);
    } catch {
      // A broken event: skipped.
    }
  }
  return { events, rest };
}

/** Gateway of the AI help (/api/ai, /api/tickets/:id/ai): one method per operation, no state. */
@Injectable({
  providedIn: 'root',
})
export class AiApi {
  private readonly http = inject(HttpClient);

  providers(): Observable<Provider[]> {
    return this.http.get<Provider[]>('/api/ai/providers');
  }

  createProvider(input: ProviderInput): Observable<Provider> {
    return this.http.post<Provider>('/api/ai/providers', input);
  }

  updateProvider(id: number, input: ProviderInput): Observable<Provider> {
    return this.http.put<Provider>(`/api/ai/providers/${id}`, input);
  }

  deleteProvider(id: number): Observable<void> {
    return this.http.delete<void>(`/api/ai/providers/${id}`).pipe(map(() => undefined));
  }

  /** The provider's models, read from it: also the test of its key and address. */
  models(id: number): Observable<ModelInfo[]> {
    return this.http.get<ModelInfo[]>(`/api/ai/providers/${id}/models`);
  }

  tasks(): Observable<TaskModels> {
    return this.http.get<TaskModels>('/api/ai/tasks');
  }

  setTasks(patch: Partial<TaskModels>): Observable<TaskModels> {
    return this.http.put<TaskModels>('/api/ai/tasks', patch);
  }

  usage(): Observable<UsageRow[]> {
    return this.http.get<UsageRow[]>('/api/ai/usage');
  }

  /**
   * Asks the AI about a ticket; each event as it streams in. A request refused before any answer
   * (no model set up, a ticket not found…) rejects with the API's problem, as an ApiError.
   * HttpClient does not stream a POST's answer: fetch does, with the session's cookie.
   */
  async ask(
    ticketId: string,
    body: { task: Task; question?: string; thread: ThreadTurn[] },
    onEvent: (event: AskEvent) => void,
    signal: AbortSignal,
  ): Promise<void> {
    let response: Response;
    try {
      response = await fetch(`/api/tickets/${encodeURIComponent(ticketId)}/ai`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify(body),
        credentials: 'same-origin',
        signal,
      });
    } catch (error) {
      if (signal.aborted) return;
      throw {
        status: null,
        code: null,
        title: 'Server not reachable',
        detail: 'The server could not be reached.',
        fieldErrors: [],
      } satisfies ApiError;
    }
    if (!response.ok || !response.body) {
      const problem = (await response.json().catch(() => null)) as {
        type?: string;
        title?: string;
        detail?: string;
        errors?: ApiError['fieldErrors'];
      } | null;
      const prefix = 'urn:vtiger-reader:problem:';
      throw {
        status: response.status,
        code: problem?.type?.startsWith(prefix) ? problem.type.slice(prefix.length) : null,
        title: problem?.title ?? response.statusText,
        detail: problem?.detail ?? '',
        fieldErrors: problem?.errors ?? [],
      } satisfies ApiError;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parsed = parseEvents(buffer);
        buffer = parsed.rest;
        parsed.events.forEach(onEvent);
      }
      parseEvents(`${buffer}\n\n`).events.forEach(onEvent);
    } catch {
      if (signal.aborted) return;
      onEvent({ event: 'error', data: { kind: 'unreachable', message: 'The answer was cut off' } });
    }
  }
}
