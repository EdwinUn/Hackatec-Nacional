"""Validación de fotos recibidas como data URL (JPEG/PNG comprimido por el front)."""

import base64
import binascii
import re

from app.domain.errors import InvalidDataError

_DATA_URL = re.compile(r"^data:image/(jpeg|jpg|png);base64,(.+)$", re.DOTALL)


def decode_photo(data_url: str, max_kb: int) -> tuple[bytes, str]:
    """Devuelve (bytes, extensión). Rechaza lo que no sea JPEG/PNG o pese más de `max_kb`."""
    m = _DATA_URL.match(data_url.strip())
    if not m:
        raise InvalidDataError("La foto debe enviarse como data:image/jpeg;base64,… (o png)")
    try:
        content = base64.b64decode(m.group(2), validate=True)
    except (binascii.Error, ValueError) as exc:
        raise InvalidDataError("La foto no es un base64 válido") from exc
    if len(content) > max_kb * 1024:
        raise InvalidDataError(f"La foto pesa {len(content) // 1024} KB; el máximo es {max_kb} KB")
    ext = "png" if m.group(1) == "png" else "jpg"
    signature = b"\x89PNG" if ext == "png" else b"\xff\xd8"
    if not content.startswith(signature):
        raise InvalidDataError("El contenido de la foto no corresponde a una imagen JPEG o PNG")
    return content, ext
