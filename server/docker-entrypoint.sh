#!/usr/bin/env bash
#
# Mode switch for the PrestoPass server image.
#
#   api     FastAPI + Socket.IO only
#   worker  taskiq payment worker only
#   all     both, in one container (single-instance and free-tier deploys)
#
# Without a worker running somewhere, every booking stays PENDING forever, so
# "all" is the default rather than "api".

set -euo pipefail

MODE="${1:-all}"

run_migrations() {
    # Alembic takes a lock and is idempotent, so it is safe even when several
    # instances boot at once. Set RUN_MIGRATIONS=0 to manage schema separately.
    if [ "${RUN_MIGRATIONS:-1}" != "0" ]; then
        echo "[entrypoint] alembic upgrade head"
        alembic upgrade head
    fi

    # Off by default: seeding is a first-deploy convenience, not a boot step.
    if [ "${SEED_ON_START:-0}" = "1" ]; then
        echo "[entrypoint] seeding sample data"
        if [ -n "${SEED_ADMIN_EMAIL:-}" ] && [ -n "${SEED_ADMIN_PASSWORD:-}" ]; then
            python -m app.scripts.seed --admin "$SEED_ADMIN_EMAIL" "$SEED_ADMIN_PASSWORD"
        else
            python -m app.scripts.seed
        fi
    fi
}

WORKER_CMD=(
    taskiq worker app.tasks.broker:broker app.tasks.payment
    --max-async-tasks "${WORKER_MAX_ASYNC_TASKS:-100}"
)

case "$MODE" in
    api)
        run_migrations
        exec python run.py
        ;;

    worker)
        # Migrations belong to the API/release step; a worker must not race it.
        exec "${WORKER_CMD[@]}"
        ;;

    all)
        run_migrations

        python run.py &
        API_PID=$!

        "${WORKER_CMD[@]}" &
        WORKER_PID=$!

        shutdown() { kill -TERM "$API_PID" "$WORKER_PID" 2>/dev/null || true; }
        trap shutdown TERM INT

        # Whichever process exits first brings the container down so the platform
        # restarts it. A half-dead container that still answers health checks
        # while no worker consumes the payment queue is the worst failure mode
        # here: checkout appears to succeed and nothing ever confirms.
        status=0
        wait -n || status=$?
        echo "[entrypoint] child exited (status=$status); shutting down"
        shutdown
        wait || true
        exit "$status"
        ;;

    *)
        echo "[entrypoint] unknown mode '$MODE' (expected: api, worker, all)" >&2
        exit 64
        ;;
esac
