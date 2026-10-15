import json
import os
import subprocess
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from api import privileged
from api.auth import require_permission
from api.config import SETTINGS_FILE, AMAVIS_OVERRIDE_FILE

router = APIRouter()

DEFAULTS = {"spamassassin_threshold": 5.0, "default_quota_mb": 10240}


class SettingsUpdate(BaseModel):
    spamassassin_threshold: float
    default_quota_mb: int


def read_settings():
    if os.path.exists(SETTINGS_FILE):
        with open(SETTINGS_FILE) as f:
            return {**DEFAULTS, **json.load(f)}
    return dict(DEFAULTS)


def write_amavis_override(threshold: float):
    tag_level = max(1.0, threshold - 3)
    content = f"""use strict;

#
# Place your configuration directives here.  They will override those in
# earlier files.
#
# See /usr/share/doc/amavisd-new/ for documentation and examples of
# the directives you can use in this file
#
# 以下由 Mail Admin 後台自動產生，請透過後台「系統設定」頁調整，不要手動修改
$sa_tag_level_deflt  = {tag_level};
$sa_tag2_level_deflt = {threshold};
$sa_kill_level_deflt = {threshold};

#------------ Do not modify anything below this line -------------
1;  # ensure a defined return
"""
    r = privileged.run_helper("write-amavis-override", input=content)
    if r.returncode != 0:
        raise HTTPException(status_code=500, detail={"code": "amavis_write_failed"})
    privileged.systemctl("restart", "amavis")


@router.get("/", dependencies=[Depends(require_permission("settings", "view"))])
def get_settings():
    return read_settings()


@router.post("/", dependencies=[Depends(require_permission("settings", "modify"))])
def update_settings(settings: SettingsUpdate):
    if not (1 <= settings.spamassassin_threshold <= 20):
        raise HTTPException(status_code=400, detail={"code": "spam_threshold_range"})
    if settings.default_quota_mb < 0:
        raise HTTPException(status_code=400, detail={"code": "quota_negative"})

    os.makedirs(os.path.dirname(SETTINGS_FILE), exist_ok=True)
    data = {"spamassassin_threshold": settings.spamassassin_threshold, "default_quota_mb": settings.default_quota_mb}
    with open(SETTINGS_FILE, "w") as f:
        json.dump(data, f)

    write_amavis_override(settings.spamassassin_threshold)

    return {"status": "ok", **data}
