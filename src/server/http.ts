/**
 * The service's HTTP plumbing that a route module needs: the error a handler
 * throws to answer with a status, and the shape a handler is called with.
 * Lives apart from index.ts so the podcast's routes (src/server/podcast/)
 * can use them without importing the service itself.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  body: () => Promise<any>;
  raw: () => Promise<Buffer>;
  /** Set by readRoute (the MCP interface): a GET answers without persisting anything. */
  readOnly?: boolean;
}

/** A route: its path pattern, its verb, and the handler its captures are passed to. */
export type Route = [RegExp, string, (ctx: Ctx, params: string[]) => Promise<unknown>];

export class HttpError extends Error {
  /** `code` names a refusal the client acts on, beside the message it shows. */
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

/**
 * What a handler returns when it has written the response itself (an mp3
 * streamed to the player): the router sends nothing more.
 */
export const ANSWERED = Symbol('answered');
