import type { SourceKind } from '@squad/core';
import type { ConnectionMode, ConnectionStatus, Provider } from '../types';

export interface ConnectorCourse {
  id: string;
  name: string;
  code?: string;
}

/** One upstream item before its content is fetched. Dates are epoch ms. */
export interface ConnectorItem {
  externalId: string;
  kind: SourceKind;
  title: string;
  courseId: string | null;
  url: string | null;
  modifiedAt: number | null;
  dueAt?: number | null;
  startsAt?: number | null;
  endsAt?: number | null;
}

export interface FetchedContent {
  /** Plain text (assignments, events, docs). */
  text?: string;
  /** Page-structured text (lecture PDFs); anchors become `p<N>`. */
  pages?: { page: number; text: string }[];
}

export interface ConnectorStatusInfo {
  state: ConnectionStatus;
  degraded?: boolean;
  note?: string;
  expiresAt?: number | null;
}

/** What a connector call authenticates with. Resolved server-side from the encrypted token store, per call. */
export type CanvasAuth =
  { variant: 'feed'; feedUrl: string } | { variant: 'token'; token: string; baseUrl: string };
export interface GoogleAuth {
  accessToken: string;
  refreshToken?: string;
  scopes: string[];
  /** Drive Picker selection: only these files can be read under `drive.file`. */
  pickedFileIds?: string[];
}

/** Upstream said the credential is no longer accepted (HTTP 401/403). */
export class ConnectorAuthError extends Error {
  constructor(
    public readonly httpStatus: 401 | 403,
    message = 'upstream rejected the credential',
  ) {
    super(message);
    this.name = 'ConnectorAuthError';
  }
}
/** The credential lapsed and could not be refreshed. */
export class ConnectorExpiredError extends Error {
  constructor(message = 'credential expired') {
    super(message);
    this.name = 'ConnectorExpiredError';
  }
}

export interface Connector<A> {
  readonly provider: Provider;
  readonly mode: ConnectionMode;
  /** Stable, non-secret id of the upstream account (hashed before storage). */
  accountId(auth: A): Promise<string>;
  listCourses(auth: A): Promise<ConnectorCourse[]>;
  listItems(auth: A, courseId?: string): Promise<ConnectorItem[]>;
  fetchContent(auth: A, item: ConnectorItem): Promise<FetchedContent>;
  /** Tell the upstream to drop the grant (best effort; local purge never depends on it). */
  revoke(auth: A): Promise<void>;
  status(auth: A): Promise<ConnectorStatusInfo>;
  /** Exchange a refresh token for a new access token (OAuth providers). Absent when not applicable. */
  refresh?(auth: A): Promise<{ accessToken: string; expiresAt: number | null }>;
}

export type CanvasConnector = Connector<CanvasAuth>;
export type GoogleConnector = Connector<GoogleAuth>;

export const GOOGLE_SCOPES = {
  calendar: 'https://www.googleapis.com/auth/calendar.readonly',
  drive: 'https://www.googleapis.com/auth/drive.file',
  classroomCourses: 'https://www.googleapis.com/auth/classroom.courses.readonly',
  classroomWork: 'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
} as const;
export const CANVAS_SCOPES = {
  feed: 'canvas.calendar_feed',
  token: 'canvas.api_token.read',
} as const;

/** The ONLY scopes the hub will accept; anything broader (drive, gmail, calendar write) is rejected. */
export const ALLOWED_SCOPES: Record<Provider, readonly string[]> = {
  google: Object.values(GOOGLE_SCOPES),
  canvas: Object.values(CANVAS_SCOPES),
};
