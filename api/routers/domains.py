import re
import mysql.connector
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from api.auth import require_permission
from api.config import DB_HOST, DB_USER, DB_PASS, DB_NAME

router = APIRouter()

DOMAIN_RE = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$")


def get_db():
    return mysql.connector.connect(
        host=DB_HOST, user=DB_USER, password=DB_PASS, database=DB_NAME
    )


class DomainCreate(BaseModel):
    name: str


@router.get("/", dependencies=[Depends(require_permission("domains", "view"))])
def list_domains():
    db = get_db()
    cursor = db.cursor()
    cursor.execute(
        "SELECT d.id, d.name, d.active, COUNT(u.id) "
        "FROM domains d LEFT JOIN users u ON u.domain_id = d.id AND u.active = 1 "
        "GROUP BY d.id, d.name, d.active "
        "ORDER BY d.name"
    )
    rows = cursor.fetchall()
    db.close()
    return [
        {"id": id_, "domain": name, "users": count, "status": "active" if active else "inactive"}
        for id_, name, active, count in rows
    ]


@router.post("/", dependencies=[Depends(require_permission("domains", "modify"))])
def create_domain(domain: DomainCreate):
    name = domain.name.strip().lower()
    if not DOMAIN_RE.match(name):
        raise HTTPException(status_code=400, detail={"code": "invalid_domain_format"})

    db = get_db()
    cursor = db.cursor()
    try:
        cursor.execute("INSERT INTO domains (name, active) VALUES (%s, 1)", (name,))
        db.commit()
    except mysql.connector.IntegrityError:
        db.close()
        raise HTTPException(status_code=400, detail={"code": "domain_exists"})
    db.close()
    return {"status": "ok", "domain": name}


@router.delete("/{domain_id}", dependencies=[Depends(require_permission("domains", "modify"))])
def delete_domain(domain_id: int):
    db = get_db()
    cursor = db.cursor()
    cursor.execute("SELECT COUNT(*) FROM users WHERE domain_id=%s", (domain_id,))
    user_count = cursor.fetchone()[0]
    if user_count > 0:
        db.close()
        raise HTTPException(status_code=400, detail={"code": "domain_has_users", "params": {"count": user_count}})

    cursor.execute("DELETE FROM domains WHERE id=%s", (domain_id,))
    db.commit()
    deleted = cursor.rowcount
    db.close()
    if not deleted:
        raise HTTPException(status_code=404, detail={"code": "domain_not_found"})
    return {"status": "ok"}
