import {
  waitForEvenAppBridge,
  EvenAppBridge,
  CreateStartUpPageContainer,
  RebuildPageContainer,
  TextContainerUpgrade,
  TextContainerProperty,
  StartUpPageCreateResult,
  EvenHubEvent,
  DeviceStatus,
  DeviceInfo,
} from "@evenrealities/even_hub_sdk";

export type GlassEventListener = (event: EvenHubEvent) => void;
export type DeviceStatusListener = (status: DeviceStatus) => void;

class EvenBridgeService {
  private bridge: EvenAppBridge | null = null;
  private isInitialized = false;
  private isPageCreated = false;
  private eventListeners: GlassEventListener[] = [];
  private deviceListeners: DeviceStatusListener[] = [];
  private currentDeviceStatus: DeviceStatus | null = null;
  private deviceInfo: DeviceInfo | null = null;

  /**
   * EvenAppBridgeの初期化
   */
  async init(): Promise<boolean> {
    if (this.isInitialized && this.bridge) {
      return true;
    }

    try {
      console.log("[EvenBridge] Connecting to EvenAppBridge...");
      const isEvenApp =
        typeof window !== "undefined" &&
        (Boolean((window as any).flutter_inappwebview) ||
          navigator.userAgent.includes("EvenApp"));

      const timeoutMs = isEvenApp ? 12000 : 3500;
      const bridgePromise = waitForEvenAppBridge();
      const timeoutPromise = new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), timeoutMs)
      );

      const result = await Promise.race([bridgePromise, timeoutPromise]);
      if (result) {
        this.bridge = result;
        this.isInitialized = true;
        console.log("[EvenBridge] Connected successfully!");

        // イベント購読
        this.bridge.onEvenHubEvent((event: EvenHubEvent) => {
          console.log("[EvenBridge] Event received:", event);
          this.eventListeners.forEach((listener) => {
            try {
              listener(event);
            } catch (err) {
              console.error("[EvenBridge] Error in event listener:", err);
            }
          });
        });

        this.bridge.onDeviceStatusChanged((status: DeviceStatus) => {
          this.currentDeviceStatus = status;
          this.deviceListeners.forEach((listener) => listener(status));
        });

        try {
          this.deviceInfo = await this.bridge.getDeviceInfo();
        } catch {
          // ignore
        }

        return true;
      } else {
        console.warn("[EvenBridge] Bridge connection timeout (running in browser/preview mode)");
        return false;
      }
    } catch (err) {
      console.warn("[EvenBridge] Failed to init bridge (running in browser):", err);
      return false;
    }
  }

  isReady(): boolean {
    return this.isInitialized && this.bridge !== null;
  }

  getDeviceStatus(): DeviceStatus | null {
    return this.currentDeviceStatus;
  }

  getDeviceInfo(): DeviceInfo | null {
    return this.deviceInfo;
  }

  addListener(listener: GlassEventListener): () => void {
    this.eventListeners.push(listener);
    return () => {
      this.eventListeners = this.eventListeners.filter((l) => l !== listener);
    };
  }

  addDeviceStatusListener(listener: DeviceStatusListener): () => void {
    this.deviceListeners.push(listener);
    return () => {
      this.deviceListeners = this.deviceListeners.filter((l) => l !== listener);
    };
  }

  /**
   * 最初の画面コンテナを作成（初回のみcreateStartUpPageContainer、2回目以降はrebuildPageContainer）
   */
  async renderPage(textContainers: TextContainerProperty[]): Promise<boolean> {
    if (!this.bridge) {
      console.log("[EvenBridge Mock] Render page:", textContainers.map((c) => c.content));
      return false;
    }

    try {
      if (!this.isPageCreated) {
        const createParam = new CreateStartUpPageContainer({
          containerTotalNum: textContainers.length,
          textObject: textContainers,
        });
        const result = await this.bridge.createStartUpPageContainer(createParam);
        console.log("[EvenBridge] Startup page created. Code:", result);
        if (result === StartUpPageCreateResult.success) {
          this.isPageCreated = true;
          return true;
        } else {
          console.warn("[EvenBridge] Failed to create startup page, code:", result);
          return false;
        }
      } else {
        const rebuildParam = new RebuildPageContainer({
          containerTotalNum: textContainers.length,
          textObject: textContainers,
        });
        const success = await this.bridge.rebuildPageContainer(rebuildParam);
        return success;
      }
    } catch (err) {
      console.error("[EvenBridge] Error rendering page:", err);
      return false;
    }
  }

  /**
   * 部分テキスト更新（チラつきなし）
   */
  async updateText(
    containerID: number,
    content: string,
    brightness: number = 4
  ): Promise<boolean> {
    if (!this.bridge) {
      console.log(`[EvenBridge Mock] Update text [ID:${containerID}]:`, content);
      return false;
    }

    try {
      const upgrade = new TextContainerUpgrade({
        containerID,
        containerName: `container_${containerID}`,
        contentOffset: 0,
        contentLength: content.length,
        content,
        textColor: Math.min(4, Math.max(0, brightness)),
      });
      return await this.bridge.textContainerUpgrade(upgrade);
    } catch (err) {
      console.error("[EvenBridge] Error updating text container:", err);
      return false;
    }
  }

  /**
   * グラス上のページコンテナを閉じて待受画面（時計）に戻る
   */
  async closeApp(): Promise<boolean> {
    if (!this.bridge) {
      console.log("[EvenBridge Mock] Close app / shutDownPageContainer called");
      return false;
    }
    try {
      this.isPageCreated = false;
      return await this.bridge.shutDownPageContainer(0);
    } catch (err) {
      console.error("[EvenBridge] Error shutting down page container:", err);
      return false;
    }
  }

  /**
   * シミュレータ/ブラウザ環境用の疑似イベントディスパッチ
   */
  dispatchMockEvent(event: EvenHubEvent) {
    this.eventListeners.forEach((listener) => listener(event));
  }
}

export const evenBridge = new EvenBridgeService();
