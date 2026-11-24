import re
import uuid
from pathlib import Path

_REF = re.compile(r"^media/([0-9a-f]{32}\.(?:jpg|png))$")


class LocalMediaStorage:
    """Fotos en disco (o volumen Docker), servidas por la API en /media."""

    def __init__(self, directory: str) -> None:
        self.root = Path(directory)
        self.root.mkdir(parents=True, exist_ok=True)

    def save(self, content: bytes, extension: str) -> str:
        name = f"{uuid.uuid4().hex}.{extension}"
        (self.root / name).write_bytes(content)
        return f"media/{name}"

    def exists(self, ref: str) -> bool:
        m = _REF.match(ref)
        return bool(m) and (self.root / m.group(1)).is_file()
