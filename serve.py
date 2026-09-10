"""
Petit serveur local pour tester l'app depuis l'iPhone.

Lancer :  python serve.py
Puis ouvrir, sur l'iPhone connecte au MEME Wi-Fi, l'adresse affichee.
"""
import http.server
import socket
import socketserver
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".webmanifest": "application/manifest+json",
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".txt": "text/plain; charset=utf-8",
        ".html": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        # Pas de cache : on veut toujours la derniere version pendant les tests.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stdout.write("  %s\n" % (fmt % args))


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    ip = lan_ip()
    print()
    print("  Boggle Solveur")
    print("  " + "-" * 46)
    print("  Sur cet ordinateur : http://localhost:%d" % PORT)
    print("  Sur l'iPhone       : http://%s:%d" % (ip, PORT))
    print("  " + "-" * 46)
    print("  (meme Wi-Fi requis. Ctrl+C pour arreter.)")
    print()
    with Server(("0.0.0.0", PORT), Handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n  Serveur arrete.")
