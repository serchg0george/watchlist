export type Person = "S" | "L";
export type Status = "planned" | "watching" | "watched" | "dropped";
export type MediaType = "movie" | "tv";
export type ReactionKind = "like" | "fire" | "heart" | "grin" | "eyes" | "laugh" | "sad" | "dislike";

export interface ReactionKindInfo {
  key: ReactionKind;
  emoji: string;
  label: string;
}

export interface CategoryType {
  key: string;
  label: string;
  color: string;
}

export type Ratings = Record<Person, number | null>;
export type Comments = Record<Person, string>;

export interface Reply {
  id: string;
  to: string;
  by: Person;
  text: string;
  at: string;
  editedAt?: string;
}

export type Reactions = Record<string, Partial<Record<Person, ReactionKind[]>>>;

export interface TmdbMetadata {
  id: number;
  mediaType: MediaType;
  originalTitle: string;
  year: number | null;
  overview: string;
  posterPath: string | null;
  runtime: number | null;
  imdbId?: string;
}

export interface Item {
  id: string;
  title: string;
  type: string;
  status: Status;
  ratings: Ratings;
  comments: Comments;
  replies: Reply[];
  reactions: Reactions;
  genres: string[];
  note: string;
  addedAt: string;
  watchedAt: string | null;
  droppedAt: string | null;
  updatedBy: string;
  tmdb?: TmdbMetadata;
}

export interface WatchlistData {
  version: number;
  types: CategoryType[];
  items: Item[];
}

export interface TmdbSelection {
  title: string;
  tmdb: TmdbMetadata;
  genres: string[];
}

export interface TmdbItemMetadata {
  tmdb?: TmdbMetadata;
  genres?: string[];
}

export interface TmdbHooks {
  getItems: () => Item[];
  getTypes: () => CategoryType[];
  canEdit: () => boolean;
  add: (title: string, type: string, metadata: TmdbItemMetadata) => Promise<boolean>;
}

export type ParsedQuery =
  | { query: string }
  | { mediaType: MediaType; id: number }
  | { imdbId: string };

export interface WatchlistTMDBApi {
  init: (options: TmdbHooks) => void;
  parseQuery: (value: string) => ParsedQuery;
  asMetadata: (raw: unknown, mediaType: MediaType) => TmdbSelection;
  safePoster: (path: unknown) => string | null;
  acknowledgeSave: () => void;
}
