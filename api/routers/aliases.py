import re
import mysql.connector
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from api.auth import require_permission
from api.config import DB_HOST, DB_USER, DB_PASS, DB_NAME

router = APIRouter()

LOCAL_PART_RE = re.compile(r"^[A-Za-z0-9._%+-]+$")


def get_db():
    return mysql.connector.connect(
        host=DB_HOST, user=DB_USER, password=DB_PASS, database=DB_NAME
    )


class AliasCreate(BaseModel):
    alias_prefix: str
    domain: str
    destination_email: str


@router.get("/", dependencies=[Depends(require_permission("aliases", "view"))])
def list_aliases():
    db = get_db()
    cursor = db.cursor()
    cursor.execute(
        "SELECT a.id, a.source, a.destination, a.active, d.name "
        "FROM aliases a JOIN domains d ON a.domain_id = d.id "
        "ORDER BY a.source"
    )
    rows = cursor.fetchall()
    db.close()
    return [
        {"id": r[0], "alias": r[1], "target": r[2], "active": bool(r[3]), "domain": r[4]}
        for r in rows
    ]


@router.post("/", dependencies=[Depends(require_permission("aliases", "modify"))])
def create_alias(alias: AliasCreate):
    if not LOCAL_PART_RE.match(alias.alias_prefix):
        raise HTTPException(status_code=400, detail={"code": "invalid_alias_format"})

    source = f"{alias.alias_prefix}@{alias.domain}"
    if source == alias.destination_email:
        raise HTTPException(status_code=400, detail={"code": "alias_self_reference"})

    db = get_db()
    cursor = db.cursor()

    cursor.execute("SELECT id FROM domains WHERE name=%s AND active=1", (alias.domain,))
    domain_row = cursor.fetchone()
    if not domain_row:
        db.close()
        raise HTTPException(status_code=400, detail={"code": "domain_not_found"})

    cursor.execute(
        "SELECT id FROM users WHERE email=%s AND active=1", (alias.destination_email,)
    )
    if not cursor.fetchone():
        db.close()
        raise HTTPException(status_code=400, detail={"code": "target_email_not_found"})

    try:
        cursor.execute(
            "INSERT INTO aliases (domain_id, source, destination) VALUES (%s, %s, %s)",
            (domain_row[0], source, alias.destination_email),
        )
        db.commit()
    except mysql.connector.IntegrityError:
        db.close()
        raise HTTPException(status_code=400, detail={"code": "alias_exists"})

    db.close()
    return {"status": "ok", "alias": source}


@router.delete("/{alias_id}", dependencies=[Depends(require_permission("aliases", "modify"))])
def delete_alias(alias_id: int):
    db = get_db()
    cursor = db.cursor()
    cursor.execute("DELETE FROM aliases WHERE id=%s", (alias_id,))
    db.commit()
    deleted = cursor.rowcount
    db.close()
    if not deleted:
        raise HTTPException(status_code=404, detail={"code": "alias_not_found"})
    return {"status": "ok"}
