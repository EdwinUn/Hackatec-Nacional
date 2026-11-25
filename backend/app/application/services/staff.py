"""Personal: inicio de sesión y administración de usuarios (solo admin)."""

import asyncio
import secrets
from dataclasses import dataclass, replace
from typing import Any
from uuid import UUID

from app.application.ports import PasswordHasher, RateLimiter, TokenService, UnitOfWorkFactory
from app.domain.errors import (
    ConflictError,
    ForbiddenError,
    InactiveAccountError,
    InvalidCredentialsError,
    InvalidDataError,
    NotFoundError,
    RateLimitedError,
    UnauthorizedError,
)
from app.domain.operations import MANAGERS, Role, User

MIN_PASSWORD = 6  # criterio de prototipo


@dataclass(frozen=True, slots=True)
class LoginResult:
    token: str
    expires_in: int
    user: User


def require_role(actor: User, *roles: Role) -> None:
    if actor.role not in roles:
        raise ForbiddenError("Tu rol no permite esta acción")


@dataclass(frozen=True, slots=True)
class LoginPolicy:
    attempts: int = 10
    window_s: int = 600


class StaffService:
    def __init__(
        self,
        uow_factory: UnitOfWorkFactory,
        hasher: PasswordHasher,
        tokens: TokenService,
        limiter: RateLimiter,
        policy: LoginPolicy = LoginPolicy(),
    ) -> None:
        self._uow_factory = uow_factory
        self._hasher = hasher
        self._tokens = tokens
        self._limiter = limiter
        self._policy = policy
        # Hash de una contraseña que nadie usa: con un correo inexistente se verifica contra él,
        # para que el tiempo de respuesta no revele qué correos existen.
        self._dummy_hash = hasher.hash(secrets.token_urlsafe(16))

    async def login(self, email: str, password: str, client_ip: str) -> LoginResult:
        email = email.strip().lower()
        p = self._policy
        # Solo cuentan los intentos FALLIDOS (frena la fuerza bruta sin bloquear a quien entra y sale).
        keys = (f"login-ip:{client_ip}", f"login-email:{email}")
        for key in keys:
            if await self._limiter.blocked(key, p.attempts, p.window_s):
                raise RateLimitedError(
                    f"Demasiados intentos fallidos de inicio de sesión; espera {p.window_s // 60} minutos"
                )
        async with self._uow_factory() as uow:
            user = await uow.users.get_by_email(email)
        # argon2 es costoso a propósito: fuera del event loop para no frenar al resto de la API.
        valid = await asyncio.to_thread(
            self._hasher.verify, user.password_hash if user else self._dummy_hash, password
        )
        # Mismo error si el correo no existe o la contraseña no coincide (no revelar cuál falló).
        if user is None or not valid:
            for key in keys:
                await self._limiter.record(key, p.window_s)
            raise InvalidCredentialsError("Correo o contraseña incorrectos")
        if not user.active:
            raise InactiveAccountError("Tu cuenta está desactivada; pide ayuda a un administrador")
        token, expires_in = self._tokens.issue(user.id, user.role.value)
        return LoginResult(token, expires_in, user)

    async def authenticate(self, token: str) -> User:
        """Usuario activo dueño del token. Un usuario desactivado deja de poder usar su token."""
        user_id = self._tokens.subject(token)
        async with self._uow_factory() as uow:
            user = await uow.users.get(user_id)
        if user is None or not user.active:
            raise UnauthorizedError("Tu sesión ya no es válida; vuelve a iniciar sesión")
        return user

    async def list_users(self, actor: User) -> list[User]:
        """Supervisores también: necesitan ver a los técnicos para asignarles órdenes y tareas."""
        require_role(actor, *MANAGERS)
        async with self._uow_factory() as uow:
            return await uow.users.list()

    async def create_user(self, actor: User, data: dict[str, Any]) -> User:
        require_role(actor, Role.ADMIN)
        return await self._create(data)

    async def _create(self, data: dict[str, Any]) -> User:
        password = data.pop("password")
        if len(password) < MIN_PASSWORD:
            raise InvalidDataError(f"La contraseña debe tener al menos {MIN_PASSWORD} caracteres")
        user = User(**data, password_hash=await asyncio.to_thread(self._hasher.hash, password))
        async with self._uow_factory() as uow:
            if await uow.users.get_by_email(user.email):
                raise ConflictError(f"Ya existe una cuenta con el correo {user.email}")
            await uow.users.add(user)
            await uow.commit()
        return user

    async def update_user(self, actor: User, user_id: UUID, changes: dict[str, Any]) -> User:
        require_role(actor, Role.ADMIN)
        if user_id == actor.id and (
            changes.get("active") is False or changes.get("role", Role.ADMIN) != Role.ADMIN
        ):
            raise ConflictError("No puedes desactivarte ni quitarte el rol de administrador a ti mismo")
        async with self._uow_factory() as uow:
            current = await uow.users.get(user_id)
            if current is None:
                raise NotFoundError("Usuario no encontrado")
            user = replace(current, **changes)
            user.touch()
            await uow.users.save(user)
            await uow.commit()
        return user

    async def ensure_demo_users(self, accounts: list[dict[str, Any]]) -> int:
        """Crea las cuentas demo que falten (solo se llama en ENVIRONMENT de desarrollo)."""
        created = 0
        for account in accounts:
            async with self._uow_factory() as uow:
                exists = await uow.users.get_by_email(account["email"])
            if not exists:
                await self._create(dict(account))
                created += 1
        return created
