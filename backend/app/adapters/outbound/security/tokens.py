"""Hash de contraseñas (scrypt) y tokens JWT HS256, solo con la biblioteca estándar."""

import base64
import hashlib
import hmac
import json
import secrets
import time
from typing import Any

from app.domain.errors import AuthenticationError

_N, _R, _P = 2**14, 8, 1


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P)
    return f"scrypt${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, salt_hex, digest_hex = stored.split("$")
        if scheme != "scrypt":
            return False
        digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt_hex), n=_N, r=_R, p=_P)
        return hmac.compare_digest(digest, bytes.fromhex(digest_hex))
    except ValueError:
        return False


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


class JwtCodec:
    def __init__(self, secret: str, expire_s: int) -> None:
        self._key = secret.encode()
        self.expire_s = expire_s

    def _sign(self, signing_input: str) -> str:
        return _b64(hmac.new(self._key, signing_input.encode(), hashlib.sha256).digest())

    def encode(self, claims: dict[str, Any], now: float | None = None) -> str:
        iat = int(now if now is not None else time.time())
        body = {**claims, "iat": iat, "exp": iat + self.expire_s}
        head = _b64(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
        payload = _b64(json.dumps(body, separators=(",", ":")).encode())
        return f"{head}.{payload}.{self._sign(f'{head}.{payload}')}"

    def decode(self, token: str, now: float | None = None) -> dict[str, Any]:
        invalid = AuthenticationError("Sesión inválida o expirada")
        try:
            head, payload, signature = token.split(".")
            if not hmac.compare_digest(signature, self._sign(f"{head}.{payload}")):
                raise invalid
            if json.loads(_unb64(head)).get("alg") != "HS256":
                raise invalid
            claims = json.loads(_unb64(payload))
        except (ValueError, json.JSONDecodeError) as exc:
            raise invalid from exc
        if claims.get("exp", 0) <= (now if now is not None else time.time()):
            raise invalid
        return claims
