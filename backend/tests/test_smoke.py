from fastapi.testclient import TestClient

from app.main import app

# Sin el bloque `with`, el lifespan no corre: esta prueba no necesita Postgres.
client = TestClient(app)


def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
