#!/bin/sh
# The original container ran the whole server as root, so an existing named volume can contain
# root-owned auth/workspace files. Repair that one known mount at startup, then permanently drop
# privileges before Node starts. Never chown NODETERM_DATA_DIR: it is operator-controlled and a
# hand-edited value such as "/" must not turn this compatibility migration into a recursive chown
# of the container filesystem.
set -eu

if [ "$(id -u)" -eq 0 ]; then
  # Checking only the mount root misses interrupted upgrades and files later written by an
  # administrator. Repair root ownership component-by-component within this filesystem, and do
  # not dereference symlinks outside /data. Non-root ownership is operator intent.
  find /data -xdev -uid 0 -exec chown -h node {} +
  find /data -xdev -gid 0 -exec chgrp -h node {} +
  exec gosu node "$@"
fi

exec "$@"
