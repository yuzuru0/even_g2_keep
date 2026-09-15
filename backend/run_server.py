import os
import sys
import subprocess

def main():
    print("==================================================")
    print("  Google Keep Sync Server for Even Realities G2   ")
    print("==================================================")

    # 仮想環境や依存パッケージの確認
    try:
        import fastapi
        import uvicorn
    except ImportError:
        print("[Notice] Required packages not found. Installing requirements...")
        req_file = os.path.join(os.path.dirname(__file__), "requirements.txt")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "-r", req_file])

    import uvicorn
    from server import app

    port = int(os.getenv("PORT", 8000))
    host = os.getenv("HOST", "0.0.0.0")

    print(f"\n[Server] Starting API on http://localhost:{port} (Listen on all interfaces)")
    print(f"[Server] OpenAPI docs: http://localhost:{port}/docs")
    print("[Server] Press Ctrl+C to stop.\n")
    uvicorn.run(app, host=host, port=port)

if __name__ == "__main__":
    main()