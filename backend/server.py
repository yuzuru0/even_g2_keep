import os
import json
import logging
from typing import List, Optional, Dict, Any
from datetime import datetime
from pydantic import BaseModel
from fastapi import FastAPI, HTTPException, Depends, Header, Query, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

# 環境変数の読み込み
load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("KeepSync")

# セキュリティ保護用アクセスキー (設定されている場合のみ認証を要求)
APP_SECRET = (os.getenv("APP_SECRET") or os.getenv("API_KEY") or "").strip()
if APP_SECRET:
    logger.info("Security protection is ENABLED (APP_SECRET is set). API requests require authentication.")
else:
    logger.info("Security protection is DISABLED (APP_SECRET not set). API is publicly accessible.")

def verify_api_key(
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
    key: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    if not APP_SECRET:
        return True

    provided_key = (x_api_key or key or "").strip()
    if not provided_key and authorization and authorization.startswith("Bearer "):
        provided_key = authorization[7:].strip()

    if not provided_key or provided_key != APP_SECRET:
        raise HTTPException(
            status_code=401,
            detail="Unauthorized: Missing or invalid API key. Please configure access key in settings.",
        )
    return True

app = FastAPI(title="Google Keep Sync Server for Even G2", version="1.0.0")

# CORS設定（Even G2 WebViewやローカル開発環境からのアクセスを許可）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def path_secret_middleware(request: Request, call_next):
    # パスが /s/{secret_key}/api/... の場合、URLパスからキーを抽出し、元の /api/... へ転送
    # これにより、古いアプリや設定欄がない環境でも、URL欄に "https://xxx/s/KEY" と入力するだけで認証を通過可能
    path = request.url.path
    if path.startswith("/s/"):
        parts = path.split("/", 3)
        if len(parts) >= 4:
            secret_in_path = parts[2]
            target_path = "/" + parts[3]
            request.scope["path"] = target_path
            headers = dict(request.scope.get("headers", []))
            headers[b"x-api-key"] = secret_in_path.encode("utf-8")
            request.scope["headers"] = list(headers.items())
    response = await call_next(request)
    return response

def exchange_oauth_token_to_master(email: str, raw_token: str) -> Optional[str]:
    """
    ブラウザの accounts.google.com/EmbeddedSetup から取得した oauth_token (oauth2_4/...) を
    永続的な master_token (aas_et/...) へ変換します。
    """
    try:
        import gpsoauth
        android_id = "0123456789abcdef"
        res = gpsoauth.exchange_token(email.strip(), raw_token.strip(), android_id)
        if isinstance(res, dict) and "Token" in res:
            return res["Token"]
        logger.warning(f"gpsoauth.exchange_token response did not contain 'Token': {res}")
        return None
    except Exception as e:
        logger.error(f"gpsoauth.exchange_token failed: {e}")
        return None

class TokenSetupRequest(BaseModel):
    email: str
    token: str
    app_secret: Optional[str] = None

class KeepListItemModel(BaseModel):
    id: str
    text: str
    checked: bool

class KeepNoteModel(BaseModel):
    id: str
    title: str
    text: str
    items: Optional[List[KeepListItemModel]] = None
    isPinned: bool = False
    color: Optional[str] = None
    updatedAt: str
    labels: Optional[List[str]] = None

class CreateNoteRequest(BaseModel):
    title: str
    text: str = ""
    is_list: bool = False
    items: Optional[List[str]] = None

# デモ用フォールバックデータ
DEMO_NOTES: List[Dict[str, Any]] = [
    {
        "id": "demo-1",
        "title": "スーパー買い物リスト",
        "text": "",
        "items": [
            {"id": "item-1", "text": "牛乳 (低脂肪乳)", "checked": False},
            {"id": "item-2", "text": "卵 (10個入り)", "checked": True},
            {"id": "item-3", "text": "食パン (6枚切り)", "checked": False},
            {"id": "item-4", "text": "無塩バター", "checked": False},
            {"id": "item-5", "text": "バナナ (1房)", "checked": True},
            {"id": "item-6", "text": "玉ねぎ・じゃがいも", "checked": False},
        ],
        "isPinned": True,
        "color": "yellow",
        "updatedAt": datetime.now().isoformat(),
        "labels": ["買い物"],
    },
    {
        "id": "demo-2",
        "title": "本日の優先タスク",
        "text": "1. 10:00 チーム定例ミーティング\n2. G2アプリの動作確認とビルド\n3. 来期のプロジェクト要件書作成\n4. 経費精算の提出（締切今日中！）",
        "items": None,
        "isPinned": True,
        "color": "green",
        "updatedAt": datetime.now().isoformat(),
        "labels": ["仕事"],
    },
    {
        "id": "demo-3",
        "title": "スマートグラス活用アイデア",
        "text": "Even G2の透過型ディスプレイはハンズフリーでの情報閲覧に最適。\n・買い物時のチェックリスト参照\n・プレゼン時の発表用カンペ\n・料理中のレシピ確認\n・駅や空港での案内確認",
        "items": None,
        "isPinned": False,
        "color": "blue",
        "updatedAt": datetime.now().isoformat(),
        "labels": ["アイデア"],
    },
]

class KeepSyncManager:
    def __init__(self):
        self.keep = None
        self.is_authenticated = False
        self.is_demo_mode = True
        self.cached_notes: List[Dict[str, Any]] = DEMO_NOTES
        self.last_sync_time: Optional[datetime] = None
        self.auth_error: Optional[str] = None
        self.token_file = os.path.join(os.path.dirname(__file__), "token.json")

    def init_keep(self):
        try:
            import gkeepapi
            self.keep = gkeepapi.Keep()
        except ImportError:
            logger.warning("gkeepapi is not installed. Running in DEMO/MOCK mode.")
            self.auth_error = "gkeepapi package is not installed."
            self.is_demo_mode = True
            return

        email = (os.getenv("GOOGLE_EMAIL") or "").strip()
        app_password = (os.getenv("GOOGLE_APP_PASSWORD") or "").strip()
        master_token = (os.getenv("GOOGLE_MASTER_TOKEN") or "").strip()

        # 1. 保存済みトークンからのログイン試行
        if os.path.exists(self.token_file) and email:
            try:
                with open(self.token_file, "r", encoding="utf-8") as f:
                    token_data = json.load(f)
                    cached_token = (token_data.get("master_token") or "").strip()
                if cached_token:
                    logger.info("Attempting resume with saved master token...")
                    self.keep.resume(email, cached_token)
                    self.is_authenticated = True
                    self.is_demo_mode = False
                    self.auth_error = None
                    self.sync()
                    logger.info("Keep authentication resumed successfully!")
                    return
            except Exception as e:
                logger.warning(f"Failed to resume with saved token: {e}")
                self.auth_error = f"Saved token resume failed: {e}"

        # 2. 環境変数からのマスター トークンログイン
        if master_token and email:
            # 未変換の oauth_token (oauth2_4/...) が渡された場合、自動変換
            if master_token.startswith("oauth2_4/") or not master_token.startswith("aas_et/"):
                logger.info("Detected oauth_token in GOOGLE_MASTER_TOKEN. Auto-exchanging via gpsoauth...")
                exchanged = exchange_oauth_token_to_master(email, master_token)
                if exchanged:
                    logger.info("=" * 65)
                    logger.info("★ [SUCCESS] oauth_token automatically converted to permanent master_token!")
                    logger.info(f"★ GOOGLE_MASTER_TOKEN: {exchanged}")
                    logger.info("★ Tip: Update your Render environment variable with this value to persist.")
                    logger.info("=" * 65)
                    master_token = exchanged
                    self._save_token(master_token)
                else:
                    logger.warning("Could not convert token via gpsoauth. Will attempt to use as-is.")

            try:
                logger.info(f"Attempting login for {email} with GOOGLE_MASTER_TOKEN...")
                self.keep.resume(email, master_token)
                self.is_authenticated = True
                self.is_demo_mode = False
                self.auth_error = None
                self.sync()
                self._save_token(master_token)
                logger.info("Master token authentication successful!")
                return
            except Exception as e:
                logger.error(f"Master token login failed: {e}")
                self.auth_error = f"Master token login failed: {e}"

        # 3. アプリパスワードでのログイン
        if email and app_password:
            try:
                logger.info(f"Attempting login for {email} with App Password...")
                self.keep.login(email, app_password)
                self.is_authenticated = True
                self.is_demo_mode = False
                self.auth_error = None
                master_token = self.keep.getMasterToken()
                self._save_token(master_token)
                self.sync()
                logger.info("App password authentication successful!")
                return
            except Exception as e:
                logger.error(f"Login failed: {e}")
                self.auth_error = f"Login failed: {e}"
                logger.warning("Falling back to DEMO/MOCK mode.")
                self.is_demo_mode = True
        else:
            if not email:
                msg = "GOOGLE_EMAIL is not set in environment variables."
            elif not master_token and not app_password:
                msg = "GOOGLE_MASTER_TOKEN is not set in environment variables."
            else:
                msg = "Missing Google Keep credentials."
            logger.info(f"{msg} Running in DEMO mode.")
            self.auth_error = msg
            self.is_demo_mode = True

    def _save_token(self, token: str):
        try:
            with open(self.token_file, "w", encoding="utf-8") as f:
                json.dump({"master_token": token, "updated_at": datetime.now().isoformat()}, f)
        except Exception as e:
            logger.warning(f"Failed to save token file: {e}")

    def sync(self):
        if self.is_demo_mode or not self.keep:
            return

        try:
            logger.info("Syncing with Google Keep server...")
            self.keep.sync()
            notes_data = []

            # ゴミ箱以外のメモを取得
            all_notes = list(self.keep.all())

            for n in all_notes:
                if n.trashed:
                    continue

                items_list = None
                # チェックリストメモの場合
                if hasattr(n, "items") and n.items:
                    items_list = [
                        {
                            "id": item.id,
                            "text": item.text,
                            "checked": item.checked,
                        }
                        for item in n.items
                    ]

                updated_dt = n.timestamps.updated if hasattr(n.timestamps, "updated") else None
                created_dt = n.timestamps.created if hasattr(n.timestamps, "created") else None

                notes_data.append({
                    "id": n.id,
                    "title": n.title or "",
                    "text": n.text or "",
                    "items": items_list,
                    "isPinned": bool(getattr(n, "pinned", False)),
                    "isArchived": bool(getattr(n, "archived", False)),
                    "color": str(n.color.name).lower() if hasattr(n, "color") and n.color else "white",
                    "updatedAt": updated_dt.isoformat() if updated_dt else datetime.now().isoformat(),
                    "createdAt": created_dt.isoformat() if created_dt else None,
                    "labels": [label.name for label in n.labels.all()] if hasattr(n, "labels") else [],
                    "_updated_ts": updated_dt.timestamp() if updated_dt else 0,
                    "_created_ts": created_dt.timestamp() if created_dt else 0,
                })

            self.cached_notes = notes_data
            self.last_sync_time = datetime.now()
            logger.info(f"Sync complete. {len(self.cached_notes)} total notes retrieved.")
        except Exception as e:
            logger.error(f"Error during Keep sync: {e}")

    def get_notes(self, include_archived: bool = False, sort_by: str = "updated", force_sync: bool = False) -> List[Dict[str, Any]]:
        # キャッシュの有効期限（TTL: デフォルト20秒）または force_sync が指定された場合、自動再同期
        now = datetime.now()
        ttl_seconds = int(os.getenv("SYNC_CACHE_TTL", "20"))
        should_sync = force_sync or (self.last_sync_time is None) or ((now - self.last_sync_time).total_seconds() >= ttl_seconds)

        if should_sync and not self.is_demo_mode and self.keep:
            logger.info(f"Auto-syncing with Google Keep (force={force_sync}, ttl={ttl_seconds}s)...")
            self.sync()

        # 1. アーカイブ除外フィルタ (デフォルト: アーカイブは含めない)
        filtered = [
            n for n in self.cached_notes
            if include_archived or not n.get("isArchived", False)
        ]

        # 2. ソート処理: ピン留めメモを最優先 (1 > 0)、その中で指定の順序に並び替え
        if sort_by == "created":
            # 作成日時降順 (最新作成が上)
            filtered.sort(
                key=lambda n: (
                    1 if n.get("isPinned") else 0,
                    n.get("_created_ts", 0),
                ),
                reverse=True,
            )
        elif sort_by == "title":
            # タイトル昇順（ピン留め優先）
            filtered.sort(
                key=lambda n: (
                    0 if n.get("isPinned") else 1,
                    n.get("title", "").lower(),
                )
            )
        else:
            # デフォルト: 更新日時降順 (最新編集が上)
            filtered.sort(
                key=lambda n: (
                    1 if n.get("isPinned") else 0,
                    n.get("_updated_ts", 0),
                ),
                reverse=True,
            )

        return filtered

    def toggle_item(self, note_id: str, item_id: str) -> bool:
        if self.is_demo_mode or not self.keep:
            for note in self.cached_notes:
                if note["id"] == note_id and note.get("items"):
                    for item in note["items"]:
                        if item["id"] == item_id:
                            item["checked"] = not item["checked"]
                            return True
            return False

        try:
            note = self.keep.get(note_id)
            if note and hasattr(note, "items"):
                for item in note.items:
                    if item.id == item_id:
                        item.checked = not item.checked
                        self.keep.sync()
                        self.sync()
                        return True
        except Exception as e:
            logger.error(f"Error toggling item: {e}")
        return False

    def create_note(self, req: CreateNoteRequest) -> Dict[str, Any]:
        if self.is_demo_mode or not self.keep:
            new_note = {
                "id": f"demo-{datetime.now().timestamp()}",
                "title": req.title,
                "text": req.text,
                "items": [{"id": f"i-{idx}", "text": t, "checked": False} for idx, t in enumerate(req.items)] if req.is_list and req.items else None,
                "isPinned": False,
                "color": "white",
                "updatedAt": datetime.now().isoformat(),
                "labels": [],
            }
            self.cached_notes.insert(0, new_note)
            return new_note

        try:
            if req.is_list and req.items:
                note = self.keep.createList(req.title, [(t, False) for t in req.items])
            else:
                note = self.keep.createNote(req.title, req.text)
            self.keep.sync()
            self.sync()
            return {"id": note.id, "title": note.title}
        except Exception as e:
            logger.error(f"Error creating note: {e}")
            raise HTTPException(status_code=500, detail=str(e))

keep_manager = KeepSyncManager()

@app.on_event("startup")
def startup_event():
    keep_manager.init_keep()

@app.get("/healthz")
@app.get("/health")
def healthz():
    """Render/UptimeRobot/cron-job.org用ヘルスチェックエンドポイント (認証不要)"""
    return {"status": "ok", "time": datetime.now().isoformat()}

@app.get("/api/auth-info")
def auth_info():
    """クライアントが認証必須かどうかを判定するための公開エンドポイント"""
    return {
        "auth_required": bool(APP_SECRET),
    }

@app.get("/api/status", dependencies=[Depends(verify_api_key)])
def get_status():
    return {
        "service": "Google Keep Sync Server for Even Realities G2",
        "status": "running",
        "is_demo_mode": keep_manager.is_demo_mode,
        "is_authenticated": keep_manager.is_authenticated,
        "auth_error": keep_manager.auth_error,
        "notes_count": len(keep_manager.cached_notes),
        "last_sync": keep_manager.last_sync_time.isoformat() if keep_manager.last_sync_time else None,
    }

@app.get("/api/notes", dependencies=[Depends(verify_api_key)])
def get_notes(include_archived: bool = False, sort_by: str = "updated", sync: bool = False):
    return {
        "notes": keep_manager.get_notes(include_archived=include_archived, sort_by=sort_by, force_sync=sync),
        "is_demo": keep_manager.is_demo_mode,
        "is_authenticated": keep_manager.is_authenticated,
        "auth_error": keep_manager.auth_error,
        "notes_count": len(keep_manager.cached_notes),
        "last_sync": keep_manager.last_sync_time.isoformat() if keep_manager.last_sync_time else None,
    }

@app.post("/api/notes/sync", dependencies=[Depends(verify_api_key)])
def trigger_sync():
    keep_manager.sync()
    return {
        "success": True,
        "is_demo": keep_manager.is_demo_mode,
        "is_authenticated": keep_manager.is_authenticated,
        "auth_error": keep_manager.auth_error,
        "notes_count": len(keep_manager.cached_notes),
        "last_sync": keep_manager.last_sync_time.isoformat() if keep_manager.last_sync_time else None,
    }

@app.post("/api/notes/{note_id}/items/{item_id}/toggle", dependencies=[Depends(verify_api_key)])
def toggle_check(note_id: str, item_id: str):
    success = keep_manager.toggle_item(note_id, item_id)
    if not success:
        raise HTTPException(status_code=404, detail="Item not found")
    return {"success": True}

@app.post("/api/notes", dependencies=[Depends(verify_api_key)])
def create_new_note(req: CreateNoteRequest):
    result = keep_manager.create_note(req)
    return {"success": True, "note": result}

SETUP_HTML_PAGE = """<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Google Keep Token Setup | Even Realities G2</title>
  <style>
    :root {
      --bg: #0d1117;
      --card-bg: #161b22;
      --card-border: #30363d;
      --text: #c9d1d9;
      --text-muted: #8b949e;
      --accent: #00e599;
      --accent-hover: #00c784;
      --error: #f85149;
      --input-bg: #0d1117;
      --input-border: #30363d;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      padding: 24px 16px;
      display: flex;
      justify-content: center;
      min-height: 100vh;
    }
    .container {
      width: 100%;
      max-width: 680px;
    }
    .header {
      text-align: center;
      margin-bottom: 24px;
    }
    .logo-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 0.85rem;
      color: var(--accent);
      background: rgba(0, 229, 153, 0.1);
      border: 1px solid rgba(0, 229, 153, 0.25);
      padding: 4px 12px;
      border-radius: 9999px;
      margin-bottom: 12px;
    }
    h1 {
      font-size: 1.6rem;
      font-weight: 700;
      color: #fff;
      margin-bottom: 8px;
    }
    .subtitle {
      font-size: 0.95rem;
      color: var(--text-muted);
      line-height: 1.5;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 20px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.2);
    }
    .step-badge {
      display: inline-block;
      background: var(--accent);
      color: #000;
      font-weight: 700;
      font-size: 0.75rem;
      padding: 2px 8px;
      border-radius: 4px;
      margin-bottom: 8px;
    }
    h2 {
      font-size: 1.15rem;
      color: #fff;
      margin-bottom: 12px;
    }
    .guide-box {
      background: rgba(255, 255, 255, 0.03);
      border: 1px dashed var(--card-border);
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 16px;
      font-size: 0.9rem;
      line-height: 1.6;
    }
    .guide-box ol {
      padding-left: 20px;
      margin-top: 6px;
    }
    .guide-box li {
      margin-bottom: 6px;
    }
    .guide-box a {
      color: var(--accent);
      text-decoration: none;
      font-weight: 600;
    }
    .guide-box a:hover {
      text-decoration: underline;
    }
    .form-group {
      margin-bottom: 16px;
    }
    label {
      display: block;
      font-size: 0.85rem;
      font-weight: 600;
      margin-bottom: 6px;
      color: var(--text);
    }
    input {
      width: 100%;
      background: var(--input-bg);
      border: 1px solid var(--input-border);
      color: #fff;
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 0.95rem;
      font-family: inherit;
      transition: border-color 0.2s;
    }
    input:focus {
      outline: none;
      border-color: var(--accent);
    }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      width: 100%;
      padding: 12px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 1rem;
      cursor: pointer;
      border: none;
      transition: all 0.2s;
    }
    .btn-primary {
      background: var(--accent);
      color: #000;
    }
    .btn-primary:hover {
      background: var(--accent-hover);
    }
    .btn-primary:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .btn-secondary {
      background: #21262d;
      color: var(--text);
      border: 1px solid var(--card-border);
      text-decoration: none;
      margin-top: 12px;
    }
    .btn-secondary:hover {
      background: #30363d;
    }
    .status-box {
      display: none;
      border-radius: 8px;
      padding: 16px;
      margin-top: 16px;
      font-size: 0.9rem;
      line-height: 1.5;
    }
    .status-box.success {
      display: block;
      background: rgba(0, 229, 153, 0.1);
      border: 1px solid var(--accent);
      color: #fff;
    }
    .status-box.error {
      display: block;
      background: rgba(248, 81, 73, 0.1);
      border: 1px solid var(--error);
      color: var(--error);
    }
    .token-display {
      margin-top: 12px;
    }
    .token-row {
      display: flex;
      gap: 8px;
      margin-top: 6px;
    }
    .token-row input {
      font-family: monospace;
      font-size: 0.85rem;
      color: var(--accent);
    }
    .token-row button {
      padding: 0 16px;
      background: #21262d;
      color: #fff;
      border: 1px solid var(--card-border);
      border-radius: 8px;
      cursor: pointer;
      white-space: nowrap;
    }
    .token-row button:hover {
      background: #30363d;
    }
    .note-tip {
      font-size: 0.8rem;
      color: var(--text-muted);
      margin-top: 8px;
      line-height: 1.4;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo-badge">
        <span>🕶️ Even Realities G2</span>
        <span>•</span>
        <span>Google Keep Sync</span>
      </div>
      <h1>Google Keep トークン設定ウィザード</h1>
      <p class="subtitle">
        Python環境やコマンドライン操作は不要です。ブラウザだけでGoogle Keep連携用トークンを設定・取得できます。
      </p>
    </div>

    <div class="card">
      <span class="step-badge">STEP 1</span>
      <h2>ブラウザから oauth_token を取得</h2>
      <div class="guide-box">
        <ol>
          <li>PCの Google Chrome（または Edge）で <code>F12</code> キー（または右クリック「検証」）を押し、開発者ツールを開きます。</li>
          <li><strong>「アプリケーション (Application)」</strong>タブ &gt; <strong>「Cookie」</strong> &gt; <code>https://accounts.google.com</code> を選択します。</li>
          <li>以下のリンクを開き、Googleアカウントでログインします:<br>
            👉 <a href="https://accounts.google.com/EmbeddedSetup" target="_blank" rel="noopener">https://accounts.google.com/EmbeddedSetup ↗</a><br>
            <span style="font-size:0.8rem; color:#f0883e;">※ ログイン後に画面が真っ白のまま停止したり応答が返ってこないのは<strong>正常な仕様</strong>です。完了画面への遷移は行われません。</span>
          </li>
          <li>開いている開発者ツールの Cookie 一覧から <strong><code>oauth_token</code></strong> の値（<code>oauth2_4/...</code> から始まる文字列）をダブルクリックしてコピーします。</li>
        </ol>
      </div>

      <span class="step-badge">STEP 2</span>
      <h2>サーバーへ登録・永続トークン発行</h2>
      <form id="token-form">
        <div class="form-group">
          <label for="email">Google メールアドレス</label>
          <input type="email" id="email" required placeholder="your.email@gmail.com" />
        </div>
        <div class="form-group">
          <label for="token">コピーした oauth_token (または master_token)</label>
          <input type="text" id="token" required placeholder="oauth2_4/..." />
        </div>
        <div class="form-group" id="group-secret">
          <label for="app_secret">アクセスキー (APP_SECRET) <span id="secret-tag" style="color:var(--text-muted); font-size:0.75rem; font-weight:normal;"></span></label>
          <input type="password" id="app_secret" placeholder="サーバーで設定した合言葉 (未設定なら空欄)" />
        </div>
        <button type="submit" class="btn btn-primary" id="btn-submit">
          <span>🚀 Keepに接続テスト & トークン発行</span>
        </button>
      </form>

      <div class="status-box" id="status-box"></div>

      <div id="result-section" style="display: none; margin-top: 20px;">
        <div class="token-display">
          <label>永続マスタートークン (GOOGLE_MASTER_TOKEN):</label>
          <div class="token-row">
            <input type="text" id="out-token" readonly />
            <button id="btn-copy">📋 コピー</button>
          </div>
          <p class="note-tip">
            💡 <strong>Render.com をお使いの場合:</strong> Render の Dashboard &gt;「Environment」を開き、<code>GOOGLE_MASTER_TOKEN</code> に上記の値を貼り付けて保存してください。これによりサーバー再起動後もログインが恒久的に維持されます。
          </p>
        </div>
        <a href="/" class="btn btn-secondary">
          <span>👓 Even G2 Keep ビューアーへ戻る ↗</span>
        </a>
      </div>
    </div>
  </div>

  <script>
    const form = document.getElementById("token-form");
    const statusBox = document.getElementById("status-box");
    const resultSection = document.getElementById("result-section");
    const outToken = document.getElementById("out-token");
    const btnSubmit = document.getElementById("btn-submit");
    const btnCopy = document.getElementById("btn-copy");

    fetch("/api/auth-info")
      .then(res => res.json())
      .then(data => {
        const tag = document.getElementById("secret-tag");
        if (data.auth_required) {
          tag.innerText = "(※このサーバーはセキュリティ保護されているため入力必須です)";
          tag.style.color = "var(--accent)";
        } else {
          tag.innerText = "(※このサーバーは未保護のため空欄でOKです)";
        }
      })
      .catch(() => {});

    btnCopy.addEventListener("click", () => {
      outToken.select();
      navigator.clipboard.writeText(outToken.value);
      btnCopy.innerText = "✓ コピー完了!";
      setTimeout(() => { btnCopy.innerText = "📋 コピー"; }, 2000);
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      statusBox.className = "status-box";
      statusBox.style.display = "none";
      resultSection.style.display = "none";
      btnSubmit.disabled = true;
      btnSubmit.innerHTML = "<span>⏳ Googleと通信中 (数秒かかります)...</span>";

      const email = document.getElementById("email").value.trim();
      const token = document.getElementById("token").value.trim();
      const app_secret = document.getElementById("app_secret").value.trim();

      try {
        const res = await fetch("/api/setup-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, token, app_secret })
        });

        const data = await res.json();
        if (res.ok && data.success) {
          statusBox.className = "status-box success";
          statusBox.innerHTML = `<strong>🎉 認証成功！</strong><br>${data.message}`;
          outToken.value = data.master_token;
          resultSection.style.display = "block";
        } else {
          statusBox.className = "status-box error";
          statusBox.innerHTML = `<strong>❌ 接続エラー</strong><br>${data.detail || "トークンの変換またはKeep接続に失敗しました。"}`;
        }
      } catch (err) {
        statusBox.className = "status-box error";
        statusBox.innerHTML = `<strong>❌ 通信エラー</strong><br>${err.message}`;
      } finally {
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = "<span>🚀 Keepに接続テスト & トークン発行</span>";
      }
    });
  </script>
</body>
</html>
"""

@app.get("/setup", response_class=HTMLResponse)
def setup_page():
    return SETUP_HTML_PAGE

@app.post("/api/setup-token")
def setup_token(req: TokenSetupRequest):
    if APP_SECRET:
        if not req.app_secret or req.app_secret != APP_SECRET:
            raise HTTPException(
                status_code=401,
                detail="Invalid APP_SECRET. Please enter the correct secret key configured on this server.",
            )

    email = req.email.strip()
    raw_token = req.token.strip()
    if not email or not raw_token:
        raise HTTPException(status_code=400, detail="Google email and token are required.")

    master_token = raw_token
    if raw_token.startswith("oauth2_4/") or not raw_token.startswith("aas_et/"):
        logger.info(f"Exchanging token for {email} via setup endpoint...")
        exchanged = exchange_oauth_token_to_master(email, raw_token)
        if not exchanged:
            raise HTTPException(
                status_code=400,
                detail="Failed to exchange oauth_token with Google. Please check that the token is valid, not expired, and matches the email address.",
            )
        master_token = exchanged

    try:
        import gkeepapi
        test_keep = gkeepapi.Keep()
        logger.info(f"Connecting to Google Keep for {email}...")
        test_keep.resume(email, master_token)
        test_keep.sync()
        count = len(list(test_keep.all()))

        keep_manager.keep = test_keep
        keep_manager.is_authenticated = True
        keep_manager.is_demo_mode = False
        keep_manager.auth_error = None
        keep_manager._save_token(master_token)
        keep_manager.sync()

        return {
            "success": True,
            "master_token": master_token,
            "notes_count": count,
            "message": f"Successfully connected to Keep! Found {count} notes.",
        }
    except Exception as e:
        logger.error(f"Keep setup failed: {e}")
        raise HTTPException(status_code=400, detail=f"Google Keep authentication error: {e}")

# フロントエンド静的ファイル (dist) の配信設定
dist_candidates = [
    os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "dist")),
    os.path.abspath(os.path.join(os.path.dirname(__file__), "dist")),
]
frontend_dist = next((d for d in dist_candidates if os.path.isdir(d) and os.path.isfile(os.path.join(d, "index.html"))), None)

if frontend_dist:
    logger.info(f"Mounting frontend static files from: {frontend_dist}")
    # ルートへのアクセスで dist/index.html を配信し、assets も配信
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")
else:
    logger.info("Frontend dist directory not found. Serving JSON at /")
    @app.get("/")
    def index():
        return {
            "service": "Google Keep Sync Server for Even Realities G2",
            "status": "running",
            "is_demo_mode": keep_manager.is_demo_mode,
            "is_authenticated": keep_manager.is_authenticated,
            "notes_count": len(keep_manager.cached_notes),
            "last_sync": keep_manager.last_sync_time.isoformat() if keep_manager.last_sync_time else None,
        }

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    host = os.getenv("HOST", "0.0.0.0")
    uvicorn.run(app, host=host, port=port)