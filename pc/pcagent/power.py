# Power payloads on wol/desktop. Runs the action on a worker thread: the caller is paho's network thread, which must
# stay free to send the "offline" status (and read its PUBACK) before the PC goes down.
import threading


class PowerHandler:
    def __init__(self, actions, publish_status, *, dry_run=False, spawn=None):
        self.actions, self.publish_status, self.dry_run = actions, publish_status, dry_run
        self.spawn = spawn or (lambda fn: threading.Thread(target=fn, daemon=True).start())
        self.going_down = False  # the status heartbeat stays quiet while set

    def handle(self, cmd):
        """True if cmd is a power command for us ("wake" and anything else is not)."""
        action = self.actions.get(cmd)
        if action is None:
            return False
        if not self.dry_run:
            self.spawn(lambda: self._run(action))
        return True

    def _run(self, action):
        self.going_down = True
        try:
            # Say goodbye first: the LWT would only fire after the keepalive times out
            self.publish_status("offline").wait_for_publish(5)
            action()  # sleep/hibernate return here on resume
        finally:
            self.going_down = False
