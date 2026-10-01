# Load testing

`backend/scripts/loadtest.ts` simulates a crowded group-riding event against a
running backend and reports throughput, latency percentiles and errors for
each endpoint. Run it before launch events and after any change to presence,
rides or the rate limiter.

## How to run

The script writes test riders straight into the database, so point it at a
disposable database, **never production** (it refuses Railway, Supabase and
AWS-looking URLs).

```sh
# terminal 1: a backend on a throwaway database
cd backend
DATABASE_URL=postgres://rc:rc@127.0.0.1:5432/rc PORT=4100 HOST=127.0.0.1 \
  CORS_ALLOWED_ORIGINS=http://localhost node --experimental-strip-types src/server.ts

# terminal 2: 500 riders for 45 seconds (--pid adds the server's peak memory)
cd backend
DATABASE_URL=postgres://rc:rc@127.0.0.1:5432/rc node --experimental-strip-types \
  scripts/loadtest.ts --base http://127.0.0.1:4100 --riders 500 --seconds 45 --pid <server pid>
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--riders` | 200 | Simulated riders |
| `--seconds` | 60 | How long to run |
| `--nearby` | 0.5 | Share of riders on Nearby (public presence); the rest ride in private groups |
| `--group` | 10 | Riders per private ride |
| `--keep` | off | Leave the seeded `lt_…` rows in place afterwards |

Each simulated rider follows the real app's timing:

- **Riders in a group:** post their ride location every 10 s and refresh the ride every 5 s.
- **Riders on Nearby:** post presence every 8 s, all within about a mile of each other, moving at road speed.
- **Everyone:** loads friend activity every 30 s and hazards every 60 s, and keeps a social-events long-poll open.

The scenario is deliberately harsh. Half the riders sit inside one square
mile, so on Nearby every rider is in range of every other one. That is the
worst case for presence matching, like a big bike meet.

The `/social/events (cursor)` row is each rider's first call, made all at once
when the test starts. Its latency is that start-up burst, not a steady-state
figure.

## Results

These runs used a 4-CPU sandbox, with the load generator, backend and
Postgres sharing the same machine. Production runs on separate machines, so
treat these numbers as relative, not absolute.

### Before the fixes in this round

| Riders | Requests/s | Presence p95 | Ride refresh p95 | Errors |
| --- | --- | --- | --- | --- |
| 100 | 31 | 27 ms | 14 ms | 0 |
| 500 | 152 | 1,044 ms | 488 ms | 0–2 (`deadlock detected`) |
| 1000 | 183 of ~300 wanted | 13.7 s | 11.9 s | 260 timeouts |

### After

| Riders | Requests/s | Presence p50 / p95 | Ride refresh p50 / p95 | Errors | Peak memory |
| --- | --- | --- | --- | --- | --- |
| 100 | 30 | 15 / 27 ms | 8 / 14 ms | 0 | 141 MB |
| 500 | 153 | 16 / 77 ms | 6 / 70 ms | 0 | 164 MB |
| 1000 | 294 (all demand served) | 247 / 1,593 ms | 27 / 1,729 ms | 0 | 264 MB |

Even at 1000 riders, with 500 of them in one square mile, every request
succeeds and half are answered within tens of milliseconds.

### What was fixed

1. **Presence deadlocks.** Two Nearby riders updating at the same moment
   could each lock their own row and then wait on the other's. Fixes:
   - Updates now take a lighter row lock.
   - Pair rows are always written in one global order.
   - An update no longer deletes other riders' stale rows; reads already ignore them and the retention sweep removes them.
   - A rare deadlock that still occurs is retried.
2. **Presence did one database write per nearby rider on every update.**
   Inside a crowd of 250 that meant ~250 round trips every 8 s per rider, so
   the connection pool ran out and other requests timed out. Only pairs that
   actually changed are written now.
3. **Presence matching was O(n²).** Every update compared every nearby rider
   with every other one, then threw away all the pairs that didn't involve the
   updating rider. It now compares the rider only with the others
   (`computeZonePairsFor`). This was the server's main CPU cost.
4. **The per-request rate-limit check took six database round trips.** It
   now takes three, using one locked statement to count and insert.
5. **Connection pool.** The pool is now 20 per process instead of
   node-postgres' 10. It can be configured with `DATABASE_POOL_MAX`.

## Capacity guidance

- One backend process comfortably handles about **500 concurrently riding
  users**, even in the dense case. By 1000 the CPU is saturated and the slowest
  5% of requests take 1–2 s. They still succeed; it means a slower map
  update, not an error.
- To scale past that, add Railway replicas. Rate limits and presence live in
  Postgres, so replicas need no extra coordination. Keep
  `replicas × DATABASE_POOL_MAX` below the database's `max_connections`
  (100 on a default Railway Postgres).
- Live voice traffic does not go through this backend (LiveKit carries it),
  so these figures cover everything the backend itself does while people ride.
- Riders spread across a region are much cheaper than this test: presence
  only matches riders within 20 miles of each other.
