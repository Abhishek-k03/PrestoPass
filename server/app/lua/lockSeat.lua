-- KEYS[1] = seat lock key (e.g., seat_lock:eventId:seatId)
-- KEYS[2] = event seats hash key (e.g., event_seats:eventId)
-- ARGV[1] = userId
-- ARGV[2] = TTL in seconds
-- ARGV[3] = seatId

local key = KEYS[1]
local hashKey = KEYS[2]
local userId = ARGV[1]
local ttl = tonumber(ARGV[2])
local seatId = ARGV[3]

-- SET key userId EX ttl NX (set only if not exists)
local result = redis.call("SET", key, userId, "EX", ttl, "NX")

if result then 
    -- Update status in the seat map hash to LOCKED
    local seatVal = redis.call("HGET", hashKey, seatId)
    if seatVal then
        local seatNumber = string.match(seatVal, "([^:]+):")
        if seatNumber then
            redis.call("HSET", hashKey, seatId, seatNumber .. ":LOCKED")
        end
    end
    return 1 -- Seat Existed and the lock was acquired
else 
    -- Key already exists (held by someone, possibly this same user).
    -- No relock/refresh functionality exists in the app, so any request
    -- against an already-locked seat is simply a conflict.
    return 0
end
