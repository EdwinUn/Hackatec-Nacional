from fastapi import APIRouter, Depends, status
from sqlmodel import Session

from app.database import get_session
from app.models import ItemCreate, ItemRead
from app.services import items as items_service

router = APIRouter(prefix="/items", tags=["items"])


@router.get("", response_model=list[ItemRead])
def list_items(session: Session = Depends(get_session)):
    return items_service.list_items(session)


@router.post("", response_model=ItemRead, status_code=status.HTTP_201_CREATED)
def create_item(data: ItemCreate, session: Session = Depends(get_session)):
    return items_service.create_item(session, data)
