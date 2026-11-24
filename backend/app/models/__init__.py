# Importa aquí cada modelo nuevo para que se cree su tabla al arrancar.
from app.models.item import Item, ItemCreate, ItemRead

__all__ = ["Item", "ItemCreate", "ItemRead"]
