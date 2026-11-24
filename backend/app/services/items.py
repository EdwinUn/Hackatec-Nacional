from sqlmodel import Session, select

from app.models import Item, ItemCreate


def list_items(session: Session) -> list[Item]:
    return list(session.exec(select(Item).order_by(Item.id)).all())


def create_item(session: Session, data: ItemCreate) -> Item:
    item = Item.model_validate(data)
    session.add(item)
    session.commit()
    session.refresh(item)
    return item
