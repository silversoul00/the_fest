# Test helper: a TLS front for the local Postgres, so the app can be pointed at a "remote-looking" database
# (it requires TLS for any host that isn't localhost). Answers Postgres's SSLRequest, terminates TLS with a
# throwaway self-signed certificate, and forwards plain bytes to the local server. Test use only.
import os, socket, ssl, subprocess, tempfile, threading

SSL_REQUEST = b'\x00\x00\x00\x08\x04\xd2\x16\x2f'

def start(listen_port, target=('127.0.0.1', 5432)):
    d = tempfile.mkdtemp(prefix='pgtls-')
    crt, key = os.path.join(d, 'c.pem'), os.path.join(d, 'k.pem')
    subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=vm',
                    '-keyout', key, '-out', crt], check=True, capture_output=True)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER); ctx.load_cert_chain(crt, key)
    srv = socket.socket(); srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(('127.0.0.1', listen_port)); srv.listen(64)

    def pipe(a, b):
        try:
            while (chunk := a.recv(65536)):
                b.sendall(chunk)
        except OSError:
            pass
        finally:
            for s in (a, b):
                try: s.close()
                except OSError: pass

    def handle(c):
        try:
            first = c.recv(8)
            up = socket.create_connection(target)
            if first == SSL_REQUEST:
                c.sendall(b'S'); c = ctx.wrap_socket(c, server_side=True)
            else:
                up.sendall(first)
            threading.Thread(target=pipe, args=(c, up), daemon=True).start()
            pipe(up, c)
        except OSError:
            pass

    def loop():
        while True:
            try: c, _ = srv.accept()
            except OSError: return
            threading.Thread(target=handle, args=(c,), daemon=True).start()

    threading.Thread(target=loop, daemon=True).start()
    return srv
