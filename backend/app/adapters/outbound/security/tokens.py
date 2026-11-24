from datetime import timedelta
from uuid import UUID

import jwt

from app.domain.entities import utcnow
from app.domain.errors import UnauthorizedError

ALGORITHM = "HS256"


class JwtTokenService:
    """JWT HS256 con claims `sub` (id del usuario), `role` y `exp`."""

    def __init__(self, secret: str, expires: timedelta) -> None:
        self._secret = secret
        self._expires = expires

    def issue(self, user_id: UUID, role: str) -> tuple[str, int]:
        now = utcnow()
        claims = {"sub": str(user_id), "role": role, "iat": now, "exp": now + self._expires}
        return jwt.encode(claims, self._secret, algorithm=ALGORITHM), int(self._expires.total_seconds())

    def subject(self, token: str) -> UUID:
        try:
            claims = jwt.decode(
                token, self._secret, algorithms=[ALGORITHM], options={"require": ["sub", "exp"]}
            )
            return UUID(claims["sub"])
        except jwt.ExpiredSignatureError as exc:
            raise UnauthorizedError("Tu sesión venció; vuelve a iniciar sesión") from exc
        except (jwt.InvalidTokenError, ValueError) as exc:
            raise UnauthorizedError("Sesión no válida; vuelve a iniciar sesión") from exc
