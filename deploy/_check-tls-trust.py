import ssl
import socket


def check(host: str) -> None:
    ctx = ssl.create_default_context()
    try:
        with socket.create_connection((host, 443), timeout=15) as sock:
            with ctx.wrap_socket(sock, server_hostname=host) as ssock:
                cert = ssock.getpeercert()
                print(host, "OK", ssock.version())
                print("  subject", cert.get("subject"))
                print("  issuer", cert.get("issuer"))
                print("  SAN", cert.get("subjectAltName"))
    except Exception as exc:
        print(host, "FAIL", type(exc).__name__, exc)


for h in (
    "6a69f224e6032a3f00de977f.hermes.aimarkets.vn",
    "6a69f224e6032a3f00de977f.openclaw.aimarkets.vn",
    "6a69f224e6032a3f00de977f.nanoclaw.aimarkets.vn",
    "nanoclaw.aimarkets.vn",
):
    check(h)
