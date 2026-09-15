import { TextContainerProperty } from "@evenrealities/even_hub_sdk";
import { KeepNote, DisplayMode, KeepListItem } from "./types";
import { evenBridge } from "./evenBridge";

export class GlassRenderer {
  private brightness: number = 4;
  private currentMode: DisplayMode = "list";
  private selectedIndex: number = 0;
  private detailScrollPage: number = 0;
  private currentNotes: KeepNote[] = [];
  private includeArchived: boolean = false;

  constructor(brightness: number = 4) {
    this.brightness = brightness;
  }

  setIncludeArchived(include: boolean) {
    this.includeArchived = include;
  }

  getIncludeArchived(): boolean {
    return this.includeArchived;
  }

  setBrightness(b: number) {
    this.brightness = Math.min(4, Math.max(0, b));
  }

  getBrightness(): number {
    return this.brightness;
  }

  setNotes(notes: KeepNote[]) {
    this.currentNotes = notes;
    if (this.selectedIndex >= notes.length) {
      this.selectedIndex = Math.max(0, notes.length - 1);
    }
  }

  getCurrentNote(): KeepNote | null {
    if (this.currentNotes.length === 0) return null;
    return this.currentNotes[this.selectedIndex] || null;
  }

  getMode(): DisplayMode {
    return this.currentMode;
  }

  setMode(mode: DisplayMode) {
    this.currentMode = mode;
    this.detailScrollPage = 0;
  }

  selectNextNote() {
    if (this.currentNotes.length === 0) return;
    this.selectedIndex = (this.selectedIndex + 1) % this.currentNotes.length;
  }

  selectPrevNote() {
    if (this.currentNotes.length === 0) return;
    this.selectedIndex =
      (this.selectedIndex - 1 + this.currentNotes.length) % this.currentNotes.length;
  }

  setSelectedIndex(index: number) {
    if (index >= 0 && index < this.currentNotes.length) {
      this.selectedIndex = index;
    }
  }

  getSelectedIndex(): number {
    return this.selectedIndex;
  }

  scrollDetailPage(delta: number) {
    const note = this.getCurrentNote();
    if (!note) return;
    const lines = this.formatNoteLines(note);
    const maxPage = Math.max(0, Math.ceil(lines.length / 6) - 1);
    this.detailScrollPage = Math.min(maxPage, Math.max(0, this.detailScrollPage + delta));
  }

  getScrollPage(): number {
    return this.detailScrollPage;
  }

  /**
   * G2 グラスの画面全体をレンダリング
   */
  async render(): Promise<boolean> {
    const containers: TextContainerProperty[] = [];

    if (this.currentMode === "list") {
      containers.push(...this.buildListContainers());
    } else {
      containers.push(...this.buildDetailContainers());
    }

    return await evenBridge.renderPage(containers);
  }

  /**
   * 一覧表示用のコンテナ作成
   * G2 ディスプレイ解像度: 576 x 288
   */
  private buildListContainers(): TextContainerProperty[] {
    const containers: TextContainerProperty[] = [];
    const total = this.currentNotes.length;
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    // 1. ヘッダー (ID: 1)
    const headerPrefix = this.includeArchived ? "[Keep (アーカイブ)]" : "[Keep]";
    const headerText = `${headerPrefix} ${total > 0 ? `${this.selectedIndex + 1}/${total}` : "0件"}       ${timeStr}`;
    containers.push(
      new TextContainerProperty({
        containerID: 1,
        containerName: "header",
        zOrderIndex: 1,
        xPosition: 12,
        yPosition: 10,
        width: 552,
        height: 36,
        content: headerText,
        textColor: this.brightness,
        isEventCapture: 0,
      })
    );

    // 2. メインリスト (ID: 2)
    let bodyText = "";
    if (total === 0) {
      bodyText = "メモがありません。\nスマホから同期または新規追加してください。";
    } else {
      // 現在の選択アイテムを中心に最大5件表示
      const visibleCount = 4;
      let start = Math.max(0, this.selectedIndex - 1);
      if (start + visibleCount > total) {
        start = Math.max(0, total - visibleCount);
      }
      const end = Math.min(total, start + visibleCount);

      for (let i = start; i < end; i++) {
        const note = this.currentNotes[i];
        const isSelected = i === this.selectedIndex;
        const prefix = isSelected ? "> " : "  ";
        const pin = note.isPinned ? "★ " : "";
        const arch = note.isArchived ? "[アーカイブ] " : "";
        
        let displayTitle = note.title;
        let sub = "";

        if (note.items && note.items.length > 0) {
          const checked = note.items.filter((item) => item.checked).length;
          sub = ` [${checked}/${note.items.length}]`;
          if (!displayTitle) {
            displayTitle = note.items[0]?.text?.slice(0, 14) || "ToDoリスト";
          }
        } else if (note.text) {
          const cleanText = note.text.replace(/\n/g, " ").trim();
          if (!displayTitle) {
            displayTitle = cleanText.slice(0, 18) || "(無題)";
          } else {
            sub = ` - ${cleanText.slice(0, 12)}`;
          }
        } else {
          displayTitle = displayTitle || "(無題)";
        }

        const line = `${prefix}${pin}${arch}${i + 1}. ${displayTitle}${sub}`;
        bodyText += (bodyText ? "\n" : "") + line;
      }
    }

    containers.push(
      new TextContainerProperty({
        containerID: 2,
        containerName: "body_list",
        zOrderIndex: 2,
        xPosition: 12,
        yPosition: 52,
        width: 552,
        height: 180,
        content: bodyText,
        textColor: this.brightness,
        isEventCapture: 1, // タッチやスワイプイベントを捕捉
      })
    );

    // 3. フッター案内 (ID: 3)
    const footerText = "Tap: 詳細 | 長押し: アーカイブ切替 | 2Tap: 同期";
    containers.push(
      new TextContainerProperty({
        containerID: 3,
        containerName: "footer",
        zOrderIndex: 3,
        xPosition: 12,
        yPosition: 242,
        width: 552,
        height: 36,
        content: footerText,
        textColor: Math.max(1, this.brightness - 1),
        isEventCapture: 0,
      })
    );

    return containers;
  }

  /**
   * 詳細表示用のコンテナ作成
   */
  private buildDetailContainers(): TextContainerProperty[] {
    const containers: TextContainerProperty[] = [];
    const note = this.getCurrentNote();

    if (!note) {
      this.currentMode = "list";
      return this.buildListContainers();
    }

    const lines = this.formatNoteLines(note);
    const pageSize = 6; // 1画面に表示する行数
    const totalPages = Math.max(1, Math.ceil(lines.length / pageSize));
    const currentPage = Math.min(totalPages - 1, this.detailScrollPage);

    const start = currentPage * pageSize;
    const end = Math.min(lines.length, start + pageSize);
    const visibleLines = lines.slice(start, end);
    const bodyText = visibleLines.join("\n") || "(内容がありません)";

    // 1. ヘッダー (ID: 1)
    const pin = note.isPinned ? "★ " : "";
    const noteTitle = note.title || (note.text ? note.text.replace(/\n/g, " ").trim().slice(0, 16) : "メモ詳細");
    const titleText = `${pin}${noteTitle}  (${currentPage + 1}/${totalPages}P)`;
    containers.push(
      new TextContainerProperty({
        containerID: 1,
        containerName: "header",
        zOrderIndex: 1,
        xPosition: 12,
        yPosition: 10,
        width: 552,
        height: 36,
        content: titleText,
        textColor: this.brightness,
        isEventCapture: 0,
      })
    );

    // 2. メイン本文 (ID: 2)
    containers.push(
      new TextContainerProperty({
        containerID: 2,
        containerName: "body_detail",
        zOrderIndex: 2,
        xPosition: 12,
        yPosition: 52,
        width: 552,
        height: 180,
        content: bodyText,
        textColor: this.brightness,
        isEventCapture: 1,
      })
    );

    // 3. フッター案内 (ID: 3)
    const isTodo = Boolean(note.items && note.items.length > 0);
    const footerText = isTodo
      ? "Tap: 完了トグル | 2Tap: 戻る | Swipe: 送り"
      : "Tap/Swipe: ページ送り | 2Tap: 戻る";
    containers.push(
      new TextContainerProperty({
        containerID: 3,
        containerName: "footer",
        zOrderIndex: 3,
        xPosition: 12,
        yPosition: 242,
        width: 552,
        height: 36,
        content: footerText,
        textColor: Math.max(1, this.brightness - 1),
        isEventCapture: 0,
      })
    );

    return containers;
  }

  /**
   * メモを行単位の配列に整形（チェックリスト対応）
   */
  private formatNoteLines(note: KeepNote): string[] {
    const lines: string[] = [];

    if (note.items && note.items.length > 0) {
      note.items.forEach((item) => {
        const mark = item.checked ? "[v] " : "[ ] ";
        const itemLines = this.wrapText(mark + item.text, 26);
        lines.push(...itemLines);
      });
    } else if (note.text) {
      const rawLines = note.text.split("\n");
      rawLines.forEach((r) => {
        if (r.trim().length === 0) {
          lines.push("");
        } else {
          lines.push(...this.wrapText(r, 26));
        }
      });
    }

    return lines;
  }

  /**
   * 文字列を指定文字数で折り返し
   */
  private wrapText(text: string, maxCharsPerLine: number = 26): string[] {
    const result: string[] = [];
    let cur = "";
    let curWidth = 0;

    for (const char of text) {
      // 全角文字は幅2、半角文字は幅1として簡易計算
      const charWidth = char.charCodeAt(0) > 255 ? 2 : 1;
      if (curWidth + charWidth > maxCharsPerLine * 2) {
        result.push(cur);
        cur = char;
        curWidth = charWidth;
      } else {
        cur += char;
        curWidth += charWidth;
      }
    }
    if (cur) {
      result.push(cur);
    }
    return result;
  }

  /**
   * スマホ画面用のプレビューテキストを取得
   */
  getPreviewContent(): { title: string; body: string; footer: string } {
    if (this.currentMode === "list") {
      const listContainers = this.buildListContainers();
      return {
        title: listContainers[0]?.content || "",
        body: listContainers[1]?.content || "",
        footer: listContainers[2]?.content || "",
      };
    } else {
      const detailContainers = this.buildDetailContainers();
      return {
        title: detailContainers[0]?.content || "",
        body: detailContainers[1]?.content || "",
        footer: detailContainers[2]?.content || "",
      };
    }
  }
}
