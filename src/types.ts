export interface KeepListItem {
  id: string;
  text: string;
  checked: boolean;
}

export interface KeepNote {
  id: string;
  title: string;
  text: string;
  items?: KeepListItem[];
  isPinned: boolean;
  isArchived?: boolean;
  color?: string;
  updatedAt: string;
  createdAt?: string;
  labels?: string[];
}

export type DisplayMode = "list" | "detail";
export type SortOrder = "updated" | "created" | "title";

export interface AppConfig {
  backendUrl: string;
  autoSyncIntervalSec: number; // 0 = disabled
  textBrightness: number; // 0~4
  selectedNoteId: string | null;
  displayMode: DisplayMode;
  detailScrollOffset: number;
  useDemoData: boolean;
  includeArchived: boolean;
  sortBy: SortOrder;
  apiKey?: string;
}

export interface GlassRenderState {
  mode: DisplayMode;
  selectedIndex: number;
  selectedNote: KeepNote | null;
  scrollPage: number;
  totalNotes: number;
  lastUpdated: Date;
}
