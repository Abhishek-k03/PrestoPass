-- KEYS[1] = seat lock key
-- KEYS[2] = event seats hash key
-- ARGV[1] = userId (only the owner can release)
-- ARGV[2] = seatId

local key = KEYS[1]
local hashKey = KEYS[2]
local userId = ARGV[1]
local seatId = ARGV[2]

local holder = redis.call("GET", key)

if (holder == userId) then
    redis.call("DEL", key)
    
    -- Update status in the seat map hash to AVAILABLE
    local seatVal = redis.call("HGET", hashKey, seatId)
    if seatVal then
        local seatNumber = string.match(seatVal, "([^:]+):")
        if seatNumber then
            redis.call("HSET", hashKey, seatId, seatNumber .. ":AVAILABLE")
        end
    end
    
    return 1 -- The seat lock was released by the same user Only
else 
    return 0 -- The current lock is not the user's lock
end
