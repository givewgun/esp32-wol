from pcagent.power import PowerHandler


class Info:
    def __init__(self, log):
        self.log = log

    def wait_for_publish(self, timeout):
        self.log.append(("wait", timeout))


def make(dry_run=False):
    log, workers, flags = [], [], []
    actions = {"sleep": lambda: (log.append("sleep"), flags.append(handler.going_down)),
               "shutdown": lambda: log.append("shutdown")}

    def publish_status(status):
        log.append(("status", status))
        return Info(log)

    handler = PowerHandler(actions, publish_status, dry_run=dry_run, spawn=workers.append)
    make.flags = flags
    return handler, log, workers


def test_power_action_runs_off_the_calling_thread():
    # The caller is paho's network thread: waiting there for the "offline" PUBACK can never succeed
    handler, log, workers = make()
    assert handler.handle("sleep") is True
    assert log == [] and len(workers) == 1


def test_worker_says_offline_before_acting_and_clears_flag_after_resume():
    handler, log, workers = make()
    handler.handle("sleep")
    workers[0]()
    assert log == [("status", "offline"), ("wait", 5), "sleep"]
    assert make.flags == [True]  # heartbeat must not say "online" while going down
    assert handler.going_down is False


def test_unknown_payload_ignored():
    handler, log, workers = make()
    assert handler.handle("wake") is False
    assert workers == []


def test_dry_run_does_not_act():
    handler, log, workers = make(dry_run=True)
    assert handler.handle("shutdown") is True
    assert workers == [] and log == []
