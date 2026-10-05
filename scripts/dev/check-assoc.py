"""Prints how each Markdown extension is associated for the current user and
verifies the UserChoice hashes ChoiMark wrote. Read-only.

    python scripts/dev/check-assoc.py
"""
import base64
import ctypes
import hashlib
import subprocess
import winreg

EXTS = [".md", ".markdown", ".mdown", ".mkd", ".mkdn", ".mdwn", ".mdtxt", ".mdtext"]
BASE = r"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts"
EXPERIENCE = "User Choice set via Windows User Experience {D18B6DD5-6124-4341-9318-804003BAFA0B}"
M = 0xFFFFFFFF


def cs64(text):
    data = text.encode("utf-16-le") + b"\x00\x00"
    md5 = hashlib.md5(data).digest()
    m0, m1 = int.from_bytes(md5[0:4], "little"), int.from_bytes(md5[4:8], "little")
    n = (1 if (len(data) & 4) == 0 else 0) + (len(data) >> 2) - 1
    w = [int.from_bytes(data[i * 4:i * 4 + 4], "little") for i in range(n)]
    k0, k1 = ((m0 | 1) + 0x69FB0000) & M, ((m1 | 1) + 0x13DB0000) & M
    o1 = o2 = c = 0

    for i in range(0, n, 2):
        r0 = (w[i] + o1) & M
        a = (r0 * k0 - 0x10FA9605 * (r0 >> 16)) & M
        b = (0x79F8A395 * a + 0x689B6B9F * (a >> 16)) & M
        r3 = (0xEA970001 * b - 0x3C101569 * (b >> 16)) & M
        r4 = (r3 + w[i + 1]) & M
        r5 = (c + r3) & M
        a = (r4 * k1 - 0x3CE8EC25 * (r4 >> 16)) & M
        b = (0x59C3AF2D * a - 0x2232E0F1 * (a >> 16)) & M
        o1 = (0x1EC90001 * b + 0x35BD1EC9 * (b >> 16)) & M
        o2 = c = (r5 + o1) & M

    p1 = (o1, o2)
    k0, k1 = (m0 | 1) & M, (m1 | 1) & M
    o1 = o2 = c = 0

    for i in range(0, n, 2):
        r0 = (w[i] + o1) & M
        a = (r0 * k0) & M
        b = (0xB1110000 * a - 0x30674EEF * (a >> 16)) & M
        a = (0x5B9F0000 * b - 0x78F7A461 * (b >> 16)) & M
        b = (0x12CEB96D * (a >> 16) - 0x46930000 * a) & M
        r3 = (0x1D830000 * b + 0x257E1D83 * (b >> 16)) & M
        a = (k1 * (r3 + w[i + 1])) & M
        b = (0x16F50000 * a - 0x5D8BE90B * (a >> 16)) & M
        a = (0x96FF0000 * b - 0x2C7C6901 * (b >> 16)) & M
        b = (0x2B890000 * a + 0x7C932B89 * (a >> 16)) & M
        o1 = (0x9F690000 * b - 0x405B6097 * (b >> 16)) & M
        o2 = c = (o1 + c + r3) & M

    raw = ((o1 ^ p1[0]) & M).to_bytes(4, "little") + ((o2 ^ p1[1]) & M).to_bytes(4, "little")

    return base64.b64encode(raw).decode()


def sid():
    out = subprocess.run(["whoami", "/user", "/fo", "csv", "/nh"], capture_output=True, text=True).stdout

    return out.strip().split(",")[-1].strip('"').lower()


def prog_of(path):
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, path) as k:
            return winreg.QueryValueEx(k, "ProgId")[0], k
    except OSError:
        return None, None


def assoc(ext):
    buf = ctypes.create_unicode_buffer(1024)
    size = ctypes.c_uint(1024)
    hr = ctypes.windll.shlwapi.AssocQueryStringW(0x20, 4, ext, None, buf, ctypes.byref(size))

    return buf.value if hr == 0 else "-"


user = sid()

for ext in EXTS:
    legacy = "-"

    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, rf"{BASE}\{ext}\UserChoice") as k:
            prog = winreg.QueryValueEx(k, "ProgId")[0]
            stored = winreg.QueryValueEx(k, "Hash")[0]
            ft = winreg.QueryInfoKey(k)[2]
            ft -= ft % 600_000_000
            ok = cs64(f"{ext}{user}{prog}{ft >> 32:08x}{ft & M:08x}{EXPERIENCE}".lower()) == stored
            legacy = f"{prog} (hash {'valid' if ok else 'INVALID'})"
    except OSError:
        pass

    latest = "-"

    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, rf"{BASE}\{ext}\UserChoiceLatest\ProgId") as k:
            latest = winreg.QueryValueEx(k, "ProgId")[0]
    except OSError:
        pass

    print(f"{ext:9} UserChoice={legacy:40} UserChoiceLatest={latest:22} shell says={assoc(ext)}")
