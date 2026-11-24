from fastapi import APIRouter, Request

from app.adapters.inbound.http.deps import ContainerDep, CurrentUser
from app.adapters.inbound.http.schemas_ops import LoginIn, LoginOut, UserOut

router = APIRouter(tags=["operaciones · personal"])


@router.post("/auth/login", response_model=LoginOut, summary="Iniciar sesión (personal)")
async def login(body: LoginIn, request: Request, c: ContainerDep):
    r = await c.staff.login(
        body.email, body.password, request.client.host if request.client else "desconocida"
    )
    return LoginOut(access_token=r.token, expires_in=r.expires_in, user=UserOut.of(r.user))


@router.get("/auth/me", response_model=UserOut, summary="Usuario de la sesión actual")
async def me(user: CurrentUser):
    return UserOut.of(user)
