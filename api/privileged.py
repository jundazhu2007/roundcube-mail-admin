"""Calls to the root-owned helper (deploy/sbin/mail-admin-helper) through sudo.

The service account is only allowed to run that one program with sudo; the helper validates every argument
and every byte of input before it touches the system. See the helper's docstring for the operations.
"""
import logging
import os
import shlex
import subprocess

HELPER = os.environ.get("MAIL_ADMIN_HELPER", "/usr/local/sbin/mail-admin-helper")
# `sudo -n` never waits for a password (a missing sudoers rule fails fast instead of hanging a request).
# Tests set MAIL_ADMIN_SUDO="" to run the helper directly.
_PREFIX = shlex.split(os.environ.get("MAIL_ADMIN_SUDO", "sudo -n"))

log = logging.getLogger(__name__)


def run_helper(*args, input=None, timeout=60):
    """Run `mail-admin-helper ARGS`; returns the CompletedProcess (never raises on a non-zero exit)."""
    try:
        r = subprocess.run([*_PREFIX, HELPER, *args], input=input, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        log.error("mail-admin-helper %s timed out", args[0])
        return subprocess.CompletedProcess(args, 124, "", "timeout")
    if r.returncode != 0:
        log.error("mail-admin-helper %s failed (%s): %s", args[0], r.returncode, (r.stderr or "").strip())
    return r


def systemctl(*args, timeout=30):
    """`sudo -n systemctl ...` for the fixed set of commands allowed in sudoers."""
    try:
        return subprocess.run([*_PREFIX, "systemctl", *args], capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return subprocess.CompletedProcess(args, 124, "", "timeout")
