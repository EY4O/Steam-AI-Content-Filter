local logger     = require("logger")
local http       = require("http")
local cjson      = require("json")
local millennium = require("millennium")
local settings   = require("settings")

-- Cookies that get a request past Steam's age gate. Sent only on this backend
-- request; nothing is written to the user's Steam browser cookies.
local AGE_GATE_COOKIES = "birthtime=470736001; lastagecheckage=1-January-1985; wants_mature_content=1"

---@ffi
--- Current settings as a JSON string (mode, cache_days, cache_epoch, allowlist).
---@return string
function get_settings()
    return cjson.encode({
        mode = settings.get("mode"),
        cache_days = tonumber(settings.get("cache_days")) or settings.DEFAULTS.cache_days,
        cache_epoch = tonumber(settings.get("cache_epoch")) or 0,
        allowlist = settings.get_allowlist(),
    })
end

---@ffi
---@param mode string
---@return boolean
function set_mode(mode)
    if not settings.MODES[mode] then
        return false
    end
    millennium.config.set("mode", mode)
    return true
end

---@ffi
---@param days number
---@return boolean
function set_cache_days(days)
    days = math.floor(tonumber(days) or 0)
    if days < 1 or days > 30 then
        return false
    end
    millennium.config.set("cache_days", days)
    return true
end

---@ffi
---@param appid number
---@param name string
---@return boolean
function allow_app(appid, name)
    appid = tonumber(appid)
    if not appid then return false end
    settings.set_name(appid, name)
    local list = settings.get_allowlist()
    for _, v in ipairs(list) do
        if v == appid then return true end
    end
    list[#list + 1] = appid
    settings.set_allowlist(list)
    logger:info("Allowlisted app " .. appid)
    return true
end

---@ffi
---@param appid number
---@return boolean
function disallow_app(appid)
    appid = tonumber(appid)
    if not appid then return false end
    local list = {}
    for _, v in ipairs(settings.get_allowlist()) do
        if v ~= appid then list[#list + 1] = v end
    end
    settings.set_allowlist(list)
    settings.set_name(appid, nil)
    return true
end

---@ffi
--- Bump the cache epoch so every store page drops its cached verdicts.
---@return number
function clear_cache()
    local epoch = (tonumber(settings.get("cache_epoch")) or 0) + 1
    millennium.config.set("cache_epoch", epoch)
    return epoch
end

---@ffi
--- Fallback for age-gated store pages: fetch the page with age-gate cookies and
--- return the content-descriptor headings as a JSON array (null on failure).
---@param appid number
---@return string
function fetch_descriptor_headings(appid)
    appid = tonumber(appid)
    if not appid then return "null" end

    local res, err = http.get("https://store.steampowered.com/app/" .. appid .. "/", {
        headers = { ["Cookie"] = AGE_GATE_COOKIES },
        timeout = 15,
    })
    if not res or res.status ~= 200 then
        logger:warn("Store fetch failed for " .. appid .. ": " .. tostring(err or (res and res.status)))
        return "null"
    end

    local headings = {}
    for heading in string.gmatch(res.body, 'id="game_area_content_descriptors"[^>]*>%s*<h2>(.-)</h2>') do
        headings[#headings + 1] = heading
    end
    -- Still on the age gate means we learned nothing.
    if #headings == 0 and string.find(res.body, "agecheck", 1, true) then
        return "null"
    end
    return cjson.encode(headings)
end

logger:info("Registered RPC functions")
