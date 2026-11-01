local millennium = require("millennium")

local M = {}

M.MODES = { hide = true, blur = true, badge = true }

M.DEFAULTS = {
    mode = "hide",        -- hide | blur | badge
    cache_days = 7,       -- how long a store-page verdict is trusted
    cache_epoch = 0,      -- bumped by "Clear cache"; webkit wipes its cache when it changes
    allowlist = {},       -- array of appids (numbers) the user has explicitly allowed
    allowlist_names = {}, -- appid (string) -> game name, for the settings panel
}

function M.init_defaults()
    for key, value in pairs(M.DEFAULTS) do
        if millennium.config.get(key) == nil then
            millennium.config.set(key, value)
        end
    end
end

function M.get(key)
    local value = millennium.config.get(key)
    if value == nil then
        return M.DEFAULTS[key]
    end
    return value
end

-- Config tables can come back keyed by strings; normalise to a plain array of numbers.
function M.get_allowlist()
    local raw = M.get("allowlist")
    local list = {}
    if type(raw) == "table" then
        for _, v in pairs(raw) do
            local n = tonumber(v)
            if n then list[#list + 1] = n end
        end
    end
    table.sort(list)
    return list
end

function M.set_allowlist(list)
    millennium.config.set("allowlist", list)
end

-- Store (or with nil, forget) the display name of an allowlisted app.
function M.set_name(appid, name)
    local names = M.get("allowlist_names")
    if type(names) ~= "table" then names = {} end
    if name ~= nil and name ~= "" then
        names[tostring(appid)] = name
    else
        names[tostring(appid)] = nil
    end
    millennium.config.set("allowlist_names", names)
end

return M
