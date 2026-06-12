const std = @import("std");

var __arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
const __alloc = __arena.allocator();
var __threaded: std.Io.Threaded = undefined;
var __io: std.Io = undefined;

fn __w(s: []const u8) void {
    std.Io.File.stdout().writeStreamingAll(__io, s) catch unreachable;
}

fn __istr(v: i64) []const u8 {
    return std.fmt.allocPrint(__alloc, "{d}", .{v}) catch unreachable;
}

fn __f(x: f64) []const u8 {
    const s = std.fmt.allocPrint(__alloc, "{d:.6}", .{x}) catch unreachable;
    var n = s.len;
    while (n > 0 and s[n - 1] == '0') n -= 1;
    if (n > 0 and s[n - 1] == '.') n += 1;
    return s[0..n];
}

fn __cat(a: []const u8, b: []const u8) []const u8 {
    return std.fmt.allocPrint(__alloc, "{s}{s}", .{ a, b }) catch unreachable;
}

fn __arr(comptime T: type, items: []const T) []T {
    const s = __alloc.alloc(T, items.len) catch unreachable;
    @memcpy(s, items);
    return s;
}

fn __zeros(n: i64) []i64 {
    const s = __alloc.alloc(i64, @intCast(n)) catch unreachable;
    @memset(s, 0);
    return s;
}

const Item = struct { name: []const u8, qty: i64, price: f64 };

fn __new_Item(name: []const u8, qty: i64, price: f64) *Item {
    const s = __alloc.create(Item) catch unreachable;
    s.* = .{ .name = name, .qty = qty, .price = price };
    return s;
}

fn total(items: []*Item) f64 {
    var sum: f64 = 0.0;
    {
        var i: i64 = 0;
        while ((i < @as(i64, @intCast(items.len)))) : (i = (i + 1)) {
            sum = (sum + (items[@intCast(i)].price * @as(f64, @floatFromInt(items[@intCast(i)].qty))));
        }
    }
    return sum;
}

fn tag(it: *Item) []const u8 {
    return __cat(__cat(__cat(it.name, " x"), __istr(it.qty)), (if ((it.qty > 1)) @as([]const u8, " (bulk)") else ""));
}

pub fn main() void {
    __threaded = std.Io.Threaded.init(std.heap.page_allocator, .{});
    __io = __threaded.io();
    const items: []*Item = __arr(*Item, &[_]*Item{ __new_Item("anvil", 2, 19.5), __new_Item("tongs", 1, 7.25), __new_Item("flux", 6, 0.5) });
    {
        var i: i64 = 0;
        while ((i < @as(i64, @intCast(items.len)))) : (i = (i + 1)) {
            if ((items[@intCast(i)].qty == 0)) {
                continue;
            }
            __w(tag(items[@intCast(i)]));
            __w("\n");
        }
    }
    __w(__f(total(items)));
    __w("\n");
    __w(__istr(@as(i64, @intFromFloat(@trunc(total(items))))));
    __w("\n");
    __w("=== FOUNDRY ==="[@intCast(4)..@intCast(11)]);
    __w("\n");
    __w((if ((@as(i64, @intCast(items.len)) >= 3)) @as([]const u8, "true") else "false"));
    __w("\n");
}
