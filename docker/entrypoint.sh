#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
    exec /app/orbia "$@"
fi

uid=${PUID:-99}
gid=${PGID:-100}
for id in "$uid" "$gid"; do
    case "$id" in
        ''|0*|*[!0-9]*) echo "PUID and PGID must be positive numeric IDs." >&2; exit 1 ;;
    esac
    [ "$id" -le 2147483647 ] || { echo "PUID or PGID is out of range." >&2; exit 1; }
done

# Only prepare the dedicated mount and Orbia's SQLite files.
prepare() {
    path=$1
    mode=$2
    if [ "$(stat -c '%u:%g' "$path")" != "$uid:$gid" ]; then
        chown -h "$uid:$gid" "$path" || {
            echo "Cannot set ownership of $path to $uid:$gid. Check the host mount permissions." >&2
            exit 1
        }
    fi
    su-exec "$uid:$gid" chmod "$mode" "$path"
}

[ -d /data ] && [ ! -L /data ] || { echo "Mount a data directory at /data." >&2; exit 1; }
prepare /data u+rwx
for file in /data/orbia.db /data/orbia.db-wal /data/orbia.db-shm /data/orbia.db-journal; do
    if [ -L "$file" ]; then
        echo "Expected a regular SQLite file at $file." >&2; exit 1
    fi
    [ -e "$file" ] || continue
    if [ ! -f "$file" ] || [ "$(stat -c '%h' "$file")" != 1 ]; then
        echo "Expected a single regular SQLite file at $file." >&2; exit 1
    fi
    prepare "$file" 600
done

exec su-exec "$uid:$gid" /app/orbia "$@"
