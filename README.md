# Keep for Even Realities G2

[![Even Realities](https://img.shields.io/badge/Even%20Realities-G2%20Compatible-00ff88?style=flat-square)](https://www.evenrealities.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.110+-009688?style=flat-square&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=flat-square&logo=docker&logoColor=white)](Dockerfile)

[English](#english) | [日本語](#-日本語ガイド-japanese)

---

# English

## 📖 About This Repository

This repository provides everything you need to view and manage **Google Keep** notes and checklists directly on **Even Realities G2** smart glasses:

1. **G2 Client App (Frontend)**: The application running on your smart glasses / smartphone (`.ehpk` package).
2. **Keep Sync Relay Server (Backend)**: The intermediary server software that bridges Google Keep and your G2 smart glasses.

### Why is a Relay Server Required?
Google does **not** provide an official public API for Google Keep for third-party consumer devices. In order to safely authenticate, synchronize data in real-time, and format text for the G2's transparent micro-LED optical display, a dedicated **relay server** is essential to mediate communication between Google Keep and the glasses.

---

## 🏗️ System Architecture

```text
Even Realities G2 (Smart Glasses)
       │  Bluetooth (BLE) - Gestures & Heads-Up Display
       ▼
Smartphone (Even App)
  [Keep for G2 Client App] ── Installed from Even Hub or .ehpk
       │  HTTPS - Encrypted API with your private secret key
       ▼
Personal Relay Server (Render.com / Self-hosted Docker)
       │  Google Mobile Protocol (gkeepapi)
       ▼
Google Keep Cloud (Your Notes & ToDo Checklists)
```

---

## 👓 1. G2 Client App Installation

You can install the G2 app in either of the following ways:

* **Option A: Install from Even Hub Store (Easiest & Recommended)**  
  Open the **Even App** on your smartphone, navigate to the **Even Hub** app store, and install **"Keep for G2"** with one tap.
* **Option B: Manual Sideload via `.ehpk` File**  
  Download the pre-built [`even-g2-keep.ehpk`](./even-g2-keep.ehpk) file included in this repository, and upload/install it via the [Even Realities Developer Portal](https://developer.evenrealities.com/) or the Even App's Developer Options.

---

## 🚀 2. Relay Server Deployment

You can host your private relay server on **Render.com** (recommended) or on your **own server**:

### Option A: Deploy on Render.com (Recommended / Quick & Free)
Render.com provides a free, cloud-hosted environment with an automatic HTTPS domain:

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/yuzuru0/even_g2_keep)

* **Zero Cost**: Render's free tier provides 750 free instance hours per month. Running this single web service runs 24/7 (744 hours in a 31-day month), **completely within the free tier with zero charges**.
* **1-Click Setup**: Click the button above, enter your environment variables, and your server is live in minutes.

### Option B: Self-Host on Your Own Server (Docker / VPS / Home Server / Raspberry Pi)
You can easily self-host using the included Docker configurations:

```bash
# 1. Clone this repository
git clone https://github.com/yuzuru0/even_g2_keep.git
cd even_g2_keep

# 2. Edit environment variables in docker-compose.yml
# (Configure GOOGLE_EMAIL, GOOGLE_MASTER_TOKEN, and APP_SECRET)

# 3. Start the server
docker compose up -d
```
> [!NOTE]
> The Even App requires an **HTTPS** connection. When self-hosting on a home server or VPS, expose your server securely with **Cloudflare Tunnel** (free, no port forwarding needed) or a reverse proxy like **Nginx / Caddy** with Let's Encrypt.

---

## ⚙️ 3. Configuration Guide

Setup consists of three simple steps:

### Step 1: Obtain Google Master Token

Google requires an authorization token to connect to Google Keep. You can obtain it easily through your browser using any of the following methods:

#### 1. How to copy `oauth_token` from Google Chrome (1 minute):
1. In Google Chrome (or Edge) on your PC, press `F12` (or right-click -> **Inspect**) to open Developer Tools.
2. Go to the **Application** tab > **Cookies** > `https://accounts.google.com`.
3. Open [https://accounts.google.com/EmbeddedSetup](https://accounts.google.com/EmbeddedSetup) in that tab and sign in.  
   *(Note: The page hanging, showing a blank/white screen, or stopping after login is **completely normal and expected behavior** because this is an internal Android setup endpoint. Do not wait for the webpage to redirect.)*
4. In the cookies list in Developer Tools, find and copy the value of **`oauth_token`** (starts with `oauth2_4/...`).

#### 2. Choose your preferred zero-install method:
* **Option A: Direct Auto-Exchange on Render (Simplest / Recommended)**  
  When deploying to Render.com, simply paste the copied `oauth_token` (`oauth2_4/...`) directly into the `GOOGLE_MASTER_TOKEN` environment variable! The server will automatically convert it into a permanent master token upon its first startup.
* **Option B: Web Setup Wizard on your deployed server**  
  Deploy to Render with `GOOGLE_MASTER_TOKEN` left empty. Once the server is running, open `https://<your-render-url>/setup` in your browser, enter your email and `oauth_token`, and click **Connect**. The server will connect to Keep immediately and display your permanent master token to copy into Render.
* **Option C: 1-Click Google Colab Notebook**  
  [![Open In Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/yuzuru0/even_g2_keep/blob/main/tools/get_master_token.ipynb)  
  Click the badge above to open our official Colab notebook in your browser, click **Run**, and copy the generated token.
* **Option D: Local Terminal (For Developers)**  
  If you have Python installed locally, you can run:
  ```bash
  pip install -r backend/requirements.txt
  python backend/setup_master_token.py
  ```

### Step 2: Configure the Relay Server Environment Variables

To allow the relay server to safely connect to Google Keep and protect your personal notes, configure the following **three environment variables**.

#### 1. Environment Variables Overview

| Variable Name | Required | Description | Example |
| :--- | :---: | :--- | :--- |
| `GOOGLE_EMAIL` | **Required** | Your Google account email used for Google Keep | `yourname@gmail.com` |
| `GOOGLE_MASTER_TOKEN` | **Required** | The auth token obtained in Step 1<br>*(Accepts either raw `oauth2_4/...` or converted `aas_et/...`)* | `oauth2_4/...` or `aas_et/...` |
| `APP_SECRET` | **Recommended** | A custom secret password of your choice to protect your server from unauthorized public access. | `my-secret-pass-123` |

> [!TIP]
> **Why is `APP_SECRET` important?**  
> Since cloud servers like Render.com are publicly reachable on the internet, setting an `APP_SECRET` prevents anyone from reading your personal Keep notes. Only clients (your Even G2 app) that present this exact secret key can access the API.

#### 2-A. Setting Environment Variables on Render.com

You can set these variables either during the initial deploy wizard or anytime from the dashboard:

* **During Initial Deployment (Easiest)**:  
  When you click the **"Deploy to Render"** button, Render presents an input form with fields for `GOOGLE_EMAIL`, `GOOGLE_MASTER_TOKEN`, and `APP_SECRET`. Fill in the values and click **Apply** / **Create Web Service**.
* **Editing Afterward via Dashboard**:  
  1. Open your [Render Dashboard](https://dashboard.render.com/) and click your `even-g2-keep` service.
  2. In the left navigation menu, click **Environment**.
  3. Enter or edit the values for each variable.
  4. Click the **Save Changes** button at the bottom. The server will automatically restart and apply the new settings.
  5. In the left menu, click **Logs** to verify that you see `Master token authentication successful!` or `Syncing with Google Keep server...`.

#### 2-B. Setting Environment Variables in Self-Hosted Docker

If you are running the server on your own server or home PC using `docker-compose.yml`:

1. Open `docker-compose.yml` in a text editor and edit the `environment:` section:
   ```yaml
   environment:
     - GOOGLE_EMAIL=yourname@gmail.com
     - GOOGLE_MASTER_TOKEN=aas_et/...
     - APP_SECRET=my-secret-pass-123
     - PORT=8000
   ```
2. Save the file and start or restart the container:
   ```bash
   docker compose up -d
   ```

### Step 3: Configure the G2 App (in Even App)
1. Open **Keep for G2** inside the Even App on your phone.
2. Tap the **⚙ (Settings)** icon in the upper-right corner.
3. Configure your server connection:
   * **Keep Sync Server URL**: Enter your server address (e.g. `https://even-g2-keep.onrender.com`)
   * **🔐 Access Key / API Key**: Enter the `APP_SECRET` password configured in Step 2 (e.g. `my-secret-pass-123`)
   *(Optional Tip: You can also specify it directly inside the URL as `https://<your-server-url>/s/<YOUR_APP_SECRET>`)*
4. Tap **Save Settings**. Your notes will sync immediately!

---

## 🎮 G2 Touch Gestures & Exiting the App

### 1. In-App Touch Gestures
| Gesture | Action |
| :--- | :--- |
| **Single Tap** | Open note detail / Toggle checklist item (checked / unchecked) |
| **Swipe Down / Up** | Scroll page down / up (or select next / previous note) |
| **Double Tap** | Return to note list / Force instant sync with Google Keep |
| **Long Press** | Toggle Archive filter / Return to list view |

### 2. How to Exit the App (On G2 Smart Glasses)
1. **Tap once, then long-press** on the temple touchpad.
2. The Even OS system menu will appear on your display.
3. Select **"Close"** (閉じる) to exit the app and return to the home watch face.

---
---

# 🇯🇵 日本語ガイド (Japanese)

## 📖 本リポジトリについて

本リポジトリは、**Even Realities G2** スマートグラス上で **Google Keep** のメモやToDoリストを閲覧・操作するためのシステム一式を提供します：

1. **G2向けアプリ（フロントエンド）**: スマートグラスおよびスマホの Even App 上で動作するクライアントアプリ（`.ehpk` パッケージ）。
2. **Keep中継サーバー（バックエンド）**: Google Keep と G2アプリの通信を安全に仲介するサーバーソフトウェア。

### なぜ中継サーバーが必要なのか？
Google は一般開発者向けに Google Keep の公式公開 API を提供していません。そのため、Google の認証プロトコルを安全に中継し、スマートグラスの限られた画面や通信環境向けにデータを整形・高速配信するための**「専用中継サーバー」**が必要となります。

---

## 🏗️ 全体アーキテクチャ

```text
Even Realities G2 (スマートグラス)
       │  Bluetooth (BLE) - タッチ操作 & 透過ディスプレイ描画
       ▼
スマートフォン (Even App)
  [Keep for G2 クライアント] ── Even Hub または .ehpk から導入
       │  HTTPS - 合言葉（シークレットキー）で保護された通信
       ▼
個人用中継サーバー (Render.com または 自前サーバー)
       │  Google 内部プロトコル (gkeepapi)
       ▼
Google Keep クラウド (あなたのメモ・ToDo)
```

---

## 👓 1. G2向けアプリの導入方法

G2向けアプリは、以下のどちらの方法でも自由に導入できます：

* **方法 A: Even Hub ストアからインストール（最も手軽・推奨）**  
  スマホの **Even App** を開き、公式ストア **「Even Hub」** から「Keep for G2」をワンタップで直接インストールできます。
* **方法 B: 本リポジトリの `.ehpk` ファイルから手動インストール**  
  本リポジトリに含まれる [`even-g2-keep.ehpk`](./even-g2-keep.ehpk) をダウンロードし、[Even Realities Developer Portal](https://developer.evenrealities.com/) または Even App の開発者オプション（Developer Options）から手動でインストール（サイドロード）することも可能です。

---

## 🚀 2. 中継サーバーの導入方法

中継サーバーは **Render.com** または **ご自身のサーバー** のお好きな方に導入できます：

### パターン A: Render.com での導入（推奨・簡単・無料）
Render.com を利用すれば、無料かつ数分で自動 HTTPS 付きのサーバーが立ち上がります：

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/yuzuru0/even_g2_keep)

* **単一アプリなら完全無料**: Render の無料枠では毎月 750 時間の無料インスタンス枠が提供されます。本中継サーバー 1 つだけであれば、24時間365日常時稼働（31日で744時間）させても**無料枠の範囲内にピッタリ収まり、料金は一切発生しません**。
* **ワンクリック導入**: 上のボタンをクリックして環境変数を入力するだけで自動ビルド・デプロイされます。

### パターン B: 自前サーバーでの導入（Docker / 自宅PC / Raspberry Pi / VPS / NAS）
同梱の Docker 設定を使って、お手持ちの環境で自前運用できます：

```bash
# 1. リポジトリをクローン
git clone https://github.com/yuzuru0/even_g2_keep.git
cd even_g2_keep

# 2. docker-compose.yml の環境変数を編集
# (GOOGLE_EMAIL, GOOGLE_MASTER_TOKEN, APP_SECRET を設定)

# 3. コンテナを起動
docker compose up -d
```
> [!NOTE]
> Even App との通信には **HTTPS 接続が必須** です。自宅サーバーや VPS で運用する場合は、無料の **Cloudflare Tunnel**（ポート開放不要）や Nginx / Caddy 等で HTTPS 化してください。

---

## ⚙️ 3. 設定方法

設定は以下の 3 ステップで完了します：

### ステップ 1: Google マスタートークンの取得

Google Keep と連携するための認証トークンを取得します。ブラウザだけで完結する以下の方法からお好きなものを選択できます：

#### 1. Google Chrome から `oauth_token` をコピーする（所要時間：1分）
1. PCの Google Chrome（または Edge）で `F12` キー（または右クリック「検証」）を押し、開発者ツールを開きます。
2. **「アプリケーション (Application)」**タブ > **「Cookie」** > `https://accounts.google.com` を選択します。
3. 以下のリンクを開き、Googleアカウントでログインします：  
   👉 [https://accounts.google.com/EmbeddedSetup](https://accounts.google.com/EmbeddedSetup)  
   *(※ ログイン後に画面が真っ白のまま停止したり、読み込み中のまま応答が返ってこないのは**正常な仕様**です。Android端末専用のエンドポイントのため完了画面へは遷移しません。画面の応答を待つ必要はありません)*
4. 開いている開発者ツールの Cookie 一覧から **`oauth_token`** の値（`oauth2_4/...` から始まる文字列）をダブルクリックしてコピーします。

#### 2. お好みの導入方法を選択：
* **方法 A: Render デプロイ時にそのまま貼り付け（最も簡単・推奨）**  
  Render.com のデプロイ画面で、環境変数 `GOOGLE_MASTER_TOKEN` にコピーした `oauth_token`（`oauth2_4/...`）をそのまま貼り付けてください。サーバー初回起動時に**自動で永続マスタートークンへ変換**されます。
* **方法 B: サーバー導入後の Web 設定ウィザードを使う**  
  Render の初回デプロイ時は `GOOGLE_MASTER_TOKEN` を空欄のまま作成します。起動後、ブラウザで `https://<あなたのRenderサーバーURL>/setup` を開いてメールアドレスとトークンを入力し「接続テスト」を押すだけで完了します（画面上で永続トークンも確認・コピー可能）。
* **方法 C: 1クリック Google Colab ノートブックを使う**  
  [![Open In Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/yuzuru0/even_g2_keep/blob/main/tools/get_master_token.ipynb)  
  上の「Open in Colab」ボタンを押すと、Google 提供の無料クラウド実行環境がブラウザで開きます。再生（▶）ボタンを押してトークンを入力するだけでマスタートークンが生成されます。
* **方法 D: ローカルのターミナルで実行する（開発者向け）**  
  お手元のPCにPython環境がある場合は、以下のコマンドで対話型ツールを実行できます：
  ```bash
  pip install -r backend/requirements.txt
  python backend/setup_master_token.py
  ```

### ステップ 2: 中継サーバー側の環境変数設定

中継サーバー（Render.com または自前サーバー）が Google Keep と安全に通信するため、以下の **3つの環境変数（Environment Variables）** を設定します。

#### 1. 設定する環境変数一覧

| 環境変数名 | 必須 | 説明 | 設定例 |
| :--- | :---: | :--- | :--- |
| `GOOGLE_EMAIL` | **必須** | Keep で利用している Google メールアドレス | `yourname@gmail.com` |
| `GOOGLE_MASTER_TOKEN` | **必須** | ステップ 1 で取得した認証トークン<br>*(※ 生の `oauth2_4/...` または変換後の `aas_et/...` のどちらを貼り付けても動作します)* | `oauth2_4/...` または `aas_et/...` |
| `APP_SECRET` | **推奨** | サーバーを第三者の不正アクセスから保護する合言葉（任意の英数字）。Evenアプリ側の設定と一致させます。 | `my-secret-pass-123` |

> [!TIP]
> **なぜ `APP_SECRET` が必要なのか？**  
> Render.com で作成したサーバーはインターネット上に公開されます。この合言葉（パスワード）を設定しないと、URLを知っている第三者にあなたのメモが閲覧されてしまう可能性があります。任意のパスワード文字列をここで決めて設定し、後ほどスマホの Even アプリ側にも同じ文字列を入力します。

#### 2-A. Render.com での環境変数設定手順

Render.com では、**デプロイ時のフォーム** または **デプロイ完了後の管理画面** から設定できます。

* **初回デプロイ画面で設定する場合（推奨・最も簡単）**:  
  「Deploy to Render」ボタンを押すと、入力フォームに `GOOGLE_EMAIL`、`GOOGLE_MASTER_TOKEN`、`APP_SECRET` の入力欄が自動表示されます。それぞれ上記の値を入力して「Apply」または「Create Web Service」をクリックするだけで完了です。
* **後から設定・変更する場合**:  
  1. [Render ダッシュボード](https://dashboard.render.com/) を開き、作成したサービス（`even-g2-keep`）をクリックします。
  2. 左側メニューの **「Environment」** をクリックします。
  3. 各項目の「Value」欄に値を入力（または編集）します。
  4. 画面下の **「Save Changes」** ボタンをクリックすると、サーバーが自動的に再起動して新しい設定が適用されます。
  5. 左側メニューの **「Logs」** を開き、`Master token authentication successful!` または `Syncing with Google Keep server...` と表示されていれば正常に連携完了です。

#### 2-B. 自前サーバー（Docker Compose）での環境変数設定手順

自前の PC や VPS で `docker-compose.yml` を使用して起動する場合：

1. `docker-compose.yml` 内の `environment:` 欄をテキストエディタで編集します：
   ```yaml
   environment:
     - GOOGLE_EMAIL=yourname@gmail.com
     - GOOGLE_MASTER_TOKEN=aas_et/...
     - APP_SECRET=my-secret-pass-123
     - PORT=8000
   ```
2. 設定を保存し、コンテナを起動（または再起動）します：
   ```bash
   docker compose up -d
   ```

### ステップ 3: G2アプリ側の設定（スマホの Even App 内）
1. スマホの **Even App** で「Keep for G2」を開きます。
2. 画面右上の **「⚙ 設定」** アイコンをタップします。
3. サーバーへの接続情報を入力します：
   * **Keep 同期サーバーURL**: あなたのサーバーアドレス（例: `https://even-g2-keep.onrender.com`）
   * **🔐 アクセスキー / API Key**: ステップ 2 で設定した `APP_SECRET`（合言葉）（例: `my-secret-pass-123`）
   *(※ 補足: URL欄に `https://<あなたのサーバーURL>/s/<APP_SECRET>` の形式で直接入力することでも認証可能です)*
4. **「設定を保存」** をタップすれば完了です！最新のメモがグラスに同期されます。

---

## 🎮 G2 タッチ操作・アプリの終了方法

### 1. グラス操作（タッチパッド）
| 操作 | 動作 |
| :--- | :--- |
| **1回タップ (Single Tap)** | メモの詳細を開く / チェックボックスのオン・オフ切替 |
| **スワイプ 上/下 (Swipe)** | ページ送り・スクロール (または次/前のメモを選択) |
| **2回タップ (Double Tap)** | メモ一覧に戻る / Google Keep との即時強制再同期 |
| **長押し (Long Press)** | アーカイブ表示の切替 / メモ詳細から一覧画面に戻る |

### 2. アプリの終了方法（スマートグラスでの操作）
1. テンプルのタッチパッドを **「ワンタップした後、長押し」** します。
2. グラス画面上に Even OS のシステムメニューが表示されます。
3. メニュー内の **「閉じる」** を選択することで、アプリを終了して待受画面（時計）に戻ります。

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
