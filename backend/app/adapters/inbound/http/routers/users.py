from uuid import UUID

from fastapi import APIRouter, status

from app.adapters.inbound.http.deps import ContainerDep, CurrentUser
from app.adapters.inbound.http.schemas_ops import UserIn, UserOut, UserPatchIn

router = APIRouter(tags=["operaciones · personal"])


@router.get("/users", response_model=list[UserOut], summary="Listar personal (supervisor/admin)")
async def list_users(c: ContainerDep, me: CurrentUser):
    return [UserOut.of(u) for u in await c.staff.list_users(me)]


@router.post(
    "/users", response_model=UserOut, status_code=status.HTTP_201_CREATED, summary="Crear cuenta (admin)"
)
async def create_user(body: UserIn, c: ContainerDep, me: CurrentUser):
    return UserOut.of(await c.staff.create_user(me, body.model_dump()))


@router.patch("/users/{user_id}", response_model=UserOut, summary="Editar o desactivar cuenta (admin)")
async def update_user(user_id: UUID, body: UserPatchIn, c: ContainerDep, me: CurrentUser):
    return UserOut.of(await c.staff.update_user(me, user_id, body.model_dump(exclude_unset=True)))
