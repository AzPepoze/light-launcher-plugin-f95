import type {
  AuthState,
  FileCandidate,
  GameDTO,
  GameRef,
  ProviderCapabilities,
  Ref,
  UpdateInfo,
} from '@light-launcher/plugin-sdk/types';
import type { ProgressReport } from '@light-launcher/plugin-sdk/runtime';

/** The source contract. The SDK has no provider type, so the plugin defines its own. */
export interface Provider {
  readonly id: string;
  readonly label: string;
  readonly capabilities: ProviderCapabilities;

  /** URL -> ref, purely syntactic. null = this source doesn't own that URL. */
  parseRef(url: string): Ref | null;

  authStatus(): Promise<AuthState>;
  setCredential(value: string): Promise<AuthState>;
  clearCredential(): Promise<AuthState>;

  fetchGame(ref: Ref): Promise<GameDTO>;
  /** one page of a listing or search */
  fetchList(opts: { url?: string; query?: string; page?: number }): Promise<GameDTO[]>;

  resolveFiles(game: GameRef): Promise<FileCandidate[]>;
  prepareDownload(file: FileCandidate, game: GameRef, call?: DownloadCall): Promise<DownloadTarget>;
  checkUpdate(game: GameRef): Promise<UpdateInfo | null>;
}

/** Per-call hooks from the host request: cancel and progress. */
export interface DownloadCall {
  signal?: AbortSignal;
  progress?: (report: ProgressReport) => void;
}

export interface DownloadTarget {
  url: string;
  headers: Record<string, string>;
}
