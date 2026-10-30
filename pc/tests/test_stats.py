import subprocess

from pcagent.stats import collect_stats


def fake_nvidia(argv, **kw):
    return subprocess.CompletedProcess(argv, 0, stdout="NVIDIA GeForce RTX 5060 Ti, 7, 1160, 16311, 34\n", stderr="")


def test_collect_stats_shape():
    s = collect_stats(1767000000, run=fake_nvidia)
    assert s["ts"] == 1767000000
    assert isinstance(s["host"], str) and s["host"]
    assert s["uptime_s"] > 0
    assert 0 <= s["cpu_pct"] <= 100
    assert 0 < s["ram"]["used"] <= s["ram"]["total"]
    assert s["gpu"] == {"name": "NVIDIA GeForce RTX 5060 Ti", "util_pct": 7, "vram_used_mb": 1160,
                        "vram_total_mb": 16311, "temp_c": 34}
    assert s["disks"] and all(0 <= d["free"] <= d["total"] and d["mount"] for d in s["disks"])
    assert "cpu_temp" not in s


def test_collect_stats_gpu_null_when_nvidia_smi_missing():
    def missing(argv, **kw):
        raise FileNotFoundError("nvidia-smi")

    assert collect_stats(1, run=missing)["gpu"] is None


def test_collect_stats_gpu_null_on_garbage_output():
    def garbage(argv, **kw):
        return subprocess.CompletedProcess(argv, 0, stdout="No devices were found\n", stderr="")

    assert collect_stats(1, run=garbage)["gpu"] is None
