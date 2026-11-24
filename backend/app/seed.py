"""Carga datos de ejemplo para que todo el equipo tenga la misma BD.

Uso (desde backend/, con el .venv activado):  python -m app.seed
"""
from sqlmodel import Session, select

from app.database import create_db_and_tables, engine
from app.models import Item

SAMPLE_ITEMS = ["Primer elemento", "Segundo elemento", "Tercer elemento"]


def seed() -> None:
    create_db_and_tables()
    with Session(engine) as session:
        if session.exec(select(Item)).first():
            print("La BD ya tiene datos; no se insertó nada.")
            return
        session.add_all(Item(name=name) for name in SAMPLE_ITEMS)
        session.commit()
        print(f"Insertados {len(SAMPLE_ITEMS)} items de ejemplo.")


if __name__ == "__main__":
    seed()
