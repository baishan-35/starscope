"""Regression checks for the daily star-count history / snapshot-delta logic.

Bug this guards against: record_history() used to overwrite "today's" sample
on every build. CI runs every 6 hours, so the history collapsed to a single
point and delta_gain() could never find a >=1-day-old baseline — the entire
snapshot-delta feature silently stayed on the Trending-page fallback forever.

Run: python tests/history_check.py
"""
import importlib.util
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location(
    "build_github_explorer", os.path.join(ROOT, "build_github_explorer.py"))
bge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bge)  # main() only runs under __main__

DAY = 86400
NOW = time.time()

ok, fail = [], []


def check(cond, label):
    (ok if cond else fail).append(label)


def day_start(ts):
    """Unix timestamp of Beijing-time (UTC+8) midnight for the day of `ts`."""
    return int((ts + 8 * 3600) // DAY) * DAY - 8 * 3600


def rows(stars):
    return [{"n": "acme/widget", "s": stars}]


# ---------- 1. one stable sample per Beijing calendar day ----------
yesterday = NOW - 26 * 3600
a0 = day_start(yesterday) + 10 * 3600   # yesterday 10:00
a1 = day_start(yesterday) + 16 * 3600   # same day, 6h later (a CI run)
check(int((a0 + 8 * 3600) // DAY) == int((a1 + 8 * 3600) // DAY),
      "test fixtures really sit on the same Beijing day")

hist = {"v": 1, "repos": {}}
bge.record_history(hist, rows(100), {}, {}, a0)
bge.record_history(hist, rows(110), {}, {}, a1)   # must NOT overwrite
bge.record_history(hist, rows(120), {}, {}, NOW)  # next day -> new point
pts = hist["repos"]["acme/widget"]
check(len(pts) == 2, "6h builds keep 1 point/day and append on the next day (got %d)" % len(pts))
check(pts[0][1] == 100, "the day's FIRST sample is kept as a stable baseline (got %s)" % pts[0][1])

# ---------- 2. deltas actually fire once a previous-day point exists ----------
check(bge.delta_gain(hist, "acme/widget", 150, 1) == 50,
      "daily delta = stars_now - yesterday's sample")
check(bge.net_growth(hist, "acme/widget", 150, 1) == 50,
      "net_growth shares the same daily baseline")
check(bge.delta_gain(hist, "acme/widget", 90, 1) == 0,
      "a star-count drop clamps to 0 rather than a negative gain")

# ---------- 3. fresh-only history must NOT satisfy a 1-day window ----------
fresh = {"repos": {"x/y": [[NOW - 3600, 100]]}}
check(bge.delta_gain(fresh, "x/y", 150, 1) is None,
      "last-build-only history never fakes a daily delta (the original bug)")
check(bge.net_growth(fresh, "x/y", 150, 1) is None,
      "net_growth also refuses a last-build-only point")

# ---------- 4. longer windows need their own baseline ----------
week_old = {"repos": {"acme/widget": [[NOW - 7 * DAY - 3600, 50]]}}
check(bge.delta_gain(week_old, "acme/widget", 150, 7) == 100,
      "weekly delta uses a ~7-day-old sample")
check(bge.delta_gain(week_old, "acme/widget", 150, 30) is None,
      "a 7-day-old sample cannot stand in for a 30-day baseline")
check(bge.delta_gain({"repos": {}}, "missing/repo", 150, 1) is None,
      "unknown repos fall back to the Trending page number")

# ---------- 5. closest sample wins, and old points are discarded ----------
mixed = {"repos": {"acme/widget": [[NOW - 3 * DAY, 10], [a0, 100], [NOW - 3600, 149]]}}
check(bge.delta_gain(mixed, "acme/widget", 150, 1) == 50,
      "the sample closest to 1 day ago wins (not the oldest or newest)")
ancient = {"repos": {"acme/widget": [[NOW - 34 * DAY, 10]]}}
check(bge.delta_gain(ancient, "acme/widget", 150, 30) is None,
      "samples older than the tolerance are rejected")

print("PASS (%d)" % len(ok))
for x in ok:
    print("  ok  " + x)
if fail:
    print("FAIL (%d)" % len(fail))
    for x in fail:
        print("  !!  " + x)
    sys.exit(1)
print("\nAll history / delta checks passed.")
