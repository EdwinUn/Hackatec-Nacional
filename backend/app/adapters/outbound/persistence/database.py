from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine


def make_engine(url: str, echo: bool = False) -> AsyncEngine:
    return create_async_engine(url, echo=echo, pool_pre_ping=True, pool_size=10, max_overflow=10)


def make_session_factory(engine: AsyncEngine) -> async_sessionmaker:
    return async_sessionmaker(engine, expire_on_commit=False)


async def ping(engine: AsyncEngine) -> None:
    async with engine.connect() as conn:
        await conn.execute(text("SELECT 1"))
