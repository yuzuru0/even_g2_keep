#!/usr/bin/env python3
"""
Google Keep マスタートークン設定スクリプト
ブラウザの accounts.google.com/EmbeddedSetup から取得した oauth_token を
永続的な master_token に変換して保存します。
"""

import os
import sys
import json
import gpsoauth

def main():
    print("=" * 65)
    print("  Google Keep マスタートークン登録ツール")
    print("=" * 65)
    print()
    print("Googleの最近の仕様変更により、パスワードによる直接認証が廃止されました。")
    print("以下の手順でブラウザから発行されたトークンを登録します。")
    print("-" * 65)
    print("【取得手順】")
    print("1. Google Chrome (または Edge) で F12 キーを押して「開発者ツール」を開きます。")
    print("2. 「アプリケーション (Application)」タブ > 「Cookie」を開きます。")
    print("3. 次の URL を開いてログインしてください:")
    print("   https://accounts.google.com/EmbeddedSetup")
    print("   (※ ログイン後に画面が白く停止するのは正常な動作です。完了画面は出ません)")
    print("4. ログイン後、Cookie 一覧にある 'oauth_token' の値をコピーします。")
    print("   (値は 'oauth2_4/...' から始まる文字列です)")
    print("-" * 65)
    print()

    email = input("Google メールアドレス: ").strip()
    if not email:
        print("メールアドレスを入力してください。")
        return

    raw_token = input("oauth_token (または master_token): ").strip()
    if not raw_token:
        print("トークンを入力してください。")
        return

    # すでに master_token (aas_et/ または oauth2_4/) の場合
    master_token = None

    print()
    print("[1/2] トークンを Google サーバーと検証・変換中...")

    # exchange_token を試みる
    try:
        android_id = "0123456789abcdef"
        res = gpsoauth.exchange_token(email, raw_token, android_id)
        if "Token" in res:
            master_token = res["Token"]
            print("[2/2] マスタートークンの取得に成功しました！")
        else:
            # raw_token 自体が master_token の可能性を検証
            print(f"[Notice] exchange_token の応答: {res.get('Error', 'unknown')}")
            print("入力されたトークンを直接テストします...")
            master_token = raw_token
    except Exception as e:
        print(f"[Notice] exchange_token 例外: {e}。直接トークンとして扱います。")
        master_token = raw_token

    # gkeepapi での動作確認テスト
    try:
        import gkeepapi
        keep = gkeepapi.Keep()
        keep.resume(email, master_token)
        print("Google Keep に接続テスト中...")
        keep.sync()
        count = len(list(keep.all()))
        print(f"★ 接続成功！ Keep 内に {count} 件のメモを確認しました。")

        backend_dir = os.path.dirname(__file__)
        env_path = os.path.join(backend_dir, ".env")
        token_path = os.path.join(backend_dir, "token.json")

        with open(env_path, "w", encoding="utf-8") as f:
            f.write(f"# Google Keep 認証設定\n")
            f.write(f"GOOGLE_EMAIL={email}\n")
            f.write(f"GOOGLE_MASTER_TOKEN={master_token}\n\n")
            f.write(f"PORT=8000\n")
            f.write(f"HOST=0.0.0.0\n")

        with open(token_path, "w", encoding="utf-8") as f:
            json.dump({"master_token": master_token}, f, indent=2)

        print()
        print("★ 設定が正常に保存されました！")
        print(f"マスタートークン: {master_token}")
        print()
        print("【Render.com をご利用の場合】")
        print("Render ダッシュボードの「Environment」で上記マスタートークンを設定してください:")
        print(f"GOOGLE_MASTER_TOKEN={master_token}")
        print()
        print("【ローカルでサーバーを起動する場合】")
        print("python backend/run_server.py")

    except Exception as e:
        print(f"[Error] Keep への接続テストに失敗しました: {e}")
        print("oauth_token が正しくコピーされているか、有効期限が切れていないかご確認ください。")

if __name__ == "__main__":
    main()
