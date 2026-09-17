import { evenBridge } from "./evenBridge";
import { GlassRenderer } from "./glassRenderer";
import { KeepClient } from "./keepClient";
import { KeepNote } from "./types";
import { DeviceConnectType, EvenHubEvent, OsEventTypeList } from "@evenrealities/even_hub_sdk";
import QRCode from "qrcode";

class App {
  private renderer: GlassRenderer;
  private keepClient: KeepClient;
  private syncTimer: number | null = null;
  private currentNotes: KeepNote[] = [];
  private lastTapTime: number = 0;
  private singleTapTimer: number | null = null;

  constructor() {
    this.renderer = new GlassRenderer(4);
    this.keepClient = new KeepClient();
  }

  async start() {
    console.log("[App] Starting Keep on G2 App...");
    this.renderQRCode();
    this.setupUIEvents();

    // 1. 同期的にlocalStorageおよびURLパラメータから初期設定を読み込み（高速描画）
    this.loadSettingsFromLocalStorage();
    this.checkUrlParams();

    // キャッシュされたメモで即座に初期化・プレビュー表示
    this.currentNotes = this.keepClient.getCachedNotes();
    this.renderer.setNotes(this.currentNotes);
    this.renderNotesList();
    this.updatePreviewUI();

    // 2. Even Bridge 初期化
    const bridgeReady = await evenBridge.init();
    this.updateDeviceStatusUI();

    evenBridge.addDeviceStatusListener(() => {
      this.updateDeviceStatusUI();
    });

    // 3. グラスからのイベントハンドラ登録
    evenBridge.addListener((event: EvenHubEvent) => {
      this.handleGlassEvent(event);
    });

    // 4. Even App ネイティブ永続ストレージから保存済み設定を復元！
    if (bridgeReady) {
      await this.loadSettingsFromBridge();
    }

    // 5. グラス画面を即座に描画（ロード画面を解除）
    await this.renderer.render();

    // 6. バックグラウンドで最新メモを同期
    this.syncNotes(false);
  }

  /**
   * Google Keep からメモを同期
   */
  async syncNotes(manual: boolean = true) {
    if (manual) {
      this.showToast("Google Keepと同期中...");
    }

    const result = await this.keepClient.fetchNotes(manual);

    if (result.isUnauthorized) {
      const modal = document.getElementById("settings-modal");
      if (modal) modal.classList.add("open");
      const keyInput = document.getElementById("setting-api-key") as HTMLInputElement;
      if (keyInput) keyInput.focus();
      this.showToast("🔐 サーバー保護中: アクセスキーを入力してください");
      return;
    }

    this.currentNotes = result.notes;
    this.renderer.setNotes(this.currentNotes);

    // 成功時はネイティブストレージにもメモキャッシュを保存（オフライン起動や次回即座表示用）
    if (result.success && result.notes.length > 0 && !result.isDemo) {
      try {
        const notesStr = JSON.stringify(result.notes);
        if (notesStr.length < 65536) {
          await evenBridge.setStorage("even_g2_keep_notes", notesStr);
        }
      } catch {}
    }

    // グラスに描画
    await this.renderer.render();

    // スマホUI更新
    this.renderNotesList();
    this.updatePreviewUI();

    if (manual) {
      if (result.isDemo) {
        this.showToast(result.error || "⚠ Google Keep未認証 (デモデータ表示中)");
      } else if (result.success) {
        this.showToast(`同期完了 (${this.currentNotes.length}件のメモ)`);
      } else {
        this.showToast(result.error || "キャッシュデータを表示中");
      }
    }
  }

  /**
   * グラスからのハードウェアイベントを処理
   */
  private async handleGlassEvent(event: EvenHubEvent) {
    console.log("[App] Glass event triggered:", JSON.stringify(event));

    // 各イベントオブジェクトを取得 (typed / raw jsonData の両方を安全に探索)
    const textEvent = event.textEvent || (event.jsonData?.textEvent ?? event.jsonData?.text_event);
    const listEvent = event.listEvent || (event.jsonData?.listEvent ?? event.jsonData?.list_event);
    const sysEvent = event.sysEvent || (event.jsonData?.sysEvent ?? event.jsonData?.sys_event);
    const menuEvent = event.menuItemClickEvent || (event.jsonData?.menuItemClickEvent ?? event.jsonData?.menu_item_click_event);

    if (!textEvent && !listEvent && !sysEvent && !menuEvent && !event.jsonData) {
      return;
    }

    // 生の eventType (number / string / undefined)
    const rawType =
      textEvent?.eventType ??
      textEvent?.Event_Type ??
      listEvent?.eventType ??
      listEvent?.Event_Type ??
      sysEvent?.eventType ??
      sysEvent?.Event_Type ??
      event.jsonData?.eventType ??
      event.jsonData?.Event_Type;

    // OsEventTypeList に正規化
    let normalizedType: OsEventTypeList | undefined = undefined;
    if (typeof rawType === "number") {
      normalizedType = rawType;
    } else if (rawType !== undefined && rawType !== null) {
      normalizedType = OsEventTypeList.fromJson(rawType);
    }

    console.log(`[App] Event breakdown - rawType: ${rawType}, normalized: ${normalizedType}`);

    let isClick = false;
    let isDoubleClick = false;
    let isScrollTop = false;
    let isScrollBottom = false;
    let isLongPress = false;

    if (menuEvent) {
      isClick = true;
    } else if (normalizedType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      isDoubleClick = true;
    } else if (normalizedType === OsEventTypeList.SCROLL_TOP_EVENT) {
      isScrollTop = true;
    } else if (normalizedType === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
      isScrollBottom = true;
    } else if (normalizedType === OsEventTypeList.LONG_PRESS_EVENT) {
      isLongPress = true;
    } else if (
      normalizedType === OsEventTypeList.SYSTEM_EXIT_EVENT ||
      normalizedType === OsEventTypeList.ABNORMAL_EXIT_EVENT
    ) {
      console.log(`[App] System exit event received (${normalizedType}) -> performing post-confirmation cleanup`);
      if (this.singleTapTimer !== null) {
        clearTimeout(this.singleTapTimer);
        this.singleTapTimer = null;
      }
      await evenBridge.shutDownPageContainer(0);
      return;
    } else if (
      normalizedType === OsEventTypeList.CLICK_EVENT ||
      normalizedType === undefined ||
      normalizedType === null
    ) {
      // Protobufの仕様対策:
      // PB enum ordinal 0 (CLICK_EVENT) はデフォルト値としてJSONから省略され、
      // SDK側で undefined として届く。したがって CLICK_EVENT として扱う。
      isClick = true;
    }

    // 1. スクロール上 (前へ / スワイプ上 / リング上)
    if (isScrollTop) {
      if (this.singleTapTimer !== null) {
        clearTimeout(this.singleTapTimer);
        this.singleTapTimer = null;
      }
      if (this.renderer.getMode() === "list") {
        this.renderer.selectPrevNote();
        this.showToast("▲ 前のメモ");
      } else {
        this.renderer.scrollDetailPage(-1);
        this.showToast("▲ 前のページ");
      }
      await this.renderer.render();
      this.updatePreviewUI();
      this.renderNotesList();
    }
    // 2. スクロール下 (次へ / スワイプ下 / リング下)
    else if (isScrollBottom) {
      if (this.singleTapTimer !== null) {
        clearTimeout(this.singleTapTimer);
        this.singleTapTimer = null;
      }
      if (this.renderer.getMode() === "list") {
        this.renderer.selectNextNote();
        this.showToast("▼ 次のメモ");
      } else {
        this.renderer.scrollDetailPage(1);
        this.showToast("▼ 次のページ");
      }
      await this.renderer.render();
      this.updatePreviewUI();
      this.renderNotesList();
    }
    // 3. ハードウェア検出のダブルクリック
    else if (isDoubleClick) {
      console.log("[App] Hardware double click event received");
      if (this.singleTapTimer !== null) {
        clearTimeout(this.singleTapTimer);
        this.singleTapTimer = null;
      }
      await this.handleDoubleTap();
    }
    // 4. クリック (シングルタップ / ソフトウェアダブルタップ検知)
    else if (isClick) {
      console.log(`[App] Click event received (pending single tap: ${Boolean(this.singleTapTimer)})`);
      if (this.singleTapTimer !== null) {
        // 直前のタップから320ms以内に再度タップが来た -> ソフトウェアダブルタップとして認識
        console.log("[App] Rapid taps detected -> Double tap triggered");
        clearTimeout(this.singleTapTimer);
        this.singleTapTimer = null;
        await this.handleDoubleTap();
      } else {
        // 初回タップ: 320ms待機してダブルタップが来なければシングルタップ実行
        this.singleTapTimer = window.setTimeout(async () => {
          this.singleTapTimer = null;
          await this.handleSingleTap();
        }, 320);
      }
    }
    // 5. 長押し (詳細モードなら一覧に戻る / 一覧モードならGoogle Keepと再同期)
    else if (isLongPress) {
      if (this.singleTapTimer !== null) {
        clearTimeout(this.singleTapTimer);
        this.singleTapTimer = null;
      }
      if (this.renderer.getMode() === "detail") {
        this.renderer.setMode("list");
        this.showToast("長押し: 一覧に戻りました");
        await this.renderer.render();
        this.updatePreviewUI();
        this.renderNotesList();
      } else {
        // 一覧モードでの長押し: Google Keepと再同期
        console.log("[App] Long press on homepage -> syncing with Google Keep");
        this.showToast("🔄 Google Keepと同期中...");
        await this.syncNotes(true);
      }
    }
  }

  /**
   * アーカイブ表示のON/OFF切替 (グラス長押し / スマホUIボタン)
   */
  private async toggleArchiveMode() {
    const current = this.keepClient.getIncludeArchived();
    const next = !current;
    this.keepClient.setIncludeArchived(next);
    this.renderer.setIncludeArchived(next);

    // 設定を永続化
    const saved = localStorage.getItem("even_g2_keep_config");
    if (saved) {
      try {
        const config = JSON.parse(saved);
        config.includeArchived = next;
        localStorage.setItem("even_g2_keep_config", JSON.stringify(config));
      } catch {
        // ignore
      }
    }

    // UIのチェックボックスとクイックボタンを更新
    const chk = document.getElementById("setting-include-archived") as HTMLInputElement;
    if (chk) chk.checked = next;

    const quickBtn = document.getElementById("btn-quick-toggle-archive");
    if (quickBtn) {
      quickBtn.textContent = next ? "📁 アーカイブ: ON" : "📁 アーカイブ: OFF";
      quickBtn.style.color = next ? "var(--accent-green)" : "";
    }

    this.showToast(next ? "📁 アーカイブ表示: ON (全件表示)" : "📁 アーカイブ表示: OFF (通常のみ)");

    // 再同期・再描画
    await this.syncNotes(false);
  }

  /**
   * シングルタップの処理
   */
  private async handleSingleTap() {
    console.log("[App] Executing single tap action");
    if (this.renderer.getMode() === "list") {
      if (this.currentNotes.length === 0) {
        console.log("[App] Tap with 0 notes -> triggering sync");
        this.showToast("🔄 Google Keepと同期中...");
        await this.syncNotes(true);
        return;
      }
      this.renderer.setMode("detail");
      this.showToast("● 詳細を開きました");
    } else {
      // 詳細モードでのタップ: チェックリストの未完了項目を完了にトグル
      const currentNote = this.renderer.getCurrentNote();
      if (currentNote && currentNote.items && currentNote.items.length > 0) {
        const firstUnchecked = currentNote.items.find((item) => !item.checked);
        if (firstUnchecked) {
          await this.keepClient.toggleItemCheck(currentNote.id, firstUnchecked.id);
          this.currentNotes = this.keepClient.getCachedNotes();
          this.renderer.setNotes(this.currentNotes);
          this.showToast(`✔ 完了: ${firstUnchecked.text}`);
        } else {
          // 全て完了なら一覧に戻る
          this.renderer.setMode("list");
          this.showToast("● 全て完了: 一覧に戻りました");
        }
      } else {
        // テキストメモなら次ページへ送り、最終ページなら一覧へ
        const beforePage = this.renderer.getScrollPage();
        this.renderer.scrollDetailPage(1);
        const afterPage = this.renderer.getScrollPage();
        if (beforePage === afterPage) {
          this.renderer.setMode("list");
          this.showToast("● 一覧に戻りました");
        } else {
          this.showToast(`▼ ページ送り (${afterPage + 1}P)`);
        }
      }
    }

    await this.renderer.render();
    this.updatePreviewUI();
    this.renderNotesList();
  }

  /**
   * ダブルタップの処理 (詳細モードなら一覧に戻る / ホーム画面ならシステム終了確認ダイアログを表示)
   */
  private async handleDoubleTap() {
    console.log("[App] Executing double tap action");
    if (this.renderer.getMode() === "detail") {
      this.renderer.setMode("list");
      this.showToast("◉ 一覧に戻りました");
      await this.renderer.render();
      this.updatePreviewUI();
      this.renderNotesList();
    } else {
      // ホームページ（一覧画面）でのダブルタップ:
      // Even Hub審査必須要件: システム終了確認ダイアログを表示するため shutDownPageContainer(1) を呼び出す
      console.log("[App] Double-tap on homepage -> calling shutDownPageContainer(1) for system exit confirmation dialog");
      this.showToast("🚪 終了確認ダイアログを表示中...");
      await evenBridge.shutDownPageContainer(1);
    }
  }

  /**
   * スマホ上のグラス視界プレビューを更新
   */
  private updatePreviewUI() {
    const preview = this.renderer.getPreviewContent();
    const elHeader = document.getElementById("preview-header");
    const elBody = document.getElementById("preview-body");
    const elFooter = document.getElementById("preview-footer");
    const elModeLabel = document.getElementById("current-mode-label");

    if (elHeader) elHeader.textContent = preview.title;
    if (elBody) elBody.textContent = preview.body;
    if (elFooter) elFooter.textContent = preview.footer;
    if (elModeLabel) {
      elModeLabel.textContent =
        this.renderer.getMode() === "list" ? "[一覧モード]" : "[詳細/ToDoモード]";
    }
  }

  /**
   * デバイス接続状況をUIに反映
   */
  private updateDeviceStatusUI() {
    const dot = document.getElementById("status-dot");
    const text = document.getElementById("status-text");
    const status = evenBridge.getDeviceStatus();

    if (evenBridge.isReady()) {
      if (dot) dot.className = "status-dot connected";
      if (text) {
        const conn = status?.connectType || DeviceConnectType.Connected;
        const bat = status?.batteryLevel !== undefined ? ` (${status.batteryLevel}%)` : "";
        text.textContent = `G2接続中${bat}`;
      }
    } else {
      if (dot) dot.className = "status-dot";
      if (text) text.textContent = "未接続 (シミュレーター)";
    }
  }

  /**
   * スマホ側のメモ一覧を描画
   */
  private renderNotesList() {
    const container = document.getElementById("notes-list");
    const countEl = document.getElementById("notes-count");
    if (!container) return;

    if (countEl) {
      countEl.textContent = `${this.currentNotes.length}件`;
    }

    container.innerHTML = "";

    if (this.currentNotes.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 40px 20px; color: var(--text-muted);">
          メモがありません。「今すぐKeepと同期」を押すか、新規メモを追加してください。
        </div>
      `;
      return;
    }

    const selectedIdx = this.renderer.getSelectedIndex();

    this.currentNotes.forEach((note, index) => {
      const isCurrent = index === selectedIdx;
      const card = document.createElement("div");
      card.className = `note-card ${isCurrent ? "active" : ""}`;

      // タイトルとピン
      const header = document.createElement("div");
      header.className = "note-header";
      header.innerHTML = `
        <div class="note-title">${note.title || "(無題)"}</div>
        ${note.isPinned ? '<span class="note-pin">★ 固定</span>' : ""}
      `;
      card.appendChild(header);

      // 本文またはToDoリスト
      if (note.items && note.items.length > 0) {
        const todoList = document.createElement("div");
        todoList.className = "todo-items-list";

        note.items.slice(0, 4).forEach((item) => {
          const row = document.createElement("div");
          row.className = `todo-item-row ${item.checked ? "checked" : ""}`;
          row.innerHTML = `
            <input type="checkbox" ${item.checked ? "checked" : ""} style="cursor:pointer;" />
            <span>${item.text}</span>
          `;

          const checkbox = row.querySelector("input");
          checkbox?.addEventListener("change", async (e) => {
            e.stopPropagation();
            await this.keepClient.toggleItemCheck(note.id, item.id);
            this.renderer.setNotes(this.currentNotes);
            await this.renderer.render();
            this.updatePreviewUI();
            this.renderNotesList();
          });

          todoList.appendChild(row);
        });

        if (note.items.length > 4) {
          const more = document.createElement("div");
          more.style.fontSize = "0.75rem";
          more.style.color = "var(--text-muted)";
          more.textContent = `...他 ${note.items.length - 4} 件`;
          todoList.appendChild(more);
        }

        card.appendChild(todoList);
      } else if (note.text) {
        const snippet = document.createElement("div");
        snippet.className = "note-snippet";
        snippet.textContent = note.text;
        card.appendChild(snippet);
      }

      // フッター（グラスに表示ボタン）
      const footer = document.createElement("div");
      footer.className = "note-footer";
      footer.innerHTML = `
        <span>更新: ${new Date(note.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
        <button class="btn-send-glass">${isCurrent ? "表示中" : "G2に表示"}</button>
      `;

      card.appendChild(footer);

      // カードクリックでグラス表示をそのメモの詳細に切り替え
      card.addEventListener("click", async () => {
        this.renderer.setSelectedIndex(index);
        this.renderer.setMode("detail");
        await this.renderer.render();
        this.updatePreviewUI();
        this.renderNotesList();
        this.showToast(`G2に「${note.title}」を表示しました`);
      });

      container.appendChild(card);
    });
  }

  /**
   * UIイベントのセットアップ
   */
  private setupUIEvents() {
    // 同期ボタン
    document.getElementById("btn-sync")?.addEventListener("click", () => {
      this.syncNotes(true);
    });

    // モード切替ボタン
    document.getElementById("btn-toggle-mode")?.addEventListener("click", async () => {
      const nextMode = this.renderer.getMode() === "list" ? "detail" : "list";
      this.renderer.setMode(nextMode);
      await this.renderer.render();
      this.updatePreviewUI();
    });

    // グラス表示終了ボタン
    document.getElementById("btn-close-app")?.addEventListener("click", async () => {
      this.showToast("グラスの表示を終了しました");
      await evenBridge.closeApp();
    });

    // シミュレーター用バーチャル操作ボタン
    document.getElementById("sim-prev")?.addEventListener("click", async () => {
      if (this.renderer.getMode() === "list") {
        this.renderer.selectPrevNote();
      } else {
        this.renderer.scrollDetailPage(-1);
      }
      await this.renderer.render();
      this.updatePreviewUI();
      this.renderNotesList();
    });

    document.getElementById("sim-next")?.addEventListener("click", async () => {
      if (this.renderer.getMode() === "list") {
        this.renderer.selectNextNote();
      } else {
        this.renderer.scrollDetailPage(1);
      }
      await this.renderer.render();
      this.updatePreviewUI();
      this.renderNotesList();
    });

    document.getElementById("sim-tap")?.addEventListener("click", async () => {
      if (this.singleTapTimer !== null) {
        clearTimeout(this.singleTapTimer);
        this.singleTapTimer = null;
      }
      await this.handleSingleTap();
    });

    document.getElementById("sim-doubletap")?.addEventListener("click", async () => {
      if (this.singleTapTimer !== null) {
        clearTimeout(this.singleTapTimer);
        this.singleTapTimer = null;
      }
      await this.handleDoubleTap();
    });

    document.getElementById("sim-longpress")?.addEventListener("click", async () => {
      if (this.singleTapTimer !== null) {
        clearTimeout(this.singleTapTimer);
        this.singleTapTimer = null;
      }
      if (this.renderer.getMode() === "detail") {
        this.renderer.setMode("list");
        this.showToast("長押し: 一覧に戻りました");
        await this.renderer.render();
        this.updatePreviewUI();
        this.renderNotesList();
      } else {
        this.showToast("🔄 Google Keepと同期中...");
        await this.syncNotes(true);
      }
    });

    document.getElementById("btn-quick-toggle-archive")?.addEventListener("click", async () => {
      await this.toggleArchiveMode();
    });

    // メモ追加モーダル
    const addModal = document.getElementById("add-modal");
    document.getElementById("btn-add-note")?.addEventListener("click", () => {
      if (addModal) addModal.classList.add("open");
    });
    document.getElementById("btn-close-add")?.addEventListener("click", () => {
      if (addModal) addModal.classList.remove("open");
    });

    document.getElementById("btn-submit-add-note")?.addEventListener("click", async () => {
      const titleInput = document.getElementById("new-note-title") as HTMLInputElement;
      const contentInput = document.getElementById("new-note-content") as HTMLTextAreaElement;
      const isTodoInput = document.getElementById("new-note-is-todo") as HTMLInputElement;

      const title = titleInput?.value.trim() || "";
      const content = contentInput?.value.trim() || "";
      const isTodo = isTodoInput?.checked || false;

      if (!title && !content) {
        alert("タイトルまたは内容を入力してください");
        return;
      }

      this.keepClient.addManualNote(title, content, isTodo);
      this.currentNotes = (await this.keepClient.fetchNotes()).notes;
      this.renderer.setNotes(this.currentNotes);
      this.renderer.setSelectedIndex(0);
      this.renderer.setMode("detail");
      await this.renderer.render();
      this.updatePreviewUI();
      this.renderNotesList();

      if (titleInput) titleInput.value = "";
      if (contentInput) contentInput.value = "";
      if (addModal) addModal.classList.remove("open");
      this.showToast("新しいメモを追加し、G2に表示しました！");
    });

    // 設定モーダル
    const settingsModal = document.getElementById("settings-modal");
    document.getElementById("btn-open-settings")?.addEventListener("click", () => {
      if (settingsModal) settingsModal.classList.add("open");
    });
    const getModalSettings = () => {
      const backendInput = document.getElementById("setting-backend-url") as HTMLInputElement;
      const apiKeyInput = document.getElementById("setting-api-key") as HTMLInputElement;
      const syncIntervalSelect = document.getElementById("setting-sync-interval") as HTMLSelectElement;
      const brightnessSelect = document.getElementById("setting-brightness") as HTMLSelectElement;
      const sortBySelect = document.getElementById("setting-sort-by") as HTMLSelectElement;
      const includeArchivedCheckbox = document.getElementById("setting-include-archived") as HTMLInputElement;
      const useDemoCheckbox = document.getElementById("setting-use-demo") as HTMLInputElement;

      const backendUrl = backendInput?.value.trim() || "http://localhost:8000";
      const apiKey = apiKeyInput?.value.trim() || "";
      const intervalSec = parseInt(syncIntervalSelect?.value || "0", 10);
      const brightness = parseInt(brightnessSelect?.value || "4", 10);
      const sortBy = (sortBySelect?.value as any) || "updated";
      const includeArchived = includeArchivedCheckbox?.checked || false;
      const useDemo = useDemoCheckbox?.checked || false;

      return { backendUrl, apiKey, intervalSec, brightness, sortBy, includeArchived, useDemo };
    };

    document.getElementById("btn-close-settings")?.addEventListener("click", async () => {
      if (settingsModal) settingsModal.classList.remove("open");
      // モーダルを閉じる際にも自動保存
      const s = getModalSettings();
      this.keepClient.setBackendUrl(s.backendUrl);
      this.keepClient.setApiKey(s.apiKey);
      await this.saveSettings(s.backendUrl, s.intervalSec, s.brightness, s.useDemo, s.sortBy, s.includeArchived, s.apiKey);
    });

    document.getElementById("btn-save-settings")?.addEventListener("click", async () => {
      const s = getModalSettings();

      this.keepClient.setBackendUrl(s.backendUrl);
      this.keepClient.setApiKey(s.apiKey);
      this.keepClient.setUseDemo(s.useDemo);
      this.keepClient.setSortBy(s.sortBy);
      this.keepClient.setIncludeArchived(s.includeArchived);
      this.renderer.setBrightness(s.brightness);

      await this.saveSettings(s.backendUrl, s.intervalSec, s.brightness, s.useDemo, s.sortBy, s.includeArchived, s.apiKey);
      this.setupSyncTimer(s.intervalSec);

      await this.renderer.render();
      if (settingsModal) settingsModal.classList.remove("open");
      this.showToast("設定を保存しました（Even Appに記憶）");
      await this.syncNotes(true);
    });

    document.getElementById("btn-reset-demo")?.addEventListener("click", async () => {
      this.keepClient.resetToDemo();
      this.currentNotes = (await this.keepClient.fetchNotes()).notes;
      this.renderer.setNotes(this.currentNotes);
      await this.renderer.render();
      this.updatePreviewUI();
      this.renderNotesList();
      this.showToast("デモデータをリセットしました");
    });
  }

  private setupSyncTimer(intervalSec: number) {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    if (intervalSec > 0) {
      this.syncTimer = window.setInterval(() => {
        this.syncNotes(false);
      }, intervalSec * 1000);
      console.log(`[App] Auto sync timer scheduled every ${intervalSec}s`);
    }
  }

  /**
   * 設定オブジェクトをUIおよび各サービスへ反映
   */
  private applyConfig(config: any) {
    if (!config) return;
    if (config.backendUrl) {
      this.keepClient.setBackendUrl(config.backendUrl);
      const el = document.getElementById("setting-backend-url") as HTMLInputElement;
      if (el) el.value = config.backendUrl;
    }
    if (config.apiKey !== undefined) {
      this.keepClient.setApiKey(config.apiKey);
      const el = document.getElementById("setting-api-key") as HTMLInputElement;
      if (el) el.value = config.apiKey;
    }
    if (config.brightness) {
      this.renderer.setBrightness(config.brightness);
      const el = document.getElementById("setting-brightness") as HTMLSelectElement;
      if (el) el.value = String(config.brightness);
    }
    if (config.useDemo !== undefined) {
      this.keepClient.setUseDemo(config.useDemo);
      const el = document.getElementById("setting-use-demo") as HTMLInputElement;
      if (el) el.checked = config.useDemo;
    }
    if (config.sortBy) {
      this.keepClient.setSortBy(config.sortBy);
      const el = document.getElementById("setting-sort-by") as HTMLSelectElement;
      if (el) el.value = config.sortBy;
    }
    if (config.includeArchived !== undefined) {
      this.keepClient.setIncludeArchived(config.includeArchived);
      const el = document.getElementById("setting-include-archived") as HTMLInputElement;
      if (el) el.checked = config.includeArchived;
    }
    if (config.intervalSec !== undefined) {
      const el = document.getElementById("setting-sync-interval") as HTMLSelectElement;
      if (el) el.value = String(config.intervalSec);
      this.setupSyncTimer(config.intervalSec);
    }

    this.renderer.setIncludeArchived(this.keepClient.getIncludeArchived());
    const quickBtn = document.getElementById("btn-quick-toggle-archive");
    if (quickBtn) {
      const isArch = this.keepClient.getIncludeArchived();
      quickBtn.textContent = isArch ? "📁 アーカイブ: ON" : "📁 アーカイブ: OFF";
      quickBtn.style.color = isArch ? "var(--accent-green)" : "";
    }
  }

  /**
   * ブラウザlocalStorageから同期的に読み込み（初回初期表示用）
   */
  private loadSettingsFromLocalStorage() {
    try {
      const saved = localStorage.getItem("even_g2_keep_config");
      if (saved) {
        this.applyConfig(JSON.parse(saved));
      }
      const el = document.getElementById("setting-backend-url") as HTMLInputElement;
      if (el && !el.value) {
        el.value = this.keepClient.getBackendUrl();
      }
    } catch {
      // ignore
    }
  }

  /**
   * URLクエリパラメータ(?backend=...&key=...)がある場合は優先反映＆永続保存
   */
  private checkUrlParams() {
    try {
      if (typeof window === "undefined" || !window.location.search) return;
      const params = new URLSearchParams(window.location.search);
      const url = params.get("backend") || params.get("server") || params.get("url");
      const key = params.get("key") || params.get("api_key") || params.get("secret");
      let changed = false;

      if (url && url.trim()) {
        this.keepClient.setBackendUrl(url.trim());
        const el = document.getElementById("setting-backend-url") as HTMLInputElement;
        if (el) el.value = url.trim();
        changed = true;
      }
      if (key && key.trim()) {
        this.keepClient.setApiKey(key.trim());
        const el = document.getElementById("setting-api-key") as HTMLInputElement;
        if (el) el.value = key.trim();
        changed = true;
      }
      if (changed) {
        this.saveSettings(
          this.keepClient.getBackendUrl(),
          0,
          this.renderer.getBrightness(),
          this.keepClient.getUseDemo(),
          this.keepClient.getSortBy(),
          this.keepClient.getIncludeArchived(),
          this.keepClient.getApiKey()
        );
      }
    } catch (e) {
      console.warn("[App] Error checking URL params:", e);
    }
  }

  /**
   * Even App Native Bridgeの永続ストレージから設定を復元
   * （WebView再起動やアプリ再起動でもEven App側で永久に保持される）
   */
  private async loadSettingsFromBridge() {
    try {
      const saved = await evenBridge.getStorage("even_g2_keep_config");
      if (saved) {
        console.log("[App] Settings restored from Even App Bridge storage:", saved);
        const config = JSON.parse(saved);
        this.applyConfig(config);
      }

      // ネイティブ側に保存されたメモキャッシュがあれば復元
      const savedNotes = await evenBridge.getStorage("even_g2_keep_notes");
      if (savedNotes) {
        try {
          const notes = JSON.parse(savedNotes);
          if (Array.isArray(notes) && notes.length > 0) {
            this.keepClient.setCachedNotes(notes);
            this.currentNotes = this.keepClient.getCachedNotes();
            this.renderer.setNotes(this.currentNotes);
            this.renderNotesList();
            this.updatePreviewUI();
          }
        } catch {}
      }
    } catch (err) {
      console.warn("[App] Error loading settings from bridge:", err);
    }
  }

  /**
   * 設定をブラウザlocalStorageとEven App Native永続ストレージの両方に保存
   */
  private async saveSettings(
    backendUrl: string,
    intervalSec: number,
    brightness: number,
    useDemo: boolean,
    sortBy: string = "updated",
    includeArchived: boolean = false,
    apiKey: string = ""
  ) {
    const config = { backendUrl, intervalSec, brightness, useDemo, sortBy, includeArchived, apiKey };
    const jsonStr = JSON.stringify(config);
    try {
      localStorage.setItem("even_g2_keep_config", jsonStr);
    } catch {}
    try {
      await evenBridge.setStorage("even_g2_keep_config", jsonStr);
      console.log("[App] Settings successfully persisted to Even App storage");
    } catch (e) {
      console.warn("[App] Failed to persist settings to evenBridge:", e);
    }
  }

  private showToast(message: string) {
    const toast = document.getElementById("toast-message");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    setTimeout(() => {
      toast.classList.remove("show");
    }, 2800);
  }

  /**
   * Even App からスキャンしてサイドロードするための QR コードを描画
   */
  private renderQRCode() {
    const canvas = document.getElementById("qr-canvas") as HTMLCanvasElement;
    const urlText = document.getElementById("qr-url-text");
    if (!canvas) return;

    const currentUrl = window.location.href;
    if (urlText) {
      urlText.textContent = currentUrl;
    }

    QRCode.toCanvas(
      canvas,
      currentUrl,
      {
        width: 120,
        margin: 1,
        color: {
          dark: "#00ff88",
          light: "#111827",
        },
      },
      (err) => {
        if (err) console.error("[QR] Failed to render QR code:", err);
      }
    );
  }
}

// アプリ起動
window.addEventListener("DOMContentLoaded", () => {
  const app = new App();
  app.start();
});
