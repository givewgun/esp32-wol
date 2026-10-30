# Basic health snapshot for the dashboard. No CPU temperature: Windows has no reliable built-in source,
# and a wrong number is worse than none.
import socket
import subprocess
import time

import psutil

NVIDIA_QUERY = ["nvidia-smi", "--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu",
                "--format=csv,noheader,nounits"]


def _gpu(run):
    try:
        out = run(NVIDIA_QUERY, capture_output=True, text=True, timeout=5,
                  creationflags=subprocess.CREATE_NO_WINDOW).stdout
        name, util, used, total, temp = [x.strip() for x in out.splitlines()[0].split(",")]
        return {"name": name, "util_pct": int(util), "vram_used_mb": int(used),
                "vram_total_mb": int(total), "temp_c": int(temp)}
    except (OSError, subprocess.SubprocessError, ValueError, IndexError):
        return None


def _disks():
    disks = []
    for part in psutil.disk_partitions():
        if "fixed" not in part.opts:
            continue
        try:
            usage = psutil.disk_usage(part.mountpoint)
        except OSError:
            continue
        disks.append({"mount": part.mountpoint, "free": usage.free, "total": usage.total})
    return disks


def collect_stats(now, run=subprocess.run):
    mem = psutil.virtual_memory()
    return {
        "ts": now,
        "host": socket.gethostname(),
        "uptime_s": int(time.time() - psutil.boot_time()),
        "cpu_pct": psutil.cpu_percent(interval=None),
        "ram": {"used": mem.total - mem.available, "total": mem.total},
        "gpu": _gpu(run),
        "disks": _disks(),
    }
