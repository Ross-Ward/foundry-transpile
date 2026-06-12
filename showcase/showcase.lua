local function __f(x)
  local s = (string.format("%.6f", x):gsub("0+$", ""))
  if s:sub(-1) == "." then s = s .. "0" end
  return s
end

local function __zeros(n)
  local t = {}
  for i = 1, n do t[i] = 0 end
  return t
end

function total(items)
  local sum = 0.0
  do
    local i = 0
    while (i < #items) do
      sum = (sum + (items[(i) + 1].price * ((items[(i) + 1].qty) * 1.0)))
      i = (i + 1)
    end
  end
  return sum
end

function tag(it)
  return (((it.name .. " x") .. it.qty) .. ((function() if (it.qty > 1) then return " (bulk)" else return "" end end)()))
end

function main()
  local items = {{name = "anvil", qty = 2, price = 19.5}, {name = "tongs", qty = 1, price = 7.25}, {name = "flux", qty = 6, price = 0.5}}
  do
    local i = 0
    while (i < #items) do
      if (items[(i) + 1].qty == 0) then
        i = (i + 1)
        goto __cont_0
      end
      print(tag(items[(i) + 1]))
      i = (i + 1)
      ::__cont_0::
    end
  end
  print(__f(total(items)))
  print(math.tointeger(math.modf(total(items))))
  print(string.sub("=== FOUNDRY ===", (4) + 1, 11))
  print((#items >= 3))
end

main()
