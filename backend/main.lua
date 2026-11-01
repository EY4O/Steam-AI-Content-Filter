local logger     = require("logger")
local millennium = require("millennium")
local settings   = require("settings")

-- registers the RPC functions used by the webkit and frontend
require("rpc_functions")

local function on_load()
    settings.init_defaults()
    logger:info("AI Content Filter loaded on Millennium " .. millennium.version())
    millennium.ready()
end

local function on_unload()
    logger:info("AI Content Filter unloaded")
end

return {
    on_load = on_load,
    on_unload = on_unload,
}
