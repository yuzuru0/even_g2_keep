import { KeepNote } from "./types";

const DEMO_NOTES: KeepNote[] = [
  {
    id: "demo-1",
    title: "スーパー買い物リスト",
    text: "",
    isPinned: true,
    color: "yellow",
    updatedAt: new Date().toISOString(),
    items: [
      { id: "item-1", text: "牛乳 (低脂肪乳)", checked: false },
      { id: "item-2", text: "卵 (10個入り)", checked: true },
      { id: "item-3", text: "食パン (6枚切り)", checked: false },
      { id: "item-4", text: "無塩バター", checked: false },
      { id: "item-5", text: "バナナ (1房)", checked: true },
      { id: "item-6", text: "玉ねぎ・じゃがいも", checked: false },
    ],
  },
  {
    id: "demo-2",
    title: "本日の優先タスク",
    text: "1. 10:00 チーム定例ミーティング\n2. G2アプリの動作確認とビルド\n3. 来期のプロジェクト要件書作成\n4. 経費精算の提出（締切今日中！）",
    isPinned: true,
    color: "green",
    updatedAt: new Date().toISOString(),
  },
  {
    id: "demo-3",
    title: "旅行の持ち物チェック",
    text: "",
    isPinned: false,
    color: "blue",
    updatedAt: new Date().toISOString(),
    items: [
      { id: "item-3-1", text: "パスポート・身分証", checked: true },
      { id: "item-3-2", text: "スマートグラス充電器", checked: true },
      { id: "item-3-3", text: "モバイルバッテリー", checked: false },
      { id: "item-3-4", text: "折りたたみ傘", checked: false },
      { id: "item-3-5", text: "着替え (2日分)", checked: false },
    ],
  },
  {
    id: "demo-4",
    title: "スマートグラス活用アイデア",
    text: "Even G2の透過型ディスプレイはハンズフリーでの情報閲覧に最適。\n・買い物時のチェックリスト参照\n・プレゼン時の発表用カンペ\n・料理中のレシピ確認\n・駅や空港での案内確認",
    isPinned: false,
    color: "purple",
    updatedAt: new Date().toISOString(),
  },
];

import { SortOrder } from "./types";

export class KeepClient {
  private backendUrl: string;
  private apiKey: string = "";
  private cachedNotes: KeepNote[] = [];
  private useDemo: boolean = false;
  private includeArchived: boolean = false;
  private sortBy: SortOrder = "updated";

  constructor(backendUrl?: string, useDemo: boolean = false, apiKey: string = "") {
    let defaultUrl = "http://localhost:8000";
    if (typeof window !== "undefined" && window.location) {
      const port = window.location.port;
      if (port === "3000" || port === "5173" || port === "8080") {
        defaultUrl = `http://${window.location.hostname}:8000`;
      } else if (window.location.protocol && window.location.protocol.startsWith("http")) {
        defaultUrl = window.location.origin;
      } else {
        defaultUrl = `http://${window.location.hostname || "localhost"}:8000`;
      }
    }
    this.backendUrl = (backendUrl || defaultUrl).replace(/\/+$/, "");
    this.apiKey = apiKey.trim();
    this.useDemo = useDemo;
    this.cachedNotes = this.loadLocalCache();
    if (this.cachedNotes.length === 0) {
      this.cachedNotes = DEMO_NOTES;
    }
  }

  setApiKey(key: string) {
    this.apiKey = (key || "").trim();
  }

  getApiKey(): string {
    return this.apiKey;
  }

  setBackendUrl(url: string) {
    let cleanUrl = (url || "").trim();
    if (cleanUrl && !cleanUrl.startsWith("http://") && !cleanUrl.startsWith("https://")) {
      cleanUrl = "https://" + cleanUrl;
    }
    try {
      if (cleanUrl.includes("?") || cleanUrl.includes("#")) {
        const parsed = new URL(cleanUrl.startsWith("http") ? cleanUrl : `http://${cleanUrl}`);
        const extractedKey = parsed.searchParams.get("key") ||
                             parsed.searchParams.get("api_key") ||
                             parsed.searchParams.get("secret");
        if (extractedKey && !this.apiKey) {
          this.setApiKey(extractedKey);
        }
        cleanUrl = `${parsed.origin}${parsed.pathname}`;
      }
    } catch {}
    this.backendUrl = cleanUrl.replace(/\/+$/, "");
  }

  getBackendUrl(): string {
    return this.backendUrl;
  }

  setUseDemo(useDemo: boolean) {
    this.useDemo = useDemo;
  }

  getUseDemo(): boolean {
    return this.useDemo;
  }

  setIncludeArchived(include: boolean) {
    this.includeArchived = include;
  }

  getIncludeArchived(): boolean {
    return this.includeArchived;
  }

  setSortBy(sort: SortOrder) {
    this.sortBy = sort;
  }

  getSortBy(): SortOrder {
    return this.sortBy;
  }

  getCachedNotes(): KeepNote[] {
    return this.filterAndSort(this.cachedNotes);
  }

  setCachedNotes(notes: KeepNote[]) {
    this.cachedNotes = notes;
    this.saveLocalCache(notes);
  }

  private filterAndSort(notes: KeepNote[]): KeepNote[] {
    const filtered = notes.filter((n) => this.includeArchived || !n.isArchived);
    filtered.sort((a, b) => {
      // 1. ピン留め優先
      if (a.isPinned !== b.isPinned) {
        return a.isPinned ? -1 : 1;
      }
      // 2. 指定のソート順
      if (this.sortBy === "created" && a.createdAt && b.createdAt) {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      } else if (this.sortBy === "title") {
        return (a.title || "").localeCompare(b.title || "");
      } else {
        // デフォルト: 更新日時降順
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      }
    });
    return filtered;
  }

  private loadLocalCache(): KeepNote[] {
    try {
      const saved = localStorage.getItem("even_g2_keep_notes");
      if (saved) {
        return JSON.parse(saved);
      }
    } catch {
      // ignore
    }
    return [];
  }

  private saveLocalCache(notes: KeepNote[]) {
    try {
      localStorage.setItem("even_g2_keep_notes", JSON.stringify(notes));
    } catch {
      // ignore
    }
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.apiKey) {
      headers["X-API-Key"] = this.apiKey;
    }
    return headers;
  }

  async checkAuthRequired(): Promise<boolean> {
    try {
      const res = await fetch(`${this.backendUrl}/api/auth-info`, {
        headers: { Accept: "application/json" },
      });
      if (res.ok) {
        const data = await res.json();
        return Boolean(data.auth_required);
      }
    } catch {}
    return false;
  }

  /**
   * メモ一覧を取得
   */
  async fetchNotes(forceSync: boolean = false): Promise<{ success: boolean; notes: KeepNote[]; source: string; isDemo?: boolean; isUnauthorized?: boolean; error?: string }> {
    if (this.useDemo) {
      return { success: true, notes: this.filterAndSort(this.cachedNotes), source: "demo", isDemo: true };
    }

    try {
      const controller = new AbortController();
      // Google Keep 同期処理の通信時間を考慮して 12 秒に設定
      const timeoutId = setTimeout(() => controller.abort(), 12000);

      const keyParam = this.apiKey ? `&key=${encodeURIComponent(this.apiKey)}` : "";
      const url = `${this.backendUrl}/api/notes?include_archived=${this.includeArchived}&sort_by=${this.sortBy}${forceSync ? "&sync=true" : ""}${keyParam}`;
      const res = await fetch(url, {
        signal: controller.signal,
        headers: this.getHeaders(),
      });
      clearTimeout(timeoutId);

      if (res.status === 401) {
        return {
          success: false,
          notes: [],
          source: "unauthorized",
          isUnauthorized: true,
          error: "🔐 アクセスキーが無効または未設定です。設定画面（⚙）でアクセスキーを入力してください。",
        };
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const data = await res.json();
      if (Array.isArray(data.notes)) {
        this.cachedNotes = data.notes;
        this.saveLocalCache(this.cachedNotes);
        const isDemo = data.is_demo === true || !data.is_authenticated;
        const errorMsg = isDemo ? (data.auth_error ? `Google Keep未認証: ${data.auth_error}` : "Google Keep未認証のためデモデータを表示中") : undefined;
        return {
          success: true,
          notes: this.filterAndSort(this.cachedNotes),
          source: isDemo ? "server_demo" : "sync_server",
          isDemo,
          error: errorMsg,
        };
      }
      throw new Error("Invalid response format from server");
    } catch (err: any) {
      console.warn("[KeepClient] Server fetch failed, falling back to cache:", err.message);
      return {
        success: false,
        notes: this.filterAndSort(this.cachedNotes),
        source: "cache",
        error: `同期サーバー接続失敗 (${err.message})。キャッシュを表示中。`,
      };
    }
  }

  /**
   * 手動メモ追加 (スマホUI用)
   */
  addManualNote(title: string, content: string, asTodoList: boolean = false): KeepNote {
    const newNote: KeepNote = {
      id: `manual-${Date.now()}`,
      title: title || "(無題)",
      text: asTodoList ? "" : content,
      items: asTodoList
        ? content
            .split("\n")
            .filter((l) => l.trim())
            .map((t, idx) => ({ id: `item-${Date.now()}-${idx}`, text: t.trim(), checked: false }))
        : undefined,
      isPinned: false,
      updatedAt: new Date().toISOString(),
    };

    this.cachedNotes = [newNote, ...this.cachedNotes];
    this.saveLocalCache(this.cachedNotes);
    return newNote;
  }

  /**
   * チェックリストのトグル
   */
  async toggleItemCheck(noteId: string, itemId: string): Promise<boolean> {
    const note = this.cachedNotes.find((n) => n.id === noteId);
    if (!note || !note.items) return false;

    const item = note.items.find((i) => i.id === itemId);
    if (!item) return false;

    item.checked = !item.checked;
    this.saveLocalCache(this.cachedNotes);

    if (!this.useDemo) {
      try {
        await fetch(`${this.backendUrl}/api/notes/${noteId}/items/${itemId}/toggle`, {
          method: "POST",
          headers: this.getHeaders(),
        });
      } catch {
        // バックグラウンドエラーは無視
      }
    }
    return true;
  }

  /**
   * メモの削除
   */
  deleteNote(noteId: string) {
    this.cachedNotes = this.cachedNotes.filter((n) => n.id !== noteId);
    this.saveLocalCache(this.cachedNotes);
  }

  /**
   * デモデータにリセット
   */
  resetToDemo() {
    this.cachedNotes = DEMO_NOTES;
    this.saveLocalCache(this.cachedNotes);
  }
}
