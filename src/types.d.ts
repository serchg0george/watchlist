type Person = "S" | "L";
type Status = "planned" | "watching" | "watched" | "dropped";
type MediaType = "movie" | "tv";
type ReactionKind = "like" | "fire" | "heart" | "grin" | "eyes" | "laugh" | "sad" | "dislike";

interface ReactionKindInfo {
  key: ReactionKind;
  emoji: string;
  label: string;
}

interface CategoryType {
  key: string;
  label: string;
  color: string;
}

type Ratings = Record<Person, number | null>;
type Comments = Record<Person, string>;

interface Reply {
  id: string;
  to: string;
  by: Person;
  text: string;
  at: string;
  editedAt?: string;
}

type Reactions = Record<string, Partial<Record<Person, ReactionKind[]>>>;

interface TmdbMetadata {
  id: number;
  mediaType: MediaType;
  originalTitle: string;
  year: number | null;
  overview: string;
  posterPath: string | null;
  runtime: number | null;
  imdbId?: string;
}

interface Item {
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

interface WatchlistData {
  version: number;
  types: CategoryType[];
  items: Item[];
}

interface TmdbSelection {
  title: string;
  tmdb: TmdbMetadata;
  genres: string[];
}

interface TmdbItemMetadata {
  tmdb?: TmdbMetadata;
  genres?: string[];
}

interface TmdbHooks {
  getItems: () => Item[];
  getTypes: () => CategoryType[];
  canEdit: () => boolean;
  add: (title: string, type: string, metadata: TmdbItemMetadata) => Promise<boolean>;
}

type ParsedQuery =
  | { query: string }
  | { mediaType: MediaType; id: number }
  | { imdbId: string };

interface WatchlistTMDBApi {
  init: (options: TmdbHooks) => void;
  parseQuery: (value: string) => ParsedQuery;
  asMetadata: (raw: unknown, mediaType: MediaType) => TmdbSelection;
  safePoster: (path: unknown) => string | null;
  acknowledgeSave: () => void;
}

interface Window {
  WatchlistTMDB?: WatchlistTMDBApi;
}

declare var WatchlistTMDB: WatchlistTMDBApi;
